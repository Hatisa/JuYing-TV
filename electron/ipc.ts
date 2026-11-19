import { BrowserWindow, app, ipcMain, shell } from 'electron';
import type {
  AiChatRequest,
  AiConfig,
  AiTestResult,
  AppInfo,
  HealthStatus,
  NetRequest,
  ProxyInfo,
  WebSearchConfig,
  WebSearchResult,
} from '../src/types';
import { aiMode, isAiConfigured } from '../src/lib/ai';
import { chatCompletion, testConnection } from './ai';
import type { FreeModelService } from './free-models';
import type { HealthMonitor } from './health';
import { douban } from './douban';
import { fetchJson, fetchText, testSource } from './net';
import { searchWeb, testWebSearch } from './web-search';
import type { ProxyHandle } from './proxy';
import type { Store } from './store';

function clampTimeout(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 15000;
  return Math.min(Math.max(n, 1000), 60000);
}

/** 只允许 GET / POST，避免渲染层通过 IPC 发出任意方法 */
function cleanMethod(raw: unknown): string {
  return String(raw || '').toUpperCase() === 'POST' ? 'POST' : 'GET';
}

function cleanBody(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw.slice(0, 512 * 1024) : undefined;
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

export function registerIpc(store: Store, proxy: ProxyHandle, health: HealthMonitor, free: FreeModelService): void {
  ipcMain.handle('store:read', () => store.read());
  ipcMain.handle('store:write', (_e, key: string, value: unknown) => store.write(key as any, value));

  ipcMain.handle('net:json', async (_e, req: NetRequest) => {
    if (!req || typeof req.url !== 'string') return { ok: false, error: '参数错误' };
    return fetchJson(req.url, {
      timeoutMs: clampTimeout(req.timeoutMs),
      headers: cleanHeaders(req.headers),
      method: cleanMethod(req.method),
      body: cleanBody(req.body),
    });
  });

  ipcMain.handle('net:text', async (_e, req: NetRequest) => {
    if (!req || typeof req.url !== 'string') return { ok: false, error: '参数错误' };
    const r = await fetchText(req.url, {
      timeoutMs: clampTimeout(req.timeoutMs),
      headers: cleanHeaders(req.headers),
      method: cleanMethod(req.method),
      body: cleanBody(req.body),
    });
    return { ok: r.ok, status: r.status, text: r.text, error: r.error };
  });

  ipcMain.handle('proxy:info', (): ProxyInfo => ({ base: proxy.base, token: proxy.token, enabled: true }));
  ipcMain.handle('source:test', (_e, url: string) => testSource(String(url || '')));

  ipcMain.handle('douban:ratings', async (_e, titles?: string[]) => {
    const list = Array.isArray(titles) ? titles.filter((t) => typeof t === 'string').slice(0, 60) : [];
    return douban.ratings(list);
  });
  ipcMain.handle('douban:top', async (_e, limit?: number) => douban.top(Number(limit) || 18));

  ipcMain.handle('ai:chat', async (_e, req: AiChatRequest) => {
    const saved = store.read().settings.ai;
    const config = req?.config || saved;
    // auto 模式优先走免费池；旧配置没有 mode 时按是否填过地址判断
    if (aiMode(config) === 'auto') {
      if (!req || !Array.isArray(req.messages)) return { ok: false, error: '请求格式不正确' };
      return free.chat(req.messages);
    }
    return chatCompletion(req, saved);
  });
  ipcMain.handle('ai:test', async (_e, config?: AiConfig): Promise<AiTestResult> => {
    const saved = store.read().settings.ai;
    const target = config || saved;
    if (aiMode(target) === 'auto') {
      const status = free.status();
      return {
        ok: status.available > 0,
        model: '免费 Auto · ' + status.available + '/' + status.models.length + ' 可用',
        error: status.available > 0 ? undefined : '免费模型暂不可用，请点击“一键检测全部免费模型”',
        ms: 0,
      };
    }
    if (!isAiConfigured(target)) return { ok: false, error: '请先填写 API 地址与模型' };
    return testConnection(target);
  });
  ipcMain.handle('websearch:query', async (_e, query: string, config?: WebSearchConfig): Promise<WebSearchResult> => {
    const saved = store.read().settings.webSearch;
    const merged = { ...saved, ...(config || {}) };
    if (!merged.enabled) {
      return { ok: false, provider: merged.provider || 'duckduckgo', query: String(query || ''), results: [], error: '联网搜索未开启', ms: 0 };
    }
    return searchWeb(String(query || ''), merged);
  });
  ipcMain.handle('websearch:test', async (_e, config?: WebSearchConfig) => {
    const saved = store.read().settings.webSearch;
    return testWebSearch({ ...saved, ...(config || {}), enabled: true });
  });

  ipcMain.handle('ai:free-status', () => free.status());
  ipcMain.handle('ai:free-checkin', () => free.checkin());
  ipcMain.handle('ai:free-test', () => free.test());
  ipcMain.handle('ai:free-sync', () => free.sync());

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