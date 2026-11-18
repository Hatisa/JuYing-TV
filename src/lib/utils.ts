/** 交错合并多组数据，让首页/搜索结果的来源更均衡 */
export function interleave<T>(groups: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < max; i += 1) {
    for (const g of groups) {
      if (i < g.length) out.push(g[i]);
    }
  }
  return out;
}

export function groupBy<T>(items: T[], keyOf: (item: T) => string): { key: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map.entries()).map(([key, list]) => ({ key, items: list }));
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
