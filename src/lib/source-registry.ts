import type { SourceConfig } from '../types';

/**
 * 渲染层内的数据源快照。
 * 桌面端的健康检测在主进程完成；移动端没有主进程，健康检测需要知道当前启用源，
 * 由 store/app.ts 在 sources 变化时写入这里，避免 bridge 与 store 循环依赖。
 */
let healthSources: SourceConfig[] = [];

export function setHealthSources(sources: SourceConfig[]): void {
  healthSources = Array.isArray(sources) ? sources : [];
}

export function getHealthSources(): SourceConfig[] {
  return healthSources.filter((s) => s.enabled !== false);
}
