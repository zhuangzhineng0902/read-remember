# Read & Remember API

移动端“拾词”应用对应的 TypeScript REST API。服务使用 Express 5 和 Node 内置 SQLite，默认监听 `0.0.0.0:4000`。

## 启动

要求 Node.js 22.5 或更高版本。

```bash
cd server
npm install
npm run setup:ecdict
npm run dev
```

## 托管用户网站

服务端可以直接托管 Expo Web 网站，并保持网站、API 和运营后台同域：

```bash
npm run build:site
npm start
```

- 用户网站：`http://localhost:4000/`
- 运营后台：`http://localhost:4000/admin/`
- API：`http://localhost:4000/api/v1`

网站目录默认是 `../client/dist`，可通过 `WEB_ROOT` 覆盖。

仓库根目录的 `Dockerfile` 会一次性构建网站与 API。部署时请将容器 `/app/data` 目录挂载为持久卷，避免重启后丢失 SQLite 数据，并配置 `ADMIN_API_KEY`。

健康检查：`GET http://localhost:4000/health`

单词注释与发音：`GET http://localhost:4000/api/v1/pronunciations/hello?accent=us`。中文释义、英文释义、音标和词性统一从服务端只读的 ECDICT SQLite 查询，并写入应用缓存；查词过程不再访问第三方翻译接口。ECDICT 没有真人录音时返回 `fallback: "device-tts"`，由客户端使用设备英文语音朗读。

首次启动需要初始化约 217 MB 的 ECDICT 1.0.28 压缩包：

```bash
npm run setup:ecdict
```

解压后的词库默认保存为 `data/ecdict.sqlite`，不提交到 Git。可以通过 `ECDICT_PATH` 指向其他只读 SQLite 文件；`GET /health` 的 `dictionary` 字段为 `ecdict-ready` 时表示加载成功。

## Kokoro 整篇朗读与音频缓存

文章页支持用 Kokoro 生成整篇英文朗读。音频采用按需生成：用户第一次播放某篇文章、某个音色时才请求 Kokoro，之后直接复用磁盘缓存。缓存索引保存在主库的 `article_audio_cache` 表，音频文件默认保存在 `data/article-audio/`，两者都应随 `/app/data` 一起持久化。

先单独启动 OpenAI TTS API 兼容的 Kokoro-FastAPI。CPU 开发环境可以使用：

```bash
docker run --name read-remember-kokoro -p 8880:8880 \
  ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

Apple Silicon 也可以按照 Kokoro-FastAPI 项目说明使用 `./start-gpu_mac.sh` 启用 MPS。生产部署建议固定镜像版本，不要长期使用 `latest`。

然后在本服务的环境变量中启用整篇朗读：

```bash
KOKORO_BASE_URL=http://127.0.0.1:8880/v1
KOKORO_API_PATH=/audio/speech
KOKORO_MODEL=kokoro
KOKORO_FORMAT=mp3
KOKORO_AUDIO_ROOT=./data/article-audio
KOKORO_DEFAULT_VOICE=af_heart
KOKORO_VOICES=af_heart|温和女声 · 美音,am_michael|沉稳男声 · 美音,bf_emma|自然女声 · 英音,bm_george|沉稳男声 · 英音
```

本地运行时服务会自动读取 `server/.env`；该文件已被 Git 忽略，可以直接保存上述配置而不会提交密钥或机器相关地址。

其他可选配置见 `.env.example`。Kokoro 与本服务在不同容器时，`KOKORO_BASE_URL` 必须填写容器间可访问的地址，不能使用指向自身容器的 `127.0.0.1`。

- `GET /api/v1/article-audio/config`：查询是否启用、可用音色和客户端语速
- `GET /api/v1/articles/:id/audio?voice=af_heart`：只查询已有缓存，不触发生成
- `POST /api/v1/articles/:id/audio`：生成或复用整篇音频
- `GET /api/v1/article-audio/files/:token`：通过不可预测令牌读取缓存音频

首次播放需要等待模型合成；同一“文章 + 音色”再次播放直接命中 SQLite/文件缓存。0.8x、1x、1.2x 在客户端本地变速，不会重复生成三份文件。文章正文、模型、格式或服务地址变化时缓存会自动失效并重建。

### 批量预生成全部文章

默认使用 `KOKORO_DEFAULT_VOICE` 为数据库中的每篇文章生成一次音频。已有有效缓存会直接跳过，因此可以随时停止并重新运行续传：

```bash
cd server

# 先统计缓存命中和待生成数量
npm run generate:article-audio -- --dry-run

# 生成全部文章的默认音色
npm run generate:article-audio
```

CPU 模式建议保持默认单并发。也可以先处理一小批、按阶段或文章类型处理：

```bash
npm run generate:article-audio -- --limit 10
npm run generate:article-audio -- --exam middle --kind interest
```

如需明确指定音色：

```bash
# 只生成一个英音女声
npm run generate:article-audio -- --voice bf_emma

# 为每篇文章生成配置中的所有音色，耗时和磁盘约按音色数量倍增
npm run generate:article-audio -- --voices all
```

执行 `npm run generate:article-audio -- --help` 可查看完整参数。第一次按 `Ctrl+C` 会在当前文章完成后安全停止，已经生成的文件和 SQLite 缓存记录都会保留；再次运行会从未缓存文章继续。

## 批量生成文章译文

服务端提供可恢复的文章翻译脚本，支持任意 OpenAI Chat Completions 兼容接口，包括本地 Ollama、自建推理服务和云模型。译文按标题/段落内容哈希缓存，重复段落只调用一次；中途中断后重新运行会从已有缓存继续。

先复制并修改配置：

```bash
cp config/translation.example.json config/translation.json
```

核心配置如下：

```json
{
  "baseUrl": "http://127.0.0.1:11434/v1",
  "apiPath": "/chat/completions",
  "apiKey": "",
  "model": "your-translation-model",
  "targetLanguage": "zh-CN",
  "batchSize": 8,
  "concurrency": 2,
  "jsonMode": false
}
```

`config/translation.json` 已加入 Git 忽略规则，API Key 不会被提交。特殊供应商可以通过 `headers` 添加自定义请求头；不支持 `response_format` 的本地模型应保持 `jsonMode: false`。

先统计实际待处理量：

```bash
npm run translate:articles -- --config config/translation.json --dry-run
```

建议先试译 10 篇：

```bash
npm run translate:articles -- --config config/translation.json --limit 10
```

确认质量后处理全部文章：

```bash
npm run translate:articles -- --config config/translation.json
```

常用筛选与重译命令：

```bash
# 仅处理中考阶段的兴趣文章
npm run translate:articles -- \
  --config config/translation.json --exam middle --kind interest

# 更换模型后强制重新翻译选定内容
npm run translate:articles -- \
  --config config/translation.json --exam middle --force
```

命令行参数优先于环境变量和 JSON 配置，因此也可以临时指定模型：

```bash
npm run translate:articles -- \
  --base-url http://127.0.0.1:11434/v1 \
  --model your-custom-model --limit 10
```

翻译段缓存保存在 `translation_segments`，组装后的文章译文保存在 `article_translations`。客户端通过受登录保护的 `GET /api/v1/articles/:id/translation?language=zh-CN` 获取已推送文章的整篇译文；没有生成译文时接口返回 `data: null`。模型接口返回 `usage` 时，脚本会输出真实输入、输出和总 Token；否则输出待翻译英文字符数及输入 Token 估算。执行 `npm run translate:articles -- --help` 可以查看全部参数。

运营后台的手动推送支持按考试分类、文章主题类型及关键词筛选题库；切换筛选会清除不再可见的文章选择，避免误推。

每日自动推荐默认按 `Asia/Shanghai` 时区在 08:00 后，为每位用户从其当前选择的考试分类中分配一篇未推送过的文章。服务晚启动会补发当天任务，客户端在线时每分钟刷新应用内推送列表。

兴趣题库会为 TOEFL、IELTS、TOEIC、高中和初中五个阶段分别初始化五个栏目。每个“阶段 × 栏目”至少 100 篇，当前为 102 篇，共 2,550 篇；同一主题会按考试阶段调整句式、篇幅、任务语境和题目推理强度。兴趣书架按栏目均衡抽取未出现过的文章，已经进入书架或每日任务的文章不会再次推荐。

运营后台：`http://localhost:4000/admin/`

本地默认管理员密钥为 `dev-admin-change-me`。正式部署必须通过 `ADMIN_API_KEY` 修改，并仅在 HTTPS 后使用。

手机访问本机服务时，不能使用 `localhost`，应使用电脑的局域网地址，例如：

```text
http://192.168.1.14:4000/api/v1
```

## 认证

首次启动由客户端生成并持久化一个设备 ID：

```bash
curl -X POST http://localhost:4000/api/v1/auth/anonymous \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"my-phone-2026"}'
```

响应中的 `token` 用于后续请求：

```text
Authorization: Bearer <token>
```

## API

| 方法     | 路径                                    | 说明                       |
| -------- | --------------------------------------- | -------------------------- |
| `GET`    | `/health`                               | 健康检查                   |
| `GET`    | `/api/v1/exams`                         | 考试类型                   |
| `GET`    | `/api/v1/interests`                     | 兴趣阅读栏目               |
| `POST`   | `/api/v1/auth/anonymous`                | 匿名设备登录               |
| `GET`    | `/api/v1/users/me`                      | 当前用户                   |
| `PATCH`  | `/api/v1/users/me/exam`                 | 切换考试目标               |
| `GET`    | `/api/v1/users/me/preferences`          | 获取学习与阅读偏好         |
| `PATCH`  | `/api/v1/users/me/preferences`          | 同步学习与阅读偏好         |
| `GET`    | `/api/v1/users/me/stats`                | 真实学习统计               |
| `GET`    | `/api/v1/daily?date=YYYY-MM-DD`         | 当日 3 篇文章              |
| `GET`    | `/api/v1/interest-feed`                 | 当前用户的兴趣阅读书架     |
| `GET`    | `/api/v1/articles/:id`                  | 文章与答题选项，不泄露答案 |
| `GET`    | `/api/v1/article-audio/config`          | 整篇朗读配置与可用音色     |
| `GET`    | `/api/v1/articles/:id/audio`            | 查询整篇朗读缓存           |
| `POST`   | `/api/v1/articles/:id/audio`            | 生成或复用整篇朗读         |
| `GET`    | `/api/v1/articles/:id/answers`          | 恢复答题记录与已提交解析   |
| `PUT`    | `/api/v1/articles/:id/answers`          | 保存未提交的答题记录       |
| `GET`    | `/api/v1/articles/:id/reading-state`    | 恢复阅读位置与时长         |
| `PUT`    | `/api/v1/articles/:id/reading-state`    | 同步阅读位置与时长         |
| `POST`   | `/api/v1/articles/:id/complete`         | 提交答案并获取解析         |
| `GET`    | `/api/v1/history`                       | 阅读与答题历史             |
| `GET`    | `/api/v1/mistakes`                      | 当前用户错题本             |
| `GET`    | `/api/v1/vocabulary`                    | 按考试和关键词查询生词     |
| `PUT`    | `/api/v1/vocabulary/:word`              | 添加或更新生词             |
| `DELETE` | `/api/v1/vocabulary/:word?examId=toefl` | 取消生词标记               |
| `GET`    | `/api/v1/pushes`                        | 获取自动推荐和运营推送     |

## 运营后台

后台 API 使用 `X-Admin-Key` 认证，支持：

- 题库检索、分类、来源和授权信息查看
- 按考试、内容类型和兴趣栏目筛选题库
- 手动 JSON 导入授权题目
- 从域名白名单中的 HTTPS JSON Feed 同步题目
- 给指定用户或全部用户推送一篇或多篇文章
- 查看每个用户收到的文章/题目数、完成阅读数、答题数和生词数

在线同步前，需要在环境变量中配置允许的数据源域名：

```text
SYNC_ALLOWED_HOSTS=content.example.com,questions.example.org
```

Feed 格式：

```json
{
  "articles": [
    {
      "externalId": "licensed-reading-2025-01",
      "year": 2025,
      "title": "Reading title",
      "eyebrow": "SCIENCE",
      "readMinutes": 8,
      "difficulty": 3,
      "contentKind": "interest",
      "interestId": "science",
      "seriesTitle": null,
      "episodeNumber": null,
      "paragraphs": ["Licensed passage..."],
      "questions": [
        {
          "prompt": "Question?",
          "options": ["A", "B", "C", "D"],
          "answer": 0,
          "explanation": "Explanation"
        }
      ]
    }
  ]
}
```

同步操作必须填写授权说明并确认内容使用权。系统仅支持结构化授权 Feed，不会自动抓取任意网页或绕过版权限制。

## 去重规则

文章导入前会对标准化后的标题、正文、题干和选项计算 SHA-256 内容指纹；同一考试阶段中，即使外部 ID 不同，完全相同的内容也只会保留一份。原创初始化文章使用稳定 ID，可以安全地反复启动和升级。

`deliveries` 表具有两个数据库唯一约束：

- `(user_id, delivery_date, slot)`：同一天重复请求始终获得同一批内容。
- `(user_id, article_id)`：一篇文章不会重复推送给同一用户。

兴趣阅读另由 `interest_deliveries(user_id, article_id)` 保证不重复，日常推荐也会同时排除已经出现在兴趣书架中的文章。

当未读题库不足 3 篇时，接口返回现有未读文章并将 `corpusExhausted` 设为 `true`，不会为了凑数重复投递。生产环境应在此状态出现前由授权题库持续补充内容。

自动推荐使用 `(user_id, delivery_date)` 唯一约束，多实例或重复调度不会为同一用户重复推送。可通过 `DAILY_PUSH_ENABLED`、`DAILY_PUSH_HOUR` 和 `DAILY_PUSH_TIME_ZONE` 调整开关、小时与时区。

## 校验和构建

```bash
npm run typecheck
npm test
npm run build
npm start
```

业务数据库默认写入 `server/data/read-remember.sqlite`，可以通过 `DATABASE_PATH` 修改；词典路径通过 `ECDICT_PATH` 修改。测试使用内存数据库，不会污染本地数据。
