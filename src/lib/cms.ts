import type { MediaDetail, MediaSummary, PlayLine, SourceConfig } from '../types';
import { cleanDescription, decodeHtmlEntities } from './format';

/** 构建苹果CMS 请求地址 */
export function searchUrl(source: SourceConfig, wd: string, page = 1): string {
  const base = source.url.replace(/\/+$/, '');
  return `${base}?ac=videolist&wd=${encodeURIComponent(wd)}&pg=${page}`;
}

export function latestUrl(source: SourceConfig, page = 1): string {
  const base = source.url.replace(/\/+$/, '');
  return `${base}?ac=videolist&pg=${page}`;
}

export function detailUrl(source: SourceConfig, vodId: string): string {
  const base = source.url.replace(/\/+$/, '');
  return `${base}?ac=detail&ids=${encodeURIComponent(vodId)}`;
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const s = v.trim();
    return s || undefined;
  }
  if (typeof v === 'number') return String(v);
  return undefined;
}

/** 文本字段统一解码实体并压缩空白（片名/类型/备注/封面 URL 常见 &nbsp; 与 &amp;） */
function text(v: unknown): string | undefined {
  const s = str(v);
  return s ? decodeHtmlEntities(s).replace(/\s+/g, ' ').trim() || undefined : undefined;
}

export interface ParsedList {
  list: MediaSummary[];
  page: number;
  pageCount: number;
  total: number;
}

/** 解析搜索/列表响应 */
export function parseList(data: any, source: SourceConfig): ParsedList {
  if (!data || typeof data !== 'object') throw new Error('接口返回格式无效');
  const raw = (data as any).list;
  if (raw !== null && raw !== undefined && !Array.isArray(raw)) throw new Error('接口返回格式无效');
  const items: MediaSummary[] = (Array.isArray(raw) ? raw : [])
    .map((it: any) => ({
      sourceKey: source.key,
      sourceName: source.name,
      vodId: String(it?.vod_id ?? ''),
      name: text(it?.vod_name) ?? '',
      pic: text(it?.vod_pic),
      typeName: text(it?.type_name),
      year: text(it?.vod_year),
      area: text(it?.vod_area),
      remarks: text(it?.vod_remarks),
      isAdult: source.isAdult,
    }))
    .filter((it: MediaSummary) => it.vodId && it.name);
  const pageCount = Math.max(1, parseInt(String((data as any).pagecount ?? '1'), 10) || 1);
  const page = parseInt(String((data as any).page ?? '1'), 10) || 1;
  const total = parseInt(String((data as any).total ?? '0'), 10) || 0;
  return { list: items, page, pageCount, total };
}

const M3U8_PATTERN = /https?:\/\/[^"'\s\\]+?\.m3u8[^"'\s\\]*/g;

function isPlayableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && !/\/share\//i.test(url);
}

/**
 * 解析 vod_play_url：格式 「线路名$$$线路名」，每条线路内「集名$地址#集名$地址」。
 * 优先保留包含 m3u8 直链的线路；同名线路去重。
 */
export function parseLines(playFrom: string | undefined, playUrl: string | undefined): PlayLine[] {
  if (!playUrl) return [];
  const froms = (playFrom || '').split('$$$');
  const groups = playUrl.split('$$$');
  const lines: PlayLine[] = [];

  groups.forEach((group, gi) => {
    const episodes = group
      .split('#')
      .map((ep, ei) => {
        const idx = ep.indexOf('$');
        const name = idx >= 0 ? ep.slice(0, idx) : `第${ei + 1}集`;
        const url = idx >= 0 ? ep.slice(idx + 1) : ep;
        return { name: name.trim() || `第${ei + 1}集`, url: (url || '').trim() };
      })
      .filter((ep) => /^https?:\/\//i.test(ep.url));

    if (episodes.length === 0) return;
    const name = (froms[gi] || `线路${gi + 1}`).trim();
    lines.push({ name, episodes });
  });

  if (lines.length === 0) return [];
  // 有直链线路时，丢弃纯中转页线路（不可直接播放）
  const direct = lines.filter((l) => l.episodes.some((e) => isPlayableUrl(e.url)));
  const usable = direct.length > 0 ? direct : lines;
  // 同名线路只保留第一条
  const seen = new Set<string>();
  return usable.filter((l) => {
    if (seen.has(l.name)) return false;
    seen.add(l.name);
    return true;
  });
}

/** 解析详情响应 */
export function parseDetail(data: any, source: SourceConfig): MediaDetail {
  const list = (data as any)?.list;
  if (!Array.isArray(list) || list.length === 0) throw new Error('未获取到影片详情');
  const vod = list[0];
  let lines = parseLines(str(vod?.vod_play_from), str(vod?.vod_play_url));
  if (lines.length === 0 && typeof vod?.vod_content === 'string') {
    const found = vod.vod_content.match(M3U8_PATTERN) || [];
    const uniq = Array.from(new Set<string>(found as string[]));
    if (uniq.length > 0) {
      lines = [{ name: '默认线路', episodes: uniq.map((u, i) => ({ name: `第${i + 1}集`, url: u })) }];
    }
  }
  return {
    line: lines,
    info: {
      title: text(vod?.vod_name),
      cover: text(vod?.vod_pic),
      desc: cleanDescription(str(vod?.vod_content)) || undefined,
      typeName: text(vod?.type_name),
      year: text(vod?.vod_year),
      area: text(vod?.vod_area),
      director: text(vod?.vod_director),
      actor: text(vod?.vod_actor),
      remarks: text(vod?.vod_remarks),
      sourceKey: source.key,
      sourceName: source.name,
      sourceUrl: source.url,
    },
  };
}

/** 从任意网页内容中提取 m3u8 直链（用于中转页兜底） */
export function extractM3u8(text: string): string | null {
  // 部分播放页会把斜杠转义成 \/ ，先还原再提取
  const found = text.replace(/\\\//g, '/').match(M3U8_PATTERN);
  if (!found) return null;
  const cleaned = found.map((u) => u.replace(/\\\//g, '/').replace(/^["']|["']$/g, ''));
  return cleaned.find((u) => u.includes('.m3u8')) || null;
}

/** 相同影片去重（同名不同源只保留一条，聚合到 detail 页再换源） */
export function dedupeByTitle(items: MediaSummary[]): MediaSummary[] {
  const seen = new Set<string>();
  const out: MediaSummary[] = [];
  for (const item of items) {
    const key = item.name.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
