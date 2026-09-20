-- AutoComment / LinkPilot 外链资产库表结构与初始迁移。
-- 核心实体：以 referral_domain 作为主键，记录该域名的入口 URL、类型标记、表现统计与质量评级。

create schema if not exists dw;

create table if not exists dw.backlink_assets (
  referral_domain text primary key,
  referral_url text not null,
  resource_type text not null default 'blog_comment',
  quality_tier text not null default 'untested',
  source_channel text not null default 'manual',
  total_attempts integer not null default 0,
  success_count integer not null default 0,
  fail_count integer not null default 0,
  skipped_count integer not null default 0,
  manual_count integer not null default 0,
  no_box_count integer not null default 0,
  blocked_count integer not null default 0,
  success_rate numeric(5, 2) not null default 0,
  last_run_result text,
  last_run_message text not null default '',
  last_executed_at timestamptz,
  domain_rating numeric(5, 1),
  organic_traffic integer,
  tags text[] not null default array[]::text[],
  notes text not null default '',
  raw_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table dw.backlink_assets is '外链资产库主表。以标准引荐域名为主键，持久化沉淀高价值外链资产。';
comment on column dw.backlink_assets.referral_domain is '引荐域名，主键，写入前去除 www. 与协议并转为小写。';
comment on column dw.backlink_assets.referral_url is '实际提交或入口 URL，如具体的博客文章页或导航站提交页。';
comment on column dw.backlink_assets.resource_type is '外链类型：blog_comment 博客评论，directory_submission 导航目录站，forum_thread 论坛回帖，guest_post 投稿文章等。';
comment on column dw.backlink_assets.quality_tier is '资产质量等级：high_quality 优质可用，manual_needed 需人工介入，broken 失效或无评论框，untested 未测试，blacklisted 风险拦截。';
comment on column dw.backlink_assets.source_channel is '资产来源渠道：semrush, ahrefs, manual_paste, run_harvest 等。';
comment on column dw.backlink_assets.success_rate is '历史成功率（%）：success_count / total_attempts * 100。';

create index if not exists idx_backlink_assets_resource_type
  on dw.backlink_assets (resource_type);

create index if not exists idx_backlink_assets_quality_tier
  on dw.backlink_assets (quality_tier);

create index if not exists idx_backlink_assets_success_rate
  on dw.backlink_assets (success_rate desc);

create index if not exists idx_backlink_assets_last_exec
  on dw.backlink_assets (last_executed_at desc nulls last);

create index if not exists idx_backlink_assets_created_at
  on dw.backlink_assets (created_at desc);

-- 目标站点覆盖统计视图：用于根据目标站点隔离查询（例如：为新站点筛选尚未成功做过的优质外链）。
create or replace view dw.v_backlink_site_coverage as
select
  i.referral_domain,
  i.target_domain,
  count(*)::integer as run_count,
  count(case when i.result in ('success', 'skipped') then 1 end)::integer as success_count,
  max(i.executed_at) as last_success_at
from dw.auto_comment_run_items i
where i.referral_domain <> ''
group by i.referral_domain, i.target_domain;

-- 首次建库回填：自动从已有历史运行明细中聚合数据并注入资产库
insert into dw.backlink_assets (
  referral_domain,
  referral_url,
  resource_type,
  quality_tier,
  source_channel,
  total_attempts,
  success_count,
  fail_count,
  skipped_count,
  manual_count,
  no_box_count,
  blocked_count,
  success_rate,
  last_run_result,
  last_run_message,
  last_executed_at,
  created_at,
  updated_at
)
with latest_items as (
  select distinct on (referral_domain)
    referral_domain,
    referral_url,
    result,
    result_message,
    executed_at
  from dw.auto_comment_run_items
  where referral_domain <> ''
  order by referral_domain, executed_at desc, id desc
),
agg_stats as (
  select
    referral_domain,
    count(case when result <> 'skipped' then 1 end)::integer as total_attempts,
    count(case when result = 'success' then 1 end)::integer as success_count,
    count(case when result = 'fail' then 1 end)::integer as fail_count,
    count(case when result = 'skipped' then 1 end)::integer as skipped_count,
    count(case when result = 'manual_required' then 1 end)::integer as manual_count,
    count(case when result = 'no_comment_box' then 1 end)::integer as no_box_count,
    count(case when result = 'blocked_illegal' then 1 end)::integer as blocked_count,
    min(created_at) as first_seen_at,
    max(executed_at) as last_exec_at
  from dw.auto_comment_run_items
  where referral_domain <> ''
  group by referral_domain
)
select
  s.referral_domain,
  l.referral_url,
  'blog_comment' as resource_type,
  case
    when s.blocked_count > 0 and s.success_count = 0 then 'blacklisted'
    when s.total_attempts > 0 and s.success_count >= 1 and s.success_count::numeric / s.total_attempts::numeric >= 0.5 then 'high_quality'
    when s.total_attempts = 0 and s.skipped_count > 0 then 'high_quality'
    when l.result = 'manual_required' then 'manual_needed'
    when s.no_box_count >= 2 or (s.total_attempts >= 2 and s.success_count = 0) then 'broken'
    when s.success_count > 0 then 'high_quality'
    else 'untested'
  end as quality_tier,
  'run_harvest' as source_channel,
  s.total_attempts,
  s.success_count,
  s.fail_count,
  s.skipped_count,
  s.manual_count,
  s.no_box_count,
  s.blocked_count,
  case
    when s.total_attempts > 0 then round((s.success_count::numeric / s.total_attempts::numeric) * 100, 1)
    when s.skipped_count > 0 then 100.0
    else 0.0
  end as success_rate,
  l.result as last_run_result,
  coalesce(l.result_message, '') as last_run_message,
  coalesce(l.executed_at, s.last_exec_at) as last_executed_at,
  coalesce(s.first_seen_at, now()) as created_at,
  now() as updated_at
from agg_stats s
join latest_items l on s.referral_domain = l.referral_domain
on conflict (referral_domain) do nothing;
