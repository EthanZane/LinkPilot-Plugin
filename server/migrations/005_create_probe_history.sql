-- 博客外链探测历史记录表：持久化沉淀探测批次，防止关闭插件或重新安装插件导致校对数据丢失
create table if not exists dw.probe_history (
  id text primary key,
  title text not null default '',
  status text not null default 'completed',
  total_count integer not null default 0,
  processed_count integer not null default 0,
  raw_count integer not null default 0,
  dedup_count integer not null default 0,
  already_in_library_count integer not null default 0,
  valid_blog_count integer not null default 0,
  closed_or_login_count integer not null default 0,
  not_blog_count integer not null default 0,
  failed_count integer not null default 0,
  concurrency integer not null default 20,
  timeout_ms integer not null default 8000,
  elapsed_seconds integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table dw.probe_history is '博客外链探测历史归档表。支持断点校对、免去关浏览器或重装插件造成结果丢失风险。';
comment on column dw.probe_history.id is '批次会话唯一 ID (sessionId)';
comment on column dw.probe_history.results is '全量探测结果明细（JSON 数组）';
comment on column dw.probe_history.stats is '分类指标统计对象汇总（JSON 对象）';

create index if not exists idx_probe_history_created_at
  on dw.probe_history (created_at desc);

create index if not exists idx_probe_history_status
  on dw.probe_history (status);
