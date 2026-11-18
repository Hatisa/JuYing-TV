/** 二次探测：串行重试失败源，打印错误原因，并尝试 http/https 互换。 */
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const all = JSON.parse(fs.readFileSync('.tmp/probe-results.json', 'utf8'));
const failed = all.filter((r) => !r.ok);
async function once(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' } });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    return { error: e.name + ': ' + e.message + (e.cause ? ' / ' + (e.cause.code || e.cause.message) : '') };
  } finally { clearTimeout(t); }
}
const results = [];
for (const f of failed) {
  let url = f.url;
  const q = '?ac=videolist&wd=' + encodeURIComponent('流浪地球') + '&pg=1';
  let r = await once(url + q);
  let used = url;
  if (r.error || r.status !== 200) {
    const alt = url.startsWith('https:') ? url.replace('https:', 'http:') : url.replace('http:', 'https:');
    const r2 = await once(alt + q);
    if (!r2.error && r2.status === 200 && r2.text.trim().startsWith('{')) { r = r2; used = alt; }
  }
  let note = r.error || ('HTTP ' + r.status);
  let list = 0;
  if (!r.error && r.status === 200) {
    try { const j = JSON.parse(r.text.replace(/^\uFEFF/, '')); list = (j.list || []).length; note = 'list=' + list + ' code=' + j.code; } catch { note = '非JSON ' + r.text.slice(0, 50).replace(/\s+/g, ' '); }
  }
  console.log(`${list ? '✅' : '❌'} ${f.name} ${used} :: ${note}`);
  results.push({ ...f, url: used, retryList: list, retryNote: note });
}
fs.writeFileSync('.tmp/probe-retry.json', JSON.stringify(results, null, 1));
