import type { ProxyInfo } from '../types';

/** 判断播放地址的流类型 */
export function streamType(url: string): 'm3u8' | 'flv' | 'mp4' | 'other' {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split('?')[0];
  }
  if (/\.m3u8?$/i.test(path)) return 'm3u8';
  if (/\.flv$/i.test(path)) return 'flv';
  if (/\.(mp4|m4v|webm)$/i.test(path)) return 'mp4';
  if (/\.(mkv|avi|rmvb|wmv|mov)$/i.test(path)) return 'other';
  return 'other';
}

/** 媒体地址走本地代理（解决跨域/防盗链/http 混合内容） */
export function proxyMedia(url: string, proxy: ProxyInfo | null, referer?: string): string {
  if (!proxy?.enabled || !url) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  const t = encodeURIComponent(proxy.token);
  const u = encodeURIComponent(url);
  const r = referer ? `&r=${encodeURIComponent(referer)}` : '';
  return `${proxy.base}/hls?t=${t}&u=${u}${r}`;
}

export function proxyUrl(url: string, proxy: ProxyInfo | null): string {
  if (!proxy?.enabled || !url || !/^https?:\/\//i.test(url)) return url;
  return `${proxy.base}/bin?t=${encodeURIComponent(proxy.token)}&u=${encodeURIComponent(url)}`;
}

/** 封面图走本地代理，绕过多数采集站的防盗链；w 让主进程缩放后再返回，显著减小体积 */
export function coverUrl(url: string | undefined, proxy: ProxyInfo | null, width = 0): string {
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return url;
  if (!proxy?.enabled) return url;
  const w = width > 0 ? `&w=${Math.round(width)}` : '';
  return `${proxy.base}/img?t=${encodeURIComponent(proxy.token)}&u=${encodeURIComponent(url)}${w}`;
}

/** 决定播放器使用的地址与类型 */
export function resolvePlaySource(
  rawUrl: string,
  proxy: ProxyInfo | null
): { url: string; type: 'm3u8' | 'flv' | 'mp4' | 'other' } {
  const type = streamType(rawUrl);
  if (!proxy?.enabled) return { url: rawUrl, type };
  if (type === 'm3u8' || type === 'flv') return { url: proxyMedia(rawUrl, proxy), type };
  return { url: rawUrl, type: 'mp4' };
}
