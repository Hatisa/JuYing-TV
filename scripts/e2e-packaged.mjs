/** 冒烟测试打包产物：直接启动 release 里的 exe，验证首页、搜索与真实播放。 */
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const exe = path.resolve('release/聚影TV-win32-x64/JuYingTV.exe');
if (!fs.existsSync(exe)) throw new Error('未找到打包产物，请先运行 npm run package');
const userDataDir = path.resolve('.e2e-packaged-user-data');
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.JUYING_USER_DATA_DIR = userDataDir; // 独立 profile，避免与用户实例或其他测试互相锁缓存
const aiRequests = [];
const aiMock = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: [{ id: 'kilo-auto/free' }, { id: 'reflection/beam-free' }] }));
    return;
  }
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      payload = {};
    }
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    aiRequests.push({ url: req.url, auth: req.headers.authorization || '' });
    const isTest = messages.some((m) => typeof m.content === 'string' && m.content.includes('只回复 OK'));
    const content = isTest
      ? 'OK'
      : JSON.stringify({
          reply: '听起来最像《西游记》。',
          recommendations: [{ title: '西游记', year: 1986, type: 'series', reason: '取经主线与师徒四人吻合', confidence: 'high' }],
        });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  });
});
await new Promise((resolve) => aiMock.listen(0, '127.0.0.1', resolve));
const aiPort = aiMock.address().port;
env.JUYING_KILO_BASE = 'http://127.0.0.1:' + aiPort + '/api/v1';
env.JUYING_POLLINATIONS_ENDPOINT = 'http://127.0.0.1:' + aiPort + '/openai';
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

// AI 助手：配置本地 mock 供应商，再从模糊剧情走到片库关联
const aiSection = page.locator('[data-section="AI 推荐助手"]');
await aiSection.scrollIntoViewIfNeeded();
await aiSection.click();
await page.waitForSelector('[data-testid="ai-mode-custom"]', { timeout: 8000 }).catch(() => {});
await page.locator('[data-testid="ai-mode-custom"]').click();
await page.waitForSelector('[data-testid="ai-base-url"]', { timeout: 8000 }).catch(() => {});
await page.fill('[data-testid="ai-base-url"]', 'http://127.0.0.1:' + aiPort + '/v1');
await page.fill('[data-testid="ai-model"]', 'mock-model');
await page.fill('[data-testid="ai-api-key"]', 'e2e-key');
await page.locator('[data-testid="ai-test"]').click();
const aiTestOk = await page
  .waitForFunction(() => {
    const el = document.querySelector('[data-testid="ai-test-result"]');
    return !!el && (el.textContent || '').includes('连接成功');
  }, { timeout: 20000 })
  .then(() => true)
  .catch(() => false);
const aiAuthOk = aiRequests.some((r) => r.url === '/v1/chat/completions' && r.auth === 'Bearer e2e-key');
console.log('打包版 AI 连接测试：', aiTestOk, '｜请求与鉴权：', aiAuthOk);
if (!aiTestOk || !aiAuthOk) process.exitCode = 1;

await page.evaluate(() => {
  location.hash = '#/assistant';
});
const aiEmpty = await page.waitForSelector('[data-testid="ai-empty"]', { timeout: 10000 }).then(() => true).catch(() => false);
await page.fill('[data-testid="ai-input"]', '有一个和尚去取经，路上打怪升级，还有四个徒弟和各种神仙妖魔');
await page.keyboard.press('Enter');
const aiReply = await page
  .waitForFunction(() => {
    const el = document.querySelector('[data-testid="ai-message-assistant"]');
    return !!el && (el.textContent || '').includes('西游记');
  }, { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
const aiRec = await page
  .waitForSelector('[data-testid="ai-recommendation"], [data-testid="ai-rec-empty"]', { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
const aiRecCount = await page.locator('[data-testid="ai-recommendation"]').count();
console.log('打包版 AI 助手：空态', aiEmpty, '｜回复', aiReply, '｜关联卡片', aiRecCount);
if (!aiEmpty || !aiReply || !aiRec) process.exitCode = 1;
await page.screenshot({ path: 'screenshots/17-packaged-ai.png' });

await page.evaluate(() => {
  location.hash = '#/settings';
});
await page.waitForTimeout(900);
const freeSection = page.locator('[data-section="AI 推荐助手"]');
await freeSection.scrollIntoViewIfNeeded();
await freeSection.click();
await page.waitForSelector('[data-testid="ai-mode-auto"]', { timeout: 8000 }).catch(() => {});
await page.locator('[data-testid="ai-mode-auto"]').click();
await page.waitForSelector('[data-testid="ai-free-checkin"]', { timeout: 8000 }).catch(() => {});
await page.locator('[data-testid="ai-free-checkin"]').click();
const freeChecked = await page
  .waitForFunction(
    () => {
      const summary = document.querySelector('[data-testid="ai-free-summary"]');
      const online = document.querySelector(
        '[data-testid="ai-free-model"][data-state="online"], [data-testid="ai-free-model"][data-state="slow"]'
      );
      return !!online && !!summary && (summary.textContent || '').includes('可用');
    },
    { timeout: 60000 }
  )
  .then(() => true)
  .catch(() => false);
const freeModels = await page.locator('[data-testid="ai-free-model"]').count();
const freeOnline = await page
  .locator('[data-testid="ai-free-model"][data-state="online"], [data-testid="ai-free-model"][data-state="slow"]')
  .count();
console.log('打包版免费 Auto：签到', freeChecked, '｜模型', freeModels, '｜可用', freeOnline);
if (!freeChecked || freeModels < 2 || freeOnline < 1) process.exitCode = 1;
await page.screenshot({ path: 'screenshots/17b-packaged-ai-free.png' });

// 原生自定义免费通道必须存在（不依赖 dsh）
const channelUi = await page.locator('[data-testid="ai-channels"]').count();
console.log('打包版自定义免费通道面板:', channelUi);
if (channelUi < 1) process.exitCode = 1;

// 18+ 频道推荐区
const adultToggle = page.locator('[data-testid="adult-toggle"]');
await adultToggle.scrollIntoViewIfNeeded();
if ((await adultToggle.getAttribute('aria-checked')) !== 'true') {
  await adultToggle.click();
  await page.waitForSelector('text=我已年满 18 周岁，开启', { timeout: 8000 }).catch(() => {});
  await page.locator('button', { hasText: '我已年满 18 周岁，开启' }).first().click();
  await page.waitForTimeout(800);
}
await page.evaluate(() => {
  location.hash = '#/adult';
});
const adultPanel = await page
  .waitForSelector('[data-testid="adult-discover"]', { timeout: 10000 })
  .then(() => true)
  .catch(() => false);
const adultCards = adultPanel
  ? await page
      .waitForSelector('[data-testid="adult-discover"] a[href*="/detail/"]', { timeout: 45000 })
      .then(() => page.locator('[data-testid="adult-discover"] a[href*="/detail/"]').count())
      .catch(() => 0)
  : 0;
console.log('打包版 18+ 推荐区:', adultPanel, '｜推荐卡片', adultCards);
if (!adultPanel) process.exitCode = 1;
if (adultCards < 1) soft.push('adult-discover-empty');
await page.screenshot({ path: 'screenshots/11-packaged-adult.png' });

// 联网搜索设置与测试（外部网络不可达时记为 soft，不阻断）
await page.evaluate(() => {
  location.hash = '#/settings';
});
await page.waitForTimeout(900);
const webSection = page.locator('[data-section="联网搜索"]');
await webSection.scrollIntoViewIfNeeded();
if ((await webSection.getAttribute('aria-expanded')) !== 'true') await webSection.click();
await page.waitForSelector('[data-testid="websearch-toggle"]', { timeout: 8000 }).catch(() => {});
if ((await page.locator('[data-testid="websearch-toggle"]').getAttribute('aria-checked')) !== 'true') {
  await page.locator('[data-testid="websearch-toggle"]').click();
  await page.waitForTimeout(400);
}
await page.locator('[data-testid="websearch-provider-bing"]').click();
await page.waitForTimeout(300);
await page.locator('[data-testid="websearch-test"]').click();
const webTest = await page
  .waitForFunction(() => {
    const el = document.querySelector('[data-testid="websearch-result"]');
    return !!el && (el.textContent || '').trim().length > 0;
  }, { timeout: 25000 })
  .then(() => page.locator('[data-testid="websearch-result"]').textContent())
  .catch(() => '');
const webOk = (webTest || '').includes('搜索成功');
console.log('打包版联网搜索测试（Bing）:', webOk ? '成功' : (webTest || '').trim().slice(0, 80));
if (!webOk) soft.push('websearch-unavailable');
await page.screenshot({ path: 'screenshots/18b-packaged-websearch.png' });

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
await new Promise((resolve) => aiMock.close(resolve));
fs.rmSync(userDataDir, { recursive: true, force: true });