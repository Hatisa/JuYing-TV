/**
 * 把 Vite 构建产物和图标放进 Android 工程，供 Gradle 打进 APK。
 * 运行：npm run build:web && node scripts/prepare-android.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const www = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'www');
const iconSrc = path.join(root, 'build', 'icon.png');
const iconDest = path.join(root, 'android', 'app', 'src', 'main', 'res', 'drawable', 'icon.png');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('[android] 未找到 dist/index.html，请先运行 npm run build:web');
  process.exit(1);
}

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });
fs.cpSync(dist, www, { recursive: true });

function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(full);
    else count += 1;
  }
  return count;
}

if (fs.existsSync(iconSrc)) {
  fs.mkdirSync(path.dirname(iconDest), { recursive: true });
  fs.copyFileSync(iconSrc, iconDest);
  console.log('[android] 已更新应用图标');
} else {
  console.warn('[android] 未找到 build/icon.png，保留现有图标');
}

const files = countFiles(www);
console.log('[android] 已复制 ' + files + ' 个前端文件到 ' + path.relative(root, www));
if (files < 2) {
  console.error('[android] 前端资源数量异常');
  process.exit(1);
}
