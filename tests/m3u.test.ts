import { describe, expect, it } from 'vitest';
import { parseM3U } from '../src/lib/m3u';

const sample = `#EXTM3U
#EXTINF:-1 tvg-id="CCTV1" tvg-name="CCTV-1" tvg-logo="https://logo/1.png" group-title="央视",CCTV-1 综合
https://iptv.example.com/cctv1.m3u8
#EXTINF:-1 group-title="央视",CCTV-2 财经
https://iptv.example.com/cctv2.m3u8
#EXTINF:-1 group-title="卫视",湖南卫视
rtmp://live.example.com/hunan
# 注释行
`;

describe('parseM3U', () => {
  it('解析频道名、分组、logo', () => {
    const list = parseM3U(sample);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ name: 'CCTV-1 综合', group: '央视', logo: 'https://logo/1.png', tvgId: 'CCTV1' });
    expect(list[2].url).toBe('rtmp://live.example.com/hunan');
  });

  it('忽略没有 EXTINF 的裸地址', () => {
    expect(parseM3U('https://x.com/a.m3u8')).toEqual([]);
  });

  it('未标注分组时归入未分组', () => {
    const list = parseM3U('#EXTINF:-1,测试\.m3u8'.replace('\\.m3u8', '') + '\nhttps://x.com/a.m3u8');
    expect(list[0].group).toBe('未分组');
  });

  it('空内容返回空数组', () => {
    expect(parseM3U('')).toEqual([]);
  });
});
