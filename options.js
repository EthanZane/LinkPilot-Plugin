const WEBSITE_URL_STORAGE_KEY = 'promotion_website_url';
const WEBSITE_CONTENT_STORAGE_KEY = 'promotion_website_content';
const USER_NAME_STORAGE_KEY = 'auto_fill_user_name';
const USER_EMAIL_STORAGE_KEY = 'auto_fill_user_email';
const USER_PASSWORD_STORAGE_KEY = 'auto_fill_user_password';
const LEGACY_SKILL_TEMPLATE_STORAGE_KEY = 'qwen_skill_template';
const LEGACY_PROMPT_FIELD_VALUES_STORAGE_KEY = 'auto_fill_prompt_field_values';
const SHOW_EXPORT_OUTLINKS_FLOATING_BUTTON_STORAGE_KEY = 'show_export_outlinks_floating_button';
const AI_CONFIG_STORAGE_KEY = 'auto_comment_ai_config';

const CONFIG_VERSION = 3;

const ACTIVE_STORAGE_KEYS = [
  WEBSITE_URL_STORAGE_KEY,
  WEBSITE_CONTENT_STORAGE_KEY,
  USER_NAME_STORAGE_KEY,
  USER_EMAIL_STORAGE_KEY,
  USER_PASSWORD_STORAGE_KEY,
  SHOW_EXPORT_OUTLINKS_FLOATING_BUTTON_STORAGE_KEY
];

const IMPORT_COMPAT_STORAGE_KEYS = [
  ...ACTIVE_STORAGE_KEYS,
  LEGACY_SKILL_TEMPLATE_STORAGE_KEY,
  LEGACY_PROMPT_FIELD_VALUES_STORAGE_KEY,
  AI_CONFIG_STORAGE_KEY
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
  const websiteUrlInput = document.getElementById('websiteUrl');
  const websiteContentInput = document.getElementById('websiteContent');
  const userNameInput = document.getElementById('userName');
  const userEmailInput = document.getElementById('userEmail');
  const userPasswordInput = document.getElementById('userPassword');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const settingsStatusEl = document.getElementById('settingsStatus');
  const exportConfigBtn = document.getElementById('exportConfigBtn');
  const importConfigBtn = document.getElementById('importConfigBtn');
  const importConfigFileInput = document.getElementById('importConfigFileInput');
  const importExportStatus = document.getElementById('importExportStatus');
  const openBatchBtn = document.getElementById('openBatchBtn');
  const toggleExportOutlinksFloatingBtn = document.getElementById('toggleExportOutlinksFloatingBtn');

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

  if (!websiteUrlInput || !websiteContentInput || !userNameInput || !userEmailInput || !saveSettingsBtn) {
    console.error('设置页初始化失败：关键表单元素不存在');
    return;
  }

  let showExportOutlinksFloatingButton = true;
  let aiConfig = clone(DEFAULT_AI_CONFIG);
  let editingProviderId = DEFAULT_AI_CONFIG.activeProviderId;

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

  function renderExportOutlinksFloatingToggle() {
    if (!toggleExportOutlinksFloatingBtn) return;
    toggleExportOutlinksFloatingBtn.textContent = showExportOutlinksFloatingButton ? '隐藏导出外链按钮' : '显示导出外链按钮';
    toggleExportOutlinksFloatingBtn.classList.toggle('btn-primary', !showExportOutlinksFloatingButton);
    toggleExportOutlinksFloatingBtn.classList.toggle('btn-secondary', showExportOutlinksFloatingButton);
    toggleExportOutlinksFloatingBtn.title = showExportOutlinksFloatingButton
      ? '点击后页面不再显示“导出外链”浮动按钮'
      : '点击后页面显示“导出外链”浮动按钮';
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
      '网站链接',
      '网址',
      'website link',
      'website url',
      'url'
    ]);
  }

  function getLegacyWebsiteContent(data) {
    return pickLegacyPromptValue(data[LEGACY_PROMPT_FIELD_VALUES_STORAGE_KEY], [
      '网站内容',
      '网站介绍',
      'website content',
      'site content',
      'description'
    ]);
  }

  function loadSettings() {
    chrome.storage.sync.get(IMPORT_COMPAT_STORAGE_KEYS, (syncResult) => {
      if (chrome.runtime.lastError) {
        console.error('读取设置失败：', chrome.runtime.lastError);
        return;
      }

      const data = syncResult || {};
      websiteUrlInput.value = typeof data[WEBSITE_URL_STORAGE_KEY] === 'string'
        ? data[WEBSITE_URL_STORAGE_KEY]
        : getLegacyWebsiteUrl(data);
      websiteContentInput.value = typeof data[WEBSITE_CONTENT_STORAGE_KEY] === 'string'
        ? data[WEBSITE_CONTENT_STORAGE_KEY]
        : getLegacyWebsiteContent(data);
      userNameInput.value = typeof data[USER_NAME_STORAGE_KEY] === 'string' ? data[USER_NAME_STORAGE_KEY] : '';
      userEmailInput.value = typeof data[USER_EMAIL_STORAGE_KEY] === 'string' ? data[USER_EMAIL_STORAGE_KEY] : '';
      userPasswordInput.value = typeof data[USER_PASSWORD_STORAGE_KEY] === 'string' ? data[USER_PASSWORD_STORAGE_KEY] : '';
      showExportOutlinksFloatingButton = data[SHOW_EXPORT_OUTLINKS_FLOATING_BUTTON_STORAGE_KEY] !== false;
      renderExportOutlinksFloatingToggle();
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
    { el: websiteUrlInput, label: '网站链接' },
    { el: websiteContentInput, label: '网站内容' },
    { el: userNameInput, label: '姓名/昵称' },
    { el: userEmailInput, label: '邮箱' }
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
    });
  });

  saveSettingsBtn.addEventListener('click', () => {
    if (!validateRequiredSettings()) return;

    chrome.storage.sync.set(
      {
        [WEBSITE_URL_STORAGE_KEY]: websiteUrlInput.value.trim(),
        [WEBSITE_CONTENT_STORAGE_KEY]: websiteContentInput.value.trim(),
        [USER_NAME_STORAGE_KEY]: userNameInput.value.trim(),
        [USER_EMAIL_STORAGE_KEY]: userEmailInput.value.trim(),
        [USER_PASSWORD_STORAGE_KEY]: userPasswordInput.value.trim()
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error('保存自动填表设置失败：', chrome.runtime.lastError);
          showStatus(settingsStatusEl, '保存失败', 2000);
          return;
        }
        showStatus(settingsStatusEl, '已保存');
      }
    );
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

  if (toggleExportOutlinksFloatingBtn) {
    renderExportOutlinksFloatingToggle();
    toggleExportOutlinksFloatingBtn.addEventListener('click', () => {
      const nextValue = !showExportOutlinksFloatingButton;
      chrome.storage.sync.set(
        { [SHOW_EXPORT_OUTLINKS_FLOATING_BUTTON_STORAGE_KEY]: nextValue },
        () => {
          if (chrome.runtime.lastError) {
            console.error('保存导出外链浮动按钮设置失败：', chrome.runtime.lastError);
            showStatus(settingsStatusEl, '保存失败', 2000);
            return;
          }
          showExportOutlinksFloatingButton = nextValue;
          renderExportOutlinksFloatingToggle();
          showStatus(settingsStatusEl, nextValue ? '已显示导出外链按钮' : '已隐藏导出外链按钮');
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
      chrome.storage.sync.get(ACTIVE_STORAGE_KEYS, (syncResult) => {
        if (chrome.runtime.lastError) {
          showImportExportStatus('导出失败：' + chrome.runtime.lastError.message, true);
          return;
        }

        chrome.storage.local.get([AI_CONFIG_STORAGE_KEY], (localResult) => {
          const mergedData = {
            ...syncResult,
            [WEBSITE_URL_STORAGE_KEY]: websiteUrlInput.value.trim(),
            [WEBSITE_CONTENT_STORAGE_KEY]: websiteContentInput.value.trim(),
            [USER_NAME_STORAGE_KEY]: userNameInput.value.trim(),
            [USER_EMAIL_STORAGE_KEY]: userEmailInput.value.trim(),
            [USER_PASSWORD_STORAGE_KEY]: userPasswordInput.value.trim()
          };
          const sanitizedAiConfig = normalizeAiConfig(localResult[AI_CONFIG_STORAGE_KEY] || aiConfig);
          sanitizedAiConfig.providers = sanitizedAiConfig.providers.map((provider) => ({
            ...provider,
            apiKey: ''
          }));

          const config = {
            _version: CONFIG_VERSION,
            _exportTime: new Date().toISOString(),
            _note: '出于安全考虑，导出的配置不会包含 AI API Key。',
            data: {
              ...mergedData,
              [AI_CONFIG_STORAGE_KEY]: sanitizedAiConfig
            }
          };

          if (!config.data[WEBSITE_CONTENT_STORAGE_KEY]) {
            showImportExportStatus('导出失败：请先填写你的网站内容。', true);
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
          showImportExportStatus('配置已导出，API Key 未包含在文件中。', false);
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
          ACTIVE_STORAGE_KEYS.forEach((key) => {
            if (importedData[key] !== undefined) {
              syncToSave[key] = importedData[key];
            }
          });

          if (syncToSave[WEBSITE_URL_STORAGE_KEY] === undefined) {
            const legacyWebsiteUrl = getLegacyWebsiteUrl(importedData);
            if (legacyWebsiteUrl) syncToSave[WEBSITE_URL_STORAGE_KEY] = legacyWebsiteUrl;
          }

          if (syncToSave[WEBSITE_CONTENT_STORAGE_KEY] === undefined) {
            const legacyWebsiteContent = getLegacyWebsiteContent(importedData);
            if (legacyWebsiteContent) syncToSave[WEBSITE_CONTENT_STORAGE_KEY] = legacyWebsiteContent;
          }

          const localToSave = {};
          if (importedData[AI_CONFIG_STORAGE_KEY]) {
            localToSave[AI_CONFIG_STORAGE_KEY] = normalizeAiConfig(importedData[AI_CONFIG_STORAGE_KEY]);
          }

          chrome.storage.sync.set(syncToSave, () => {
            if (chrome.runtime.lastError) {
              showImportExportStatus('导入失败：' + chrome.runtime.lastError.message, true);
              return;
            }
            chrome.storage.local.set(localToSave, () => {
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

  if (openBatchBtn) {
    openBatchBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'batch.html' });
    });
  }

  loadSettings();
});
