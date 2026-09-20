const WEBSITE_URL_STORAGE_KEY = 'promotion_website_url';
const WEBSITE_CONTENT_STORAGE_KEY = 'promotion_website_content';
const SITES_CONFIG_STORAGE_KEY = 'promotion_sites_config';
const USER_NAME_STORAGE_KEY = 'auto_fill_user_name';
const USER_EMAIL_STORAGE_KEY = 'auto_fill_user_email';
const USER_PASSWORD_STORAGE_KEY = 'auto_fill_user_password';
const LEGACY_SKILL_TEMPLATE_STORAGE_KEY = 'qwen_skill_template';
const LEGACY_PROMPT_FIELD_VALUES_STORAGE_KEY = 'auto_fill_prompt_field_values';
const SHOW_PAGE_FLOATING_BUTTONS_STORAGE_KEY = 'show_page_floating_buttons';
// 仅用于读取旧版本配置；新版使用一个总开关统一控制两个页面悬浮按钮。
const SHOW_EXPORT_OUTLINKS_FLOATING_BUTTON_STORAGE_KEY = 'show_export_outlinks_floating_button';
const AI_CONFIG_STORAGE_KEY = 'auto_comment_ai_config';
const TIMEOUT_STORAGE_KEY = 'batch_timeout_seconds';
const CONCURRENCY_STORAGE_KEY = 'batch_concurrency_tabs';
const BATCH_CHECKBOX_SETTINGS_KEY = 'batch_checkbox_settings';

const CONFIG_VERSION = 6;

const ACTIVE_STORAGE_KEYS = [
  WEBSITE_URL_STORAGE_KEY,
  WEBSITE_CONTENT_STORAGE_KEY,
  USER_NAME_STORAGE_KEY,
  USER_EMAIL_STORAGE_KEY,
  USER_PASSWORD_STORAGE_KEY,
  SHOW_PAGE_FLOATING_BUTTONS_STORAGE_KEY
];

// 配置备份只导出可复用设置，不导出批次结果、当前任务 URL 和冷却记录等运行态数据。
const SYNC_CONFIG_STORAGE_KEYS = [
  ...ACTIVE_STORAGE_KEYS,
  TIMEOUT_STORAGE_KEY,
  CONCURRENCY_STORAGE_KEY,
  BATCH_CHECKBOX_SETTINGS_KEY,
  LEGACY_SKILL_TEMPLATE_STORAGE_KEY,
  LEGACY_PROMPT_FIELD_VALUES_STORAGE_KEY
];

const LOCAL_CONFIG_STORAGE_KEYS = [
  AI_CONFIG_STORAGE_KEY,
  SITES_CONFIG_STORAGE_KEY
];

const IMPORT_COMPAT_STORAGE_KEYS = [
  ...SYNC_CONFIG_STORAGE_KEYS,
  ...LOCAL_CONFIG_STORAGE_KEYS,
  SHOW_EXPORT_OUTLINKS_FLOATING_BUTTON_STORAGE_KEY
];

/**
 * 内置 Provider 模板。API Key 默认留空，用户需要在本机设置页自行填写。
 */
const DEFAULT_AI_CONFIG = {
  activeProviderId: 'dashscope',
  providers: [
    {
      id: 'dashscope',
      name: '通义千问',
      type: 'openai_compatible',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: '',
      model: 'qwen-plus',
      temperature: 0.7,
      maxTokens: 800
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      type: 'openai_compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      temperature: 0.7,
      maxTokens: 800
    },
    {
      id: 'tuzi',
      name: 'tuzi',
      type: 'openai_compatible',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: '',
      model: 'gpt-5.5',
      temperature: 0.7,
      maxTokens: 800
    },
    {
      id: 'avman',
      name: 'avman',
      type: 'openai_compatible',
      baseUrl: 'https://api.mjdjourney.cn/v1',
      apiKey: '',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 800
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      type: 'openai_compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      model: 'openai/gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 800
    }
  ]
};

document.addEventListener('DOMContentLoaded', () => {
  const tabButtons = Array.from(document.querySelectorAll('[data-tab-target]'));
  const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));
  const siteList = document.getElementById('siteList');
  const siteNameInput = document.getElementById('siteName');
  const websiteUrlInput = document.getElementById('websiteUrl');
  const websiteContentInput = document.getElementById('websiteContent');
  const anchorTextInput = document.getElementById('anchorTextInput');
  const anchorList = document.getElementById('anchorList');
  const newSiteBtn = document.getElementById('newSiteBtn');
  const addAnchorTextsBtn = document.getElementById('addAnchorTextsBtn');
  const deleteSiteBtn = document.getElementById('deleteSiteBtn');
  const userEmailInput = document.getElementById('userEmail');
  const userPasswordInput = document.getElementById('userPassword');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const settingsStatusEl = document.getElementById('settingsStatus');
  const saveProfileSettingsBtn = document.getElementById('saveProfileSettingsBtn');
  const profileSettingsStatusEl = document.getElementById('profileSettingsStatus');
  const exportConfigBtn = document.getElementById('exportConfigBtn');
  const importConfigBtn = document.getElementById('importConfigBtn');
  const importConfigFileInput = document.getElementById('importConfigFileInput');
  const importExportStatus = document.getElementById('importExportStatus');
  const togglePageFloatingButtonsBtn = document.getElementById('togglePageFloatingButtonsBtn');

  const providerSelect = document.getElementById('providerSelect');
  const providerNameInput = document.getElementById('providerName');
  const providerTypeInput = document.getElementById('providerType');
  const providerBaseUrlInput = document.getElementById('providerBaseUrl');
  const providerApiKeyInput = document.getElementById('providerApiKey');
  const providerModelInput = document.getElementById('providerModel');
  const providerTemperatureInput = document.getElementById('providerTemperature');
  const providerMaxTokensInput = document.getElementById('providerMaxTokens');
  const newProviderBtn = document.getElementById('newProviderBtn');
  const saveProviderBtn = document.getElementById('saveProviderBtn');
  const setActiveProviderBtn = document.getElementById('setActiveProviderBtn');
  const testProviderBtn = document.getElementById('testProviderBtn');
  const deleteProviderBtn = document.getElementById('deleteProviderBtn');
  const providerStatusEl = document.getElementById('providerStatus');

  if (!siteList || !siteNameInput || !websiteUrlInput || !websiteContentInput || !anchorList || !userEmailInput || !saveSettingsBtn) {
    console.error('设置页初始化失败：关键表单元素不存在');
    return;
  }

  let showPageFloatingButtons = true;
  let aiConfig = clone(DEFAULT_AI_CONFIG);
  let editingProviderId = DEFAULT_AI_CONFIG.activeProviderId;
  let sitesConfig = { activeSiteId: '', sites: [] };
  let editingSiteId = '';

  function activateTab(tabName) {
    const targetName = tabPanels.some((panel) => panel.dataset.tabPanel === tabName) ? tabName : 'ai';
    tabButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.tabTarget === targetName);
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.tabPanel === targetName);
    });
    try {
      chrome.storage.local.set({ auto_comment_options_active_tab: targetName }, () => {});
    } catch (_) {}
    if (targetName === 'assets' && typeof window !== 'undefined' && window.LinkPilotAssetLibrary) {
      window.LinkPilotAssetLibrary.refresh();
    }
  }

  function initTabs() {
    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        activateTab(button.dataset.tabTarget);
      });
    });

    chrome.storage.local.get(['auto_comment_options_active_tab'], (data) => {
      activateTab(data.auto_comment_options_active_tab || 'ai');
    });
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function showStatus(el, text, timeout = 1800) {
    if (!el) return;
    el.textContent = text;
    el.style.opacity = '1';
    setTimeout(() => {
      el.style.opacity = '0';
    }, timeout);
  }

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function normalizeNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function createProviderId(name) {
    const base = normalizeText(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'provider';
    const suffix = Date.now().toString(36);
    return `${base}_${suffix}`;
  }

  function createSiteId(name) {
    const base = normalizeText(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'site';
    return `${base}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function createAnchorId(text) {
    const base = normalizeText(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'anchor';
    return `${base}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function getDomainFromUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function normalizeProvider(provider) {
    const name = normalizeText(provider && provider.name) || '自定义 Provider';
    return {
      id: normalizeText(provider && provider.id) || createProviderId(name),
      name,
      type: 'openai_compatible',
      baseUrl: normalizeText(provider && provider.baseUrl).replace(/\/+$/, ''),
      apiKey: normalizeText(provider && provider.apiKey),
      model: normalizeText(provider && provider.model),
      temperature: normalizeNumber(provider && provider.temperature, 0.7, 0, 2),
      maxTokens: Math.round(normalizeNumber(provider && provider.maxTokens, 800, 1, 32000))
    };
  }

  function normalizeAiConfig(config) {
    const rawProviders = Array.isArray(config && config.providers)
      ? config.providers
      : DEFAULT_AI_CONFIG.providers;
    const providers = rawProviders.map(normalizeProvider);
    const providerIds = new Set(providers.map((provider) => provider.id));
    DEFAULT_AI_CONFIG.providers.forEach((defaultProvider) => {
      if (!providerIds.has(defaultProvider.id)) {
        providers.push(normalizeProvider(defaultProvider));
      }
    });
    const fallbackActiveId = providers[0] ? providers[0].id : DEFAULT_AI_CONFIG.activeProviderId;
    const activeProviderId = providers.some((provider) => provider.id === config?.activeProviderId)
      ? config.activeProviderId
      : fallbackActiveId;
    return { activeProviderId, providers };
  }

  function getCurrentProvider() {
    return aiConfig.providers.find((provider) => provider.id === editingProviderId)
      || aiConfig.providers.find((provider) => provider.id === aiConfig.activeProviderId)
      || aiConfig.providers[0]
      || null;
  }

  function renderPageFloatingButtonsToggle() {
    if (!togglePageFloatingButtonsBtn) return;
    togglePageFloatingButtonsBtn.textContent = showPageFloatingButtons ? '隐藏页面悬浮按钮' : '显示页面悬浮按钮';
    togglePageFloatingButtonsBtn.classList.toggle('btn-primary', !showPageFloatingButtons);
    togglePageFloatingButtonsBtn.classList.toggle('btn-secondary', showPageFloatingButtons);
    togglePageFloatingButtonsBtn.title = showPageFloatingButtons
      ? '点击后页面不再显示“AI 评论”和“导出外链”按钮'
      : '点击后页面显示“AI 评论”和“导出外链”按钮';
  }

  function renderProviderSelect() {
    if (!providerSelect) return;
    providerSelect.innerHTML = '';
    aiConfig.providers.forEach((provider) => {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.id === aiConfig.activeProviderId
        ? `${provider.name}（当前）`
        : provider.name;
      providerSelect.appendChild(option);
    });
    if (getCurrentProvider()) {
      providerSelect.value = getCurrentProvider().id;
    }
  }

  function fillProviderForm(provider) {
    if (!provider) return;
    editingProviderId = provider.id;
    providerNameInput.value = provider.name || '';
    providerTypeInput.value = provider.type || 'openai_compatible';
    providerBaseUrlInput.value = provider.baseUrl || '';
    providerApiKeyInput.value = provider.apiKey || '';
    providerModelInput.value = provider.model || '';
    providerTemperatureInput.value = String(provider.temperature ?? 0.7);
    providerMaxTokensInput.value = String(provider.maxTokens ?? 800);
    renderProviderSelect();
  }

  function readProviderForm(existingProvider) {
    const name = normalizeText(providerNameInput.value);
    const provider = normalizeProvider({
      id: existingProvider ? existingProvider.id : '',
      name,
      type: providerTypeInput.value,
      baseUrl: providerBaseUrlInput.value,
      apiKey: providerApiKeyInput.value,
      model: providerModelInput.value,
      temperature: providerTemperatureInput.value,
      maxTokens: providerMaxTokensInput.value
    });

    if (!provider.name) throw new Error('请填写 Provider 名称');
    if (!provider.baseUrl) throw new Error('请填写 Base URL');
    if (!provider.model) throw new Error('请填写模型名称');
    return provider;
  }

  function pickLegacyPromptValue(values, keywords) {
    if (!values || typeof values !== 'object') return '';
    const normalizedKeywords = keywords.map((keyword) => String(keyword).toLowerCase());
    const entry = Object.entries(values).find(([key, value]) => {
      if (!value) return false;
      const normalizedKey = String(key || '').toLowerCase();
      return normalizedKeywords.some((keyword) => normalizedKey.includes(keyword));
    });
    return entry ? String(entry[1] || '').trim() : '';
  }

  function getLegacyWebsiteUrl(data) {
    return pickLegacyPromptValue(data[LEGACY_PROMPT_FIELD_VALUES_STORAGE_KEY], [
      '目标 URL',
      '目标URL',
      '网址',
      'website link',
      'website url',
      'url'
    ]);
  }

  function getLegacyWebsiteContent(data) {
    return pickLegacyPromptValue(data[LEGACY_PROMPT_FIELD_VALUES_STORAGE_KEY], [
      '目标 URL 内容',
      '目标URL内容',
      'website content',
      'site content',
      'description'
    ]);
  }

  // 目标 URL 配置采用结构化数据，便于后续按目标扩展锚文本权重、使用次数和阶段状态。
  function normalizeAnchor(anchor) {
    if (typeof anchor === 'string') {
      const text = normalizeText(anchor);
      return text ? { id: createAnchorId(text), text, enabled: true } : null;
    }
    const text = normalizeText(anchor && anchor.text);
    if (!text) return null;
    return {
      id: normalizeText(anchor && anchor.id) || createAnchorId(text),
      text,
      enabled: anchor && anchor.enabled === false ? false : true
    };
  }

  function normalizeSite(site) {
    const url = normalizeText(site && site.url);
    const content = normalizeText(site && site.content);
    const name = normalizeText(site && site.name) || getDomainFromUrl(url) || '未命名目标';
    const anchors = Array.isArray(site && site.anchors)
      ? site.anchors.map(normalizeAnchor).filter(Boolean)
      : [];
    return {
      id: normalizeText(site && site.id) || createSiteId(name),
      name,
      url,
      content,
      anchors
    };
  }

  // 兼容旧版本的单目标配置：首次打开新版设置页时会自动构造一个默认目标。
  function buildLegacySite(data) {
    const legacyUrl = typeof data[WEBSITE_URL_STORAGE_KEY] === 'string'
      ? data[WEBSITE_URL_STORAGE_KEY].trim()
      : getLegacyWebsiteUrl(data);
    const legacyContent = typeof data[WEBSITE_CONTENT_STORAGE_KEY] === 'string'
      ? data[WEBSITE_CONTENT_STORAGE_KEY].trim()
      : getLegacyWebsiteContent(data);
    return normalizeSite({
      id: 'default_site',
      name: getDomainFromUrl(legacyUrl) || '默认目标',
      url: legacyUrl,
      content: legacyContent,
      anchors: []
    });
  }

  function normalizeSitesConfig(config, legacyData = {}) {
    let sites = Array.isArray(config && config.sites)
      ? config.sites.map(normalizeSite).filter(Boolean)
      : [];

    if (sites.length === 0) {
      sites = [buildLegacySite(legacyData)];
    }

    const activeSiteId = sites.some((site) => site.id === config?.activeSiteId)
      ? config.activeSiteId
      : sites[0].id;

    return { activeSiteId, sites };
  }

  function getEditingSite() {
    return sitesConfig.sites.find((site) => site.id === editingSiteId)
      || sitesConfig.sites.find((site) => site.id === sitesConfig.activeSiteId)
      || sitesConfig.sites[0]
      || null;
  }

  function updateEditingSiteInMemory(partial) {
    const site = getEditingSite();
    if (!site) return null;
    Object.assign(site, partial);
    return site;
  }

  function parseAnchorInput(value) {
    const seen = new Set();
    return String(value || '')
      .split(/[,，\n]/)
      .map((item) => normalizeText(item))
      .filter((item) => {
        const key = item.toLowerCase();
        if (!item || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function renderSiteList() {
    siteList.innerHTML = '';
    sitesConfig.sites.forEach((site) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'site-item';
      button.classList.toggle('active', site.id === editingSiteId);
      button.dataset.siteId = site.id;
      button.innerHTML = `
        <div class="site-item-name">
          <span>${escapeHtml(site.name || '未命名目标')}</span>
        </div>
        <div class="site-item-url">${escapeHtml(site.url || '未填写 URL')}</div>
      `;
      button.addEventListener('click', () => {
        saveEditingSiteDraft();
        editingSiteId = site.id;
        renderSiteList();
        fillSiteForm(site);
      });
      siteList.appendChild(button);
    });
  }

  function renderAnchorList(site) {
    anchorList.innerHTML = '';
    if (!site || site.anchors.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'anchor-empty';
      empty.textContent = '这个网站还没有锚文本。未配置时，AI 会根据页面上下文自然生成锚文本。';
      anchorList.appendChild(empty);
      return;
    }

    site.anchors.forEach((anchor) => {
      const row = document.createElement('div');
      row.className = 'anchor-row';
      row.classList.toggle('is-disabled', !anchor.enabled);
      row.dataset.anchorId = anchor.id;
      row.innerHTML = `
        <input type="checkbox" data-anchor-action="toggle" ${anchor.enabled ? 'checked' : ''} title="启用或禁用该锚文本" />
        <input type="text" data-anchor-action="text" value="${escapeHtml(anchor.text)}" />
        <button class="btn btn-secondary" type="button" data-anchor-action="delete">删除</button>
      `;
      anchorList.appendChild(row);
    });
  }

  function fillSiteForm(site) {
    if (!site) return;
    editingSiteId = site.id;
    siteNameInput.value = site.name || '';
    websiteUrlInput.value = site.url || '';
    websiteContentInput.value = site.content || '';
    anchorTextInput.value = '';
    renderAnchorList(site);
    renderSiteList();
  }

  function saveEditingSiteDraft() {
    const site = getEditingSite();
    if (!site) return null;
    site.name = normalizeText(siteNameInput.value) || getDomainFromUrl(websiteUrlInput.value) || site.name || '未命名目标';
    site.url = normalizeText(websiteUrlInput.value);
    site.content = normalizeText(websiteContentInput.value);
    return site;
  }

  function readSiteForm() {
    const existing = saveEditingSiteDraft();
    if (!existing) throw new Error('当前没有可保存的网站');
    const site = normalizeSite(existing);
    if (!site.name) throw new Error('请填写目标名称');
    if (!site.url) throw new Error('请填写目标 URL');
    if (!site.content) throw new Error('请填写目标 URL 内容');
    return site;
  }

  function persistSitesConfig(callback) {
    const activeSite = sitesConfig.sites.find((s) => s.id === sitesConfig.activeSiteId) || sitesConfig.sites[0] || null;
    const localPayload = {
      [SITES_CONFIG_STORAGE_KEY]: sitesConfig
    };
    const syncPayload = {
      [WEBSITE_URL_STORAGE_KEY]: activeSite ? activeSite.url : '',
      [WEBSITE_CONTENT_STORAGE_KEY]: activeSite ? activeSite.content : '',
      [USER_NAME_STORAGE_KEY]: activeSite ? activeSite.name : '',
      [USER_EMAIL_STORAGE_KEY]: userEmailInput.value.trim(),
      [USER_PASSWORD_STORAGE_KEY]: userPasswordInput.value.trim()
    };

    // 多站点配置可能包含较长的网站描述和锚文本池，使用 storage.local 避免 sync 单项配额导致保存失败。
    chrome.storage.local.set(localPayload, () => {
      if (chrome.runtime.lastError) {
        const message = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
        console.error('保存目标 URL 管理配置到本地失败：', chrome.runtime.lastError);
        showStatus(settingsStatusEl, `保存失败：${message}`, 5000);
        if (callback) callback(new Error(message));
        return;
      }

      // 这些旧字段继续写入 sync，给旧逻辑和导出配置提供单网站兜底值。
      chrome.storage.sync.set(syncPayload, () => {
        if (chrome.runtime.lastError) {
          const message = chrome.runtime.lastError.message || String(chrome.runtime.lastError);
          console.error('保存目标 URL 管理兼容配置失败：', chrome.runtime.lastError);
          showStatus(settingsStatusEl, `保存失败：${message}`, 5000);
          if (callback) callback(new Error(message));
          return;
        }
        if (callback) callback(null);
      });
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 将目标 URL 管理列表快照广播给批量页。批量页只读取这份快照，不会反向修改目标 URL 管理配置。
  function publishSitesConfigForBatch() {
    if (!sitesConfig || !Array.isArray(sitesConfig.sites)) return;
    saveEditingSiteDraft();
    const snapshot = clone(sitesConfig);
    window.AutoCommentSitesConfig = snapshot;
    if (typeof window.AutoCommentApplyBatchSitesConfig === 'function') {
      window.AutoCommentApplyBatchSitesConfig(snapshot);
    }
    window.dispatchEvent(new CustomEvent('autoCommentSitesConfigChanged', { detail: snapshot }));
  }

  function loadSettings() {
    chrome.storage.sync.get(IMPORT_COMPAT_STORAGE_KEYS, (syncResult) => {
      if (chrome.runtime.lastError) {
        console.error('读取设置失败：', chrome.runtime.lastError);
        return;
      }

      const data = syncResult || {};
      userEmailInput.value = typeof data[USER_EMAIL_STORAGE_KEY] === 'string' ? data[USER_EMAIL_STORAGE_KEY] : '';
      userPasswordInput.value = typeof data[USER_PASSWORD_STORAGE_KEY] === 'string' ? data[USER_PASSWORD_STORAGE_KEY] : '';
      showPageFloatingButtons = typeof data[SHOW_PAGE_FLOATING_BUTTONS_STORAGE_KEY] === 'boolean'
        ? data[SHOW_PAGE_FLOATING_BUTTONS_STORAGE_KEY]
        : data[SHOW_EXPORT_OUTLINKS_FLOATING_BUTTON_STORAGE_KEY] !== false;
      renderPageFloatingButtonsToggle();

      chrome.storage.local.get([SITES_CONFIG_STORAGE_KEY, 'auto_comment_batch_selected_promotion_site_id', 'auto_comment_selected_promotion_site_id'], (localResult) => {
        if (chrome.runtime.lastError) {
          console.error('读取本地网站配置失败：', chrome.runtime.lastError);
          sitesConfig = normalizeSitesConfig(null, data);
        } else {
          sitesConfig = normalizeSitesConfig(localResult[SITES_CONFIG_STORAGE_KEY], data);
        }
        const savedActiveId = String(
          localResult && (
            localResult.auto_comment_batch_selected_promotion_site_id ||
            localResult.auto_comment_selected_promotion_site_id
          ) || ''
        ).trim();
        if (savedActiveId && sitesConfig.sites.some((site) => site.id === savedActiveId)) {
          sitesConfig.activeSiteId = savedActiveId;
        }
        editingSiteId = sitesConfig.sites[0] ? sitesConfig.sites[0].id : sitesConfig.activeSiteId;
        fillSiteForm(getEditingSite());
        // 将旧版字段或导入数据规范化后写回本地存储，保证批量页和内容脚本都能读取同一份目标 URL 列表。
        chrome.storage.local.set({ [SITES_CONFIG_STORAGE_KEY]: sitesConfig }, () => {});
        publishSitesConfigForBatch();
      });
    });

    chrome.storage.local.get([AI_CONFIG_STORAGE_KEY], (localResult) => {
      if (chrome.runtime.lastError) {
        console.error('读取 AI Provider 配置失败：', chrome.runtime.lastError);
        return;
      }
      aiConfig = normalizeAiConfig(localResult[AI_CONFIG_STORAGE_KEY] || DEFAULT_AI_CONFIG);
      chrome.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: aiConfig }, () => {});
      editingProviderId = aiConfig.activeProviderId;
      renderProviderSelect();
      fillProviderForm(getCurrentProvider());
    });
  }

  const requiredSettingsFields = [
    { el: siteNameInput, label: '目标名称' },
    { el: websiteUrlInput, label: '目标 URL' },
    { el: websiteContentInput, label: '目标 URL 内容' }
  ];

  function validateRequiredSettings() {
    let firstInvalid = null;
    const missingLabels = [];

    requiredSettingsFields.forEach(({ el, label }) => {
      const isValid = el.checkValidity() && !!el.value.trim();
      el.classList.toggle('is-invalid', !isValid);
      if (!isValid) {
        missingLabels.push(label);
        if (!firstInvalid) firstInvalid = el;
      }
    });

    if (firstInvalid) {
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstInvalid.focus();
      showStatus(settingsStatusEl, `请先填写必填项：${missingLabels.join('、')}`, 2600);
      return false;
    }

    return true;
  }

  requiredSettingsFields.forEach(({ el }) => {
    el.addEventListener('input', () => {
      el.classList.toggle('is-invalid', !(el.checkValidity() && !!el.value.trim()));
      publishSitesConfigForBatch();
    });
  });

  function saveWebsiteSettings(button, statusEl, successText) {
    if (!validateRequiredSettings()) return;

    const originalText = button.textContent;
    try {
      button.disabled = true;
      button.textContent = '正在保存...';
      showStatus(statusEl, '正在保存...', 60000);
      const site = readSiteForm();
      const index = sitesConfig.sites.findIndex((item) => item.id === site.id);
      if (index >= 0) {
        sitesConfig.sites[index] = site;
      } else {
        sitesConfig.sites.push(site);
      }
      editingSiteId = site.id;
      persistSitesConfig((error) => {
        button.disabled = false;
        button.textContent = originalText;
        if (error) {
          showStatus(statusEl, `保存失败：${error.message}`, 5000);
          return;
        }
        renderSiteList();
        fillSiteForm(site);
        publishSitesConfigForBatch();
        showStatus(statusEl, successText, 3500);
      });
    } catch (error) {
      button.disabled = false;
      button.textContent = originalText;
      showStatus(statusEl, error.message || '目标 URL 配置无效', 3000);
    }
  }

  saveSettingsBtn.addEventListener('click', () => {
    saveWebsiteSettings(saveSettingsBtn, settingsStatusEl, '目标 URL 已保存，刷新后仍会保留');
  });

  if (saveProfileSettingsBtn) {
    saveProfileSettingsBtn.addEventListener('click', () => {
      saveWebsiteSettings(saveProfileSettingsBtn, profileSettingsStatusEl || settingsStatusEl, '基础信息已保存，刷新后仍会保留');
    });
  }

  if (newSiteBtn) {
    newSiteBtn.addEventListener('click', () => {
      saveEditingSiteDraft();
      const site = normalizeSite({
        id: createSiteId('site'),
        name: '新网站',
        url: '',
        content: '',
        anchors: []
      });
      sitesConfig.sites.push(site);
      editingSiteId = site.id;
      renderSiteList();
      fillSiteForm(site);
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, '已创建新网站，请填写后保存', 2600);
    });
  }

  if (deleteSiteBtn) {
    deleteSiteBtn.addEventListener('click', () => {
      const site = getEditingSite();
      if (!site) return;
      if (sitesConfig.sites.length <= 1) {
        showStatus(settingsStatusEl, '至少保留一个网站', 2400);
        return;
      }
      if (!confirm(`确认删除「${site.name}」？`)) return;
      sitesConfig.sites = sitesConfig.sites.filter((item) => item.id !== site.id);
      if (sitesConfig.activeSiteId === site.id) {
        sitesConfig.activeSiteId = sitesConfig.sites[0].id;
      }
      editingSiteId = sitesConfig.sites[0].id;
      persistSitesConfig(() => {
        fillSiteForm(getEditingSite());
        publishSitesConfigForBatch();
        showStatus(settingsStatusEl, '网站已删除');
      });
    });
  }

  if (addAnchorTextsBtn && anchorTextInput) {
    addAnchorTextsBtn.addEventListener('click', () => {
      const site = saveEditingSiteDraft();
      if (!site) return;
      const texts = parseAnchorInput(anchorTextInput.value);
      if (texts.length === 0) {
        showStatus(settingsStatusEl, '请输入要添加的锚文本', 2200);
        return;
      }
      const existingTexts = new Set(site.anchors.map((anchor) => anchor.text.toLowerCase()));
      const nextAnchors = texts
        .filter((text) => !existingTexts.has(text.toLowerCase()))
        .map((text) => ({ id: createAnchorId(text), text, enabled: true }));
      if (nextAnchors.length === 0) {
        showStatus(settingsStatusEl, '这些锚文本已存在', 2200);
        return;
      }
      site.anchors.push(...nextAnchors);
      anchorTextInput.value = '';
      renderAnchorList(site);
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, `已添加 ${nextAnchors.length} 个锚文本，请保存站点`, 2600);
    });
  }

  if (anchorTextInput) {
    anchorTextInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addAnchorTextsBtn?.click();
      }
    });
  }

  anchorList.addEventListener('change', (event) => {
    const row = event.target.closest('.anchor-row');
    const site = getEditingSite();
    if (!row || !site) return;
    const anchor = site.anchors.find((item) => item.id === row.dataset.anchorId);
    if (!anchor) return;
    if (event.target.dataset.anchorAction === 'toggle') {
      anchor.enabled = !!event.target.checked;
      row.classList.toggle('is-disabled', !anchor.enabled);
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, '锚文本状态已修改，请保存站点', 2400);
    }
  });

  anchorList.addEventListener('input', (event) => {
    const row = event.target.closest('.anchor-row');
    const site = getEditingSite();
    if (!row || !site || event.target.dataset.anchorAction !== 'text') return;
    const anchor = site.anchors.find((item) => item.id === row.dataset.anchorId);
    if (!anchor) return;
    anchor.text = normalizeText(event.target.value);
    publishSitesConfigForBatch();
  });

  anchorList.addEventListener('click', (event) => {
    const action = event.target.dataset.anchorAction;
    if (action !== 'delete') return;
    const row = event.target.closest('.anchor-row');
    const site = getEditingSite();
    if (!row || !site) return;
    site.anchors = site.anchors.filter((item) => item.id !== row.dataset.anchorId);
    renderAnchorList(site);
    publishSitesConfigForBatch();
    showStatus(settingsStatusEl, '锚文本已删除，请保存站点', 2400);
  });

  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      const provider = aiConfig.providers.find((item) => item.id === providerSelect.value);
      if (provider) fillProviderForm(provider);
    });
  }

  if (newProviderBtn) {
    newProviderBtn.addEventListener('click', () => {
      const provider = normalizeProvider({
        id: createProviderId('provider'),
        name: '新的 Provider',
        type: 'openai_compatible',
        baseUrl: '',
        apiKey: '',
        model: '',
        temperature: 0.7,
        maxTokens: 800
      });
      aiConfig.providers.push(provider);
      editingProviderId = provider.id;
      renderProviderSelect();
      fillProviderForm(provider);
      showStatus(providerStatusEl, '已创建草稿，请填写后保存', 2400);
    });
  }

  if (saveProviderBtn) {
    saveProviderBtn.addEventListener('click', () => {
      try {
        const existing = aiConfig.providers.find((provider) => provider.id === editingProviderId);
        const provider = readProviderForm(existing);
        const index = aiConfig.providers.findIndex((item) => item.id === provider.id);
        if (index >= 0) {
          aiConfig.providers[index] = provider;
        } else {
          aiConfig.providers.push(provider);
        }

        chrome.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: aiConfig }, () => {
          if (chrome.runtime.lastError) {
            console.error('保存 AI Provider 失败：', chrome.runtime.lastError);
            showStatus(providerStatusEl, '保存失败', 2200);
            return;
          }
          editingProviderId = provider.id;
          renderProviderSelect();
          showStatus(providerStatusEl, 'Provider 已保存');
        });
      } catch (error) {
        showStatus(providerStatusEl, error.message || 'Provider 配置无效', 3000);
      }
    });
  }

  if (setActiveProviderBtn) {
    setActiveProviderBtn.addEventListener('click', () => {
      const provider = getCurrentProvider();
      if (!provider) {
        showStatus(providerStatusEl, '没有可用 Provider', 2200);
        return;
      }
      aiConfig.activeProviderId = provider.id;
      chrome.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: aiConfig }, () => {
        renderProviderSelect();
        showStatus(providerStatusEl, `当前 Provider：${provider.name}`, 2400);
      });
    });
  }

  if (testProviderBtn) {
    testProviderBtn.addEventListener('click', () => {
      let provider;
      try {
        provider = readProviderForm(aiConfig.providers.find((item) => item.id === editingProviderId));
      } catch (error) {
        showStatus(providerStatusEl, error.message || 'Provider 配置无效', 3000);
        return;
      }

      showStatus(providerStatusEl, '正在测试连接...', 60000);
      chrome.runtime.sendMessage({ type: 'TEST_AI_PROVIDER', provider }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('测试 AI Provider 消息失败：', chrome.runtime.lastError);
          showStatus(providerStatusEl, '测试失败：后台脚本无响应', 3000);
          return;
        }
        if (!response || !response.ok) {
          showStatus(providerStatusEl, `测试失败：${response?.error || '未知错误'}`, 5000);
          return;
        }
        showStatus(providerStatusEl, `测试成功：${response.text || '连接正常'}`, 4000);
      });
    });
  }

  if (deleteProviderBtn) {
    deleteProviderBtn.addEventListener('click', () => {
      if (aiConfig.providers.length <= 1) {
        showStatus(providerStatusEl, '至少保留一个 Provider', 2400);
        return;
      }
      const provider = getCurrentProvider();
      if (!provider) return;
      if (!confirm(`确认删除「${provider.name}」？`)) return;

      aiConfig.providers = aiConfig.providers.filter((item) => item.id !== provider.id);
      if (aiConfig.activeProviderId === provider.id) {
        aiConfig.activeProviderId = aiConfig.providers[0].id;
      }
      editingProviderId = aiConfig.activeProviderId;
      chrome.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: aiConfig }, () => {
        renderProviderSelect();
        fillProviderForm(getCurrentProvider());
        showStatus(providerStatusEl, 'Provider 已删除');
      });
    });
  }

  if (togglePageFloatingButtonsBtn) {
    renderPageFloatingButtonsToggle();
    togglePageFloatingButtonsBtn.addEventListener('click', () => {
      const nextValue = !showPageFloatingButtons;
      chrome.storage.sync.set(
        { [SHOW_PAGE_FLOATING_BUTTONS_STORAGE_KEY]: nextValue },
        () => {
          if (chrome.runtime.lastError) {
            console.error('保存页面悬浮按钮设置失败：', chrome.runtime.lastError);
            showStatus(settingsStatusEl, '保存失败', 2000);
            return;
          }
          showPageFloatingButtons = nextValue;
          renderPageFloatingButtonsToggle();
          showStatus(settingsStatusEl, nextValue ? '已显示页面悬浮按钮' : '已隐藏页面悬浮按钮');
        }
      );
    });
  }

  function getImportedData(config) {
    if (!config || typeof config !== 'object') return null;
    return config.data && typeof config.data === 'object' ? config.data : config;
  }

  function showImportExportStatus(text, isError) {
    if (!importExportStatus) return;
    importExportStatus.textContent = text;
    importExportStatus.style.color = isError ? '#dc2626' : '#b45309';
    importExportStatus.style.opacity = '1';
    setTimeout(() => {
      importExportStatus.style.opacity = '0';
    }, 3000);
  }

  if (exportConfigBtn) {
    exportConfigBtn.addEventListener('click', () => {
      chrome.storage.sync.get(SYNC_CONFIG_STORAGE_KEYS, (syncResult) => {
        if (chrome.runtime.lastError) {
          showImportExportStatus('导出失败：' + chrome.runtime.lastError.message, true);
          return;
        }

        chrome.storage.local.get(LOCAL_CONFIG_STORAGE_KEYS, (localResult) => {
          if (chrome.runtime.lastError) {
            showImportExportStatus('导出失败：' + chrome.runtime.lastError.message, true);
            return;
          }

          saveEditingSiteDraft();
          const exportSitesConfig = normalizeSitesConfig(
            sitesConfig && Array.isArray(sitesConfig.sites) && sitesConfig.sites.length > 0
              ? sitesConfig
              : localResult[SITES_CONFIG_STORAGE_KEY],
            syncResult || {}
          );
          const activeSite = exportSitesConfig.sites[0] || null;
          const exportAiConfig = normalizeAiConfig(localResult[AI_CONFIG_STORAGE_KEY] || aiConfig);
          const mergedData = {
            ...syncResult,
            [SITES_CONFIG_STORAGE_KEY]: exportSitesConfig,
            [WEBSITE_URL_STORAGE_KEY]: activeSite ? activeSite.url : websiteUrlInput.value.trim(),
            [WEBSITE_CONTENT_STORAGE_KEY]: activeSite ? activeSite.content : websiteContentInput.value.trim(),
            [USER_NAME_STORAGE_KEY]: activeSite ? activeSite.name : '',
            [USER_EMAIL_STORAGE_KEY]: userEmailInput.value.trim(),
            [USER_PASSWORD_STORAGE_KEY]: userPasswordInput.value.trim(),
            [AI_CONFIG_STORAGE_KEY]: exportAiConfig
          };

          const config = {
            _version: CONFIG_VERSION,
            _exportTime: new Date().toISOString(),
            _note: '此配置备份包含 AI API Key、目标 URL 资料、表单基础信息和批量设置，请只在可信环境保存和导入。',
            data: mergedData
          };

          if (!exportSitesConfig.sites.some((site) => site.url && site.content)) {
            showImportExportStatus('导出失败：请先至少填写一个完整的网站。', true);
            return;
          }

          const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'autocomment-local-config-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          showImportExportStatus('配置已完整导出，包含 API Key。', false);
        });
      });
    });
  }

  if (importConfigBtn && importConfigFileInput) {
    importConfigBtn.addEventListener('click', () => {
      importConfigFileInput.click();
    });

    importConfigFileInput.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        try {
          const config = JSON.parse(readerEvent.target.result);
          const importedData = getImportedData(config);
          if (!importedData) {
            showImportExportStatus('文件格式无效，不是有效的配置文件。', true);
            return;
          }

          const syncToSave = {};
          SYNC_CONFIG_STORAGE_KEYS.forEach((key) => {
            if (importedData[key] !== undefined) {
              syncToSave[key] = importedData[key];
            }
          });
          if (
            syncToSave[SHOW_PAGE_FLOATING_BUTTONS_STORAGE_KEY] === undefined
            && typeof importedData[SHOW_EXPORT_OUTLINKS_FLOATING_BUTTON_STORAGE_KEY] === 'boolean'
          ) {
            syncToSave[SHOW_PAGE_FLOATING_BUTTONS_STORAGE_KEY] =
              importedData[SHOW_EXPORT_OUTLINKS_FLOATING_BUTTON_STORAGE_KEY];
          }

          if (syncToSave[WEBSITE_URL_STORAGE_KEY] === undefined) {
            const legacyWebsiteUrl = getLegacyWebsiteUrl(importedData);
            if (legacyWebsiteUrl) syncToSave[WEBSITE_URL_STORAGE_KEY] = legacyWebsiteUrl;
          }

          if (syncToSave[WEBSITE_CONTENT_STORAGE_KEY] === undefined) {
            const legacyWebsiteContent = getLegacyWebsiteContent(importedData);
            if (legacyWebsiteContent) syncToSave[WEBSITE_CONTENT_STORAGE_KEY] = legacyWebsiteContent;
          }

          const importedSitesConfig = normalizeSitesConfig(
            importedData[SITES_CONFIG_STORAGE_KEY],
            {
              ...importedData,
              ...syncToSave
            }
          );

          const localToSave = {
            [SITES_CONFIG_STORAGE_KEY]: importedSitesConfig
          };
          if (importedData[AI_CONFIG_STORAGE_KEY]) {
            localToSave[AI_CONFIG_STORAGE_KEY] = normalizeAiConfig(importedData[AI_CONFIG_STORAGE_KEY]);
          }

          chrome.storage.sync.set(syncToSave, () => {
            if (chrome.runtime.lastError) {
              showImportExportStatus('导入失败：' + chrome.runtime.lastError.message, true);
              return;
            }
            chrome.storage.local.set(localToSave, () => {
              if (chrome.runtime.lastError) {
                showImportExportStatus('导入失败：' + chrome.runtime.lastError.message, true);
                return;
              }

              showImportExportStatus('配置已导入！页面将自动刷新...', false);
              setTimeout(() => {
                location.reload();
              }, 1200);
            });
          });
        } catch (error) {
          showImportExportStatus('解析文件失败：' + error.message, true);
        }
      };
      reader.readAsText(file);
      importConfigFileInput.value = '';
    });
  }

  initTabs();
  loadSettings();
});
