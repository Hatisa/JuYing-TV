import { BrowserWindow, app, ipcMain, shell } from 'electron';
import type { AppInfo, HealthStatus, NetRequest, ProxyInfo } from '../src/types';
import type { HealthMonitor } from './health';
import { douban } from './douban';
import { fetchJson, fetchText, testSource } from './net';
import type { ProxyHandle } from './proxy';
import type { Store } from './store';

function clampTimeout(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 15000;
  return Math.min(Math.max(n, 1000), 60000);
}

function cleanHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && k.length < 64 && v.length < 2048) out[k] = v;
    }
  }
  return out;
}

export function registerIpc(store: Store, proxy: ProxyHandle, health: HealthMonitor): void {
  ipcMain.handle('store:read', () => store.read());
  ipcMain.handle('store:write', (_e, key: string, value: unknown) => store.write(key as any, value));

  ipcMain.handle('net:json', async (_e, req: NetRequest) => {
    if (!req || typeof req.url !== 'string') return { ok: false, error: '参数错误' };
    return fetchJson(req.url, { timeoutMs: clampTimeout(req.timeoutMs), headers: cleanHeaders(req.headers) });
  });

  ipcMain.handle('net:text', async (_e, req: NetRequest) => {
    if (!req || typeof req.url !== 'string') return { ok: false, error: '参数错误' };
    const r = await fetchText(req.url, { timeoutMs: clampTimeout(req.timeoutMs), headers: cleanHeaders(req.headers) });
    return { ok: r.ok, status: r.status, text: r.text, error: r.error };
  });

  ipcMain.handle('proxy:info', (): ProxyInfo => ({ base: proxy.base, token: proxy.token, enabled: true }));
  ipcMain.handle('source:test', (_e, url: string) => testSource(String(url || '')));

  ipcMain.handle('douban:ratings', async (_e, titles?: string[]) => {
    const list = Array.isArray(titles) ? titles.filter((t) => typeof t === 'string').slice(0, 60) : [];
    return douban.ratings(list);
  });
  ipcMain.handle('douban:top', async (_e, limit?: number) => douban.top(Number(limit) || 18));

  ipcMain.handle('health:list', (): Record<string, HealthStatus> => health.list());
  ipcMain.handle('health:check', async (_e, keys?: string[]) => {
    const list = Array.isArray(keys) ? keys.filter((k) => typeof k === 'string').slice(0, 200) : undefined;
    return health.checkAll(list);
  });

  ipcMain.handle('app:info', (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    userData: app.getPath('userData'),
  }));

  ipcMain.handle('app:open', async (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url);
  });
  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.handle('window:toggle-maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
}
