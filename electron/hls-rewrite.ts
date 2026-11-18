/**
 * HLS 播放列表改写：把 m3u8 中的所有 URI（子播放列表 / 分片 / 密钥 / init 段）
 * 重写为经过本地代理的绝对地址，解决相对路径解析、跨域与 Referer 限制。
 * 纯函数，便于单元测试。
 */

const URI_ATTR = /URI="([^"]*)"/g;

export function isPlaylistContent(url: string, contentType: string): boolean {
  if (/mpegurl/i.test(contentType)) return true;
  if (/application\/vnd\.apple\.mpegurl/i.test(contentType)) return true;
  try {
    return /\.m3u8?$/i.test(new URL(url).pathname);
  } catch {
    return /\.m3u8?(\?|$)/i.test(url);
  }
}

export function resolveUrl(uri: string, base: string): string {
  try {
    return new URL(uri, base).toString();
  } catch {
    return uri;
  }
}

/**
 * @param text      m3u8 文本
 * @param baseUrl   该播放列表自身的地址（用于解析相对路径）
 * @param proxyFor  把绝对地址包装成代理地址
 */
export function rewritePlaylist(text: string, baseUrl: string, proxyFor: (absolute: string) => string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return trimmed.replace(URI_ATTR, (_m, uri: string) => {
          if (!uri || uri.startsWith('data:') || uri.startsWith('skd:')) return _m;
          return `URI="${proxyFor(resolveUrl(uri, baseUrl))}"`;
        });
      }
      return proxyFor(resolveUrl(trimmed, baseUrl));
    })
    .join('\n');
}
