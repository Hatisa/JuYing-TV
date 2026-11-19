import { net } from 'electron';
import type { NetJsonResult, NetTextResult, SourceTestResult } from '../src/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

/** 搜索请求默认超时：宁可快速失败也不让慢源拖住整个搜索 */
export const SEARCH_TIMEOUT_MS = 8000;

function decodeBody(buf: Buffer, contentType: string): string {
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
  if (charset && /gb/i.test(charset)) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      /* 回退 UTF-8 */
    }
  }
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

/** Chromium 网络栈（连接复用 / HTTP2 / DNS 缓存），比 Node fetch 更快 */
function pickFetch(): typeof fetch {
  try {
    if (typeof net?.fetch === 'function') {
      return ((input: any, init?: any) => net.fetch(input, init)) as typeof fetch;
    }
  } catch {
    /* 非 Electron 环境（测试等）回退 */
  }
  return fetch;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  text: string;
  ms: number;
  error?: string;
}

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** 默认 GET；AI 接口需要 POST */
  method?: string;
  /** 请求体（字符串） */
  body?: string;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  const doFetch = pickFetch();
  try {
    if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http/https 地址');
    const res = await doFetch(url, {
      method: opts.method || 'GET',
      headers: { ...DEFAULT_HEADERS, ...(opts.headers || {}) },
      body: opts.body,
      signal: controller.signal,
      redirect: 'follow',
    } as any);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = decodeBody(buf, res.headers.get('content-type') || '');
    return { ok: res.ok, status: res.status, text, ms: Date.now() - start };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError' || err?.name === 'TimeoutError';
    return {
      ok: false,
      status: 0,
      text: '',
      ms: Date.now() - start,
      error: aborted ? '请求超时' : err?.message || '网络请求失败',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url: string, opts: FetchOptions = {}): Promise<NetJsonResult> {
  const res = await fetchText(url, opts);
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.error || `HTTP ${res.status}`, ms: res.ms };
  }
  try {
    return { ok: true, status: res.status, data: JSON.parse(res.text), ms: res.ms };
  } catch {
    const snippet = res.text.slice(0, 80).replace(/\s+/g, ' ');
    return { ok: false, status: res.status, error: `返回内容不是 JSON：${snippet}`, ms: res.ms };
  }
}

/** 采集源探活：请求第一页并统计条目数 */
export async function testSource(url: string, timeoutMs = SEARCH_TIMEOUT_MS): Promise<SourceTestResult> {
  const base = url.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return { ok: false, ms: 0, error: '无效的源地址（需以 http/https 开头）' };
  const res = await fetchJson(`${base}?ac=videolist&pg=1`, { timeoutMs });
  if (!res.ok) return { ok: false, ms: res.ms || 0, error: res.error || '请求失败' };
  const list = res.data?.list;
  if (!Array.isArray(list)) return { ok: false, ms: res.ms || 0, error: '返回格式不是苹果CMS接口（缺少 list）' };
  if (list.length === 0) return { ok: true, ms: res.ms || 0, count: 0, error: '接口可用，但当前无数据' };
  return { ok: true, ms: res.ms || 0, count: list.length };
}
