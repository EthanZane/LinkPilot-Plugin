import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const DEFAULT_PORT = 17321;
const DEFAULT_PG_HOST = 'localhost';
const DEFAULT_PG_PORT = '5499';
const DEFAULT_PG_DATABASE = 'bi';
const DEFAULT_PG_SCHEMA = 'dw';
// 完整批次会携带 AI 内容和页面指标，按页面建议的 5,000 条上限预留 25MB 请求体空间。
const MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * 读取本地环境配置文件。优先使用 server/.env，避免把数据库连接信息写死在代码里。
 */
function loadLocalEnv() {
  const envFiles = [
    resolve(process.cwd(), 'server/.env'),
    resolve(process.cwd(), '.env')
  ];

  for (const file of envFiles) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) return;
      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
  }
}

loadLocalEnv();

const config = {
  serverPort: Number(process.env.AUTO_COMMENT_SERVER_PORT || DEFAULT_PORT),
  pgHost: process.env.PGHOST || DEFAULT_PG_HOST,
  pgPort: Number(process.env.PGPORT || DEFAULT_PG_PORT),
  pgDatabase: process.env.PGDATABASE || DEFAULT_PG_DATABASE,
  pgSchema: process.env.PGSCHEMA || DEFAULT_PG_SCHEMA,
  pgUser: process.env.PGUSER || undefined,
  pgPassword: process.env.PGPASSWORD || undefined
};

const pool = new Pool({
  host: config.pgHost,
  port: config.pgPort,
  database: config.pgDatabase,
  user: config.pgUser,
  password: config.pgPassword,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

/**
 * 限制 schema 名只能由字母、数字和下划线组成，避免动态表名前缀产生 SQL 注入风险。
 */
function quoteSchemaName(schema) {
  const normalized = String(schema || DEFAULT_PG_SCHEMA).trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(normalized)) {
    throw new Error(`非法 PGSCHEMA：${normalized}`);
  }
  return `"${normalized}"`;
}

const schemaSql = quoteSchemaName(config.pgSchema);
const runsTable = `${schemaSql}.auto_comment_runs`;
const runItemsTable = `${schemaSql}.auto_comment_run_items`;
const assetsTable = `${schemaSql}.backlink_assets`;

/**
 * 将任意 URL 或域名转换成标准域名：去掉协议、路径和开头的 www.，并统一小写。
 */
function normalizeDomain(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return text.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').toLowerCase();
  }
}

/**
 * 统一响应头，允许 Chrome 扩展和本机页面跨域调用本地服务。
 */
function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  response.end(JSON.stringify(payload));
}

function writeNoContent(response) {
  response.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  response.end();
}

/**
 * 安全读取请求体，避免异常大 payload 占用本机内存。
 */
function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
        rejectBody(new Error('请求体超过 25MB 限制'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!raw) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch (_) {
        rejectBody(new Error('请求体不是合法 JSON'));
      }
    });
    request.on('error', rejectBody);
  });
}

function requireText(payload, fieldName) {
  const value = String(payload[fieldName] || '').trim();
  if (!value) throw new Error(`缺少必填字段：${fieldName}`);
  return value;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function jsonValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value;
}

/**
 * 校验并规范化客户端记录的实际时间，避免非法日期进入 PostgreSQL。
 */
function timestampOrNull(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`字段 ${fieldName} 不是合法时间`);
  return date.toISOString();
}

/**
 * 创建或更新批次。插件启动一次批量运行时调用。
 */
async function upsertRun(payload, database = pool) {
  const id = requireText(payload, 'id');
  const targetUrl = requireText(payload, 'targetUrl');
  const targetDomain = normalizeDomain(payload.targetDomain || targetUrl);
  const targetName = String(payload.targetName || '').trim();
  const totalCount = Number.isFinite(Number(payload.totalCount)) ? Number(payload.totalCount) : 0;
  const status = String(payload.status || 'running').trim();
  const sourceType = String(payload.sourceType || '').trim();
  const sourceName = String(payload.sourceName || '').trim();
  const rawConfig = jsonValue(payload.rawConfig, {});
  const startedAt = timestampOrNull(payload.startedAt, 'startedAt') || new Date().toISOString();
  const completedAt = timestampOrNull(payload.completedAt, 'completedAt');

  const result = await database.query(
    `
      insert into ${runsTable}
        (id, target_url, target_domain, target_name, total_count, status, source_type, source_name, raw_config, started_at, completed_at)
      values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz, $11::timestamptz)
      on conflict (id) do update set
        target_url = excluded.target_url,
        target_domain = excluded.target_domain,
        target_name = excluded.target_name,
        total_count = excluded.total_count,
        status = excluded.status,
        source_type = excluded.source_type,
        source_name = excluded.source_name,
        raw_config = excluded.raw_config,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at
      returning *
    `,
    [id, targetUrl, targetDomain, targetName, totalCount, status, sourceType, sourceName, JSON.stringify(rawConfig), startedAt, completedAt]
  );
  return result.rows[0];
}

/**
 * 写入或更新单条引荐 URL 运行结果。使用 run_id + url_index 做幂等键，避免重复上报产生脏数据。
 */
async function upsertRunItem(payload, database = pool) {
  const runId = requireText(payload, 'runId');
  const urlIndex = Number(payload.urlIndex);
  if (!Number.isInteger(urlIndex)) throw new Error('缺少必填字段：urlIndex');

  const referralUrl = requireText(payload, 'referralUrl');
  const targetUrl = requireText(payload, 'targetUrl');
  const referralDomain = normalizeDomain(payload.referralDomain || referralUrl);
  const targetDomain = normalizeDomain(payload.targetDomain || targetUrl);
  const resultCode = requireText(payload, 'result');
  const resultMessage = String(payload.resultMessage || payload.errorMessage || '').trim();
  const aiContent = payload.aiContent == null ? null : String(payload.aiContent);
  const elapsedSeconds = numberOrNull(payload.elapsedSeconds);
  const pageMetrics = jsonValue(payload.pageMetrics, {});
  const originalRow = jsonValue(payload.originalRow, []);
  const executedAt = timestampOrNull(payload.executedAt, 'executedAt') || new Date().toISOString();

  const result = await database.query(
    `
      insert into ${runItemsTable}
        (
          run_id, url_index, referral_url, referral_domain, target_url, target_domain,
          result, result_message, ai_content, elapsed_seconds, page_metrics, original_row, executed_at
        )
      values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::timestamptz)
      on conflict (run_id, url_index) do update set
        referral_url = excluded.referral_url,
        referral_domain = excluded.referral_domain,
        target_url = excluded.target_url,
        target_domain = excluded.target_domain,
        result = excluded.result,
        result_message = excluded.result_message,
        ai_content = excluded.ai_content,
        elapsed_seconds = excluded.elapsed_seconds,
        page_metrics = excluded.page_metrics,
        original_row = excluded.original_row,
        executed_at = excluded.executed_at,
        updated_at = now()
      returning *
    `,
    [
      runId,
      urlIndex,
      referralUrl,
      referralDomain,
      targetUrl,
      targetDomain,
      resultCode,
      resultMessage,
      aiContent,
      elapsedSeconds,
      JSON.stringify(pageMetrics),
      JSON.stringify(originalRow),
      executedAt
    ]
  );
  return result.rows[0];
}

/**
 * 更新批次状态。批量完成、终止或手动修正状态时调用。
 */
async function updateRunStatus(runId, status, completedAt, database = pool) {
  const finalStatus = String(status || '').trim();
  if (!finalStatus) throw new Error('缺少必填字段：status');
  const actualCompletedAt = timestampOrNull(completedAt, 'completedAt');
  const result = await database.query(
    `
      update ${runsTable}
      set
        status = $2,
        completed_at = case
          when $2 in ('completed', 'terminated') then coalesce($3::timestamptz, now())
          else completed_at
        end
      where id = $1
      returning *
    `,
    [runId, finalStatus, actualCompletedAt]
  );
  if (result.rowCount === 0) throw new Error(`批次不存在：${runId}`);
  return result.rows[0];
}

/**
 * 以单个事务同步完整批次，确保批次主记录、全部明细和最终状态不会只写入一部分。
 * 重复同步时复用主表 ID，并通过 run_id + url_index 唯一键覆盖明细，因此可安全重试。
 */
async function syncRunResults(payload) {
  const runPayload = payload && payload.run;
  const items = Array.isArray(payload && payload.items) ? payload.items : null;
  if (!runPayload || typeof runPayload !== 'object') throw new Error('缺少必填字段：run');
  if (!items) throw new Error('缺少必填字段：items');

  const runId = requireText(runPayload, 'id');
  const expectedCount = Number(runPayload.totalCount);
  if (!Number.isInteger(expectedCount) || expectedCount < 0) {
    throw new Error('字段 totalCount 必须是非负整数');
  }
  if (items.length > expectedCount) {
    throw new Error(`明细数量 ${items.length} 超过批次总数 ${expectedCount}`);
  }

  const seenIndexes = new Set();
  items.forEach((item) => {
    const urlIndex = Number(item && item.urlIndex);
    if (!Number.isInteger(urlIndex) || urlIndex < 0 || urlIndex >= expectedCount) {
      throw new Error(`明细 urlIndex 非法：${item && item.urlIndex}`);
    }
    if (seenIndexes.has(urlIndex)) throw new Error(`明细 urlIndex 重复：${urlIndex}`);
    seenIndexes.add(urlIndex);
  });

  const finalStatus = String(payload.status || runPayload.status || 'completed').trim();
  if (finalStatus === 'completed' && items.length !== expectedCount) {
    throw new Error(`完整批次应写入 ${expectedCount} 条明细，当前仅收到 ${items.length} 条`);
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    await upsertRun({ ...runPayload, id: runId, status: finalStatus }, client);
    for (const item of items) {
      await upsertRunItem({ ...item, runId }, client);
    }
    // 完整同步以当前快照为准，清理同批次中已不属于本次提交的旧明细。
    const submittedIndexes = items.map((item) => Number(item.urlIndex));
    await client.query(
      `delete from ${runItemsTable} where run_id = $1 and not (url_index = any($2::integer[]))`,
      [runId, submittedIndexes]
    );
    const run = await updateRunStatus(runId, finalStatus, runPayload.completedAt, client);
    const countResult = await client.query(
      `select count(*)::integer as count from ${runItemsTable} where run_id = $1`,
      [runId]
    );
    const persistedCount = countResult.rows[0].count;
    if (persistedCount !== items.length) {
      throw new Error(`数据库校验失败：应写入 ${items.length} 条明细，实际 ${persistedCount} 条`);
    }
    const distinctDomains = Array.from(
      new Set(items.map((i) => normalizeDomain(i.referralDomain || i.referralUrl)).filter(Boolean))
    );
    if (distinctDomains.length > 0) {
      await refreshAssetsForDomains(distinctDomains, client);
    }
    await client.query('commit');
    return { run, persistedCount };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function listRuns() {
  const result = await pool.query(
    `
      select
        r.*,
        coalesce(count(i.id), 0)::integer as processed_count,
        count(case when i.result = 'success' then 1 end)::integer as success_count,
        count(case when i.result = 'skipped' then 1 end)::integer as skipped_count,
        count(case when i.result = 'manual_required' then 1 end)::integer as manual_required_count,
        count(case when i.result = 'no_comment_box' then 1 end)::integer as no_comment_box_count,
        count(case when i.result = 'blocked_illegal' then 1 end)::integer as blocked_illegal_count,
        count(case when i.result = 'fail' then 1 end)::integer as fail_count
      from ${runsTable} r
      left join ${runItemsTable} i on r.id = i.run_id
      group by r.id
      order by r.started_at desc
      limit 100
    `
  );
  return result.rows;
}

async function listRunItems(runId) {
  const result = await pool.query(
    `
      select *
      from ${runItemsTable}
      where run_id = $1
      order by url_index asc
    `,
    [runId]
  );
  return result.rows;
}

/**
 * 查询指定目标站点所有历史成功/已存在的引荐 URL 及当时批次信息，用于跑批前精准去重。
 */
async function listTargetSuccessItems(targetUrl) {
  const normalizedTarget = String(targetUrl || '').trim();
  const normalizedTargetDomain = normalizeDomain(normalizedTarget);
  if (!normalizedTarget && !normalizedTargetDomain) return [];

  const result = await pool.query(
    `
      select distinct on (referral_url)
        referral_url as "referralUrl",
        run_id as "runId",
        target_url as "targetUrl",
        target_domain as "targetDomain",
        result,
        result_message as "resultMessage",
        ai_content as "aiContent",
        executed_at as "executedAt"
      from ${runItemsTable}
      where
        (target_url = $1 or target_domain = $2)
        and result in ('success', 'skipped')
      order by referral_url, executed_at desc
    `,
    [normalizedTarget, normalizedTargetDomain]
  );
  return result.rows;
}

/**
 * 刷新指定域名的资产统计指标。从运行明细中重新聚合成功率、次数与最新状态。
 */
async function refreshAssetsForDomains(domains, database = pool) {
  const cleanDomains = Array.from(new Set((domains || []).map(normalizeDomain).filter(Boolean)));
  if (cleanDomains.length === 0) return 0;

  const result = await database.query(
    `
      insert into ${assetsTable} (
        referral_domain, referral_url, resource_type, quality_tier, source_channel,
        total_attempts, success_count, fail_count, skipped_count, manual_count,
        no_box_count, blocked_count, success_rate, last_run_result, last_run_message,
        last_executed_at, updated_at
      )
      with latest_items as (
        select distinct on (referral_domain)
          referral_domain, referral_url, result, result_message, executed_at
        from ${runItemsTable}
        where referral_domain = any($1::text[])
        order by referral_domain, executed_at desc, id desc
      ),
      agg_stats as (
        select
          referral_domain,
          count(*)::integer as total_attempts,
          count(case when result = 'success' then 1 end)::integer as success_count,
          count(case when result = 'fail' then 1 end)::integer as fail_count,
          count(case when result = 'skipped' then 1 end)::integer as skipped_count,
          count(case when result = 'manual_required' then 1 end)::integer as manual_count,
          count(case when result = 'no_comment_box' then 1 end)::integer as no_box_count,
          count(case when result = 'blocked_illegal' then 1 end)::integer as blocked_count,
          max(executed_at) as last_exec_at
        from ${runItemsTable}
        where referral_domain = any($1::text[])
        group by referral_domain
      )
      select
        s.referral_domain,
        l.referral_url,
        'blog_comment' as resource_type,
        case
          when s.blocked_count > 0 and s.success_count = 0 then 'blacklisted'
          when s.success_count >= 1 and (s.success_count + s.skipped_count)::numeric / s.total_attempts::numeric >= 0.5 then 'high_quality'
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
        round(((s.success_count + s.skipped_count)::numeric / s.total_attempts::numeric) * 100, 2) as success_rate,
        l.result as last_run_result,
        coalesce(l.result_message, '') as last_run_message,
        coalesce(l.executed_at, s.last_exec_at) as last_executed_at,
        now() as updated_at
      from agg_stats s
      join latest_items l on s.referral_domain = l.referral_domain
      on conflict (referral_domain) do update set
        referral_url = excluded.referral_url,
        total_attempts = excluded.total_attempts,
        success_count = excluded.success_count,
        fail_count = excluded.fail_count,
        skipped_count = excluded.skipped_count,
        manual_count = excluded.manual_count,
        no_box_count = excluded.no_box_count,
        blocked_count = excluded.blocked_count,
        success_rate = excluded.success_rate,
        last_run_result = excluded.last_run_result,
        last_run_message = excluded.last_run_message,
        last_executed_at = excluded.last_executed_at,
        quality_tier = case
          when ${assetsTable}.quality_tier = 'blacklisted' then 'blacklisted'
          else excluded.quality_tier
        end,
        updated_at = now()
    `,
    [cleanDomains]
  );
  return result.rowCount;
}

/**
 * 历史数据全量建库回填。
 */
async function bootstrapAssets(database = pool) {
  const result = await database.query(
    `
      insert into ${assetsTable} (
        referral_domain, referral_url, resource_type, quality_tier, source_channel,
        total_attempts, success_count, fail_count, skipped_count, manual_count,
        no_box_count, blocked_count, success_rate, last_run_result, last_run_message,
        last_executed_at, created_at, updated_at
      )
      with latest_items as (
        select distinct on (referral_domain)
          referral_domain, referral_url, result, result_message, executed_at
        from ${runItemsTable}
        where referral_domain <> ''
        order by referral_domain, executed_at desc, id desc
      ),
      agg_stats as (
        select
          referral_domain,
          count(*)::integer as total_attempts,
          count(case when result = 'success' then 1 end)::integer as success_count,
          count(case when result = 'fail' then 1 end)::integer as fail_count,
          count(case when result = 'skipped' then 1 end)::integer as skipped_count,
          count(case when result = 'manual_required' then 1 end)::integer as manual_count,
          count(case when result = 'no_comment_box' then 1 end)::integer as no_box_count,
          count(case when result = 'blocked_illegal' then 1 end)::integer as blocked_count,
          min(created_at) as first_seen_at,
          max(executed_at) as last_exec_at
        from ${runItemsTable}
        where referral_domain <> ''
        group by referral_domain
      )
      select
        s.referral_domain,
        l.referral_url,
        'blog_comment' as resource_type,
        case
          when s.blocked_count > 0 and s.success_count = 0 then 'blacklisted'
          when s.success_count >= 1 and (s.success_count + s.skipped_count)::numeric / s.total_attempts::numeric >= 0.5 then 'high_quality'
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
        round(((s.success_count + s.skipped_count)::numeric / s.total_attempts::numeric) * 100, 2) as success_rate,
        l.result as last_run_result,
        coalesce(l.result_message, '') as last_run_message,
        coalesce(l.executed_at, s.last_exec_at) as last_executed_at,
        coalesce(s.first_seen_at, now()) as created_at,
        now() as updated_at
      from agg_stats s
      join latest_items l on s.referral_domain = l.referral_domain
      on conflict (referral_domain) do update set
        referral_url = excluded.referral_url,
        total_attempts = excluded.total_attempts,
        success_count = excluded.success_count,
        fail_count = excluded.fail_count,
        skipped_count = excluded.skipped_count,
        manual_count = excluded.manual_count,
        no_box_count = excluded.no_box_count,
        blocked_count = excluded.blocked_count,
        success_rate = excluded.success_rate,
        last_run_result = excluded.last_run_result,
        last_run_message = excluded.last_run_message,
        last_executed_at = excluded.last_executed_at,
        quality_tier = case
          when ${assetsTable}.quality_tier = 'blacklisted' then 'blacklisted'
          else excluded.quality_tier
        end,
        updated_at = now()
    `
  );
  return { updatedCount: result.rowCount };
}

/**
 * 获取外链资产库总体指标概览（各等级数量、各类型数量、平均成功率）。
 */
async function getAssetsSummary(database = pool) {
  const summaryResult = await database.query(
    `
      select
        count(*)::integer as total,
        count(case when quality_tier = 'high_quality' then 1 end)::integer as high_quality_count,
        count(case when quality_tier = 'manual_needed' then 1 end)::integer as manual_needed_count,
        count(case when quality_tier = 'broken' then 1 end)::integer as broken_count,
        count(case when quality_tier = 'untested' then 1 end)::integer as untested_count,
        count(case when quality_tier = 'blacklisted' then 1 end)::integer as blacklisted_count,
        coalesce(round(avg(case when total_attempts > 0 then success_rate end), 1), 0)::numeric as avg_success_rate
      from ${assetsTable}
    `
  );

  const typesResult = await database.query(
    `
      select resource_type, count(*)::integer as count
      from ${assetsTable}
      group by resource_type
    `
  );

  const byType = {};
  typesResult.rows.forEach((row) => {
    byType[row.resource_type] = row.count;
  });

  const row = summaryResult.rows[0] || {};
  return {
    total: Number(row.total || 0),
    highQualityCount: Number(row.high_quality_count || 0),
    manualNeededCount: Number(row.manual_needed_count || 0),
    brokenCount: Number(row.broken_count || 0),
    untestedCount: Number(row.untested_count || 0),
    blacklistedCount: Number(row.blacklisted_count || 0),
    avgSuccessRate: Number(row.avg_success_rate || 0),
    byType
  };
}

/**
 * 分页、多维度过滤查询外链资产列表。
 */
async function listAssets(params, database = pool) {
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(200, Math.max(10, Number(params.pageSize || 50)));
  const offset = (page - 1) * pageSize;

  const resourceType = String(params.resourceType || 'all').trim();
  const qualityTier = String(params.qualityTier || 'all').trim();
  const minSuccessRate = numberOrNull(params.minSuccessRate);
  const maxSuccessRate = numberOrNull(params.maxSuccessRate);
  const targetDomain = normalizeDomain(params.targetDomain || '');
  const targetSiteStatus = String(params.targetSiteStatus || 'all').trim();
  const keyword = String(params.keyword || '').trim();

  const allowedSortCols = {
    success_rate: 'a.success_rate',
    total_attempts: 'a.total_attempts',
    last_executed_at: 'a.last_executed_at',
    created_at: 'a.created_at',
    referral_domain: 'a.referral_domain'
  };
  const sortByCol = allowedSortCols[params.sortBy] || 'a.success_rate';
  const sortOrder = String(params.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  const whereConditions = [];
  const values = [];
  let paramIndex = 1;

  if (resourceType && resourceType !== 'all') {
    whereConditions.push(`a.resource_type = $${paramIndex++}`);
    values.push(resourceType);
  }

  if (qualityTier && qualityTier !== 'all') {
    whereConditions.push(`a.quality_tier = $${paramIndex++}`);
    values.push(qualityTier);
  }

  if (minSuccessRate !== null) {
    whereConditions.push(`a.success_rate >= $${paramIndex++}`);
    values.push(minSuccessRate);
  }

  if (maxSuccessRate !== null) {
    whereConditions.push(`a.success_rate <= $${paramIndex++}`);
    values.push(maxSuccessRate);
  }

  if (targetDomain && targetSiteStatus === 'never_succeeded') {
    whereConditions.push(`not exists (
      select 1 from ${runItemsTable} i
      where i.referral_domain = a.referral_domain
        and (i.target_domain = $${paramIndex} or i.target_url like '%' || $${paramIndex} || '%')
        and i.result in ('success', 'skipped')
    )`);
    values.push(targetDomain);
    paramIndex++;
  } else if (targetDomain && targetSiteStatus === 'succeeded') {
    whereConditions.push(`exists (
      select 1 from ${runItemsTable} i
      where i.referral_domain = a.referral_domain
        and (i.target_domain = $${paramIndex} or i.target_url like '%' || $${paramIndex} || '%')
        and i.result in ('success', 'skipped')
    )`);
    values.push(targetDomain);
    paramIndex++;
  } else if (targetDomain && targetSiteStatus === 'never_run') {
    whereConditions.push(`not exists (
      select 1 from ${runItemsTable} i
      where i.referral_domain = a.referral_domain
        and (i.target_domain = $${paramIndex} or i.target_url like '%' || $${paramIndex} || '%')
    )`);
    values.push(targetDomain);
    paramIndex++;
  }

  if (keyword) {
    whereConditions.push(`(
      a.referral_domain ilike $${paramIndex}
      or a.referral_url ilike $${paramIndex}
      or a.notes ilike $${paramIndex}
      or array_to_string(a.tags, ',') ilike $${paramIndex}
    )`);
    values.push(`%${keyword}%`);
    paramIndex++;
  }

  const whereClause = whereConditions.length > 0 ? `where ${whereConditions.join(' and ')}` : '';

  const countQuery = `select count(*)::integer as total from ${assetsTable} a ${whereClause}`;
  const countResult = await database.query(countQuery, values);
  const total = countResult.rows[0].total;

  const dataQuery = `
    select
      a.*,
      coalesce(
        (select jsonb_agg(jsonb_build_object('target_domain', cov.target_domain, 'success_count', cov.success_count, 'last_success_at', cov.last_success_at))
         from dw.v_backlink_site_coverage cov
         where cov.referral_domain = a.referral_domain),
        '[]'::jsonb
      ) as target_coverage
    from ${assetsTable} a
    ${whereClause}
    order by ${sortByCol} ${sortOrder} nulls last, a.referral_domain asc
    limit $${paramIndex++} offset $${paramIndex++}
  `;
  const dataResult = await database.query(dataQuery, [...values, pageSize, offset]);

  return {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
    items: dataResult.rows
  };
}

/**
 * 批量导入外链资产。支持域名解析、组内去重、库内查重、非法过滤与选择性更新。
 */
async function importAssets(payload, database = pool) {
  const rawItems = Array.isArray(payload && payload.items) ? payload.items : [];
  const duplicateStrategy = payload && payload.duplicateStrategy === 'update_url' ? 'update_url' : 'skip';
  const defaultType = String(payload && payload.defaultType || 'blog_comment').trim();
  const sourceChannel = String(payload && payload.sourceChannel || 'batch_import').trim();

  if (rawItems.length === 0) {
    throw new Error('导入列表为空');
  }

  const seenInBatch = new Set();
  const validItems = [];
  let invalidCount = 0;

  for (const item of rawItems) {
    const rawUrl = String(item.referralUrl || item.url || '').trim();
    const rawDomain = String(item.referralDomain || item.domain || '').trim();
    const normalizedDomain = normalizeDomain(rawDomain || rawUrl);

    if (!normalizedDomain || !normalizedDomain.includes('.') || normalizedDomain === 'localhost') {
      invalidCount++;
      continue;
    }

    if (seenInBatch.has(normalizedDomain)) {
      continue;
    }
    seenInBatch.add(normalizedDomain);

    const fullUrl = rawUrl
      ? rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
        ? rawUrl
        : `https://${rawUrl}`
      : `https://${normalizedDomain}`;

    validItems.push({
      referral_domain: normalizedDomain,
      referral_url: fullUrl,
      resource_type: String(item.resourceType || defaultType || 'blog_comment').trim(),
      source_channel: sourceChannel,
      domain_rating: numberOrNull(item.domainRating || item.asScore),
      organic_traffic: numberOrNull(item.organicTraffic),
      tags: Array.isArray(item.tags)
        ? item.tags
        : item.tags
        ? String(item.tags).split(',').map((t) => t.trim()).filter(Boolean)
        : [],
      notes: String(item.notes || '').trim()
    });
  }

  if (validItems.length === 0) {
    return {
      total: rawItems.length,
      insertedCount: 0,
      skippedCount: 0,
      invalidCount,
      insertedDomains: [],
      skippedDomains: []
    };
  }

  const allDomains = validItems.map((i) => i.referral_domain);
  const existingRes = await database.query(
    `select referral_domain from ${assetsTable} where referral_domain = any($1::text[])`,
    [allDomains]
  );
  const existingSet = new Set(existingRes.rows.map((r) => r.referral_domain));

  const toInsert = [];
  const toSkip = [];

  validItems.forEach((item) => {
    if (existingSet.has(item.referral_domain)) {
      toSkip.push(item);
    } else {
      toInsert.push(item);
    }
  });

  if (toInsert.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const valuePlaceholders = [];
      const queryValues = [];
      let idx = 1;

      chunk.forEach((item) => {
        valuePlaceholders.push(`($${idx++}, $${idx++}, $${idx++}, 'untested', $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        queryValues.push(
          item.referral_domain,
          item.referral_url,
          item.resource_type,
          item.source_channel,
          item.domain_rating,
          item.organic_traffic,
          item.tags,
          item.notes
        );
      });

      await database.query(
        `
          insert into ${assetsTable} (
            referral_domain, referral_url, resource_type, quality_tier,
            source_channel, domain_rating, organic_traffic, tags, notes
          )
          values ${valuePlaceholders.join(', ')}
          on conflict (referral_domain) do nothing
        `,
        queryValues
      );
    }
  }

  if (duplicateStrategy === 'update_url' && toSkip.length > 0) {
    for (const item of toSkip) {
      await database.query(
        `update ${assetsTable} set referral_url = $2, updated_at = now() where referral_domain = $1`,
        [item.referral_domain, item.referral_url]
      );
    }
  }

  return {
    total: rawItems.length,
    insertedCount: toInsert.length,
    skippedCount: toSkip.length,
    invalidCount,
    insertedDomains: toInsert.slice(0, 100).map((i) => i.referral_domain),
    skippedDomains: toSkip.slice(0, 100).map((i) => i.referral_domain)
  };
}

/**
 * 更新单条外链资产信息。
 */
async function updateAsset(domain, payload, database = pool) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) throw new Error('缺少合法域名');

  const fields = [];
  const values = [normalizedDomain];
  let idx = 2;

  if (payload.resourceType !== undefined) {
    fields.push(`resource_type = $${idx++}`);
    values.push(String(payload.resourceType || 'blog_comment').trim());
  }
  if (payload.referralUrl !== undefined) {
    fields.push(`referral_url = $${idx++}`);
    values.push(String(payload.referralUrl).trim());
  }
  if (payload.qualityTier !== undefined) {
    fields.push(`quality_tier = $${idx++}`);
    values.push(String(payload.qualityTier).trim());
  }
  if (payload.notes !== undefined) {
    fields.push(`notes = $${idx++}`);
    values.push(String(payload.notes).trim());
  }
  if (payload.tags !== undefined) {
    fields.push(`tags = $${idx++}`);
    values.push(Array.isArray(payload.tags) ? payload.tags : []);
  }

  if (fields.length === 0) return null;

  fields.push('updated_at = now()');
  const result = await database.query(
    `update ${assetsTable} set ${fields.join(', ')} where referral_domain = $1 returning *`,
    values
  );
  if (result.rowCount === 0) throw new Error(`外链资产不存在：${normalizedDomain}`);
  return result.rows[0];
}

/**
 * 批量删除外链资产。
 */
async function batchDeleteAssets(domains, database = pool) {
  const cleanDomains = Array.from(new Set((domains || []).map(normalizeDomain).filter(Boolean)));
  if (cleanDomains.length === 0) return { deletedCount: 0 };
  const result = await database.query(
    `delete from ${assetsTable} where referral_domain = any($1::text[])`,
    [cleanDomains]
  );
  return { deletedCount: result.rowCount };
}

/**
 * 使用极简路由处理本地 API，避免为个人本地服务引入较重的 Web 框架。
 */
async function handleRequest(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  const method = request.method || 'GET';

  if (method === 'OPTIONS') {
    writeNoContent(response);
    return;
  }

  try {
    if (method === 'GET' && url.pathname === '/health') {
      await pool.query('select 1');
      writeJson(response, 200, {
        ok: true,
        database: config.pgDatabase,
        schema: config.pgSchema,
        time: new Date().toISOString()
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/runs/target-success-items') {
      const targetUrl = url.searchParams.get('targetUrl') || '';
      writeJson(response, 200, { ok: true, data: await listTargetSuccessItems(targetUrl) });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/runs') {
      writeJson(response, 200, { ok: true, data: await listRuns() });
      return;
    }

    const runItemsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/items$/);
    if (method === 'GET' && runItemsMatch) {
      writeJson(response, 200, { ok: true, data: await listRunItems(runItemsMatch[1]) });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/runs') {
      const payload = await readJsonBody(request);
      writeJson(response, 200, { ok: true, data: await upsertRun(payload) });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/runs/sync-results') {
      const payload = await readJsonBody(request);
      writeJson(response, 200, { ok: true, data: await syncRunResults(payload) });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/run-items') {
      const payload = await readJsonBody(request);
      writeJson(response, 200, { ok: true, data: await upsertRunItem(payload) });
      return;
    }

    const runStatusMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/status$/);
    if (method === 'PATCH' && runStatusMatch) {
      const payload = await readJsonBody(request);
      writeJson(response, 200, { ok: true, data: await updateRunStatus(runStatusMatch[1], payload.status, payload.completedAt) });
      return;
    }

    const runDeleteMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (method === 'DELETE' && runDeleteMatch) {
      const runId = runDeleteMatch[1];
      const result = await pool.query(`delete from ${runsTable} where id = $1 returning id`, [runId]);
      const deleted = result.rowCount > 0;
      writeJson(response, 200, { ok: true, data: { deleted, runId } });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/assets/summary') {
      writeJson(response, 200, { ok: true, data: await getAssetsSummary() });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/assets') {
      const params = Object.fromEntries(url.searchParams.entries());
      writeJson(response, 200, { ok: true, data: await listAssets(params) });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/assets/bootstrap') {
      writeJson(response, 200, { ok: true, data: await bootstrapAssets() });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/assets/import') {
      const payload = await readJsonBody(request);
      writeJson(response, 200, { ok: true, data: await importAssets(payload) });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/assets/batch-delete') {
      const payload = await readJsonBody(request);
      writeJson(response, 200, { ok: true, data: await batchDeleteAssets(payload && payload.domains) });
      return;
    }

    const assetDomainMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
    if (method === 'PATCH' && assetDomainMatch) {
      const domain = decodeURIComponent(assetDomainMatch[1]);
      const payload = await readJsonBody(request);
      writeJson(response, 200, { ok: true, data: await updateAsset(domain, payload) });
      return;
    }

    if (method === 'DELETE' && assetDomainMatch) {
      const domain = decodeURIComponent(assetDomainMatch[1]);
      writeJson(response, 200, { ok: true, data: await batchDeleteAssets([domain]) });
      return;
    }

    writeJson(response, 404, { ok: false, error: '接口不存在' });
  } catch (error) {
    console.error('[本地服务] 请求处理失败：', error);
    writeJson(response, 500, { ok: false, error: error.message || String(error) });
  }
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error('[本地服务] 未捕获错误：', error);
    writeJson(response, 500, { ok: false, error: error.message || String(error) });
  });
});

server.listen(config.serverPort, '127.0.0.1', () => {
  console.log(`[本地服务] AutoComment 本地服务已启动：http://127.0.0.1:${config.serverPort}`);
  console.log(`[本地服务] PostgreSQL：${config.pgHost}:${config.pgPort}/${config.pgDatabase} schema=${config.pgSchema}`);
});

process.on('SIGINT', async () => {
  console.log('\n[本地服务] 收到退出信号，正在关闭数据库连接...');
  await pool.end();
  process.exit(0);
});
