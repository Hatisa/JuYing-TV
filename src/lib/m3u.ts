/** 解析 M3U / M3U8 直播订阅 */
export interface LiveChannel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string;
  tvgId?: string;
}

const ATTR = /([a-zA-Z0-9-]+)="([^"]*)"/g;

export function parseM3U(text: string): LiveChannel[] {
  const lines = text.split(/\r?\n/);
  const channels: LiveChannel[] = [];
  let pending: { name: string; attrs: Record<string, string> } | null = null;
  let index = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const comma = findNameComma(line);
      const meta = comma >= 0 ? line.slice(0, comma) : line;
      const name = comma >= 0 ? line.slice(comma + 1).trim() : '';
      const attrs: Record<string, string> = {};
      let m: RegExpExecArray | null;
      ATTR.lastIndex = 0;
      while ((m = ATTR.exec(meta))) attrs[m[1].toLowerCase()] = m[2];
      pending = { name: name || attrs['tvg-name'] || `频道 ${index + 1}`, attrs };
      continue;
    }
    if (line.startsWith('#')) continue;
    if (!pending) continue;
    if (!/^[a-z0-9+.-]+:/i.test(line)) {
      pending = null;
      continue;
    }
    index += 1;
    channels.push({
      id: `ch_${index}_${pending.name}`,
      name: pending.name,
      url: line,
      logo: pending.attrs['tvg-logo'] || undefined,
      group: pending.attrs['group-title']?.trim() || '未分组',
      tvgId: pending.attrs['tvg-id'],
    });
    pending = null;
  }
  return channels;
}

/** 找到 EXTINF 中分隔频道名的逗号（忽略引号内的逗号） */
function findNameComma(line: string): number {
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ',' && !inQuote) return i;
  }
  return -1;
}
