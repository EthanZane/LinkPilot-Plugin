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

  const siteCategorySelect = document.getElementById('siteCategorySelect');
  const newCategoryBtn = document.getElementById('newCategoryBtn');
  const quickNewCategoryBtn = document.getElementById('quickNewCategoryBtn');
  const autoAnalyzeUrlBtn = document.getElementById('autoAnalyzeUrlBtn');
  const urlAnalyzeStatus = document.getElementById('urlAnalyzeStatus');
  const analyzeBtnIcon = document.getElementById('analyzeBtnIcon');
  const analyzeBtnText = document.getElementById('analyzeBtnText');

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
  let sitesConfig = { activeSiteId: '', categories: [], sites: [] };
  let editingSiteId = '';
  const collapsedCategoryIds = new Set();

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

  function createCategoryId(name) {
    return 'cat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function normalizeCategory(cat, fallbackName = '默认分类') {
    if (typeof cat === 'string') {
      const name = normalizeText(cat);
      if (!name) return null;
      return { id: 'cat_' + encodeURIComponent(name), name };
    }
    const name = normalizeText(cat && cat.name) || fallbackName;
    const id = normalizeText(cat && cat.id) || createCategoryId(name);
    return { id, name };
  }

  function normalizeSite(site) {
    const url = normalizeText(site && site.url);
    const content = normalizeText(site && site.content);
    const name = normalizeText(site && site.name) || getDomainFromUrl(url) || '未命名目标';
    const anchors = Array.isArray(site && site.anchors)
      ? site.anchors.map(normalizeAnchor).filter(Boolean)
      : [];
    const category = normalizeText(site && site.category);
    const categoryId = normalizeText(site && site.categoryId);
    return {
      id: normalizeText(site && site.id) || createSiteId(name),
      name,
      url,
      content,
      category: category || '',
      categoryId: categoryId || '',
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
      category: '默认分类',
      categoryId: 'cat_default',
      anchors: []
    });
  }

  function normalizeSitesConfig(config, legacyData = {}) {
    let categories = [];
    if (Array.isArray(config && config.categories)) {
      const seen = new Set();
      config.categories.forEach((cat) => {
        const norm = normalizeCategory(cat);
        if (norm && !seen.has(norm.name)) {
          seen.add(norm.name);
          categories.push(norm);
        }
      });
    }

    if (Array.isArray(config && config.sites)) {
      config.sites.forEach((site) => {
        const catName = normalizeText(site && site.category);
        if (catName && !categories.some((c) => c.name === catName)) {
          categories.push({
            id: normalizeText(site.categoryId) || createCategoryId(catName),
            name: catName
          });
        }
      });
    }

    if (categories.length === 0) {
      categories.push({ id: 'cat_default', name: '默认分类' });
    }

    const defaultCategory = categories[0];

    let rawSites = Array.isArray(config && config.sites) ? config.sites : [];
    if (rawSites.length === 0) {
      rawSites = [buildLegacySite(legacyData)];
    }

    let sites = rawSites.map((site) => {
      const norm = normalizeSite(site);
      if (!norm) return null;
      let matchedCat = null;
      if (site && site.categoryId) {
        matchedCat = categories.find((c) => c.id === site.categoryId);
      }
      if (!matchedCat && site && site.category) {
        matchedCat = categories.find((c) => c.name === site.category);
      }
      if (!matchedCat) {
        matchedCat = defaultCategory;
      }
      norm.categoryId = matchedCat.id;
      norm.category = matchedCat.name;
      return norm;
    }).filter(Boolean);

    if (sites.length === 0) {
      const legacySite = buildLegacySite(legacyData);
      legacySite.categoryId = defaultCategory.id;
      legacySite.category = defaultCategory.name;
      sites = [legacySite];
    }

    const activeSiteId = sites.some((site) => site.id === config?.activeSiteId)
      ? config.activeSiteId
      : sites[0].id;

    return { activeSiteId, categories, sites };
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

  function renderCategorySelect(selectedCategoryId) {
    if (!siteCategorySelect) return;
    siteCategorySelect.innerHTML = '';
    sitesConfig.categories.forEach((cat) => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = `📁 ${cat.name}`;
      siteCategorySelect.appendChild(option);
    });
    if (selectedCategoryId && sitesConfig.categories.some((c) => c.id === selectedCategoryId)) {
      siteCategorySelect.value = selectedCategoryId;
    } else if (sitesConfig.categories[0]) {
      siteCategorySelect.value = sitesConfig.categories[0].id;
    }
  }

  function promptCreateNewCategory(initialName = '', autoAssignToCurrentSite = false) {
    const rawName = window.prompt('请输入新分类名称（例如：mireka）：', initialName);
    if (rawName === null) return null;
    const name = normalizeText(rawName);
    if (!name) {
      alert('分类名称不能为空');
      return null;
    }
    const existing = sitesConfig.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      alert(`分类「${name}」已存在`);
      if (autoAssignToCurrentSite) {
        const site = getEditingSite();
        if (site) {
          site.categoryId = existing.id;
          site.category = existing.name;
          renderCategorySelect(existing.id);
          renderSiteList();
          publishSitesConfigForBatch();
        }
      }
      return existing;
    }

    const newCat = {
      id: createCategoryId(name),
      name
    };
    sitesConfig.categories.push(newCat);
    if (autoAssignToCurrentSite) {
      const site = getEditingSite();
      if (site) {
        site.categoryId = newCat.id;
        site.category = newCat.name;
      }
    }
    persistSitesConfig(() => {
      renderCategorySelect(autoAssignToCurrentSite ? newCat.id : (getEditingSite()?.categoryId || ''));
      renderSiteList();
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, `分类「${name}」已创建`, 2600);
    });
    return newCat;
  }

  function promptRenameCategory(cat) {
    const rawName = window.prompt(`重命名分类「${cat.name}」：`, cat.name);
    if (rawName === null) return;
    const newName = normalizeText(rawName);
    if (!newName || newName === cat.name) return;
    const duplicate = sitesConfig.categories.find((c) => c.id !== cat.id && c.name.toLowerCase() === newName.toLowerCase());
    if (duplicate) {
      alert(`已存在同名分类「${newName}」`);
      return;
    }
    cat.name = newName;
    sitesConfig.sites.forEach((site) => {
      if (site.categoryId === cat.id) {
        site.category = newName;
      }
    });
    persistSitesConfig(() => {
      renderCategorySelect(getEditingSite()?.categoryId || '');
      renderSiteList();
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, `分类已重命名为「${newName}」`, 2600);
    });
  }

  function promptDeleteCategory(cat) {
    if (sitesConfig.categories.length <= 1) {
      alert('至少需要保留一个分类');
      return;
    }
    const catSites = sitesConfig.sites.filter((s) => s.categoryId === cat.id);
    const otherCat = sitesConfig.categories.find((c) => c.id !== cat.id);
    if (catSites.length > 0) {
      const confirmed = window.confirm(`确定删除分类「${cat.name}」吗？\n该分类下的 ${catSites.length} 个推广页面将被移动到「${otherCat.name}」。`);
      if (!confirmed) return;
      catSites.forEach((site) => {
        site.categoryId = otherCat.id;
        site.category = otherCat.name;
      });
    } else {
      const confirmed = window.confirm(`确定删除分类「${cat.name}」吗？`);
      if (!confirmed) return;
    }
    sitesConfig.categories = sitesConfig.categories.filter((c) => c.id !== cat.id);
    persistSitesConfig(() => {
      renderCategorySelect(getEditingSite()?.categoryId || '');
      renderSiteList();
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, `分类「${cat.name}」已删除`, 2600);
    });
  }

  function createNewPageUnderCategory(category) {
    saveEditingSiteDraft();
    const site = normalizeSite({
      id: createSiteId('site'),
      name: '新网站',
      url: '',
      content: '',
      categoryId: category.id,
      category: category.name,
      anchors: []
    });
    sitesConfig.sites.push(site);
    editingSiteId = site.id;
    renderSiteList();
    fillSiteForm(site);
    websiteUrlInput.focus();
    publishSitesConfigForBatch();
    showStatus(settingsStatusEl, `已在分类「${category.name}」下创建新页面，输入 URL 后点击右侧图标按钮自动分析`, 3000);
  }

  function renderSiteList() {
    siteList.innerHTML = '';

    if (!sitesConfig.categories || sitesConfig.categories.length === 0) {
      sitesConfig.categories = [{ id: 'cat_default', name: '默认分类' }];
    }

    sitesConfig.categories.forEach((cat) => {
      const catSites = sitesConfig.sites.filter((s) => s.categoryId === cat.id || (!s.categoryId && s.category === cat.name));
      const isCollapsed = collapsedCategoryIds.has(cat.id);

      const groupEl = document.createElement('div');
      groupEl.className = 'site-category-group';
      groupEl.dataset.categoryId = cat.id;

      // Category Header
      const headerEl = document.createElement('div');
      headerEl.className = 'site-category-header';

      const titleWrapEl = document.createElement('div');
      titleWrapEl.className = 'site-category-title-wrap';

      const arrowEl = document.createElement('span');
      arrowEl.className = `toggle-arrow${isCollapsed ? ' collapsed' : ''}`;
      arrowEl.textContent = '▼';

      const nameEl = document.createElement('span');
      nameEl.className = 'site-category-name';
      nameEl.textContent = `📁 ${cat.name}`;
      nameEl.title = '双击重命名';

      const countEl = document.createElement('span');
      countEl.className = 'site-category-count';
      countEl.textContent = String(catSites.length);

      titleWrapEl.appendChild(arrowEl);
      titleWrapEl.appendChild(nameEl);
      titleWrapEl.appendChild(countEl);

      titleWrapEl.addEventListener('click', () => {
        if (collapsedCategoryIds.has(cat.id)) {
          collapsedCategoryIds.delete(cat.id);
        } else {
          collapsedCategoryIds.add(cat.id);
        }
        renderSiteList();
      });

      titleWrapEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        promptRenameCategory(cat);
      });

      // Actions
      const actionsEl = document.createElement('div');
      actionsEl.className = 'site-category-actions';

      const addPageBtn = document.createElement('button');
      addPageBtn.type = 'button';
      addPageBtn.className = 'category-action-btn add-page-btn';
      addPageBtn.textContent = '+ 页面';
      addPageBtn.title = `在此分类「${cat.name}」下添加页面`;
      addPageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        createNewPageUnderCategory(cat);
      });

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'category-action-btn';
      renameBtn.textContent = '✏️';
      renameBtn.title = '重命名分类';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        promptRenameCategory(cat);
      });

      actionsEl.appendChild(addPageBtn);
      actionsEl.appendChild(renameBtn);

      if (sitesConfig.categories.length > 1) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'category-action-btn';
        deleteBtn.textContent = '🗑️';
        deleteBtn.title = '删除分类';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          promptDeleteCategory(cat);
        });
        actionsEl.appendChild(deleteBtn);
      }

      headerEl.appendChild(titleWrapEl);
      headerEl.appendChild(actionsEl);
      groupEl.appendChild(headerEl);

      // Body (Pages)
      const bodyEl = document.createElement('div');
      bodyEl.className = `site-category-body${isCollapsed ? ' collapsed' : ''}`;

      if (catSites.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'category-empty-hint';
        emptyEl.textContent = '暂无页面，点击右上角「+ 页面」添加';
        bodyEl.appendChild(emptyEl);
      } else {
        catSites.forEach((site) => {
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
            sitesConfig.activeSiteId = site.id;
            persistSitesConfig();
            renderSiteList();
            fillSiteForm(site);
          });
          bodyEl.appendChild(button);
        });
      }

      groupEl.appendChild(bodyEl);
      siteList.appendChild(groupEl);
    });
  }

  function computeAnchorWeights(count) {
    if (count <= 0) return [];
    if (count === 1) return [1];
    const weights = [];
    for (let i = 0; i < count; i++) {
      weights.push(i === 0 ? 4.0 : 2.0 / (1 + (i - 1) * 0.45));
    }
    return weights;
  }

  function getAnchorProbabilities(anchors) {
    const enabledList = (anchors || []).filter((a) => a && a.enabled !== false && a.text);
    const count = enabledList.length;
    if (count === 0) return {};
    if (count === 1) {
      return { [enabledList[0].id]: '100%' };
    }
    const weights = computeAnchorWeights(count);
    const total = weights.reduce((s, w) => s + w, 0);
    const result = {};
    enabledList.forEach((a, i) => {
      const pct = Math.round((weights[i] / total) * 100);
      result[a.id] = `~${pct}%`;
    });
    return result;
  }

  function renderAnchorList(site) {
    anchorList.innerHTML = '';
    if (!site || !Array.isArray(site.anchors) || site.anchors.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'anchor-empty';
      empty.textContent = '这个网站还没有锚文本。未配置时，AI 会根据页面上下文自然生成锚文本。';
      anchorList.appendChild(empty);
      return;
    }

    const probabilities = getAnchorProbabilities(site.anchors);
    let enabledRank = 0;

    site.anchors.forEach((anchor, index) => {
      const isEnabled = anchor.enabled !== false;
      const isFirstEnabled = isEnabled && enabledRank === 0;
      if (isEnabled) enabledRank++;

      const probText = isEnabled ? (probabilities[anchor.id] || '') : '已禁用';
      const badgeClass = !isEnabled
        ? 'is-disabled'
        : isFirstEnabled
          ? 'is-primary'
          : 'is-secondary';

      const badgeLabel = !isEnabled
        ? '已禁用'
        : isFirstEnabled
          ? `👑 主词 ${probText}`
          : `#${enabledRank} ${probText}`;

      const isFirst = index === 0;
      const isLast = index === site.anchors.length - 1;

      const row = document.createElement('div');
      row.className = `anchor-row ${isFirstEnabled ? 'is-primary' : ''} ${!isEnabled ? 'is-disabled' : ''}`;
      row.dataset.anchorId = anchor.id;
      row.innerHTML = `
        <input type="checkbox" data-anchor-action="toggle" ${isEnabled ? 'checked' : ''} title="启用或禁用该锚文本" />
        <input type="text" data-anchor-action="text" value="${escapeHtml(anchor.text)}" placeholder="锚文本" />
        <span class="anchor-prob-badge ${badgeClass}" title="${isFirstEnabled ? '排在第 1 位的启用项自动作为主锚文本，轮播权重最高' : (isEnabled ? '次要/长尾词，轮播权重随排序逐级平滑递减' : '已禁用，不参与轮播')}">${badgeLabel}</span>
        <div class="anchor-actions">
          ${!isFirst ? '<button class="anchor-action-btn btn-primary-set" type="button" data-anchor-action="set-primary" title="设为主锚文本（移到第 1 位）">👑 置顶</button>' : ''}
          <button class="anchor-action-btn" type="button" data-anchor-action="move-up" ${isFirst ? 'disabled' : ''} title="上移一位">⬆️</button>
          <button class="anchor-action-btn" type="button" data-anchor-action="move-down" ${isLast ? 'disabled' : ''} title="下移一位">⬇️</button>
          <button class="anchor-action-btn btn-delete" type="button" data-anchor-action="delete" title="删除该锚文本">🗑️</button>
        </div>
      `;
      anchorList.appendChild(row);
    });
  }

  function fillSiteForm(site) {
    if (!site) return;
    editingSiteId = site.id;
    renderCategorySelect(site.categoryId);
    siteNameInput.value = site.name || '';
    websiteUrlInput.value = site.url || '';
    websiteContentInput.value = site.content || '';
    anchorTextInput.value = '';
    if (urlAnalyzeStatus) {
      urlAnalyzeStatus.style.display = 'none';
      urlAnalyzeStatus.innerHTML = '';
    }
    renderAnchorList(site);
    renderSiteList();
  }

  function saveEditingSiteDraft() {
    const site = getEditingSite();
    if (!site) return null;
    site.name = normalizeText(siteNameInput.value) || getDomainFromUrl(websiteUrlInput.value) || site.name || '未命名目标';
    site.url = normalizeText(websiteUrlInput.value);
    site.content = normalizeText(websiteContentInput.value);
    if (siteCategorySelect && siteCategorySelect.value) {
      const cat = sitesConfig.categories.find((c) => c.id === siteCategorySelect.value);
      if (cat) {
        site.categoryId = cat.id;
        site.category = cat.name;
      }
    }
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

  function sanitizeBrandOrAuthorName(rawName) {
    let name = String(rawName || '').trim();
    if (!name) return 'Guest';
    if (name.includes(' - ')) {
      const parts = name.split(' - ').map((p) => p.trim()).filter(Boolean);
      name = parts[parts.length - 1] || parts[0];
    } else if (name.includes(' | ')) {
      const parts = name.split(' | ').map((p) => p.trim()).filter(Boolean);
      name = parts[0];
    }
    name = name.replace(/^https?:\/\//i, '').replace(/\.(com|co|io|org|net|ai|app)$/i, '');
    return name.trim() || 'Guest';
  }

  function persistSitesConfig(callback) {
    if (editingSiteId && sitesConfig.sites.some((s) => s.id === editingSiteId)) {
      sitesConfig.activeSiteId = editingSiteId;
    }
    const activeSite = sitesConfig.sites.find((s) => s.id === sitesConfig.activeSiteId) || sitesConfig.sites[0] || null;
    const primaryAnchor = activeSite && Array.isArray(activeSite.anchors)
      ? (activeSite.anchors.find((a) => a && a.enabled !== false && a.text)?.text || '')
      : '';
    const cleanAuthorName = primaryAnchor || (activeSite ? sanitizeBrandOrAuthorName(activeSite.name) : '');
    const activeId = activeSite ? activeSite.id : '';
    const localPayload = {
      [SITES_CONFIG_STORAGE_KEY]: sitesConfig,
      'auto_comment_selected_promotion_site_id': activeId,
      'auto_comment_batch_selected_promotion_site_id': activeId
    };
    const syncPayload = {
      [WEBSITE_URL_STORAGE_KEY]: activeSite ? activeSite.url : '',
      [WEBSITE_CONTENT_STORAGE_KEY]: activeSite ? activeSite.content : '',
      [USER_NAME_STORAGE_KEY]: cleanAuthorName,
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
      sitesConfig.activeSiteId = site.id;
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

  if (newCategoryBtn) {
    newCategoryBtn.addEventListener('click', () => {
      promptCreateNewCategory();
    });
  }

  if (quickNewCategoryBtn) {
    quickNewCategoryBtn.addEventListener('click', () => {
      promptCreateNewCategory('', true);
    });
  }

  if (siteCategorySelect) {
    siteCategorySelect.addEventListener('change', () => {
      const site = getEditingSite();
      if (!site) return;
      const cat = sitesConfig.categories.find((c) => c.id === siteCategorySelect.value);
      if (cat) {
        site.categoryId = cat.id;
        site.category = cat.name;
        renderSiteList();
        publishSitesConfigForBatch();
      }
    });
  }

  if (newSiteBtn) {
    newSiteBtn.addEventListener('click', () => {
      saveEditingSiteDraft();
      const currentSite = getEditingSite();
      const defaultCat = (currentSite && sitesConfig.categories.find((c) => c.id === currentSite.categoryId))
        || sitesConfig.categories[0]
        || { id: 'cat_default', name: '默认分类' };
      createNewPageUnderCategory(defaultCat);
    });
  }

  if (deleteSiteBtn) {
    deleteSiteBtn.addEventListener('click', () => {
      const site = getEditingSite();
      if (!site) return;
      if (sitesConfig.sites.length <= 1) {
        showStatus(settingsStatusEl, '至少保留一个推广页面', 2400);
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
        showStatus(settingsStatusEl, '推广页面已删除');
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
      persistSitesConfig();
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, `已添加 ${nextAnchors.length} 个锚文本（已自动保存）`, 2600);
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

  if (autoAnalyzeUrlBtn) {
    autoAnalyzeUrlBtn.addEventListener('click', () => {
      let url = (websiteUrlInput.value || '').trim();
      if (!url) {
        websiteUrlInput.focus();
        if (urlAnalyzeStatus) {
          urlAnalyzeStatus.style.display = 'block';
          urlAnalyzeStatus.style.background = '#fef2f2';
          urlAnalyzeStatus.style.color = '#b91c1c';
          urlAnalyzeStatus.style.border = '1px solid #fecaca';
          urlAnalyzeStatus.textContent = '请先输入目标 URL（例如：https://example.com/product）';
        }
        return;
      }

      if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
        websiteUrlInput.value = url;
      }

      autoAnalyzeUrlBtn.disabled = true;
      if (analyzeBtnIcon) analyzeBtnIcon.classList.add('spin');
      if (analyzeBtnText) analyzeBtnText.textContent = '分析中...';

      if (urlAnalyzeStatus) {
        urlAnalyzeStatus.style.display = 'block';
        urlAnalyzeStatus.style.background = '#eff6ff';
        urlAnalyzeStatus.style.color = '#1d4ed8';
        urlAnalyzeStatus.style.border = '1px solid #bfdbfe';
        urlAnalyzeStatus.innerHTML = '<span class="spin">⏳</span> 正在抓取网页内容并调用 AI 深度分析，请稍候...';
      }

      chrome.runtime.sendMessage({ type: 'ANALYZE_PROMOTION_URL', url }, (response) => {
        autoAnalyzeUrlBtn.disabled = false;
        if (analyzeBtnIcon) analyzeBtnIcon.classList.remove('spin');
        if (analyzeBtnText) analyzeBtnText.textContent = '自动分析';

        if (chrome.runtime.lastError) {
          if (urlAnalyzeStatus) {
            urlAnalyzeStatus.style.display = 'block';
            urlAnalyzeStatus.style.background = '#fef2f2';
            urlAnalyzeStatus.style.color = '#b91c1c';
            urlAnalyzeStatus.style.border = '1px solid #fecaca';
            urlAnalyzeStatus.textContent = `❌ 分析失败：${chrome.runtime.lastError.message || '后台通信失败'}`;
          }
          return;
        }

        if (!response || !response.ok) {
          if (urlAnalyzeStatus) {
            urlAnalyzeStatus.style.display = 'block';
            urlAnalyzeStatus.style.background = '#fef2f2';
            urlAnalyzeStatus.style.color = '#b91c1c';
            urlAnalyzeStatus.style.border = '1px solid #fecaca';
            urlAnalyzeStatus.textContent = `❌ 分析失败：${response?.error || '无法获取网页信息'}`;
          }
          return;
        }

        const data = response.data || {};
        if (data.name) {
          siteNameInput.value = data.name;
          siteNameInput.classList.remove('is-invalid');
        }
        if (data.content) {
          websiteContentInput.value = data.content;
          websiteContentInput.classList.remove('is-invalid');
        }
        if (data.url) {
          websiteUrlInput.value = data.url;
          websiteUrlInput.classList.remove('is-invalid');
        }

        const currentSite = getEditingSite();
        let addedCount = 0;
        if (currentSite && Array.isArray(data.anchors) && data.anchors.length > 0) {
          const existingSet = new Set(currentSite.anchors.map((a) => a.text.toLowerCase()));
          const newAnchors = data.anchors
            .map((t) => normalizeText(t))
            .filter((t) => t && !existingSet.has(t.toLowerCase()))
            .map((text) => ({ id: createAnchorId(text), text, enabled: true }));
          if (newAnchors.length > 0) {
            currentSite.anchors.push(...newAnchors);
            addedCount = newAnchors.length;
            renderAnchorList(currentSite);
          }
        }

        saveEditingSiteDraft();
        persistSitesConfig();
        renderSiteList();
        publishSitesConfigForBatch();

        if (urlAnalyzeStatus) {
          urlAnalyzeStatus.style.display = 'block';
          urlAnalyzeStatus.style.background = '#f0fdf4';
          urlAnalyzeStatus.style.color = '#15803d';
          urlAnalyzeStatus.style.border = '1px solid #bbf7d0';
          let successHtml = `✨ 网页分析完成！已自动填充并保存目标名称、内容描述与 ${addedCount} 个锚文本。`;
          if (data.warning) {
            successHtml += `<br><small style="color: #b45309; font-weight: 500;">ℹ️ ${escapeHtml(data.warning)}</small>`;
          }
          urlAnalyzeStatus.innerHTML = successHtml;
        }
      });
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
      saveEditingSiteDraft();
      persistSitesConfig();
      renderAnchorList(site);
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, '锚文本状态已保存', 2000);
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
    const actionBtn = event.target.closest('[data-anchor-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.anchorAction;
    if (!action || action === 'toggle' || action === 'text') return;

    const row = event.target.closest('.anchor-row');
    const site = getEditingSite();
    if (!row || !site) return;
    const index = site.anchors.findIndex((item) => item.id === row.dataset.anchorId);
    if (index === -1) return;

    if (action === 'delete') {
      site.anchors.splice(index, 1);
      renderAnchorList(site);
      saveEditingSiteDraft();
      persistSitesConfig();
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, '锚文本已删除并保存', 2000);
    } else if (action === 'move-up' && index > 0) {
      const temp = site.anchors[index];
      site.anchors[index] = site.anchors[index - 1];
      site.anchors[index - 1] = temp;
      renderAnchorList(site);
      saveEditingSiteDraft();
      persistSitesConfig();
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, '已上移并保存', 1800);
    } else if (action === 'move-down' && index < site.anchors.length - 1) {
      const temp = site.anchors[index];
      site.anchors[index] = site.anchors[index + 1];
      site.anchors[index + 1] = temp;
      renderAnchorList(site);
      saveEditingSiteDraft();
      persistSitesConfig();
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, '已下移并保存', 1800);
    } else if (action === 'set-primary' && index > 0) {
      const [target] = site.anchors.splice(index, 1);
      site.anchors.unshift(target);
      renderAnchorList(site);
      saveEditingSiteDraft();
      persistSitesConfig();
      publishSitesConfigForBatch();
      showStatus(settingsStatusEl, '已将该词设为主锚文本并保存', 2000);
    }
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
