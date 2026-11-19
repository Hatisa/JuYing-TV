import type { LiveSource, Settings } from '../src/types';
import { DEFAULT_WEB_SEARCH } from '../src/lib/web-search';
import { DEFAULT_SOURCES } from '../src/lib/default-sources';

export { DEFAULT_SOURCES };

/** 当前内置源版本；升级时会把新增的内置源合并进已有数据 */
export const SOURCES_VERSION = 4;

/** 内置直播源（M3U 订阅），可在设置中禁用/删除/新增 */
export const DEFAULT_LIVE_SOURCES: LiveSource[] = [
  { key: 'iptv-cn', name: 'IPTV-org 中国', url: 'https://iptv-org.github.io/iptv/countries/cn.m3u', builtin: true, enabled: true },
  { key: 'iptv-zho', name: 'IPTV-org 中文', url: 'https://iptv-org.github.io/iptv/languages/zho.m3u', builtin: true, enabled: true },
];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  hideAdult: true,
  adult18: false,
  autoNext: true,
  autoPlay: true,
  rememberProgress: true,
  volume: 0.8,
  playbackRate: 1,
  homeSource: 'all',
  accent: 'rose',
  proxyEnabled: true,
  ai: {
    mode: 'auto',
    autoCheckin: true,
    baseUrl: '',
    apiKey: '',
    model: '',
    freeChannels: [],
  },
  webSearch: { ...DEFAULT_WEB_SEARCH },
};