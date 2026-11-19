import type { WebSearchConfig, WebSearchItem, WebSearchProvider, WebSearchResult, WebSearchTestResult } from '../types';
import { cleanDescription, decodeHtmlEntities } from './format';
import { normalizeWebSearchConfig, webSearchProviderName } from './web-search';

/** 纯 TS 联网搜索引擎：桌面端走 Chromium 网络栈，Android 走本地 HTTP 服务，共用同一套解析。 */
export interface WebSearchRequestOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

export interface WebSearchTextResponse {
  ok: boolean;
  status?: number;
  text?: string;
  error?: string;
  ms?: number;
}

export interface WebSearchJsonResponse {
  ok: boolean;
  status?: number;
  data?: any;
  error?: string;
  ms?: number;
}

/** 由宿主注入的网络实现，绕开移动端 WebView 的跨域限制 */
export interface WebSearchTransport {
  text(url: string, opts?: WebSearchRequestOptions): Promise<WebSearchTextResponse>;
  json(url: string, opts?: WebSearchRequestOptions): Promise<WebSearchJsonResponse>;
}

function compact(text: string, limit: number): string {
  return cleanDescription(text).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function errorFor(provider: string, status: number, text: string): string {
  if (status === 0) return '无法连接' + provider + '：' + compact(text, 120);
  if (status === 401 || status === 403) return provider + ' 密钥无效或无权限（HTTP ' + status + '）';
  if (status === 429) return provider + ' 限流（HTTP 429），请稍后重试';
  const detail = compact(text, 120);
  return provider + ' 返回 HTTP ' + status + (detail ? '：' + detail : '');
}

function httpUrl(raw: string): string {
  try {
    const value = raw.startsWith('//') ? 'https:' + raw : raw;
    const url = new URL(decodeHtmlEntities(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

/** DuckDuckGo 的结果链接常包一层 /l/?uddg=... 跳转 */
function ddgUrl(raw: string): string {
  const value = raw.startsWith('//') ? 'https:' + raw : raw;
  try {
    const url = new URL(decodeHtmlEntities(value));
    const target = url.searchParams.get('uddg');
    if (target) return httpUrl(target);
    return httpUrl(url.toString());
  } catch {
    return '';
  }
}

function pushItem(out: WebSearchItem[], title: string, url: string, snippet: string, limit: number): void {
  const cleanTitle = compact(title, 140);
  const cleanUrl = httpUrl(url);
  if (!cleanTitle || !cleanUrl) return;
  if (out.some((item) => item.url === cleanUrl)) return;
  out.push({ title: cleanTitle, url: cleanUrl, snippet: compact(snippet, 320) });
  if (out.length > limit) out.length = limit;
}

export function parseDdgHtml(html: string, limit: number): WebSearchItem[] {
  const links: { url: string; title: string }[] = [];
  const snippets: string[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const cls = /class\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] || '';
    const href = /href\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] || '';
    if (/result__snippet/i.test(cls)) {
      snippets.push(body);
      continue;
    }
    if (/result__a/i.test(cls)) links.push({ url: ddgUrl(href), title: body });
  }
  const out: WebSearchItem[] = [];
  links.slice(0, limit).forEach((link, index) => pushItem(out, link.title, link.url, snippets[index] || '', limit));
  return out;
}

export function parseDdgLite(html: string, limit: number): WebSearchItem[] {
  const links: { url: string; title: string }[] = [];
  const snippets: string[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] || '';
    const cls = /class\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] || '';
    if (!/result-link/i.test(cls)) continue;
    const href = /href\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] || '';
    links.push({ url: ddgUrl(href), title: match[2] || '' });
  }
  for (const match of html.matchAll(/<td\b[^>]*class\s*=\s*["'][^"']*result-snippet[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)) {
    snippets.push(match[1] || '');
  }
  const out: WebSearchItem[] = [];
  links.slice(0, limit).forEach((link, index) => pushItem(out, link.title, link.url, snippets[index] || '', limit));
  return out;
}

export function parseBingHtml(html: string, limit: number): WebSearchItem[] {
  const out: WebSearchItem[] = [];
  for (const block of html.split(/<li class=["']b_algo["']/i).slice(1)) {
    const link = /<h2[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const snippet =
      /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] ||
      /<div[^>]*class=["'][^"']*b_caption[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] ||
      '';
    pushItem(out, (link[2] || '').replace(/<[^>]*>/g, ''), link[1], (snippet || '').replace(/<[^>]*>/g, ''), limit);
  }
  return out;
}

async function searchBing(query: string, config: WebSearchConfig, transport: WebSearchTransport): Promise<WebSearchResult> {
  const start = Date.now();
  const errors: string[] = [];
  const endpoints = [
    'https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-Hans',
    'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-Hans',
  ];
  for (const endpoint of endpoints) {
    const res = await transport.text(endpoint, {
      timeoutMs: config.timeoutMs,
      headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
    if (!res.ok) {
      errors.push(res.error || 'HTTP ' + res.status);
      continue;
    }
    const results = parseBingHtml(res.text || '', config.maxResults);
    if (results.length > 0) {
      return { ok: true, provider: 'bing', query, results, ms: Date.now() - start };
    }
    errors.push('没有解析到结果');
  }
  return {
    ok: false,
    provider: 'bing',
    query,
    results: [],
    error: 'Bing 搜索失败：' + (errors[0] || '没有返回结果') + '（可改用 Tavily / Serper）',
    ms: Date.now() - start,
  };
}

async function searchDuckDuckGo(query: string, config: WebSearchConfig, transport: WebSearchTransport): Promise<WebSearchResult> {
  const start = Date.now();
  const errors: string[] = [];
  const endpoints = [
    'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query) + '&kl=cn-zh',
    'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query) + '&kl=cn-zh',
  ];
  for (let index = 0; index < endpoints.length; index += 1) {
    const res = await transport.text(endpoints[index], {
      timeoutMs: config.timeoutMs,
      headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
    if (!res.ok) {
      errors.push(res.error || 'HTTP ' + res.status);
      continue;
    }
    const results = index === 0 ? parseDdgHtml(res.text || '', config.maxResults) : parseDdgLite(res.text || '', config.maxResults);
    if (results.length > 0) {
      return { ok: true, provider: 'duckduckgo', query, results, ms: Date.now() - start };
    }
    errors.push('没有解析到结果');
  }
  return {
    ok: false,
    provider: 'duckduckgo',
    query,
    results: [],
    error: 'DuckDuckGo 搜索失败：' + (errors[0] || '没有返回结果') + '（可改用 Tavily / Serper）',
    ms: Date.now() - start,
  };
}

async function searchTavily(query: string, config: WebSearchConfig, transport: WebSearchTransport): Promise<WebSearchResult> {
  const start = Date.now();
  const res = await transport.json('https://api.tavily.com/search', {
    method: 'POST',
    timeoutMs: config.timeoutMs,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      api_key: config.apiKey,
      query,
      search_depth: 'basic',
      max_results: config.maxResults,
      include_answer: false,
      include_raw_content: false,
    }),
  });
  if (!res.ok) {
    return {
      ok: false,
      provider: 'tavily',
      query,
      results: [],
      error: errorFor('Tavily', res.status || 0, res.error || ''),
      ms: res.ms || Date.now() - start,
    };
  }
  const raw = Array.isArray(res.data?.results) ? res.data.results : [];
  const results: WebSearchItem[] = [];
  for (const item of raw) {
    pushItem(results, String(item?.title || ''), String(item?.url || ''), String(item?.content || ''), config.maxResults);
  }
  return { ok: true, provider: 'tavily', query, results, ms: Date.now() - start };
}

async function searchSerper(query: string, config: WebSearchConfig, transport: WebSearchTransport): Promise<WebSearchResult> {
  const start = Date.now();
  const res = await transport.json('https://google.serper.dev/search', {
    method: 'POST',
    timeoutMs: config.timeoutMs,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-KEY': config.apiKey },
    body: JSON.stringify({ q: query, num: config.maxResults, hl: 'zh-cn', gl: 'cn' }),
  });
  if (!res.ok) {
    return {
      ok: false,
      provider: 'serper',
      query,
      results: [],
      error: errorFor('Serper', res.status || 0, res.error || ''),
      ms: res.ms || Date.now() - start,
    };
  }
  const raw = Array.isArray(res.data?.organic) ? res.data.organic : [];
  const results: WebSearchItem[] = [];
  for (const item of raw) {
    pushItem(results, String(item?.title || ''), String(item?.link || ''), String(item?.snippet || ''), config.maxResults);
  }
  return { ok: true, provider: 'serper', query, results, ms: Date.now() - start };
}

export async function searchWeb(
  query: string,
  rawConfig: Partial<WebSearchConfig> | null | undefined,
  transport: WebSearchTransport
): Promise<WebSearchResult> {
  const config = { ...normalizeWebSearchConfig(rawConfig), enabled: true };
  const text = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!text) {
    return { ok: false, provider: config.provider, query: '', results: [], error: '搜索关键词为空', ms: 0 };
  }
  if (config.provider !== 'duckduckgo' && config.provider !== 'bing' && !config.apiKey) {
    return {
      ok: false,
      provider: config.provider,
      query: text,
      results: [],
      error: webSearchProviderName(config.provider) + ' 需要先在设置中填写 API Key',
      ms: 0,
    };
  }
  try {
    if (config.provider === 'tavily') return await searchTavily(text, config, transport);
    if (config.provider === 'serper') return await searchSerper(text, config, transport);
    if (config.provider === 'bing') return await searchBing(text, config, transport);
    return await searchDuckDuckGo(text, config, transport);
  } catch (err: any) {
    return {
      ok: false,
      provider: config.provider,
      query: text,
      results: [],
      error: '联网搜索失败：' + (err?.message || String(err)),
      ms: 0,
    };
  }
}

export async function testWebSearch(
  rawConfig: Partial<WebSearchConfig> | null | undefined,
  transport: WebSearchTransport
): Promise<WebSearchTestResult> {
  const started = Date.now();
  const result = await searchWeb('流浪地球 电影', rawConfig, transport);
  if (!result.ok) return { ok: false, count: 0, error: result.error, ms: result.ms };
  return {
    ok: result.results.length > 0,
    count: result.results.length,
    error: result.results.length > 0 ? undefined : '搜索服务可用，但返回 0 条结果',
    ms: Date.now() - started,
  };
}
