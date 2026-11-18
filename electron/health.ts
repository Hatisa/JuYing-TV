import { BrowserWindow } from 'electron';
import type { HealthPayload, HealthStatus, SourceConfig } from '../src/types';
import { SEARCH_TIMEOUT_MS, testSource } from './net';

/** 超过该耗时视为「较慢」 */
const SLOW_MS = 4000;
/** 同时探测的源数量：兼顾速度与对源站的压力 */
const CONCURRENCY = 4;
/** 自动巡检周期 */
export const CHECK_INTERVAL_MS = 4 * 60_000;

export class HealthMonitor {
  private statuses = new Map<string, HealthStatus>();
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private total = 0;
  private checked = 0;
  private waiters: (() => void)[] = [];

  constructor(
    private readonly getSources: () => SourceConfig[],
    private readonly onPersist?: (statuses: Record<string, HealthStatus>) => void
  ) {}

  /** 用上次持久化的结果恢复初始状态（把残留的 checking 归为 unknown） */
  seed(seed: Record<string, HealthStatus> | undefined): void {
    if (!seed || typeof seed !== 'object') return;
    for (const [key, item] of Object.entries(seed)) {
      if (!item || typeof item !== 'object') continue;
      this.statuses.set(key, {
        key,
        name: String(item.name || key),
        state: item.state === 'checking' ? 'unknown' : item.state || 'unknown',
        ok: !!item.ok,
        ms: Number(item.ms) || 0,
        count: item.count,
        error: item.error,
        checkedAt: Number(item.checkedAt) || 0,
        failStreak: Number(item.failStreak) || 0,
      });
    }
  }

  list(): Record<string, HealthStatus> {
    const out: Record<string, HealthStatus> = {};
    for (const [key, item] of this.statuses) out[key] = { ...item };
    return out;
  }

  isRunning(): boolean {
    return this.running;
  }

  get(key: string): HealthStatus | undefined {
    const item = this.statuses.get(key);
    return item ? { ...item } : undefined;
  }

  private payload(done: boolean): HealthPayload {
    return { statuses: this.list(), done, checked: this.checked, total: this.total };
  }

  private emit(done: boolean): void {
    const payload = this.payload(done);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('health:update', payload);
    }
  }

  /** 结束时的等待者（并发调用去重） */
  private settle(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const fn of waiters) fn();
  }

  /**
   * 启动自动巡检。首次检测延迟 initialDelayMs，避免和首页首批请求抢带宽
   * （22 个源同时探测会让首屏变慢，用户体感是「打开很慢」）。
   */
  start(intervalMs = CHECK_INTERVAL_MS, initialDelayMs = 12_000): void {
    if (this.timer) return;
    const kick = () => {
      this.bootTimer = null;
      void this.checkAll();
    };
    const newest = [...this.statuses.values()].reduce((max, s) => Math.max(max, s.checkedAt || 0), 0);
    if (Date.now() - newest < intervalMs) {
      // 上次巡检结果还新鲜：本轮启动不再补测，避免和首屏请求抢带宽
      initialDelayMs = 0;
    }
    if (initialDelayMs > 0) {
      this.bootTimer = setTimeout(kick, initialDelayMs);
      if (typeof (this.bootTimer as any).unref === 'function') (this.bootTimer as any).unref();
    } else {
      kick();
    }
    this.timer = setInterval(() => void this.checkAll(), intervalMs);
    if (typeof (this.timer as any).unref === 'function') (this.timer as any).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.timer = null;
    this.bootTimer = null;
  }

  /**
   * 检测全部源（或指定源）。检测过程中通过 health:update 事件逐条推送，
   * 已有一轮在跑时直接返回当前状态。
   */
  async checkAll(keys?: string[]): Promise<Record<string, HealthStatus>> {
    if (this.running) {
      // 已有一轮在跑：等它结束再返回完整结果，避免调用方拿到半成品
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      return this.list();
    }

    const wanted = keys && keys.length > 0 ? new Set(keys) : null;
    const targets = this.getSources().filter((s) => (wanted ? wanted.has(s.key) : true));
    if (targets.length === 0) return this.list();

    this.running = true;
    this.total = targets.length;
    this.checked = 0;
    this.emit(false);

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        const source = targets[cursor++];
        await this.checkOne(source);
        this.checked += 1;
        this.emit(false);
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));
    } finally {
      this.running = false;
      this.total = 0;
      this.checked = 0;
      this.emit(true);
      this.onPersist?.(this.list());
      this.settle();
    }
    return this.list();
  }

  private async checkOne(source: SourceConfig): Promise<void> {
    const prev = this.statuses.get(source.key);
    this.statuses.set(source.key, {
      key: source.key,
      name: source.name,
      state: 'checking',
      ok: prev?.ok ?? false,
      ms: prev?.ms ?? 0,
      count: prev?.count,
      error: prev?.error,
      checkedAt: prev?.checkedAt ?? 0,
      failStreak: prev?.failStreak ?? 0,
    });
    this.emit(this.running);

    const result = await testSource(source.url, SEARCH_TIMEOUT_MS);
    const failStreak = result.ok ? 0 : (prev?.failStreak ?? 0) + 1;
    this.statuses.set(source.key, {
      key: source.key,
      name: source.name,
      state: result.ok ? (result.ms >= SLOW_MS ? 'slow' : 'online') : 'offline',
      ok: result.ok,
      ms: result.ms,
      count: result.count,
      error: result.ok ? undefined : result.error,
      checkedAt: Date.now(),
      failStreak,
    });
  }
}
