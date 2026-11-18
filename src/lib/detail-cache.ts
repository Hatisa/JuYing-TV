import type { MediaDetail, SourceConfig } from '../types';
import { fetchDetail } from './api';

const TTL = 5 * 60_000;
const cache = new Map<string, { at: number; value?: MediaDetail; promise?: Promise<MediaDetail> }>();

export function detailKey(sourceKey: string, vodId: string): string {
  return `${sourceKey}:${vodId}`;
}

/** 详情页/播放页共享缓存，避免来回跳转重复请求 */
export async function loadDetail(source: SourceConfig, vodId: string, force = false): Promise<MediaDetail> {
  const key = detailKey(source.key, vodId);
  const hit = cache.get(key);
  if (!force && hit?.value && Date.now() - hit.at < TTL) return hit.value;
  if (!force && hit?.promise) return hit.promise;

  const promise = fetchDetail(source, vodId)
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

export function peekDetail(sourceKey: string, vodId: string): MediaDetail | undefined {
  return cache.get(detailKey(sourceKey, vodId))?.value;
}
