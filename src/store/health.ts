import { create } from 'zustand';
import type { HealthPayload, HealthStatus } from '../types';
import { api } from '../lib/bridge';

interface HealthStore {
  statuses: Record<string, HealthStatus>;
  checking: boolean;
  checked: number;
  total: number;
  /** 是否已从主进程拿到过状态 */
  ready: boolean;
  init: () => void;
  checkAll: (keys?: string[]) => void;
}

let started = false;

export const useHealth = create<HealthStore>((set, get) => ({
  statuses: {},
  checking: false,
  checked: 0,
  total: 0,
  ready: false,

  init: () => {
    if (started) return;
    started = true;
    const bridge = api?.health;
    if (!bridge) {
      set({ ready: true });
      return;
    }
    bridge.onChange((payload: HealthPayload) => {
      set({ statuses: payload.statuses, checking: !payload.done, checked: payload.checked, total: payload.total, ready: true });
    });
    bridge
      .list()
      .then((statuses) => {
        if (!statuses || Object.keys(statuses).length === 0) {
          set({ ready: true });
          // 首次启动没有历史：立刻检测全部
          get().checkAll();
          return;
        }
        set({ statuses, ready: true });
        const newest = Math.max(0, ...Object.values(statuses).map((s) => s.checkedAt || 0));
        if (Date.now() - newest > 10 * 60_000) get().checkAll();
      })
      .catch(() => set({ ready: true }));
  },

  checkAll: (keys?: string[]) => {
    if (get().checking) return;
    const bridge = api?.health;
    if (!bridge) return;
    set({ checking: true, checked: 0 });
    bridge
      .check(keys)
      .then((statuses) => set({ statuses, checking: false }))
      .catch(() => set({ checking: false }));
  },
}));

export function healthOf(statuses: Record<string, HealthStatus>, key: string): HealthStatus | undefined {
  return statuses[key];
}
