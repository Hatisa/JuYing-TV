import type { MediaSummary } from '../types';

/**
 * 成人/伦理类资源的类型关键词（用于按 type_name 判定）。
 * 采集源的分类比片名可靠，因此这里的词可以宽一些；
 * 「海外剧」「海外综艺」等正常分类不会被命中（不要加入单独的「海外」）。
 */
const ADULT_TYPE =
  /伦理|情色|色情|成人|三级|三級|无码|無碼|有码|有碼|福利|写真|人妻|少妇|熟女|重口|里番|肉番|限制级|限制級|风月|艳舞|大尺度|av片|成人片|伦理片|深夜剧|海外抖音|网红主播|网黄|福利姬|探花|约炮|嫖娼|裸聊|擦边|外围女|楼凤|海角社区|麻豆|91视频|onlyfans|国产精品|成人动漫|大秀|裸舞|脱衣舞|迷奸|乱伦|淫|骚货|母狗/i;

/**
 * 片名/备注中的明确成人词。
 * 只放歧义很小的词：例如「海角七号」是正常电影，所以不能用单独的「海角」；
 * 「海外剧」是正常分类，所以不能用单独的「海外」。
 */
const ADULT_STRONG =
  /伦理片|成人片|三级片|無碼|无码|有码|里番|肉番|av女优|av女優|18禁|18\+|海外抖音|网红主播|探花|约炮|嫖娼|裸聊|福利姬|楼凤|海角社区|麻豆传媒|91视频|onlyfans|网黄|外围女|淫|骚货|母狗/i;

export function isAdultType(typeName?: string | null): boolean {
  return !!typeName && ADULT_TYPE.test(typeName);
}

export function isAdultText(text?: string | null): boolean {
  return !!text && ADULT_STRONG.test(text);
}

/** 资源是否属于成人内容：数据源被标记，或类型/片名/备注命中关键词 */
export function isAdultMedia(
  item: Pick<MediaSummary, 'name' | 'typeName' | 'isAdult' | 'remarks'>,
): boolean {
  if (item.isAdult) return true;
  if (isAdultType(item.typeName)) return true;
  return isAdultText(item.name) || isAdultText(item.remarks);
}

/** 同名聚合后的分组只要混入一条成人资源，就整组归入 18+，避免从普通搜索漏出 */
export function isAdultGroup(group: {
  items: Pick<MediaSummary, 'name' | 'typeName' | 'isAdult' | 'remarks'>[];
}): boolean {
  return group.items.some((item) => isAdultMedia(item));
}

/** 正常频道过滤成人；成人频道只保留成人 */
export function filterAdult<T extends Pick<MediaSummary, 'name' | 'typeName' | 'isAdult' | 'remarks'>>(
  items: T[],
  allowAdult: boolean,
): T[] {
  return items.filter((item) => (allowAdult ? isAdultMedia(item) : !isAdultMedia(item)));
}
