import { describe, expect, it } from 'vitest';
import {
  formatMs,
  healthRank,
  relativeTime,
  sortByHealth,
  stateColor,
  stateLabel,
  summarize,
  timeoutForSource,
} from '../src/lib/health';
import type { HealthStatus } from '../src/types';

function status(key: string, state: HealthStatus['state'], ms = 100): HealthStatus {
  return { key, name: key, state, ok: state === 'online' || state === 'slow', ms, checkedAt: Date.now(), failStreak: state === 'offline' ? 2 : 0 };
}

const statuses: Record<string, HealthStatus> = {
  a: status('a', 'offline', 3000),
  b: status('b', 'online', 220),
  c: status('c', 'slow', 5200),
  d: status('d', 'unknown'),
};

describe('summarize', () => {
  it('统计各状态数量', () => {
    expect(summarize(statuses)).toEqual({ online: 1, slow: 1, offline: 1, unknown: 1, total: 4 });
  });

  it('按 keys 过滤，checking 计入未检测', () => {
    const withChecking = { ...statuses, e: status('e', 'checking') };
    expect(summarize(withChecking, ['a', 'b', 'e'])).toEqual({ online: 1, slow: 0, offline: 1, unknown: 1, total: 3 });
  });

  it('空状态', () => {
    expect(summarize({})).toEqual({ online: 0, slow: 0, offline: 0, unknown: 0, total: 0 });
  });
});

describe('状态展示', () => {
  it('label 与颜色', () => {
    expect(stateLabel('online')).toBe('在线');
    expect(stateLabel('slow')).toBe('较慢');
    expect(stateLabel('offline')).toBe('离线');
    expect(stateLabel('checking')).toBe('检测中');
    expect(stateLabel(undefined)).toBe('未检测');
    expect(stateColor('online')).toBe('#22c55e');
    expect(stateColor('offline')).toBe('#ef4444');
  });

  it('formatMs', () => {
    expect(formatMs(0)).toBe('—');
    expect(formatMs(320)).toBe('320ms');
    expect(formatMs(1500)).toBe('1.5s');
    expect(formatMs(12500)).toBe('13s');
  });

  it('relativeTime', () => {
    const now = Date.now();
    expect(relativeTime(0, now)).toBe('未检测');
    expect(relativeTime(now - 20_000, now)).toBe('刚刚');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 小时前');
    expect(relativeTime(now - 2 * 86400_000, now)).toBe('2 天前');
  });
});

describe('健康度排序与超时', () => {
  it('可用的源排在前面，同权重保持原顺序', () => {
    const list = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }, { key: 'x' }];
    expect(sortByHealth(list, statuses).map((s) => s.key)).toEqual(['b', 'c', 'd', 'x', 'a']);
  });

  it('healthRank 覆盖全部状态', () => {
    expect(healthRank('online')).toBe(0);
    expect(healthRank('slow')).toBe(1);
    expect(healthRank('unknown')).toBe(2);
    expect(healthRank(undefined)).toBe(2);
    expect(healthRank('offline')).toBe(3);
  });

  it('离线源快速失败，慢源放宽', () => {
    expect(timeoutForSource('offline', 8000)).toBe(3500);
    expect(timeoutForSource('slow', 8000)).toBe(12000);
    expect(timeoutForSource('online', 8000)).toBe(8000);
    expect(timeoutForSource(undefined, 6000)).toBe(6000);
  });
});
