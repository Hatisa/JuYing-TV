# 聚影 TV（JuYingTV）

一个基于 **Electron + React + TypeScript** 的桌面端与 Android 影视聚合播放器：把网络上公开的苹果 CMS（AppleCMS v10）采集源聚合到一起，一次搜索、多源比价、直接播放，并支持收藏与观看历史。

界面与交互参考了开源项目 [LibreTV](https://github.com/LibreSpark/LibreTV) 的思路（多源聚合搜索 / 线路选择 / 播放器），桌面端与 Android 端均为本项目自研实现。

> ⚠️ 本项目**不提供、不存储、不转码任何视频资源**，所有内容均来自第三方公开采集接口。请仅将本项目用于学习与技术研究，并遵守当地法律法规与内容版权。

## 下载

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows 10/11 x64 | [JuYingTV-1.0.0-win32-x64.zip](https://github.com/Hatisa/JuYing-TV/releases/latest/download/JuYingTV-1.0.0-win32-x64.zip) | 免安装压缩包，解压后运行 `JuYingTV.exe`（约 187MB） |
| Android 7.0+ | [JuYingTV-Android-1.0.0.apk](https://github.com/Hatisa/JuYing-TV/releases/latest/download/JuYingTV-Android-1.0.0.apk) | debug 签名，允许「安装未知应用」后侧载（约 460KB） |

> Windows 压缩包内是完整的 Electron 运行时，请整体解压，不要只单独拷贝 `JuYingTV.exe`。

## 功能

- **聚合搜索**：并行查询多个采集源，按片名归并同一部作品，标注「N 源」，可换源播放。
- **搜索筛选与排序**：支持按类型（电影/剧集/动漫/综艺/短剧）、年份（2020 年代 / 2010 年代 / 2000 年代 / 更早）筛选，按综合、豆瓣高分、最新上映、来源最多排序，可一键只看豆瓣 7 分以上。
- **豆瓣评分**：详情与搜索结果自动匹配豆瓣条目并展示评分，首页提供「豆瓣高分电影」Top 250 横滑榜单；搜索按「相关性 + 内容类型 + 豆瓣评分 + 多源数量」打分，搜「流浪地球」优先展示电影而不是同名短剧。
- **搜索发现**：搜索页无关键词时展示「豆瓣高分」横滑榜、当前热播电影/剧集/综艺榜（按各源最新更新、年份与豆瓣评分实时聚合，每 5 分钟自动刷新）和「猜你喜欢」（依据观看历史/收藏的类型偏好推荐，排除已看与成人内容）。
- **搜索/观看历史可编辑**：最近搜索与观看历史都支持重命名、单条删除与清空，观看历史可给剧集起别名并保留原名。
- **首页推荐**：并行拉取各源最新更新，**哪个源先返回就先渲染**，慢源/失效源不会拖住整页，支持按来源筛选。
- **详情页**：海报、年份/地区/类型、简介、播放线路与剧集列表，一键收藏 / 继续观看。
- **播放器**：ArtPlayer + hls.js（m3u8）+ mpegts.js（flv），支持倍速、清晰度、快捷键、画中画、网页全屏。
- **线路与选集**：自动过滤不可播的中转线路；对未知类型地址会自动抓取播放页提取 m3u8。
- **观看历史**：自动记录进度（5 秒节流写入、退出时保存），同一剧集只保留最近一集，支持一键续播。
- **收藏**：本地收藏，可在收藏页直接继续观看。
- **数据源管理**：内置 **29 个采集源**（25 个实测可用并默认启用），可启停、删除、添加、恢复默认；旧版本数据升级时自动补入新源。数据源列表只在「设置」中展示，侧边栏不再展示源清单；设置页「影视数据源」默认收起，标题旁显示「N 个接口 · 可用 X」摘要。
- **接口健康度**：主进程后台每 4 分钟巡检全部采集接口；设置页的独立健康面板（不随「影视数据源」折叠）支持一键检测全部并实时显示进度，每个源标注在线 / 较慢 / 离线、延迟、连续失败次数与最近检测时间。
- **搜索加速**：主进程改用 Electron `net`（复用 Chromium 连接池 / HTTP2 / DNS 缓存），搜索结果缓存 5 分钟（LRU 400 条），按健康度排序并发请求，离线源自动缩短超时，慢源不再拖住整次搜索。
- **封面加速**：封面统一走本地代理按宽度缩放（卡片 360px、详情 720px）转 JPEG，落盘缓存 7 天（上限 300MB），二次打开命中磁盘直接返回。
- **18+ 分级频道**：默认关闭；在设置中开启前会弹出「是否已满 18 周岁」确认，开启后侧边栏出现独立入口与独立搜索历史。普通首页与搜索按整组判定过滤成人/伦理内容，并强化「海外抖音 / 网红主播 / 探花 / 福利姬」等关键词甄别，同时避免「海外剧」「海角七号」等正常内容误伤；直接访问成人详情会被拦截。
- **短剧模块**：原生竖屏聚合片库（都市/逆袭/甜宠/古装/悬疑/战神/家庭题材），支持模块内搜索，点击「立即播放」进入 9:16 竖屏播放器，可切回横屏并连续选集；内容来自已启用的采集接口，不再内嵌红果官方 webview。
- **直播**：代码保留但入口已关闭（`src/lib/features.ts` 中 `FEATURES.live = false`；改成 `true` 即可恢复）。
- **个性化**：深色/浅色主题、4 种强调色、自动播放、自动连播、默认音量与倍速。
- **本地媒体代理**：主进程内置 127.0.0.1 随机端口 + 随机 Token 的代理，解决 m3u8 相对路径、CORS、Referer 防盗链问题。
- **Android 客户端**：同一套 React 界面运行在 WebView 中，原生 Java 本地 HTTP 服务负责静态资源、m3u8 改写、封面缩放与接口代理；手机端自动切换底部导航、适配安全区并支持全屏播放。
- **无边框窗口**：自绘标题栏，支持拖拽、最小化/最大化/关闭。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Electron 45（frameless + contextIsolation，主进程负责网络与存储） |
| Android 壳 | WebView + Java 17 / Gradle 8.9（本地 HTTP 服务，AGP 8.7.3） |
| 前端 | React 19 + TypeScript + Vite 8 + Tailwind CSS 3 |
| 路由 / 状态 | React Router（HashRouter）+ Zustand |
| 播放 | ArtPlayer 5 + hls.js + mpegts.js |
| 图标 | lucide-react |
| 测试 | Vitest（单元）+ playwright-core（Electron 端到端） |
| 打包 | @electron/packager（免安装目录） |

## 目录结构

```
electron/            主进程
  main.ts            窗口、生命周期、单实例锁
  ipc.ts             IPC 注册（存储 / 网络 / 代理 / 应用信息 / 窗口控制）
  net.ts             采集接口请求（UA、GBK 解码、超时、连通性测试）
  proxy.ts           本地媒体代理（/hls /bin /img）
  hls-rewrite.ts     m3u8 解析与 URI 改写（纯函数，可单测）
  douban.ts          豆瓣评分 / Top 250 榜单（磁盘缓存 7 天 / 12 小时）
  store.ts           JSON 单文件存储（原子写 + 防抖）
  defaults.ts        数据版本与默认设置（内置源来自 src/lib/default-sources.ts）
android/             Android WebView 工程（MainActivity / LocalServer / NativeBridge）
src/                 渲染层
  pages/             首页、搜索、详情、播放、收藏、历史、设置、短剧、18+ 频道（直播页保留未挂路由）
  components/        TitleBar、Sidebar、MediaCard、Player、States、Toaster、DoubanRail、SearchDiscover、ConfirmModal
  lib/               cms 解析、成人/短剧识别、分类与年份、搜索排序、媒体地址、M3U 解析、API 封装、格式化
  store/             Zustand 全局状态 + 轻量 Toast
scripts/             构建主进程、打包、图标生成、E2E
tests/               Vitest 单元测试
```

## 开发

环境要求：Node.js ≥ 20（开发使用 Node 24），Windows / macOS / Linux。

```bash
npm install          # 首次安装（Electron 二进制从 npmmirror 下载，见 .npmrc）
npm run dev          # 同时启动 Vite 与 Electron（热更新）
npm run typecheck    # TypeScript 类型检查
npm test             # 单元测试（48 项）
npm run build        # 构建渲染层 + 主进程
npm start            # 构建后直接启动
npm run package      # 打包到 release/聚影TV-win32-x64（完整目录约 417MB，压缩包约 187MB）
npm run e2e          # 端到端冒烟测试（构建后启动真实应用，含真实播放）
npm run e2e:packaged # 冒烟测试打包产物 exe
npm run icon         # 重新生成 build/icon.ico / icon.png（需要 Pillow）
npm run android:prepare # 把 dist/ 与图标复制进 Android 工程（构建 APK 前执行）
```

数据保存在 Electron 的 `userData` 目录下的 `juying-data.json`（设置页「关于」可直接看到完整路径）。删除该文件即可恢复初始状态。

## Android 客户端

安装包：[JuYingTV-Android-1.0.0.apk](https://github.com/Hatisa/JuYing-TV/releases/latest/download/JuYingTV-Android-1.0.0.apk)（随 GitHub Release 发布）。

- 系统要求 Android 7.0（API 24）及以上；首次安装需允许「安装未知来源应用」。
- APK 使用 Android debug 签名，适合侧载测试；上架应用商店前请换成正式签名。
- 下载后直接安装，桌面图标为「聚影 TV」。手机端使用底部导航（首页 / 搜索 / 短剧 / 收藏 / 历史 / 设置），标题栏自动精简。

实现方式：

- `MainActivity` 启动 `LocalServer`（只绑定 127.0.0.1 随机端口），WebView 加载 `http://127.0.0.1:<port>/index.html`，页面、封面、HLS 与接口请求同源，规避 WebView CORS。
- `/hls` 拉取 m3u8 后把相对地址、嵌套 m3u8、EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA 的 URI 改写成同源地址；`/bin` 透传分片并保留 Range；`/img` 按宽度缩放并做内存缓存。
- `/api/json`、`/api/text`、`/api/test` 由本地服务异步访问上游，避免同步 JSBridge 阻塞 WebView 主线程；`NativeBridge` 只负责配置、存储、应用信息与外部打开。
- 前端在 `src/lib/bridge.ts` 检测 `window.JuYingNative`，自动切换到移动端实现。

从源码构建 APK：

1. 安装 JDK 17、Android SDK Platform 35 / Build-Tools 35.0.0，并确保 `ANDROID_HOME` 可用。
2. `npm ci`
3. `npm run build:web`
4. `npm run android:prepare`
5. `cd android && gradle assembleRelease`
6. 产物在 `android/app/build/outputs/apk/release/app-release.apk`。

仓库内置 `.github/workflows/android.yml`，在 Actions 中手动触发或推送 `v*` 标签即可自动构建并上传 `JuYingTV-Android-1.0.0.apk`；本地没有 Android 工具链时推荐使用该流程。

当前 1.0.0 APK 已由 GitHub Actions 构建通过（[run 44348088252](https://github.com/Hatisa/JuYing-TV/actions/runs/44348088252)），产物约 460KB，已确认包含 `classes.dex`、`assets/www` 前端资源与 v2 签名；尚未在 Android 真机 / 模拟器上做安装与播放回归。

## 数据源

内置 29 个采集源，均来自公开的苹果 CMS v10 接口，并于 2026-11-18 逐条实测「搜索 → 详情 → m3u8 试播」。采集站失效很快，可用性随站点和网络变化，可在「设置 → 影视数据源」展开后一键测试或替换。

| 名称 | 接口 | 默认 |
| --- | --- | --- |
| 非凡影视 | http://ffzy5.tv/api.php/provide/vod | ✅ |
| 非凡资源 | https://api.ffzyapi.com/api.php/provide/vod | ✅ |
| 量子资源 | https://lzizy1.com/api.php/provide/vod | ✅ |
| 无尽资源 | https://api.wujinapi.com/api.php/provide/vod | ✅ |
| 光速资源 | https://api.guangsuapi.com/api.php/provide/vod | ✅ |
| 红牛资源 | https://www.hongniuzy2.com/api.php/provide/vod | ✅ |
| 红牛线路2 | https://www.hongniuzy3.com/api.php/provide/vod | ✅ |
| 虎牙资源 | https://www.huyaapi.com/api.php/provide/vod | ✅ |
| 虎牙资源2 | https://huyazy.net/api.php/provide/vod | ✅ |
| 金鹰资源 | http://jyzyapi.com/api.php/provide/vod | ✅ |
| 金鹰点播 | https://jinyingzy.com/api.php/provide/vod | ✅ |
| 360资源 | https://360zy.com/api.php/provide/vod | ✅ |
| 360线路2 | https://360zy5.com/api.php/provide/vod | ✅ |
| U酷资源 | https://api.ukuapi88.com/api.php/provide/vod | ✅ |
| 魔都资源 | https://caiji.moduapi.cc/api.php/provide/vod | ✅ |
| 极速资源 | https://jszyapi.com/api.php/provide/vod | ✅ |
| 艾旦影视 | http://lovedan.net/api.php/provide/vod | ✅ |
| 淘片资源 | https://taopianapi.com/cjapi/mc/vod/json.html | ✅ |
| 360线路3 | https://360zyzz.com/api.php/provide/vod | ✅ |
| 爱奇艺资源 | https://iqiyizyapi.com/api.php/provide/vod | ✅ |
| 麒麟影音 | https://www.qlys.cc/api.php/provide/vod | ✅ |
| 优质资源 | https://api.yyzy-tv.vip/inc/apijson.php | ✅ |
| 暴风线路2 | http://bf.xoxowin86cisyap.com/api.php/provide/vod | ✅ |
| 最大资源 | https://api.zuidapi.com/api.php/provide/vod | ✅ 偶发超时 |
| 魔都动漫 | https://www.mdzyapi.com/api.php/provide/vod | ✅ 动漫为主 |
| 百度云资源 | https://api.apibdzy.com/api.php/provide/vod | ⛔ 历史可用，当前网络不通 |
| 巨量资源 | https://api.juliang.live/api/provide/vod | ⛔ 详情无 m3u8 |
| 暴风资源 | https://bfzyapi.com/api.php/provide/vod | ⛔ 当前超时 |
| 电影天堂 | https://caiji.dyttzyapi.com/api.php/provide/vod | ⛔ 当前超时 |

> 源列表参考了 [LibreTV-SourceList](https://github.com/1kuGAI/LibreTV-SourceList)、[jwscankuLv/LibreTV-sources](https://github.com/jwscankuLv/LibreTV-sources)、[TVBox 配置聚合](https://github.com/Lightconer/tvbox-ysc-config) 等公开项目，已过滤成人内容源。新增内置源只需修改 `src/lib/default-sources.ts` 并递增 `electron/defaults.ts` 中的 `SOURCES_VERSION`，老用户升级后会自动合并。

添加自定义源：设置 → 影视数据源（展开）→ 添加，填入形如 `https://example.com/api.php/provide/vod` 的苹果 CMS v10 接口地址即可。

## 已验证

- `npm run typecheck`、`npm run build` 通过。
- `npm test`：48 个单元测试全部通过（CMS 解析 / 媒体地址 / M3U 解析 / m3u8 改写 / 健康度 / 成人识别 / 分类年份 / 搜索排序与多源合并 / 搜索发现）。
- `npm run e2e`（2026-11-19）：启动真实应用，验证首页 20 张卡片、搜索「流浪地球」44 条结果且合并为 18 组多源条目、筛选栏 17 个按钮（电影 22 条 → 叠加 2020 年代 9 条 → 豆瓣高分排序）、搜索发现（3 类热播榜 6 条 + 猜你喜欢 1 条）、搜索历史重命名与删除、详情页解析出 1 集且**剧情简介不含 `&nbsp;` / HTML 实体 / 标签**、**m3u8 实际播放到 4 秒（readyState 4、paused=false、currentTime=4）**、**播放页返回回到详情、详情再返回回到搜索页**、设置页「影视数据源」默认收起且健康度面板仍可见、一键检测全部接口（29 个接口、可用 27、离线 2、无残留「检测中」）、18+ 年龄确认与独立频道（78 条结果）、短剧聚合频道（8 张竖屏卡片并进入 9:16 播放器）、观看历史自动记录（1 条）并重命名、封面带 `w=360` 且二次请求命中磁盘缓存；0 控制台错误、8 张源站缺图（自动降级）、0 失败断言。截图输出到 `screenshots/`（含 `09-health.png`、`10-adult-confirm.png`、`11-adult.png`、`12-shorts.png`、`13-shorts-play.png`、`15-search-discover.png`）。
- `npm run e2e:packaged`：打包版（`release/聚影TV-win32-x64/JuYingTV.exe`）通过首页 56 张卡片、搜索发现（3 类热播、6 条）、搜索「流浪地球」49 条结果、真实播放与一键健康检测（29 个接口、可用 25）验证；0 错误、0 缺图。
- 源可用性会随站点和网络变化：2026-11-19 开发版检测 29 个接口、27 个可用、2 个离线；打包版同轮 25 个可用。离线多为域名失效或连接超时，可在「设置 → 影视数据源」中停用或删除。

## 已知限制 / 后续计划

- 部分封面图源站对本机网络不可达（返回 502），卡片会自动降级为占位图，不影响播放。
- 豆瓣评分来自公开接口，无网络时自动跳过（不阻塞搜索）；短剧片库依赖采集源的「短剧」关键词与类型标记，冷门源可能暂时没有内容。
- 成人内容识别基于类型、片名与备注关键词，若采集源使用隐晦命名仍可能漏判，可在设置中停用对应源。
- 暂不支持下载、弹幕、投屏、多语言字幕。
- 采集源稳定性依赖第三方站点，若大量失效可在设置中替换。
- Android APK 使用 debug 签名，仅用于侧载测试；未上架应用商店。APK 已通过 CI 编译与内容检查，尚未在真机 / 模拟器上验证安装与播放；部分 Android WebView 对 HLS / 编解码支持不一致，遇到无法播放可切换线路。
- 后续可加入：源列表订阅（LibreTV-SourceList / TVBOX 配置）、播放器手势与记忆音量、自动跳过片头、下载与离线缓存、全局快捷键、迷你模式。

## 许可

本项目以 [MIT License](./LICENSE) 开源，Copyright (c) 2026 Hatisa。

## 免责声明

本项目仅用于学习 Electron / React / 流媒体播放技术。所有视频内容版权归原权利人所有，本项目不参与录制、存储或分发。请勿用于商业用途；因使用本项目产生的任何法律责任由使用者自行承担。
