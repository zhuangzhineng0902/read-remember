# 拾词跨平台客户端

基于 Expo、React Native 和 TypeScript 的 Web、iOS、Android 与 Pad 客户端。

## 功能

- 托福、托业、高中、初中考试目标选择与切换
- 每日 3 篇不重复阅读任务
- 军事科技、画画与设计、科普知识、十万个为什么、奇幻冒险兴趣栏目
- 每日考试阅读与兴趣阅读混合推荐，支持首次引导和“我的”中多选兴趣
- 每个考试阶段、每个兴趣栏目初始化 102 篇原创分级文章，共 2,550 篇
- 原创连续故事、分级阅读题目与兴趣文章生词记忆
- 文章正文与可交互答题选项，支持在原文、整篇中文译文和答案解析之间切换
- 提交答案后显示评分、正确答案和解析
- 长按单词显示翻译、真实音标并加入生词库；播放按钮优先使用服务端缓存录音，无录音时使用设备英文语音
- 生词淡黄色高亮与取消标记
- 阅读历史与按考试分类的生词库
- API 数据同步及本地缓存兜底
- 手机底部导航与 Pad 侧边导航
- 每篇文章独立限时：支持自定义分钟数、暂停、重新计时和提醒风格；当前提供高达风机甲拔刀动画与英语语音，以及带原声的 14 秒“银河警报”视频提醒
- 新文章首次打开时限时默认不少于 8 分钟，用户仍可在阅读设置中自定义为 1-180 分钟；已经手动保存的文章时长保持不变

## 启动

```bash
npm install
npm start
```

### Expo Go 二维码

手机与电脑连接同一局域网后，可以固定使用 `8081` 端口启动 Metro，并同时生成 Expo Go 二维码：

```bash
npm run start:qr
```

命令会在终端显示二维码，并把同一张二维码保存到 `client/.expo/expo-go-qr.png`。Expo Go 扫码后访问的地址格式为 `exp://<电脑局域网IP>:8081`；客户端会从这个地址自动推断 API 为 `http://<电脑局域网IP>:4000/api/v1`。

如果 Metro 已经启动，只需要重新生成二维码：

```bash
npm run qr:expo
```

脚本默认优先检测 macOS 常用的 `en0`、`en1` 网卡，也支持手动指定 IP、端口或完整 Expo 地址：

```bash
npm run qr:expo -- --host 192.168.1.14 --port 8081
npm run qr:expo -- --url exp://192.168.1.14:8081
```

若扫码后无法连接，请确认服务端已监听 `0.0.0.0:4000`、手机和电脑位于同一网络，并允许防火墙访问 Node/Expo。完整参数可运行 `npm run qr:expo -- --help` 查看。

也可以直接运行：

```bash
npm run ios
npm run android
npm run web
```

开发环境会从 Metro Bundle 地址自动推断电脑局域网 IP，并连接：

```text
http://<电脑IP>:4000/api/v1
```

如需显式配置，复制 `.env.example` 为 `.env`：

```text
EXPO_PUBLIC_API_URL=https://api.example.com/api/v1
```

## 主要文件

- `App.tsx`：页面、导航、响应式布局和业务状态
- `src/api.ts`：认证、文章、答题、历史与生词 API
- `src/storage.ts`：设备身份及离线缓存
- `src/data.ts`：离线文章与词典示例
- `src/interest-data.ts`：兴趣栏目、来源说明与基础原创文章
- `src/interest-corpus.ts`：五栏目、五阶段批量原创语料生成器
- `src/theme.ts`：设计令牌

## 校验

```bash
npm run typecheck
npx expo-doctor
npx expo export --platform ios
npx expo export --platform android
```

## 构建 Web 网站

```bash
npm run build:web
```

静态网站输出到 `dist/`。默认使用同域 `/api/v1`，适合由仓库中的服务端直接托管：

```bash
cd ../server
npm run build:site
npm start
```

随后访问 `http://localhost:4000/`。若将网站与 API 分别部署，使用公网 HTTPS 地址重新导出：

```bash
EXPO_PUBLIC_API_URL=https://api.example.com/api/v1 npx expo export --platform web --output-dir dist
```

## 构建 iOS 与 Android 应用

项目已经配置 EAS Build。首次使用需要登录一个 Expo 账号：

```bash
npx eas-cli@latest login
npm run eas:init
```

`eas:init` 只需执行一次，用于把本地应用关联到你的 Expo 项目；生成的项目 ID 会自动写入应用配置。

正式安装包不能使用 `localhost` 访问电脑上的服务。构建前请在 EAS 对应环境中设置公网 HTTPS API 地址：

```bash
npx eas-cli@latest env:set --name EXPO_PUBLIC_API_URL \
  --value https://api.example.com/api/v1 \
  --environment preview --visibility plaintext
npx eas-cli@latest env:set --name EXPO_PUBLIC_API_URL \
  --value https://api.example.com/api/v1 \
  --environment production --visibility plaintext
```

可用构建命令：

```bash
# 可直接安装到 Android 手机或模拟器的 APK
npm run build:android:apk

# 可安装到 macOS iOS Simulator 的应用
npm run build:ios:simulator

# Google Play 使用的 AAB
npm run build:android

# TestFlight / App Store 使用的 iOS 包
npm run build:ios

# 同时构建两个商店正式包
npm run build:all
```

正式 iOS 构建需要 Apple Developer Program 账号；上传 Google Play 需要 Google Play Console 开发者账号。EAS 会在首次构建时引导创建或选择签名证书。

也可以在装好本地原生工具链后编译 Release：

```bash
npm run build:local:ios
npm run build:local:android
```

本地 iOS Release 需要 macOS、Xcode 和 CocoaPods；本地 Android Release 需要 Android Studio、Android SDK 和 JDK 17。
