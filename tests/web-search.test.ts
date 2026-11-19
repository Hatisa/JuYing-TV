import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEB_SEARCH,
  buildWebContext,
  emptyWebSearchResult,
  isWebSearchUsable,
  normalizeWebSearchConfig,
  webSearchItems,
  webSearchProviderName,
} from '../src/lib/web-search';
import type { WebSearchResult } from '../src/types';

describe('normalizeWebSearchConfig', () => {
  it('缺省关闭 Bing，结果条数与超时有边界', () => {
    expect(normalizeWebSearchConfig()).toEqual(DEFAULT_WEB_SEARCH);
    expect(normalizeWebSearchConfig({ enabled: true, provider: 'tavily', maxResults: 99, timeoutMs: 100 })).toMatchObject({
      enabled: true,
      provider: 'tavily',
      maxResults: 6,
      timeoutMs: 3000,
    });
    expect(normalizeWebSearchConfig({ provider: 'unknown' as never, maxResults: 0 })).toMatchObject({
      provider: 'bing',
      maxResults: 1,
    });
  });

  it('enabled 只认真正的 true，Key 去除首尾空白', () => {
    expect(normalizeWebSearchConfig({ enabled: 'yes' as never }).enabled).toBe(false);
    expect(normalizeWebSearchConfig({ apiKey: '  sk-1  ' }).apiKey).toBe('sk-1');
  });
});

describe('isWebSearchUsable', () => {
  it('Bing / DuckDuckGo 免 Key，其余提供商必须有 Key', () => {
    expect(isWebSearchUsable({ enabled: false, provider: 'bing' })).toBe(false);
    expect(isWebSearchUsable({ enabled: true, provider: 'bing' })).toBe(true);
    expect(isWebSearchUsable({ enabled: true, provider: 'duckduckgo' })).toBe(true);
    expect(isWebSearchUsable({ enabled: true, provider: 'tavily', apiKey: '' })).toBe(false);
    expect(isWebSearchUsable({ enabled: true, provider: 'tavily', apiKey: 'tvly-1' })).toBe(true);
  });
});

describe('buildWebContext', () => {
  const result: WebSearchResult = {
    ok: true,
    provider: 'duckduckgo',
    query: '西游记',
    ms: 120,
    results: [
      { title: '西游记 电视剧', url: 'https://example.com/1', snippet: '1986 年央视版，六小龄童主演。' },
      { title: '', url: 'https://example.com/2', snippet: '' },
    ],
  };

  it('压成编号片段，不带链接，忽略空标题', () => {
    expect(buildWebContext(result)).toBe('[1] 西游记 电视剧：1986 年央视版，六小龄童主演。');
  });

  it('失败或空结果返回空字符串', () => {
    expect(buildWebContext(emptyWebSearchResult('serper', 'q', '失败'))).toBe('');
    expect(buildWebContext(null)).toBe('');
    expect(buildWebContext({ ...result, results: [] })).toBe('');
  });
});

describe('webSearchItems', () => {
  it('兼容 url/link、snippet/content，并过滤非 http 链接', () => {
    expect(
      webSearchItems([
        { title: 'A', url: 'https://a.example', snippet: '片段' },
        { title: 'B', link: 'http://b.example', content: '正文' },
        { title: 'C', url: 'javascript:alert(1)' },
        { title: 'D' },
        { title: '', url: 'https://empty.example' },
        null,
      ])
    ).toEqual([
      { title: 'A', url: 'https://a.example', snippet: '片段' },
      { title: 'B', url: 'http://b.example', snippet: '正文' },
    ]);
  });

  it('最多保留 6 条', () => {
    const list = Array.from({ length: 10 }, (_, i) => ({ title: 'T' + i, url: 'https://e.example/' + i }));
    expect(webSearchItems(list)).toHaveLength(6);
  });
});

describe('webSearchProviderName', () => {
  it('未知提供商回退为联网搜索', () => {
    expect(webSearchProviderName('serper')).toBe('Serper');
    expect(webSearchProviderName('bing')).toBe('Bing');
    expect(webSearchProviderName('nope')).toBe('联网搜索');
  });
});
