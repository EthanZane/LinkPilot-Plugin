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
      select *
      from ${runsTable}
      order by started_at desc
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
