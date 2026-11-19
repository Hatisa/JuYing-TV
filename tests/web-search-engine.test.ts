import { describe, expect, it, vi } from 'vitest';
import { parseBingHtml, parseDdgHtml, parseDdgLite, searchWeb, testWebSearch, type WebSearchTransport } from '../src/lib/web-search-engine';

const BING_HTML = `
<ol id="b_results">
  <li class="b_algo">
    <h2><a href="https://movie.douban.com/subject/1/">流浪地球 <strong>电影</strong></a></h2>
    <div class="b_caption"><p>太阳即将毁灭，人类开启流浪地球计划。</p></div>
  </li>
  <li class="b_algo">
    <h2><a href="https://example.com/two">第二条结果</a></h2>
    <p>第二条摘要</p>
  </li>
</ol>
`;

const DDG_HTML = `
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fmovie%3Fa%3D1&amp;rut=abc">示例电影</a>
  <a class="result__snippet">这是一段<strong>剧情</strong>简介。</a>
</div>
`;

const DDG_LITE = `
<table>
  <tr><td><a rel="nofollow" class="result-link" href="https://example.com/lite">Lite 结果</a></td></tr>
  <tr><td class="result-snippet">Lite 摘要</td></tr>
</table>
`;

function textTransport(html: string): WebSearchTransport {
  return {
    text: vi.fn(async () => ({ ok: true, status: 200, text: html, ms: 12 })),
    json: vi.fn(async () => ({ ok: false, status: 0, error: 'not used' })),
  };
}

describe('web search HTML parsers', () => {
  it('解析 Bing 结果并去掉标题与摘要里的标签', () => {
    expect(parseBingHtml(BING_HTML, 6)).toEqual([
      { title: '流浪地球 电影', url: 'https://movie.douban.com/subject/1/', snippet: '太阳即将毁灭，人类开启流浪地球计划。' },
      { title: '第二条结果', url: 'https://example.com/two', snippet: '第二条摘要' },
    ]);
  });

  it('解析 DuckDuckGo HTML 并还原 uddg 跳转链接', () => {
    expect(parseDdgHtml(DDG_HTML, 6)).toEqual([
      { title: '示例电影', url: 'https://example.com/movie?a=1', snippet: '这是一段 剧情 简介。' },
    ]);
  });

  it('解析 DuckDuckGo Lite，并按条数上限截断', () => {
    expect(parseDdgLite(DDG_LITE, 1)).toEqual([
      { title: 'Lite 结果', url: 'https://example.com/lite', snippet: 'Lite 摘要' },
    ]);
  });

  it('忽略 javascript: 等非 http 链接与重复地址', () => {
    const html = `<li class="b_algo"><h2><a href="javascript:alert(1)">坏链接</a></h2></li>
      <li class="b_algo"><h2><a href="https://a.example/1">A</a></h2></li>
      <li class="b_algo"><h2><a href="https://a.example/1">A 重复</a></h2></li>`;
    expect(parseBingHtml(html, 6)).toEqual([{ title: 'A', url: 'https://a.example/1', snippet: '' }]);
  });
});

describe('searchWeb transport injection', () => {
  it('Bing 免 Key，请求桌面版页面并返回结果', async () => {
    const transport = textTransport(BING_HTML);
    const result = await searchWeb('流浪地球', { provider: 'bing', maxResults: 2, timeoutMs: 5000 }, transport);
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('bing');
    expect(result.results).toHaveLength(2);
    expect(transport.text).toHaveBeenCalledTimes(1);
    const [url, opts] = (transport.text as any).mock.calls[0];
    expect(url).toContain('cn.bing.com/search');
    expect(opts.headers.Accept).toContain('text/html');
  });

  it('Tavily 通过 POST 发送 JSON 与 API Key', async () => {
    const json = vi.fn(async () => ({
      ok: true,
      status: 200,
      data: { results: [{ title: '结果', url: 'https://example.com/r', content: '内容' }] },
      ms: 30,
    }));
    const transport: WebSearchTransport = {
      text: vi.fn(async () => ({ ok: false, status: 0, error: 'not used' })),
      json,
    };
    const result = await searchWeb('测试', { provider: 'tavily', apiKey: 'tvly-1', maxResults: 3 }, transport);
    expect(result).toMatchObject({ ok: true, provider: 'tavily' });
    expect(result.results).toEqual([{ title: '结果', url: 'https://example.com/r', snippet: '内容' }]);
    const [url, opts] = json.mock.calls[0] as any[];
    expect(url).toBe('https://api.tavily.com/search');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toMatchObject({ api_key: 'tvly-1', query: '测试', max_results: 3 });
  });

  it('需要 Key 的供应商缺 Key 时不发请求', async () => {
    const transport = textTransport(BING_HTML);
    const result = await searchWeb('测试', { provider: 'serper', apiKey: '' }, transport);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('API Key');
    expect(transport.text).not.toHaveBeenCalled();
    expect(transport.json).not.toHaveBeenCalled();
  });

  it('testWebSearch 返回结果条数', async () => {
    const result = await testWebSearch({ provider: 'bing', maxResults: 2 }, textTransport(BING_HTML));
    expect(result).toMatchObject({ ok: true, count: 2 });
  });
});
