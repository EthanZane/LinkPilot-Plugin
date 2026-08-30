-- AutoComment 本地 PostgreSQL 初始化结构。
-- 约定：所有域名字段在写入前统一去掉开头的 www.，并转换为小写。

create schema if not exists dw;

create table if not exists dw.auto_comment_runs (
  id uuid primary key,
  target_url text not null,
  target_domain text not null,
  target_name text not null default '',
  total_count integer not null default 0,
  status text not null default 'running',
  source_type text not null default '',
  source_name text not null default '',
  raw_config jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table dw.auto_comment_runs is '批量运行批次。一次点击开始批量处理对应一条记录。';
comment on column dw.auto_comment_runs.target_url is '目标 URL，即目标 URL 管理里选择的站点地址。';
comment on column dw.auto_comment_runs.target_domain is '目标域名，由目标 URL 提取，写入前去掉 www.。';
comment on column dw.auto_comment_runs.status is '批次状态：running 运行中，completed 已完成，terminated 已终止。';

create table if not exists dw.auto_comment_run_items (
  id bigserial primary key,
  run_id uuid not null references dw.auto_comment_runs(id) on delete cascade,
  url_index integer not null,
  referral_url text not null,
  referral_domain text not null,
  target_url text not null,
  target_domain text not null,
  result text not null,
  result_message text not null default '',
  ai_content text,
  elapsed_seconds integer,
  page_metrics jsonb not null default '{}'::jsonb,
  original_row jsonb not null default '[]'::jsonb,
  executed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, url_index)
);

-- 兼容已经由旧版 001_init.sql 创建的表；CREATE TABLE IF NOT EXISTS 不会自动补新增列。
alter table if exists dw.auto_comment_run_items
  add column if not exists executed_at timestamptz;

comment on table dw.auto_comment_run_items is '批量运行明细。每个引荐 URL 对应一条执行结果。';
comment on column dw.auto_comment_run_items.referral_url is '引荐 URL，即批量运行或手动粘贴时要打开并评论的页面。';
comment on column dw.auto_comment_run_items.referral_domain is '引荐域名，由引荐 URL 或 CSV 引荐域名列提取，写入前去掉 www.。';
comment on column dw.auto_comment_run_items.target_url is '目标 URL，冗余保存批次锁定的目标地址，便于直接查询明细。';
comment on column dw.auto_comment_run_items.target_domain is '目标域名，由目标 URL 提取，写入前去掉 www.。';
comment on column dw.auto_comment_run_items.result is '执行结果：success 成功，skipped 已存在，manual_required 需手动处理，no_comment_box 无评论框，blocked_illegal 非法拦截，fail 失败。';
comment on column dw.auto_comment_run_items.executed_at is '任务实际执行完成时间，来自插件运行现场或导入结果 CSV 的执行时间。';

create index if not exists idx_auto_comment_runs_started_at
  on dw.auto_comment_runs (started_at desc);

create index if not exists idx_auto_comment_run_items_referral_domain
  on dw.auto_comment_run_items (referral_domain);

create index if not exists idx_auto_comment_run_items_target_domain
  on dw.auto_comment_run_items (target_domain);

create index if not exists idx_auto_comment_run_items_result
  on dw.auto_comment_run_items (result);
