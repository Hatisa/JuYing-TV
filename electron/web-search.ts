import type { WebSearchConfig, WebSearchResult, WebSearchTestResult } from '../src/types';
import { searchWeb as runSearch, testWebSearch as runTest, type WebSearchTransport } from '../src/lib/web-search-engine';
import { fetchJson, fetchText } from './net';

/** 桌面端网络实现：复用 Chromium 网络栈，与移动端共用解析逻辑。 */
const desktopTransport: WebSearchTransport = {
  async text(url, opts = {}) {
    const res = await fetchText(url, {
      timeoutMs: opts.timeoutMs,
      headers: opts.headers,
      method: opts.method,
      body: opts.body,
    });
    return { ok: res.ok, status: res.status, text: res.text, error: res.error };
  },
  async json(url, opts = {}) {
    const res = await fetchJson(url, {
      timeoutMs: opts.timeoutMs,
      headers: opts.headers,
      method: opts.method,
      body: opts.body,
    });
    return { ok: res.ok, status: res.status, data: res.data, error: res.error, ms: res.ms };
  },
};

export function searchWeb(query: string, rawConfig?: Partial<WebSearchConfig> | null): Promise<WebSearchResult> {
  return runSearch(query, rawConfig, desktopTransport);
}

export function testWebSearch(rawConfig?: Partial<WebSearchConfig> | null): Promise<WebSearchTestResult> {
  return runTest(rawConfig, desktopTransport);
}
