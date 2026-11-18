/**
 * 打包为免安装的 Windows 应用目录（release/聚影TV-win32-x64）。
 * 运行：npm run package
 * 说明：使用 @electron/packager，纯 npm 依赖，不需要下载 electron-builder 的额外工具链。
 */
import { packager } from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('release');
fs.mkdirSync(outDir, { recursive: true });

const paths = await packager({
  dir: process.cwd(),
  out: outDir,
  name: '聚影TV',
  executableName: 'JuYingTV',
  appVersion: JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
  platform: 'win32',
  arch: 'x64',
  icon: path.resolve('build/icon.ico'),
  asar: true,
  overwrite: true,
  prune: true,
  ignore: [
    // 渲染层已由 Vite 打包、主进程已由 esbuild 打包，运行时只需要 Electron 与 Node 内置模块
    /^\/node_modules(\/|$)/,
    /^\/index\.html$/,
    /^\/(src|tests|scripts|screenshots|release|electron)(\/|$)/,
    /^\/\.(git|vscode|idea)(\/|$)/,
    /^\/\.e2e-[^/]+(\/|$)/,
    /^\/(tsconfig\.json|vite\.config\.ts|tailwind\.config\.js|postcss\.config\.js|package-lock\.json)$/,
    /^\/(README\.md|\.gitignore|\.npmrc)$/,
  ],
});

for (const p of paths) console.log('打包完成:', p);
