import './illegal-site-filter.js';

// 批量任务由 Service Worker 独占调度；设置页仅订阅持久化快照，禁止参与执行时序。
export const BATCH_RUNNER_KEY = 'auto_comment_background_run_v1';
export const BATCH_RUNNER_ALARM = 'auto_comment_background_tick';
const HISTORY_KEY = 'auto_comment_batch_history_v1';
const TICK_MS = 1000;
const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * 创建可恢复的后台执行器。所有状态变更经过同一串行队列，避免结果上报、超时和关闭事件争抢并发名额。
 * api、时钟和网络函数可注入，以便模拟 Worker 重启、休眠及异步标签页创建。
 */
export function createBatchRunner(api, { now = Date.now, request = fetch, timers = globalThis } = {}) {
  let state;
  let loaded = false;
  let chain = Promise.resolve();
  let timer = null;
  const databasePending = new Map();
  let databaseBusy = false;
  let sessionId;

  // 状态枚举：running 执行任务；queue_transition 等待切换目标；completed 全部完成；terminated 用户终止。
  const running = () => state && ['running', 'queue_transition'].includes(state.record.status);
  const launchUrl = (index) => api.runtime.getURL('batch-launch.html') + `#${state.record.id}:${index}`;

  /** 首次事件从磁盘恢复，后续事件共用内存状态；Worker 被回收后可再次完整重建。 */
  async function load() {
    if (loaded) return;
    const data = await api.storage.local.get(BATCH_RUNNER_KEY);
    state = data[BATCH_RUNNER_KEY] || null;
    const session = await api.storage.session.get('batchRunnerSession');
    sessionId = session.batchRunnerSession || `${now()}:${Math.random()}`;
    await api.storage.session.set({ batchRunnerSession: sessionId });
    loaded = true;
    if (state) state.closing ||= [];
    if (running()) {
      // 浏览器重启或扩展重载后 tabId 不再可靠，旧在途项保留为待人工确认，绝不操作可能复用 ID 的其他标签页。
      if (state.sessionId !== sessionId) {
        for (const tab of state.active) {
          const item = state.record.results.find((entry) => entry.originalIndex === tab.index);
          Object.assign(item, { result: 'fail', timestamp: now(), errorMessage: '浏览器或扩展重启，请确认是否已提交后重试' });
        }
        state.active = [];
        state.closing = [];
        state.sessionId = sessionId;
        await save();
      }
      api.power.requestKeepAwake('system'); // 仅阻止空闲睡眠，允许屏幕熄灭和正常锁屏。
      await api.alarms.create(BATCH_RUNNER_ALARM, { periodInMinutes: 0.5 });
    }
  }

  /** 队列失败必须被吸收，后续事件仍可执行；返回原始 Promise 供调用方收到明确错误。 */
  function enqueue(work) {
    const operation = chain.then(async () => { await load(); return work(); });
    chain = operation.catch((error) => console.error('[后台批量] 任务事件处理失败：', error));
    return operation;
  }

  /** 按状态汇总结果，与设置页历史字段保持一致，关闭设置页也能完整保留执行明细。 */
  function summary() {
    const counts = { total: state.record.results.length, success: 0, fail: 0, skipped: 0,
      noCommentBox: 0, manualRequired: 0, blockedIllegal: 0, unstarted: 0, processed: 0 };
    const fields = {
      success: 'success', // 已成功提交评论。
      fail: 'fail', // 自动处理失败，可由用户重试。
      skipped: 'skipped', // 已有成功历史，本轮跳过。
      no_comment_box: 'noCommentBox', // 页面没有可用评论框。
      manual_required: 'manualRequired', // 验证或交互需要人工处理。
      blocked_illegal: 'blockedIllegal', // 命中非法网站规则，禁止执行。
      unstarted: 'unstarted' // 尚未得到最终执行结果。
    };
    for (const item of state.record.results) counts[fields[item.result] || 'fail']++;
    counts.processed = counts.total - counts.unstarted;
    return counts;
  }

  /** 快照和批次日志一次提交，UI 只读这个权威版本，避免两个设置页相互覆盖执行状态。 */
  async function save() {
    state.lastSavedAt = now();
    state.record.summary = summary();
    state.revision = (state.revision || 0) + 1;
    const data = await api.storage.local.get(HISTORY_KEY);
    const history = (data[HISTORY_KEY] || []).filter((record) => record.id !== state.record.id);
    history.unshift(clone(state.record));
    await api.storage.local.set({ [BATCH_RUNNER_KEY]: clone(state), [HISTORY_KEY]: history });
  }

  /** 停止时释放电源锁和唤醒闹钟；活动任务使用后台短定时器，闹钟负责 Worker 回收后的兜底唤醒。 */
  async function resources() {
    if (running()) {
      api.power.requestKeepAwake('system');
      await api.alarms.create(BATCH_RUNNER_ALARM, { periodInMinutes: 0.5 });
    } else {
      if (timer) timers.clearTimeout(timer);
      timer = null;
      api.power.releaseKeepAwake();
      await api.alarms.clear(BATCH_RUNNER_ALARM);
      await api.storage.local.remove(['batch_task_settings', 'batch_task_urls', 'batchTargetSuccessHistory', 'batchCtx', 'batchSubmitCtx', 'batchSubmitCtxMap']);
    }
  }

  /** 网络写入走旁路队列，数据库不可用时不阻断浏览器调度，扩展本地快照始终是恢复依据。 */
  function syncDatabase(final = false) {
    databasePending.set(state.record.id, { snapshot: clone(state), final });
    if (databaseBusy) return;
    databaseBusy = true;
    // 同一批次只保留最新待同步快照，离线时不会积压数百个网络超时请求。
    (async () => {
      while (databasePending.size) {
        const [id, pending] = databasePending.entries().next().value;
        databasePending.delete(id);
        const { snapshot, final } = pending;
        const record = snapshot.record;
        const items = record.results.filter((item) => item.result !== 'unstarted');
        const domain = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
        const run = {
          id: record.id, targetUrl: record.targetUrl, targetName: record.targetName,
          targetDomain: record.targetSites.map((site) => domain(site.url)).join(', '),
          totalCount: record.totalCount, status: record.status === 'queue_transition' ? 'running' : record.status,
          sourceType: record.sourceType, sourceName: record.sourceName,
          startedAt: new Date(record.startedAt).toISOString(),
          completedAt: record.completedAt ? new Date(record.completedAt).toISOString() : null,
          rawConfig: { ...snapshot.config, targetSites: record.targetSites, referralUrls: record.referralUrls }
        };
        const controller = new AbortController();
        const timeout = timers.setTimeout(() => controller.abort(), final ? 30000 : 1500);
        try {
          const response = await request('http://127.0.0.1:17321/api/runs/sync-results', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ run, status: run.status, items: items.map((item) => ({
              runId: record.id, urlIndex: item.originalIndex, referralUrl: item.url,
              referralDomain: item.sourceDomain || domain(item.url), targetUrl: item.promotionSiteUrl,
              targetDomain: domain(item.promotionSiteUrl), result: item.result, resultMessage: item.errorMessage || '',
              aiContent: item.aiContent, elapsedSeconds: item.elapsed,
              executedAt: new Date(item.timestamp).toISOString(), pageMetrics: item.pageMetrics || {}, originalRow: item.originalRow || []
            })) })
          });
          if (!response.ok) throw new Error(`数据库返回 HTTP ${response.status}`);
          if (final) await enqueue(async () => {
            if (state.record.id !== record.id || state.revision !== snapshot.revision) return;
            state.record.databaseStatus = 'synced';
            await save();
          });
        } catch (error) {
          console.warn('[后台批量] 数据库暂未同步，执行结果已保存在扩展本地：', error.message);
          if (final) await enqueue(async () => {
            if (state.record.id !== record.id || state.revision !== snapshot.revision) return;
            state.record.databaseStatus = 'failed';
            await save();
          });
        } finally { timers.clearTimeout(timeout); }
      }
    })().catch((error) => console.error('[后台批量] 数据库同步失败：', error))
      .finally(() => { databaseBusy = false; });
  }

  /** 每个目标切换后原子替换页面设置和历史去重表，防止沿用前一个目标的历史记录。 */
  async function configureSite(siteIndex) {
    const site = state.record.targetSites[siteIndex];
    const config = state.config.sites[siteIndex];
    await api.storage.local.set({ batch_task_settings: { ...state.config, ...config, promotionSite: site },
      batch_task_urls: state.record.referralUrls.map((item) => item.url), batchTargetSuccessHistory: config.targetSuccessHistory || {} });
  }

  /** 待关闭标签页持久化后再执行关闭，Worker 在结果落盘后退出也不会遗留任务标签页。 */
  async function closePendingTabs() {
    if (!state.closing.length) return;
    for (const tabId of [...state.closing]) {
      await api.tabs.remove(tabId).catch(() => {});
      state.closing = state.closing.filter((id) => id !== tabId);
      await save();
    }
  }

  /** 先保存结束结果，再关标签页和释放名额；迟到的旧标签页报告不会覆盖新重试结果。 */
  async function finish(index, result, tab) {
    const item = state.record.results.find((entry) => entry.originalIndex === index);
    Object.assign(item, { ...result, timestamp: now(), elapsed: tab ? Math.round((now() - tab.startTime) / 1000) : 0 });
    state.active = state.active.filter((entry) => entry.index !== index);
    if (tab?.tabId != null) state.closing.push(tab.tabId);
    await save();
    await closePendingTabs();
  }

  /** 超时只重试规定次数；删除活动记录后才关闭旧标签页，关闭事件不会再次释放同一名额。 */
  async function failOrRetry(tab, message) {
    state.active = state.active.filter((entry) => entry.index !== tab.index);
    const retries = state.retries[tab.index] || 0;
    if (retries < state.config.timeoutRetryCount && running()) {
      state.retries[tab.index] = retries + 1;
      state.pending.unshift(tab.index);
      if (tab.tabId != null) state.closing.push(tab.tabId);
      await save();
      await closePendingTabs();
    } else {
      await finish(tab.index, { result: 'fail', aiContent: null, errorMessage: `${message}（已重试 ${retries} 次）` }, tab);
      syncDatabase();
    }
  }

  /** 已发出的任务不因 Worker 重启再次下发；消息通道断开可能是正常导航，最终以明确结果上报为准。 */
  async function dispatch(tab) {
    if (tab.sent || tab.tabId == null) return;
    try { await api.tabs.sendMessage(tab.tabId, { type: 'PING' }, { frameId: 0 }); } catch { return; }
    tab.sent = true;
    await save();
    const item = state.record.results.find((entry) => entry.originalIndex === tab.index);
    const config = state.config.sites[item.siteIndex];
    api.tabs.sendMessage(tab.tabId, { type: 'BATCH_HANDLE', batchId: state.record.id, urlIndex: tab.index,
      url: item.url, promotionSite: state.record.targetSites[item.siteIndex],
      debugMode: state.config.debugMode, presetComment: config.debugComment || '',
      ignoreHistory: state.config.ignoreHistory, forceRetry: state.forceRetry || (state.retries[tab.index] || 0) > 0
    }, { frameId: 0 }).catch((error) => console.log('[后台批量] 页面消息通道结束，等待结果确认：', error.message));
  }

  /** 临时扩展页面作为创建意图标记，避免 Worker 在 create 和保存 tabId 之间退出后遗留无法识别的标签页。 */
  async function recoverTab(tab) {
    if (tab.tabId == null) {
      const matches = await api.tabs.query({ url: api.runtime.getURL('batch-launch.html') + '*' });
      const candidate = matches.find((entry) => (entry.pendingUrl || entry.url) === launchUrl(tab.index));
      if (candidate) tab.tabId = candidate.id;
      else tab.tabId = (await api.tabs.create({ url: launchUrl(tab.index), active: true })).id;
      await save();
    }
    const live = await api.tabs.get(tab.tabId);
    const url = live.pendingUrl || live.url;
    if (url === launchUrl(tab.index)) {
      const item = state.record.results.find((entry) => entry.originalIndex === tab.index);
      await api.tabs.update(tab.tabId, { url: item.url, autoDiscardable: false });
    }
  }

  /** 休眠或长时间调度中断时平移超时起点，避免唤醒瞬间把所有在途任务判超时并集中重试。 */
  async function pump() {
    if (state?.closing?.length && state.sessionId === sessionId) await closePendingTabs();
    if (!running()) return;
    const current = now();
    const gap = current - state.lastTick;
    if (gap > 45000) {
      for (const tab of state.active) tab.startTime += gap;
      if (state.transitionAt) state.transitionAt += gap;
      console.log('[后台批量] 检测到调度中断，恢复在途任务并补偿超时时间：', Math.round(gap / 1000), '秒');
    }
    state.lastTick = current;
    // 定期扩展 API 调用延长活动 Worker 生命周期；持久化闹钟不依赖短定时器存活。
    await api.runtime.getPlatformInfo();
    for (const tab of [...state.active]) {
      try { await recoverTab(tab); } catch {
        await finish(tab.index, { result: 'fail', aiContent: null, errorMessage: '任务标签页已关闭或无法打开' }, tab);
        syncDatabase();
        continue;
      }
      if ((current - tab.startTime) > state.config.timeoutSeconds * 1000) await failOrRetry(tab, '处理超时');
      else await dispatch(tab);
    }
    if (state.record.status === 'queue_transition') {
      if (current < state.transitionAt) {
        if (current - state.lastSavedAt >= 10000) await save();
        return;
      }
      state.record.status = 'running';
      state.transitionAt = null;
      await configureSite(state.siteIndex);
    }
    const next = state.record.results.find((item) => item.originalIndex === state.pending[0]);
    if (state.active.length === 0 && next && next.siteIndex !== state.siteIndex) {
      state.siteIndex = next.siteIndex;
      state.record.status = 'queue_transition';
      state.transitionAt = current + 3000;
      await save();
      return;
    }
    while (running() && state.record.status === 'running' && state.active.length < state.config.concurrency && state.pending.length) {
      const index = state.pending[0];
      const item = state.record.results.find((entry) => entry.originalIndex === index);
      if (item.siteIndex !== state.siteIndex) break;
      state.pending.shift();
      const illegal = globalThis.AutoCommentIllegalSiteFilter.evaluateUrl(item.url, { sourceDomain: item.sourceDomain });
      if (illegal.blocked) {
        await finish(index, { result: 'blocked_illegal', aiContent: null, errorMessage: illegal.reason }, null);
        syncDatabase();
        continue;
      }
      const tab = { index, tabId: null, startTime: now(), sent: false };
      state.active.push(tab); // 在 await 创建标签页前预占并发名额，事件恢复后也不会超量打开。
      await save();
      try { await recoverTab(tab); await dispatch(tab); } catch (error) {
        await finish(index, { result: 'fail', aiContent: null, errorMessage: `无法打开标签页：${error.message}` }, tab);
        syncDatabase();
      }
    }
    if (!state.pending.length && !state.active.length) {
      state.record.status = state.record.results.some((item) => item.result === 'unstarted') ? 'terminated' : 'completed';
      state.record.completedAt = now();
      await save();
      await resources();
      syncDatabase(true);
    } else if (current - state.lastSavedAt >= 10000) await save();
  }

  /** 一个短定时器对应一个后台巡检，重入事件只入队，不累积独立的并发调度循环。 */
  function schedule() {
    if (!running() || timer) return;
    timer = timers.setTimeout(() => {
      timer = null;
      wake().catch(() => {});
    }, TICK_MS);
  }

  async function wake() {
    try { return await enqueue(pump); } finally { schedule(); }
  }

  /** 所有控制消息都来自扩展页面；重复开始不覆盖正在运行的批次，停止指令校验批次归属。 */
  async function command(message) {
    const response = await enqueue(async () => {
      if (message.type === 'BATCH_RUN_GET') return state ? clone(state) : null;
      if (message.type === 'BATCH_RUN_NEXT') {
        if (!state || state.record.id !== message.batchId || state.record.status !== 'queue_transition') throw new Error('当前没有等待切换的目标');
        state.transitionAt = now();
        await pump();
        return clone(state);
      }
      if (message.type === 'BATCH_RUN_STOP') {
        if (!state || state.record.id !== message.batchId) throw new Error('待停止批次与后台任务不一致');
        state.record.status = 'terminated';
        state.record.completedAt = now();
        state.pending = [];
        const tabs = [...state.active];
        for (const tab of tabs) await finish(tab.index, { result: 'fail', aiContent: null, errorMessage: '手动终止' }, tab);
        await save();
        await resources();
        syncDatabase(true);
        return clone(state);
      }
      if (message.type !== 'BATCH_RUN_START') throw new Error('未知批次控制指令');
      if (running()) throw new Error('后台已有运行中的批次，请先停止或等待完成');
      const record = clone(message.record);
      if (!record?.id || !record.results?.length || !record.targetSites?.length) throw new Error('批次快照不完整');
      const pending = [...new Set(message.indices)].sort((a, b) => a - b);
      if (!pending.length || pending.some((index) => !record.results.some((item) => item.originalIndex === index))) throw new Error('待处理队列为空或索引无效');
      const config = clone(message.config);
      if (!config.sites || config.sites.length !== record.targetSites.length) throw new Error('目标站点设置不完整');
      config.concurrency = Math.min(30, Math.max(1, Math.trunc(Number(config.concurrency)) || 3));
      config.timeoutSeconds = Math.min(600, Math.max(10, Number(config.timeoutSeconds) || 60));
      config.timeoutRetryCount = Math.min(5, Math.max(0, Number(config.timeoutRetryCount) || 0));
      for (const index of pending) Object.assign(record.results.find((item) => item.originalIndex === index), { result: 'unstarted', timestamp: null, errorMessage: null });
      record.status = 'running';
      record.completedAt = null;
      record.databaseStatus = 'pending';
      state = { record, config, pending, active: [], closing: [], retries: {}, forceRetry: !!message.forceRetry,
        siteIndex: record.results.find((item) => item.originalIndex === pending[0]).siteIndex, sessionId, lastTick: now(), revision: now() };
      await save();
      await resources();
      await configureSite(state.siteIndex);
      syncDatabase();
      return clone(state);
    });
    if (message.type === 'BATCH_RUN_START' || message.type === 'BATCH_RUN_NEXT') wake().catch(() => {});
    return response;
  }

  /** 仅接受当前批次、当前活动标签页的结果，跨批次消息和旧重试消息均不能影响新队列。 */
  async function report(message, sender) {
    const managed = await enqueue(async () => {
      if (!state || state.record.id !== message.batchId) return false;
      const tab = state.active.find((entry) => entry.index === message.urlIndex && entry.tabId === sender.tab?.id);
      if (!running() || !tab) return true;
      await finish(tab.index, { result: message.result || 'success', aiContent: message.aiContent || null,
        errorMessage: message.errorMessage || null, pageMetrics: message.pageMetrics || null }, tab);
      syncDatabase();
      return true;
    });
    if (managed) wake().catch(() => {});
    return managed;
  }

  return { command, report, wake };
}

/** 顶层同步注册事件，确保休眠 Worker 被标签页、闹钟或启动事件唤醒后能立即接管队列。 */
export function installBatchRunner(api) {
  const runner = createBatchRunner(api);
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['BATCH_RUN_START', 'BATCH_RUN_STOP', 'BATCH_RUN_GET', 'BATCH_RUN_NEXT'].includes(message?.type)) return;
    if (sender.tab && !sender.url?.startsWith(api.runtime.getURL(''))) return;
    runner.command(message).then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BATCH_RUNNER_ALARM) runner.wake().catch(() => {});
  });
  api.tabs.onUpdated.addListener(() => runner.wake().catch(() => {}));
  api.tabs.onRemoved.addListener(() => runner.wake().catch(() => {}));
  api.runtime.onStartup.addListener(() => runner.wake().catch(() => {}));
  runner.wake().catch(() => {});
  return runner;
}
