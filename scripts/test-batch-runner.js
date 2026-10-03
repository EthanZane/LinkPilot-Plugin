import assert from 'node:assert/strict';
import test from 'node:test';
import { createBatchRunner, BATCH_RUNNER_KEY } from '../batch-runner.js';

const copy = (value) => structuredClone(value);

/** 完全隔离的浏览器替身：不打开真实网站，不发表评论，模拟持久化、标签创建延迟和后台生命周期。 */
function environment({ createDelay = false, databaseOffline = false } = {}) {
  let clock = 100000;
  let nextId = 1;
  let power = false;
  const local = {};
  const session = {};
  const tabs = new Map();
  const sent = [];
  const removed = [];
  const alarmNames = new Set();
  const handles = new Map();
  const createWaiters = [];
  const databaseCalls = [];
  let maxTabs = 0;
  let timerId = 0;

  /** 存储每次返回副本，以捕获代码依赖共享对象或忘记持久化的缺陷。 */
  function storage(data) {
    return {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, copy(data[key])])); },
      async set(values) { Object.assign(data, copy(values)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
    };
  }
  const api = {
    storage: { local: storage(local), session: storage(session) },
    runtime: { getURL: (file) => `chrome-extension://test/${file}`, async getPlatformInfo() { return {}; } },
    power: { requestKeepAwake(level) { assert.equal(level, 'system'); power = true; }, releaseKeepAwake() { power = false; } },
    alarms: { async create(name) { alarmNames.add(name); }, async clear(name) { alarmNames.delete(name); } },
    tabs: {
      async create(properties) {
        if (createDelay) await new Promise((resolve) => createWaiters.push(resolve));
        const tab = { id: nextId++, ...properties };
        tabs.set(tab.id, tab);
        maxTabs = Math.max(maxTabs, tabs.size);
        return copy(tab);
      },
      async get(id) { if (!tabs.has(id)) throw new Error('标签页不存在'); return copy(tabs.get(id)); },
      async query() { return [...tabs.values()].map(copy); },
      async update(id, changes) { Object.assign(tabs.get(id), changes); return copy(tabs.get(id)); },
      async remove(id) { tabs.delete(id); removed.push(id); },
      async sendMessage(id, message) {
        if (!tabs.has(id)) throw new Error('标签页不存在');
        if (message.type === 'BATCH_HANDLE') sent.push({ id, message: copy(message) });
        return { ok: true };
      }
    }
  };
  const timers = {
    setTimeout(fn, delay) { const id = ++timerId; handles.set(id, { fn, delay }); return id; },
    clearTimeout(id) { handles.delete(id); }
  };
  const request = async (_url, options) => {
    databaseCalls.push(JSON.parse(options.body));
    if (databaseOffline) throw new Error('数据库离线');
    return { ok: true };
  };
  return { api, local, session, tabs, sent, removed, alarmNames, handles, createWaiters, databaseCalls,
    makeRunner: () => createBatchRunner(api, { now: () => clock, timers, request }),
    advance: (ms) => { clock += ms; }, getPower: () => power, getMaxTabs: () => maxTabs };
}

/** 全量 M×N 明细与真实页面的交接格式一致，队列按目标顺序排列。 */
function startMessage({ id = 'batch-1', urls = 4, sites = 1, concurrency = 2, retries = 1 } = {}) {
  const targets = Array.from({ length: sites }, (_, index) => ({ id: `site-${index}`, name: `目标 ${index}`, url: `https://target${index}.example/`, content: '网站介绍' }));
  const referrals = Array.from({ length: urls }, (_, index) => ({ url: `https://blog${index}.example/post`, originalIndex: index }));
  const results = targets.flatMap((site, siteIndex) => referrals.map((item, urlIndexInSite) => ({
    originalIndex: siteIndex * urls + urlIndexInSite, siteIndex, urlIndexInSite, url: item.url,
    promotionSiteId: site.id, promotionSiteUrl: site.url, result: 'unstarted', timestamp: null
  })));
  return { type: 'BATCH_RUN_START', record: { id, startedAt: 100000, results, targetSites: targets,
    referralUrls: referrals, totalCount: results.length, targetUrl: targets.map((site) => site.url).join(', '), targetName: '测试目标' },
    indices: results.map((item) => item.originalIndex), config: { concurrency, timeoutSeconds: 60, timeoutRetryCount: retries,
      sites: targets.map((_, index) => ({ targetSuccessHistory: { [`历史-${index}`]: { result: 'success' } } })) }
  };
}

/** 等待串行事件队列归零，获取后台权威状态，不使用真实时间等待。 */
async function snapshot(runner) {
  return runner.command({ type: 'BATCH_RUN_GET' });
}
async function start(runner, options) {
  await runner.command(startMessage(options));
  await runner.wake();
  return snapshot(runner);
}
async function reportFirst(runner, env, result = 'success') {
  const state = await snapshot(runner);
  const tab = state.active[0];
  assert.ok(tab);
  await runner.report({ batchId: state.record.id, urlIndex: tab.index, result, aiContent: '测试评论' }, { tab: { id: tab.tabId } });
  await runner.wake();
  return snapshot(runner);
}

test('不加载设置页也能持续补充标签页并完成全部任务，最终释放保活资源', async () => {
  const env = environment();
  const runner = env.makeRunner();
  await start(runner);
  assert.equal(env.getPower(), true);
  while ((await snapshot(runner)).active.length) await reportFirst(runner, env);
  const state = await snapshot(runner);
  assert.equal(state.record.status, 'completed');
  assert.equal(state.record.summary.success, 4);
  assert.equal(env.sent.length, 4);
  assert.equal(env.getMaxTabs(), 2);
  assert.equal(env.getPower(), false);
  assert.equal(env.alarmNames.size, 0);
  assert.equal(env.tabs.size, 0);
  assert.equal(env.local.auto_comment_batch_history_v1[0].results.length, 4);
});

test('异步创建标签期间的多个唤醒事件仍只使用已预占的并发名额', async () => {
  const env = environment({ createDelay: true });
  const runner = env.makeRunner();
  await runner.command(startMessage({ urls: 6 }));
  const wakes = Array.from({ length: 5 }, () => runner.wake());
  // 等待模拟 create Promise 入队，逐个放行，不能用同步创建掩盖原有并发漏洞。
  for (let index = 0; index < 2; index++) {
    while (!env.createWaiters.length) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(env.local[BATCH_RUNNER_KEY].active.length, index + 1);
    env.createWaiters.shift()();
  }
  await Promise.all(wakes);
  assert.equal((await snapshot(runner)).active.length, 2);
  assert.equal(env.getMaxTabs(), 2);
});

test('Worker 被回收后由新执行器恢复活动任务，不再次发送已发出的评论任务', async () => {
  const env = environment();
  await start(env.makeRunner());
  const newRunner = env.makeRunner();
  await newRunner.wake();
  assert.equal(env.sent.length, 2);
  assert.equal(env.tabs.size, 2);
  await reportFirst(newRunner, env);
  assert.equal(env.sent.length, 3);
});

test('休眠十分钟后补偿超时，唤醒时不批量关闭和重试现有标签', async () => {
  const env = environment();
  const runner = env.makeRunner();
  await start(runner);
  env.advance(600000);
  await runner.wake();
  assert.equal(env.removed.length, 0);
  assert.equal(env.sent.length, 2);
  assert.deepEqual((await snapshot(runner)).retries, {});
});

test('正常流逝的超时会按配置重试，旧标签页迟到报告不能覆盖新任务', async () => {
  const env = environment();
  const runner = env.makeRunner();
  let state = await start(runner, { urls: 1, concurrency: 1 });
  const oldTabId = state.active[0].tabId;
  for (let tick = 0; tick < 13; tick++) { env.advance(5000); await runner.wake(); }
  state = await snapshot(runner);
  assert.equal(state.retries[0], 1);
  assert.equal(env.sent.length, 2);
  await runner.report({ batchId: state.record.id, urlIndex: 0, result: 'success' }, { tab: { id: oldTabId } });
  assert.equal((await snapshot(runner)).active.length, 1);
  assert.equal((await snapshot(runner)).record.results[0].result, 'unstarted');
  for (let tick = 0; tick < 13; tick++) { env.advance(5000); await runner.wake(); }
  state = await snapshot(runner);
  assert.equal(state.record.status, 'completed');
  assert.equal(state.record.results[0].result, 'fail');
  assert.equal(env.sent.length, 2);
});

test('前一目标全部完成并关闭标签后才切换下一目标，同时替换历史去重表', async () => {
  const env = environment();
  const runner = env.makeRunner();
  await start(runner, { urls: 2, sites: 2 });
  await reportFirst(runner, env);
  let state = await reportFirst(runner, env);
  assert.equal(state.record.status, 'queue_transition');
  assert.equal(env.sent.length, 2);
  env.advance(3000);
  await runner.wake();
  state = await snapshot(runner);
  assert.equal(state.active.length, 2);
  assert.equal(env.sent[2].message.promotionSite.id, 'site-1');
  assert.deepEqual(Object.keys(env.local.batchTargetSuccessHistory), ['历史-1']);
});

test('终止批次关闭当前标签并释放资源，后续唤醒不再调度', async () => {
  const env = environment();
  const runner = env.makeRunner();
  await start(runner);
  await runner.command({ type: 'BATCH_RUN_STOP', batchId: 'batch-1' });
  await runner.wake();
  assert.equal(env.sent.length, 2);
  assert.equal(env.tabs.size, 0);
  assert.equal(env.getPower(), false);
  const state = await snapshot(runner);
  assert.equal(state.record.status, 'terminated');
  assert.equal(state.record.summary.unstarted, 2);
  assert.equal(state.record.summary.fail, 2);
});

test('两个设置页重复开始会被拒绝，不覆盖已有任务和结果', async () => {
  const env = environment();
  const runner = env.makeRunner();
  await start(runner);
  await assert.rejects(runner.command(startMessage({ id: 'batch-2' })), /已有运行中的批次/);
  assert.equal((await snapshot(runner)).record.id, 'batch-1');
  assert.equal(env.sent.length, 2);
});

test('数据库离线时继续执行，批次结果和失败同步状态仍完整保存在本地', async () => {
  const env = environment({ databaseOffline: true });
  const runner = env.makeRunner();
  await start(runner, { urls: 1 });
  await reportFirst(runner, env);
  await new Promise((resolve) => setImmediate(resolve));
  const state = await snapshot(runner);
  assert.equal(state.record.status, 'completed');
  assert.equal(state.record.summary.success, 1);
  assert.equal(state.record.databaseStatus, 'failed');
});

test('Worker 在创建标签后保存 tabId 前退出，新执行器识别意图页面而不再新建标签', async () => {
  const env = environment();
  const runner = env.makeRunner();
  await start(runner, { urls: 1 });
  const saved = env.local[BATCH_RUNNER_KEY];
  const tabId = saved.active[0].tabId;
  saved.active[0].tabId = null;
  saved.active[0].sent = false;
  env.tabs.get(tabId).url = env.api.runtime.getURL('batch-launch.html') + '#batch-1:0';
  const restored = env.makeRunner();
  await restored.wake();
  assert.equal(env.tabs.size, 1);
  assert.equal((await snapshot(restored)).active[0].tabId, tabId);
});

test('浏览器重启后即使复用 tabId，也不关闭无关标签或重发旧任务', async () => {
  const env = environment();
  await start(env.makeRunner(), { urls: 2, concurrency: 1 });
  const oldId = env.local[BATCH_RUNNER_KEY].active[0].tabId;
  delete env.session.batchRunnerSession;
  env.tabs.get(oldId).url = 'https://unrelated.example/';
  const runner = env.makeRunner();
  await runner.wake();
  const state = await snapshot(runner);
  assert.equal(state.record.results[0].result, 'fail');
  assert.equal(env.tabs.get(oldId).url, 'https://unrelated.example/');
  assert.ok(!env.removed.includes(oldId));
  assert.equal(env.sent.length, 2);
  assert.equal(env.sent[1].message.urlIndex, 1);
});

test('非法 URL 在打开标签页之前拦截', async () => {
  const env = environment();
  const runner = env.makeRunner();
  const message = startMessage({ urls: 1 });
  message.record.results[0].url = 'https://pornhub.com/';
  await runner.command(message);
  await runner.wake();
  assert.equal(env.tabs.size, 0);
  assert.equal((await snapshot(runner)).record.results[0].result, 'blocked_illegal');
});

test('结果已保存但关闭标签前 Worker 退出，下次唤醒先完成关闭再补充名额', async () => {
  const env = environment();
  await start(env.makeRunner(), { urls: 3 });
  const saved = env.local[BATCH_RUNNER_KEY];
  const finished = saved.active.shift();
  saved.closing.push(finished.tabId);
  saved.record.results[finished.index].result = 'success';
  saved.record.results[finished.index].timestamp = 100001;
  const runner = env.makeRunner();
  await runner.wake();
  assert.ok(env.removed.includes(finished.tabId));
  assert.equal(env.getMaxTabs(), 2);
  assert.equal((await snapshot(runner)).active.length, 2);
});

test('仅重试选中的失败行时保留其他成功结果及稳定行号', async () => {
  const env = environment();
  const runner = env.makeRunner();
  await start(runner, { urls: 2 });
  await reportFirst(runner, env);
  let state = await reportFirst(runner, env, 'fail');
  const message = startMessage({ urls: 2 });
  message.record = state.record;
  message.indices = [1];
  message.forceRetry = true;
  await runner.command(message);
  await runner.wake();
  state = await snapshot(runner);
  assert.equal(state.record.results[0].result, 'success');
  assert.equal(state.active[0].index, 1);
  assert.equal(env.sent.at(-1).message.forceRetry, true);
  await reportFirst(runner, env);
  assert.equal((await snapshot(runner)).record.summary.success, 2);
});

test('设置页立即切换指令交给后台校验，不依赖页面倒计时', async () => {
  const env = environment();
  const runner = env.makeRunner();
  await start(runner, { urls: 1, sites: 2 });
  await reportFirst(runner, env);
  await runner.command({ type: 'BATCH_RUN_NEXT', batchId: 'batch-1' });
  await runner.wake();
  assert.equal(env.sent.length, 2);
  assert.equal(env.sent.at(-1).message.promotionSite.id, 'site-1');
});
