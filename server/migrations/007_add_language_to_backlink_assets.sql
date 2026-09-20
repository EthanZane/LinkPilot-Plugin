-- 为外链资产库补充语言（Language）字段。
-- 记录博客网站的语言属性（如 en, ja, es, de, fr, zh, ru 等），支持推广小语种目标时同语种资产优先匹配。

alter table if exists dw.backlink_assets
  add column if not exists language text not null default 'en';

comment on column dw.backlink_assets.language is '外链网站/页面主要语言代码（ISO 639-1，如 en, ja, es, de, fr, zh, ru, pt, it, ko 等）。';

create index if not exists idx_backlink_assets_language
  on dw.backlink_assets (language);

-- 优化：从已有域名顶级后缀中，智能校准一些典型小语种域名
update dw.backlink_assets
set language = case
  when referral_domain ~* '\.(jp|co\.jp)$' then 'ja'
  when referral_domain ~* '\.(es|com\.es)$' then 'es'
  when referral_domain ~* '\.(de|at|ch)$' then 'de'
  when referral_domain ~* '\.(fr)$' then 'fr'
  when referral_domain ~* '\.(ru)$' then 'ru'
  when referral_domain ~* '\.(it)$' then 'it'
  when referral_domain ~* '\.(pt|com\.br)$' then 'pt'
  when referral_domain ~* '\.(cn)$' then 'zh'
  when referral_domain ~* '\.(kr|co\.kr)$' then 'ko'
  else language
end
where language = 'en';

-- 如果已有流水中记录了语言信息，按最新流水回填
with latest_lang as (
  select distinct on (referral_domain)
    referral_domain,
    page_metrics->>'language' as lang
  from dw.auto_comment_run_items
  where referral_domain <> ''
    and page_metrics->>'language' is not null
    and page_metrics->>'language' <> ''
  order by referral_domain, executed_at desc, id desc
)
update dw.backlink_assets a
set language = l.lang
from latest_lang l
where a.referral_domain = l.referral_domain
  and l.lang is not null;
