/** 冒烟测试打包产物：直接启动 release 里的 exe，验证首页、搜索与真实播放。 */
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const exe = path.resolve('release/聚影TV-win32-x64/JuYingTV.exe');
if (!fs.existsSync(exe)) throw new Error('未找到打包产物，请先运行 npm run package');
const userDataDir = path.resolve('.e2e-packaged-user-data');
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.JUYING_USER_DATA_DIR = userDataDir; // 独立 profile，避免与用户实例或其他测试互相锁缓存
const app = await electron.launch({ executablePath: exe, args: [], cwd: path.dirname(exe), env });
const page = await app.firstWindow();
const errs = [];
const soft = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/502/.test(m.text())) soft.push('img-502');
  else errs.push(m.text());
});

await page.waitForSelector('text=最近更新', { timeout: 30000 });
await page.waitForSelector('a[href*="/detail/"]', { timeout: 45000 }).catch(() => {});
const cards = await page.locator('a[href*="/detail/"]').count();
await page.screenshot({ path: 'screenshots/09-packaged.png' });

await page.evaluate(() => {
  location.hash = '#/settings';
});
await page.waitForTimeout(1200);
const health = await page
  .evaluate(() => (window.api?.health ? window.api.health.check() : null))
  .catch(() => null);
const healthStates = health ? Object.values(health) : [];
const healthy = healthStates.filter((s) => s.state === 'online' || s.state === 'slow').length;
console.log('打包版健康度：接口', healthStates.length, '｜可用', healthy);
if (!health || healthStates.length < 5 || healthy < 1) process.exitCode = 1;
await page.screenshot({ path: 'screenshots/10-packaged-health.png' });

await page.evaluate(() => {
  location.hash = '#/search';
});
const discover = await page
  .waitForSelector('[data-testid="search-discover"]', { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
const hotTabs = discover ? await page.locator('[data-testid^="hot-tab-"]').count() : 0;
const hotItems = discover ? await page.locator('[data-testid="hot-board"] a').count() : 0;
console.log('打包版搜索发现：', discover, '｜热播分类', hotTabs, '｜热播条目', hotItems);
if (!discover || hotTabs !== 3) process.exitCode = 1;
await page.screenshot({ path: 'screenshots/16-packaged-discover.png' });

await page.evaluate(() => {
  location.hash = '#/search?wd=' + encodeURIComponent('流浪地球');
});
// 搜索发现页刚触发过全部源的并发请求，给搜索留出更充裕的排队时间。
await page.waitForSelector('a[href*="/detail/"]', { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1000);
const searchCards = await page.locator('a[href*="/detail/"]').count();
console.log('打包版搜索结果:', searchCards);
let playing = false;
const candidates = Math.min(searchCards, 6);
for (let i = 0; i < candidates && !playing; i += 1) {
  const card = page.locator('a[href*="/detail/"]').nth(i);
  const href = await card.getAttribute('href').catch(() => null);
  if (!href) break;
  await card.click().catch(() => {});
  await page.waitForSelector('button[data-episode]', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(600);
  const episodes = await page.locator('button[data-episode]').count();
  if (episodes < 1) {
    await page.goBack().catch(() => {});
    await page.waitForTimeout(800);
    continue;
  }
  await page.locator('button.btn-primary').first().click().catch(() => {});
  playing = await page
    .waitForFunction(() => {
      const v = document.querySelector('video');
      return !!v && v.readyState >= 2 && v.currentTime > 0.5;
    }, { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  console.log('打包版播放候选', i + 1, href, '→', playing);
  if (!playing) {
    await page.goBack().catch(() => {});
    await page.waitForTimeout(800);
    await page.goBack().catch(() => {});
    await page.waitForTimeout(800);
  }
}

console.log('打包版：首页卡片', cards, '｜播放', playing, '｜错误', errs.length, '｜缺图', soft.length);
for (const e of errs.slice(0, 8)) console.log('  !', e);
if (cards < 1 || !playing) process.exitCode = 1;
await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
