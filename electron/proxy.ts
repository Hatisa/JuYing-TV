import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { nativeImage } from 'electron';
import { isPlaylistContent, rewritePlaylist } from './hls-rewrite';
import { DEFAULT_HEADERS } from './net';

/**
 * 本地媒体代理：
 * - /hls  播放列表（自动改写 URI）与二进制分片
 * - /bin  直链媒体（支持 Range，用于 FLV / MP4 兜底）
 * - /img  封面图（绕过防盗链 + 磁盘缓存 + 按 ?w= 缩放）
 * 只监听 127.0.0.1，且要求启动时生成的随机 token。
 */

const CONNECT_TIMEOUT_MS = 20000;
const IMG_CACHE = 'public, max-age=86400';
const IMG_FILE_MAX = 15 * 1024 * 1024;
const IMG_DISK_MAX_AGE = 7 * 24 * 3600 * 1000;
const IMG_DISK_MAX_BYTES = 300 * 1024 * 1024;

export interface ProxyHandle {
  base: string;
  token: string;
  close: () => void;
}

export interface ProxyOptions {
  /** 图片磁盘缓存目录（通常是 userData/cache/img）；不传则禁用磁盘缓存 */
  cacheDir?: string;
}

function cors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, X-Img-Cache');
}

function fail(res: http.ServerResponse, status: number, message: string): void {
  cors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
}

function sniffImage(buf: Buffer): string {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length > 6 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

/** 把原始图片按宽度缩放成 JPEG（体积通常降到 1/5），无法识别时原样返回 */
function resizeImage(buf: Buffer, width: number, type: string): { buf: Buffer; type: string } {
  if (!width || type === 'image/gif') return { buf, type: type || sniffImage(buf) };
  try {
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return { buf, type: type || sniffImage(buf) };
    const size = img.getSize();
    if (!size.width || size.width <= width) return { buf, type: type || sniffImage(buf) };
    const out = img.resize({ width, quality: 'better' }).toJPEG(82);
    if (!out.length) return { buf, type: type || sniffImage(buf) };
    return { buf: out, type: 'image/jpeg' };
  } catch {
    return { buf, type: type || sniffImage(buf) };
  }
}

function cacheKey(url: string, width: number): string {
  return crypto.createHash('sha1').update(url + '|' + width).digest('hex');
}

function fileOf(dir: string, key: string): string {
  return path.join(dir, key + '.img');
}

async function readCache(dir: string, key: string): Promise<Buffer | null> {
  const file = fileOf(dir, key);
  try {
    const stat = await fs.promises.stat(file);
    if (Date.now() - stat.mtimeMs > IMG_DISK_MAX_AGE) {
      void fs.promises.unlink(file).catch(() => {});
      return null;
    }
    return await fs.promises.readFile(file);
  } catch {
    return null;
  }
}

async function writeCache(dir: string, key: string, buf: Buffer): Promise<void> {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = fileOf(dir, key) + '.tmp';
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.rename(tmp, fileOf(dir, key));
  } catch {
    /* 缓存失败不影响播放 */
  }
}

/** 启动时清理过期/超量缓存，避免长期占用磁盘 */
export async function trimImageCache(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  const files: { file: string; at: number; size: number }[] = [];
  await Promise.all(
    entries.map(async (name) => {
      const file = path.join(dir, name);
      try {
        const stat = await fs.promises.stat(file);
        if (!stat.isFile()) return;
        if (Date.now() - stat.mtimeMs > IMG_DISK_MAX_AGE) {
          await fs.promises.unlink(file).catch(() => {});
          return;
        }
        files.push({ file, at: stat.mtimeMs, size: stat.size });
      } catch {
        /* ignore */
      }
    })
  );
  let total = files.reduce((sum, f) => sum + f.size, 0);
  if (total <= IMG_DISK_MAX_BYTES) return;
  files.sort((a, b) => a.at - b.at);
  for (const f of files) {
    if (total <= IMG_DISK_MAX_BYTES * 0.8) break;
    try {
      await fs.promises.unlink(f.file);
      total -= f.size;
    } catch {
      /* ignore */
    }
  }
}

async function serveImage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  target: URL,
  width: number,
  headers: Record<string, string>,
  cacheDir: string | null
): Promise<void> {
  const key = cacheKey(target.toString(), width);
  const cached = cacheDir ? await readCache(cacheDir, key) : null;
  if (cached) {
    res.statusCode = 200;
    res.setHeader('Content-Type', sniffImage(cached));
    res.setHeader('Cache-Control', IMG_CACHE);
    res.setHeader('Content-Length', String(cached.length));
    res.setHeader('X-Img-Cache', 'hit');
    res.end(req.method === 'HEAD' ? undefined : cached);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(target, { headers, signal: controller.signal, redirect: 'follow' });
  } catch (err: any) {
    clearTimeout(timer);
    const aborted = err?.name === 'AbortError';
    return fail(res, aborted ? 504 : 502, aborted ? 'Upstream timeout' : `Upstream error: ${err?.message || err}`);
  }
  clearTimeout(timer);

  if (!upstream.ok && upstream.status !== 206) {
    return fail(res, upstream.status === 403 ? 403 : 502, `Upstream HTTP ${upstream.status}`);
  }

  const type = upstream.headers.get('content-type') || '';
  const length = Number(upstream.headers.get('content-length') || 0);
  if (length > IMG_FILE_MAX) return fail(res, 502, 'Image too large');

  let raw: Buffer;
  try {
    raw = Buffer.from(await upstream.arrayBuffer());
  } catch (err: any) {
    return fail(res, 502, `Upstream read error: ${err?.message || err}`);
  }
  if (raw.length === 0) return fail(res, 502, 'Empty image');
  if (raw.length > IMG_FILE_MAX) return fail(res, 502, 'Image too large');

  const out = resizeImage(raw, width, type);
  if (cacheDir) await writeCache(cacheDir, key, out.buf);

  res.statusCode = 200;
  res.setHeader('Content-Type', out.type);
  res.setHeader('Cache-Control', IMG_CACHE);
  res.setHeader('Content-Length', String(out.buf.length));
  res.setHeader('X-Img-Cache', 'miss');
  res.end(req.method === 'HEAD' ? undefined : out.buf);
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
  cacheDir: string | null
): Promise<void> {
  const origin = 'http://127.0.0.1';
  const url = new URL(req.url || '/', origin);
  cors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method Not Allowed');
  if (url.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const isHls = url.pathname === '/hls';
  const isBin = url.pathname === '/bin';
  const isImg = url.pathname === '/img';
  if (!isHls && !isBin && !isImg) return fail(res, 404, 'Not Found');

  if (url.searchParams.get('t') !== token) return fail(res, 403, 'Forbidden');

  const rawTarget = url.searchParams.get('u') || '';
  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    return fail(res, 400, 'Invalid url');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return fail(res, 400, 'Only http/https allowed');

  const referer = url.searchParams.get('r') || target.origin + '/';
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    Referer: referer,
    Accept: '*/*',
  };

  if (isImg) {
    const width = Math.min(Math.max(Number(url.searchParams.get('w')) || 0, 0), 1600);
    return serveImage(req, res, target, width, headers, cacheDir);
  }

  const range = req.headers.range;
  if (range) headers.Range = range;

  const controller = new AbortController();
  const connectTimer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(target, { headers, signal: controller.signal, redirect: 'follow' });
  } catch (err: any) {
    clearTimeout(connectTimer);
    const aborted = err?.name === 'AbortError';
    return fail(res, aborted ? 504 : 502, aborted ? 'Upstream timeout' : `Upstream error: ${err?.message || err}`);
  }
  clearTimeout(connectTimer);

  if (!upstream.ok && upstream.status !== 206) {
    return fail(res, upstream.status === 403 ? 403 : 502, `Upstream HTTP ${upstream.status}`);
  }

  const contentType = upstream.headers.get('content-type') || '';

  if (isHls && upstream.status !== 206) {
    const isAudioVideo = /^(video|audio)\//i.test(contentType);
    if (!isAudioVideo && isPlaylistContent(target.toString(), contentType)) {
      const text = await upstream.text();
      const proxyBase = `http://127.0.0.1:${(res.socket?.localPort as number) || 0}`;
      const proxyFor = (absolute: string) =>
        `${proxyBase}/hls?t=${token}&u=${encodeURIComponent(absolute)}&r=${encodeURIComponent(referer)}`;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : rewritePlaylist(text, target.toString(), proxyFor));
      return;
    }
    // 非播放列表（如直接请求分片）按二进制透传
  }

  res.statusCode = upstream.status;
  res.setHeader('Content-Type', contentType || 'application/octet-stream');
  for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.body || req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = Readable.fromWeb(upstream.body as any);
  stream.on('error', () => {
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export async function startMediaProxy(opts: ProxyOptions = {}): Promise<ProxyHandle> {
  const token = crypto.randomBytes(16).toString('hex');
  const cacheDir = opts.cacheDir || null;
  if (cacheDir) {
    void fs.promises.mkdir(cacheDir, { recursive: true }).then(() => trimImageCache(cacheDir)).catch(() => {});
  }
  const server = http.createServer((req, res) => {
    handle(req, res, token, cacheDir).catch((err) => {
      console.error('[proxy]', err);
      if (!res.headersSent) fail(res, 500, 'Proxy internal error');
      else res.end();
    });
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    token,
    close: () => server.close(),
  };
}
