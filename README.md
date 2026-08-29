# 拾词 Read & Remember

帮助用户通过考试阅读训练提升英语词汇量的跨平台应用，支持 Web、iOS 和 Android。本仓库按客户端和服务端分离：

```text
read-remember/
├── client/   # Expo + React Native 跨平台客户端
└── server/   # Express + SQLite REST API
```

## 启动服务端

```bash
cd server
npm install
npm run setup:ecdict
npm run dev
```

默认监听 `http://0.0.0.0:4000`，详细接口见 [server/README.md](./server/README.md)。

单词释义、音标和词性由服务端 ECDICT SQLite 本地查询，不依赖在线翻译服务。词库体积较大，不提交到 Git；首次运行 `npm run setup:ecdict` 即可初始化。

服务端还提供 `npm run translate:articles` 批量翻译脚本，支持自定义 OpenAI 兼容模型、本地或云端 Base URL、模型名称、请求路径与请求头，并通过段落哈希去重和断点续跑减少 Token 消耗。生成译文后，用户可在阅读页通过“中文译文”标签查看按原文段落排列的整篇翻译。配置及使用方式见服务端 README。

文章页已支持 Kokoro 整篇朗读。首次播放按文章和音色生成音频，服务端把缓存元数据写入 SQLite、音频写入 `server/data/article-audio/`；再次播放直接命中缓存，客户端可在不重复生成音频的情况下切换 0.8x、1x、1.2x。启动 Kokoro-FastAPI 并配置 `KOKORO_BASE_URL` 后即可启用，具体配置见 [server/README.md](./server/README.md#kokoro-整篇朗读与音频缓存)。

运营后台启动后访问 `http://localhost:4000/admin/`，本地默认密钥为 `dev-admin-change-me`。后台包含运营总览、题库管理、授权内容同步、手动推送和用户运营数据。

## 启动客户端

另开一个终端：

```bash
cd client
npm install
npm start
```

客户端在 Expo Go 中会自动连接 Metro 所在电脑的 `4000` 端口。正式环境可以通过 `client/.env` 中的 `EXPO_PUBLIC_API_URL` 指定 API 地址。详细说明见 [client/README.md](./client/README.md)。

手机调试时可固定 `8081` 端口启动 Expo，并生成 Expo Go 可扫描的局域网二维码：

```bash
cd client
npm run start:qr
```

二维码同时显示在终端并保存到 `client/.expo/expo-go-qr.png`。如果 Expo 已经启动，运行 `npm run qr:expo` 即可单独重新生成；脚本支持 `--host`、`--port`、`--url` 和 `--output` 参数，详见 [客户端 README](./client/README.md#expo-go-二维码)。

客户端已配置 Android APK/AAB、iOS Simulator 及 TestFlight/App Store 构建。进入 `client/` 后可运行 `npm run build:android:apk`、`npm run build:ios:simulator` 或 `npm run build:all`，完整说明见客户端 README。

## 构建并发布 Web 网站

网站与移动端复用同一套界面和业务代码。执行：

```bash
cd server
npm run build:site
npm start
```

浏览器访问 `http://localhost:4000/` 即为用户网站，`http://localhost:4000/admin/` 仍为运营后台，API 位于 `/api/v1`。Web 产物生成在 `client/dist/`，也可部署到其他静态托管平台；若前后端不同域，构建时需将 `EXPO_PUBLIC_API_URL` 设置为公网 HTTPS API 地址。

项目根目录还提供 `Dockerfile`，可部署到任意支持 Docker 和持久磁盘的云平台。生产环境应将 `/app/data` 挂载为持久卷，并设置安全的 `ADMIN_API_KEY`。

## 故事生成阶段

连续兴趣故事和用户“编故事”共用分阶段生成流水线：`排队` → `生成多套候选季纲` → `总编选优` → `逐集初稿` → `多维质量评审` → `编辑润色` → `自动质量检查` → `必要时定向修稿` → `保存入库并解锁第一集`。客户端会同步显示当前步骤、具体集数和总进度。

最终季纲完成后会保存一次检查点，每一集通过质量门禁后再保存一次。模型超时、返回异常或服务重启时，已完成的季纲和章节不会丢失；重试会从最近检查点继续。详细阶段、容错范围和恢复行为见 [服务端 README](./server/README.md#故事生成阶段与断点续跑)。

## 完整校验

```bash
cd client
npm run typecheck
npx expo-doctor

cd ../server
npm run typecheck
npm test
npm run build
```
