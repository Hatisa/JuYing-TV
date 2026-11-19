import { contextBridge, ipcRenderer } from 'electron';
import type { AppBridge } from '../src/types';

const api: AppBridge = {
  store: {
    read: () => ipcRenderer.invoke('store:read'),
    write: (key, value) => ipcRenderer.invoke('store:write', key, value),
  },
  net: {
    json: (req) => ipcRenderer.invoke('net:json', req),
    text: (req) => ipcRenderer.invoke('net:text', req),
  },
  proxy: { info: () => ipcRenderer.invoke('proxy:info') },
  source: { test: (url) => ipcRenderer.invoke('source:test', url) },
  health: {
    list: () => ipcRenderer.invoke('health:list'),
    check: (keys) => ipcRenderer.invoke('health:check', keys),
    onChange: (cb) => {
      const handler = (_e: unknown, payload: any) => cb(payload);
      ipcRenderer.on('health:update', handler);
      return () => ipcRenderer.removeListener('health:update', handler);
    },
  },
  douban: {
    ratings: (titles) => ipcRenderer.invoke('douban:ratings', titles),
    top: (limit) => ipcRenderer.invoke('douban:top', limit),
  },
  websearch: {
    query: (query, config) => ipcRenderer.invoke('websearch:query', query, config),
    test: (config) => ipcRenderer.invoke('websearch:test', config),
  },
  ai: {
    chat: (req) => ipcRenderer.invoke('ai:chat', req),
    test: (config) => ipcRenderer.invoke('ai:test', config),
    free: {
      status: () => ipcRenderer.invoke('ai:free-status'),
      checkin: () => ipcRenderer.invoke('ai:free-checkin'),
      test: () => ipcRenderer.invoke('ai:free-test'),
      sync: () => ipcRenderer.invoke('ai:free-sync'),
      onChange: (cb) => {
        const handler = (_e: unknown, payload: any) => cb(payload);
        ipcRenderer.on('ai:free-update', handler);
        return () => ipcRenderer.removeListener('ai:free-update', handler);
      },
    },
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openExternal: (url) => ipcRenderer.invoke('app:open', url),
    quit: () => ipcRenderer.invoke('app:quit'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    onMaximizedChange: (cb) => {
      const handler = (_e: unknown, maximized: boolean) => cb(maximized);
      ipcRenderer.on('window:maximized', handler);
      return () => ipcRenderer.removeListener('window:maximized', handler);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);