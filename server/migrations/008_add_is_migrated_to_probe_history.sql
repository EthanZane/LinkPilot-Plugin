-- 博客外链探测历史表增加“已迁移/已处理”手动标识与时间戳
alter table dw.probe_history
  add column if not exists is_migrated boolean not null default false,
  add column if not exists migrated_at timestamptz;

comment on column dw.probe_history.is_migrated is '用户手动标记该批次是否已迁移/已处理（如已导入外链资产库或已执行自动外链）';
comment on column dw.probe_history.migrated_at is '手动标记为已迁移的时间戳';

create index if not exists idx_probe_history_is_migrated
  on dw.probe_history (is_migrated);
