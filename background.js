import { generateCommentWithActiveProvider, testProvider } from './ai-providers.js';

// 点击扩展图标时打开设置页，个人版所有配置都集中在这里维护。
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
});

// AI 生成请求统一由后台 Service Worker 发起，避免 content script 分散保存 Provider 调用细节。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'GENERATE_COMMENT') {
    (async () => {
      try {
        const text = await generateCommentWithActiveProvider(message.payload || {});
        sendResponse({ ok: true, text });
      } catch (error) {
        console.error('[background] AI 评论生成失败:', error);
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true;
  }

  if (message && message.type === 'TEST_AI_PROVIDER') {
    (async () => {
      try {
        const result = await testProvider(message.provider || {});
        sendResponse({ ok: true, text: result.text });
      } catch (error) {
        console.error('[background] AI Provider 测试失败:', error);
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true;
  }

  if (message && message.type === 'ANALYZE_PROMOTION_URL') {
    (async () => {
      try {
        const data = await handleAnalyzePromotionUrl(message.url);
        sendResponse({ ok: true, data });
      } catch (error) {
        console.error('[background] 推广页面抓取与分析失败:', error);
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true;
  }
});

/**
 * 将批量结果写入 storage（本地存储，由 batch.js 轮询读取）
 */
async function persistBatchReport(message) {
  const { batchId, urlIndex, url: pageUrl = '', result, aiContent, errorMessage } = message;
  console.log('[background] persistBatchReport >>>', { batchId, urlIndex, url: pageUrl, result, aiContentLen: aiContent ? aiContent.length : 0, errorMessage, time: new Date().toISOString() });

  const data = await chrome.storage.local.get(['batchResults', 'batchReportedUrls']);
  const results = Array.isArray(data.batchResults) ? data.batchResults : [];
  const promotionSiteMetadata = {};
  if (message.promotionSiteId) promotionSiteMetadata.promotionSiteId = message.promotionSiteId;
  if (message.promotionSiteName) promotionSiteMetadata.promotionSiteName = message.promotionSiteName;
  if (message.promotionSiteUrl) promotionSiteMetadata.promotionSiteUrl = message.promotionSiteUrl;
  const pageMetrics = message.pageMetrics && typeof message.pageMetrics === 'object'
    ? { pageMetrics: message.pageMetrics }
    : {};
  const entry = {
    batchId,
    urlIndex,
    url: pageUrl,
    result,
    aiContent,
    errorMessage,
    ...promotionSiteMetadata,
    ...pageMetrics,
    timestamp: Date.now()
  };
  const existingIndex = results.findIndex((item) => item.batchId === batchId && item.urlIndex === urlIndex);
  if (existingIndex >= 0) {
    results[existingIndex] = { ...results[existingIndex], ...entry };
  } else {
    results.push(entry);
  }
  if (results.length > 100) results.shift();

  let reported = data.batchReportedUrls || [];
  if (!Array.isArray(reported)) reported = [];
  const urlKey = `${batchId}:${urlIndex}`;
  if (!reported.includes(urlKey)) {
    reported.push(urlKey);
    if (reported.length > 500) reported.shift();
  }

  await chrome.storage.local.set({ batchResults: results, batchReportedUrls: reported });
  console.log('[background] persistBatchReport <<< 写入完成, 当前results长度:', results.length, 'time:', new Date().toISOString());
  return results.find((item) => item.batchId === batchId && item.urlIndex === urlIndex) || entry;
}

// content.js 确认评论已提交（标签页可能刷新，context 丢失，background 仍活着）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'BATCH_HANDLE_CONFIRM') {
    console.log('[background] 收到 BATCH_HANDLE_CONFIRM >>>', { batchId: message.batchId, urlIndex: message.urlIndex, url: message.url, aiContentLen: message.aiContent ? message.aiContent.length : 0, sender: sender.tab ? sender.tab.id : 'N/A', time: new Date().toISOString() });
    (async () => {
      try {
        const persistedEntry = await persistBatchReport({
          batchId: message.batchId,
          urlIndex: message.urlIndex,
          url: message.url || '',
          result: message.result || 'success',
          aiContent: message.aiContent || null,
          errorMessage: message.errorMessage || null,
          promotionSiteId: message.promotionSiteId || '',
          promotionSiteName: message.promotionSiteName || '',
          promotionSiteUrl: message.promotionSiteUrl || ''
        });
        console.log('[background] persistBatchReport 完成，准备发送 BATCH_CONFIRMED');

        // 关键：先通知 batch.js（popup）落盘已完成，batch.js 等到确认后才关闭标签页
        // 再转发给 popup（batch.js），确保 batch.js 收到后再关 tab
        chrome.runtime.sendMessage({
          type: 'BATCH_CONFIRMED',
          urlIndex: message.urlIndex,
          result: message.result || 'success',
          aiContent: message.aiContent || null,
          errorMessage: message.errorMessage || null,
          promotionSiteId: persistedEntry && persistedEntry.promotionSiteId || '',
          promotionSiteName: persistedEntry && persistedEntry.promotionSiteName || '',
          promotionSiteUrl: persistedEntry && persistedEntry.promotionSiteUrl || '',
          pageMetrics: persistedEntry && persistedEntry.pageMetrics || null
        }).then(() => {
          console.log('[background] BATCH_CONFIRMED 发送成功');
        }).catch((e) => {
          if (e.message && e.message.includes('message channel closed')) {
            console.log('[background] BATCH_CONFIRMED 发送失败（接收方已关闭），忽略');
          } else {
            console.error('[background] BATCH_CONFIRMED 发送失败:', e);
          }
        });

        sendResponse({ ok: true });
        console.log('[background] BATCH_HANDLE_CONFIRM <<< sendResponse({ok:true})');
      } catch (e) {
        console.error('[background] BATCH_HANDLE_CONFIRM 错误:', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});

// 批量任务结果：content / batch 页 -> background 持久化
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'BATCH_REPORT_RESULT') {
    console.log('[background] 收到 BATCH_REPORT_RESULT >>>', { batchId: message.batchId, urlIndex: message.urlIndex, result: message.result, sender: sender.tab ? sender.tab.id : 'N/A', time: new Date().toISOString() });
    (async () => {
      try {
        const persistedEntry = await persistBatchReport(message);
        // 失败等非提交结果同样要通知批量页，避免只能等到外层超时后才显示结果和页面指标。
        chrome.runtime.sendMessage({
          type: 'BATCH_CONFIRMED',
          urlIndex: message.urlIndex,
          result: message.result || 'fail',
          aiContent: message.aiContent || null,
          errorMessage: message.errorMessage || null,
          promotionSiteId: persistedEntry && persistedEntry.promotionSiteId || '',
          promotionSiteName: persistedEntry && persistedEntry.promotionSiteName || '',
          promotionSiteUrl: persistedEntry && persistedEntry.promotionSiteUrl || '',
          pageMetrics: persistedEntry && persistedEntry.pageMetrics || null
        }).catch((error) => {
          console.log('[background] 非提交结果确认消息无人接收，结果已完成本地保存:', error.message || String(error));
        });
        console.log('[background] BATCH_REPORT_RESULT <<< sendResponse({ok:true})');
        sendResponse({ ok: true });
      } catch (e) {
        console.error('[background] BATCH_REPORT_RESULT 错误:', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});

/**
 * HTML 实体解码器，将网页中常见 HTML 实体转回纯文本
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return !isNaN(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return !isNaN(code) ? String.fromCharCode(code) : '';
    });
}

/**
 * 提取 Meta 标签内容，兼容 name="..." 与 property="..." 以及 content 顺序颠倒的情况
 */
function extractMetaContent(html, nameOrProp) {
  const re = new RegExp(
    `<meta\\s+[^>]*(?:name|property)=["']${nameOrProp}["'][^>]*content=["']([^"']*)["']`,
    'i'
  );
  let match = html.match(re);
  if (match) return decodeHtmlEntities(match[1].trim());

  const reReverse = new RegExp(
    `<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${nameOrProp}["']`,
    'i'
  );
  match = html.match(reReverse);
  if (match) return decodeHtmlEntities(match[1].trim());

  return '';
}

/**
 * 从 HTML 中解析网页元数据、主要标题与正文摘要
 */
function extractPageMetadataAndText(html, targetUrl) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle = decodeHtmlEntities(titleMatch ? titleMatch[1].trim() : '');
  const metaDescription =
    extractMetaContent(html, 'description') ||
    extractMetaContent(html, 'og:description') ||
    extractMetaContent(html, 'twitter:description');
  const metaKeywords = extractMetaContent(html, 'keywords');
  const ogSiteName = extractMetaContent(html, 'og:site_name');
  const ogTitle = extractMetaContent(html, 'og:title');

  // 提取 h1, h2, h3 标题
  const headings = [];
  const headingRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hMatch;
  while ((hMatch = headingRegex.exec(html)) !== null && headings.length < 8) {
    const text = decodeHtmlEntities(hMatch[2].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (text && text.length >= 2 && text.length <= 80 && !headings.includes(text)) {
      headings.push(text);
    }
  }

  // 提取正文摘要，剔除脚本、样式与无用标签
  const cleanHtml = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ');

  const bodyText = decodeHtmlEntities(cleanHtml.replace(/<[^>]+>/g, ' '))
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const bodySnippet = bodyText.slice(0, 3000);

  return {
    rawTitle,
    ogTitle,
    ogSiteName,
    metaDescription,
    metaKeywords,
    headings,
    bodySnippet
  };
}

/**
 * 检测网页的主要语言
 */
function detectPageLanguage(html, textSample) {
  const htmlLangMatch = html.match(/<html[^>]+lang=["']?([a-zA-Z_-]+)/i);
  const langAttr = htmlLangMatch ? htmlLangMatch[1].toLowerCase() : '';

  const sample = (textSample || '').slice(0, 1500);
  const total = sample.replace(/\s+/g, '').length || 1;
  const cjkCount = (sample.match(/[\u4e00-\u9fa5]/g) || []).length;
  const kanaCount = (sample.match(/[\u3040-\u30ff]/g) || []).length;
  const hangulCount = (sample.match(/[\uac00-\ud7af]/g) || []).length;

  if (kanaCount / total > 0.05) return { code: 'ja', name: 'Japanese' };
  if (hangulCount / total > 0.05) return { code: 'ko', name: 'Korean' };
  if (cjkCount / total > 0.12) return { code: 'zh', name: 'Chinese' };

  if (langAttr.startsWith('zh')) return { code: 'zh', name: 'Chinese' };
  if (langAttr.startsWith('ja')) return { code: 'ja', name: 'Japanese' };
  if (langAttr.startsWith('ko')) return { code: 'ko', name: 'Korean' };
  if (langAttr.startsWith('fr')) return { code: 'fr', name: 'French' };
  if (langAttr.startsWith('de')) return { code: 'de', name: 'German' };
  if (langAttr.startsWith('es')) return { code: 'es', name: 'Spanish' };
  if (langAttr.startsWith('ru')) return { code: 'ru', name: 'Russian' };
  if (langAttr.startsWith('pt')) return { code: 'pt', name: 'Portuguese' };

  return { code: 'en', name: 'English' };
}

/**
 * 启发式规则兜底：当 AI Provider 未配置或调用出错时，直接从网页元数据解析出基础信息（严格遵循网页原生语言）
 */
function buildPromotionInfoFromMetadata(meta, currentUrl, lang) {
  let hostname = '';
  try {
    hostname = new URL(currentUrl).hostname.replace(/^www\./i, '');
  } catch (_) {}

  const isEn = lang && lang.code === 'en';

  // 1. 推断品牌/网站名称
  let name = meta.ogSiteName || '';
  if (!name && meta.rawTitle) {
    const parts = meta.rawTitle.split(/\s*[-|_|—|–|:|\/]\s*|\s+by\s+/i);
    const candidate = parts[0].trim();
    if (candidate && candidate.length >= 2 && candidate.length <= 40 && !/^(home|index|official|首页|官网)$/i.test(candidate)) {
      name = candidate;
    } else if (parts[1] && parts[1].trim().length >= 2 && parts[1].trim().length <= 40) {
      name = parts[1].trim();
    }
  }
  if (!name && hostname) {
    const base = hostname.split('.')[0];
    name = base.charAt(0).toUpperCase() + base.slice(1);
  }
  if (!name) name = isEn ? 'Promotion Target' : '推广目标';

  // 2. 提取网站核心内容
  let content = meta.metaDescription || '';
  if (!content || content.length < 25) {
    const snippets = [];
    if (meta.headings && meta.headings.length > 0) {
      snippets.push(meta.headings.slice(0, 3).join(isEn ? '; ' : '；'));
    }
    if (meta.bodySnippet) {
      snippets.push(meta.bodySnippet.slice(0, 250));
    }
    content = (content ? content + (isEn ? '. ' : '。') : '') + snippets.join(isEn ? '. ' : '。');
  }
  if (!content) {
    content = isEn
      ? `${name} is an online platform offering relevant services, tools, and experiences.`
      : `${name} 官方网站与在线服务平台，提供相关功能与产品体验。`;
  }

  // 3. 提取锚文本
  const anchors = [];
  if (name) anchors.push(name);
  if (meta.metaKeywords) {
    const kwList = meta.metaKeywords.split(/[,，;|]/).map((k) => k.trim()).filter(Boolean);
    for (const kw of kwList) {
      if (kw.length >= 2 && kw.length <= 30 && !anchors.some((a) => a.toLowerCase() === kw.toLowerCase())) {
        anchors.push(kw);
      }
      if (anchors.length >= 5) break;
    }
  }
  if (anchors.length < 3 && meta.headings) {
    for (const h of meta.headings) {
      const cleanH = h.split(/\s*[-|_|—|:|,]\s*/)[0].trim();
      if (cleanH.length >= 2 && cleanH.length <= 30 && !anchors.some((a) => a.toLowerCase() === cleanH.toLowerCase())) {
        anchors.push(cleanH);
      }
      if (anchors.length >= 4) break;
    }
  }

  return {
    name,
    content,
    anchors: anchors.slice(0, 5)
  };
}

/**
 * 解析 AI 返回的 JSON 格式
 */
function parseAiJsonResponse(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('AI 返回内容为空');
  }
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI 返回的数据不是合法 JSON 对象');
  }
  return parsed;
}

/**
 * 完整处理流程：抓取目标网页 -> 提取元数据与正文 -> 调用 AI Provider 分析生成 -> 启发式兜底
 */
async function handleAnalyzePromotionUrl(targetUrl) {
  let rawUrl = String(targetUrl || '').trim();
  if (!rawUrl) {
    throw new Error('请输入有效的网页 URL');
  }
  if (!/^https?:\/\//i.test(rawUrl)) {
    rawUrl = `https://${rawUrl}`;
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (_) {
    throw new Error('URL 格式不正确');
  }

  // 1. 抓取网页 HTML
  let html = '';
  let finalUrl = parsedUrl.href;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);
    const res = await fetch(parsedUrl.href, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    clearTimeout(timeoutId);
    finalUrl = res.url || parsedUrl.href;
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const buffer = await res.arrayBuffer();
    let charset = 'utf-8';
    const contentType = res.headers.get('content-type') || '';
    const charsetMatch = contentType.match(/charset=([a-zA-Z0-9_-]+)/i);
    if (charsetMatch) {
      charset = charsetMatch[1].toLowerCase();
    }
    try {
      html = new TextDecoder(charset).decode(buffer);
    } catch (_) {
      html = new TextDecoder('utf-8').decode(buffer);
    }

    // 检查 meta charset
    const metaCharsetMatch = html.match(/<meta[^>]+charset=["']?([a-zA-Z0-9_-]+)/i) ||
      html.match(/<meta[^>]+http-equiv=["']?Content-Type["']?[^>]+content=["'][^"']*charset=([a-zA-Z0-9_-]+)/i);
    if (metaCharsetMatch && metaCharsetMatch[1]) {
      const detected = metaCharsetMatch[1].toLowerCase();
      if (detected !== charset && (detected.includes('gbk') || detected.includes('gb2312'))) {
        try {
          html = new TextDecoder(detected).decode(buffer);
        } catch (_) {}
      }
    }
  } catch (err) {
    throw new Error(`抓取目标网页失败：${err.message || '网络连接超时或无法访问'}`);
  }

  // 2. 解析元数据与语言
  const meta = extractPageMetadataAndText(html, finalUrl);
  const lang = detectPageLanguage(html, `${meta.rawTitle} ${meta.metaDescription} ${meta.bodySnippet}`);
  const heuristic = buildPromotionInfoFromMetadata(meta, finalUrl, lang);

  // 3. 构建 AI 分析提示词并调用
  const systemPrompt = `You are a professional global SEO and brand marketing expert.
You analyze promotional webpages to extract brand names, compelling promotional descriptions, and high-converting backlink anchor texts.
CRITICAL MANDATE: All output fields must strictly match the detected primary language of the target webpage. Never translate the content into another language.`;

  const userPrompt = `Please analyze the following promotion webpage and extract its brand name, core promotional description, and optimal backlink anchor texts.

【Target Webpage URL】: ${finalUrl}
【Detected Webpage Language】: ${lang.name} (${lang.code})
【Page Title】: ${meta.rawTitle || 'N/A'}
【Site Name】: ${meta.ogSiteName || 'N/A'}
【Meta Description】: ${meta.metaDescription || 'N/A'}
【Keywords】: ${meta.metaKeywords || 'N/A'}
【Main Headings】: ${meta.headings.join(' | ') || 'N/A'}
【Body Content Excerpt】:
${meta.bodySnippet || 'N/A'}

==================================================
【CRITICAL LANGUAGE REQUIREMENT / 语言严格一致性铁律】：
The target page is written in "${lang.name}". You MUST generate ALL fields ("name", "content", and all "anchors") in the EXACT SAME LANGUAGE as the target webpage!
- If the page is in English: "name", "content", and every single item in "anchors" MUST BE IN NATURAL, NATIVE ENGLISH. NEVER output Chinese words or translate into Chinese!
- If the page is in Chinese: All fields must be in Chinese.
- If the page is in another language (e.g. Japanese, Spanish, German, French): All fields must be in that corresponding language.
Do NOT translate the target content into any other language!
==================================================

【Field Specifications】:
1. "name": The clean official brand or product name (e.g. "Banana AI", "Mireka", "Notion"). Remove any extra SEO taglines, domain extensions, or site suffixes. Keep original language and capitalization.
2. "content": A compelling promotional description (around 80~140 words for English, or 100~200 characters for Chinese) entirely written in the webpage's native language (${lang.name}). Highlight what the product is, its core features, key value propositions, problem it solves, and ideal audience. This description will be used as reference context to generate relevant blog comments in the same language.
3. "anchors": Array of 3 to 6 high-ranking, natural anchor text keywords strictly in the webpage's native language (${lang.name}). The FIRST item MUST be the primary core anchor text (official brand or main core product keyword), followed by secondary feature keywords and natural industry variations (e.g. for an English Banana AI article: ["Banana AI", "AI video generator", "multimodal AI creation", "text to video tool", "visual content creator"]). Absolutely NO Chinese if the page is English!

【OUTPUT FORMAT】:
Output ONLY a valid JSON object without any markdown code fence (do not write \`\`\`json):
{
  "name": "...",
  "content": "...",
  "anchors": ["...", "..."]
}`;

  let aiResult = null;
  let warning = '';
  try {
    const rawAiText = await generateCommentWithActiveProvider({ systemPrompt, userPrompt });
    aiResult = parseAiJsonResponse(rawAiText);
  } catch (aiErr) {
    console.warn('[background] AI 分析调用失败，采用启发式元数据解析兜底:', aiErr);
    warning = `已通过网页元数据自动生成（AI 分析未生效：${aiErr.message || '服务异常'}）`;
  }

  const finalName = (aiResult && typeof aiResult.name === 'string' && aiResult.name.trim()) || heuristic.name || '未命名目标';
  const finalContent = (aiResult && typeof aiResult.content === 'string' && aiResult.content.trim()) || heuristic.content || '';
  let finalAnchors = (aiResult && Array.isArray(aiResult.anchors))
    ? aiResult.anchors.map((a) => String(a || '').trim()).filter(Boolean)
    : [];
  if (finalAnchors.length === 0) {
    finalAnchors = heuristic.anchors;
  }

  return {
    url: finalUrl,
    name: finalName,
    content: finalContent,
    anchors: finalAnchors,
    warning: warning || null
  };
}

