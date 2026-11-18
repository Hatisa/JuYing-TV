/**
 * 端到端冒烟测试：启动构建后的 Electron 应用，走一遍主要页面（首页 → 搜索 → 详情 → 播放 → 设置 → 收藏/历史）。
 * 运行：npm run build && node scripts/e2e.mjs
 * 截图输出到 screenshots/，断言失败会以非 0 退出码结束。
 */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('screenshots');
fs.mkdirSync(outDir, { recursive: true });

const errors = [];
const soft = []; // 可容忍的问题（例如封面源站不可达返回 502）
const failures = [];
const userDataDir = path.resolve('.e2e-user-data');
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // 沙箱环境可能带入该变量，会导致 Electron 以纯 Node 模式启动
env.JUYING_USER_DATA_DIR = userDataDir; // 独立 profile，避免与正在运行的桌面版争抢缓存锁
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env });

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('  · saved', name);
}

async function waitCards(page, timeout = 45000) {
  try {
    await page.waitForSelector('a[href*="/detail/"]', { timeout });
  } catch {
    return 0;
  }
  return page.locator('a[href*="/detail/"]').count();
}

try {
  const page = await app.firstWindow();
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource: the server responded with a status of (502|504)/.test(text)) soft.push('upstream-502/504');
    else errors.push('console: ' + text);
  });

  console.log('[1/6] 首页');
  await page.waitForSelector('text=最近更新', { timeout: 30000 });
  const homeCards = await waitCards(page, 45000);
  console.log('  首页卡片数量:', homeCards);
  if (homeCards < 1) failures.push('首页没有加载出任何影片卡片');
  await page.waitForTimeout(1500);
  await shot(page, '01-home.png');

  console.log('[1.1/6] 封面缩放与磁盘缓存');
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('a[href*="/detail/"] img[src*="/img?"]')].some((el) => el.complete && el.naturalWidth > 0),
      { timeout: 20000 }
    )
    .catch(() => {});
  const coverInfo = await page
    .evaluate(async () => {
      const img = [...document.querySelectorAll('a[href*="/detail/"] img[src*="/img?"]')].find(
        (el) => el.complete && el.naturalWidth > 0
      );
      if (!img) return null;
      const width = new URL(img.src).searchParams.get('w');
      // 使用一次性 URL 强制穿透浏览器缓存，验证本地代理的“写盘 → 再读”链路。
      const probe = new URL(img.src);
      probe.searchParams.set('e2e', Date.now().toString(36));
      const first = await fetch(probe, { cache: 'no-store' });
      const h1 = first.headers.get('x-img-cache');
      const second = await fetch(probe, { cache: 'no-store' });
      const h2 = second.headers.get('x-img-cache');
      return { width, h1, h2, size: Number(first.headers.get('content-length')) || 0 };
    })
    .catch(() => null);
  if (!coverInfo) {
    console.log('  跳过封面校验（当前没有加载成功的封面）');
  } else {
    console.log('  封面宽度参数:', coverInfo.width, '｜缓存:', coverInfo.h1, '→', coverInfo.h2, '｜体积:', coverInfo.size);
    if (coverInfo.width !== '360') failures.push('封面没有带缩放宽度参数');
    if (coverInfo.h2 !== 'hit') failures.push('封面第二次请求未命中磁盘缓存');
  }

  console.log('[2/6] 搜索');
  await page.fill('input[placeholder*="搜索电影"]', '流浪地球');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const results = await waitCards(page, 45000);
  let detailCandidates = Math.min(results, 5);
  await page.waitForTimeout(6000);
  const multi = await page.evaluate(() =>
    [...document.querySelectorAll('span')].filter((s) => /^\d+ 源$/.test((s.textContent || '').trim())).length
  );
  console.log('  搜索结果数量:', results, '｜多源合并条目:', multi);
  if (results < 1) failures.push('搜索「流浪地球」没有结果');
  if (multi < 1) failures.push('搜索结果没有出现多源合并（多个采集源未生效）');
  await shot(page, '02-search.png');

  console.log('[2.1/6] 搜索筛选与豆瓣评分');
  const filters = page.locator('[data-testid="search-filters"]');
  if ((await filters.count()) < 1) {
    failures.push('搜索页缺少筛选栏');
  } else {
    const filterButtons = await filters.locator('button').count();
    console.log('  筛选按钮数量:', filterButtons);
    await filters.locator('[data-category="movie"]').click();
    await page.waitForTimeout(600);
    const movieOnly = await page.locator('a[href*="/detail/"]').count();
    console.log('  仅电影筛选后结果:', movieOnly);
    if (movieOnly < 1) failures.push('按电影类型筛选后没有结果');
    await filters.locator('[data-year="2020s"]').click();
    await page.waitForTimeout(400);
    console.log('  叠加 2020 年代筛选后结果:', await page.locator('a[href*="/detail/"]').count());
    await filters.locator('[data-sort="rating"]').click();
    await page.waitForTimeout(500);
    console.log('  已切换到豆瓣高分排序');
    await filters.locator('[data-min-rating="0"]').click();
    await page.waitForTimeout(500);
    const highRated = await page.locator('a[href*="/detail/"]').count();
    console.log('  豆瓣 7 分以上结果:', highRated);
    await shot(page, '03-search-filter.png');
    // 还原筛选，避免影响后续详情/播放用例
    await filters.locator('[data-min-rating="1"]').click();
    await filters.locator('[data-sort="smart"]').click();
    await filters.locator('[data-year="all"]').click();
    await filters.locator('[data-category="all"]').click();
    await page.waitForTimeout(600);
  }
  const ratingBadges = await page.locator('[data-rating]').count();
  console.log('  豆瓣评分徽章:', ratingBadges);
  if (ratingBadges < 1) {
    soft.push('douban-unavailable');
    console.log('  · 暂未取到豆瓣评分（网络不可达时属预期）');
  }

  console.log('[2.2/6] 搜索发现（豆瓣高分 / 实时热播 / 猜你喜欢）');
  await page.evaluate(() => {
    location.hash = '#/search';
  });
  const discoverReady = await page
    .waitForSelector('[data-testid="search-discover"]', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!discoverReady) failures.push('搜索页缺少发现区域');
  const discoverTabs = await page.locator('[data-testid^="hot-tab-"]').count();
  console.log('  热播分类:', discoverTabs, '｜猜你喜欢:', await page.locator('[data-testid="guess-rail"]').count());
  if (discoverTabs !== 3) failures.push('热播榜分类不是电影/剧集/综艺 3 个');
  const hotLoaded = await page
    .waitForSelector('[data-testid="hot-board"] a[href*="/search?wd="]', { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!hotLoaded) soft.push('hot-board-empty');
  else {
    const hotItems = await page.locator('[data-testid="hot-board"] a[href*="/search?wd="]').count();
    console.log('  热播条目:', hotItems);
    await shot(page, '15-search-discover.png');
  }

  console.log('[2.3/6] 搜索历史编辑 / 删除');
  await page.waitForTimeout(800);
  const history = page.locator('[data-testid="search-history"]');
  if ((await history.count()) < 1) {
    failures.push('搜索历史未记录（最近搜索区域缺失）');
  } else {
    const chip = history.locator('span.chip').first();
    await chip.hover();
    await chip.locator('button[title="编辑"]').click({ force: true });
    const editInput = history.locator('input').first();
    await editInput.fill('流浪地球2');
    await editInput.press('Enter');
    await page.waitForTimeout(500);
    const renamed = await history.locator('text=流浪地球2').count();
    console.log('  重命名后出现:', renamed);
    if (renamed < 1) failures.push('搜索历史重命名未生效');
    await page.locator('[data-testid="search-history"] span.chip').first().hover();
    await page.locator('[data-testid="search-history"] span.chip').first().locator('button[title="删除"]').click({ force: true });
    await page.waitForTimeout(500);
    const afterDelete = await page.locator('[data-testid="search-history"]').count();
    console.log('  删除后剩余历史区域:', afterDelete);
  }

  // 历史页操作后重新搜索，恢复结果列表供详情用例使用
  await page.fill('input[placeholder*="搜索电影"]', '流浪地球');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const again = await waitCards(page, 30000);
  detailCandidates = Math.min(again, 5);
  console.log('  重新搜索结果:', again);

  console.log('[3/6] 详情');
  let episodeCount = 0;
  for (let i = 0; i < detailCandidates && episodeCount < 1; i += 1) {
    const card = page.locator('a[href*="/detail/"]').nth(i);
    const href = await card.getAttribute('href').catch(() => null);
    if (!href) break;
    await card.click();
    await page.waitForSelector('button[data-episode]', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(800);
    episodeCount = await page.locator('button[data-episode]').count();
    console.log(`  候选 ${i + 1}: ${href} → 剧集 ${episodeCount}`);
    if (episodeCount < 1 && i < detailCandidates - 1) {
      await page.goBack();
      await page.waitForTimeout(1000);
    }
  }
  if (episodeCount < 1) failures.push('详情页没有解析出剧集');

  const desc = page.locator('[data-testid="detail-desc"]').first();
  if ((await desc.count()) > 0) {
    const raw = (await desc.textContent()) || '';
    const shown = (await desc.innerText()) || '';
    const dirty =
      /&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i.test(raw) || /<[^>]+>/.test(raw);
    console.log('  简介乱码检查:', dirty ? '发现' : '通过', '|', shown.slice(0, 60));
    if (dirty) failures.push('详情简介仍含 HTML 实体或标签: ' + raw.slice(0, 120));
  }
  await shot(page, '03-detail.png');

  console.log('[4/6] 播放');
  if (episodeCount > 0) {
    await page.locator('button.btn-primary').first().click();
    const started = await page
      .waitForFunction(
        () => {
          const v = document.querySelector('video');
          return !!v && v.readyState >= 2 && v.currentTime >= 4;
        },
        { timeout: 45000 }
      )
      .then(() => true)
      .catch(() => false);
    const state = await page.evaluate(() => {
      const v = document.querySelector('video');
      return v ? { readyState: v.readyState, paused: v.paused, currentTime: Math.round(v.currentTime) } : null;
    });
    console.log('  播放状态:', JSON.stringify(state), 'started=', started);
    if (!started) failures.push('视频未能播放到 4 秒（可能采集源暂时不可用）');
    await shot(page, '08-play.png');

    console.log('  [4.1] 返回栈：播放 → 详情 → 搜索');
    await page.locator('button', { hasText: '返回' }).first().click();
    await page.waitForTimeout(900);
    const hashAfterPlay = await page.evaluate(() => location.hash);
    console.log('    播放页返回后:', hashAfterPlay);
    if (!hashAfterPlay.startsWith('#/detail/')) failures.push('播放页返回没有回到详情页: ' + hashAfterPlay);

    await page.locator('button', { hasText: '返回' }).first().click();
    await page.waitForTimeout(900);
    const hashAfterDetail = await page.evaluate(() => location.hash);
    console.log('    详情页再次返回后:', hashAfterDetail);
    if (hashAfterDetail.includes('/play/')) failures.push('详情页返回又进入播放页（返回栈死循环）');
    if (!hashAfterDetail.startsWith('#/search')) failures.push('详情页返回没有回到搜索页: ' + hashAfterDetail);
  }

  console.log('[5/6] 设置');
  await page.evaluate(() => {
    location.hash = '#/settings';
  });
  await page.waitForTimeout(1200);
  const sourcesCollapsed = await page.locator('[data-section="影视数据源"][aria-expanded="false"]').count();
  const hiddenWhileCollapsed = await page.locator('text=非凡影视').count();
  const healthVisibleWhileCollapsed = await page.locator('[data-testid="health-panel"]').isVisible().catch(() => false);
  console.log('  影视数据源默认收起:', sourcesCollapsed, '｜收起时源列表可见:', hiddenWhileCollapsed, '｜健康度可见:', healthVisibleWhileCollapsed);
  if (sourcesCollapsed < 1) failures.push('设置页「影视数据源」没有默认收起');
  if (hiddenWhileCollapsed > 0) failures.push('设置页数据源收起时仍渲染了源列表');
  if (!healthVisibleWhileCollapsed) failures.push('数据源折叠时健康度检测也被隐藏了');
  await page.locator('[data-section="影视数据源"]').click();
  await page.waitForTimeout(500);
  const sourcesExpanded = await page.locator('[data-section="影视数据源"][aria-expanded="true"]').count();
  if (sourcesExpanded < 1) failures.push('点击标题后影视数据源没有展开');
  const hasFfzy = await page.locator('text=非凡影视').count();
  const hasUku = await page.locator('text=U酷资源').count();
  const resetHint = await page.locator('text=/内置的 \\d+ 个数据源/').count();
  console.log('  非凡影视:', hasFfzy, '｜U酷:', hasUku, '｜恢复默认提示:', resetHint);
  if (hasFfzy < 1 || hasUku < 1) failures.push('设置页没有显示新增的数据源');

  console.log('[5.1/6] 一键检测全部接口');
  await page.waitForSelector('text=接口健康度', { timeout: 10000 }).catch(() => {});
  const healthCard = await page.locator('text=接口健康度').count();
  if (healthCard < 1) failures.push('设置页缺少健康度卡片');
  const oneClick = page.locator('button', { hasText: '一键检测全部' }).first();
  if ((await oneClick.count()) > 0) await oneClick.click();
  // 检测全部源（并发 4，单源超时 8s），等待主进程返回结果较稳妥
  const health = await page
    .evaluate(() => (window.api?.health ? window.api.health.check() : null))
    .catch(() => null);
  if (!health) {
    failures.push('健康度接口不可用（window.api.health 缺失）');
  } else {
    const states = Object.values(health);
    const online = states.filter((s) => s.state === 'online' || s.state === 'slow').length;
    const offline = states.filter((s) => s.state === 'offline').length;
    const checking = states.filter((s) => s.state === 'checking').length;
    console.log('  检测接口数:', states.length, '｜可用:', online, '｜离线:', offline, '｜仍检测中:', checking);
    if (states.length < 5) failures.push('健康度检测覆盖的接口过少');
    if (checking > 0) failures.push('健康度检测结束后仍有接口处于检测中');
    if (online < 1) failures.push('健康度检测没有任何可用接口（全部离线）');
    const onlineRows = await page.locator('text=在线').count();
    if (onlineRows < 1) failures.push('设置页没有展示在线状态（health:update 未推送到渲染层）');
  }
  await page.waitForTimeout(600);
  await shot(page, '05-settings.png');
  await shot(page, '09-health.png');

  console.log('[5.2/6] 18+ 分级开关与独立频道');
  const adultToggle = page.locator('[data-testid="adult-toggle"]');
  await adultToggle.scrollIntoViewIfNeeded();
  await adultToggle.click();
  const confirmShown = await page
    .waitForSelector('text=确认开启 18+ 内容？', { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!confirmShown) failures.push('18+ 开关没有弹出年龄确认窗口');
  await shot(page, '10-adult-confirm.png');
  if (confirmShown) {
    await page.locator('button', { hasText: '取消' }).first().click();
    await page.waitForTimeout(400);
    if ((await adultToggle.getAttribute('aria-checked')) === 'true') failures.push('取消确认后 18+ 仍被开启');
    await adultToggle.click();
    await page.waitForSelector('text=我已年满 18 周岁，开启', { timeout: 8000 }).catch(() => {});
    await page.locator('button', { hasText: '我已年满 18 周岁，开启' }).first().click();
    await page.waitForTimeout(800);
    if ((await adultToggle.getAttribute('aria-checked')) !== 'true') failures.push('确认后 18+ 开关未生效');
    const adultNav = await page.locator('a[href="#/adult"]').count();
    console.log('  侧边栏 18+ 入口:', adultNav);
    if (adultNav < 1) failures.push('开启 18+ 后侧边栏没有出现入口');
  }
  await page.evaluate(() => {
    location.hash = '#/adult';
  });
  await page.waitForTimeout(1000);
  const adultTitle = await page.locator('text=18+').count();
  if (adultTitle < 1) failures.push('18+ 频道页面没有渲染');
  await page.fill('input[placeholder*="18+"]', '人妻');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);
  const adultResults = await page.locator('a[href*="/detail/"]').count();
  console.log('  18+ 搜索结果:', adultResults);
  await shot(page, '11-adult.png');
  // 关闭 18+，回到默认状态
  await page.evaluate(() => {
    location.hash = '#/settings';
  });
  await page.waitForTimeout(1000);
  await page.locator('[data-testid="adult-toggle"]').click();
  await page.waitForTimeout(600);
  if ((await page.locator('a[href="#/adult"]').count()) > 0) failures.push('关闭 18+ 后侧边栏入口仍然存在');

  console.log('[5.3/6] 短剧模块（仅聚合）');
  await page.evaluate(() => {
    location.hash = '#/shorts';
  });
  const officialTab = await page.locator('[data-testid="shorts-tab-official"]').count();
  if (officialTab > 0) failures.push('短剧页仍保留红果官方标签');
  const shortsReady = await page
    .waitForSelector('[data-testid="shorts-feed"]', { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  if (!shortsReady) {
    soft.push('shorts-empty');
    console.log('  · 短剧暂无内容（采集源暂时不可用，属预期）');
  } else {
    const shortsCount = await page.locator('[data-testid="shorts-feed"] > div').count();
    console.log('  短剧竖屏卡片:', shortsCount);
    if (shortsCount < 1) failures.push('短剧页没有渲染竖屏卡片');
    await shot(page, '12-shorts.png');
    let verticalReady = false;
    for (let attempt = 0; attempt < 3 && !verticalReady; attempt += 1) {
      if (attempt > 0) {
        await page.evaluate(() => {
          location.hash = '#/shorts';
        });
        await page.waitForSelector('[data-testid="shorts-feed"]', { timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
      const playBtn = page.locator('[data-testid="shorts-feed"] button', { hasText: '立即播放' }).nth(attempt);
      if ((await playBtn.count()) < 1) break;
      await playBtn.click();
      verticalReady = await page
        .waitForSelector('[data-testid="vertical-player"]', { timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      console.log(`  第 ${attempt + 1} 部尝试：`, verticalReady ? '进入竖屏' : '未进入（该源可能解析失败）');
      if (!verticalReady) console.log('    当前地址:', await page.evaluate(() => location.hash));
    }
    if (!verticalReady) {
      failures.push('短剧「立即播放」没有进入竖屏播放器');
    } else {
      await page.waitForTimeout(3000);
      await shot(page, '13-shorts-play.png');
      console.log('  竖屏播放器已打开');
    }
  }

  console.log('[6/6] 收藏 / 历史');
  await page.evaluate(() => {
    location.hash = '#/favorites';
  });
  await page.waitForTimeout(800);
  await shot(page, '06-favorites.png');
  await page.evaluate(() => {
    location.hash = '#/history';
  });
  await page.waitForTimeout(800);
  const historyPencils = page.locator('button[title="重命名这条记录"]');
  const historyCount = await historyPencils.count();
  console.log('  历史记录数:', historyCount);
  if (historyCount > 0) {
    await historyPencils.first().hover();
    await historyPencils.first().click({ force: true });
    const aliasInput = page.locator('input').first();
    await aliasInput.fill('我的科幻片');
    await aliasInput.press('Enter');
    await page.waitForTimeout(600);
    const aliasShown = await page.locator('text=我的科幻片').count();
    console.log('  观看历史重命名结果:', aliasShown);
    if (aliasShown < 1) failures.push('观看历史重命名未生效');
  }
  await shot(page, '07-history.png');

  console.log('\n完成：错误', errors.length, '｜缺图', soft.length, '｜失败断言', failures.length);
  for (const e of errors.slice(0, 15)) console.log('  !', e);
  for (const f of failures) console.log('  ✗', f);
  if (errors.length > 0 || failures.length > 0) process.exitCode = 1;
} finally {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
