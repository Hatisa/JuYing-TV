import { describe, expect, it } from 'vitest';
import { isPlaylistContent, resolveUrl, rewritePlaylist } from '../electron/hls-rewrite';

const base = 'https://vip.ffzy-online2.com/20230416/32868_9cb1983d/index.m3u8';
const wrap = (abs: string) => `http://127.0.0.1:9999/hls?t=abc&u=${encodeURIComponent(abs)}`;

describe('resolveUrl', () => {
  it('解析相对/绝对地址', () => {
    expect(resolveUrl('seg1.ts', base)).toBe('https://vip.ffzy-online2.com/20230416/32868_9cb1983d/seg1.ts');
    expect(resolveUrl('../other/seg.ts', base)).toBe('https://vip.ffzy-online2.com/20230416/other/seg.ts');
    expect(resolveUrl('https://cdn.x.com/seg.ts', base)).toBe('https://cdn.x.com/seg.ts');
  });
});

describe('rewritePlaylist', () => {
  it('把所有 URI（含 EXT-X-KEY / MAP / 分片）改写成代理地址', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.key"',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:4.0,',
      'seg_0001.ts',
      '#EXTINF:4.0,',
      'https://cdn.x.com/seg_0002.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const out = rewritePlaylist(playlist, base, wrap);
    expect(out).toContain(wrap('https://vip.ffzy-online2.com/20230416/32868_9cb1983d/seg_0001.ts'));
    expect(out).toContain(wrap('https://cdn.x.com/seg_0002.ts'));
    expect(out).toContain(`URI="${wrap('https://vip.ffzy-online2.com/20230416/32868_9cb1983d/key.key')}"`);
    expect(out).toContain('#EXT-X-ENDLIST');
    expect(out).not.toContain('\nseg_0001.ts\n');
  });

  it('master playlist 中的子列表也会改写', () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\n1080p/index.m3u8';
    const out = rewritePlaylist(master, base, wrap);
    expect(out).toContain(wrap('https://vip.ffzy-online2.com/20230416/32868_9cb1983d/1080p/index.m3u8'));
  });
});

describe('isPlaylistContent', () => {
  it('识别 playlist 与网页', () => {
    expect(isPlaylistContent('https://x.com/a/index.m3u8', 'application/vnd.apple.mpegurl')).toBe(true);
    expect(isPlaylistContent('https://x.com/share/1.html', 'text/html; charset=utf-8')).toBe(false);
    expect(isPlaylistContent('https://x.com/a/index.m3u8?t=1', '')).toBe(true);
  });
});
