# 本地 PostgreSQL 服务方案

当前目录提供一个很轻的 Node HTTP 服务，让插件通过 `http://127.0.0.1:17321` 写入 PostgreSQL。

## 数据库连接配置

当前按你的本机 PostgreSQL 配置：

```text
host: localhost
port: 5499
database: bi
schema: dw
```

本地服务后续可以读取这些环境变量：

```bash
PGHOST=localhost
PGPORT=5499
PGDATABASE=bi
PGSCHEMA=dw
```

如果你的 PostgreSQL 需要账号密码，再额外设置：

```bash
PGUSER=你的用户名
PGPASSWORD=你的密码
```

示例配置见 `server/.env.example`。

## 迁移表结构

迁移脚本会自动创建 `dw` schema，并在 `dw` 下创建两张表：

- `dw.auto_comment_runs`
- `dw.auto_comment_run_items`

执行迁移：

```bash
pnpm db:migrate
```

如果需要临时指定账号密码：

```bash
PGUSER=你的用户名 PGPASSWORD=你的密码 pnpm db:migrate
```

也可以直接使用 `psql`：

```bash
PGHOST=localhost PGPORT=5499 PGDATABASE=bi psql -v ON_ERROR_STOP=1 -f server/migrations/001_init.sql
```

迁移后验证：

```bash
PGHOST=localhost PGPORT=5499 PGDATABASE=bi psql -c "\\dt dw.auto_comment_*"
```

## 推荐部署方式

个人本地使用不需要 Docker 和云服务器，推荐直接在本机常驻一个 Node 进程：

```bash
pnpm install
pnpm server:start
```

等服务稳定后，可以用 macOS `launchd` 做开机自启；如果更习惯 Node 生态，也可以用 `pm2`：

```bash
pnpm add -g pm2
pm2 start server/index.js --name auto-comment-local
pm2 save
pm2 startup
```

## 本地接口

插件批量运行时会自动调用这些接口：

- `GET /health`：检查本地服务和 PostgreSQL 连接。
- `POST /api/runs`：创建或更新批次，写入 `dw.auto_comment_runs`。
- `POST /api/run-items`：写入或更新单条引荐 URL 结果，写入 `dw.auto_comment_run_items`。
- `POST /api/runs/sync-results`：在一个事务内同步批次、全部明细和最终状态；批次完成时会校验明细条数。
- `PATCH /api/runs/:id/status`：批量完成或终止时更新批次状态。
- `GET /api/runs`：查看最近 100 个批次。
- `GET /api/runs/:id/items`：查看某个批次的明细。

插件在批次结束时一定会调用完整同步接口。写入失败时页面会显示错误和“重新写入数据库”按钮；重复点击仍复用 `run_id + url_index` 唯一键，只会更新原记录，不会产生重复明细。

插件启动批次前会先检查 `/health`。检查失败时用户可以继续自动化，结果会完整保存在扩展本地的“本地批次日志”中；也可以取消启动，先执行 `pnpm server:start`。未同步批次保留全部明细，数据库确认同步成功后只保留批次摘要。插件导出的结果 CSV 也可以重新导入并同步。

## 资源消耗

本地服务只负责接收插件上报并写 PostgreSQL，正常空闲时 CPU 接近 0。内存主要来自 Node 运行时，通常几十 MB；PostgreSQL 如果本来就在本机运行，新增两张表和少量索引的额外消耗很小。

## 数据约定

- 目标 URL：目标 URL 管理里选择的站点地址。
- 目标域名：从目标 URL 提取，写入前去掉开头的 `www.`。
- 引荐 URL：批量运行或手动粘贴时要打开并评论的页面。
- 引荐域名：从引荐 URL 或 CSV 引荐域名列提取，写入前去掉开头的 `www.`。
- `auto_comment_run_items.executed_at`：单条任务实际执行完成时间，来自运行现场或导入结果 CSV 的“执行时间”。
- `created_at / updated_at`：数据库记录的首次插入时间和最后更新数据库时间，不代表任务执行时间。
- `auto_comment_runs.started_at / completed_at`：批次在插件侧实际开始和结束的时间。

初始化表结构见 `migrations/001_init.sql`。
