#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { probeSingleUrl, probeManager } from '../server/probe.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    file: null,
    urls: [],
    concurrency: 20,
    timeoutMs: 8000,
    out: null,
    benchmark: false,
    skipExisting: true
  };

  for (const arg of args) {
    if (arg.startsWith('--file=')) {
      options.file = arg.slice(7);
    } else if (arg.startsWith('--urls=')) {
      options.urls = arg.slice(7).split(',').map((u) => u.trim()).filter(Boolean);
    } else if (arg.startsWith('--concurrency=')) {
      options.concurrency = Number(arg.slice(14)) || 20;
    } else if (arg.startsWith('--timeout=')) {
      options.timeoutMs = Number(arg.slice(10)) || 8000;
    } else if (arg.startsWith('--out=')) {
      options.out = arg.slice(6);
    } else if (arg === '--benchmark') {
      options.benchmark = true;
    } else if (arg === '--no-skip-existing' || arg === '--skip-existing=false') {
      options.skipExisting = false;
    }
  }

  return options;
}

async function runBenchmark(options) {
  console.log('🚀 开始基于数据库优质外链的探测算法基准测试 (Benchmark)...');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5499/bi'
  });

  try {
    const res = await pool.query(`
      select referral_domain, referral_url, quality_tier, success_count, total_attempts
      from dw.backlink_assets
      where quality_tier = 'high_quality'
      order by success_count desc, total_attempts desc
      limit 50
    `);

    console.log(`已读取库内 Top ${res.rows.length} 条高成功率真实资产，开始并发探测...\n`);

    const urls = res.rows.map((r) => r.referral_url);
    const session = probeManager.startSession(urls, {
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      skipExisting: false
    });

    // 轮询打印控制台进度
    while (true) {
      await new Promise((r) => setTimeout(r, 1000));
      const statusRes = probeManager.getSessionStatus(500);
      const s = statusRes.session;
      process.stdout.write(`\r[进度] ${s.processed}/${s.total} (${s.progressPercent}%) | ✅ 可用博客: ${s.stats.validBlogCommentWithUrl + s.stats.validBlogCommentNoUrl} | 🔒 关闭/需登录: ${s.stats.commentsClosed + s.stats.loginRequired} | ⚠️ 需复核: ${s.stats.needReview} | ❌ 非博客/失败: ${s.stats.notBlogComment + s.stats.failed}`);

      if (s.status === 'completed' || s.status === 'canceled') {
        console.log('\n\n====== 基准测试完成 ======');
        console.log(`总探测数量: ${s.total}`);
        console.log(`有效耗时: ${s.elapsedSeconds} 秒`);
        console.log(`平均单页耗时: ${(s.elapsedSeconds / (s.total || 1)).toFixed(2)} 秒`);
        console.log('---------------------------');
        console.log(`🟢 开放博客评论 (含外链URL字段): ${s.stats.validBlogCommentWithUrl}`);
        console.log(`🟢 开放博客评论 (需正文带外链): ${s.stats.validBlogCommentNoUrl}`);
        console.log(`🔵 Blogger 博客: ${s.stats.bloggerComment}`);
        console.log(`🔒 博客但评论已关闭: ${s.stats.commentsClosed}`);
        console.log(`🔑 博客但需要登录: ${s.stats.loginRequired}`);
        console.log(`🟡 需人工复核 (403/Cloudflare等): ${s.stats.needReview}`);
        console.log(`🔴 非博客页面: ${s.stats.notBlogComment}`);
        console.log(`⚡ 超时或网络异常: ${s.stats.failed}`);

        const reachables = s.total - s.stats.failed;
        const recognizedAsBlog =
          s.stats.validBlogCommentWithUrl +
          s.stats.validBlogCommentNoUrl +
          s.stats.bloggerComment +
          s.stats.commentsClosed +
          s.stats.loginRequired;

        const accuracy = reachables > 0 ? ((recognizedAsBlog / reachables) * 100).toFixed(1) : 0;
        console.log(`\n🎯 在网络可达站点中，博客系统精准识别率: ${accuracy}%`);
        break;
      }
    }
  } finally {
    await pool.end();
  }
}

async function runCli() {
  const options = parseArgs();

  if (options.benchmark) {
    await runBenchmark(options);
    return;
  }

  let urls = options.urls;

  if (options.file) {
    const filePath = resolve(process.cwd(), options.file);
    if (!existsSync(filePath)) {
      console.error(`❌ 文件不存在: ${filePath}`);
      process.exit(1);
    }
    const content = readFileSync(filePath, 'utf8');
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    urls = urls.concat(lines);
  }

  if (urls.length === 0) {
    console.log(`
LinkPilot 博客外链探测 CLI 工具

用法示例:
  node scripts/probe-backlinks.js --file=urls.txt --concurrency=25 --out=results.json
  node scripts/probe-backlinks.js --urls="https://a.com/blog/1,https://b.com/post/2"
  node scripts/probe-backlinks.js --benchmark
  node scripts/probe-backlinks.js --file=urls.txt --no-skip-existing
    `);
    process.exit(0);
  }

  let existingLibraryMap = null;
  if (options.skipExisting) {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5499/bi'
      });
      const res = await pool.query(
        'select referral_domain, referral_url, quality_tier, success_rate, success_count, total_attempts, resource_type from dw.backlink_assets'
      );
      existingLibraryMap = new Map();
      for (const row of res.rows) {
        existingLibraryMap.set(row.referral_domain, row);
      }
      await pool.end();
      console.log(`📚 已载入资产库 ${existingLibraryMap.size} 个已知域名，将自动跳过已有资产探测。`);
    } catch (dbErr) {
      console.warn('⚠️ 读取外链资产库失败，将全量探测：', dbErr.message);
    }
  }

  console.log(`🚀 开始探测 ${urls.length} 条原始输入，并发度: ${options.concurrency}...`);
  const session = probeManager.startSession(urls, {
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    existingLibraryMap,
    skipExisting: options.skipExisting
  });

  if (session.dedupCount > 0) {
    console.log(`🧹 批次去重：原始输入 ${session.rawCount} 条，去重后有效域名 ${session.total} 个（已过滤 ${session.dedupCount} 条重复）。`);
  }
  if (session.alreadyInLibrary > 0) {
    console.log(`⏩ 资产库已有：自动跳过 ${session.alreadyInLibrary} 个库内域名，实际发起网络探测 ${session.total - session.alreadyInLibrary} 个。`);
  }

  while (true) {
    await new Promise((r) => setTimeout(r, 800));
    const statusRes = probeManager.getSessionStatus(1000);
    const s = statusRes.session;
    process.stdout.write(`\r[进度] ${s.processed}/${s.total} (${s.progressPercent}%) | ⏩ 库内已存: ${s.stats.alreadyInLibrary || 0} | 耗时: ${s.elapsedSeconds}s`);

    if (s.status === 'completed' || s.status === 'canceled') {
      console.log('\n\n====== 探测完成 ======');
      console.log(`输入总数: ${s.stats.rawCount || s.total}, 去重条数: ${s.stats.dedupCount || 0}, 有效独立域名: ${s.total}`);
      console.log(`完成探测: ${s.processed}, 耗时: ${s.elapsedSeconds}s`);
      console.log(`⏩ 资产库已存在 (跳过): ${s.stats.alreadyInLibrary || 0}`);
      console.log(`✅ 开放评论外链: ${s.stats.validBlogCommentWithUrl + s.stats.validBlogCommentNoUrl + s.stats.bloggerComment}`);
      console.log(`⚠️ 需人工复核: ${s.stats.needReview}`);
      console.log(`🔒 关闭或需登录: ${s.stats.commentsClosed + s.stats.loginRequired}`);
      console.log(`❌ 非博客或失败: ${s.stats.notBlogComment + s.stats.failed}`);

      if (options.out) {
        const outPath = resolve(process.cwd(), options.out);
        writeFileSync(outPath, JSON.stringify(s, null, 2), 'utf8');
        console.log(`\n📁 详细探测结果已保存至: ${outPath}`);
      }
      break;
    }
  }
}

runCli().catch((err) => {
  console.error('\n❌ 执行异常:', err.message);
  process.exit(1);
});
