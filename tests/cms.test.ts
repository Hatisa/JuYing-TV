import { describe, expect, it } from 'vitest';
import { detailUrl, extractM3u8, latestUrl, parseDetail, parseLines, parseList, searchUrl } from '../src/lib/cms';
import type { SourceConfig } from '../src/types';

const source: SourceConfig = { key: 'ffzy', name: '非凡资源', url: 'https://cj.ffzyapi.com/api.php/provide/vod' };

describe('URL 构造', () => {
  it('按苹果CMS 规范拼接搜索/最新/详情地址', () => {
    expect(searchUrl(source, '流浪地球', 2)).toBe('https://cj.ffzyapi.com/api.php/provide/vod?ac=videolist&wd=%E6%B5%81%E6%B5%AA%E5%9C%B0%E7%90%83&pg=2');
    expect(latestUrl(source, 1)).toBe('https://cj.ffzyapi.com/api.php/provide/vod?ac=videolist&pg=1');
    expect(detailUrl(source, '32868')).toContain('ac=detail&ids=32868');
  });

  it('处理带查询串的源地址', () => {
    const s = { ...source, url: 'https://x.com/api.php/provide/vod?ac=list&t=1' };
    expect(searchUrl(s, 'a b', 1)).toContain('wd=a%20b');
  });
});

describe('列表解析', () => {
  const payload = {
    code: 1,
    page: 1,
    pagecount: 3,
    total: 40,
    list: [
      {
        vod_id: 32868,
        vod_name: '流浪地球2',
        vod_pic: 'https://img.example.com/a.jpg',
        type_name: '科幻片',
        vod_year: '2023',
        vod_area: '大陆',
        vod_remarks: 'HD国语',
        vod_play_from: 'ffm3u8',
        vod_play_url: '第01集$https://vip.ffzy-online2.com/a/index.m3u8',
      },
      { vod_id: '2', vod_name: '  ' },
      { vod_id: 3, vod_name: '三体', vod_pic: '', vod_remarks: '更新至30集' },
    ],
  };

  it('映射字段并跳过空标题', () => {
    const res = parseList(payload, source);
    expect(res.list).toHaveLength(2);
    expect(res.list[0]).toMatchObject({
      sourceKey: 'ffzy',
      vodId: '32868',
      name: '流浪地球2',
      typeName: '科幻片',
      year: '2023',
      remarks: 'HD国语',
    });
    expect(res.total).toBe(40);
    expect(res.pageCount).toBe(3);
  });

  it('无数据时返回空列表，格式异常则抛错', () => {
    expect(parseList({ code: 0, msg: 'no data' }, source).list).toEqual([]);
    expect(parseList({ list: [] }, source).list).toEqual([]);
    expect(() => parseList(null, source)).toThrow('接口返回格式无效');
    expect(() => parseList({ list: 'bad' }, source)).toThrow();
  });
});

describe('播放线路解析', () => {
  it('拆出线路与剧集', () => {
    const lines = parseLines(
      'ffm3u8$$$hdm3u8',
      '第01集$https://a.com/1/index.m3u8#第02集$https://a.com/2/index.m3u8$$$第01集$https://b.com/1/index.m3u8'
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].episodes).toHaveLength(2);
    expect(lines[0].episodes[1]).toEqual({ name: '第02集', url: 'https://a.com/2/index.m3u8' });
    expect(lines[1].name).toBe('hdm3u8');
  });

  it('丢弃 /share/ 中转线路，保留直链线路', () => {
    const lines = parseLines('share$$$ffm3u8', '第01集$https://a.com/share/abc.html$$$第01集$https://a.com/1/index.m3u8');
    expect(lines).toHaveLength(1);
    expect(lines[0].name).toBe('ffm3u8');
  });

  it('只有中转页时保留下来作为兜底', () => {
    const lines = parseLines('share', '第01集$https://a.com/share/abc.html');
    expect(lines).toHaveLength(1);
    expect(lines[0].episodes[0].url).toBe('https://a.com/share/abc.html');
  });

  it('无地址返回空数组', () => {
    expect(parseLines(undefined, undefined)).toEqual([]);
    expect(parseLines('a', '')).toEqual([]);
  });
});

describe('详情解析', () => {
  it('解析简介与播放地址', () => {
    const detail = parseDetail(
      {
        list: [
          {
            vod_id: 1,
            vod_name: '流浪地球&nbsp;2',
            vod_pic: 'https://img/a.jpg?x=1&amp;y=2',
            vod_content: '<p>太阳&nbsp;危机&amp;希望</p><p>人类&#39;命运&#x27;</p>',
            vod_director: '郭帆',
            vod_actor: '吴京,刘德华',
            vod_play_from: 'ffm3u8',
            vod_play_url: '正片$https://a.com/1/index.m3u8',
          },
        ],
      },
      source
    );
    expect(detail.info.title).toBe('流浪地球 2');
    expect(detail.info.cover).toBe('https://img/a.jpg?x=1&y=2');
    expect(detail.info.desc).toBe("太阳 危机&希望 人类'命运'");
    expect(detail.line[0].episodes[0].name).toBe('正片');
  });

  it('没有播放地址时从简介提取 m3u8', () => {
    const detail = parseDetail(
      { list: [{ vod_name: 'X', vod_content: '播放地址：https://cdn.x.com/a/b/index.m3u8 谢谢' }] },
      source
    );
    expect(detail.line[0].episodes).toHaveLength(1);
    expect(detail.line[0].episodes[0].url).toBe('https://cdn.x.com/a/b/index.m3u8');
  });

  it('空列表抛错', () => {
    expect(() => parseDetail({ list: [] }, source)).toThrow('未获取到影片详情');
  });
});

describe('中转页提取', () => {
  it('从 HTML 中提取 m3u8 并反转义', () => {
    const html = '<script>var u="https:\\/\\/vip.x.com\\/2023\\/a\\/index.m3u8";</script>';
    expect(extractM3u8(html)).toBe('https://vip.x.com/2023/a/index.m3u8');
  });
  it('没有则返回 null', () => {
    expect(extractM3u8('nothing here')).toBeNull();
  });
});
