-- 为已存在的明细表补充任务实际执行时间。
-- 历史数据无法反推出真实执行时间，因此首次迁移使用原 created_at 回填；重新导入 CSV 并同步后会更新为 CSV 执行时间。

alter table if exists dw.auto_comment_run_items
  add column if not exists executed_at timestamptz;

update dw.auto_comment_run_items
set executed_at = created_at
where executed_at is null;

alter table if exists dw.auto_comment_run_items
  alter column executed_at set default now();

alter table if exists dw.auto_comment_run_items
  alter column executed_at set not null;

comment on column dw.auto_comment_run_items.executed_at is '任务实际执行完成时间，来自插件运行现场或导入结果 CSV 的执行时间。';
