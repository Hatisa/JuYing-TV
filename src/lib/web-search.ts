import type { WebSearchConfig, WebSearchItem, WebSearchProvider, WebSearchResult } from '../types';

/** DuckDuckGo 无需 Key；Tavily / Serper 需要用户自己的 Key */
export const WEB_SEARCH_PROVIDERS: { value: WebSearchProvider; name: string; hint: string }[] = [
  { value: 'bing', name: 'Bing', hint: '免 Key，国内网络可用，推荐默认' },
  { value: 'duckduckgo', name: 'DuckDuckGo', hint: '免 Key，直接搜索，可能被限流或无法直连' },
  { value: 'tavily', name: 'Tavily', hint: '为 AI 优化的搜索 API，需 Key' },
  { value: 'serper', name: 'Serper', hint: 'Google 结果，需 Key' },
];

export const DEFAULT_WEB_SEARCH: WebSearchConfig = {
  enabled: false,
  provider: 'bing',
  apiKey: '',
  maxResults: 4,
  timeoutMs: 8000,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function normalizeWebSearchConfig(raw?: Partial<WebSearchConfig> | null): WebSearchConfig {
  const provider: WebSearchProvider =
    raw?.provider === 'tavily' || raw?.provider === 'serper' || raw?.provider === 'duckduckgo' || raw?.provider === 'bing'
      ? raw.provider
      : DEFAULT_WEB_SEARCH.provider;
  return {
    enabled: raw?.enabled === true,
    provider,
    apiKey: String(raw?.apiKey || '').trim(),
    maxResults: clampInt(raw?.maxResults, 1, 6, DEFAULT_WEB_SEARCH.maxResults),
    timeoutMs: clampInt(raw?.timeoutMs, 3000, 20_000, DEFAULT_WEB_SEARCH.timeoutMs),
  };
}

export function isWebSearchUsable(config?: Partial<WebSearchConfig> | null): boolean {
  if (!config?.enabled) return false;
  if (config.provider === 'duckduckgo' || config.provider === 'bing') return true;
  return !!String(config.apiKey || '').trim();
}

export function webSearchProviderName(provider?: string): string {
  return WEB_SEARCH_PROVIDERS.find((item) => item.value === provider)?.name || '联网搜索';
}

/** 把搜索结果压成给模型看的短上下文，不包含链接，避免模型复述 */
export function buildWebContext(result?: WebSearchResult | null): string {
  if (!result?.ok || !Array.isArray(result.results) || result.results.length === 0) return '';
  const items = result.results
    .map((item) => {
      const title = String(item.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const snippet = String(item.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 220);
      return { title, snippet };
    })
    .filter((item) => item.title)
    .slice(0, 6);
  return items.map((item, index) => `[${index + 1}] ${item.title}${item.snippet ? '：' + item.snippet : ''}`).join('\n');
}

export function emptyWebSearchResult(provider: WebSearchProvider, query: string, error: string): WebSearchResult {
  return { ok: false, provider, query, results: [], error, ms: 0 };
}

export function webSearchItems(payload: unknown): WebSearchItem[] {
  if (!Array.isArray(payload)) return [];
  const out: WebSearchItem[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const url = typeof raw.url === 'string' ? raw.url.trim() : typeof raw.link === 'string' ? raw.link.trim() : '';
    const snippet =
      typeof raw.snippet === 'string'
        ? raw.snippet.trim()
        : typeof raw.content === 'string'
          ? raw.content.trim()
          : typeof raw.description === 'string'
            ? raw.description.trim()
            : '';
    if (!title || !/^https?:\/\//i.test(url)) continue;
    out.push({ title, url, snippet });
    if (out.length >= 6) break;
  }
  return out;
}
