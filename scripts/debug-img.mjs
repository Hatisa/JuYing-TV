import { _electron as electron } from 'playwright-core';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env });
const page = await app.firstWindow();
const failed = [];
page.on('response', (r) => {
  if (r.url().includes('/img?')) failed.push(r.status() + ' ' + r.url().slice(0, 120));
});
await page.waitForSelector('a[href*="/detail/"]', { timeout: 45000 });
await page.waitForTimeout(8000);
const info = await page.evaluate(() =>
  [...document.querySelectorAll('img')].slice(0, 8).map((el) => ({
    src: el.currentSrc.slice(0, 90),
    complete: el.complete,
    nw: el.naturalWidth,
    lazy: el.loading,
    rect: Math.round(el.getBoundingClientRect().top),
  }))
);
console.log(JSON.stringify(info, null, 1));
console.log('img responses:', failed.slice(0, 8).join('\n'));
await app.close();
