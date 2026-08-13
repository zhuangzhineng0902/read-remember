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
npm run dev
```

默认监听 `http://0.0.0.0:4000`，详细接口见 [server/README.md](./server/README.md)。

运营后台启动后访问 `http://localhost:4000/admin/`，本地默认密钥为 `dev-admin-change-me`。后台包含运营总览、题库管理、授权内容同步、手动推送和用户运营数据。

## 启动客户端

另开一个终端：

```bash
cd client
npm install
npm start
```

客户端在 Expo Go 中会自动连接 Metro 所在电脑的 `4000` 端口。正式环境可以通过 `client/.env` 中的 `EXPO_PUBLIC_API_URL` 指定 API 地址。详细说明见 [client/README.md](./client/README.md)。

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
