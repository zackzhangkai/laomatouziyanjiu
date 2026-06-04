# 老马投资研究

基于 **Astro + Cloudflare Pages + D1** 的全栈个人博客。

- 文章：Markdown 存放在 `src/content/blog/`
- 评论与用户：Cloudflare D1（SQLite）
- 认证：JWT（HttpOnly Cookie）
- 管理员发文：GitHub Contents API → 自动触发 Pages 重新部署

## 本地开发

```bash
npm install
cp .env.example .dev.vars
# 编辑 .dev.vars，至少设置 JWT_SECRET

npm run db:migrate:local
npm run db:seed:local   # 可选：创建 admin / admin123

npm run dev
```

默认管理员（仅本地 seed）：`admin` / `admin123`

## 部署到 Cloudflare

### 1. 创建 D1 数据库

```bash
wrangler d1 create blog-db
```

将返回的 `database_id` 写入 `wrangler.toml` 的 `[[d1_databases]]` 段。

### 2. 执行迁移（远程）

```bash
npm run db:migrate
# 若数据库已存在，仅需补访问量表时：
npm run db:migrate:page-views
```

生产环境请自行创建管理员账号（可在 D1 控制台执行 SQL，或临时注册后手动改 `role` 为 `admin`）。

### 3. 环境变量（Cloudflare Dashboard → Pages → Settings）

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | 至少 32 字符的随机字符串 |
| `GITHUB_TOKEN` | 有 `repo` 权限的 PAT |
| `GITHUB_OWNER` | GitHub 用户名或组织 |
| `GITHUB_REPO` | 仓库名 |
| `GITHUB_BRANCH` | 默认 `main` |

### 4. 构建与部署

```bash
npm run build
wrangler pages deploy dist --project-name=laomatouziyanjiu
```

或在 Cloudflare Dashboard 连接 GitHub 仓库，构建命令 `npm run build`，输出目录 `dist`，并绑定 D1 数据库。

## 从 X 导入文章

### 自动同步（生产环境）

部署到 Cloudflare Pages 后，**GitHub Actions 每小时**调用 `POST /api/twitter/sync`，拉取 @LMDFinance 时间线并自动导入新的 X 长文与 `#老马行业研究` 帖子（每轮最多 3 篇），经 GitHub API 写入仓库并触发重新构建。

生产环境需配置：

- Cloudflare Pages 密钥：`JWT_SECRET`、`GITHUB_TOKEN`、`GITHUB_OWNER`、`GITHUB_REPO`、`CRON_SECRET`
- GitHub 仓库 Secrets：`CRON_SECRET`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`（用于自动部署 workflow）
- D1 迁移：`migrations/005_twitter_sync.sql` 与 `005_twitter_sync_backfill.sql`（已导入历史推文 ID 防重复）
- `TWITTER_SYNC_DISABLED=1` 可关闭自动同步

本地开发不会触发定时任务；可在管理后台 `/admin/import-twitter` 点击「立即同步」测试。

### 手动导入

管理员可在 `/admin/import-twitter` 页面：

- 浏览 @LMDFinance 时间线上的投研/X 长文
- 粘贴单条 X 链接预览并导入（图片自动下载到 `public/images/blog/`）
- 手动发布时在正文框 **Ctrl/Cmd+V 直接粘贴图片**

本地批量导入（需能访问 X 图片 CDN，国内建议加代理）：

```bash
# 从导航长文提取全部投研链接并导入
HTTPS_PROXY=http://127.0.0.1:7890 npm run import:twitter -- --from-nav

# 仅导入最近时间线
HTTPS_PROXY=http://127.0.0.1:7890 npm run import:twitter -- --limit 30 --pages 5

# 导入单条
HTTPS_PROXY=http://127.0.0.1:7890 npm run import:twitter -- --url 'https://x.com/LMDFinance/status/...'
```

线上导入（管理后台）通过 GitHub API 写入仓库，无需本地代理。

## API

| 方法 | 路径 | 权限 |
|------|------|------|
| POST | `/api/auth/register` | 公开 |
| POST | `/api/auth/login` | 公开 |
| POST | `/api/auth/logout` | 公开 |
| GET | `/api/auth/me` | 公开 |
| GET | `/api/comments?article_id=` | 公开 |
| POST | `/api/comments` | 登录用户 |
| POST | `/api/articles` | 管理员 |
| POST | `/api/upload-image` | 管理员 |
| GET | `/api/twitter/preview` | 管理员 |
| POST | `/api/twitter/import` | 管理员 |
| GET | `/api/twitter/sync` | 管理员 |
| POST | `/api/twitter/sync` | 管理员或 `Authorization: Bearer CRON_SECRET` |
| GET | `/api/admin/stats` | 管理员 |
| POST | `/api/analytics/view` | 公开（页面浏览上报） |

管理员登录后进入 `/admin` 可查看注册用户、访问量、会员码与评论概览，并进入会员码 / 对接人 / 发文等子功能。

## 项目结构

```
src/
  content/blog/     # Markdown 文章
  pages/api/        # 全栈 API
  pages/admin/      # 管理员发文
  lib/              # auth、github、env
schema.sql          # D1 表结构
wrangler.toml       # Cloudflare 配置
```
