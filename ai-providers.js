// 本地 AI Provider 调用层：负责读取插件配置并统一调用兼容 OpenAI Chat Completions 的模型服务。
export const AI_CONFIG_STORAGE_KEY = 'auto_comment_ai_config';

const DEFAULT_PROVIDER_ID = 'dashscope';

/**
 * 内置 Provider 模板，用户保存 API Key 后即可直接使用。
 * type 枚举：
 * - openai_compatible：兼容 OpenAI Chat Completions 协议的接口。
 */
const DEFAULT_AI_CONFIG = {
  activeProviderId: DEFAULT_PROVIDER_ID,
  providers: [
    {
      id: DEFAULT_PROVIDER_ID,
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeBaseUrl(value) {
  return normalizeText(value).replace(/\/+$/, '');
}

function buildProviderId(name) {
  const normalized = normalizeText(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || `provider_${Date.now().toString(36)}`;
}

export function normalizeProvider(provider) {
  const name = normalizeText(provider && provider.name) || '自定义 Provider';
  return {
    id: normalizeText(provider && provider.id) || buildProviderId(name),
    name,
    type: 'openai_compatible',
    baseUrl: normalizeBaseUrl(provider && provider.baseUrl),
    apiKey: normalizeText(provider && provider.apiKey),
    model: normalizeText(provider && provider.model),
    temperature: normalizeNumber(provider && provider.temperature, 0.7, 0, 2),
    maxTokens: Math.round(normalizeNumber(provider && provider.maxTokens, 800, 1, 32000))
  };
}

export function normalizeAiConfig(config) {
  const rawProviders = Array.isArray(config && config.providers)
    ? config.providers
    : DEFAULT_AI_CONFIG.providers;
  const providers = rawProviders.map(normalizeProvider);
  const providerIds = new Set(providers.map((provider) => provider.id));
  for (const defaultProvider of DEFAULT_AI_CONFIG.providers) {
    if (!providerIds.has(defaultProvider.id)) {
      providers.push(normalizeProvider(defaultProvider));
    }
  }
  const activeProviderId = providers.some((provider) => provider.id === config?.activeProviderId)
    ? config.activeProviderId
    : providers[0]?.id || DEFAULT_PROVIDER_ID;

  return {
    activeProviderId,
    providers
  };
}

export async function loadAiConfig() {
  const stored = await chrome.storage.local.get([AI_CONFIG_STORAGE_KEY]);
  if (!stored[AI_CONFIG_STORAGE_KEY]) {
    const defaults = clone(DEFAULT_AI_CONFIG);
    await chrome.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: defaults });
    return defaults;
  }
  return normalizeAiConfig(stored[AI_CONFIG_STORAGE_KEY]);
}

export async function saveAiConfig(config) {
  const normalized = normalizeAiConfig(config);
  await chrome.storage.local.set({ [AI_CONFIG_STORAGE_KEY]: normalized });
  return normalized;
}

export async function getActiveProvider() {
  const config = await loadAiConfig();
  return config.providers.find((provider) => provider.id === config.activeProviderId) || config.providers[0] || null;
}

function buildChatCompletionsUrl(provider) {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  if (!baseUrl) {
    throw new Error('请先配置 AI Provider 的 Base URL');
  }
  if (/\/chat\/completions$/i.test(baseUrl)) {
    return baseUrl;
  }
  return `${baseUrl}/chat/completions`;
}

function extractOpenAiCompatibleText(data) {
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text === 'string' && text.trim()) return text.trim();
  const fallbackText = data?.choices?.[0]?.text;
  if (typeof fallbackText === 'string' && fallbackText.trim()) return fallbackText.trim();
  throw new Error('AI 响应中没有找到可用的评论内容');
}

async function callOpenAiCompatible(provider, payload) {
  if (!provider.apiKey) {
    throw new Error(`请先在设置页为「${provider.name}」配置 API Key`);
  }
  if (!provider.model) {
    throw new Error(`请先在设置页为「${provider.name}」配置模型名称`);
  }

  const response = await fetch(buildChatCompletionsUrl(provider), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: payload.systemPrompt },
        { role: 'user', content: payload.userPrompt }
      ],
      temperature: provider.temperature,
      max_tokens: provider.maxTokens
    })
  });

  const responseText = await response.text();
  let data = null;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || responseText || `HTTP ${response.status}`;
    throw new Error(`AI 调用失败：${message}`);
  }

  return extractOpenAiCompatibleText(data);
}

export async function generateCommentWithActiveProvider(payload) {
  const provider = await getActiveProvider();
  if (!provider) {
    throw new Error('请先在设置页配置至少一个 AI Provider');
  }
  return callOpenAiCompatible(provider, payload);
}

export async function testProvider(providerLike) {
  const provider = normalizeProvider(providerLike);
  const text = await callOpenAiCompatible(provider, {
    systemPrompt: '你是一个用于测试连接的助手，请只返回一句简短中文。',
    userPrompt: '请回复：连接成功'
  });
  return { ok: true, text };
}
