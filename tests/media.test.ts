import { describe, expect, it } from 'vitest';
import { coverUrl, proxyMedia, proxyUrl, resolvePlaySource, streamType } from '../src/lib/media';
import type { ProxyInfo } from '../src/types';

const proxy: ProxyInfo = { base: 'http://127.0.0.1:9999', token: 'abc', enabled: true };

describe('streamType', () => {
  it('识别常见流类型', () => {
    expect(streamType('https://x.com/a/b/index.m3u8?t=1')).toBe('m3u8');
    expect(streamType('https://x.com/live/stream.flv')).toBe('flv');
    expect(streamType('https://x.com/movie.mp4')).toBe('mp4');
    expect(streamType('https://x.com/a.mkv')).toBe('other');
    expect(streamType('https://x.com/share/123.html')).toBe('other');
  });
});

describe('代理地址', () => {
  it('m3u8/flv 走 /hls 代理', () => {
    const out = proxyMedia('https://x.com/a/index.m3u8', proxy);
    expect(out).toBe(`http://127.0.0.1:9999/hls?t=abc&u=${encodeURIComponent('https://x.com/a/index.m3u8')}`);
  });

  it('可附加 referer', () => {
    const out = proxyMedia('https://x.com/a.m3u8', proxy, 'https://x.com/');
    expect(out).toContain('&r=https%3A%2F%2Fx.com%2F');
  });

  it('代理关闭或非 http 时原样返回', () => {
    expect(proxyMedia('https://x.com/a.m3u8', { ...proxy, enabled: false })).toBe('https://x.com/a.m3u8');
    expect(proxyUrl('/local/a.jpg', proxy)).toBe('/local/a.jpg');
  });

  it('封面走 /img 代理', () => {
    expect(coverUrl('https://x.com/c.jpg', proxy)).toContain('/img?t=abc');
    expect(coverUrl('', proxy)).toBe('');
  });

  it('封面可带宽度参数（主进程缩放后再返回）', () => {
    expect(coverUrl('https://x.com/c.jpg', proxy, 360)).toContain('&w=360');
    expect(coverUrl('https://x.com/c.jpg', proxy, 360)).toContain(encodeURIComponent('https://x.com/c.jpg'));
    expect(coverUrl('https://x.com/c.jpg', proxy)).not.toContain('w=');
    expect(coverUrl('https://x.com/c.jpg', { ...proxy, enabled: false }, 360)).toBe('https://x.com/c.jpg');
  });
});

describe('resolvePlaySource', () => {
  it('m3u8 走代理，mp4 直连', () => {
    expect(resolvePlaySource('https://x.com/a/index.m3u8', proxy)).toEqual({
      url: proxyMedia('https://x.com/a/index.m3u8', proxy),
      type: 'm3u8',
    });
    expect(resolvePlaySource('https://x.com/a.mp4', proxy)).toEqual({ url: 'https://x.com/a.mp4', type: 'mp4' });
  });
});
