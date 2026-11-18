const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', shy: '',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ndash: '–', mdash: '—', hellip: '…', middot: '·', bull: '•',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', laquo: '«', raquo: '»',
  copy: '©', reg: '®', trade: '™', times: '×', divide: '÷', deg: '°',
  prime: '′', Prime: '″',
};

/** 解码采集接口里常见的 HTML 实体（&nbsp; / &amp; / &#39; 等） */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (matched, code: string) => {
    if (code[0] === '#') {
      const hex = code[1]?.toLowerCase() === 'x';
      const value = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      try {
        return Number.isFinite(value) ? String.fromCodePoint(value) : matched;
      } catch {
        return matched;
      }
    }
    return HTML_ENTITIES[code] ?? HTML_ENTITIES[code.toLowerCase()] ?? matched;
  });
}

/**
 * 清洗影视简介：去掉 HTML 标签，解码 &nbsp; 等实体，压缩空白。
 * 采集源经常返回双重转义（&amp;nbsp;），因此最多连续解码三次。
 */
export function cleanDescription(input: string | null | undefined): string {
  let text = String(input ?? '');
  for (let i = 0; i < 3; i += 1) {
    const decoded = decodeHtmlEntities(text);
    if (decoded === text) break;
    text = decoded;
  }
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 去掉标点/空格/季集信息，用于「同名聚合」 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s·:：,，.。!！?？'"“”‘’()（）\[\]【】\-—_/\\|]/g, '')
    .replace(/(第[一二三四五六七八九十\d]+[季部集期])/g, '')
    .replace(/(s\d{1,2}e\d{1,2})/gi, '')
    .replace(/(hd|bd|tc|ts|4k|1080p|720p|国语|粤语|中字|高清|抢先版|正片|预告)/gi, '');
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function progressPercent(position: number, duration: number): number {
  if (!duration || !Number.isFinite(duration)) return 0;
  return Math.min(100, Math.max(0, (position / duration) * 100));
}

export function seasonEpisodeLabel(name: string, index: number): string {
  const trimmed = name.trim();
  return trimmed || `第 ${index + 1} 集`;
}
