import type { HealthState, HealthStatus } from '../types';

/** 超过该耗时视为「较慢」 */
export const SLOW_MS = 4000;
/** 搜索/首页请求的基准超时 */
export const BASE_TIMEOUT_MS = 8000;

export interface HealthSummary {
  online: number;
  slow: number;
  offline: number;
  unknown: number;
  total: number;
}

export function summarize(statuses: Record<string, HealthStatus>, keys?: string[]): HealthSummary {
  const list = keys ? keys.map((k) => statuses[k]).filter(Boolean) : Object.values(statuses);
  const summary: HealthSummary = { online: 0, slow: 0, offline: 0, unknown: 0, total: list.length };
  for (const item of list) {
    if (!item || item.state === 'checking') summary.unknown += 1;
    else if (item.state === 'online') summary.online += 1;
    else if (item.state === 'slow') summary.slow += 1;
    else if (item.state === 'offline') summary.offline += 1;
    else summary.unknown += 1;
  }
  return summary;
}

export function stateLabel(state: HealthState | undefined): string {
  switch (state) {
    case 'online':
      return '在线';
    case 'slow':
      return '较慢';
    case 'offline':
      return '离线';
    case 'checking':
      return '检测中';
    default:
      return '未检测';
  }
}

export function stateColor(state: HealthState | undefined): string {
  switch (state) {
    case 'online':
      return '#22c55e';
    case 'slow':
      return '#f59e0b';
    case 'offline':
      return '#ef4444';
    case 'checking':
      return '#38bdf8';
    default:
      return '#64748b';
  }
}

/** 排序权重：可用的源排在前面，离线源最后 */
export function healthRank(state: HealthState | undefined): number {
  switch (state) {
    case 'online':
      return 0;
    case 'slow':
      return 1;
    case 'checking':
    case 'unknown':
    case undefined:
      return 2;
    case 'offline':
      return 3;
    default:
      return 2;
  }
}

/** 稳定排序：同权重保持原顺序 */
export function sortByHealth<T extends { key: string }>(sources: T[], statuses: Record<string, HealthStatus>): T[] {
  return sources
    .map((source, index) => ({ source, index, rank: healthRank(statuses[source.key]?.state) }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((x) => x.source);
}

/** 按历史健康度决定单源超时：离线源快速失败，慢源多给一点时间 */
export function timeoutForSource(state: HealthState | undefined, base = BASE_TIMEOUT_MS): number {
  switch (state) {
    case 'offline':
      return Math.min(base, 3500);
    case 'slow':
      return Math.max(base, 12000);
    case 'online':
      return base;
    default:
      return base;
  }
}

export function formatMs(ms: number | undefined): string {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

export function relativeTime(ts: number | undefined, now = Date.now()): string {
  if (!ts) return '未检测';
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}
