import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import { HealthMonitor } from './health';
import { registerIpc } from './ipc';
import { startMediaProxy, type ProxyHandle } from './proxy';
import { Store } from './store';

app.setName('JuYingTV');
if (process.platform === 'win32') app.setAppUserModelId('com.juying.tv');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 端到端测试可指定独立 profile，避免与用户正在运行的实例争抢缓存锁。
const userDataOverride = process.env.JUYING_USER_DATA_DIR?.trim();
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride));

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let win: BrowserWindow | null = null;
let proxy: ProxyHandle | null = null;
let store: Store | null = null;
let health: HealthMonitor | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#08090c',
    title: '聚影 TV',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win?.show());
  win.on('maximize', () => win?.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false));
  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const current = win?.webContents.getURL() || '';
    if (url !== current) event.preventDefault();
  });

  // 禁用右键菜单中的无关项，保留复制/粘贴等默认行为
  win.webContents.on('context-menu', (_e, params) => {
    if (params.selectionText) win?.webContents.copy();
  });

  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  store = new Store();
  proxy = await startMediaProxy({ cacheDir: path.join(app.getPath('userData'), 'cache', 'img') });
  health = new HealthMonitor(
    () => store?.read().sources ?? [],
    (statuses) => store?.write('health', statuses)
  );
  health.seed(store.read().health);
  registerIpc(store, proxy, health);
  createWindow();
  health.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  health?.stop();
  store?.flush();
  proxy?.close();
});
