-- 为外链资产库补充页面深度指标字段。
-- 记录实际测得的页面深度（屏数），便于识别因历史评论过多而过深的页面，引导替换为该站评论较少的浅页面。

alter table if exists dw.backlink_assets
  add column if not exists page_depth numeric(7, 1);

comment on column dw.backlink_assets.page_depth is '页面深度（屏数）。来自自动化运行时实际访问测量的页面总高度/视口高度。若过深说明评论过多，建议更换该站浅页面。';

create index if not exists idx_backlink_assets_page_depth
  on dw.backlink_assets (page_depth);

-- 从现有运行流水明细中，聚合回填各引荐域名的最新页面深度
with latest_depth as (
  select distinct on (referral_domain)
    referral_domain,
    round((page_metrics->>'pageDepthScreens')::numeric, 1) as depth
  from dw.auto_comment_run_items
  where referral_domain <> ''
    and page_metrics->>'pageDepthScreens' is not null
    and (page_metrics->>'pageDepthScreens')::numeric > 0
  order by referral_domain, executed_at desc, id desc
)
update dw.backlink_assets a
set page_depth = l.depth
from latest_depth l
where a.referral_domain = l.referral_domain;
