-- 006_create_probe_rules.sql
-- 创建垃圾外链与黑名单过滤规则配置表

CREATE TABLE IF NOT EXISTS dw.probe_rules (
    rule_key VARCHAR(64) PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT true,
    rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 初始化官方预置规则：基于用户手写 SQL 与实战经验沉淀
INSERT INTO dw.probe_rules (rule_key, enabled, rules, description, updated_at)
VALUES 
(
    'url_blacklist',
    true,
    '[
        "yahoo.com",
        "8coint.com",
        "gridinsoft.com",
        "ready.pro",
        "linkz.us",
        "pay.",
        "trackitonline",
        "seo",
        "links",
        "yandex.com"
    ]'::jsonb,
    'URL/域名黑名单：在发起网络抓取前（阶段1）零耗时过滤，支持子串与通配符',
    CURRENT_TIMESTAMP
),
(
    'title_blacklist',
    true,
    '[
        "backlink",
        "domain",
        "buy",
        "url shared",
        "seo",
        "links"
    ]'::jsonb,
    '网页标题黑名单：在获取 HTML 头部（阶段2）嗅探并熔断，防止SEO农场与买卖外链站误报',
    CURRENT_TIMESTAMP
)
ON CONFLICT (rule_key) DO NOTHING;
