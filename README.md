# 聚影 TV（JuYingTV）

一个基于 **Electron + React + TypeScript** 的桌面端与 Android 影视聚合播放器：把网络上公开的苹果 CMS（AppleCMS v10）采集源聚合到一起，一次搜索、多源比价、直接播放，并支持收藏与观看历史。

界面与交互参考了开源项目 [LibreTV](https://github.com/LibreSpark/LibreTV) 的思路（多源聚合搜索 / 线路选择 / 播放器），桌面端与 Android 端均为本项目自研实现。

> ⚠️ 本项目**不提供、不存储、不转码任何视频资源**，所有内容均来自第三方公开采集接口。请仅将本项目用于学习与技术研究，并遵守当地法律法规与内容版权。

## 下载

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows 10/11 x64 | [JuYingTV-1.0.1-win32-x64.zip](https://github.com/Hatisa/JuYing-TV/releases/latest/download/JuYingTV-1.0.1-win32-x64.zip) | 免安装压缩包，解压后运行 `JuYingTV.exe`（约 151MB） |
| Android 7.0+ | [JuYingTV-Android-1.0.1.apk](https://github.com/Hatisa/JuYing-TV/releases/latest/download/JuYingTV-Android-1.0.1.apk) | debug 签名，允许「安装未知应用」后侧载（约 500KB） |

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
- **18+ 分级频道**：默认关闭；在设置中开启前会弹出「是否已满 18 周岁」确认，开启后侧边栏出现独立入口、独立搜索历史与「18+ 热门推荐」瀑布区。推荐区会轮换「伦理片 / 人妻 / 熟女 / 无码 / 三级片 / 情色」等热词，只取健康度最高的 6 个源并发检索，按多源命中数与年份排序，支持「换一批」。普通首页与搜索按整组判定过滤成人/伦理内容，并强化「海外抖音 / 网红主播 / 探花 / 福利姬」等关键词甄别，同时避免「海外剧」「海角七号」等正常内容误伤；直接访问成人详情会被拦截。
- **短剧模块**：原生竖屏聚合片库（都市/逆袭/甜宠/古装/悬疑/战神/家庭题材），支持模块内搜索，点击「立即播放」进入 9:16 竖屏播放器，可切回横屏并连续选集；内容来自已启用的采集接口，不再内嵌红果官方 webview。
- **AI 推荐助手（桌面端 + Android）**：左侧栏「AI 助手」，用模糊剧情、角色或台词描述找片；默认「免费 Auto」模式，无需 API Key，自动从 Kilo / Pollinations 与用户添加的「自定义免费通道」中选择可用模型并在失败时切换，也可切换到 DeepSeek / OpenAI / 智谱 GLM / 通义千问 / Kimi / 本地 Ollama 等自定义 OpenAI 兼容接口。可选开启**联网搜索**（Bing 免 Key 默认可用、DuckDuckGo 免 Key 备选，或 Tavily / Serper），回答前先搜索网页并把参考来源列在回复下方。支持每日自动签到、手动一键签到与一键检测全部免费模型健康度；AI 猜到的关键词可直接点开完整搜索结果，空回复或损坏 JSON 会自动修复重试，AI 给出的片名会继续在已启用的片库中匹配可播放条目，并标注匹配理由与置信度。
- **直播**：代码保留但入口已关闭（`src/lib/features.ts` 中 `FEATURES.live = false`；改成 `true` 即可恢复）。
- **个性化**：深色/浅色主题、4 种强调色、自动播放、自动连播、默认音量与倍速。
- **本地媒体代理**：主进程内置 127.0.0.1 随机端口 + 随机 Token 的代理，解决 m3u8 相对路径、CORS、Referer 防盗链问题。
- **Android 客户端**：同一套 React 界面运行在 WebView 中，原生 Java 本地 HTTP 服务负责静态资源、m3u8 改写、封面缩放与接口代理（含 POST 透传，AI 对话与联网搜索同样可用）；手机端自动切换底部导航、适配安全区并支持全屏播放，18+ 推荐区、AI 联网搜索、免费 Auto 与自定义免费通道均已同步。
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
  ai.ts              AI 供应商请求（OpenAI 兼容 chat/completions、错误归类、连接测试）
  free-models.ts     免费模型池（Kilo / Pollinations / 自定义免费通道、每日签到、auto 路由与冷却）
  web-search.ts       联网搜索（DuckDuckGo HTML / Tavily / Serper，主进程发起）
  store.ts           JSON 单文件存储（原子写 + 防抖）
  defaults.ts        数据版本与默认设置（内置源来自 src/lib/default-sources.ts）
android/             Android WebView 工程（MainActivity / LocalServer / NativeBridge）
src/                 渲染层
  pages/             首页、搜索、详情、播放、收藏、历史、设置、短剧、18+ 频道、AI 助手（直播页保留未挂路由）
  components/        TitleBar、Sidebar、MediaCard、Player、States、Toaster、DoubanRail、SearchDiscover、ConfirmModal
  lib/               cms 解析、成人/短剧识别、分类与年份、搜索排序、媒体地址、M3U 解析、API 封装、AI 解析与片库匹配、格式化
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
npm test             # 单元测试（100 项）
npm run build        # 构建渲染层 + 主进程
npm start            # 构建后直接启动
npm run package      # 打包到 release/聚影TV-win32-x64（完整目录约 359MB，压缩包约 151MB）
npm run e2e          # 端到端冒烟测试（构建后启动真实应用，含真实播放）
npm run e2e:packaged # 冒烟测试打包产物 exe
npm run icon         # 重新生成 build/icon.ico / icon.png（需要 Pillow）
npm run android:prepare # 把 dist/ 与图标复制进 Android 工程（构建 APK 前执行）
```

桌面端数据保存在 Electron 的 `userData` 目录下的 `juying-data.json`（设置页「关于」可直接看到完整路径），Android 端保存在应用私有的 `SharedPreferences`（`juying_store`）。删除应用数据即可恢复初始状态。

## Android 客户端

安装包：[JuYingTV-Android-1.0.1.apk](https://github.com/Hatisa/JuYing-TV/releases/latest/download/JuYingTV-Android-1.0.1.apk)（随 GitHub Release 发布）。

- 系统要求 Android 7.0（API 24）及以上；首次安装需允许「安装未知来源应用」。
- APK 使用 Android debug 签名，适合侧载测试；上架应用商店前请换成正式签名。
- 下载后直接安装，桌面图标为「聚影 TV」。手机端使用底部导航（首页 / 搜索 / 短剧 / 收藏 / 历史 / 设置），标题栏自动精简。

实现方式：

- `MainActivity` 启动 `LocalServer`（只绑定 127.0.0.1 随机端口），WebView 加载 `http://127.0.0.1:<port>/index.html`，页面、封面、HLS 与接口请求同源，规避 WebView CORS。
- `/hls` 拉取 m3u8 后把相对地址、嵌套 m3u8、EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA 的 URI 改写成同源地址；`/bin` 透传分片并保留 Range；`/img` 按宽度缩放并做内存缓存。
- `/api/json`、`/api/text`、`/api/test` 由本地服务异步访问上游，支持 GET 与 POST（AI 对话、Tavily / Serper），超时最高 65 秒，避免同步 JSBridge 阻塞 WebView 主线程；`NativeBridge` 只负责配置、存储、应用信息与外部打开。
- 前端在 `src/lib/bridge.ts` 检测 `window.JuYingNative`，自动切换到移动端实现。

从源码构建 APK：

1. 安装 JDK 17、Android SDK Platform 35 / Build-Tools 35.0.0，并确保 `ANDROID_HOME` 可用。
2. `npm ci`
3. `npm run build:web`
4. `npm run android:prepare`
5. `cd android && gradle assembleRelease`
6. 产物在 `android/app/build/outputs/apk/release/app-release.apk`。

仓库内置 `.github/workflows/android.yml`，在 Actions 中手动触发或推送 `v*` 标签即可自动构建并上传 `JuYingTV-Android-1.0.1.apk`；本地没有 Android 工具链时推荐使用该流程。

当前 1.0.1 APK 已由 GitHub Actions 构建通过（[run 44568554083](https://github.com/Hatisa/JuYing-TV/actions/runs/44568554083)），产物约 481KB，已确认包含 `classes.dex`、`assets/www` 前端资源与 v2 签名；尚未在 Android 真机 / 模拟器上做安装与播放回归。

## AI 推荐助手

桌面端与 Android 端均已内置 AI 推荐助手，入口在左侧栏「AI 助手」，手机端在底部导航「AI」。它不直接提供片源，而是先理解你的模糊描述，再把猜到的片名拿到当前启用的采集源里查找可播放条目。默认使用「免费 Auto」模式，没有 API Key 也能直接提问。

### 免费 Auto（默认，无需 Key）

1. 打开「设置 → AI 推荐助手」，模式保持「免费 Auto」。
2. 点击「一键签到」可立即刷新免费通道并探测模型；应用每天（北京时间 UTC+8）首次启动后也会自动签到一次，之后每 30 分钟巡检，同一天不会重复签到。
3. 点击「一键检测全部免费模型」可重新检测模型池，列表会显示每个模型的在线 / 较慢 / 离线状态、延迟、错误与冷却时间。
4. 回到「AI 助手」直接提问，例如「一个和尚去取经，路上打怪升级，还有四个徒弟和各种神仙妖魔」。回复下方会标注「免费模式 · Auto」与实际使用的模型。

免费模式内置两个公开、无需密钥的 OpenAI 兼容通道：**Kilo AI 公共网关**（`https://ai-gateway.kilo.ai/api/v1`）与 **Pollinations 匿名文本通道**（`https://text.pollinations.ai/openai`）。请求前会按在线状态、延迟、成功率排序，最多依次尝试 3 个模型：429 限流冷却 15 分钟，401/403 冷却 1 小时，5xx 冷却 3 分钟，其他错误冷却 30 分钟；全部不可用时会提示稍后重试或切换自定义 API。

> 这里的「签到」是每天刷新免费通道的模型清单与额度状态，不涉及登录第三方账号，也不会伪造 token 余额。免费通道按出口 IP / 匿名额度限流，公开端点可能随上游调整而失效；应用不会保存任何第三方账号凭据。

### 自定义免费通道（可选，无需 dsh）

如果你有 OpenRouter、Google AI Studio、Groq、GitHub Models 或其他任意 OpenAI 兼容端点的免费额度，可以直接加进 Auto 池，不需要安装或运行 dsh：

1. 打开「设置 → AI 推荐助手 → 免费 Auto → 自定义免费通道」，点击「添加通道」。
2. 可点预设快速填入 **OpenRouter 免费**、**Google AI Studio**、**Groq**、**GitHub Models**，也可以手动填写名称、API 地址、模型与自己的 API Key。
3. 修改后约 600ms 自动保存并同步主进程，通道模型会参与在线检测与 Auto 选路，回复的路由标识显示「自定义通道」。关闭开关或删除通道后立即移出候选。

所有 Key 只保存在本机：桌面端为 `userData/juying-data.json`，Android 端为应用私有 `SharedPreferences`，均为明文存储，请勿在共享设备上填写长期密钥。桌面端请求由 Electron 主进程发出，Android 端由本地 HTTP 服务转发，均直接发往你填写的端点。聚影不提供账号代登录，也不复制第三方账号池；免费额度与限流以各供应商自己的规则为准。

### 联网搜索（可选）

AI 助手可以先用搜索引擎补充最新信息，再结合搜索结果回答：

1. 打开「设置 → 联网搜索」，开启开关并选择供应商。
2. **Bing** 免 Key，国内网络可直接使用，作为默认；**DuckDuckGo** 免 Key，但公开 HTML 端点可能限流或在部分网络不可达；**Tavily** 与 **Serper** 需要填写各自的 API Key。
3. 可设置返回结果条数（2–6），点击「测试搜索」验证连通性。
4. 开启后回到「AI 助手」，回复上方会显示「联网搜索已开启」，回复下方列出最多 3 条参考来源，点击可在系统浏览器打开；搜索失败或没有结果时会明确提示，并继续使用模型自身知识推荐，不阻断回答。

联网搜索由主进程发起，只接受 http/https 结果；搜索结果仅作为模型上下文，不会上传你的本地片库或观看历史。

### 自定义 API

1. 在「设置 → AI 推荐助手」切换到「自定义 API」。
2. 填写供应商的 **API 地址**、**模型名称** 与 **API Key**，点击「测试连接」，显示「连接成功」后即可使用；地址可填根地址、/v1、/api/paas/v4 或完整的 /chat/completions，程序会自动补全。
3. 支持 DeepSeek、OpenAI、智谱 GLM、通义千问、Kimi 与本地 Ollama 等 OpenAI 兼容接口；本地模型可以不填 Key。密钥仅保存在本机（桌面端 userData/juying-data.json，Android 端 SharedPreferences 明文），AI 请求由本机直接发往你填写的供应商，不经过聚影的中转服务器。

AI 给出的片名会继续到片库检索：命中时直接显示可播放的影片卡片与「N 源」，未命中时提供「去搜索《片名》」入口。回复下方还会列出「查看更多搜索结果」关键词（例如《西游记》），点击即可带着该关键词进入完整搜索页，查看所有源的结果，而不只限于 AI 关联到的那一张卡片。

为了减少空回复和答非所问，聚影会要求模型只输出结构化 JSON；解析时兼容代码块、前后解释文字、别名键与顶层数组，遇到截断 JSON、空内容或没有任何可检索片名时会自动用更严格的提示重试一次，仍失败则在消息旁显示「重试」按钮，不会留下一片空白。AI 推荐依赖模型对剧情的理解，可能认错作品；片库匹配只覆盖当前已启用且健康度较高的采集源，冷门影片可能暂时没有可播版本。Android 端与桌面端共用同一套 AI 解析、免费池与联网搜索逻辑，差别仅在网络与存储由原生本地服务承担。

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
- `npm test`：92 个单元测试全部通过（CMS 解析 / 媒体地址 / M3U 解析 / m3u8 改写 / 健康度 / 成人识别 / 分类年份 / 搜索排序与多源合并 / 搜索发现 / AI 地址规范化、关键词解析、截断 JSON 兜底、片库匹配 / 免费模型日期边界、自定义通道模型 ID 与种子、免费模型过滤与排序、reasoning 兼容 / 联网配置归一化、可用性判断、搜索上下文与结果解析）。
- `npm run e2e`（2026-11-19）：启动真实应用，验证首页 55 张卡片、搜索「流浪地球」23 条结果且合并为 18 组多源条目、筛选栏 17 个按钮（电影 20 条 → 叠加 2020 年代 8 条 → 豆瓣高分排序）、搜索发现（3 类热播榜 10 条 + 猜你喜欢 1 条）、搜索历史重命名与删除、详情页解析出 1 集且**剧情简介不含 `&nbsp;` / HTML 实体 / 标签**、**m3u8 实际播放到 4 秒（readyState 4、paused=false、currentTime=4）**、**播放页返回回到详情、详情再返回回到搜索页**、设置页「影视数据源」默认收起且健康度面板仍可见、一键检测全部接口（29 个接口、21 个可用、8 个离线，随源站波动，无残留「检测中」）、18+ 年龄确认与独立频道（**推荐区 5–18 张卡片，「换一批」后 1–12 张（随源站与网络波动）**；搜索结果 70–91 条）、短剧聚合频道（8 张竖屏卡片并进入 9:16 播放器）、AI 自定义 API 连接测试（本地 mock 供应商，校验 Bearer 密钥与 /v1/chat/completions 路径）与模糊剧情推荐（片库关联 1 张卡片）、**联网搜索（Bing，免 Key）测试成功，返回 4 条结果（245ms），AI 回复下展示 3 条参考来源链接**、**AI 关键词 2 个且点击《西游记》跳到 `#/search?wd=西游记` 并出现搜索结果**、**AI 空回复时显示「重试」且不空白**、**新增自定义免费通道并同步进 Auto 池（通道请求校验 Bearer 密钥）**、免费 Auto 一键签到（6/6 模型可用）与一键健康检测、不配 Key 直接提问并返回《西游记》、片库关联 1 张卡片且标注 Auto 路由、观看历史自动记录（1 条）并重命名、封面带 `w=360` 且二次请求命中磁盘缓存；0 控制台错误、9 条软告警（源站缺图、豆瓣评分不可达等，自动降级）、0 失败断言。截图输出到 `screenshots/`（含 `09-health.png`、`10-adult-confirm.png`、`11-adult.png`、`11a-adult-search.png`、`12-shorts.png`、`13-shorts-play.png`、`14-ai.png`、`14a-ai-keyword.png`、`14a-ai-retry.png`、`14b-ai-free.png`、`15-search-discover.png`、`18-websearch.png`、`18a-ai-websearch.png`）。
- `npm run e2e:packaged`（2026-11-19）：打包版（`release/聚影TV-win32-x64/JuYingTV.exe`）通过首页 55 张卡片、一键健康检测（29 个接口、可用 19）、AI 自定义连接测试与模糊剧情推荐（片库关联 1 张卡片）、免费 Auto 一键签到（3/3 模型可用）、**自定义免费通道面板存在**、**18+ 推荐区（5 张卡片）**、**联网搜索设置与测试**（Bing 免 Key，测试成功）、搜索发现（3 类热播、10 条）、搜索「流浪地球」23 条结果与真实播放验证；0 错误、0 条源站缺图，截图 `screenshots/11-packaged-adult.png`、`screenshots/17-packaged-ai.png`、`screenshots/17b-packaged-ai-free.png`、`screenshots/18b-packaged-websearch.png`。
- 源可用性会随站点和网络变化：2026-11-19 开发版检测 29 个接口、21 个可用；打包版同轮 19 个可用。离线多为域名失效或连接超时，可在「设置 → 影视数据源」中停用或删除。

## 已知限制 / 后续计划

- 部分封面图源站对本机网络不可达（返回 502），卡片会自动降级为占位图，不影响播放。
- 豆瓣评分来自公开接口，无网络时自动跳过（不阻塞搜索）；短剧片库依赖采集源的「短剧」关键词与类型标记，冷门源可能暂时没有内容。
- 成人内容识别基于类型、片名与备注关键词，若采集源使用隐晦命名仍可能漏判，可在设置中停用对应源。
- 免费 Auto 依赖 Kilo / Pollinations 等公开免费通道，无需 Key 但可能被上游限流、调整或临时失效；自定义免费通道与自定义 API 需要自备供应商的 Key 与额度。聚影不提供第三方账号代登录，也不依赖 dsh-our-free-model 运行。联网搜索的 Bing / DuckDuckGo HTML 端点可能改版、限流或被网络阻断，Tavily / Serper 需要有效 Key；搜索失败时 AI 仍会直接推荐。模型可能认错作品，片库匹配也只覆盖当前启用的采集源。AI 助手暂只支持桌面端。
- 暂不支持下载、弹幕、投屏、多语言字幕。
- 采集源稳定性依赖第三方站点，若大量失效可在设置中替换。
- Android APK 使用 debug 签名，仅用于侧载测试；未上架应用商店。APK 已通过 CI 编译与内容检查，尚未在真机 / 模拟器上验证安装与播放；部分 Android WebView 对 HLS / 编解码支持不一致，遇到无法播放可切换线路。
- 后续可加入：AI 助手手机端同步、源列表订阅（LibreTV-SourceList / TVBOX 配置）、播放器手势与记忆音量、自动跳过片头、下载与离线缓存、全局快捷键、迷你模式。

## 许可

本项目以 [MIT License](./LICENSE) 开源，Copyright (c) 2026 Hatisa。

## 免责声明

本项目仅用于学习 Electron / React / 流媒体播放技术。所有视频内容版权归原权利人所有，本项目不参与录制、存储或分发。请勿用于商业用途；因使用本项目产生的任何法律责任由使用者自行承担。
