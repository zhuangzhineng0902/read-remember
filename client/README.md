# 拾词移动端

基于 Expo、React Native 和 TypeScript 的 iOS、Android 与 Pad 客户端。

## 功能

- 托福、托业、高中、初中考试目标选择与切换
- 每日 3 篇不重复阅读任务
- 文章正文与可交互答题选项
- 提交答案后显示评分、正确答案和解析
- 长按单词显示翻译、音标并加入生词库
- 生词淡黄色高亮与取消标记
- 阅读历史与按考试分类的生词库
- API 数据同步及本地缓存兜底
- 手机底部导航与 Pad 侧边导航

## 启动

```bash
npm install
npm start
```

也可以直接运行：

```bash
npm run ios
npm run android
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
- `src/theme.ts`：设计令牌

## 校验

```bash
npm run typecheck
npx expo-doctor
npx expo export --platform ios
npx expo export --platform android
```
