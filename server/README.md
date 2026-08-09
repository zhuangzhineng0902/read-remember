# Read & Remember API

移动端“拾词”应用对应的 TypeScript REST API。服务使用 Express 5 和 Node 内置 SQLite，默认监听 `0.0.0.0:4000`。

## 启动

要求 Node.js 22.5 或更高版本。

```bash
cd server
npm install
npm run dev
```

健康检查：`GET http://localhost:4000/health`

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
| `POST`   | `/api/v1/auth/anonymous`                | 匿名设备登录               |
| `GET`    | `/api/v1/users/me`                      | 当前用户                   |
| `PATCH`  | `/api/v1/users/me/exam`                 | 切换考试目标               |
| `GET`    | `/api/v1/daily?date=YYYY-MM-DD`         | 当日 3 篇文章              |
| `GET`    | `/api/v1/articles/:id`                  | 文章与答题选项，不泄露答案 |
| `POST`   | `/api/v1/articles/:id/complete`         | 提交答案并获取解析         |
| `GET`    | `/api/v1/history`                       | 阅读与答题历史             |
| `GET`    | `/api/v1/vocabulary`                    | 按考试和关键词查询生词     |
| `PUT`    | `/api/v1/vocabulary/:word`              | 添加或更新生词             |
| `DELETE` | `/api/v1/vocabulary/:word?examId=toefl` | 取消生词标记               |
| `GET`    | `/api/v1/pushes`                        | 获取运营手动推送           |

## 运营后台

后台 API 使用 `X-Admin-Key` 认证，支持：

- 题库检索、分类、来源和授权信息查看
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

`deliveries` 表具有两个数据库唯一约束：

- `(user_id, delivery_date, slot)`：同一天重复请求始终获得同一批内容。
- `(user_id, article_id)`：一篇文章不会重复推送给同一用户。

当未读题库不足 3 篇时，接口返回现有未读文章并将 `corpusExhausted` 设为 `true`，不会为了凑数重复投递。生产环境应在此状态出现前由授权题库持续补充内容。

## 校验和构建

```bash
npm run typecheck
npm test
npm run build
npm start
```

数据库默认写入 `server/data/read-remember.sqlite`，可以通过 `DATABASE_PATH` 修改。测试使用内存数据库，不会污染本地数据。
