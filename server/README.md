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

## 按需与批量生成文章译文

文章页的“中文译文”标签支持按需生成：先查询 `article_translations` 缓存，没有译文时由用户点击“生成本文章译文”调用现有 OpenAI Chat Completions 兼容翻译配置，完成后立即写入数据库；相同文章再次请求直接返回缓存。服务端同时保留可恢复的批量翻译脚本，适合预生成大量内容。两种入口都按完整文章提供上下文，先保护题库标签、填空、网址、邮箱、数字等不可改写内容，再执行翻译、自动质量检查和可选的第二遍审校。

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
  "reviewEnabled": true,
  "reviewModel": "",
  "reviewTemperature": 0,
  "glossary": {
    "account manager": "客户经理"
  },
  "jsonMode": false
}
```

`reviewEnabled` 默认开启。`reviewModel` 留空时使用翻译模型进行第二遍审校，也可以指定同一接口下更强的审校模型。`glossary` 用于固定考试、商务、科普或故事人物的译法。第二遍审校会增加模型消耗；临时关闭可使用 `--no-review`。

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

# 小批量比较关闭审校后的成本和质量
npm run translate:articles -- \
  --config config/translation.json --exam middle --limit 10 --force --no-review
```

命令行参数优先于环境变量和 JSON 配置，因此也可以临时指定模型：

```bash
npm run translate:articles -- \
  --base-url http://127.0.0.1:11434/v1 \
  --model your-custom-model --limit 10
```

翻译段缓存保存在 `translation_segments`，组装后的文章译文保存在 `article_translations`，并记录 `translation_policy`、`quality_score`、`reviewed` 与质量问题列表。自动检查覆盖空译、明显漏译、否定关系和英文残留；任何保护标记丢失都会使该文章失败并自动重试，避免模型填写考试空白或修改题库编号。客户端通过受登录保护的 `GET /api/v1/articles/:id/translation?language=zh-CN` 查询缓存，通过 `POST /api/v1/articles/:id/translation` 按需生成或复用译文。模型接口返回 `usage` 时，批处理脚本会汇总翻译与审校的真实 Token。执行 `npm run translate:articles -- --help` 可以查看全部参数。

运营后台的手动推送支持按考试分类、文章主题类型及关键词筛选题库；切换筛选会清除不再可见的文章选择，避免误推。

每日自动推荐默认按 `Asia/Shanghai` 时区在 08:00 后，为每位用户从其当前选择的考试分类中分配一篇未推送过的文章。服务晚启动会补发当天任务，客户端在线时每分钟刷新应用内推送列表。

兴趣题库会为 TOEFL、IELTS、TOEIC、高中和初中五个阶段初始化内置栏目；信息类栏目提供大规模短篇语料，连续故事栏目提供分集解锁内容。同一主题会按考试阶段调整句式、篇幅、任务语境和题目推理强度。兴趣书架按栏目均衡抽取未出现过的文章，已经进入书架或每日任务的文章不会再次推荐。

每日三选一固定采用三个槽位：一篇所选兴趣的连续故事、一篇当前考试分类的真题、一篇科普／名著简化／其他兴趣拓展。候选不足时才跨类型补位；已经选择或开始阅读的当天文章不会被自动替换。

运营后台：`http://localhost:4000/admin/`

本地默认管理员密钥为 `dev-admin-change-me`。正式部署必须通过 `ADMIN_API_KEY` 修改，并仅在 HTTPS 后使用。

手机访问本机服务时，不能使用 `localhost`，应使用电脑的局域网地址，例如：

```text
http://192.168.1.14:4000/api/v1
```

## 连续兴趣故事生成

复制 `config/story-generation.example.json` 为本地配置，然后运行：

```bash
npm run generate:story-series -- --config config/story-generation.json
```

全部九个内置栏目都能生成连续故事：`military`、`art`、`science`、`why`、`fantasy`、`mecha`、`cultivation`、`tiger` 和 `cat`。默认并行生成 3 套候选季纲，再由总编模型融合选优。最终策划包含故事圣经、角色成长、固定称呼、场景因果链和线索账本；每集生成后由剧情、儿童吸引力、分级语言和连续性四个审稿视角提出定向修改。脚本还会读取同栏目已有的选择、完成、阅读进度、答题、生词与下一集续读等聚合反馈，用于调整新一季的钩子、节奏和难度。只有篇幅、句长、真实词频覆盖率、目标词、团队协作和题目结构达到质量线的章节才会写入数据库。

也可以使用自定义小写 slug 新增兴趣。首次成功生成时，脚本会把栏目资料写入 `interest_categories`，客户端重新加载后会自动显示：

```bash
npm run generate:story-series -- \
  --interest dinosaur \
  --interest-name "恐龙探险" \
  --interest-subtitle "化石、史前世界与科学冒险" \
  --interest-emoji "🦕" \
  --interest-color "#55766D" \
  --interest-prompt "围绕恐龙、化石和野外考察创作连续冒险，知识来自观察和证据" \
  --exam middle --reader-stage stage1 --episodes 6
```

运营后台“内容同步”页面也提供兴趣栏目的新增／更新表单，保存后即可在导入数据和用户兴趣选择中使用。

选材支持三种模式：

- `original`：完全原创连续故事。
- `classic`：基于内置公版名著独立简化重述，可选《爱丽丝梦游仙境》《金银岛》《秘密花园》《八十天环游地球》《西游记》《伊索寓言》、早期福尔摩斯故事、《小公主》《绿野仙踪》和《汤姆·索亚历险记》。
- `favorite`：根据孩子喜欢的作品或题材提取“吸引力配方”，但重新创作人物、世界和情节。

词汇分级借鉴成熟分级读物的控制方法，可用 `--reader-stage` 选择 `starter`（约 250 核心词）到 `stage6`（约 2500 核心词）；`auto` 会按考试阶段自动匹配。脚本通过 ECDICT 的 BNC/现代词频排名实测正文覆盖率，默认要求至少 95%；未达标时自动执行一次定向简化，仍未达标则停止导入。可用 `--ecdict` 指定词典，用 `--min-coverage` 调整门槛。脚本不会复制 Oxford Bookworms 或其他商业简写本的文本。

例如，把《金银岛》简化成适合初中生的连续冒险：

```bash
npm run generate:story-series -- --source-mode classic --classic treasure-island --interest tiger --exam middle --reader-stage stage1 --episodes 6
```

根据孩子喜欢的“魔法学校、幽默宠物和伙伴闯关”创作全新故事：

```bash
npm run generate:story-series -- --source-mode favorite --source-title "魔法校园故事" --source-notes "幽默宠物、伙伴闯关、藏在学校里的谜题" --interest cultivation --exam middle --reader-stage stage1 --episodes 6
```

可以先检查策划提示而不调用模型：

```bash
npm run generate:story-series -- --interest tiger --exam middle --episodes 6 --dry-run
```

常用参数还包括 `--model`、`--review-model`、`--base-url`、`--api-key`、`--database`、`--plan-candidates` 和 `--force`。详细说明可运行 `npm run generate:story-series -- --help`。

### 用户定制故事

客户端“编故事”页面允许已注册用户提交故事构想、角色、关键词、期待情节、风格、章节数和分级难度。服务端创建持久化后台任务，复用上述候选季纲、故事圣经、多维审稿和 ECDICT 词频门禁；任务在服务重启后会自动恢复。生成内容使用隐藏的 `custom-story` 分类，不进入公共兴趣栏目或每日三选一。

定制故事默认读取 `config/story-generation.json`，也可以通过 `CUSTOM_STORY_CONFIG_PATH` 指定配置。相关接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/custom-stories` | 创建定制故事后台任务 |
| `GET` | `/api/v1/custom-stories` | 查询当前用户的故事书架和任务状态 |
| `GET` | `/api/v1/custom-stories/:id` | 查询单个任务、章节与解锁状态 |

任务完成后只自动解锁第一章；提交本章答案后，沿用现有连续故事流程解锁下一章。章节可直接使用长按查词、全文翻译、Kokoro 语音、限时阅读和答题解析。

### 故事生成阶段与断点续跑

“编故事”提交后会在页面持续显示当前阶段、阶段说明和总进度。百分比表示流程完成度，不是精确的剩余时间；模型速度、章节长度和定向修稿次数都会影响实际耗时。

| 阶段 | 页面提示示例 | 工作内容 |
| --- | --- | --- |
| `queued` | 等待开始创作 | 请求进入持久化队列，等待前一个故事完成 |
| `planning` | 正在生成 3 套候选故事方案 | 并行生成不同季纲、角色成长线和线索账本 |
| `selecting_plan` | 候选方案已完成，正在选择最终故事主线 | 总编模型比较并融合候选季纲 |
| `drafting` | 正在生成第 2/6 集初稿 | 根据最终季纲和上一集状态创作本集 |
| `reviewing` | 初稿已完成，正在质量评审 | 从剧情、吸引力、分级语言和连续性四个角度审稿 |
| `editing` | 质量评审已完成，正在编辑润色 | 按评审意见输出结构完整的成稿 |
| `quality_check` | 编辑稿已完成，正在自动质量检查 | 检查篇幅、句长、词频覆盖、目标词、协作主题和题目结构，通过后立即上架本集 |
| `repairing` | 正在进行第 1/3 次定向修稿 | 只针对自动检测到的问题修订，并重新检查 |
| `saving` | 全部章节已上架，正在完成故事书架整理 | 完成系列状态和文章顺序的最终整理 |
| `completed` | 故事已完成，可以开始阅读 | 第一集已解锁，后续章节按答题完成情况逐集解锁 |
| `failed` | 已保存前 2 集，重试后将从第 3 集继续 | 显示错误和可恢复位置，等待用户重试 |

最终季纲生成后会立即保存检查点；此后每一集通过质量门禁，就把该集成稿、连续性状态和质量结果写入检查点并立即入库。第一集会同时绑定到用户书架并解锁，客户端最多约 5 秒即可轮询到，用户阅读时剩余章节仍在后台生成。服务重启、模型超时或 JSON 返回异常不会清除已经完成的工作：重新启动服务会自动恢复排队中的任务，失败任务点击重试会从最新检查点继续，不会重复消耗已完成章节的模型调用。

模型返回先经过容错解析，再进入 Zod 结构校验。解析层会处理 Markdown 代码围栏、JSON 前后说明文字、多个 JSON 片段、数组包裹、常见字段信封和可修复的 JSON 语法；结构仍不符合要求时，会把具体字段错误发回模型要求重新输出。单次模型请求默认最多等待 10 分钟，遇到临时网络错误时最多尝试 3 次。

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
| `GET`    | `/api/v1/articles/:id/translation`      | 查询整篇中文译文缓存       |
| `POST`   | `/api/v1/articles/:id/translation`      | 生成或复用整篇中文译文     |
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
