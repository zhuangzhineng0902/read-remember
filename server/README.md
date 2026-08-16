# Read & Remember API

移动端“拾词”应用对应的 TypeScript REST API。服务使用 Express 5 和 Node 内置 SQLite，默认监听 `0.0.0.0:4000`。

## 启动

要求 Node.js 22.5 或更高版本。

```bash
cd server
npm install
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

单词注释与发音：`GET http://localhost:4000/api/v1/pronunciations/hello?accent=us`。服务会依次尝试 Free Dictionary 与备用真人发音源，并缓存 IPA、录音、中文释义、词性和中英例句；全部来源均无录音时返回 `fallback: "device-tts"`。

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

数据库默认写入 `server/data/read-remember.sqlite`，可以通过 `DATABASE_PATH` 修改。测试使用内存数据库，不会污染本地数据。
