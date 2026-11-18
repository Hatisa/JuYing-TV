/** 批量探测 AppleCMS V10 采集源：搜索 -> 最新 -> 详情 -> 取一条 m3u8 试播。
 *  用法：node scripts/probe-sources.mjs <候选JSON> [并发数]
 *  候选格式：[{ "name": "...", "url": "https://.../api.php/provide/vod" }]
 */
import fs from 'node:fs';

const FILE = process.argv[2] || '.tmp/candidates.json';
const CONC = Number(process.argv[3] || 6);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const clean = (u) => String(u || '').trim().replace(/\/(from|at)\/[^/]+\/?$/, '').replace(/\/$/, '').replace(/\?.*$/, '');
const cands = JSON.parse(fs.readFileSync(FILE, 'utf8')).map((c) => ({ name: c.name, url: clean(c.url) }));

async function get(url, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' } });
    const text = await res.text();
    return { status: res.status, text, ms: Date.now() - t0 };
  } finally { clearTimeout(t); }
}

function parse(text) {
  try { return JSON.parse(text.replace(/^\uFEFF/, '').trim()); } catch { return null; }
}

function m3u8Of(playUrl) {
  for (const line of String(playUrl || '').split('$$$')) {
    for (const ep of line.split('#')) {
      const u = ep.split('$')[1];
      if (u && /\.m3u8(\?|$)/.test(u)) return u;
    }
  }
  return '';
}

const q = (base, query) => base + (base.includes('?') ? '&' : '?') + query;

async function phase1(c) {
  const out = { name: c.name, url: c.url, search: 0, latest: 0, m3u8: 0, detail: false, play: false, ms: 0, note: '' };
  try {
    const wd = await get(q(c.url, 'ac=videolist&wd=' + encodeURIComponent('流浪地球') + '&pg=1'));
    out.ms = wd.ms;
    if (wd.status !== 200) { out.note = 'HTTP ' + wd.status; return out; }
    const j = parse(wd.text);
    if (!j) { out.note = '非JSON: ' + wd.text.slice(0, 50).replace(/\s+/g, ' '); return out; }
    const list = Array.isArray(j.list) ? j.list : [];
    out.search = list.length;
    out.m3u8 = list.filter((x) => m3u8Of(x.vod_play_url)).length;
    if (!list.length) { out.note = '搜索0条 code=' + j.code + ' ' + (j.msg || ''); }
    try {
      const lt = await get(q(c.url, 'ac=videolist&pg=1'), 12000);
      const lj = parse(lt.text);
      out.latest = lj && Array.isArray(lj.list) ? lj.list.length : 0;
    } catch { /* 最新失败不影响 */ }
  } catch (e) {
    out.note = (e.name === 'AbortError' ? '超时' : (e.cause?.code || e.message)).slice(0, 60);
  }
  return out;
}
async function phase2(r) {
  if (!r.search) return r;
  try {
    const first = (await get(q(r.url, 'ac=videolist&wd=' + encodeURIComponent('流浪地球') + '&pg=1'))).text;
    const j = parse(first);
    const item = (j.list || []).find((x) => m3u8Of(x.vod_play_url));
    if (!item) { r.note = (r.note + ' 搜索无m3u8').trim(); return r; }
    const dj = parse((await get(q(r.url, 'ac=detail&ids=' + encodeURIComponent(item.vod_id)))).text);
    const d = dj && dj.list && dj.list[0];
    r.detail = !!(d && d.vod_play_url);
    const play = d && m3u8Of(d.vod_play_url);
    if (play) {
      const p = await get(play, 20000);
      r.play = p.status === 200 && /#EXTM3U/.test(p.text.slice(0, 400));
      r.playUrl = play;
      if (!r.play) r.note = 'm3u8不可播 HTTP ' + p.status;
    } else r.note = (r.note + ' 详情无m3u8').trim();
  } catch (e) { r.note = (r.note + ' 二次探测失败 ' + (e.cause?.code || e.message)).trim(); }
  return r;
}

async function run(list, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx]);
      const r = out[idx];
      if (fn === phase1 && r.search) console.log('…搜索 ' + r.name + ' ' + r.search + '条');
    }
  }));
  return out;
}

console.log('候选', cands.length);
const p1 = await run(cands, phase1);
for (const r of p1) console.log(`${r.search ? '✅' : '❌'} ${r.name.padEnd(8)} 搜索${String(r.search).padStart(3)} 最新${String(r.latest).padStart(2)} m3u8=${r.m3u8} ${r.ms}ms ${r.note}`);

const searchable = p1.filter((r) => r.search);
console.log('\n进入详情/播放检测:', searchable.length);
const done = await run(searchable, phase2);
done.sort((a, b) => Number(b.play) - Number(a.play) || Number(b.detail) - Number(a.detail) || b.search - a.search);
for (const r of done) console.log(`${r.play ? '🎬' : r.detail ? '📄' : '⚠️'} ${r.name.padEnd(8)} ${r.search}条 最新${r.latest} detail=${r.detail ? 'Y' : 'N'} play=${r.play ? 'Y' : 'N'} ${r.note}`);

fs.writeFileSync('.tmp/probe-results2.json', JSON.stringify(p1.map((r) => ({ ...r, ...(done.find((d) => d.url === r.url) || {}) })), null, 1));
const good = p1.map((r) => ({ ...r, ...(done.find((d) => d.url === r.url) || {}) })).filter((r) => r.play);
console.log('\n可用源', good.length);
for (const g of good) console.log(`  { name: '${g.name}', url: '${g.url}' }, // ${g.search}条 最新${g.latest}`);
