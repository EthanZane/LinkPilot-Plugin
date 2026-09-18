// 批量外链评论自动化 - 扩展端核心逻辑（本地批次管理）

// 设置页会同时加载 options.js 和 batch.js；使用独立作用域隔离顶层状态，避免同名配置键导致整份批量脚本停止执行。
(() => {
  'use strict';

// ==================== 配置 ====================
const POLL_INTERVAL = 3000;
const TIMEOUT_CHECK_INTERVAL = 5000;
const TIMEOUT_STORAGE_KEY = 'batch_timeout_seconds';
const LOCAL_DATABASE_API_BASE = 'http://127.0.0.1:17321';
const LOCAL_DATABASE_REQUEST_TIMEOUT_MS = 1500;
const LOCAL_DATABASE_SYNC_TIMEOUT_MS = 30000;
const BATCH_HISTORY_STORAGE_KEY = 'auto_comment_batch_history_v1';
const MAX_SYNCED_BATCH_HISTORY = 200;

// ==================== 状态 ====================
let batchId = null;
let parsedUrls = [];                // [{originalIndex, url}]
let status = 'idle';                // idle | running | completed
let activeTabCount = 0;
let currentIndex = 0;               // 当前处理到的索引（本地管理）

// 实时计数
let totalCount = 0;
let successCount = 0;
let failCount = 0;
let skippedCount = 0;
let noCommentBoxCount = 0;
let manualRequiredCount = 0;
let blockedIllegalCount = 0;
let unstartedCount = 0;
let pendingCount = 0;

// 本地结果存储
let localResults = [];              // [{originalIndex, url, result, aiContent, errorMessage, timestamp}]
let batchSourceName = '';
let batchSourceType = '';
let databaseFailedItemIndexes = new Set();
let batchStartedAt = null;
let batchCompletedAt = null;
let batchHistory = [];
let batchHistoryWriteChain = Promise.resolve();
const BATCH_HISTORY_PAGE_SIZE = 10;
let batchHistoryCurrentPage = 1;

// 轮询定时器
let pollTimer = null;

// 活跃标签页记录 { tabId -> { urlIndex, startTime } }
let activeTabs = new Map();
let activeTabsByIndex = new Map();  // urlIndex -> { urlIndex, startTime }

// 定时器
let timeoutCheckTimer = null;
let timeoutSeconds = 60;
let timeoutRetryCount = 1;
const TIMEOUT_RETRY_STORAGE_KEY = 'batch_timeout_retry_count';
let manualUrlParseTimer = null;

// 标签打开锁（防止并发）
let isOpeningTab = false;

// 等待确认的标签页: tabId -> { urlIndex }
let tabsPendingConfirm = new Map();
// 需要收到 BATCH_CONFIRMED 才关闭的标签页
let tabsWaitingClose = new Set();
// 已跳过（已存在评论）的 urlIndex 记录
let skippedIndices = new Set();
// 正在重试的行索引集合
let retryingItemIndexes = new Set();
// 超时重试计数器: urlIndex -> 重试次数
const timeoutRetryMap = new Map();
// 待重试队列
let pendingRetryQueue = [];

// ==================== DOM 引用 ====================
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileCount = document.getElementById('fileCount');
const fileRemove = document.getElementById('fileRemove');
const urlPreview = document.getElementById('urlPreview');
const urlPreviewBody = document.getElementById('urlPreviewBody');
const manualUrlsInput = document.getElementById('manualUrlsInput');
const parseManualUrlsBtn = document.getElementById('parseManualUrlsBtn');
const clearManualUrlsBtn = document.getElementById('clearManualUrlsBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const successCountEl = document.getElementById('successCount');
const failCountEl = document.getElementById('failCount');
const skippedCountEl = document.getElementById('skippedCount');
const noCommentBoxCountEl = document.getElementById('statsNoCommentBox');
const manualRequiredCountEl = document.getElementById('manualRequiredCount');
const pendingCountEl = document.getElementById('pendingCount');
const progressText = document.getElementById('progressText');
const footerActions = document.getElementById('footerActions');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const providerSource = document.getElementById('providerSource');
const statusBadge = document.getElementById('statusBadge');
const timeoutInput = document.getElementById('timeoutInput');
const timeoutRetryCountInput = document.getElementById('timeoutRetryCountInput');
const concurrencyInput = document.getElementById('concurrencyInput');
const CONCURRENCY_STORAGE_KEY = 'batch_concurrency_tabs';
let maxConcurrentTabs = 3;
const statsPanel = document.getElementById('statsPanel');
const statsTotal = document.getElementById('statsTotal');
const statsSuccess = document.getElementById('statsSuccess');
const statsSkipped = document.getElementById('statsSkipped');
const statsManualRequired = document.getElementById('statsManualRequired');
const statsNoCommentBox = document.getElementById('statsNoCommentBox');
const statsBlockedIllegal = document.getElementById('statsBlockedIllegal');
const statsFail = document.getElementById('statsFail');
const statsUnstarted = document.getElementById('statsUnstarted');
const statsRate = document.getElementById('statsRate');
const filterResult = document.getElementById('filterResult');
const filterDomain = document.getElementById('filterDomain');
const filterTimeRange = document.getElementById('filterTimeRange');
const filterPageDepth = document.getElementById('filterPageDepth');
const filterKeyword = document.getElementById('filterKeyword');
const statsTableBody = document.getElementById('statsTableBody');
const statsTableWrap = document.getElementById('statsTableWrap');
const statsCountLabel = document.getElementById('statsCountLabel');
const statsScopeBadge = document.getElementById('statsScopeBadge');
const toggleSiteOverviewBtn = document.getElementById('toggleSiteOverviewBtn');
const statsSiteNav = document.getElementById('statsSiteNav');
const statsSiteTabs = document.getElementById('statsSiteTabs');
const statsSiteOverviewWrap = document.getElementById('statsSiteOverviewWrap');
const statsSiteOverviewBody = document.getElementById('statsSiteOverviewBody');
const filterTargetSite = document.getElementById('filterTargetSite');
let statsSelectedSiteKey = 'all';
let isSiteOverviewOpen = false;
const batchSiteSummaryName = document.getElementById('batchSiteSummaryName');
const batchSiteSummaryUrl = document.getElementById('batchSiteSummaryUrl');
const batchSiteSummary = document.getElementById('batchSiteSummary');
const databasePersistence = document.getElementById('databasePersistence');
const databasePersistenceMessage = document.getElementById('databasePersistenceMessage');
const retryDatabaseBtn = document.getElementById('retryDatabaseBtn');
const retryAllFailedBtn = document.getElementById('retryAllFailedBtn');
const syncDbHistoryBtn = document.getElementById('syncDbHistoryBtn');
const importResultCsvBtn = document.getElementById('importResultCsvBtn');
const resultCsvInput = document.getElementById('resultCsvInput');
const batchHistoryEmpty = document.getElementById('batchHistoryEmpty');
const batchHistoryWrap = document.getElementById('batchHistoryWrap');
const batchHistoryBody = document.getElementById('batchHistoryBody');
const batchHistoryPagination = document.getElementById('batchHistoryPagination');
const batchHistoryPageInfo = document.getElementById('batchHistoryPageInfo');
const batchHistoryPrevPageBtn = document.getElementById('batchHistoryPrevPageBtn');
const batchHistoryNextPageBtn = document.getElementById('batchHistoryNextPageBtn');

// 批量任务设置勾选框
const batchAutoOpenPanel = document.getElementById('batchAutoOpenPanel');
const batchAutoGenerate = document.getElementById('batchAutoGenerate');
const batchAutoSubmit = document.getElementById('batchAutoSubmit');
const batchIgnoreHistory = document.getElementById('batchIgnoreHistory');
const batchDebugMode = document.getElementById('batchDebugMode');
const batchDebugOptions = document.getElementById('batchDebugOptions');
const batchDebugCommentSelect = document.getElementById('batchDebugCommentSelect');
const batchDebugCustomComment = document.getElementById('batchDebugCustomComment');

const DEFAULT_DEBUG_PRESET_COMMENTS = [
  "Great article! Thank you for sharing these helpful insights.",
  "Very informative post, really appreciate the detailed breakdown!",
  "Awesome tips! Thanks for putting this together, very useful read.",
  "Thanks for sharing this great resource, found it very helpful!",
  "Excellent summary, thanks for taking the time to share this!"
];

function resolveDebugCommentText(site) {
  const commentType = batchDebugCommentSelect ? batchDebugCommentSelect.value : 'random';
  let text = '';
  if (commentType === 'custom') {
    text = (batchDebugCustomComment ? batchDebugCustomComment.value : '').trim() || DEFAULT_DEBUG_PRESET_COMMENTS[0];
  } else if (commentType === 'preset_1') {
    text = DEFAULT_DEBUG_PRESET_COMMENTS[0];
  } else if (commentType === 'preset_2') {
    text = DEFAULT_DEBUG_PRESET_COMMENTS[1];
  } else if (commentType === 'preset_3') {
    text = DEFAULT_DEBUG_PRESET_COMMENTS[2];
  } else if (commentType === 'preset_4') {
    text = DEFAULT_DEBUG_PRESET_COMMENTS[3];
  } else {
    // random
    const idx = Math.floor(Math.random() * DEFAULT_DEBUG_PRESET_COMMENTS.length);
    text = DEFAULT_DEBUG_PRESET_COMMENTS[idx];
  }

  // 支持 {url}, {name} 变量替换
  const siteUrl = site && site.url ? site.url : '';
  const siteName = site && site.name ? site.name : '';
  text = text.replace(/\{url\}/gi, siteUrl).replace(/\{name\}/gi, siteName);
  return text;
}

// ==================== 批量任务设置存储键 ====================
const BATCH_SETTINGS_KEY = 'batch_task_settings';
const BATCH_URLS_KEY = 'batch_task_urls';
const BATCH_SITES_CONFIG_STORAGE_KEY = 'promotion_sites_config';
const BATCH_WEBSITE_URL_STORAGE_KEY = 'promotion_website_url';
const BATCH_WEBSITE_CONTENT_STORAGE_KEY = 'promotion_website_content';
const BATCH_USER_NAME_STORAGE_KEY = 'auto_fill_user_name';
const BATCH_LEGACY_PROMPT_FIELD_VALUES_STORAGE_KEY = 'auto_fill_prompt_field_values';
const BATCH_SELECTED_PROMOTION_SITE_STORAGE_KEY = 'auto_comment_batch_selected_promotion_site_id';
const BATCH_SELECTED_PROMOTION_SITE_IDS_STORAGE_KEY = 'auto_comment_batch_selected_promotion_site_ids';

// 批次启动时锁定目标 URL 快照，防止运行过程中切换设置导致同一批次混用目标资料。
let availablePromotionSites = [];
let batchPromotionSite = null;
let batchPromotionSiteUserSelected = false;
let batchSavedPromotionSiteId = '';
let batchSelectedPromotionSiteIds = [];
let batchTargetQueue = [];
let currentQueueSiteIndex = 0;
let queueTransitionTimer = null;

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get([
    BATCH_SELECTED_PROMOTION_SITE_IDS_STORAGE_KEY,
    BATCH_SELECTED_PROMOTION_SITE_STORAGE_KEY,
    'auto_comment_selected_promotion_site_id'
  ], (data) => {
    let savedIds = Array.isArray(data && data[BATCH_SELECTED_PROMOTION_SITE_IDS_STORAGE_KEY])
      ? data[BATCH_SELECTED_PROMOTION_SITE_IDS_STORAGE_KEY].filter(Boolean)
      : [];
    if (savedIds.length === 0) {
      const single = String(data && (data[BATCH_SELECTED_PROMOTION_SITE_STORAGE_KEY] || data['auto_comment_selected_promotion_site_id']) || '').trim();
      if (single) savedIds = [single];
    }
    if (savedIds.length > 0) {
      batchSelectedPromotionSiteIds = savedIds;
      batchSavedPromotionSiteId = savedIds[0];
      if (availablePromotionSites.length > 0) {
        renderBatchPromotionSitesList();
      }
    }
  });
}

// 全局勾选框设置的 storage.sync 键
const BATCH_CHECKBOX_SETTINGS_KEY = 'batch_checkbox_settings';
const batchPromotionSiteSelect = document.getElementById('batchPromotionSiteSelect');

/**
 * 规范化批量任务使用的网站快照，仅保留生成评论和填写表单需要的字段。
 */
function normalizeBatchPromotionSite(site) {
  const url = String(site && site.url || '').trim();
  const name = String(site && site.name || '').trim();
  return {
    id: String(site && site.id || url || name || 'default_site').trim(),
    name,
    url,
    content: String(site && site.content || '').trim(),
    anchors: Array.isArray(site && site.anchors)
      ? site.anchors.map((anchor) => ({
        id: String(anchor && anchor.id || '').trim(),
        text: String(anchor && anchor.text || '').trim(),
        enabled: anchor && anchor.enabled === false ? false : true
      })).filter((anchor) => anchor.text)
      : []
  };
}

/**
 * 生成批量页下拉框文案，选择只作用于本批次，不回写目标 URL 管理配置。
 */
function formatBatchPromotionSiteOption(site) {
  const name = site.name || site.url || '未命名目标';
  return `${name} - ${site.url || '未填写 URL'}`;
}

/**
 * 从配置对象提取目标 URL 列表。批量页允许展示已配置但内容不完整的目标，开始执行时再做完整性校验。
 */
function getBatchPromotionSitesFromConfig(config) {
  if (!config || !Array.isArray(config.sites)) return [];
  return config.sites
    .map(normalizeBatchPromotionSite)
    .filter((site) => site.id && (site.name || site.url || site.content));
}

/**
 * 设置批量目标 URL 下拉框的临时状态，避免初始化期间出现空白选择框。
 */
function setBatchPromotionSiteSelectMessage(text, disabled = false) {
  if (!batchPromotionSiteSelect) return;
  batchPromotionSiteSelect.innerHTML = '';
  const option = document.createElement('option');
  option.value = '';
  option.textContent = text;
  option.label = text;
  batchPromotionSiteSelect.appendChild(option);
  batchPromotionSiteSelect.selectedIndex = 0;
  batchPromotionSiteSelect.disabled = disabled;
}

/**
 * 保存用户在批量页多选的目标站点 ID 列表到本地存储。
 */
function saveBatchSelectedPromotionSiteIds() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({
      [BATCH_SELECTED_PROMOTION_SITE_IDS_STORAGE_KEY]: batchSelectedPromotionSiteIds,
      [BATCH_SELECTED_PROMOTION_SITE_STORAGE_KEY]: batchSelectedPromotionSiteIds[0] || '',
      'auto_comment_selected_promotion_site_id': batchSelectedPromotionSiteIds[0] || ''
    }, () => {});
  }
}

/**
 * 渲染批量页目标 URL 列表，支持多选排队执行。
 */
function renderBatchPromotionSitesList() {
  const container = document.getElementById('batchPromotionSitesList');
  if (container) {
    container.innerHTML = '';
  }

  if (availablePromotionSites.length === 0) {
    if (container) {
      container.innerHTML = '<div style="padding:10px;color:#9ca3af;font-size:12px;text-align:center;">未读取到目标 URL，请先在目标 URL 管理中添加并保存</div>';
    }
    batchPromotionSite = null;
    batchSelectedPromotionSiteIds = [];
    if (batchPromotionSiteSelect) {
      batchPromotionSiteSelect.innerHTML = '<option value="">未读取到目标 URL</option>';
    }
    updateBatchPromotionSiteSummary();
    updateUI();
    return;
  }

  // 保留仍在 availablePromotionSites 中的已选 ID
  batchSelectedPromotionSiteIds = batchSelectedPromotionSiteIds.filter((id) =>
    availablePromotionSites.some((site) => site.id === id)
  );

  // 如果没有选中项，默认选中第一个
  if (batchSelectedPromotionSiteIds.length === 0 && availablePromotionSites[0]) {
    batchSelectedPromotionSiteIds = [availablePromotionSites[0].id];
  }

  const isLocked = status === 'running' || status === 'queue_transition';

  if (container) {
    availablePromotionSites.forEach((site) => {
      const isChecked = batchSelectedPromotionSiteIds.includes(site.id);
      const orderIndex = isChecked ? batchSelectedPromotionSiteIds.indexOf(site.id) + 1 : 0;

      const item = document.createElement('div');
      item.className = `batch-site-item${isChecked ? ' checked' : ''}`;
      item.dataset.siteId = site.id;

      const label = document.createElement('label');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'batch-site-checkbox';
      checkbox.value = site.id;
      checkbox.checked = isChecked;
      checkbox.disabled = isLocked;

      const orderBadge = document.createElement('span');
      orderBadge.className = 'batch-site-order-badge';
      orderBadge.style.display = isChecked ? 'inline-flex' : 'none';
      orderBadge.textContent = String(orderIndex);

      const info = document.createElement('div');
      info.className = 'batch-site-info';

      const title = document.createElement('span');
      title.className = 'batch-site-title';
      title.textContent = site.name || '未命名目标';

      const urlSpan = document.createElement('span');
      urlSpan.className = 'batch-site-url';
      urlSpan.textContent = site.url || '未填写 URL';

      info.appendChild(title);
      info.appendChild(urlSpan);

      label.appendChild(checkbox);
      label.appendChild(orderBadge);
      label.appendChild(info);
      item.appendChild(label);
      container.appendChild(item);

      item.addEventListener('click', (e) => {
        if (e.target === checkbox) return;
        if (isLocked) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });

      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const siteId = site.id;
        if (checkbox.checked) {
          if (!batchSelectedPromotionSiteIds.includes(siteId)) {
            batchSelectedPromotionSiteIds.push(siteId);
          }
        } else {
          batchSelectedPromotionSiteIds = batchSelectedPromotionSiteIds.filter((id) => id !== siteId);
        }
        saveBatchSelectedPromotionSiteIds();
        renderBatchPromotionSitesList();
      });
    });
  }

  // 更新下拉框触发区域的选中文案与徽标 chips
  const dropdownSelectedEl = document.getElementById('batchDropdownSelected');
  if (dropdownSelectedEl) {
    dropdownSelectedEl.innerHTML = '';
    const selectedSites = getSelectedBatchPromotionSites();
    if (selectedSites.length === 0) {
      dropdownSelectedEl.innerHTML = '<span class="placeholder" style="color:#9ca3af;font-size:13px;">请选择目标 URL（支持多选）...</span>';
    } else if (selectedSites.length === 1) {
      const s = selectedSites[0];
      const chip = document.createElement('span');
      chip.className = 'batch-site-chip';
      chip.innerHTML = `<span class="chip-num">1</span> ${escapeHtml(s.name || '未命名目标')}`;
      
      const urlText = document.createElement('span');
      urlText.style.cssText = 'color:#6b7280;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:4px;';
      urlText.textContent = s.url || '';

      dropdownSelectedEl.appendChild(chip);
      if (s.url) dropdownSelectedEl.appendChild(urlText);
    } else {
      const maxChips = 3;
      selectedSites.slice(0, maxChips).forEach((s, idx) => {
        const chip = document.createElement('span');
        chip.className = 'batch-site-chip';
        chip.innerHTML = `<span class="chip-num">${idx + 1}</span> ${escapeHtml(s.name || '未命名目标')}`;
        dropdownSelectedEl.appendChild(chip);
      });
      if (selectedSites.length > maxChips) {
        const moreSpan = document.createElement('span');
        moreSpan.style.cssText = 'font-size:12px;color:#6b7280;align-self:center;margin-left:2px;';
        moreSpan.textContent = `...等共 ${selectedSites.length} 个目标`;
        dropdownSelectedEl.appendChild(moreSpan);
      }
    }
  }

  // 同步首个目标给 batchPromotionSite 与隐藏 select
  const firstSelectedSite = availablePromotionSites.find((site) => site.id === batchSelectedPromotionSiteIds[0]) || availablePromotionSites[0];
  batchPromotionSite = firstSelectedSite ? normalizeBatchPromotionSite(firstSelectedSite) : null;
  if (batchPromotionSiteSelect) {
    batchPromotionSiteSelect.innerHTML = '';
    availablePromotionSites.forEach((site) => {
      const option = document.createElement('option');
      option.value = site.id;
      option.textContent = formatBatchPromotionSiteOption(site);
      batchPromotionSiteSelect.appendChild(option);
    });
    if (batchPromotionSite) {
      batchPromotionSiteSelect.value = batchPromotionSite.id;
    }
  }

  updateBatchPromotionSiteSummary();
  updateUI();
}

/**
 * 兼容原有接口：渲染批量页目标 URL，并支持更新指定站点。
 */
function renderBatchPromotionSiteSelect(preferredSiteId) {
  if (preferredSiteId && availablePromotionSites.some((s) => s.id === preferredSiteId)) {
    if (!batchSelectedPromotionSiteIds.includes(preferredSiteId)) {
      batchSelectedPromotionSiteIds = [preferredSiteId];
    }
  }
  renderBatchPromotionSitesList();
}

/**
 * 应用目标 URL 管理页广播出的最新配置，让批量页能看到尚未写入 storage 的当前页面配置快照。
 */
function applyBatchSitesConfig(config, preferredSiteId) {
  if (!config || !Array.isArray(config.sites)) return false;
  availablePromotionSites = getBatchPromotionSitesFromConfig(config);
  if (preferredSiteId && availablePromotionSites.some((site) => site.id === preferredSiteId)) {
    if (!batchSelectedPromotionSiteIds.includes(preferredSiteId)) {
      batchSelectedPromotionSiteIds = [preferredSiteId];
    }
  }
  renderBatchPromotionSitesList();
  return availablePromotionSites.length > 0;
}

// 暴露给 options.js 直接调用，避免同页脚本初始化时序导致批量下拉框错过目标 URL 管理数据。
window.AutoCommentApplyBatchSitesConfig = (config, preferredSiteId) => {
  return applyBatchSitesConfig(config, preferredSiteId);
};

if (window.AutoCommentSitesConfig) {
  applyBatchSitesConfig(window.AutoCommentSitesConfig);
}

/**
 * 从旧版提示词字段里按关键词提取目标资料，兼容早期单目标配置备份。
 */
function pickLegacyBatchPromptValue(values, keywords) {
  if (!values || typeof values !== 'object') return '';
  const normalizedKeywords = keywords.map((keyword) => String(keyword).toLowerCase());
  const entry = Object.entries(values).find(([key, value]) => {
    if (!value) return false;
    const normalizedKey = String(key || '').toLowerCase();
    return normalizedKeywords.some((keyword) => normalizedKey.includes(keyword));
  });
  return entry ? String(entry[1] || '').trim() : '';
}

/**
 * 构造旧版单目标配置，确保批量页和实际内容脚本读取当前目标 URL 时行为一致。
 */
function buildLegacyBatchPromotionSite(syncData) {
  const legacyUrl = String(syncData && syncData[BATCH_WEBSITE_URL_STORAGE_KEY] || '').trim()
    || pickLegacyBatchPromptValue(syncData && syncData[BATCH_LEGACY_PROMPT_FIELD_VALUES_STORAGE_KEY], [
      '目标 URL',
      '目标URL',
      '网址',
      'website link',
      'website url',
      'url'
    ]);
  const legacyContent = String(syncData && syncData[BATCH_WEBSITE_CONTENT_STORAGE_KEY] || '').trim()
    || pickLegacyBatchPromptValue(syncData && syncData[BATCH_LEGACY_PROMPT_FIELD_VALUES_STORAGE_KEY], [
      '目标 URL 内容',
      '目标URL内容',
      'website content',
      'site content',
      'description'
    ]);
  const legacyName = String(syncData && syncData[BATCH_USER_NAME_STORAGE_KEY] || '').trim();
  return normalizeBatchPromotionSite({
    id: 'default_site',
    name: legacyName || legacyUrl || '默认目标',
    url: legacyUrl,
    content: legacyContent,
    anchors: []
  });
}

/**
 * 从目标 URL 管理配置中加载可用目标，并默认选中上次用于批量任务的目标。
 * 读取顺序与 content.js 保持一致：local 多目标配置 > sync 多目标配置 > 旧版当前目标字段。
 */
async function loadBatchPromotionSites(preferredSiteId) {
  setBatchPromotionSiteSelectMessage('正在加载目标 URL...', true);

  const localData = await new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      resolve({});
      return;
    }
    chrome.storage.local.get([
      BATCH_SITES_CONFIG_STORAGE_KEY,
      BATCH_SELECTED_PROMOTION_SITE_STORAGE_KEY,
      'auto_comment_selected_promotion_site_id'
    ], resolve);
  });

  const savedId = String(
    localData && (
      localData[BATCH_SELECTED_PROMOTION_SITE_STORAGE_KEY] ||
      localData['auto_comment_selected_promotion_site_id']
    ) || ''
  ).trim();

  if (savedId) {
    batchSavedPromotionSiteId = savedId;
  }

  const runtimeConfig = window.AutoCommentSitesConfig;
  const localConfig = localData && localData[BATCH_SITES_CONFIG_STORAGE_KEY];

  let syncData = null;
  if (!runtimeConfig && (!localConfig || !Array.isArray(localConfig.sites) || localConfig.sites.length === 0)) {
    syncData = await new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        resolve({});
        return;
      }
      chrome.storage.sync.get([
        BATCH_SITES_CONFIG_STORAGE_KEY,
        BATCH_WEBSITE_URL_STORAGE_KEY,
        BATCH_WEBSITE_CONTENT_STORAGE_KEY,
        BATCH_USER_NAME_STORAGE_KEY,
        BATCH_LEGACY_PROMPT_FIELD_VALUES_STORAGE_KEY
      ], resolve);
    });
  }

  const syncConfig = syncData && syncData[BATCH_SITES_CONFIG_STORAGE_KEY];
  const config = runtimeConfig
    || (Array.isArray(localConfig && localConfig.sites) && localConfig.sites.length > 0 ? localConfig : syncConfig);

  availablePromotionSites = getBatchPromotionSitesFromConfig(config);

  if (availablePromotionSites.length === 0 && syncData) {
    const legacySite = buildLegacyBatchPromotionSite(syncData || {});
    if (legacySite.url || legacySite.content) {
      availablePromotionSites = [legacySite];
    }
  }

  const currentSelectValue = batchPromotionSiteSelect && batchPromotionSiteSelect.value ? batchPromotionSiteSelect.value : '';
  const currentSelectionStillValid = availablePromotionSites.some((site) => site.id === currentSelectValue);
  const targetSiteId = preferredSiteId
    || (currentSelectionStillValid ? currentSelectValue : '')
    || batchSavedPromotionSiteId
    || (config && config.activeSiteId)
    || '';

  renderBatchPromotionSiteSelect(targetSiteId);
}

function getSelectedBatchPromotionSites() {
  return batchSelectedPromotionSiteIds
    .map((id) => availablePromotionSites.find((site) => site.id === id))
    .filter(Boolean)
    .map(normalizeBatchPromotionSite);
}

function getSelectedBatchPromotionSite() {
  const sites = getSelectedBatchPromotionSites();
  return sites[0] || (batchPromotionSite ? normalizeBatchPromotionSite(batchPromotionSite) : null);
}

/**
 * 在开始按钮附近展示本批次将使用的目标站点及队列信息。
 */
function updateBatchPromotionSiteSummary() {
  if (!batchSiteSummaryName || !batchSiteSummaryUrl) return;
  const isRunningOrTransition = status === 'running' || status === 'queue_transition';
  const sites = isRunningOrTransition && batchTargetQueue.length > 0
    ? batchTargetQueue
    : getSelectedBatchPromotionSites();
  const count = sites.length;
  const label = batchSiteSummary ? batchSiteSummary.querySelector('strong') : null;

  if (count === 0) {
    if (label) label.textContent = '即将使用';
    batchSiteSummaryName.innerHTML = '<span style="color:#9ca3af;font-weight:normal;">未选择目标 URL</span>';
    batchSiteSummaryUrl.textContent = '请在上方下拉框中勾选至少一个目标站点';
    return;
  }

  if (isRunningOrTransition) {
    const currentSite = batchTargetQueue[currentQueueSiteIndex] || batchPromotionSite;
    if (label) {
      label.textContent = count > 1 ? `当前目标 [${currentQueueSiteIndex + 1}/${count}]` : '本批次使用';
    }
    const currentSiteName = currentSite ? (currentSite.name || '未命名目标') : '—';
    if (count > 1) {
      batchSiteSummaryName.innerHTML = `<span class="batch-summary-step active" title="${escapeHtml(currentSiteName)}"><span class="step-num">${currentQueueSiteIndex + 1}</span><span class="step-name">${escapeHtml(currentSiteName)}</span></span>` +
        `<span class="batch-summary-queue-meta">（正在执行第 ${currentQueueSiteIndex + 1} 个站点，共 ${count} 个）</span>`;
      const remaining = count - currentQueueSiteIndex - 1;
      const nextSite = batchTargetQueue[currentQueueSiteIndex + 1];
      batchSiteSummaryUrl.textContent = nextSite
        ? `${currentSite?.url || ''}（下一个: ${nextSite.name}，剩余 ${remaining} 个）`
        : `${currentSite?.url || ''}（队列最后一个）`;
    } else {
      batchSiteSummaryName.textContent = currentSiteName;
      batchSiteSummaryUrl.textContent = currentSite && currentSite.url ? currentSite.url : '—';
    }
    return;
  }

  // Idle / Terminated / Completed
  if (count === 1) {
    const site = sites[0];
    if (label) label.textContent = '即将使用';
    batchSiteSummaryName.textContent = site.name || '未命名目标';
    batchSiteSummaryUrl.textContent = site.url || '—';
  } else {
    if (label) label.textContent = `串行执行队列 (共 ${count} 个站点)`;
    batchSiteSummaryName.innerHTML = sites.map((s, idx) =>
      `<span class="batch-summary-step" title="${escapeHtml(s.name || '未命名目标')}"><span class="step-num">${idx + 1}</span><span class="step-name">${escapeHtml(s.name || '未命名目标')}</span></span>`
    ).join('<span class="batch-summary-arrow">➔</span>');
    batchSiteSummaryUrl.textContent = '按顺序依次为每个目标站点跑完所有引荐 URL（站点间自动切换）';
  }
}

/**
 * 更新多站点任务队列进度条与站点间切换倒计时提示。
 */
function updateQueueBanner() {
  const banner = document.getElementById('batchQueueBanner');
  if (!banner) return;
  if (!batchTargetQueue || batchTargetQueue.length <= 1 || (status !== 'running' && status !== 'queue_transition')) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  banner.style.display = 'flex';
  const totalSites = batchTargetQueue.length;
  const currentNum = currentQueueSiteIndex + 1;
  const currentSite = batchTargetQueue[currentQueueSiteIndex];

  if (status === 'queue_transition') {
    const prevSite = batchTargetQueue[currentQueueSiteIndex - 1];
    banner.innerHTML = `
      <div style="flex:1;">
        <div style="font-weight:600;color:#065f46;margin-bottom:2px;">
          ✅ 站点 [${escapeHtml(prevSite?.name || '上一目标')}] 已完成该站点全部 ${parsedUrls.length} 条 URL！
        </div>
        <div id="queueTransitionCountdownText" style="color:#1e40af;font-size:12px;">
          即将开始下一个目标站点 [${escapeHtml(currentSite?.name || '')}] (${currentNum}/${totalSites})...
        </div>
      </div>
      <button type="button" class="queue-skip-btn" id="skipQueueTransitionBtn">立即开始下一个</button>
    `;
    const skipBtn = document.getElementById('skipQueueTransitionBtn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        startNextSiteInQueue();
      });
    }
  } else {
    const queueNames = batchTargetQueue.map((s, idx) => {
      if (idx === currentQueueSiteIndex) {
        return `<span style="font-weight:700;color:#1d4ed8;background:#dbeafe;padding:1px 6px;border-radius:4px;">[${idx + 1}] ${escapeHtml(s.name)} (运行中)</span>`;
      }
      if (idx < currentQueueSiteIndex) {
        return `<span style="color:#059669;">[${idx + 1}] ${escapeHtml(s.name)} (已完成)</span>`;
      }
      return `<span style="color:#6b7280;">[${idx + 1}] ${escapeHtml(s.name)} (排队中)</span>`;
    }).join(' ➔ ');
    banner.innerHTML = `<div><strong>🎯 目标站点队列 (${currentNum}/${totalSites})：</strong> ${queueNames}</div>`;
  }
}

// 更新 Debug 模式 UI 交互
function updateDebugModeUI() {
  if (!batchDebugMode) return;
  const isDebug = batchDebugMode.checked;
  if (batchDebugOptions) {
    batchDebugOptions.style.display = isDebug ? 'block' : 'none';
  }
  if (batchDebugCustomComment && batchDebugCommentSelect) {
    batchDebugCustomComment.style.display = (isDebug && batchDebugCommentSelect.value === 'custom') ? 'block' : 'none';
  }
  if (batchAutoGenerate && batchAutoGenerate.parentElement) {
    batchAutoGenerate.disabled = isDebug;
    batchAutoGenerate.parentElement.style.opacity = isDebug ? '0.5' : '1';
  }
}

// 加载全局勾选框设置
async function loadBatchCheckboxSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([BATCH_CHECKBOX_SETTINGS_KEY], (data) => {
      const saved = data[BATCH_CHECKBOX_SETTINGS_KEY] || {};
      if (batchAutoOpenPanel) batchAutoOpenPanel.checked = saved.autoOpenPanel !== false;
      if (batchAutoGenerate) batchAutoGenerate.checked = saved.autoGenerate !== false;
      if (batchAutoSubmit) batchAutoSubmit.checked = saved.autoSubmit !== false;
      if (batchIgnoreHistory) batchIgnoreHistory.checked = Boolean(saved.ignoreHistory);
      if (batchDebugMode) {
        batchDebugMode.checked = Boolean(saved.debugMode);
        if (batchDebugCommentSelect && saved.debugCommentType) {
          batchDebugCommentSelect.value = saved.debugCommentType;
        }
        if (batchDebugCustomComment && saved.debugCustomComment) {
          batchDebugCustomComment.value = saved.debugCustomComment;
        }
        updateDebugModeUI();
      }
      console.log('[batch] 已加载全局勾选框设置:', saved);
      resolve();
    });
  });
}

// 保存全局勾选框设置
async function saveBatchCheckboxSettings() {
  return new Promise((resolve) => {
    const isDebug = batchDebugMode ? batchDebugMode.checked : false;
    updateDebugModeUI();
    const settings = {
      autoOpenPanel: batchAutoOpenPanel ? batchAutoOpenPanel.checked : true,
      autoGenerate: batchAutoGenerate ? batchAutoGenerate.checked : true,
      autoSubmit: batchAutoSubmit ? batchAutoSubmit.checked : true,
      ignoreHistory: batchIgnoreHistory ? batchIgnoreHistory.checked : false,
      debugMode: isDebug,
      debugCommentType: batchDebugCommentSelect ? batchDebugCommentSelect.value : 'random',
      debugCustomComment: batchDebugCustomComment ? batchDebugCustomComment.value : ''
    };
    chrome.storage.sync.set({
      [BATCH_CHECKBOX_SETTINGS_KEY]: settings
    }, () => {
      console.log('[batch] 全局勾选框设置已保存:', settings);
      resolve();
    });
  });
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadTimeoutSetting();
  await loadTimeoutRetrySetting();
  await loadConcurrencySetting();
  await loadBatchCheckboxSettings(); // 全局记忆的勾选框设置
  await loadBatchPromotionSites();
  bindEvents();
  await loadBatchHistory();
  const restored = await restoreLastBatchResults();
  if (!restored) updateUI();
  // 异步在后台静默尝试从本地数据库拉取/恢复历史批次记录
  syncBatchHistoryFromDatabase({ notify: false }).catch(() => {});
}

/**
 * 恢复最近一次批次结果，支持扩展刷新后继续补写数据库，避免为了修复落库而重复发表评论。
 */
async function restoreLastBatchResults() {
  const saved = batchHistory.find((record) => record.databaseStatus !== 'synced' && Array.isArray(record.results) && record.results.length > 0);
  if (!saved) return false;
  applyBatchHistoryRecord(saved);

  if (!batchPromotionSite.url) {
    setDatabasePersistenceState('failed', '已恢复最近批次，但缺少目标 URL 快照，无法重新写入数据库。');
    return true;
  }

  try {
    const persistedItems = await requestLocalDatabase(`/api/runs/${batchId}/items`, undefined, { method: 'GET' });
    const persistedCount = Array.isArray(persistedItems) ? persistedItems.length : 0;
    setDatabasePersistenceState('failed', `已恢复未确认同步的批次 ${localResults.length} 条结果，数据库当前有 ${persistedCount} 条。请重新同步以校验明细和最终状态。`);
  } catch (error) {
    setDatabasePersistenceState('failed', `已恢复最近批次 ${localResults.length} 条结果，但无法核对数据库：${formatDatabaseError(error)} 可在服务恢复后重新写入。`);
  }
  return true;
}

/**
 * 从扩展本地存储加载批次历史，并把旧版单批次缓存迁移到历史结构中。
 */
async function loadBatchHistory() {
  const data = await new Promise((resolve) => {
    chrome.storage.local.get([BATCH_HISTORY_STORAGE_KEY, 'batchLocalResults'], resolve);
  });
  batchHistory = Array.isArray(data && data[BATCH_HISTORY_STORAGE_KEY])
    ? data[BATCH_HISTORY_STORAGE_KEY].filter((record) => record && record.id)
    : [];

  const legacy = data && data.batchLocalResults;
  if (legacy && legacy.batchId && Array.isArray(legacy.results) && legacy.results.length > 0
    && !batchHistory.some((record) => record.id === legacy.batchId)) {
    const firstResult = legacy.results.find((item) => item && item.promotionSiteUrl) || {};
    batchHistory.push({
      id: String(legacy.batchId),
      totalCount: Number(legacy.totalCount) || legacy.results.length,
      status: legacy.results.length >= Number(legacy.totalCount) ? 'completed' : 'interrupted',
      databaseStatus: 'pending',
      sourceName: legacy.sourceName || '旧版缓存恢复',
      sourceType: legacy.sourceType || 'recovered',
      targetUrl: legacy.targetUrl || firstResult.promotionSiteUrl || '',
      targetName: legacy.targetName || firstResult.promotionSiteName || '',
      startedAt: legacy.results[0] && legacy.results[0].timestamp || Date.now(),
      completedAt: legacy.results[legacy.results.length - 1] && legacy.results[legacy.results.length - 1].timestamp || Date.now(),
      summary: summarizeBatchResults(legacy.results),
      results: legacy.results
    });
    await persistBatchHistory();
    chrome.storage.local.remove(['batchLocalResults']);
  }
  if (legacy && legacy.batchId && batchHistory.some((record) => record.id === legacy.batchId)) {
    chrome.storage.local.remove(['batchLocalResults']);
  }
  sortBatchHistory();
  renderBatchHistory();
}

/**
 * 从本地数据库拉取全部历史批次记录并与本地批次历史合并。
 * 支持在重装扩展或多端同步后快速恢复历史批次列表。
 */
async function syncBatchHistoryFromDatabase({ notify = false } = {}) {
  if (notify && syncDbHistoryBtn) {
    syncDbHistoryBtn.disabled = true;
    syncDbHistoryBtn.textContent = '正在同步...';
  }
  try {
    const runs = await requestLocalDatabase('/api/runs', undefined, {
      method: 'GET',
      timeoutMs: 5000
    });

    if (!Array.isArray(runs)) {
      if (notify) {
        setDatabasePersistenceState('warning', '数据库暂无可同步的历史批次记录。');
        alert('数据库中暂无可同步的历史批次记录。');
      }
      return 0;
    }

    let addedCount = 0;
    let updatedCount = 0;
    for (const row of runs) {
      if (!row || !row.id) continue;
      const rowId = String(row.id);
      const existingIndex = batchHistory.findIndex((r) => String(r.id) === rowId);

      const totalNum = Number(row.total_count || row.processed_count || 0);
      const processedNum = row.processed_count != null
        ? Number(row.processed_count)
        : (row.status === 'completed' ? totalNum : 0);

      const dbSummary = {
        processed: processedNum,
        success: Number(row.success_count || (row.status === 'completed' && row.processed_count == null ? totalNum : 0)),
        skipped: Number(row.skipped_count || 0),
        manualRequired: Number(row.manual_required_count || 0),
        noCommentBox: Number(row.no_comment_box_count || 0),
        blockedIllegal: Number(row.blocked_illegal_count || 0),
        fail: Number(row.fail_count || 0)
      };

      const recordFromDb = {
        id: rowId,
        totalCount: totalNum,
        status: String(row.status || 'completed'),
        databaseStatus: 'synced',
        sourceName: String(row.source_name || '数据库同步'),
        sourceType: String(row.source_type || 'database'),
        targetUrl: String(row.target_url || ''),
        targetName: String(row.target_name || ''),
        startedAt: row.started_at ? new Date(row.started_at).getTime() : Date.now(),
        completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
        summary: dbSummary,
        results: []
      };

      if (existingIndex >= 0) {
        const existing = batchHistory[existingIndex];
        // 1. 如果当前是正在运行中的批次，不覆盖其运行中状态
        if (batchId && String(batchId) === rowId && status === 'running') {
          continue;
        }
        // 2. 如果本地处于“待同步”或“同步失败”状态，且包含未同步明细，严格保留本地未同步状态和明细数据
        if (existing.databaseStatus !== 'synced' && Array.isArray(existing.results) && existing.results.length > 0) {
          continue;
        }
        // 3. 如果本地已有且保留了明细结果，保留本地明细
        if (Array.isArray(existing.results) && existing.results.length > 0) {
          batchHistory[existingIndex] = {
            ...existing,
            databaseStatus: existing.databaseStatus || 'synced',
            targetUrl: existing.targetUrl || recordFromDb.targetUrl,
            targetName: existing.targetName || recordFromDb.targetName,
            status: existing.status || recordFromDb.status
          };
        } else {
          batchHistory[existingIndex] = {
            ...existing,
            ...recordFromDb,
            sourceName: existing.sourceName || recordFromDb.sourceName
          };
        }
        updatedCount++;
      } else {
        batchHistory.push(recordFromDb);
        addedCount++;
      }
    }

    sortBatchHistory();
    await persistBatchHistory();
    renderBatchHistory();

    if (notify) {
      setDatabasePersistenceState('success', `已成功从数据库同步 ${runs.length} 个历史批次（新增 ${addedCount} 个，更新 ${updatedCount} 个）。`);
      alert(`已成功从数据库同步 ${runs.length} 个历史批次！\n点击列表中的任意批次即可载入并查看执行明细。`);
    }
    return runs.length;
  } catch (error) {
    if (notify) {
      const errorMsg = formatDatabaseError(error);
      setDatabasePersistenceState('failed', `从数据库同步历史批次失败：${errorMsg}`);
      alert(`无法从数据库同步历史批次：\n${errorMsg}\n\n若未启动本地数据库服务，可先在终端执行 pnpm server:start 后重试。`);
    } else {
      console.log('[batch] 自动从数据库同步批次跳过（数据库服务可能未启动）:', error.message || error);
    }
    return 0;
  } finally {
    if (notify && syncDbHistoryBtn) {
      syncDbHistoryBtn.disabled = false;
      syncDbHistoryBtn.textContent = '🔄 从数据库同步历史';
    }
  }
}

/**
 * 统计批次结果摘要。同步成功后删除明细，但保留这些计数供日志查看。
 */
function summarizeBatchResults(results) {
  const list = Array.isArray(results) ? results : [];
  const processedList = list.filter((item) => item.result !== 'unstarted');
  return {
    total: list.length,
    processed: processedList.length,
    success: list.filter((item) => item.result === 'success').length,
    skipped: list.filter((item) => item.result === 'skipped').length,
    manualRequired: list.filter((item) => item.result === 'manual_required').length,
    noCommentBox: list.filter((item) => item.result === 'no_comment_box').length,
    blockedIllegal: list.filter((item) => item.result === 'blocked_illegal').length,
    fail: list.filter((item) => item.result === 'fail').length,
    unstarted: list.filter((item) => item.result === 'unstarted').length
  };
}

function sortBatchHistory() {
  batchHistory.sort((left, right) => Number(right.startedAt || 0) - Number(left.startedAt || 0));
}

/**
 * 串行写入批次历史，避免多条结果快速完成时后发的旧快照覆盖新快照。
 * 未同步记录不做数量淘汰；只限制已同步摘要的保留数量。
 */
function persistBatchHistory() {
  sortBatchHistory();
  const unsynced = batchHistory.filter((record) => record.databaseStatus !== 'synced');
  const synced = batchHistory.filter((record) => record.databaseStatus === 'synced').slice(0, MAX_SYNCED_BATCH_HISTORY);
  batchHistory = [...unsynced, ...synced];
  sortBatchHistory();
  const snapshot = JSON.parse(JSON.stringify(batchHistory));
  batchHistoryWriteChain = batchHistoryWriteChain.then(() => new Promise((resolve) => {
    chrome.storage.local.set({ [BATCH_HISTORY_STORAGE_KEY]: snapshot }, () => {
      if (chrome.runtime.lastError) {
        console.error('[batch] 本地批次历史写入失败:', chrome.runtime.lastError.message);
        setDatabasePersistenceState('warning', `本地批次日志保存失败：${chrome.runtime.lastError.message}`);
      }
      resolve();
    });
  }));
  return batchHistoryWriteChain;
}

/**
 * 保存当前批次快照。保留执行明细，方便随时在批次日志中装载查看或导出。
 */
async function saveCurrentBatchHistory(databaseStatus = 'pending') {
  if (!batchId) return;
  const existingIndex = batchHistory.findIndex((record) => record.id === batchId);
  const existing = existingIndex >= 0 ? batchHistory[existingIndex] : {};
  const sites = batchTargetQueue.length > 0 ? batchTargetQueue : (batchPromotionSite ? [batchPromotionSite] : []);
  const targetName = sites.length > 1
    ? `${sites.map((s) => s.name || s.url).join(', ')} (共 ${sites.length} 个目标)`
    : (sites[0] && (sites[0].name || sites[0].url)) || existing.targetName || '';
  const targetUrl = sites.map((s) => s.url).filter(Boolean).join(', ') || existing.targetUrl || '';
  const targetSites = sites.map((s, idx) => ({
    id: s.id || `site_${idx}`,
    name: s.name || s.url || `目标站点 ${idx + 1}`,
    url: s.url || '',
    content: s.content || ''
  }));
  const referralUrls = (Array.isArray(parsedUrls) && parsedUrls.length > 0)
    ? parsedUrls.map((p, idx) => ({
      originalIndex: p.originalIndex != null ? p.originalIndex : idx,
      url: p.url,
      sourceDomain: p.sourceDomain || extractDomain(p.url),
      originalRow: Array.isArray(p.originalRow) ? p.originalRow : []
    }))
    : (existing.referralUrls || []);

  const record = {
    ...existing,
    id: batchId,
    totalCount,
    status: status === 'running' ? 'running' : status,
    databaseStatus,
    sourceName: batchSourceName || existing.sourceName || '',
    sourceType: batchSourceType || existing.sourceType || '',
    targetUrl,
    targetName,
    targetSites: targetSites.length > 0 ? targetSites : (existing.targetSites || []),
    referralUrls: referralUrls.length > 0 ? referralUrls : (existing.referralUrls || []),
    startedAt: batchStartedAt || existing.startedAt || Date.now(),
    completedAt: batchCompletedAt || existing.completedAt || null,
    summary: summarizeBatchResults(localResults),
    results: localResults
  };

  if (existingIndex >= 0) batchHistory[existingIndex] = record;
  else batchHistory.push(record);
  await persistBatchHistory();
  renderBatchHistory();
}

/**
 * 平滑滚动至结果统计面板
 */
function scrollToStatsPanel() {
  const targetEl = statsPanel || document.getElementById('statsPanel');
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/**
 * 装载并展示指定批次的执行结果，优先使用本地缓存，若无明细则从本地数据库拉取。
 */
async function loadAndApplyBatchHistory(record) {
  if (!record || !record.id) return false;
  if (status === 'running') {
    alert('当前批次正在运行中，不能载入其他批次。');
    return false;
  }

  // 1. 如果本地记录已有明细结果
  if (Array.isArray(record.results) && record.results.length > 0) {
    applyBatchHistoryRecord(record);
    renderBatchHistory();
    scrollToStatsPanel();
    return true;
  }

  // 2. 如果本地未保存明细（例如旧版清空过本地缓存），尝试从本地数据库拉取
  try {
    setDatabasePersistenceState('saving', `正在从本地数据库拉取批次 ${record.id} 的执行明细...`);
    const items = await requestLocalDatabase(`/api/runs/${record.id}/items`, undefined, {
      method: 'GET',
      timeoutMs: 5000
    });

    if (Array.isArray(items) && items.length > 0) {
      const results = items.map((item) => ({
        originalIndex: Number(item.url_index != null ? item.url_index : 0),
        url: item.referral_url || '',
        sourceDomain: item.referral_domain || '',
        result: item.result || 'fail',
        aiContent: item.ai_content || null,
        errorMessage: item.result_message || null,
        promotionSiteId: item.target_url || record.targetUrl || '',
        promotionSiteName: record.targetName || '',
        promotionSiteUrl: item.target_url || record.targetUrl || '',
        pageMetrics: item.page_metrics && typeof item.page_metrics === 'object' ? item.page_metrics : null,
        timestamp: item.executed_at ? Date.parse(item.executed_at) : (Number(record.startedAt) || Date.now()),
        elapsed: item.elapsed_seconds != null ? Number(item.elapsed_seconds) : null,
        originalRow: Array.isArray(item.original_row) ? item.original_row : []
      }));

      record.results = results;
      record.summary = summarizeBatchResults(results);
      const targetIndex = batchHistory.findIndex((r) => r.id === record.id);
      if (targetIndex >= 0) {
        batchHistory[targetIndex].results = results;
        batchHistory[targetIndex].summary = record.summary;
      }
      await persistBatchHistory();

      applyBatchHistoryRecord(record);
      setDatabasePersistenceState('success', `已从数据库成功装载批次 ${record.id} 的 ${results.length} 条执行明细。`);
      renderBatchHistory();
      scrollToStatsPanel();
      return true;
    } else {
      setDatabasePersistenceState('warning', `数据库中未查询到批次 ${record.id} 的明细记录。`);
      alert(`本地及数据库中未找到批次 ${record.id} 的执行明细。`);
      return false;
    }
  } catch (error) {
    const errorMsg = formatDatabaseError(error);
    setDatabasePersistenceState('failed', `装载批次明细失败：${errorMsg}`);
    alert(`无法从数据库装载批次明细：\n${errorMsg}\n\n若未启动本地数据库服务，可先在终端执行 pnpm server:start 后重试。`);
    return false;
  }
}

/**
 * 将历史批次恢复到当前结果面板，之后可以导出或重新同步数据库。
 */
function applyBatchHistoryRecord(record) {
  if (!record || !Array.isArray(record.results) || record.results.length === 0) return false;
  batchId = String(record.id);
  totalCount = Number(record.totalCount) || record.results.length;
  localResults = record.results;
  batchSourceName = String(record.sourceName || '本地批次恢复');
  batchSourceType = String(record.sourceType || 'recovered');
  batchStartedAt = Number(record.startedAt) || null;
  batchCompletedAt = Number(record.completedAt) || null;
  retryingItemIndexes.clear();

  const firstResult = localResults.find((item) => item && item.promotionSiteUrl) || {};
  const targetUrl = String(record.targetUrl || firstResult.promotionSiteUrl || '').trim();
  const configuredSite = availablePromotionSites.find((site) => site.url === targetUrl);
  batchPromotionSite = configuredSite
    ? normalizeBatchPromotionSite(configuredSite)
    : normalizeBatchPromotionSite({
      id: firstResult.promotionSiteId || targetUrl || 'recovered_target',
      name: record.targetName || firstResult.promotionSiteName || '已恢复目标',
      url: targetUrl,
      content: ''
    });

  // 1. 恢复多目标站点队列信息
  if (Array.isArray(record.targetSites) && record.targetSites.length > 0) {
    batchTargetQueue = record.targetSites.map(normalizeBatchPromotionSite);
  } else {
    // 从历史明细中反向推导多站点
    const inferredSites = [];
    const seenSiteKeys = new Set();
    for (const item of localResults) {
      const u = (item.promotionSiteUrl || '').trim();
      const n = (item.promotionSiteName || '').trim();
      const k = u || n;
      if (k && !seenSiteKeys.has(k)) {
        seenSiteKeys.add(k);
        inferredSites.push(normalizeBatchPromotionSite({
          id: item.promotionSiteId || k,
          name: n || u || `目标站点 ${inferredSites.length + 1}`,
          url: u,
          content: ''
        }));
      }
    }
    if (inferredSites.length > 1) {
      batchTargetQueue = inferredSites;
    } else if (batchPromotionSite && batchPromotionSite.url) {
      batchTargetQueue = [batchPromotionSite];
    }
  }

  const numSites = Math.max(1, batchTargetQueue.length);
  const inferredM = (totalCount > 0 && totalCount % numSites === 0)
    ? (totalCount / numSites)
    : Math.max(1, Math.round(totalCount / numSites));

  // 2. 重建 parsedUrls（引荐 URL 序列，长度 M）
  if (Array.isArray(record.referralUrls) && record.referralUrls.length > 0) {
    parsedUrls = record.referralUrls.map((item, idx) => ({
      originalIndex: item.originalIndex != null ? item.originalIndex : idx,
      url: item.url,
      sourceDomain: item.sourceDomain || extractDomain(item.url),
      originalRow: Array.isArray(item.originalRow) && item.originalRow.length > 0
        ? item.originalRow
        : buildManualOriginalRow(item.url, item.sourceDomain || extractDomain(item.url))
    }));
  } else {
    // 从已有的执行明细中按 urlIndexInSite 提取 M 条原始引荐 URL
    const referralMap = new Map();
    for (const item of localResults) {
      if (!item || !item.url) continue;
      const urlIdx = item.urlIndexInSite != null
        ? Number(item.urlIndexInSite)
        : ((item.originalIndex != null ? Number(item.originalIndex) : 0) % inferredM);
      if (!referralMap.has(urlIdx)) {
        referralMap.set(urlIdx, {
          originalIndex: urlIdx,
          url: item.url,
          sourceDomain: item.sourceDomain || extractDomain(item.url),
          originalRow: Array.isArray(item.originalRow) && item.originalRow.length > 0
            ? item.originalRow
            : buildManualOriginalRow(item.url, item.sourceDomain || extractDomain(item.url))
        });
      }
    }
    parsedUrls = [];
    for (let i = 0; i < inferredM; i++) {
      if (referralMap.has(i)) {
        parsedUrls.push(referralMap.get(i));
      } else {
        const fallback = Array.from(referralMap.values())[i] || {
          originalIndex: i,
          url: '',
          sourceDomain: '',
          originalRow: []
        };
        parsedUrls.push({ ...fallback, originalIndex: i });
      }
    }
  }

  const urls = parsedUrls.map((item) => item.url).filter(Boolean);
  if (manualUrlsInput) {
    manualUrlsInput.value = urls.join('\n');
  }

  if (fileInfo && fileName && fileCount) {
    fileName.textContent = batchSourceName || `批次日志 (${record.id ? String(record.id).slice(0, 8) : '已装载'})`;
    fileCount.textContent = batchTargetQueue.length > 1
      ? `共 ${parsedUrls.length} 条 URL（${batchTargetQueue.length} 个目标站点，总计 ${totalCount} 任务）`
      : `共 ${parsedUrls.length} 条 URL`;
    fileInfo.classList.add('visible');
  }

  // 3. 补全所有缺失的“未开始”任务条目，确保 localResults 数量与 totalCount 完全吻合
  const existingMap = new Map();
  for (const r of localResults) {
    if (r && r.originalIndex != null) {
      existingMap.set(Number(r.originalIndex), r);
    }
  }

  const hydratedResults = [];
  const M = parsedUrls.length || inferredM || 1;
  for (let taskIdx = 0; taskIdx < totalCount; taskIdx++) {
    if (existingMap.has(taskIdx)) {
      hydratedResults.push(existingMap.get(taskIdx));
    } else {
      const siteIndex = Math.min(batchTargetQueue.length - 1, Math.floor(taskIdx / M));
      const urlIndexInSite = taskIdx % M;
      const site = batchTargetQueue[siteIndex] || batchPromotionSite;
      const referralItem = parsedUrls[urlIndexInSite] || { url: '', sourceDomain: '', originalRow: [] };
      hydratedResults.push({
        originalIndex: taskIdx,
        urlIndexInSite,
        siteIndex,
        url: referralItem.url,
        sourceDomain: referralItem.sourceDomain || extractDomain(referralItem.url),
        result: 'unstarted',
        aiContent: null,
        errorMessage: null,
        promotionSiteId: (site && site.id) || '',
        promotionSiteName: (site && site.name) || '',
        promotionSiteUrl: (site && site.url) || '',
        pageMetrics: null,
        timestamp: null,
        elapsed: null,
        originalRow: referralItem.originalRow || []
      });
    }
  }
  localResults = hydratedResults.sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));

  statsSelectedSiteKey = 'all';

  const summary = summarizeBatchResults(localResults);
  successCount = summary.success;
  failCount = summary.fail;
  skippedCount = summary.skipped;
  noCommentBoxCount = summary.noCommentBox;
  manualRequiredCount = summary.manualRequired;
  blockedIllegalCount = summary.blockedIllegal;
  unstartedCount = summary.unstarted;
  pendingCount = Math.max(0, totalCount - summary.processed);
  isTerminated = true;
  setStatus(record.status === 'completed' && unstartedCount === 0 ? 'completed' : 'terminated');
  updateStatsUI();
  updateUI();
  renderStats();
  return true;
}

function getBatchStatusText(value) {
  return {
    running: '运行中断',
    interrupted: '运行中断',
    completed: '已完成',
    terminated: '已终止'
  }[value] || value || '未知';
}

function getDatabaseStatusText(value) {
  return {
    pending: '待同步',
    failed: '同步失败',
    synced: '已同步'
  }[value] || '待同步';
}

/**
 * 渲染批次日志（每页 10 条）。每行可点击装载历史结果，或点击按钮载入/同步。
 */
function renderBatchHistory() {
  if (!batchHistoryBody || !batchHistoryEmpty || !batchHistoryWrap) return;
  batchHistoryBody.innerHTML = '';
  const totalRecords = batchHistory.length;
  batchHistoryEmpty.style.display = totalRecords === 0 ? 'block' : 'none';
  batchHistoryWrap.style.display = totalRecords === 0 ? 'none' : 'block';

  if (totalRecords === 0) {
    if (batchHistoryPagination) batchHistoryPagination.style.display = 'none';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(totalRecords / BATCH_HISTORY_PAGE_SIZE));
  if (batchHistoryCurrentPage > totalPages) batchHistoryCurrentPage = totalPages;
  if (batchHistoryCurrentPage < 1) batchHistoryCurrentPage = 1;

  const startIndex = (batchHistoryCurrentPage - 1) * BATCH_HISTORY_PAGE_SIZE;
  const pageRecords = batchHistory.slice(startIndex, startIndex + BATCH_HISTORY_PAGE_SIZE);

  pageRecords.forEach((record) => {
    const summary = record.summary || {};
    const totalCountVal = Number(record.totalCount || (summary && summary.processed) || 0);
    const processedVal = (summary && summary.processed != null && Number(summary.processed) > 0)
      ? Number(summary.processed)
      : (record.status === 'completed' ? totalCountVal : Number(summary.processed || 0));

    const isCurrentActive = batchId && String(record.id) === String(batchId) && localResults.length > 0;
    const tr = document.createElement('tr');
    if (isCurrentActive) {
      tr.classList.add('active-batch-row');
    }
    tr.title = '点击装载并查看该批次的执行结果';
    tr.innerHTML = `
      <td style="white-space: nowrap;">${escapeHtml(formatDateTime(new Date(Number(record.startedAt) || Date.now())))}</td>
      <td class="batch-history-id" title="${escapeHtml(record.id)}">${escapeHtml(String(record.id || ''))}</td>
      <td class="batch-history-target" title="${escapeHtml(record.targetUrl || '')}">${escapeHtml(record.targetUrl || '—')}</td>
      <td style="text-align: center; white-space: nowrap;">${processedVal} / ${totalCountVal}</td>
      <td style="text-align: center; white-space: nowrap;">${escapeHtml(getBatchStatusText(record.status))}</td>
      <td style="text-align: center; white-space: nowrap;"><span class="batch-sync-badge ${escapeHtml(record.databaseStatus || 'pending')}">${escapeHtml(getDatabaseStatusText(record.databaseStatus))}</span></td>
    `;

    tr.addEventListener('click', (e) => {
      if (e.target && typeof e.target.closest === 'function' && e.target.closest('button')) return;
      loadAndApplyBatchHistory(record);
    });

    const actionCell = document.createElement('td');
    const buttons = document.createElement('div');
    buttons.className = 'batch-history-buttons';

    const loadButton = document.createElement('button');
    loadButton.type = 'button';
    loadButton.className = 'btn btn-secondary';
    loadButton.textContent = isCurrentActive ? '当前显示' : '载入结果';
    if (isCurrentActive) {
      loadButton.disabled = true;
      loadButton.style.opacity = '0.6';
    }
    loadButton.addEventListener('click', (e) => {
      e.stopPropagation();
      loadAndApplyBatchHistory(record);
    });
    buttons.appendChild(loadButton);

    if (record.databaseStatus !== 'synced') {
      const syncButton = document.createElement('button');
      syncButton.type = 'button';
      syncButton.className = 'btn btn-secondary';
      syncButton.textContent = '同步';
      syncButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (status === 'running') return alert('当前批次正在运行，不能同步其他批次。');
        const ok = await loadAndApplyBatchHistory(record);
        if (ok) {
          await syncLocalDatabaseRunResults(record.status === 'completed' ? 'completed' : 'terminated');
        }
      });
      buttons.appendChild(syncButton);
    }

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-secondary btn-delete-batch';
    deleteButton.textContent = '删除';
    deleteButton.title = '删除此批次记录（不需要同步或已废弃）';
    deleteButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteBatchRecord(record);
    });
    buttons.appendChild(deleteButton);

    actionCell.appendChild(buttons);
    tr.appendChild(actionCell);
    batchHistoryBody.appendChild(tr);
  });

  // 更新分页控件状态
  if (batchHistoryPagination) {
    batchHistoryPagination.style.display = totalRecords > 0 ? 'flex' : 'none';
  }
  if (batchHistoryPageInfo) {
    batchHistoryPageInfo.textContent = `第 ${batchHistoryCurrentPage} / ${totalPages} 页（共 ${totalRecords} 条，每页 ${BATCH_HISTORY_PAGE_SIZE} 条）`;
  }
  if (batchHistoryPrevPageBtn) {
    batchHistoryPrevPageBtn.disabled = batchHistoryCurrentPage <= 1;
  }
  if (batchHistoryNextPageBtn) {
    batchHistoryNextPageBtn.disabled = batchHistoryCurrentPage >= totalPages;
  }
}

/**
 * 删除指定的批次记录，并级联清理数据库记录（若服务可用）。
 */
async function deleteBatchRecord(record) {
  if (!record || !record.id) return;
  const shortId = String(record.id).slice(0, 8);

  if (status === 'running' && batchId === String(record.id)) {
    alert('当前批次正在运行中，无法删除。请先终止任务。');
    return;
  }

  const confirmed = confirm(`确定要删除批次 ${shortId} 的记录吗？\n删除后该批次将不再显示，且不需要同步。`);
  if (!confirmed) return;

  // 1. 从本地 batchHistory 中移除
  batchHistory = batchHistory.filter((r) => String(r.id) !== String(record.id));
  await persistBatchHistory();

  // 2. 如果当前结果面板展示的是被删除的批次，清空当前面板
  if (batchId === String(record.id)) {
    clearBatch();
  }

  // 3. 尝试通知本地数据库级联删除
  try {
    await requestLocalDatabase(`/api/runs/${record.id}`, undefined, {
      method: 'DELETE',
      timeoutMs: 2000
    });
    console.log('[batch] 本地数据库已同步删除批次:', record.id);
  } catch (err) {
    console.log('[batch] 数据库可能未启动或批次未入库，仅删除本地记录:', err.message || err);
  }

  renderBatchHistory();
}

async function loadTimeoutSetting() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([TIMEOUT_STORAGE_KEY], (data) => {
      const saved = parseInt(data[TIMEOUT_STORAGE_KEY], 10);
      timeoutSeconds = (saved && saved >= 10 && saved <= 600) ? saved : 60;
      if (timeoutInput) timeoutInput.value = String(timeoutSeconds);
      resolve();
    });
  });
}

function saveTimeoutSetting() {
  if (!timeoutInput) return;
  const val = parseInt(timeoutInput.value, 10);
  if (val >= 10 && val <= 600) {
    timeoutSeconds = val;
    chrome.storage.sync.set({ [TIMEOUT_STORAGE_KEY]: val });
  } else {
    timeoutInput.value = String(timeoutSeconds);
  }
}

async function loadTimeoutRetrySetting() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([TIMEOUT_RETRY_STORAGE_KEY], (data) => {
      const saved = parseInt(data[TIMEOUT_RETRY_STORAGE_KEY], 10);
      timeoutRetryCount = (saved !== undefined && !isNaN(saved) && saved >= 0 && saved <= 5) ? saved : 1;
      if (timeoutRetryCountInput) timeoutRetryCountInput.value = String(timeoutRetryCount);
      resolve();
    });
  });
}

function saveTimeoutRetrySetting() {
  if (!timeoutRetryCountInput) return;
  const val = parseInt(timeoutRetryCountInput.value, 10);
  if (!isNaN(val) && val >= 0 && val <= 5) {
    timeoutRetryCount = val;
    chrome.storage.sync.set({ [TIMEOUT_RETRY_STORAGE_KEY]: val });
  } else {
    timeoutRetryCountInput.value = String(timeoutRetryCount);
  }
}

function getConcurrencySetting() {
  if (concurrencyInput) {
    const val = parseInt(concurrencyInput.value, 10);
    if (val >= 1 && val <= 10) return val;
  }
  return maxConcurrentTabs || 3;
}

async function loadConcurrencySetting() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([CONCURRENCY_STORAGE_KEY], (data) => {
      const saved = parseInt(data[CONCURRENCY_STORAGE_KEY], 10);
      maxConcurrentTabs = (saved && saved >= 1 && saved <= 10) ? saved : 3;
      if (concurrencyInput) concurrencyInput.value = String(maxConcurrentTabs);
      resolve();
    });
  });
}

function saveConcurrencySetting() {
  if (!concurrencyInput) return;
  const val = parseInt(concurrencyInput.value, 10);
  if (val >= 1 && val <= 10) {
    maxConcurrentTabs = val;
    chrome.storage.sync.set({ [CONCURRENCY_STORAGE_KEY]: val });
  } else {
    concurrencyInput.value = String(maxConcurrentTabs);
  }
}

// ==================== 事件绑定 ====================
function initBatchDropdown() {
  const container = document.getElementById('batchDropdownContainer');
  const trigger = document.getElementById('batchDropdownTrigger');
  const menu = document.getElementById('batchDropdownMenu');
  if (!trigger || !menu) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (status === 'running' || status === 'queue_transition') return;
    const isOpen = menu.classList.contains('open');
    if (isOpen) {
      menu.classList.remove('open');
      trigger.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    } else {
      menu.classList.add('open');
      trigger.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }
  });

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.addEventListener('click', (e) => {
    if (container && !container.contains(e.target)) {
      menu.classList.remove('open');
      trigger.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
}

function bindEvents() {
  initBatchDropdown();

  // 上传区域
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', handleFileDrop);
  fileInput.addEventListener('change', handleFileSelect);

  // 文件信息
  fileRemove.addEventListener('click', resetFile);

  // 手动 URL 输入：一行一个 URL，也兼容空格、逗号、制表符分隔。
  if (manualUrlsInput) {
    manualUrlsInput.addEventListener('input', scheduleManualUrlParse);
  }
  if (parseManualUrlsBtn) {
    parseManualUrlsBtn.addEventListener('click', parseManualUrlsFromInput);
  }
  if (clearManualUrlsBtn) {
    clearManualUrlsBtn.addEventListener('click', () => {
      manualUrlsInput.value = '';
      resetFile();
    });
  }

  if (batchPromotionSiteSelect) {
    batchPromotionSiteSelect.addEventListener('change', () => {
      batchPromotionSiteUserSelected = true;
      batchSavedPromotionSiteId = batchPromotionSiteSelect.value;
      batchPromotionSite = getSelectedBatchPromotionSite();
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          [BATCH_SELECTED_PROMOTION_SITE_STORAGE_KEY]: batchPromotionSiteSelect.value,
          'auto_comment_selected_promotion_site_id': batchPromotionSiteSelect.value
        }, () => {});
      }
      updateBatchPromotionSiteSummary();
      console.log('[batch] 已选择本批次目标 URL:', batchPromotionSite && batchPromotionSite.name);
    });
  }

  const selectAllSitesBtn = document.getElementById('selectAllSitesBtn');
  if (selectAllSitesBtn) {
    selectAllSitesBtn.addEventListener('click', () => {
      if (status === 'running' || status === 'queue_transition') return;
      batchSelectedPromotionSiteIds = availablePromotionSites.map((s) => s.id);
      saveBatchSelectedPromotionSiteIds();
      renderBatchPromotionSitesList();
    });
  }
  const clearAllSitesBtn = document.getElementById('clearAllSitesBtn');
  if (clearAllSitesBtn) {
    clearAllSitesBtn.addEventListener('click', () => {
      if (status === 'running' || status === 'queue_transition') return;
      batchSelectedPromotionSiteIds = [];
      saveBatchSelectedPromotionSiteIds();
      renderBatchPromotionSitesList();
    });
  }

  // 操作按钮
  startBtn.addEventListener('click', () => {
    const canResume = status === 'terminated' && isTerminated && localResults.length > 0 && localResults.length < totalCount && parsedUrls.length === totalCount;
    if (canResume) {
      resumeBatch().catch((err) => console.error('[batch] resumeBatch 异常:', err));
    } else {
      startBatch().catch((err) => console.error('[batch] startBatch 异常:', err));
    }
  });
  stopBtn.addEventListener('click', stopBatch);
  exportBtn.addEventListener('click', exportResults);
  clearBtn.addEventListener('click', clearBatch);
  if (retryDatabaseBtn) retryDatabaseBtn.addEventListener('click', retryDatabasePersistence);
  if (retryAllFailedBtn) retryAllFailedBtn.addEventListener('click', retryAllFailed);
  if (syncDbHistoryBtn) {
    syncDbHistoryBtn.addEventListener('click', () => syncBatchHistoryFromDatabase({ notify: true }));
  }
  if (importResultCsvBtn && resultCsvInput) {
    importResultCsvBtn.addEventListener('click', () => resultCsvInput.click());
    resultCsvInput.addEventListener('change', handleResultCsvImport);
  }
  if (batchHistoryPrevPageBtn) {
    batchHistoryPrevPageBtn.addEventListener('click', () => {
      if (batchHistoryCurrentPage > 1) {
        batchHistoryCurrentPage--;
        renderBatchHistory();
      }
    });
  }
  if (batchHistoryNextPageBtn) {
    batchHistoryNextPageBtn.addEventListener('click', () => {
      const totalPages = Math.max(1, Math.ceil(batchHistory.length / BATCH_HISTORY_PAGE_SIZE));
      if (batchHistoryCurrentPage < totalPages) {
        batchHistoryCurrentPage++;
        renderBatchHistory();
      }
    });
  }

  // 设置
  if (timeoutInput) timeoutInput.addEventListener('change', saveTimeoutSetting);
  if (timeoutRetryCountInput) timeoutRetryCountInput.addEventListener('change', saveTimeoutRetrySetting);
  if (concurrencyInput) concurrencyInput.addEventListener('change', saveConcurrencySetting);

  // 勾选框设置（全局记忆）
  if (batchAutoOpenPanel) batchAutoOpenPanel.addEventListener('change', saveBatchCheckboxSettings);
  if (batchAutoGenerate) batchAutoGenerate.addEventListener('change', saveBatchCheckboxSettings);
  if (batchAutoSubmit) batchAutoSubmit.addEventListener('change', saveBatchCheckboxSettings);
  if (batchIgnoreHistory) batchIgnoreHistory.addEventListener('change', saveBatchCheckboxSettings);
  if (batchDebugMode) {
    batchDebugMode.addEventListener('change', () => {
      updateDebugModeUI();
      saveBatchCheckboxSettings();
    });
  }
  if (batchDebugCommentSelect) {
    batchDebugCommentSelect.addEventListener('change', () => {
      updateDebugModeUI();
      saveBatchCheckboxSettings();
    });
  }
  if (batchDebugCustomComment) {
    batchDebugCustomComment.addEventListener('input', debounce(saveBatchCheckboxSettings, 500));
  }

  // 监听 background 消息（结果回调）
  chrome.runtime.onMessage.addListener((message) => {
    // background 通知：结果已落盘，标签页可以安全关闭了
    if (message.type === 'BATCH_CONFIRMED') {
      console.log('[batch] 收到 BATCH_CONFIRMED >>>', { urlIndex: message.urlIndex, result: message.result, aiContentLen: message.aiContent ? message.aiContent.length : 0, tabsPendingConfirm: [...tabsPendingConfirm.entries()], tabsWaitingClose: [...tabsWaitingClose], time: new Date().toISOString() });
      handleTabConfirmed(message.urlIndex, message.result, message.aiContent, message.errorMessage, {
        promotionSiteId: message.promotionSiteId,
        promotionSiteName: message.promotionSiteName,
        promotionSiteUrl: message.promotionSiteUrl,
        pageMetrics: message.pageMetrics
      });
    }
  });

  // 统计筛选器
  if (filterTargetSite) {
    filterTargetSite.addEventListener('change', () => {
      statsSelectedSiteKey = filterTargetSite.value;
      renderStats();
    });
  }
  if (toggleSiteOverviewBtn) {
    toggleSiteOverviewBtn.addEventListener('click', () => {
      isSiteOverviewOpen = !isSiteOverviewOpen;
      if (statsSiteOverviewWrap) {
        statsSiteOverviewWrap.style.display = isSiteOverviewOpen ? 'block' : 'none';
      }
      toggleSiteOverviewBtn.textContent = isSiteOverviewOpen ? '▲ 收起汇总对比' : '📊 目标站点汇总对比';
    });
  }
  filterResult.addEventListener('change', renderStats);
  filterDomain.addEventListener('change', renderStats);
  filterTimeRange.addEventListener('change', renderStats);
  if (filterPageDepth) filterPageDepth.addEventListener('change', renderStats);
  filterKeyword.addEventListener('input', debounce(renderStats, 300));
}

// 目标 URL 管理更新目标列表后，同步刷新尚未启动批次的目标选择器。
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[BATCH_SELECTED_PROMOTION_SITE_STORAGE_KEY]) {
    const newId = String(changes[BATCH_SELECTED_PROMOTION_SITE_STORAGE_KEY].newValue || '').trim();
    if (newId && newId !== batchSavedPromotionSiteId) {
      batchSavedPromotionSiteId = newId;
      if (status !== 'running' && status !== 'terminated' && availablePromotionSites.length > 0) {
        renderBatchPromotionSiteSelect(newId);
      }
    }
  }
  if (changes[BATCH_SITES_CONFIG_STORAGE_KEY]) {
    if (status === 'running' || status === 'terminated') return;
    const preferredSiteId = (batchPromotionSiteSelect && batchPromotionSiteSelect.value)
      || batchSavedPromotionSiteId;
    loadBatchPromotionSites(preferredSiteId);
  }
});

// 设置页的目标 URL 管理数据加载或编辑后会广播当前配置，批量页据此立即刷新下拉框。
window.addEventListener('autoCommentSitesConfigChanged', (event) => {
  if (status === 'running' || status === 'terminated') return;
  const currentVal = batchPromotionSiteSelect && batchPromotionSiteSelect.value;
  const preferredSiteId = currentVal || batchSavedPromotionSiteId || '';
  applyBatchSitesConfig(event.detail, preferredSiteId);
});

// ==================== CSV 解析 ====================
function handleFileDrop(e) {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

function processFile(file) {
  if (!file.name.endsWith('.csv')) {
    alert('请上传 CSV 文件');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    parseCSV(e.target.result, file.name);
  };
  reader.onerror = () => {
    alert('文件读取失败');
  };
  reader.readAsArrayBuffer(file);
}

function evaluateIllegalSiteForBatchItem(url, sourceDomain) {
  const filter = window.AutoCommentIllegalSiteFilter;
  if (!filter || typeof filter.evaluateUrl !== 'function') {
    console.warn('[batch] 非法网站过滤器未加载，跳过 URL 预检测');
    return { blocked: false };
  }
  return filter.evaluateUrl(url, { sourceDomain });
}

function getIllegalSiteBlockMessage(check) {
  if (!check || !check.blocked) return '';
  return check.reason || '非法网站拦截：命中赌博/色情规则';
}

function normalizeEncoding(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.length;

  // UTF-16 LE BOM: FF FE
  if (len >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.slice(2));
  }
  // UTF-16 BE BOM: FE FF
  if (len >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.slice(2));
  }
  // UTF-8 BOM: EF BB BF（已在 TextDecoder 自动跳过，但保险起见再剥一层）
  if (len >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.slice(3));
  }
  // 尝试检测 UTF-16 LE（无 BOM，但数据特征为每个 ASCII 后跟 00）
  if (len >= 4 && bytes[1] === 0x00 && bytes[3] === 0x00) {
    return new TextDecoder('utf-16le').decode(bytes);
  }

  // 检测 GBK/GB2312 编码：中文 GBK 双字节范围 0x81-0xFE
  let hasGBKSignature = false;
  for (let i = 0; i < len - 1; i++) {
    const b = bytes[i];
    if (b >= 0x81 && b <= 0xfe) {
      hasGBKSignature = true;
      break;
    }
  }

  // 优先尝试 UTF-8 解码（现代标准）
  const utf8Text = new TextDecoder('utf-8').decode(bytes);

  // 如果 UTF-8 解码后仍包含乱码特征（连续问号或方框），尝试 GBK
  if (hasGBKSignature && (utf8Text.includes('�') || utf8Text.includes('???') || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(utf8Text.slice(0, 100)))) {
    try {
      // 使用 GBK/GB2312/GB18030 解码
      const gbkText = new TextDecoder('gbk').decode(bytes);
      // 验证 GBK 解码结果是否包含有效中文（GBK 中常用汉字在 0xB0-0xF7 范围）
      const validChineseCount = (gbkText.match(/[\u4e00-\u9fa5]/g) || []).length;
      if (validChineseCount > 0) {
        return gbkText;
      }
    } catch (e) {
      // GBK 解码失败，回退到 UTF-8
    }
  }

  return utf8Text;
}

/**
 * 读取用户之前导出的结果 CSV，并恢复成可展示、可幂等同步的完整批次。
 */
function handleResultCsvImport(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (status === 'running') {
    resultCsvInput.value = '';
    alert('当前批次正在运行，暂时不能导入结果 CSV。');
    return;
  }
  const reader = new FileReader();
  reader.onload = async (loadEvent) => {
    try {
      await importResultCsv(normalizeEncoding(loadEvent.target.result), file.name);
    } catch (error) {
      console.error('[batch] 导入结果 CSV 失败:', error);
      alert(`导入结果 CSV 失败：${error.message || String(error)}`);
    } finally {
      resultCsvInput.value = '';
    }
  };
  reader.onerror = () => {
    resultCsvInput.value = '';
    alert('结果 CSV 文件读取失败');
  };
  reader.readAsArrayBuffer(file);
}

function resultTextToCode(value, runResult) {
  const text = String(value || '').trim();
  const resultMap = {
    '成功': 'success',
    '已存在': 'skipped',
    '需手动处理': 'manual_required',
    '无评论框': 'no_comment_box',
    '非法拦截': 'blocked_illegal',
    '失败': 'fail'
  };
  return resultMap[text] || (String(runResult || '').trim() === '1' ? 'success' : 'fail');
}

function parseImportedTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) return Date.now();
  const timestamp = new Date(text.replace(' ', 'T')).getTime();
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

/**
 * 解析本插件导出的结果 CSV。使用 PapaParse 兼容 AI 内容中的逗号、引号和换行。
 */
async function importResultCsv(text, sourceFileName) {
  if (!window.Papa || typeof window.Papa.parse !== 'function') {
    throw new Error('CSV 解析组件未加载');
  }
  const parsed = window.Papa.parse(String(text || '').replace(/^\uFEFF/, ''), { skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length > 0) {
    throw new Error(parsed.errors[0].message || 'CSV 格式错误');
  }
  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  if (rows.length < 2) throw new Error('CSV 文件没有结果数据');

  const headers = rows[0].map((value) => String(value || '').trim());
  const findColumn = (...names) => headers.findIndex((header) => names.includes(header));
  const urlColumn = findColumn('引荐URL', '引荐 URL', '原URL', 'URL');
  const sourceDomainColumn = findColumn('引荐域名', 'URL对应域名', '来源域名');
  const targetUrlColumn = findColumn('目标URL', '目标 URL', '网站URL');
  const resultColumn = findColumn('结果');
  const resultMessageColumn = findColumn('结果信息', '错误信息');
  const aiContentColumn = findColumn('AI生成内容', 'AI 生成内容');
  const elapsedColumn = findColumn('耗时(秒)', '耗时');
  const timestampColumn = findColumn('执行时间');
  const runResultColumn = findColumn('运行结果');
  const documentHeightColumn = findColumn('页面总高度(px)');
  const viewportHeightColumn = findColumn('视口高度(px)');
  const pageDepthColumn = findColumn('页面总深度(屏)');

  if (urlColumn < 0 || targetUrlColumn < 0 || resultColumn < 0) {
    throw new Error('请选择插件导出的结果 CSV，文件必须包含“引荐URL、目标URL、结果”列');
  }

  const results = [];
  const targetUrls = new Set();
  rows.slice(1).forEach((row) => {
    const referralUrl = String(row[urlColumn] || '').trim();
    const targetUrl = String(row[targetUrlColumn] || '').trim();
    if (!referralUrl || !targetUrl) return;
    targetUrls.add(targetUrl);
    const timestamp = parseImportedTimestamp(timestampColumn >= 0 ? row[timestampColumn] : '');
    results.push({
      originalIndex: results.length,
      url: referralUrl,
      sourceDomain: sourceDomainColumn >= 0 ? normalizeDomainForStats(row[sourceDomainColumn]) : extractDomain(referralUrl),
      result: resultTextToCode(row[resultColumn], runResultColumn >= 0 ? row[runResultColumn] : ''),
      aiContent: aiContentColumn >= 0 ? String(row[aiContentColumn] || '') || null : null,
      errorMessage: resultMessageColumn >= 0 ? String(row[resultMessageColumn] || '') || null : null,
      promotionSiteId: targetUrl,
      promotionSiteName: targetUrl,
      promotionSiteUrl: targetUrl,
      pageMetrics: {
        documentHeightPx: numberOrEmpty(documentHeightColumn >= 0 ? row[documentHeightColumn] : null),
        viewportHeightPx: numberOrEmpty(viewportHeightColumn >= 0 ? row[viewportHeightColumn] : null),
        pageDepthScreens: numberOrEmpty(pageDepthColumn >= 0 ? row[pageDepthColumn] : null)
      },
      timestamp,
      elapsed: numberOrEmpty(elapsedColumn >= 0 ? row[elapsedColumn] : null),
      originalRow: row.slice(0, targetUrlColumn)
    });
  });

  if (results.length === 0) throw new Error('CSV 中没有可导入的结果行');
  if (targetUrls.size !== 1) throw new Error('一个批次只能包含一个目标 URL，当前 CSV 中检测到多个目标 URL');

  const fileBatchId = String(sourceFileName || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  const importedBatchId = fileBatchId ? fileBatchId[0].toLowerCase() : generateUUID();
  const existingIndex = batchHistory.findIndex((record) => record.id === importedBatchId);
  if (existingIndex >= 0 && !confirm(`批次 ${importedBatchId} 已存在，是否用导入的 CSV 结果覆盖本地批次记录？`)) return;

  const timestamps = results.map((item) => item.timestamp).filter(Number.isFinite);
  const targetUrl = [...targetUrls][0];
  const record = {
    id: importedBatchId,
    totalCount: results.length,
    status: 'completed',
    databaseStatus: 'pending',
    sourceName: sourceFileName || '导入结果 CSV',
    sourceType: 'result_csv_import',
    targetUrl,
    targetName: targetUrl,
    startedAt: timestamps.length > 0 ? Math.min(...timestamps) : Date.now(),
    completedAt: timestamps.length > 0 ? Math.max(...timestamps) : Date.now(),
    summary: summarizeBatchResults(results),
    results
  };
  if (existingIndex >= 0) batchHistory[existingIndex] = record;
  else batchHistory.push(record);
  await persistBatchHistory();
  renderBatchHistory();
  applyBatchHistoryRecord(record);
  setDatabasePersistenceState('failed', `已从 CSV 恢复批次 ${importedBatchId}，共 ${results.length} 条结果，可点击“重新写入数据库”。`);
  alert(`结果 CSV 导入成功：已恢复 ${results.length} 条结果。`);
}

function numberOrEmpty(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseCSV(raw, fileNameParam) {
  const text = normalizeEncoding(raw);
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    alert('CSV 文件内容为空或格式错误');
    return;
  }

  // 去除 UTF-8 BOM（常见于从 Windows Excel 保存的文件）
  const headerRaw = lines[0];
  const header = parseCSVLine(headerRaw);
  const colUrl = header.findIndex((h) => h === '引荐URL' || h === '引荐 URL' || h === 'URL' || h === 'url' || h === 'Url');
  const colDomain = header.findIndex((h) => h === '引荐域名' || h === 'sourceDomain');

  if (colUrl === -1) {
    alert('CSV 文件缺少"引荐URL"列，请确认文件格式正确。\n\n标准格式应为：\n页面AS, 引荐URL, 引荐域名, 目标域名, 类型, 引荐页外链数量, 自动评论运行结果');
    resetFile();
    return;
  }

  const items = [];
  let invalidCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    let url = (row[colUrl] || '').trim();
    let sourceDomain = colDomain >= 0 ? normalizeDomainForStats(row[colDomain]) : '';

    if (!url) {
      invalidCount++;
      continue;
    }

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    if (!isValidUrl(url)) {
      invalidCount++;
      continue;
    }

    sourceDomain = sourceDomain || extractDomain(url);

    items.push({
      url,
      sourceDomain,
      originalRow: normalizeReferralOriginalRow(row)  // 保存规范化后的源行数据，用于导出时保持格式
    });
  }

  applyParsedUrlItems(items, {
    sourceName: fileNameParam || '已上传文件',
    invalidCount,
    sourceType: 'csv'
  });
}

/**
 * 统一规范化引荐 URL 用于去重比对：
 * 忽略协议大小写、域名大小写、末尾多余斜杠，并移除 hash 锚点（如 #comments）。
 */
function normalizeReferralUrlForDedupe(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  try {
    const u = new URL(trimmed);
    const cleanPath = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.host.toLowerCase()}${cleanPath}${u.search}`;
  } catch (_) {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

// 将不同输入来源解析出的 URL 统一写入批量队列，并渲染预览表格（自动剔除重复 URL）。
function applyParsedUrlItems(items, options = {}) {
  const sourceName = options.sourceName || '已输入 URL';
  const sourceType = options.sourceType || 'manual';
  const invalidCount = Number(options.invalidCount || 0);
  let illegalCount = 0;
  let duplicateCount = 0;

  batchSourceName = sourceName;
  batchSourceType = sourceType;
  parsedUrls = [];
  urlPreviewBody.innerHTML = '';

  const seenUrls = new Set();

  items.forEach((item) => {
    const dedupeKey = normalizeReferralUrlForDedupe(item.url);
    if (!dedupeKey || seenUrls.has(dedupeKey)) {
      duplicateCount++;
      return;
    }
    seenUrls.add(dedupeKey);

    const illegalCheck = evaluateIllegalSiteForBatchItem(item.url, item.sourceDomain);
    if (illegalCheck.blocked) illegalCount++;

    parsedUrls.push({
      originalIndex: parsedUrls.length,
      url: item.url,
      sourceDomain: item.sourceDomain || '',
      illegalCheck: illegalCheck.blocked ? illegalCheck : null,
      originalRow: item.originalRow || buildManualOriginalRow(item.url, item.sourceDomain)
    });

    const tr = document.createElement('tr');
    tr.dataset.url = item.url;
    if (illegalCheck.blocked) {
      tr.classList.add('illegal');
      tr.title = getIllegalSiteBlockMessage(illegalCheck);
    }
    tr.innerHTML = `<td>${parsedUrls.length}</td><td>${escapeHtml(item.sourceDomain || item.url)}</td><td>${escapeHtml(item.url)}</td>`;
    urlPreviewBody.appendChild(tr);
  });

  const validCount = parsedUrls.length;
  urlPreview.classList.toggle('visible', validCount > 0);
  fileName.textContent = sourceName;
  fileInfo.classList.toggle('visible', validCount > 0 || invalidCount > 0 || duplicateCount > 0);
  uploadZone.classList.toggle('has-file', validCount > 0 && sourceType === 'csv');
  fileCount.textContent = `共 ${validCount} 条有效 URL`;
  if (duplicateCount > 0) fileCount.textContent += `（已自动剔除 ${duplicateCount} 条重复）`;
  if (invalidCount > 0) fileCount.textContent += `（跳过 ${invalidCount} 条无效）`;
  if (illegalCount > 0) fileCount.textContent += `（非法拦截 ${illegalCount} 条）`;
  const dupBadge = document.getElementById('duplicateCount');
  if (dupBadge) {
    dupBadge.textContent = duplicateCount > 0 ? `✅ 已自动剔除 ${duplicateCount} 条重复` : '';
  }
  updateCostHint(Math.max(0, validCount - illegalCount));

  if (status !== 'running') {
    status = 'idle';
    isTerminated = false;
    batchId = null;
    localResults = [];
    databaseFailedItemIndexes.clear();
    retryingItemIndexes.clear();
    timeoutRetryMap.clear();
    pendingRetryQueue = [];
    successCount = 0;
    failCount = 0;
    skippedCount = 0;
    noCommentBoxCount = 0;
    manualRequiredCount = 0;
    blockedIllegalCount = 0;
    pendingCount = validCount;
    currentIndex = 0;
    setStatus('idle');
    updateStatsUI();
  }
  updateUI();
}

function buildManualOriginalRow(url, sourceDomain) {
  return [
    '',
    url,
    normalizeDomainForStats(sourceDomain || extractDomain(url)),
    '',
    'manual',
    '',
    ''
  ];
}

function normalizeReferralOriginalRow(row) {
  const normalized = Array.isArray(row) ? [...row] : [];
  // 标准 CSV 的第 3、4 列分别是引荐域名和目标域名，入队时统一去掉 www. 前缀。
  if (normalized.length > 2) normalized[2] = normalizeDomainForStats(normalized[2]);
  if (normalized.length > 3) normalized[3] = normalizeDomainForStats(normalized[3]);
  return normalized;
}

function scheduleManualUrlParse() {
  if (manualUrlParseTimer) clearTimeout(manualUrlParseTimer);
  manualUrlParseTimer = setTimeout(parseManualUrlsFromInput, 450);
}

function parseManualUrlsFromInput() {
  if (!manualUrlsInput) return;
  const rawText = manualUrlsInput.value.trim();
  if (!rawText) {
    resetFile();
    return;
  }

  const tokens = rawText
    .split(/[\n\r,，\t ]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const items = [];
  let invalidCount = 0;

  tokens.forEach((token) => {
    let url = token;
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    if (!isValidUrl(url)) {
      invalidCount++;
      return;
    }
    const sourceDomain = extractDomain(url);
    items.push({
      url,
      sourceDomain,
      originalRow: buildManualOriginalRow(url, sourceDomain)
    });
  });

  applyParsedUrlItems(items, {
    sourceName: '手动粘贴 URL',
    invalidCount,
    sourceType: 'manual'
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function resetFile() {
  fileInput.value = '';
  if (manualUrlParseTimer) {
    clearTimeout(manualUrlParseTimer);
    manualUrlParseTimer = null;
  }
  fileInfo.classList.remove('visible');
  uploadZone.classList.remove('has-file');
  urlPreview.classList.remove('visible');
  urlPreviewBody.innerHTML = '';
  parsedUrls = [];
  startBtn.disabled = true;
  fileCount.textContent = '';
  document.getElementById('duplicateCount').textContent = '';
  updateCostHint(0);
}

function updateCostHint(count) {
  if (count === 0) {
    costHint.textContent = '';
  } else {
    costHint.textContent = `本次预计会调用 AI ${count} 次，实际费用由当前 Provider 账户结算。`;
  }
}

/**
 * 调用本机 PostgreSQL 采集服务。单条请求使用短超时，最终批量同步使用更长超时。
 */
async function requestLocalDatabase(path, payload, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs) || LOCAL_DATABASE_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${LOCAL_DATABASE_API_BASE}${path}`, {
      method: options.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data.data || null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 批次启动前检查本地服务和 PostgreSQL。检查失败只让用户选择是否继续，不替自动化做强制拦截。
 */
async function confirmDatabaseAvailabilityBeforeStart() {
  try {
    await requestLocalDatabase('/health', undefined, { method: 'GET', timeoutMs: 2500 });
    return true;
  } catch (error) {
    const message = formatDatabaseError(error);
    setDatabasePersistenceState('warning', `启动前数据库检查未通过：${message}`);
    const continueAutomation = confirm(
      `本地数据库当前不可用：\n${message}\n\n点击“确定”继续自动化，结果会保存在扩展本地，稍后可重新同步。\n点击“取消”先启动本地服务。`
    );
    if (!continueAutomation) {
      alert('请在项目目录执行 pnpm server:start，服务启动后再点击“开始批量处理”。');
    }
    return continueAutomation;
  }
}

/**
 * 更新数据库落库提示。失败态必须保留重试按钮，直到本批次完整写入成功或被清空。
 */
function setDatabasePersistenceState(state, message) {
  if (!databasePersistence || !databasePersistenceMessage) return;
  databasePersistence.className = `database-persistence visible ${state}`;
  databasePersistenceMessage.textContent = message;
  if (retryDatabaseBtn) {
    retryDatabaseBtn.style.display = state === 'failed' ? 'inline-flex' : 'none';
    retryDatabaseBtn.disabled = state === 'saving';
  }
}

/**
 * 把底层网络错误转换成可操作的中文提示，优先告诉用户如何恢复本地数据库服务。
 */
function formatDatabaseError(error) {
  if (error && error.name === 'AbortError') return '数据库请求超时，请检查本地服务和 PostgreSQL 是否正常。';
  const message = String(error && error.message || error || '未知错误');
  if (/failed to fetch|fetch failed|networkerror/i.test(message)) {
    return '无法连接本地数据库服务，请先在项目目录执行 pnpm server:start。';
  }
  return message;
}

/**
 * 构造批次主记录，自动写入和手动重试共用同一份数据，避免两条链路字段不一致。
 */
function buildLocalDatabaseRunPayload(nextStatus) {
  const sites = batchTargetQueue.length > 0 ? batchTargetQueue : (batchPromotionSite ? [batchPromotionSite] : []);
  const targetUrl = sites.map((s) => s.url).filter(Boolean).join(', ');
  const targetDomain = sites.map((s) => extractDomain(s.url)).filter(Boolean).join(', ');
  const targetName = sites.length > 1
    ? `${sites.map((s) => s.name || s.url).join(', ')} (共 ${sites.length} 个目标)`
    : (sites[0] && (sites[0].name || sites[0].url)) || '';

  return {
    id: batchId,
    targetUrl: targetUrl || (batchPromotionSite && batchPromotionSite.url) || '',
    targetDomain: targetDomain || extractDomain(batchPromotionSite && batchPromotionSite.url),
    targetName: targetName || (batchPromotionSite && batchPromotionSite.name) || '',
    totalCount,
    status: nextStatus,
    sourceType: batchSourceType || '',
    sourceName: batchSourceName || '',
    startedAt: batchStartedAt ? new Date(batchStartedAt).toISOString() : null,
    completedAt: batchCompletedAt ? new Date(batchCompletedAt).toISOString() : null,
    rawConfig: {
      autoOpenPanel: batchAutoOpenPanel ? batchAutoOpenPanel.checked : true,
      autoGenerate: batchAutoGenerate ? batchAutoGenerate.checked : true,
      autoSubmit: batchAutoSubmit ? batchAutoSubmit.checked : true,
      targetSites: sites.map((s, idx) => ({
        id: s.id || `site_${idx}`,
        name: s.name || s.url || `目标站点 ${idx + 1}`,
        url: s.url || '',
        content: s.content || ''
      })),
      referralUrls: parsedUrls.map((p, idx) => ({
        originalIndex: p.originalIndex != null ? p.originalIndex : idx,
        url: p.url,
        sourceDomain: p.sourceDomain || extractDomain(p.url),
        originalRow: Array.isArray(p.originalRow) ? p.originalRow : []
      }))
    }
  };
}

/**
 * 构造数据库明细。urlIndex 是源数据中的稳定行号，也是服务端幂等唯一键的一部分。
 */
function buildLocalDatabaseRunItemPayload(resultEntry) {
  const targetUrl = resultEntry.promotionSiteUrl || (batchPromotionSite && batchPromotionSite.url) || '';
  return {
    runId: batchId,
    urlIndex: resultEntry.originalIndex,
    referralUrl: resultEntry.url,
    referralDomain: resultEntry.sourceDomain || extractDomain(resultEntry.url),
    targetUrl,
    targetDomain: extractDomain(targetUrl),
    result: resultEntry.result,
    resultMessage: resultEntry.errorMessage || '',
    aiContent: resultEntry.aiContent || null,
    elapsedSeconds: resultEntry.elapsed,
    executedAt: resultEntry.timestamp ? new Date(resultEntry.timestamp).toISOString() : new Date().toISOString(),
    pageMetrics: resultEntry.pageMetrics || {},
    originalRow: resultEntry.originalRow || []
  };
}

/**
 * 将批次信息写入本地数据库。目标 URL 由批量启动时锁定，避免运行中切换配置造成混乱。
 */
async function persistLocalDatabaseRunStart() {
  if (!batchId || !batchPromotionSite || !batchPromotionSite.url) return;
  try {
    setDatabasePersistenceState('saving', '数据库批次已开始创建，执行结果将持续写入。');
    await requestLocalDatabase('/api/runs', buildLocalDatabaseRunPayload('running'));
    console.log('[batch] 本地数据库批次已创建:', batchId);
  } catch (error) {
    const message = formatDatabaseError(error);
    setDatabasePersistenceState('warning', `${message} 本批次会继续执行，结束后将再次整体写入。`);
    saveCurrentBatchHistory('failed');
    console.warn('[batch] 本地数据库批次创建失败，批量任务继续执行:', message);
  }
}

/**
 * 将单条引荐 URL 的执行结果写入本地数据库。使用批次 ID 和行号做幂等更新。
 */
async function persistLocalDatabaseRunItem(resultEntry) {
  if (!batchId || !resultEntry || !resultEntry.url) return;
  const targetUrl = resultEntry.promotionSiteUrl || (batchPromotionSite && batchPromotionSite.url) || '';
  if (!targetUrl) return;
  try {
    await requestLocalDatabase('/api/run-items', buildLocalDatabaseRunItemPayload(resultEntry));
    databaseFailedItemIndexes.delete(resultEntry.originalIndex);
    console.log('[batch] 本地数据库明细已写入:', { batchId, urlIndex: resultEntry.originalIndex, result: resultEntry.result });

    // 重试完成或批次已结束状态下，单条写入成功后自动同步完整批次状态并标记为已同步
    if (status !== 'running' && databaseFailedItemIndexes.size === 0) {
      await syncLocalDatabaseRunResults(status === 'completed' ? 'completed' : 'terminated');
    }
  } catch (error) {
    databaseFailedItemIndexes.add(resultEntry.originalIndex);
    const message = formatDatabaseError(error);
    setDatabasePersistenceState('warning', `已有 ${databaseFailedItemIndexes.size} 条结果暂未写入数据库；批次结束后会自动整体补写。${message}`);
    saveCurrentBatchHistory('failed');
    console.warn('[batch] 本地数据库明细写入失败，批量任务继续执行:', message);
  }
}

/**
 * 事务性同步整个批次。服务端会校验完整批次的条数，并以 run_id + url_index 幂等更新。
 */
async function syncLocalDatabaseRunResults(nextStatus) {
  if (!batchId || !batchPromotionSite || !batchPromotionSite.url) return false;
  const executedItems = localResults.filter((r) => r.result !== 'unstarted');
  setDatabasePersistenceState('saving', `正在将 ${executedItems.length} 条执行结果写入数据库，请稍候…`);
  await saveCurrentBatchHistory('pending');
  try {
    const result = await requestLocalDatabase('/api/runs/sync-results', {
      run: buildLocalDatabaseRunPayload(nextStatus),
      items: executedItems.map(buildLocalDatabaseRunItemPayload),
      status: nextStatus
    }, { timeoutMs: LOCAL_DATABASE_SYNC_TIMEOUT_MS });
    databaseFailedItemIndexes.clear();
    const persistedCount = Number(result && result.persistedCount);
    setDatabasePersistenceState('success', `数据库写入成功，已保存 ${persistedCount} 条执行结果。重复写入不会产生重复记录。`);
    await saveCurrentBatchHistory('synced');
    console.log('[batch] 本地数据库批次同步完成:', { batchId, status: nextStatus, persistedCount });
    return true;
  } catch (error) {
    const message = formatDatabaseError(error);
    setDatabasePersistenceState('failed', `数据库写入失败：${message} 执行结果仍保留在当前页面，可点击“重新写入数据库”。`);
    await saveCurrentBatchHistory('failed');
    console.error('[batch] 本地数据库批次同步失败:', message);
    return false;
  }
}

/**
 * 用户手动重试时复用原批次 ID 和全部结果，服务端唯一约束保证重复点击仍为幂等写入。
 */
async function retryDatabasePersistence() {
  if (retryDatabaseBtn) retryDatabaseBtn.disabled = true;
  const finalStatus = status === 'terminated' ? 'terminated' : 'completed';
  await syncLocalDatabaseRunResults(finalStatus);
  if (retryDatabaseBtn) retryDatabaseBtn.disabled = false;
}

function clearBatchSubmitStorageForUrl(urlStr) {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  chrome.storage.local.get(['batchSubmitCtxMap'], (data) => {
    if (data && data.batchSubmitCtxMap && typeof data.batchSubmitCtxMap === 'object') {
      const map = { ...data.batchSubmitCtxMap };
      let changed = false;
      if (!urlStr) {
        chrome.storage.local.remove(['batchSubmitCtx', 'batchSubmitCtxMap', 'batchCtx'], () => {});
        return;
      }
      let targetKey = '';
      try {
        const u = new URL(urlStr);
        targetKey = (u.origin + u.pathname).toLowerCase().replace(/\/+$/, '');
      } catch (_) {
        targetKey = String(urlStr).toLowerCase().split('?')[0].split('#')[0].replace(/\/+$/, '');
      }
      for (const k of Object.keys(map)) {
        if (k === targetKey || (targetKey && (k.includes(targetKey) || targetKey.includes(k)))) {
          delete map[k];
          changed = true;
        }
      }
      if (changed) {
        chrome.storage.local.set({ batchSubmitCtxMap: map }, () => {
          chrome.storage.local.remove('batchSubmitCtx', () => {});
        });
      }
    }
  });
}

// ==================== 批量处理核心 ====================
function getBatchTaskInfo(taskIndex) {
  const M = parsedUrls.length;
  if (M === 0) return null;
  const queue = batchTargetQueue.length > 0 ? batchTargetQueue : (batchPromotionSite ? [batchPromotionSite] : []);
  if (queue.length === 0) return null;
  const siteIndex = Math.min(queue.length - 1, Math.floor(taskIndex / M));
  const urlIndexInSite = taskIndex % M;
  const site = queue[siteIndex] || batchPromotionSite;
  const item = parsedUrls[urlIndexInSite];
  if (!item) return null;
  return {
    taskIndex,
    siteIndex,
    urlIndexInSite,
    site: normalizeBatchPromotionSite(site),
    item
  };
}

async function startBatch() {
  if (parsedUrls.length === 0) {
    alert('请先上传有效的 CSV 文件，或粘贴至少一个有效 URL');
    return;
  }

  const selectedSites = getSelectedBatchPromotionSites();
  if (selectedSites.length === 0) {
    alert('请至少勾选一个目标 URL');
    return;
  }

  const incompleteSite = selectedSites.find((site) => !site.url || !site.content);
  if (incompleteSite) {
    alert(`目标站点“${incompleteSite.name || incompleteSite.url}”配置不完整（缺少网站 URL 或介绍），请先在目标 URL 管理中完善`);
    return;
  }

  const shouldContinue = await confirmDatabaseAvailabilityBeforeStart();
  if (!shouldContinue) return;

  if (queueTransitionTimer) {
    clearTimeout(queueTransitionTimer);
    queueTransitionTimer = null;
  }

  batchTargetQueue = [...selectedSites];
  currentQueueSiteIndex = 0;
  isTerminated = false;

  // 启动任务前二次去重，彻底保证进入执行队列的引荐 URL 绝无重复
  const uniqueParsed = [];
  const seenStartUrls = new Set();
  parsedUrls.forEach((item) => {
    const key = normalizeReferralUrlForDedupe(item.url);
    if (!key || seenStartUrls.has(key)) return;
    seenStartUrls.add(key);
    uniqueParsed.push({ ...item, originalIndex: uniqueParsed.length });
  });
  if (uniqueParsed.length !== parsedUrls.length) {
    parsedUrls = uniqueParsed;
  }

  await new Promise((resolve) => {
    chrome.storage.local.remove(['batchCtx', 'batchSubmitCtx', 'batchSubmitCtxMap'], resolve);
  });

  // 全局唯一批次 ID，整个 M * N 任务共享同一个批次
  batchId = generateUUID();
  totalCount = parsedUrls.length * batchTargetQueue.length;
  successCount = 0;
  failCount = 0;
  skippedCount = 0;
  noCommentBoxCount = 0;
  manualRequiredCount = 0;
  blockedIllegalCount = 0;
  unstartedCount = totalCount;
  pendingCount = totalCount;
  currentIndex = 0;

  // 预置全量 M * N 任务快照为“未开始”，确保随时中断均能完整恢复所有未跑任务
  localResults = [];
  const initM = parsedUrls.length;
  for (let idx = 0; idx < totalCount; idx++) {
    const siteIdx = Math.min(batchTargetQueue.length - 1, Math.floor(idx / initM));
    const urlIdx = idx % initM;
    const site = batchTargetQueue[siteIdx];
    const referralItem = parsedUrls[urlIdx];
    localResults.push({
      originalIndex: idx,
      urlIndexInSite: urlIdx,
      siteIndex: siteIdx,
      url: referralItem ? referralItem.url : '',
      sourceDomain: referralItem ? (referralItem.sourceDomain || extractDomain(referralItem.url)) : '',
      result: 'unstarted',
      aiContent: null,
      errorMessage: null,
      promotionSiteId: (site && site.id) || '',
      promotionSiteName: (site && site.name) || '',
      promotionSiteUrl: (site && site.url) || '',
      pageMetrics: null,
      timestamp: null,
      elapsed: null,
      originalRow: referralItem && referralItem.originalRow ? referralItem.originalRow : []
    });
  }
  statsSelectedSiteKey = 'all';
  isSiteOverviewOpen = false;
  databaseFailedItemIndexes.clear();
  retryingItemIndexes.clear();
  timeoutRetryMap.clear();
  pendingRetryQueue = [];
  batchStartedAt = Date.now();
  batchCompletedAt = null;
  status = 'running';

  // 设定当前首个目标站点并保存设置供 content.js 读取
  batchPromotionSite = normalizeBatchPromotionSite(batchTargetQueue[0]);
  await saveBatchTaskSettings();

  // 清除 URL 预览表格各行的执行状态高亮
  if (urlPreviewBody) {
    urlPreviewBody.querySelectorAll('tr').forEach((tr) => {
      tr.classList.remove('url-processing', 'url-done-success', 'url-done-fail', 'url-done-skipped', 'url-done-blocked', 'processing', 'success', 'fail', 'skipped', 'manual_required', 'no_comment_box', 'retrying');
    });
  }

  setStatus('running');
  updateUI();
  updateStatsUI();
  updateBatchPromotionSiteSummary();
  try {
    await saveCurrentBatchHistory('pending');
  } catch (err) {
    console.error('[batch] 保存批次初始快照失败:', err);
  }
  // 数据库写入属于旁路持久化，失败只更新提示，绝不延迟或中断自动化标签页调度。
  try {
    persistLocalDatabaseRunStart();
  } catch (err) {
    console.error('[batch] 写入数据库初始运行记录失败:', err);
  }

  // 启动并发池打开标签页
  scheduleNextTabs();
}

async function startNextSiteInQueue() {
  if (queueTransitionTimer) {
    clearTimeout(queueTransitionTimer);
    queueTransitionTimer = null;
  }
  isTransitioningQueue = false;
  if (isTerminated || currentQueueSiteIndex >= batchTargetQueue.length) return;

  status = 'running';
  setStatus('running');
  updateUI();
  updateStatsUI();
  updateBatchPromotionSiteSummary();
  updateQueueBanner();

  scheduleNextTabs();
}

// 从数据库拉取目标站点历史成功记录
async function fetchTargetSiteSuccessHistory(targetUrl) {
  const normalizedTarget = String(targetUrl || '').trim();
  if (!normalizedTarget) return {};
  try {
    const encoded = encodeURIComponent(normalizedTarget);
    const result = await requestLocalDatabase(`/api/runs/target-success-items?targetUrl=${encoded}`, undefined, {
      method: 'GET',
      timeoutMs: 3000
    });
    const historyMap = {};
    if (Array.isArray(result)) {
      for (const item of result) {
        if (item && item.referralUrl) {
          historyMap[item.referralUrl] = {
            runId: item.runId || '',
            executedAt: item.executedAt || '',
            aiContent: item.aiContent || null,
            result: item.result || 'success'
          };
        }
      }
    }
    console.log(`[batch] 已从本地数据库拉取目标站点历史成功记录：${Object.keys(historyMap).length} 条`);
    return historyMap;
  } catch (err) {
    console.warn('[batch] 无法连接数据库查询历史成功记录，使用本地批次历史聚合兜底:', err.message || err);
    const historyMap = {};
    for (const record of batchHistory) {
      if (record && record.results && isSameTargetUrlForStats(record.targetUrl, normalizedTarget)) {
        for (const item of record.results) {
          if (item && item.url && (item.result === 'success' || item.result === 'skipped')) {
            if (!historyMap[item.url]) {
              historyMap[item.url] = {
                runId: record.id || '',
                executedAt: item.timestamp ? new Date(item.timestamp).toISOString() : (record.startedAt ? new Date(record.startedAt).toISOString() : ''),
                aiContent: item.aiContent || null,
                result: item.result
              };
            }
          }
        }
      }
    }
    return historyMap;
  }
}

function isSameTargetUrlForStats(urlA, urlB) {
  const normA = String(urlA || '').trim().replace(/\/+$/, '').toLowerCase();
  const normB = String(urlB || '').trim().replace(/\/+$/, '').toLowerCase();
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const domA = extractDomain(normA);
  const domB = extractDomain(normB);
  return Boolean(domA && domB && domA === domB);
}

// 保存批量任务设置到 storage.local
async function saveBatchTaskSettings() {
  const targetUrl = batchPromotionSite && batchPromotionSite.url ? batchPromotionSite.url : '';
  const isIgnoreHistory = batchIgnoreHistory ? batchIgnoreHistory.checked : false;
  let successHistory = {};
  if (!isIgnoreHistory && targetUrl) {
    successHistory = await fetchTargetSiteSuccessHistory(targetUrl);
  }

  return new Promise((resolve) => {
    const isDebug = batchDebugMode ? batchDebugMode.checked : false;
    const settings = {
      autoOpenPanel: batchAutoOpenPanel ? batchAutoOpenPanel.checked : true,
      autoGenerate: isDebug ? false : (batchAutoGenerate ? batchAutoGenerate.checked : true),
      autoSubmit: batchAutoSubmit ? batchAutoSubmit.checked : true,
      ignoreHistory: isIgnoreHistory,
      debugMode: isDebug,
      debugComment: isDebug ? resolveDebugCommentText(batchPromotionSite) : '',
      promotionSite: normalizeBatchPromotionSite(batchPromotionSite),
      targetSuccessHistory: successHistory,
      savedAt: Date.now()
    };
    const urls = parsedUrls.map(item => item.url);

    chrome.storage.local.set({
      [BATCH_SETTINGS_KEY]: settings,
      [BATCH_URLS_KEY]: urls,
      batchTargetSuccessHistory: successHistory
    }, () => {
      console.log('[batch] 批量任务设置已保存:', settings, 'URL 数量:', urls.length, '历史成功记录数:', Object.keys(successHistory).length, '是否忽略历史成功:', isIgnoreHistory);
      resolve();
    });
  });
}

// 清除批量任务设置
async function clearBatchTaskSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([BATCH_SETTINGS_KEY, BATCH_URLS_KEY, 'batchTargetSuccessHistory'], () => {
      console.log('[batch] 批量任务设置已清除');
      resolve();
    });
  });
}

// 终止标志：stopBatch 后保持 results 但不再处理
let isTerminated = false;

async function stopBatch() {
  // 停止继续打开新标签页
  isTerminated = true;
  isTransitioningQueue = false;
  if (queueTransitionTimer) {
    clearTimeout(queueTransitionTimer);
    queueTransitionTimer = null;
  }
  setStatus('terminated');
  updateQueueBanner();

  // 标记所有待处理的为未处理（可用于恢复）
  const terminatedCount = pendingCount;

  // 清空轮询和超时检查
  if (pollTimer) clearTimeout(pollTimer);
  stopTimeoutChecker();

  // 先把正在处理的标签页记为已终止，避免关闭回调把它当作待恢复项卡住。
  const activeEntries = Array.from(activeTabs.entries());
  for (const [tabId, info] of activeEntries) {
    const entry = localResults.find((r) => r.originalIndex === info.urlIndex);
    const isFresh = entry && entry.timestamp >= info.startTime;
    if (!isFresh) {
      const elapsed = Math.round((Date.now() - info.startTime) / 1000);
      handleTabResult(info.urlIndex, 'fail', null, '手动终止', elapsed, { suppressCompletion: true });
    }
  }

  // 关闭所有打开的标签页
  const tabIds = activeEntries.map(([tabId]) => tabId);
  activeTabs.clear();
  activeTabsByIndex.clear();
  tabsPendingConfirm.clear();
  tabsWaitingClose.clear();
  timeoutRetryMap.clear();
  pendingRetryQueue = [];
  for (const tabId of tabIds) {
    try {
      await new Promise((resolve) => {
        chrome.tabs.remove(tabId, () => resolve());
      });
    } catch (_) {}
  }
  activeTabCount = 0;
  chrome.storage.local.remove(['batchCtx', 'batchSubmitCtx', 'batchSubmitCtxMap'], () => {});

  // 状态设为 terminated，用于显示保留的结果
  updateStatsUI();
  updateUI();

  // 显示终止提示
  console.log(`[batch] 已手动终止。共保留 ${localResults.length} 条结果（成功 ${successCount}，失败 ${failCount}），跳过 ${terminatedCount} 条未处理`);
  batchCompletedAt = Date.now();
  await saveCurrentBatchHistory('pending');
  await syncLocalDatabaseRunResults('terminated');
}

// 恢复处理（从终止状态继续）
async function resumeBatch() {
  console.log('[resumeBatch] 开始恢复处理', { status, currentIndex, totalCount, successCount, failCount });

  if (status !== 'terminated') {
    console.log('[resumeBatch] 状态不是 terminated，不执行');
    return;
  }

  const shouldContinue = await confirmDatabaseAvailabilityBeforeStart();
  if (!shouldContinue) return;

  // 重置终止状态
  isTerminated = false;

  // 重置待处理计数（仅统计还未处理的）
  const processedCount = getProcessedCount();
  pendingCount = totalCount - processedCount;
  const processedIndices = new Set(localResults.map((r) => r.originalIndex));
  let nextIndex = currentIndex;
  while (nextIndex < totalCount && processedIndices.has(nextIndex)) {
    nextIndex++;
  }
  if (nextIndex >= totalCount) {
    const fallbackIndex = parsedUrls.findIndex((_, idx) => !processedIndices.has(idx));
    nextIndex = fallbackIndex === -1 ? totalCount : fallbackIndex;
  }
  if (nextIndex >= totalCount) {
    console.log('[resumeBatch] 所有条目已处理完成，直接结束');
    isTerminated = true;
    setStatus('completed');
    updateUI();
    updateStatsUI();
    return;
  }
  currentIndex = nextIndex;

  console.log('[resumeBatch] 将要处理的 URL 索引范围:', currentIndex, '-', totalCount - 1);

  setStatus('running');
  updateUI();
  try {
    await saveCurrentBatchHistory('pending');
  } catch (err) {
    console.error('[batch] 恢复批次初始快照失败:', err);
  }

  const maxConcurrent = getConcurrencySetting();
  console.log('[resumeBatch] 启动并发调度池，最大并发数:', maxConcurrent);

  scheduleNextTabs();
}

// 并发调度池管理器：自动补足打开标签页直到达到 maxConcurrentTabs
let isScheduling = false;
async function scheduleNextTabs() {
  if (isScheduling || status !== 'running' || isTerminated) return;
  isScheduling = true;
  try {
    const maxConcurrent = getConcurrencySetting();
    const M = parsedUrls.length || 1;
    const currentSiteEnd = Math.min(totalCount, (currentQueueSiteIndex + 1) * M);
    console.log('[scheduleNextTabs] 调度并发池:', { activeTabCount, maxConcurrent, currentIndex, currentSiteEnd, totalCount, pendingRetries: pendingRetryQueue.length, status });
    while (status === 'running' && !isTerminated && activeTabCount < maxConcurrent && (pendingRetryQueue.length > 0 || currentIndex < currentSiteEnd)) {
      await openNextTab();
      if (activeTabCount < maxConcurrent && (pendingRetryQueue.length > 0 || currentIndex < currentSiteEnd)) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  } finally {
    isScheduling = false;
  }
}

async function openNextTab() {
  const maxConcurrent = getConcurrencySetting();
  const M = parsedUrls.length || 1;
  const currentSiteEnd = Math.min(totalCount, (currentQueueSiteIndex + 1) * M);
  console.log('[openNextTab] 检查条件', { status, isTerminated, activeTabCount, maxConcurrent, currentIndex, currentSiteEnd, totalCount, pendingRetries: pendingRetryQueue.length });

  if (status !== 'running') {
    console.log('[openNextTab] 跳过 - 状态不是 running');
    return;
  }
  if (isTerminated) {
    console.log('[openNextTab] 跳过 - 已终止');
    return;
  }
  if (activeTabCount >= maxConcurrent) {
    console.log('[openNextTab] 跳过 - 已达最大并发数', activeTabCount, '>=', maxConcurrent);
    return;
  }

  let urlIndex;
  let isRetryTab = false;
  if (pendingRetryQueue.length > 0) {
    urlIndex = pendingRetryQueue.shift();
    isRetryTab = true;
  } else if (currentIndex < currentSiteEnd) {
    urlIndex = currentIndex;
    currentIndex++;
  } else {
    console.log('[openNextTab] 跳过 - 索引超出当前站点范围且无待重试项');
    return;
  }

  const task = getBatchTaskInfo(urlIndex);
  if (!task) return;
  const { site, item, urlIndexInSite } = task;
  const { url, sourceDomain } = item;
  if (task.siteIndex != null && task.siteIndex !== currentQueueSiteIndex) {
    currentQueueSiteIndex = task.siteIndex;
    batchPromotionSite = normalizeBatchPromotionSite(site);
    updateBatchPromotionSiteSummary();
    updateQueueBanner();
  }
  console.log('[openNextTab] 准备打开标签页', { urlIndex, urlIndexInSite, siteIndex: task.siteIndex, siteName: site.name, url, activeTabCount, maxConcurrent, isRetryTab });

  const illegalCheck = item.illegalCheck || evaluateIllegalSiteForBatchItem(url, sourceDomain);
  if (illegalCheck.blocked) {
    console.warn('[batch] 命中非法网站规则，跳过打开标签页:', { urlIndex, url, illegalCheck });
    item.illegalCheck = illegalCheck;
    retryingItemIndexes.delete(urlIndex);
    handleTabResult(urlIndex, 'blocked_illegal', null, getIllegalSiteBlockMessage(illegalCheck), 0);
    if (status === 'running' && (pendingRetryQueue.length > 0 || currentIndex < currentSiteEnd)) {
      setTimeout(scheduleNextTabs, 0);
    } else if (status === 'running' && activeTabCount === 0) {
      checkAllCompleted();
    }
    return;
  }

  try {
    chrome.tabs.create({ url, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        retryingItemIndexes.delete(urlIndex);
        console.error('[batch] 打开标签页失败:', chrome.runtime.lastError);
        handleTabResult(urlIndex, 'fail', null, '无法打开标签页');
        if (status === 'running' && (pendingRetryQueue.length > 0 || currentIndex < currentSiteEnd)) {
          setTimeout(scheduleNextTabs, 0);
        } else if (status === 'running' && activeTabCount === 0) {
          checkAllCompleted();
        }
        return;
      }

      activeTabCount++;
      activeTabs.set(tab.id, { urlIndex, urlIndexInSite, siteIndex: task ? task.siteIndex : currentQueueSiteIndex, startTime: Date.now() });
      activeTabsByIndex.set(urlIndex, { urlIndex, urlIndexInSite, siteIndex: task ? task.siteIndex : currentQueueSiteIndex, startTime: Date.now() });

      // 高亮预览表格中对应的行 (只高亮当前引荐 URL 行 0..M-1)
      highlightPreviewRow(urlIndexInSite, 'processing');

      startTimeoutChecker();
      updateStatsUI();

      // 监听标签页关闭
      const listener = (tabId, removeInfo) => {
        if (tabId === tab.id) {
          // 取 startTime（必须在删除前获取）
          const startTime = activeTabs.get(tab.id)?.startTime;
          activeTabs.delete(tab.id);
          activeTabsByIndex.delete(urlIndex);
          retryingItemIndexes.delete(urlIndex);
          activeTabCount = Math.max(0, activeTabCount - 1);
          chrome.tabs.onRemoved.removeListener(listener);

          console.log('[batch] 标签页关闭:', { tabId, urlIndex, activeTabCount, status });

          // 检查是否已有结果（content.js 主动上报或超时处理过了）
          const checkAndRecord = async () => {
            const currentEntry = localResults.find((r) => r.originalIndex === urlIndex);
            const isFresh = currentEntry && currentEntry.timestamp >= (startTime || 0);
            if (!isFresh) {
              // 延迟 400ms 并读取 storage，防止页面跳转关闭时上报还在途中
              await new Promise(r => setTimeout(r, 400));
              const currentEntry2 = localResults.find((r) => r.originalIndex === urlIndex);
              if (currentEntry2 && currentEntry2.timestamp >= (startTime || 0)) {
                clearPreviewRow(urlIndexInSite);
                updateStatsUI();
                return;
              }
              const stored = await new Promise(resolve => {
                chrome.storage.local.get(['batchResults'], (d) => resolve(d && d.batchResults));
              });
              const match = Array.isArray(stored) && stored.find(item => item.batchId === batchId && item.urlIndex === urlIndex);
              if (match && match.timestamp >= (startTime || 0)) {
                console.log('[batch] 标签关闭后从 storage 恢复匹配结果:', match);
                handleTabResult(urlIndex, match.result, match.aiContent, match.errorMessage, undefined, match);
                clearPreviewRow(urlIndexInSite);
                updateStatsUI();
                return;
              }
              console.log('[batch] 标签关闭但无结果，记为失败:', urlIndex);
              const elapsed = startTime ? Math.round((Date.now() - startTime) / 1000) : null;
              handleTabResult(urlIndex, 'fail', null, '用户手动关闭', elapsed);
            } else {
              console.log('[batch] 标签关闭已有结果:', urlIndex);
              clearPreviewRow(urlIndexInSite);
            }
            updateStatsUI();
          };

          checkAndRecord().finally(() => {
            const M = parsedUrls.length || 1;
            const currentSiteEnd = Math.min(totalCount, (currentQueueSiteIndex + 1) * M);
            // 标签关闭后触发并发调度池补充新标签
            if (status === 'running' && (pendingRetryQueue.length > 0 || currentIndex < currentSiteEnd)) {
              scheduleNextTabs();
            } else if (status === 'running' && activeTabCount === 0) {
              // 所有标签页都已关闭，检查是否全部完成
              checkAllCompleted();
            }
          });
        }
      };
      chrome.tabs.onRemoved.addListener(listener);

      // 等待 content script 就绪后再发送任务
      function sendWhenReady(tabId, retries = 0) {
        if (status !== 'running' || isTerminated || !activeTabs.has(tabId)) {
          console.log('[batch] sendWhenReady 停止重试：任务已停止或标签页不再活跃', { tabId, status, isTerminated });
          return;
        }
        if (retries > 60) {
          console.warn('[batch] content.js 就绪超时，放弃发送, tabId:', tabId);
          activeTabs.delete(tabId);
          activeTabsByIndex.delete(urlIndex);
          tabsPendingConfirm.delete(tabId);
          tabsWaitingClose.delete(tabId);
          retryingItemIndexes.delete(urlIndex);
          activeTabCount = Math.max(0, activeTabCount - 1);
          try {
            chrome.tabs.remove(tabId, () => {});
          } catch (_) {}

          const currentRetries = timeoutRetryMap.get(urlIndex) || 0;
          if (status === 'running' && !isTerminated && currentRetries < timeoutRetryCount) {
            timeoutRetryMap.set(urlIndex, currentRetries + 1);
            console.log(`[batch] urlIndex ${urlIndex} 页面脚本就绪超时，加入重试队列 (第 ${currentRetries + 1}/${timeoutRetryCount} 次重试)...`);
            pendingRetryQueue.push(urlIndex);
            highlightPreviewRow(urlIndexInSite, 'pending');
            setTimeout(scheduleNextTabs, 500);
          } else {
            handleTabResult(urlIndex, 'fail', null, currentRetries > 0 ? `页面脚本注入就绪超时（已重试 ${currentRetries} 次）` : '页面脚本注入就绪超时');
            if (status === 'running' && !isTerminated) {
              setTimeout(scheduleNextTabs, 0);
            }
          }
          return;
        }
        chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId: 0 }).then(() => {
          const isDebug = batchDebugMode ? batchDebugMode.checked : false;
          const isIgnoreHistory = batchIgnoreHistory ? batchIgnoreHistory.checked : false;
          const presetComment = isDebug ? resolveDebugCommentText(site || batchPromotionSite) : '';

          console.log('[batch] content.js 已就绪，发送 BATCH_HANDLE → tabId:', tab.id, { batchId, urlIndex, url, siteName: (site && site.name) || '', isDebug, isIgnoreHistory, isRetryTab, time: new Date().toISOString() });
          chrome.tabs.sendMessage(tab.id, {
            type: 'BATCH_HANDLE',
            batchId,
            urlIndex,
            url,
            promotionSite: normalizeBatchPromotionSite(site || batchPromotionSite),
            debugMode: isDebug,
            presetComment: presetComment,
            ignoreHistory: isIgnoreHistory,
            forceRetry: isRetryTab
          }, { frameId: 0 }).then((response) => {
            console.log('[batch] 收到 content.js 响应:', response, 'tabId:', tab.id, 'tabsPendingConfirm:', [...tabsPendingConfirm.keys()], 'time:', new Date().toISOString());
            if (response && response.ok) {
              const currentEntry = localResults.find((r) => r.originalIndex === urlIndex);
              const isFresh = currentEntry && currentEntry.timestamp >= (startTime || 0);
              if (isFresh || !activeTabs.has(tab.id)) {
                console.log('[batch] 结果已确认或标签已关闭，不再登记 tabsPendingConfirm:', { tabId: tab.id, urlIndex });
                return;
              }
              console.log('[batch] 记录 tabId', tab.id, '到 tabsPendingConfirm, 等待 BATCH_CONFIRMED...');
              tabsPendingConfirm.set(tab.id, { urlIndex });
              tabsWaitingClose.add(tab.id);
            } else {
              console.warn('[batch] content.js 响应 ok=false 或无响应:', response);
            }
          }).catch(async (err) => {
            console.warn('[batch] sendMessage BATCH_HANDLE 发送失败:', err.message || err, 'tabId:', tab.id);
            // 表单提交后页面跳转/关闭会导致消息通道断开，先从 storage 检索已落盘结果
            await new Promise(r => setTimeout(r, 800));
            const currentEntry = localResults.find((r) => r.originalIndex === urlIndex);
            const isFresh = currentEntry && currentEntry.timestamp >= (startTime || 0);
            if (!isFresh) {
              const stored = await new Promise(resolve => {
                chrome.storage.local.get(['batchResults'], (d) => resolve(d && d.batchResults));
              });
              const match = Array.isArray(stored) && stored.find(item => item.batchId === batchId && item.urlIndex === urlIndex);
              if (match && match.timestamp >= (startTime || 0)) {
                console.log('[batch] catch 中从 storage 恢复匹配结果:', match);
                handleTabResult(urlIndex, match.result, match.aiContent, match.errorMessage, undefined, match);
                try { chrome.tabs.remove(tab.id, () => {}); } catch (_) {}
                return;
              }
              console.log('[batch] sendMessage 失败且无结果记录，记为失败');
              handleTabResult(urlIndex, 'fail', null, '消息发送失败：' + (err.message || '标签页可能已关闭'));
            }
          });
        }).catch(() => {
          // content.js 还没注入，500ms 后重试
          setTimeout(() => sendWhenReady(tabId, retries + 1), 500);
        });
      }
      sendWhenReady(tab.id);
    });
  } catch (e) {
    console.error('[batch] openNextTab 错误:', e);
    // 出错时继续调度下一个
    if (currentIndex < totalCount) {
      setTimeout(scheduleNextTabs, 1000);
    }
  }
}

function recalculateStatsCounts() {
  const summary = summarizeBatchResults(localResults);
  successCount = summary.success;
  failCount = summary.fail;
  skippedCount = summary.skipped;
  noCommentBoxCount = summary.noCommentBox;
  manualRequiredCount = summary.manualRequired;
  blockedIllegalCount = summary.blockedIllegal;
  unstartedCount = summary.unstarted;
  pendingCount = Math.max(0, totalCount - summary.processed);
}

// 处理标签页结果
// elapsed 可选，外部已知的耗时直接传入（如手动关闭时），否则从 activeTabsByIndex 计算
function handleTabResult(urlIndex, result, aiContent, errorMessage, forcedElapsed, options = {}) {
  console.log('[batch] handleTabResult 被调用:', { urlIndex, result, aiContentLen: aiContent ? aiContent.length : 0, errorMessage });
  const task = getBatchTaskInfo(urlIndex);
  let item = task ? task.item : null;
  let site = task ? task.site : batchPromotionSite;
  let urlIndexInSite = task ? task.urlIndexInSite : (urlIndex % (parsedUrls.length || 1));
  let siteIndex = task ? task.siteIndex : 0;

  if (!item) {
    const existing = localResults.find((r) => r.originalIndex === urlIndex);
    if (existing) {
      item = {
        originalIndex: urlIndex,
        url: existing.url,
        sourceDomain: existing.sourceDomain || extractDomain(existing.url),
        originalRow: existing.originalRow || []
      };
      site = {
        id: existing.promotionSiteId,
        name: existing.promotionSiteName,
        url: existing.promotionSiteUrl
      };
    }
  }
  if (!item) {
    console.log('[batch] handleTabResult: item 不存在, urlIndex=', urlIndex);
    return;
  }

  let elapsed = forcedElapsed !== undefined ? forcedElapsed : null;
  if (elapsed === null) {
    const tabInfo = activeTabsByIndex.get(urlIndex);
    elapsed = tabInfo ? Math.round((Date.now() - tabInfo.startTime) / 1000) : null;
  }

  const resultEntry = {
    originalIndex: urlIndex,
    urlIndexInSite,
    siteIndex,
    url: item.url,
    sourceDomain: item.sourceDomain || '',
    result: result,
    aiContent: aiContent || null,
    errorMessage: errorMessage || null,
    promotionSiteId: (site && site.id) || options.promotionSiteId || (batchPromotionSite && batchPromotionSite.id) || '',
    promotionSiteName: (site && site.name) || options.promotionSiteName || (batchPromotionSite && batchPromotionSite.name) || '',
    promotionSiteUrl: (site && site.url) || options.promotionSiteUrl || (batchPromotionSite && batchPromotionSite.url) || '',
    pageMetrics: options.pageMetrics && typeof options.pageMetrics === 'object' ? options.pageMetrics : null,
    timestamp: Date.now(),
    elapsed,
    originalRow: item.originalRow || null  // 保存原始行数据用于导出
  };

  const existingIdx = localResults.findIndex((r) => r.originalIndex === urlIndex);
  if (existingIdx >= 0) {
    localResults[existingIdx] = resultEntry;
  } else {
    localResults.push(resultEntry);
  }

  reportBlogRunStatsIfNeeded(item, result);

  if (result === 'skipped') {
    skippedIndices.add(urlIndex);
  } else {
    skippedIndices.delete(urlIndex);
  }
  timeoutRetryMap.delete(urlIndex);
  highlightPreviewRow(urlIndexInSite, result);

  recalculateStatsCounts();
  updateStatsUI();
  renderStats();

  // 保存到本地存储
  saveLocalResults();
  persistLocalDatabaseRunItem(resultEntry);
  if (item && item.url) {
    clearBatchSubmitStorageForUrl(item.url);
  }

  // 检查是否全部完成（成功 + 失败 + 已跳过 + 无评论框 >= 总数）
  checkAllCompleted(options);
}

function reportBlogRunStatsIfNeeded(item, result) {
  // 个人本地版不再写入远程 blog_run_stats，批量结果只保存在本地并可手动导出。
  if (result === 'success' || result === 'manual_required') {
    console.log('[batch] 本地模式跳过远程运行统计上报:', buildBlogRunStatsPayload(item, result));
  }
}

function buildBlogRunStatsPayload(item, result) {
  const row = Array.isArray(item && item.originalRow) ? item.originalRow : [];
  const originalUrl = (item && item.url) || normalizeUrlForStats(row[1]);
  const urlDomain = normalizeDomainForStats(row[2] || (item && item.sourceDomain) || extractDomain(originalUrl));
  const targetDomain = normalizeDomainForStats(row[3]);

  return {
    pageAs: normalizeStatValue(row[0]),
    originalUrl,
    urlDomain,
    targetDomain,
    type: normalizeStatValue(row[4]),
    externalLinkCount: parseIntegerForStats(row[5]),
    validationResult: result === 'success' ? 1 : 2
  };
}

function normalizeStatValue(value) {
  return String(value || '').trim();
}

function normalizeUrlForStats(value) {
  const text = normalizeStatValue(value);
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function normalizeDomainForStats(value) {
  const text = normalizeStatValue(value);
  if (!text) return '';
  try {
    return new URL(normalizeUrlForStats(text)).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return text.replace(/^www\./i, '').toLowerCase();
  }
}

function parseIntegerForStats(value) {
  const parsed = parseInt(String(value || '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// background 通知：结果已落盘，可以安全关闭标签页了
function handleTabConfirmed(urlIndex, result, aiContent, errorMessage, resultMetadata = {}) {
  console.log('[batch] handleTabConfirmed >>>', { urlIndex, result, aiContentLen: aiContent ? aiContent.length : 0, errorMessage, tabsPendingConfirmBefore: [...tabsPendingConfirm.entries()] });

  retryingItemIndexes.delete(urlIndex);
  // 处理结果（更新 UI、写入 storage）
  handleTabResult(urlIndex, result, aiContent, errorMessage, undefined, resultMetadata);

  // 查找并关闭标签页（如果还在的话）
  let closedTab = false;
  for (const [tabId, info] of tabsPendingConfirm) {
    if (info.urlIndex === urlIndex) {
      console.log('[batch] 关闭 tabId:', tabId, 'urlIndex:', urlIndex);
      tabsPendingConfirm.delete(tabId);
      tabsWaitingClose.delete(tabId);
      closedTab = true;
      chrome.tabs.remove(tabId, () => {});
      break;
    }
  }

  if (!closedTab) {
    for (const [tabId, info] of activeTabs) {
      if (info.urlIndex === urlIndex) {
        console.log('[batch] tabsPendingConfirm 未登记，按 activeTabs 关闭 tabId:', tabId, 'urlIndex:', urlIndex);
        chrome.tabs.remove(tabId, () => {});
        break;
      }
    }
  }

  // 找不到对应的 tabId 说明已经关闭了（用户手动关或超时自动关），无需处理
  console.log('[batch] handleTabConfirmed <<<');
}

function getProcessedCount() {
  return successCount + failCount + skippedCount + noCommentBoxCount + manualRequiredCount + blockedIllegalCount;
}

let isTransitioningQueue = false;

async function checkAllCompleted(options = {}) {
  if (isTransitioningQueue || options.suppressCompletion || status !== 'running' || totalCount === 0 || isTerminated) return;

  const M = parsedUrls.length || 1;
  const currentSiteStart = currentQueueSiteIndex * M;
  const currentSiteEnd = Math.min(totalCount, (currentQueueSiteIndex + 1) * M);

  // 统计当前目标站点已落盘的条数（排除未开始）
  const currentSiteResults = localResults.filter(
    (r) => r.originalIndex >= currentSiteStart && r.originalIndex < currentSiteEnd && r.result !== 'unstarted'
  );
  const currentSiteAllQueued = currentIndex >= currentSiteEnd && pendingRetryQueue.length === 0;
  const noActiveTabs = activeTabCount === 0 && activeTabs.size === 0;

  console.log('[batch] checkAllCompleted:', {
    currentQueueSiteIndex,
    currentSiteResultsLen: currentSiteResults.length,
    siteTotal: currentSiteEnd - currentSiteStart,
    currentSiteAllQueued,
    noActiveTabs,
    currentIndex,
    totalCount,
    pendingRetries: pendingRetryQueue.length,
    retryingCount: retryingItemIndexes.size
  });

  const unstartedRemaining = localResults.filter((r) => r.result === 'unstarted').length;
  // 如果所有任务均已执行（无未开始），且没有等待中的重试与活动标签页，全量完成
  if (unstartedRemaining === 0 && pendingRetryQueue.length === 0 && retryingItemIndexes.size === 0 && noActiveTabs) {
    await onAllCompleted();
    return;
  }

  // 如果是在执行重试/未开始队列，且重试队列与活动标签已全部清空
  if (pendingRetryQueue.length === 0 && retryingItemIndexes.size === 0 && noActiveTabs && currentIndex >= totalCount) {
    isTerminated = true;
    status = 'terminated';
    setStatus('terminated');
    updateStatsUI();
    updateUI();
    updateBatchPromotionSiteSummary();
    updateQueueBanner();
    await saveCurrentBatchHistory(databaseFailedItemIndexes.size > 0 ? 'failed' : 'pending');
    await syncLocalDatabaseRunResults('terminated');
    return;
  }

  if (currentSiteResults.length >= (currentSiteEnd - currentSiteStart) && currentSiteAllQueued && noActiveTabs) {
    if (currentQueueSiteIndex + 1 < batchTargetQueue.length) {
      isTransitioningQueue = true;
      currentQueueSiteIndex++;
      status = 'queue_transition';
      setStatus('queue_transition');
      updateStatsUI();
      updateUI();
      updateBatchPromotionSiteSummary();
      updateQueueBanner();

      if (urlPreviewBody) {
        urlPreviewBody.querySelectorAll('tr').forEach((tr) => {
          tr.classList.remove('url-processing', 'url-done-success', 'url-done-fail', 'url-done-skipped', 'url-done-blocked', 'processing', 'success', 'fail', 'skipped', 'manual_required', 'no_comment_box', 'retrying');
        });
      }

      batchPromotionSite = normalizeBatchPromotionSite(batchTargetQueue[currentQueueSiteIndex]);
      await saveBatchTaskSettings();

      let remainingSeconds = 3;
      const updateCountdown = () => {
        const textEl = document.getElementById('queueTransitionCountdownText');
        if (textEl) {
          textEl.textContent = `即将开始下一个目标站点 [${batchTargetQueue[currentQueueSiteIndex]?.name || ''}] (${currentQueueSiteIndex + 1}/${batchTargetQueue.length})，${remainingSeconds} 秒后自动开始...`;
        }
      };
      updateCountdown();

      const timerTick = () => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
          startNextSiteInQueue();
        } else {
          updateCountdown();
          queueTransitionTimer = setTimeout(timerTick, 1000);
        }
      };
      queueTransitionTimer = setTimeout(timerTick, 1000);
    } else {
      await onAllCompleted();
    }
  }
}

// 保存结果到本地存储
function saveLocalResults() {
  // 每条结果完成后都更新本地批次历史；数据库不可用也不会丢失可恢复的明细。
  const existingRecord = batchHistory.find((record) => record.id === batchId);
  const prevDbStatus = existingRecord ? existingRecord.databaseStatus : 'pending';
  const currentDbStatus = databaseFailedItemIndexes.size > 0 ? 'failed' : (status === 'running' ? 'pending' : (prevDbStatus === 'synced' ? 'synced' : 'pending'));
  saveCurrentBatchHistory(currentDbStatus);
}

// 全部完成
async function onAllCompleted() {
  console.log('[batch] onAllCompleted 全部目标站点已完成!');
  stopTimeoutChecker();
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  // 关闭所有剩余标签页
  const tabIds = Array.from(activeTabs.keys());
  activeTabs.clear();
  activeTabsByIndex.clear();
  activeTabCount = 0;
  chrome.storage.local.remove(['batchCtx', 'batchSubmitCtx', 'batchSubmitCtxMap'], () => {});
  for (const tabId of tabIds) {
    try {
      chrome.tabs.remove(tabId, () => {});
    } catch (_) {}
  }

  isTerminated = true;  // 防止继续打开新标签页
  status = 'completed';
  setStatus('completed');
  updateStatsUI();
  updateUI();
  updateBatchPromotionSiteSummary();
  updateQueueBanner();

  batchCompletedAt = Date.now();
  await saveCurrentBatchHistory('pending');
  await syncLocalDatabaseRunResults('completed');
  await clearBatchTaskSettings();

  const totalSitesCount = batchTargetQueue.length;
  if (totalSitesCount > 1) {
    alert(`🎉 所有已选目标站点（共 ${totalSitesCount} 个，共 ${totalCount} 条执行记录）批量处理已全部完成！`);
  }
}

// 超时检测
function startTimeoutChecker() {
  if (timeoutCheckTimer) return;
  timeoutCheckTimer = setInterval(() => {
    if (activeTabs.size === 0) {
      stopTimeoutChecker();
      return;
    }
    checkTimeouts();
  }, TIMEOUT_CHECK_INTERVAL);
}

function stopTimeoutChecker() {
  if (timeoutCheckTimer) {
    clearInterval(timeoutCheckTimer);
    timeoutCheckTimer = null;
  }
}

async function checkTimeouts() {
  if (activeTabs.size === 0) {
    stopTimeoutChecker();
    return;
  }
  const now = Date.now();
  const toRemove = [];
  for (const [tabId, info] of activeTabs) {
    const elapsed = (now - info.startTime) / 1000;
    if (elapsed > timeoutSeconds) {
      toRemove.push({ tabId, urlIndex: info.urlIndex });
    }
  }
  for (const { tabId, urlIndex } of toRemove) {
    activeTabs.delete(tabId);
    activeTabsByIndex.delete(urlIndex);
    retryingItemIndexes.delete(urlIndex);
    tabsPendingConfirm.delete(tabId);
    tabsWaitingClose.delete(tabId);
    activeTabCount = Math.max(0, activeTabCount - 1);

    try {
      chrome.tabs.remove(tabId, () => {});
    } catch (_) {}

    const currentRetries = timeoutRetryMap.get(urlIndex) || 0;
    if (status === 'running' && !isTerminated && currentRetries < timeoutRetryCount) {
      timeoutRetryMap.set(urlIndex, currentRetries + 1);
      console.log(`[batch] urlIndex ${urlIndex} 处理超时，加入重试队列 (第 ${currentRetries + 1}/${timeoutRetryCount} 次重试)...`);
      pendingRetryQueue.push(urlIndex);
      highlightPreviewRow(urlIndex, 'pending');
      setTimeout(scheduleNextTabs, 500);
    } else {
      handleTabResult(urlIndex, 'fail', null, currentRetries > 0 ? `处理超时（已重试 ${currentRetries} 次）` : '处理超时');
      if (status === 'running' && !isTerminated) {
        setTimeout(scheduleNextTabs, 0);
      }
    }
  }
}

// ==================== UI 更新 ====================
function setStatus(s) {
  status = s;
  statusBadge.textContent = {
    idle: '空闲',
    running: '运行中',
    queue_transition: '切换目标中',
    completed: '已完成',
    terminated: '已终止'
  }[s] || s;
  statusBadge.className = 'status-badge ' + (s === 'queue_transition' ? 'running' : s);
}

function updateUI() {
  const isIdle = status === 'idle';
  const isRunning = status === 'running' || status === 'queue_transition';
  const isCompleted = status === 'completed';
  const isTerminated = status === 'terminated';

  const selectedCount = getSelectedBatchPromotionSites().length;

  // 开始按钮：运行中、无有效 URL 或未勾选目标时禁用；空闲、完成、终止状态均可发起/恢复处理
  startBtn.disabled = isRunning || parsedUrls.length === 0 || selectedCount === 0;
  const canResume = isTerminated && localResults.length > 0 && localResults.length < totalCount && parsedUrls.length === totalCount;
  startBtn.textContent = canResume ? '▶ 继续处理' : '▶ 开始批量处理';

  stopBtn.disabled = isIdle || isTerminated || isCompleted;
  stopBtn.style.display = (isTerminated || isCompleted) ? 'none' : 'inline-flex';

  exportBtn.disabled = localResults.length === 0;
  clearBtn.disabled = isRunning;
  if (importResultCsvBtn) importResultCsvBtn.disabled = isRunning;
  if (batchPromotionSiteSelect) {
    // 批次有结果时锁定目标 URL，避免手动重试把历史结果写到另一个目标下。
    batchPromotionSiteSelect.disabled = isRunning || isTerminated || isCompleted;
  }
  const listCheckboxes = document.querySelectorAll('.batch-site-checkbox');
  const isSitesLocked = isRunning || (isTerminated && localResults.length > 0);
  listCheckboxes.forEach((cb) => { cb.disabled = isSitesLocked; });
  const selectAllSitesBtn = document.getElementById('selectAllSitesBtn');
  if (selectAllSitesBtn) selectAllSitesBtn.disabled = isSitesLocked;
  const clearAllSitesBtn = document.getElementById('clearAllSitesBtn');
  if (clearAllSitesBtn) clearAllSitesBtn.disabled = isSitesLocked;

  const dropdownTrigger = document.getElementById('batchDropdownTrigger');
  const dropdownMenu = document.getElementById('batchDropdownMenu');
  if (dropdownTrigger) {
    if (isSitesLocked) {
      dropdownTrigger.classList.add('disabled');
      if (dropdownMenu) dropdownMenu.classList.remove('open');
      dropdownTrigger.classList.remove('open');
      dropdownTrigger.setAttribute('aria-expanded', 'false');
    } else {
      dropdownTrigger.classList.remove('disabled');
    }
  }

  updateBatchPromotionSiteSummary();
  updateQueueBanner();

  // 进度、实时日志、底部操作：终止状态保持显示
  progressSection.style.display = (isIdle) ? 'none' : 'block';
  footerActions.style.display = (isIdle) ? 'none' : 'flex';

  // 统计面板：终止状态保持显示（显示已处理的结果）
  if (isIdle) {
    statsPanel.classList.remove('visible');
    statsTableBody.innerHTML = '';
  } else if (localResults.length > 0) {
    statsPanel.classList.add('visible');
    renderStats();
  }

  // 终止状态下可重新开始，将待处理计数恢复
  if (isTerminated) {
    pendingCount = totalCount - getProcessedCount();
    updateStatsUI();
  }
}

function updateStatsUI() {
  const processed = getProcessedCount();
  const percent = totalCount > 0 ? Math.round((processed / totalCount) * 100) : 0;
  progressBar.style.width = percent + '%';
  progressText.textContent = `${processed}/${totalCount} (${percent}%)`;
  successCountEl.textContent = successCount;
  failCountEl.textContent = failCount;
  skippedCountEl.textContent = skippedCount;
  noCommentBoxCountEl.textContent = noCommentBoxCount;
  if (manualRequiredCountEl) manualRequiredCountEl.textContent = manualRequiredCount;
  pendingCountEl.textContent = pendingCount;
}

// ==================== 导出 ====================
function exportResults() {
  const targetSites = getTargetSitesList();
  const selectedSite = statsSelectedSiteKey === 'all'
    ? null
    : targetSites.find((s) => s.key === statsSelectedSiteKey);

  const exportList = selectedSite
    ? localResults.filter((r) => isResultMatchingSite(r, selectedSite))
    : localResults;

  if (exportList.length === 0) {
    alert(selectedSite ? `目标站点 [${selectedSite.name}] 没有可导出的结果` : '没有可导出的结果');
    return;
  }

  // 查找第一条有原始行数据的结果来确定导入格式
  const sampleResult = exportList.find((r) => r.originalRow && r.originalRow.length > 0) || localResults.find((r) => r.originalRow && r.originalRow.length > 0);
  if (!sampleResult) {
    alert('缺少导入数据，无法按原始格式导出');
    return;
  }

  const originalRowLen = getExportSourceColumnCount(sampleResult.originalRow);

  // 根据原始列数生成表头，并追加本次自动化现场采集的结果字段。
  const originalHeaders = [];
  for (let i = 0; i < originalRowLen; i++) {
    if (i === 0) originalHeaders.push('页面AS');
    else if (i === 1) originalHeaders.push('引荐URL');
    else if (i === 2) originalHeaders.push('引荐域名');
    else if (i === 3) originalHeaders.push('目标域名');
    else if (i === 4) originalHeaders.push('类型');
    else if (i === 5) originalHeaders.push('引荐页外链数量');
    else originalHeaders.push(`列${i + 1}`);
  }
  const resultHeaders = [
    '目标URL',
    '目标域名',
    '页面总高度(px)',
    '视口高度(px)',
    '页面总深度(屏)',
    '结果',
    '结果信息',
    'AI生成内容',
    '耗时(秒)',
    '执行时间',
    '运行结果'
  ];
  const header = [...originalHeaders, ...resultHeaders].join(',');

  const escape = (val) => {
    if (val == null) return '';
    const str = String(val);
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = exportList.map((r) => {
    // 基础列：从原始输入中取值，同时规范化引荐域名和目标域名。
    const baseCols = [];
    for (let i = 0; i < originalRowLen; i++) {
      const value = (i === 2 || i === 3) ? normalizeDomainForStats(r.originalRow[i]) : (r.originalRow[i] || '');
      baseCols.push(escape(value));
    }
    const metrics = r.pageMetrics || {};
    const runResult = getExportRunResult(r.result);
    const targetDomain = extractDomain(r.promotionSiteUrl || '');
    const resultCols = [
      escape(r.promotionSiteUrl || ''),
      escape(targetDomain),
      escape(metrics.documentHeightPx || ''),
      escape(metrics.viewportHeightPx || ''),
      escape(metrics.pageDepthScreens || ''),
      escape(getResultText(r.result)),
      escape(r.errorMessage || ''),
      escape(r.aiContent || ''),
      escape(r.elapsed != null ? r.elapsed : ''),
      escape(r.timestamp ? formatDateTime(new Date(r.timestamp)) : ''),
      escape(runResult)
    ];
    return [...baseCols, ...resultCols].join(',');
  });

  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const siteSuffix = selectedSite
    ? `_${(selectedSite.name || 'site').replace(/[^\w\u4e00-\u9fa5]/g, '_').slice(0, 20)}`
    : '';
  a.download = `batch_result${siteSuffix}_${batchId}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getExportSourceColumnCount(originalRow) {
  const len = originalRow.length;
  if (len <= 0) return 0;

  const lastValue = String(originalRow[len - 1] || '').trim();
  const knownResultValues = new Set(['1', '0', '√', '×', '需手动处理', '成功', '失败', '非法站点，已拦截']);
  if (knownResultValues.has(lastValue)) {
    const hasCurrentGeneratedResult = len >= 17
      && /^https?:\/\//i.test(String(originalRow[len - 11] || '').trim())
      && normalizeDomainForStats(originalRow[len - 10])
      && Number.isFinite(Number(originalRow[len - 9]))
      && Number.isFinite(Number(originalRow[len - 8]))
      && Number.isFinite(Number(originalRow[len - 7]));
    if (hasCurrentGeneratedResult) return len - 11;

    // 兼容上一版包含目标 URL 但尚未单独导出目标域名的结果格式。
    const hasCompleteGeneratedResult = len >= 16
      && /^https?:\/\//i.test(String(originalRow[len - 10] || '').trim())
      && Number.isFinite(Number(originalRow[len - 9]))
      && Number.isFinite(Number(originalRow[len - 8]))
      && Number.isFinite(Number(originalRow[len - 7]));
    if (hasCompleteGeneratedResult) return len - 10;

    // 兼容上一版仅包含网站、页面深度、时间和运行结果的导出格式。
    const hasLegacyGeneratedMetrics = len >= 12
      && /^https?:\/\//i.test(String(originalRow[len - 6] || '').trim())
      && Number.isFinite(Number(originalRow[len - 5]))
      && Number.isFinite(Number(originalRow[len - 4]))
      && Number.isFinite(Number(originalRow[len - 3]));
    if (hasLegacyGeneratedMetrics) return len - 6;
    return len - 1;
  }

  // 标准七列 CSV 的最后一列是待写入的运行结果，空值时不作为源数据列重复导出。
  if (len === 7 && !lastValue) return 6;

  return len;
}

function getExportRunResult(result) {
  return result === 'success' || result === 'skipped' ? '1' : '0';
}

function clearBatch() {
  resetFile();
  if (queueTransitionTimer) {
    clearTimeout(queueTransitionTimer);
    queueTransitionTimer = null;
  }
  isTransitioningQueue = false;
  batchTargetQueue = [];
  currentQueueSiteIndex = 0;
  batchId = null;
  totalCount = successCount = failCount = skippedCount = noCommentBoxCount = manualRequiredCount = blockedIllegalCount = unstartedCount = pendingCount = 0;
  currentIndex = 0;
  localResults = [];
  batchSourceName = '';
  batchSourceType = '';
  databaseFailedItemIndexes.clear();
  retryingItemIndexes.clear();
  batchStartedAt = null;
  batchCompletedAt = null;
  activeTabs.clear();
  activeTabsByIndex.clear();
  tabsPendingConfirm.clear();
  tabsWaitingClose.clear();
  isTerminated = false;
  isOpeningTab = false;
  isScheduling = false;
  statsTableBody.innerHTML = '';
  statsTotal.textContent = '0';
  statsSuccess.textContent = '0';
  statsSkipped.textContent = '0';
  if (statsManualRequired) statsManualRequired.textContent = '0';
  statsNoCommentBox.textContent = '0';
  if (statsBlockedIllegal) statsBlockedIllegal.textContent = '0';
  statsFail.textContent = '0';
  if (statsUnstarted) statsUnstarted.textContent = '0';
  statsRate.textContent = '—';
  statsPanel.classList.remove('visible');
  if (databasePersistence) {
    databasePersistence.className = 'database-persistence';
    if (databasePersistenceMessage) databasePersistenceMessage.textContent = '';
  }
  if (retryDatabaseBtn) {
    retryDatabaseBtn.style.display = 'none';
    retryDatabaseBtn.disabled = false;
  }
  if (retryAllFailedBtn) {
    retryAllFailedBtn.style.display = 'none';
    retryAllFailedBtn.disabled = false;
  }
  statsSelectedSiteKey = 'all';
  isSiteOverviewOpen = false;
  if (statsSiteNav) statsSiteNav.style.display = 'none';
  if (statsSiteTabs) statsSiteTabs.innerHTML = '';
  if (statsSiteOverviewWrap) statsSiteOverviewWrap.style.display = 'none';
  if (statsSiteOverviewBody) statsSiteOverviewBody.innerHTML = '';
  if (toggleSiteOverviewBtn) {
    toggleSiteOverviewBtn.style.display = 'none';
    toggleSiteOverviewBtn.textContent = '📊 目标站点汇总对比';
  }
  if (filterTargetSite) {
    filterTargetSite.style.display = 'none';
    filterTargetSite.innerHTML = '<option value="all">全部目标站点</option>';
  }
  if (statsScopeBadge) {
    statsScopeBadge.style.display = 'none';
    statsScopeBadge.textContent = '';
  }
  pendingRetryQueue = [];
  filterDomain.innerHTML = '<option value="all">全部引荐域名</option>';
  filterResult.value = 'all';
  filterTimeRange.value = 'all';
  if (filterPageDepth) filterPageDepth.value = 'all';
  filterKeyword.value = '';
  setStatus('idle');
  updateUI();
  chrome.storage.local.remove(['batchLocalResults', BATCH_SETTINGS_KEY, BATCH_URLS_KEY, 'batchCtx', 'batchSubmitCtx', 'batchSubmitCtxMap']);
}

// ==================== 统计面板 ====================

// 从 parsedUrls 找到对应行（用 data-url 属性查找）
function findPreviewRowByIndex(urlIndex) {
  const M = parsedUrls.length || 1;
  const actualIndex = urlIndex % M;
  const { url } = parsedUrls[actualIndex] || {};
  if (!url) return null;
  const rows = urlPreviewBody.querySelectorAll('tr');
  for (const row of rows) {
    if (row.dataset.url === url) return row;
  }
  return null;
}

function highlightPreviewRow(urlIndex, state) {
  const row = findPreviewRowByIndex(urlIndex);
  if (!row) return;
  row.classList.remove('url-processing', 'url-done-success', 'url-done-fail', 'url-done-skipped', 'url-done-blocked');
  if (state === 'processing') row.classList.add('url-processing');
  else if (state === 'success') row.classList.add('url-done-success');
  else if (state === 'fail') row.classList.add('url-done-fail');
  else if (state === 'skipped' || state === 'manual_required') row.classList.add('url-done-skipped');
  else if (state === 'blocked_illegal') row.classList.add('url-done-blocked');
}

function clearPreviewRow(urlIndex) {
  highlightPreviewRow(urlIndex, null);
}

function buildDomainOptions(results = localResults) {
  const domainMap = new Map();
  for (const r of results) {
    const domain = extractDomain(r.url);
    if (domain) domainMap.set(domain, (domainMap.get(domain) || 0) + 1);
  }
  const select = filterDomain;
  const prevVal = select.value;
  // 保留第一项 "全部引荐域名"
  select.innerHTML = '<option value="all">全部引荐域名</option>';
  for (const [domain, count] of [...domainMap.entries()].sort((a, b) => b[1] - a[1])) {
    const opt = document.createElement('option');
    opt.value = domain;
    opt.textContent = `${domain} (${count})`;
    select.appendChild(opt);
  }
  if (prevVal && domainMap.has(prevVal)) {
    select.value = prevVal;
  } else {
    select.value = 'all';
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function filterTimeBucket(elapsedSecs) {
  const sel = filterTimeRange.value;
  if (sel === 'all') return true;
  if (elapsedSecs == null) return sel === '60+';
  if (sel === '0-5') return elapsedSecs <= 5;
  if (sel === '5-15') return elapsedSecs > 5 && elapsedSecs <= 15;
  if (sel === '15-30') return elapsedSecs > 15 && elapsedSecs <= 30;
  if (sel === '30-60') return elapsedSecs > 30 && elapsedSecs <= 60;
  if (sel === '60+') return elapsedSecs > 60;
  return true;
}

function filterPageDepthBucket(pageMetrics) {
  if (!filterPageDepth || filterPageDepth.value === 'all') return true;
  const depth = Number(pageMetrics && pageMetrics.pageDepthScreens);
  if (!Number.isFinite(depth) || depth <= 0) return filterPageDepth.value === 'unknown';
  if (filterPageDepth.value === 'unknown') return false;
  if (filterPageDepth.value === '0-10') return depth <= 10;
  if (filterPageDepth.value === '10-20') return depth > 10 && depth <= 20;
  if (filterPageDepth.value === '20-40') return depth > 20 && depth <= 40;
  if (filterPageDepth.value === '40+') return depth > 40;
  return true;
}

const COPY_URL_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const COPIED_URL_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}

/**
 * 获取当前结果或队列中涉及的所有目标站点清单，并计算每个站点的统计数据。
 */
function getTargetSitesList() {
  const sitesList = [];
  const seenKeys = new Set();

  // 1. 优先使用当前批次的 batchTargetQueue 队列
  if (Array.isArray(batchTargetQueue) && batchTargetQueue.length > 0) {
    batchTargetQueue.forEach((s, idx) => {
      const key = (s.url || s.id || `site_${idx}`).trim();
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        sitesList.push({
          key,
          id: s.id || key,
          name: s.name || s.url || `目标站点 ${idx + 1}`,
          url: s.url || '',
          siteIndex: idx
        });
      }
    });
  }

  // 2. 检查 localResults 中实际包含的目标站点
  if (Array.isArray(localResults) && localResults.length > 0) {
    for (const r of localResults) {
      const siteUrl = (r.promotionSiteUrl || '').trim();
      const siteName = (r.promotionSiteName || '').trim();
      const siteId = (r.promotionSiteId || '').trim();
      const key = siteUrl || siteId || siteName;
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        let name = siteName;
        if (!name || name === siteUrl) {
          const found = availablePromotionSites.find((s) => (s.url && isSameTargetUrlForStats(s.url, siteUrl)) || (s.id && s.id === siteId));
          if (found && found.name) name = found.name;
        }
        sitesList.push({
          key,
          id: siteId || key,
          name: name || siteUrl || `目标站点 ${sitesList.length + 1}`,
          url: siteUrl,
          siteIndex: r.siteIndex != null ? r.siteIndex : sitesList.length
        });
      }
    }
  }

  // 3. 若仍为空且存在 batchPromotionSite 则兜底
  if (sitesList.length === 0 && batchPromotionSite && batchPromotionSite.url) {
    const key = batchPromotionSite.url.trim();
    sitesList.push({
      key,
      id: batchPromotionSite.id || key,
      name: batchPromotionSite.name || batchPromotionSite.url,
      url: batchPromotionSite.url,
      siteIndex: 0
    });
  }

  // 确保按 siteIndex 升序排序
  sitesList.sort((a, b) => (a.siteIndex ?? 0) - (b.siteIndex ?? 0));

  // 聚合各站点的指标
  return sitesList.map((site) => {
    const matched = localResults.filter((r) => isResultMatchingSite(r, site));
    const total = matched.length;
    const success = matched.filter((r) => r.result === 'success').length;
    const skipped = matched.filter((r) => r.result === 'skipped').length;
    const manualRequired = matched.filter((r) => r.result === 'manual_required').length;
    const noCommentBox = matched.filter((r) => r.result === 'no_comment_box').length;
    const blockedIllegal = matched.filter((r) => r.result === 'blocked_illegal').length;
    const fail = matched.filter((r) => r.result === 'fail').length;
    const unstarted = matched.filter((r) => r.result === 'unstarted').length;
    const executed = success + skipped + manualRequired + noCommentBox + blockedIllegal + fail;
    const validCount = success + skipped;
    const rateDenominator = executed > 0 ? executed : total;
    const rate = rateDenominator > 0 ? Math.round((validCount / rateDenominator) * 100) : 0;
    return {
      ...site,
      total,
      success,
      skipped,
      manualRequired,
      noCommentBox,
      blockedIllegal,
      fail,
      unstarted,
      executed,
      rate
    };
  });
}

function isResultMatchingSite(resultItem, site) {
  if (!resultItem || !site) return false;
  // 1. 若两端均存在明确的 siteIndex，以此为准
  if (resultItem.siteIndex != null && site.siteIndex != null) {
    return resultItem.siteIndex === site.siteIndex;
  }
  // 2. 若两端均存在明确的目标站点 ID，以此为准
  if (resultItem.promotionSiteId && site.id) {
    return resultItem.promotionSiteId === site.id;
  }
  // 3. 若存在目标 URL，按目标 URL 严格匹配
  if (resultItem.promotionSiteUrl && site.url) {
    return isSameTargetUrlForStats(resultItem.promotionSiteUrl, site.url);
  }
  // 4. 按目标名称匹配
  if (resultItem.promotionSiteName && site.name) {
    return resultItem.promotionSiteName.trim().toLowerCase() === site.name.trim().toLowerCase();
  }
  return false;
}

function renderStats() {
  if (localResults.length === 0) {
    statsPanel.classList.remove('visible');
    return;
  }
  statsPanel.classList.add('visible');

  const targetSites = getTargetSitesList();
  const hasMultipleSites = targetSites.length > 1;

  // 校验当前选中的目标站点 key 是否有效
  if (statsSelectedSiteKey !== 'all') {
    const exists = targetSites.some((s) => s.key === statsSelectedSiteKey);
    if (!exists) statsSelectedSiteKey = 'all';
  }

  // 渲染多目标站点导航和汇总对比
  if (hasMultipleSites) {
    if (statsSiteNav) statsSiteNav.style.display = 'flex';
    if (toggleSiteOverviewBtn) toggleSiteOverviewBtn.style.display = 'inline-flex';
    if (filterTargetSite) filterTargetSite.style.display = 'inline-block';
    if (statsScopeBadge) statsScopeBadge.style.display = 'inline-flex';

    // 渲染站点 Tab 导航栏
    if (statsSiteTabs) {
      const overallTotal = localResults.length;
      const overallSuccess = localResults.filter((r) => r.result === 'success').length;
      const overallSkipped = localResults.filter((r) => r.result === 'skipped').length;
      const overallUnstarted = localResults.filter((r) => r.result === 'unstarted').length;
      const overallExecuted = overallTotal - overallUnstarted;
      const overallRateDenominator = overallExecuted > 0 ? overallExecuted : overallTotal;
      const overallRate = overallRateDenominator > 0 ? Math.round(((overallSuccess + overallSkipped) / overallRateDenominator) * 100) : 0;

      let tabsHtml = `
        <button type="button" class="stats-site-tab ${statsSelectedSiteKey === 'all' ? 'active' : ''}" data-site-key="all">
          <span class="tab-title">全部目标站点</span>
          <span class="tab-badge">${overallTotal} 条 · ${overallExecuted > 0 ? overallRate + '%' : '—'}</span>
        </button>
      `;

      for (const s of targetSites) {
        const rateClass = s.rate >= 70 ? 'badge-high' : (s.rate >= 30 ? 'badge-mid' : 'badge-low');
        tabsHtml += `
          <button type="button" class="stats-site-tab ${statsSelectedSiteKey === s.key ? 'active' : ''}" data-site-key="${escapeHtml(s.key)}" title="${escapeHtml(s.url || s.name)}">
            <span class="step-num">${s.siteIndex + 1}</span>
            <span class="tab-title">${escapeHtml(s.name)}</span>
            <span class="tab-badge ${rateClass}">${s.total} 条 · ${s.executed > 0 ? s.rate + '%' : '—'}</span>
          </button>
        `;
      }
      statsSiteTabs.innerHTML = tabsHtml;

      statsSiteTabs.querySelectorAll('.stats-site-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          const key = tab.getAttribute('data-site-key') || 'all';
          statsSelectedSiteKey = key;
          renderStats();
        });
      });
    }

    // 同步筛选栏的目标站点下拉框
    if (filterTargetSite) {
      let optionsHtml = `<option value="all">全部目标站点 (共 ${targetSites.length} 个站点)</option>`;
      for (const s of targetSites) {
        optionsHtml += `<option value="${escapeHtml(s.key)}">[${s.siteIndex + 1}] ${escapeHtml(s.name)} (${s.total} 条 · 成功率 ${s.executed > 0 ? s.rate + '%' : '—'})</option>`;
      }
      filterTargetSite.innerHTML = optionsHtml;
      filterTargetSite.value = statsSelectedSiteKey;
    }

    // 渲染各站点统计对比汇总表
    if (statsSiteOverviewBody) {
      let overviewRowsHtml = '';
      for (const s of targetSites) {
        const isCurrent = statsSelectedSiteKey === s.key;
        const rateClass = s.rate >= 70 ? 'badge-high' : (s.rate >= 30 ? 'badge-mid' : 'badge-low');
        overviewRowsHtml += `
          <tr class="${isCurrent ? 'current-site-row' : ''}">
            <td style="text-align:center;color:#64748b;font-weight:600;">${s.siteIndex + 1}</td>
            <td style="font-weight:600;color:#1e293b;">${escapeHtml(s.name)}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(s.url)}">
              <span style="color:#64748b;font-size:11px;">${escapeHtml(s.url || '—')}</span>
            </td>
            <td style="text-align:center;font-weight:700;">${s.total}</td>
            <td style="text-align:center;color:#059669;font-weight:700;">${s.success}</td>
            <td style="text-align:center;color:#2563eb;">${s.skipped}</td>
            <td style="text-align:center;color:#b45309;">${s.manualRequired}</td>
            <td style="text-align:center;color:#d97706;">${s.noCommentBox}</td>
            <td style="text-align:center;color:#e11d48;">${s.blockedIllegal}</td>
            <td style="text-align:center;color:#dc2626;font-weight:700;">${s.fail}</td>
            <td style="text-align:center;color:#64748b;font-weight:600;">${s.unstarted}</td>
            <td style="text-align:center;">
              <span class="tab-badge ${rateClass}" style="display:inline-block;padding:2px 6px;">${s.executed > 0 ? s.rate + '%' : '—'}</span>
            </td>
            <td style="text-align:center;white-space:nowrap;">
              <button type="button" class="site-action-btn view-site-detail-btn" data-site-key="${escapeHtml(s.key)}">查看此站点</button>
            </td>
          </tr>
        `;
      }
      statsSiteOverviewBody.innerHTML = overviewRowsHtml;

      statsSiteOverviewBody.querySelectorAll('.view-site-detail-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.getAttribute('data-site-key') || 'all';
          statsSelectedSiteKey = key;
          renderStats();
          if (statsTableWrap) statsTableWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    }

    // 更新作用域徽标
    if (statsScopeBadge) {
      if (statsSelectedSiteKey === 'all') {
        statsScopeBadge.textContent = `全部目标站点 (共 ${targetSites.length} 个站点)`;
      } else {
        const curr = targetSites.find((s) => s.key === statsSelectedSiteKey);
        statsScopeBadge.textContent = curr ? `当前站点：[${curr.siteIndex + 1}] ${curr.name}` : '';
      }
    }
  } else {
    if (statsSiteNav) statsSiteNav.style.display = 'none';
    if (toggleSiteOverviewBtn) toggleSiteOverviewBtn.style.display = 'none';
    if (statsSiteOverviewWrap) statsSiteOverviewWrap.style.display = 'none';
    if (filterTargetSite) filterTargetSite.style.display = 'none';
    if (statsScopeBadge) statsScopeBadge.style.display = 'none';
  }

  // 根据当前选中的目标站点，确定本次统计卡片与明细表格的数据集
  const selectedSite = statsSelectedSiteKey === 'all'
    ? null
    : targetSites.find((s) => s.key === statsSelectedSiteKey);

  const siteResults = selectedSite
    ? localResults.filter((r) => isResultMatchingSite(r, selectedSite))
    : localResults;

  // 统计卡片：严格依据当前站点数据集计算
  const total = siteResults.length;
  const success = siteResults.filter((r) => r.result === 'success').length;
  const skipped = siteResults.filter((r) => r.result === 'skipped').length;
  const manualRequired = siteResults.filter((r) => r.result === 'manual_required').length;
  const noCommentBox = siteResults.filter((r) => r.result === 'no_comment_box').length;
  const blockedIllegal = siteResults.filter((r) => r.result === 'blocked_illegal').length;
  const fail = siteResults.filter((r) => r.result === 'fail').length;
  const unstarted = siteResults.filter((r) => r.result === 'unstarted').length;
  const executed = success + skipped + manualRequired + noCommentBox + blockedIllegal + fail;

  statsTotal.textContent = total;
  statsSuccess.textContent = success;
  statsSkipped.textContent = skipped;
  if (statsManualRequired) statsManualRequired.textContent = manualRequired;
  statsNoCommentBox.textContent = noCommentBox;
  if (statsBlockedIllegal) statsBlockedIllegal.textContent = blockedIllegal;
  statsFail.textContent = fail;
  if (statsUnstarted) statsUnstarted.textContent = unstarted;

  // 成功率计算：如果存在未开始，依据已执行量计算成功率，更加贴合现场
  const validCount = success + skipped;
  const rateDenominator = executed > 0 ? executed : total;
  const successRate = rateDenominator > 0 ? Math.round((validCount / rateDenominator) * 100) : 0;
  statsRate.textContent = executed > 0 ? `${successRate}%` : '—';
  statsRate.title = unstarted > 0
    ? `已执行 ${executed}/${total} 条，成功率 ${successRate}%（未开始 ${unstarted} 条）`
    : `全部 ${total} 条已执行完毕，成功率 ${successRate}%`;

  // 智能重试与未开始执行按钮文案与状态联动
  const retryableCount = fail + unstarted;
  if (retryAllFailedBtn) {
    if (retryableCount > 0) {
      retryAllFailedBtn.style.display = 'inline-flex';
      const isRetrying = status === 'running' && (pendingRetryQueue.length > 0 || retryingItemIndexes.size > 0);
      let btnText;
      if (fail > 0 && unstarted > 0) {
        btnText = selectedSite ? `🔄 重试当前站点失败与未开始 (${retryableCount})` : `🔄 重试所有失败与未开始 (${retryableCount})`;
      } else if (unstarted > 0) {
        btnText = selectedSite ? `▶️ 执行当前站点未开始项 (${unstarted})` : `▶️ 执行所有未开始项 (${unstarted})`;
      } else {
        btnText = selectedSite ? `🔄 重试当前站点失败 (${fail})` : `🔄 重试所有失败 (${fail})`;
      }

      if (isRetrying) {
        retryAllFailedBtn.disabled = true;
        const count = retryingItemIndexes.size > 0 ? retryingItemIndexes.size : retryableCount;
        retryAllFailedBtn.textContent = `🔄 正在执行中 (${count} 条)...`;
      } else if (status === 'running') {
        retryAllFailedBtn.disabled = true;
        retryAllFailedBtn.textContent = btnText;
      } else {
        retryAllFailedBtn.disabled = false;
        retryAllFailedBtn.textContent = btnText;
      }
    } else {
      retryAllFailedBtn.style.display = 'none';
    }
  }

  // 引荐域名下拉根据当前查看的数据集动态建立
  buildDomainOptions(siteResults);

  const resultFilter = filterResult.value;
  const domainFilter = filterDomain.value;
  const kw = filterKeyword.value.trim().toLowerCase();

  const filtered = siteResults.filter((r) => {
    if (resultFilter !== 'all' && r.result !== resultFilter) return false;
    if (domainFilter !== 'all' && extractDomain(r.url) !== domainFilter) return false;
    if (!filterTimeBucket(r.elapsed)) return false;
    if (!filterPageDepthBucket(r.pageMetrics)) return false;
    if (kw) {
      const haystack = (r.url + ' ' + (r.promotionSiteUrl || '') + ' ' + (r.promotionSiteName || '') + ' ' + (r.aiContent || '') + ' ' + (r.errorMessage || '')).toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });

  statsCountLabel.textContent = selectedSite
    ? `显示 ${filtered.length} / ${total} 条（总计 ${localResults.length} 条）`
    : `显示 ${filtered.length} / ${total} 条`;

  // 渲染表格（只重建 DOM，不重新请求）
  statsTableBody.innerHTML = '';
  for (const r of filtered) {
    const tr = document.createElement('tr');
    tr.className = 'url-' + r.result;

    const elapsedStr = r.elapsed != null ? r.elapsed + 's' : '—';
    const timeStr = r.timestamp ? formatDateTime(new Date(r.timestamp)) : '—';
    const shortUrl = r.url.length > 40 ? r.url.substring(0, 37) + '…' : r.url;
    const promotionSiteUrl = r.promotionSiteUrl || '—';
    const shortPromotionSiteUrl = promotionSiteUrl.length > 42
      ? promotionSiteUrl.substring(0, 39) + '…'
      : promotionSiteUrl;
    const pageDepth = Number(r.pageMetrics && r.pageMetrics.pageDepthScreens);
    const pageDepthStr = Number.isFinite(pageDepth) && pageDepth > 0 ? `${pageDepth} 屏` : '—';
    const pageDepthTitle = Number.isFinite(pageDepth) && pageDepth > 0
      ? `页面高度 ${r.pageMetrics.documentHeightPx || 0}px，视口高度 ${r.pageMetrics.viewportHeightPx || 0}px`
      : '未采集到页面深度';

    const aiCell = document.createElement('td');
    if (r.aiContent) {
      aiCell.className = 'ai-content-cell';
      aiCell.textContent = r.aiContent;
      aiCell.title = r.aiContent;
      aiCell.addEventListener('click', () => {
        aiCell.classList.toggle('expanded');
      });
    } else {
      aiCell.textContent = '—';
      aiCell.style.color = '#d1d5db';
    }

    const displayIndex = selectedSite && r.urlIndexInSite != null
      ? (r.urlIndexInSite + 1)
      : (r.originalIndex + 1);
    const indexTooltip = selectedSite && r.urlIndexInSite != null
      ? `站点内序号: #${r.urlIndexInSite + 1} (全局序号: #${r.originalIndex + 1})`
      : `全局序号: #${r.originalIndex + 1}`;

    tr.innerHTML = `
      <td style="color:#9ca3af;width:40px;text-align:center;" title="${indexTooltip}">${displayIndex}</td>
      <td title="${escapeHtml(r.url)}">
        <div class="target-url-cell">
          <span class="target-url-text">${escapeHtml(shortUrl)}</span>
          <button type="button" class="copy-url-btn" title="复制引荐 URL" aria-label="复制引荐 URL">${COPY_URL_ICON_SVG}</button>
          <button type="button" class="open-url-btn" title="在新标签页打开引荐 URL" aria-label="在新标签页打开引荐 URL">↗</button>
        </div>
      </td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(promotionSiteUrl)}">${escapeHtml(shortPromotionSiteUrl)}</td>
      <td style="white-space:nowrap;" title="${escapeHtml(pageDepthTitle)}">${pageDepthStr}</td>
      <td><span class="result-badge ${r.result}">${getResultText(r.result)}</span></td>
    `;
    tr.className = `url-${r.result}`;

    const copyUrlButton = tr.querySelector('.copy-url-btn');
    if (copyUrlButton) {
      copyUrlButton.addEventListener('click', async () => {
        const ok = await copyTextToClipboard(r.url);
        if (ok) {
          copyUrlButton.classList.add('copied');
          copyUrlButton.title = '已复制 URL！';
          copyUrlButton.innerHTML = COPIED_URL_ICON_SVG;
          setTimeout(() => {
            copyUrlButton.classList.remove('copied');
            copyUrlButton.title = '复制引荐 URL';
            copyUrlButton.innerHTML = COPY_URL_ICON_SVG;
          }, 1500);
        }
      });
    }

    const openUrlButton = tr.querySelector('.open-url-btn');
    if (openUrlButton) {
      openUrlButton.addEventListener('click', () => {
        clearBatchSubmitStorageForUrl(r.url);
        chrome.tabs.create({ url: r.url, active: true });
      });
    }

    const errCell = document.createElement('td');
    if (r.errorMessage) {
      errCell.className = 'error-cell';
      errCell.textContent = r.errorMessage;
      errCell.title = r.errorMessage;
    } else {
      errCell.textContent = '—';
      errCell.style.color = '#d1d5db';
    }
    tr.appendChild(errCell);
    tr.appendChild(aiCell);

    // 不能使用 innerHTML += 追加单元格，否则浏览器会重建整行 DOM，导致打开链接和 AI 内容展开事件丢失。
    const elapsedCell = document.createElement('td');
    elapsedCell.style.fontSize = '11px';
    elapsedCell.style.color = '#9ca3af';
    elapsedCell.style.whiteSpace = 'nowrap';
    elapsedCell.textContent = elapsedStr;
    tr.appendChild(elapsedCell);

    const timeCell = document.createElement('td');
    timeCell.style.fontSize = '11px';
    timeCell.style.color = '#9ca3af';
    timeCell.style.whiteSpace = 'nowrap';
    timeCell.textContent = timeStr;
    tr.appendChild(timeCell);

    const actionCell = document.createElement('td');
    actionCell.style.whiteSpace = 'nowrap';
    actionCell.style.textAlign = 'center';

    const isRetrying = retryingItemIndexes.has(r.originalIndex);
    const isRetryable = true;

    const isUnstarted = r.result === 'unstarted';

    if (isRetrying) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn-retry-row retrying';
      retryBtn.disabled = true;
      retryBtn.textContent = isUnstarted ? '执行中…' : '重试中…';
      actionCell.appendChild(retryBtn);
    } else if (isRetryable) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn-retry-row';
      retryBtn.title = isUnstarted ? '执行此任务并更新当前批次结果' : '重试此记录并更新当前批次结果';
      retryBtn.textContent = isUnstarted ? '执行' : '重试';
      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        retrySingleRow(r.originalIndex);
      });
      actionCell.appendChild(retryBtn);
    } else {
      actionCell.textContent = '—';
      actionCell.style.color = '#d1d5db';
    }
    tr.appendChild(actionCell);

    statsTableBody.appendChild(tr);
  }

  // 滚动到最新
  statsTableWrap.scrollTop = 0;
}

/**
 * 针对单条失败记录进行就地重试，执行结果实时更新当前批次及数据库。
 */
async function retrySingleRow(urlIndex) {
  console.log('[batch] retrySingleRow 开始:', { urlIndex, status, batchId });

  if (retryingItemIndexes.has(urlIndex) || activeTabsByIndex.has(urlIndex)) {
    console.warn('[batch] 该项目正在处理或重试中，忽略重复点击:', urlIndex);
    return;
  }

  const existingResult = localResults.find((r) => r.originalIndex === urlIndex);
  if (!existingResult) {
    console.warn('[batch] 未找到索引对应的结果记录:', urlIndex);
    return;
  }

  const task = getBatchTaskInfo(urlIndex);
  let targetSiteForTask = null;
  if (task && task.site && task.site.url) {
    targetSiteForTask = normalizeBatchPromotionSite(task.site);
    if (task.siteIndex != null) {
      currentQueueSiteIndex = task.siteIndex;
    }
  } else if (existingResult.promotionSiteUrl) {
    targetSiteForTask = normalizeBatchPromotionSite({
      id: existingResult.promotionSiteId || 'retry_target',
      name: existingResult.promotionSiteName || '重试目标',
      url: existingResult.promotionSiteUrl,
      content: ''
    });
  } else if (batchPromotionSite && batchPromotionSite.url) {
    targetSiteForTask = normalizeBatchPromotionSite(batchPromotionSite);
  } else {
    const site = getSelectedBatchPromotionSite();
    if (site && site.url) {
      targetSiteForTask = normalizeBatchPromotionSite(site);
    }
  }

  if (!targetSiteForTask || !targetSiteForTask.url) {
    alert('重试失败：缺少目标 URL 配置，请先选择目标 URL。');
    return;
  }
  batchPromotionSite = targetSiteForTask;

  const M = parsedUrls.length || 1;
  const urlIndexInSite = task ? task.urlIndexInSite : (existingResult.urlIndexInSite != null ? existingResult.urlIndexInSite : (urlIndex % M));
  const siteIndex = task ? task.siteIndex : (existingResult.siteIndex != null ? existingResult.siteIndex : currentQueueSiteIndex);

  let item = (task && task.item) || parsedUrls[urlIndexInSite];
  if (!item) {
    item = {
      originalIndex: urlIndexInSite,
      url: existingResult.url,
      sourceDomain: existingResult.sourceDomain || extractDomain(existingResult.url),
      originalRow: existingResult.originalRow || []
    };
    parsedUrls[urlIndexInSite] = item;
  }

  if (!batchId) {
    batchId = generateUUID();
    batchStartedAt = Date.now();
  }

  await saveBatchTaskSettings();

  retryingItemIndexes.add(urlIndex);
  renderStats();

  const illegalCheck = item.illegalCheck || evaluateIllegalSiteForBatchItem(item.url, item.sourceDomain);
  if (illegalCheck.blocked) {
    console.warn('[batch] 重试命中非法网站规则，拦截:', { urlIndex, url: item.url });
    item.illegalCheck = illegalCheck;
    retryingItemIndexes.delete(urlIndex);
    handleTabResult(urlIndex, 'blocked_illegal', null, getIllegalSiteBlockMessage(illegalCheck), 0);
    return;
  }

  try {
    chrome.tabs.create({ url: item.url, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        retryingItemIndexes.delete(urlIndex);
        renderStats();
        console.error('[batch] 重试打开标签页失败:', chrome.runtime.lastError);
        alert('无法打开新标签页进行重试');
        return;
      }

      activeTabCount++;
      const startTime = Date.now();
      activeTabs.set(tab.id, { urlIndex, urlIndexInSite, siteIndex, startTime });
      activeTabsByIndex.set(urlIndex, { urlIndex, urlIndexInSite, siteIndex, startTime });

      highlightPreviewRow(urlIndexInSite, 'processing');
      startTimeoutChecker();

      // 监听标签页关闭
      const listener = (tabId, removeInfo) => {
        if (tabId === tab.id) {
          const tabStartTime = activeTabs.get(tab.id)?.startTime || startTime;
          activeTabs.delete(tab.id);
          activeTabsByIndex.delete(urlIndex);
          retryingItemIndexes.delete(urlIndex);
          activeTabCount = Math.max(0, activeTabCount - 1);
          chrome.tabs.onRemoved.removeListener(listener);

          console.log('[batch] 重试标签页关闭:', { tabId, urlIndex, activeTabCount });

          const checkAndRecord = async () => {
            const currentEntry = localResults.find((r) => r.originalIndex === urlIndex);
            const isFresh = currentEntry && currentEntry.timestamp >= startTime;
            if (!isFresh) {
              await new Promise((r) => setTimeout(r, 400));
              const currentEntry2 = localResults.find((r) => r.originalIndex === urlIndex);
              if (currentEntry2 && currentEntry2.timestamp >= startTime) {
                clearPreviewRow(urlIndexInSite);
                updateStatsUI();
                renderStats();
                return;
              }

              const stored = await new Promise((resolve) => {
                chrome.storage.local.get(['batchResults'], (d) => resolve(d && d.batchResults));
              });
              const match = Array.isArray(stored) && stored.find((it) => it.batchId === batchId && it.urlIndex === urlIndex);
              if (match && match.timestamp >= startTime) {
                console.log('[batch] 重试标签关闭后从 storage 恢复匹配结果:', match);
                handleTabResult(urlIndex, match.result, match.aiContent, match.errorMessage, undefined, match);
                clearPreviewRow(urlIndexInSite);
                updateStatsUI();
                renderStats();
                return;
              }

              console.log('[batch] 重试标签关闭但无新结果，更新为失败:', urlIndex);
              const elapsed = Math.round((Date.now() - tabStartTime) / 1000);
              handleTabResult(urlIndex, 'fail', null, '用户手动关闭', elapsed);
            } else {
              console.log('[batch] 重试标签关闭已有新结果:', urlIndex);
            }
            clearPreviewRow(urlIndexInSite);
            updateStatsUI();
            renderStats();
          };

          checkAndRecord();
        }
      };
      chrome.tabs.onRemoved.addListener(listener);

      function sendWhenReady(tabId, retries = 0) {
        if (!activeTabs.has(tabId)) {
          console.log('[batch] retry sendWhenReady 停止：标签页已关闭', { tabId, urlIndex });
          retryingItemIndexes.delete(urlIndex);
          renderStats();
          return;
        }
        if (retries > 60) {
          console.warn('[batch] 重试 content.js 就绪超时, tabId:', tabId);
          retryingItemIndexes.delete(urlIndex);
          handleTabResult(urlIndex, 'fail', null, '页面脚本注入就绪超时');
          try {
            chrome.tabs.remove(tabId, () => {});
          } catch (_) {}
          return;
        }
        chrome.tabs.sendMessage(tabId, { type: 'PING' }, { frameId: 0 }).then(() => {
          const isDebug = batchDebugMode ? batchDebugMode.checked : false;
          const presetComment = isDebug ? resolveDebugCommentText(targetSiteForTask) : '';

          console.log('[batch] 重试 content.js 已就绪，发送 BATCH_HANDLE → tabId:', tab.id, { batchId, urlIndex, url: item.url });
          chrome.tabs.sendMessage(tab.id, {
            type: 'BATCH_HANDLE',
            batchId,
            urlIndex,
            url: item.url,
            promotionSite: normalizeBatchPromotionSite(targetSiteForTask),
            debugMode: isDebug,
            presetComment: presetComment,
            forceRetry: true
          }, { frameId: 0 }).then((response) => {
            console.log('[batch] 重试收到 content.js 响应:', response, 'tabId:', tab.id);
            if (response && response.ok) {
              tabsPendingConfirm.set(tab.id, { urlIndex });
              tabsWaitingClose.add(tab.id);
            }
          }).catch(async (err) => {
            console.warn('[batch] 重试 sendMessage BATCH_HANDLE 失败:', err.message || err);
            await new Promise((r) => setTimeout(r, 800));
            const currentEntry = localResults.find((r) => r.originalIndex === urlIndex);
            if (!currentEntry || currentEntry.timestamp < startTime) {
              const stored = await new Promise((resolve) => {
                chrome.storage.local.get(['batchResults'], (d) => resolve(d && d.batchResults));
              });
              const match = Array.isArray(stored) && stored.find((it) => it.batchId === batchId && it.urlIndex === urlIndex);
              if (match && match.timestamp >= startTime) {
                handleTabResult(urlIndex, match.result, match.aiContent, match.errorMessage, undefined, match);
                try { chrome.tabs.remove(tab.id, () => {}); } catch (_) {}
                return;
              }
              handleTabResult(urlIndex, 'fail', null, '消息发送失败：' + (err.message || '标签页可能已关闭'));
            }
          });
        }).catch(() => {
          setTimeout(() => sendWhenReady(tabId, retries + 1), 500);
        });
      }

      sendWhenReady(tab.id);
    });
  } catch (e) {
    retryingItemIndexes.delete(urlIndex);
    renderStats();
    console.error('[batch] retrySingleRow 异常:', e);
    alert('重试执行发生异常：' + (e.message || e));
  }
}

/**
 * 一键重试当前批次中所有执行失败的记录。
 * 按照用户设置的并发数和超时参数，加入并发调度池执行。
 */
async function retryAllFailed() {
  console.log('[batch] retryAllFailed 开始:', { status, batchId, statsSelectedSiteKey });

  if (status === 'running') {
    alert('当前批量任务正在运行中，请等待完成或终止后再重试。');
    return;
  }

  const targetSites = getTargetSitesList();
  const selectedSite = statsSelectedSiteKey === 'all'
    ? null
    : targetSites.find((s) => s.key === statsSelectedSiteKey);

  const candidateResults = selectedSite
    ? localResults.filter((r) => isResultMatchingSite(r, selectedSite))
    : localResults;

  const retryableItems = candidateResults.filter((r) => r.result === 'fail' || r.result === 'unstarted');
  if (retryableItems.length === 0) {
    alert(selectedSite ? `目标站点 [${selectedSite.name}] 当前没有失败或未开始的项目需要执行。` : '当前没有失败或未开始的项目需要执行。');
    return;
  }

  if (batchTargetQueue.length === 0 && targetSites.length > 0) {
    batchTargetQueue = targetSites.map(normalizeBatchPromotionSite);
  }

  if (selectedSite) {
    batchPromotionSite = normalizeBatchPromotionSite(selectedSite);
    const siteIdx = batchTargetQueue.findIndex((s) => s.url === selectedSite.url || (s.id && s.id === selectedSite.id));
    if (siteIdx !== -1) {
      currentQueueSiteIndex = siteIdx;
    }
  } else if (!batchPromotionSite || !batchPromotionSite.url) {
    const site = getSelectedBatchPromotionSite();
    if (site && site.url) {
      batchPromotionSite = normalizeBatchPromotionSite(site);
    } else {
      const sampleWithSite = localResults.find((r) => r.promotionSiteUrl);
      if (sampleWithSite) {
        batchPromotionSite = normalizeBatchPromotionSite({
          id: sampleWithSite.promotionSiteId || 'retry_target',
          name: sampleWithSite.promotionSiteName || '重试目标',
          url: sampleWithSite.promotionSiteUrl,
          content: ''
        });
      }
    }
  }

  if (!batchPromotionSite || !batchPromotionSite.url) {
    alert('重试失败：缺少目标 URL 配置，请先选择目标 URL。');
    return;
  }

  const shouldContinue = await confirmDatabaseAvailabilityBeforeStart();
  if (!shouldContinue) return;

  await new Promise((resolve) => {
    chrome.storage.local.remove(['batchCtx', 'batchSubmitCtx', 'batchSubmitCtxMap'], resolve);
  });

  const M = parsedUrls.length || 1;
  // 保证 parsedUrls 中包含待重试项目的信息
  for (const r of retryableItems) {
    const urlIdxInSite = r.urlIndexInSite != null ? r.urlIndexInSite : (r.originalIndex % M);
    if (!parsedUrls[urlIdxInSite]) {
      parsedUrls[urlIdxInSite] = {
        originalIndex: urlIdxInSite,
        url: r.url,
        sourceDomain: r.sourceDomain || extractDomain(r.url),
        originalRow: r.originalRow || []
      };
    }
  }

  if (!batchId) {
    batchId = generateUUID();
    batchStartedAt = Date.now();
  }

  await saveBatchTaskSettings();

  isTerminated = false;
  pendingRetryQueue = retryableItems.map((r) => r.originalIndex).sort((a, b) => a - b);
  currentIndex = Math.max(currentIndex, totalCount);

  for (const idx of pendingRetryQueue) {
    retryingItemIndexes.add(idx);
    timeoutRetryMap.delete(idx);
    const task = getBatchTaskInfo(idx);
    const previewIdx = task ? task.urlIndexInSite : (idx % M);
    highlightPreviewRow(previewIdx, 'pending');
  }

  const firstTask = getBatchTaskInfo(pendingRetryQueue[0]);
  if (firstTask && firstTask.site) {
    currentQueueSiteIndex = firstTask.siteIndex;
    batchPromotionSite = normalizeBatchPromotionSite(firstTask.site);
    updateBatchPromotionSiteSummary();
    updateQueueBanner();
  }

  setStatus('running');
  updateUI();
  updateStatsUI();
  renderStats();

  await saveCurrentBatchHistory('pending');
  persistLocalDatabaseRunStart();

  scheduleNextTabs();
}

// ==================== 表单处理函数 ====================

/**
 * 在指定表单中查找评论相关元素
 * @param {HTMLFormElement} form - 要搜索的表单元素
 * @returns {Object} 包含表单统计和评论 textarea 的对象
 */
function findCommentForm(form) {
  if (!form) {
    console.log('[batch] findCommentForm: 表单为空');
    return { success: false, missingFields: ['form not found'] };
  }

  console.log('[batch] findCommentForm 最终使用的表单:', {
    id: form.id,
    className: form.className,
    action: form.action
  });

  // ── 步骤1：统计表单中所有输入框（用于日志）───────────────
  const formAllInputs = Array.from(form.querySelectorAll('input'));
  const formTextareas = Array.from(form.querySelectorAll('textarea'));
  console.log('[batch] 表单中的 input 数量:', formAllInputs.length, 'textarea 数量:', formTextareas.length);
  console.log('[batch] 表单中所有 input:', formAllInputs.map(i => ({
    name: i.name, id: i.id, type: i.type, className: i.className,
    placeholder: i.placeholder, valueLen: (i.value || '').length
  })));

  // ── 步骤2：找评论 textarea ───────────────────────────────
  let commentTextarea = null;
  if (formTextareas.length > 0) {
    // 优先找有 comment 关键词的
    commentTextarea = formTextareas.find(ta => {
      const n = (ta.name || '').toLowerCase();
      const i = (ta.id || '').toLowerCase();
      return n.includes('comment') || i.includes('comment');
    }) || formTextareas[0];
  }
  if (!commentTextarea) {
    // 再从全局找并验证属于当前表单
    const ta = findLikelyCommentTextarea({ allowGenericFallback: true });
    if (ta && (ta.form === form || (ta.closest && ta.closest('form') === form))) {
      commentTextarea = ta;
    }
  }

  if (!commentTextarea) {
    console.log('[batch] 未找到评论 textarea!');
    return { success: false, missingFields: ['comment textarea not found'] };
  }

  return {
    success: true,
    form: form,
    commentTextarea: commentTextarea,
    formAllInputs: formAllInputs,
    formTextareas: formTextareas
  };
}

/**
 * 全局查找可能的评论 textarea
 * @param {Object} options - 选项
 * @param {boolean} options.allowGenericFallback - 是否允许通用回退
 * @returns {Element|null} 评论 textarea 元素
 */
function findLikelyCommentTextarea(options) {
  const allowGenericFallback = options && options.allowGenericFallback;
  const allTextareas = Array.from(document.querySelectorAll('textarea'));
  if (allTextareas.length === 0) return null;

  const commentTextareas = [];

  // 方法1: 通过标准的 WordPress/comment 选择器直接查找
  const standardSelectors = [
    '#comment',
    'textarea[name="comment"]',
    'textarea#comment',
    'textarea[id="comment"]',
    'textarea[name="comment_content"]',
    'textarea[id="comment_content"]',
    'textarea[name="comments"]',
    'textarea#comments'
  ];

  for (const selector of standardSelectors) {
    try {
      const ta = document.querySelector(selector);
      if (ta && !commentTextareas.includes(ta)) {
        commentTextareas.push(ta);
      }
    } catch (e) {
      // 忽略无效选择器
    }
  }

  // 方法2: 通过关键词匹配
  if (commentTextareas.length === 0) {
    allTextareas.forEach((ta) => {
      if (commentTextareas.includes(ta)) return;

      const name = (ta.name || '').toLowerCase();
      const id = (ta.id || '').toLowerCase();
      const placeholder = (ta.placeholder || '').toLowerCase();
      const ariaLabel = (ta.getAttribute('aria-label') || '').toLowerCase();
      const text = `${name} ${id} ${placeholder} ${ariaLabel}`;

      const keywords = [
        'comment', 'reply', 'message', 'review', 'feedback', 'opinion',
        '留言', '评论', '回复', '响应',
        'leave a comment', 'write a comment', 'post a comment',
        'cancel reply', 'enter your comment', 'type here'
      ];

      if (keywords.some((k) => text.includes(k))) {
        commentTextareas.push(ta);
      }
    });
  }

  // 通用回退：返回第一个 textarea
  if (commentTextareas.length === 0 && allowGenericFallback && allTextareas.length > 0) {
    return allTextareas[0];
  }

  return commentTextareas.length > 0 ? commentTextareas[0] : null;
}

// ==================== 工具函数 ====================
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getResultText(result) {
  switch (result) {
    case 'success': return '成功';
    case 'skipped': return '已存在';
    case 'manual_required': return '需手动处理';
    case 'no_comment_box': return '无评论框';
    case 'blocked_illegal': return '非法拦截';
    case 'unstarted': return '未开始';
    case 'fail': return '失败';
    default: return result;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDateTime(date) {
  const y = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${month}-${day} ${h}:${m}:${s}`;
}

function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

})();
