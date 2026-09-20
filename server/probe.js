import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

/**
 * 将任意 URL 或域名转换成标准域名：去掉协议、路径和开头的 www.，并统一小写。
 */
export function normalizeDomain(value) {
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
 * 常见博客系统与评论表单指纹库
 */
const BLOG_DETECTION_PATTERNS = {
  // WordPress 标配评论表单
  wordpress: {
    formActions: [/wp-comments-post\.php/i],
    formIdsOrClasses: [
      /\bid=["']commentform["']/i,
      /\bclass=["'][^"']*comment-form[^"']*["']/i,
      /\bclass=["'][^"']*commentform[^"']*["']/i,
      /\bid=["']comment-form["']/i
    ],
    hiddenPostId: [/name=["']comment_post_ID["']/i],
    commentTextareas: [
      /<textarea[^>]+(?:name|id)=["']comment["']/i,
      /<textarea[^>]+(?:name|id)=["']comment_content["']/i
    ]
  },
  // wpDiscuz 现代交互评论插件
  wpdiscuz: {
    signatures: [
      /wpdiscuz/i,
      /class=["'][^"']*wpd-form[^"']*["']/i,
      /class=["'][^"']*wpdiscuz-comment-text-wrap[^"']*["']/i,
      /id=["']wpd-com-form["']/i
    ]
  },
  // Blogger (Blogspot)
  blogger: {
    signatures: [
      /blogger\.com\/comment-iframe/i,
      /\bid=["']comment-holder["']/i,
      /class=["'][^"']*comment-form[^"']*["']/i
    ]
  },
  // Typecho 博客
  typecho: {
    signatures: [
      /action=["'][^"']*\/comment(?:\?.*)?["']/i,
      /<textarea[^>]+name=["']text["']/i
    ]
  }
};

/**
 * 评论已关闭特征（Negative Fingerprints）
 */
const CLOSED_PATTERNS = [
  /comments are closed/i,
  /comments have been closed/i,
  /comments are disabled/i,
  /discussion is closed/i,
  /comments are not accepted/i,
  /评论已关闭/i,
  /评论功能已关闭/i,
  /已关闭评论/i
];

/**
 * 必须登录才能评论特征
 */
const LOGIN_REQUIRED_PATTERNS = [
  /you must be logged in to (?:post|leave) a comment/i,
  /you need to be logged in to comment/i,
  /must be logged in to reply/i,
  /必须登录后(?:才能)?(?:发表|发布|进行)?评论/i,
  /请登录后评论/i
];

/**
 * 排除非博客场景（如联系我们表单、登录表单、搜索表单）
 */
const NON_BLOG_FALSE_POSITIVES = {
  searchOnly: /role=["']search["']|action=["'][^"']*search/i,
  contactOnly: /class=["'][^"']*wpcf7-form[^"']*["']|class=["'][^"']*contact-form[^"']*["']/i
};

/**
 * 分析 HTML 文本，判断是否为博客评论页面并提取字段支持情况
 * @param {string} html 页面 HTML 源代码
 * @param {string} url 页面 URL
 * @returns {object} 判定详情
 */
export function analyzeBlogCommentPage(html, url, pageTitle = '') {
  if (!html || typeof html !== 'string') {
    return {
      isBlogComment: false,
      status: 'error',
      statusLabel: 'HTML 为空',
      confidence: 'none',
      formType: 'none',
      hasUrlField: false,
      hasAuthorField: false,
      hasEmailField: false,
      hasCommentField: false,
      loginRequired: false,
      commentsClosed: false,
      title: pageTitle || '',
      details: '页面未返回可解析的 HTML 内容'
    };
  }

  // 1. 评论关闭检测
  const commentsClosed = CLOSED_PATTERNS.some((p) => p.test(html));

  // 2. 登录要求检测
  const loginRequired = LOGIN_REQUIRED_PATTERNS.some((p) => p.test(html));

  // 3. 字段提取
  // 3.1 评论输入框
  const hasCommentField =
    /<textarea[^>]+(?:name|id)=["']comment["']/i.test(html) ||
    /<textarea[^>]+(?:name|id)=["']comment_content["']/i.test(html) ||
    /<textarea[^>]+name=["'](?:text|message|content)["']/i.test(html) ||
    /contenteditable=["']true["'][^>]*wpdiscuz/i.test(html);

  // 3.2 外链网站 URL 输入框（核心高价值指标！）
  const hasUrlField =
    /<input[^>]+name=["']url["']/i.test(html) ||
    /<input[^>]+id=["']url["']/i.test(html) ||
    /<input[^>]+name=["']website["']/i.test(html) ||
    /<input[^>]+name=["']site["']/i.test(html) ||
    /<input[^>]+name=["']user_url["']/i.test(html);

  // 3.3 作者姓名输入框
  const hasAuthorField =
    /<input[^>]+name=["']author["']/i.test(html) ||
    /<input[^>]+name=["']name["']/i.test(html) ||
    /<input[^>]+id=["']author["']/i.test(html);

  // 3.4 电子邮箱输入框
  const hasEmailField =
    /<input[^>]+name=["']email["']/i.test(html) ||
    /<input[^>]+id=["']email["']/i.test(html) ||
    /<input[^>]+type=["']email["']/i.test(html);

  // 4. WordPress 专属检测
  const hasWpPostAction = BLOG_DETECTION_PATTERNS.wordpress.formActions.some((p) => p.test(html));
  const hasWpFormClassOrId = BLOG_DETECTION_PATTERNS.wordpress.formIdsOrClasses.some((p) => p.test(html));
  const hasWpHiddenPostId = BLOG_DETECTION_PATTERNS.wordpress.hiddenPostId.some((p) => p.test(html));
  const isWordPressStandard = hasWpPostAction || (hasWpFormClassOrId && (hasCommentField || hasWpHiddenPostId));

  // 5. wpDiscuz 现代评论插件检测
  const isWpDiscuz = BLOG_DETECTION_PATTERNS.wpdiscuz.signatures.some((p) => p.test(html));

  // 6. Blogger 检测
  const isBlogger = BLOG_DETECTION_PATTERNS.blogger.signatures.some((p) => p.test(html));

  // 7. 通用评论表单检测（Typecho / Ghost / 自定义）
  const hasCommentArea =
    /id=["']comments["']/i.test(html) ||
    /id=["']respond["']/i.test(html) ||
    /class=["'][^"']*comment-respond[^"']*["']/i.test(html) ||
    /class=["'][^"']*comments-area[^"']*["']/i.test(html);

  const isGenericBlog = hasCommentArea && hasCommentField && (hasAuthorField || hasEmailField || hasUrlField);

  // 8. 综合判定打分与状态分类
  let isBlogComment = false;
  let status = 'not_blog_comment';
  let statusLabel = '非博客评论页面';
  let confidence = 'none';
  let formType = 'none';
  let details = '';

  if (isWordPressStandard || isWpDiscuz) {
    formType = isWpDiscuz ? 'WordPress (wpDiscuz)' : 'WordPress (标准评论)';
    confidence = 'high';

    if (commentsClosed && !hasCommentField) {
      status = 'comments_closed';
      statusLabel = '博客但评论已关闭';
      details = '检测到 WordPress 架构，但当前文章已关闭评论';
    } else if (loginRequired && !hasCommentField) {
      status = 'login_required';
      statusLabel = '博客但需登录';
      details = '检测到 WordPress 评论区，但需要先注册登录才能发表评论';
    } else if (hasCommentField) {
      isBlogComment = true;
      status = hasUrlField ? 'valid_blog_comment_with_url' : 'valid_blog_comment_no_url';
      statusLabel = hasUrlField ? '开放评论 (支持独立外链URL)' : '开放评论 (需正文插入外链)';
      details = `命中 ${formType} 表单，作者/邮箱/评论框就绪${hasUrlField ? '，支持专属网站外链字段' : ''}`;
    } else {
      // 虽有 wp-comments-post 或 commentform 标识但无输入框
      status = 'suspect_need_review';
      statusLabel = '疑似博客 (待人工复核)';
      details = '包含 WordPress 评论相关代码，未探测到可见输入框，建议人工打开确认';
    }
  } else if (isBlogger) {
    formType = 'Blogger (跨域评论)';
    confidence = 'high';
    isBlogComment = true;
    status = 'valid_blog_comment_blogger';
    statusLabel = 'Blogger 博客评论';
    details = '命中 Google Blogger 评论框架';
  } else if (isGenericBlog) {
    formType = '通用/独立博客评论';
    confidence = 'medium';
    if (commentsClosed) {
      status = 'comments_closed';
      statusLabel = '博客但评论已关闭';
      details = '检测到评论区容器，但提示评论已关闭';
    } else if (loginRequired) {
      status = 'login_required';
      statusLabel = '博客但需登录';
      details = '检测到评论表单，但提示必须登录后提交';
    } else {
      isBlogComment = true;
      status = hasUrlField ? 'valid_blog_comment_with_url' : 'valid_blog_comment_no_url';
      statusLabel = hasUrlField ? '开放评论 (支持独立外链URL)' : '开放评论 (需正文插入外链)';
      details = `命中通用博客评论结构（含输入框及${hasUrlField ? '网站外链字段' : '作者/邮箱字段'}）`;
    }
  } else if (hasCommentArea && hasCommentField) {
    formType = '未知结构评论框';
    confidence = 'low';
    isBlogComment = true;
    status = 'valid_blog_comment_no_url';
    statusLabel = '开放评论 (需正文插入外链)';
    details = '检测到评论容器与文本框，可能需要正文插入链接';
  } else if (hasCommentArea) {
    status = 'suspect_need_review';
    statusLabel = '疑似博客 (待人工复核)';
    confidence = 'low';
    details = '页面存在 #comments 或 #respond 容器，但未能解析到可填表单';
  }

  return {
    isBlogComment,
    status,
    statusLabel,
    confidence,
    formType,
    hasUrlField,
    hasAuthorField,
    hasEmailField,
    hasCommentField,
    loginRequired,
    commentsClosed,
    title: pageTitle || '',
    details
  };
}

/**
 * 默认过滤规则预置配置
 */
export const DEFAULT_FILTER_RULES = {
  urlBlacklist: {
    enabled: true,
    rules: [
      'yahoo.com',
      '8coint.com',
      'gridinsoft.com',
      'ready.pro',
      'linkz.us',
      'pay.',
      'trackitonline',
      'seo',
      'links',
      'yandex.com'
    ]
  },
  titleBlacklist: {
    enabled: true,
    rules: [
      'backlink',
      'domain',
      'buy',
      'url shared',
      'seo',
      'links'
    ]
  }
};

/**
 * HTML 字符实体反转义
 */
export function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8220;|&ldquo;/g, '“')
    .replace(/&#8221;|&rdquo;/g, '”')
    .replace(/&#8230;|&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCharCode(Number(dec));
      } catch (_) {
        return '';
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch (_) {
        return '';
      }
    });
}

/**
 * 从 HTML 中安全提取网页 <title>
 */
export function extractPageTitle(html) {
  if (!html || typeof html !== 'string') return '';
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return decodeHtmlEntities(match[1]).trim().replace(/\s+/g, ' ');
}

/**
 * 编译单条规则（支持正则表达式、*通配符、普通字符串模糊包含）
 */
export function compileRule(rawRule) {
  const trimmed = String(rawRule || '').trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return null;
  }
  // 正则模式: /pattern/flags
  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    const lastSlash = trimmed.lastIndexOf('/');
    const pattern = trimmed.slice(1, lastSlash);
    const flags = trimmed.slice(lastSlash + 1) || 'i';
    try {
      return { raw: trimmed, type: 'regex', regex: new RegExp(pattern, flags) };
    } catch (_) {}
  }
  // 通配符模式: 包含 *
  if (trimmed.includes('*')) {
    const escaped = trimmed.replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&');
    const regex = new RegExp(escaped.replace(/\\\*/g, '.*'), 'i');
    return { raw: trimmed, type: 'wildcard', regex };
  }
  // 普通关键词模糊包含（大小写不敏感）
  return { raw: trimmed, type: 'substring', needle: trimmed.toLowerCase() };
}

/**
 * 校验文本是否命中已编译的规则
 */
export function matchRule(text, compiledRule) {
  if (!text || !compiledRule) return false;
  if (compiledRule.type === 'substring') {
    return text.toLowerCase().includes(compiledRule.needle);
  }
  if (compiledRule.type === 'regex' || compiledRule.type === 'wildcard') {
    return compiledRule.regex.test(text);
  }
  return false;
}

/**
 * 在一组规则中查找第一条命中的规则（返回匹配到的原始规则文本，未命中返回 null）
 */
export function findMatchingRule(text, ruleList) {
  if (!text || !Array.isArray(ruleList)) return null;
  for (const raw of ruleList) {
    const compiled = compileRule(raw);
    if (compiled && matchRule(text, compiled)) {
      return compiled.raw;
    }
  }
  return null;
}

/**
 * 针对单条 URL 执行 HTTP 抓取与分析
 * @param {string} targetUrl 目标 URL
 * @param {object} [options] 抓取配置（超时、User-Agent、filterRules 等）
 * @returns {Promise<object>}
 */
export async function probeSingleUrl(targetUrl, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 8000);
  const userAgent =
    options.userAgent ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  let normalizedUrl = String(targetUrl || '').trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  const domain = normalizeDomain(normalizedUrl);

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(normalizedUrl, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const elapsedMs = Date.now() - startTime;
    const httpStatus = response.status;

    // 针对 Cloudflare 或 403 / 503 质询进行单独标记
    if (httpStatus === 403 || httpStatus === 503) {
      const errorText = await response.text().catch(() => '');
      const isCloudflare = /cloudflare|attention required|challenge-running/i.test(errorText);
      const pageTitle = extractPageTitle(errorText);
      return {
        url: normalizedUrl,
        domain,
        title: pageTitle,
        httpStatus,
        elapsedMs,
        isBlogComment: false,
        status: 'blocked_challenge',
        statusLabel: isCloudflare ? 'Cloudflare 防护拦截' : `HTTP ${httpStatus} 拒绝访问`,
        confidence: 'medium',
        formType: 'unknown',
        hasUrlField: false,
        hasAuthorField: false,
        hasEmailField: false,
        hasCommentField: false,
        loginRequired: false,
        commentsClosed: false,
        details: isCloudflare
          ? '遇到 Cloudflare 反爬质询，页面未直接下发评论表单，建议点击“人工验证”在浏览器中打开'
          : `服务器返回 ${httpStatus}，可能需要浏览器真实 Cookie 访问`
      };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const pageTitle = extractPageTitle(errorText);
      return {
        url: normalizedUrl,
        domain,
        title: pageTitle,
        httpStatus,
        elapsedMs,
        isBlogComment: false,
        status: 'http_error',
        statusLabel: `HTTP ${httpStatus}`,
        confidence: 'none',
        formType: 'none',
        hasUrlField: false,
        hasAuthorField: false,
        hasEmailField: false,
        hasCommentField: false,
        loginRequired: false,
        commentsClosed: false,
        details: `请求返回状态码 ${httpStatus}`
      };
    }

    // 允许读取大页面（许多含有数千条历史评论的博客页面体积达到 5MB~15MB，评论表单在最底部）
    const html = await response.text();
    // 超过 25MB 的极端超大页面截取前 5MB 与后 10MB（表单绝大多数在尾部）
    let truncatedHtml = html;
    if (html.length > 25 * 1024 * 1024) {
      truncatedHtml = html.slice(0, 5 * 1024 * 1024) + '\n' + html.slice(-15 * 1024 * 1024);
    }

    // 阶段 2：HTML 响应后，优先提取页面 <title>
    const pageTitle = extractPageTitle(truncatedHtml);

    // 检查网页标题黑名单规则熔断
    const titleRules = options.filterRules?.titleBlacklist || options.titleBlacklist || null;
    if (titleRules && titleRules.enabled !== false && Array.isArray(titleRules.rules) && pageTitle) {
      const matchedRule = findMatchingRule(pageTitle, titleRules.rules);
      if (matchedRule) {
        return {
          url: normalizedUrl,
          domain,
          title: pageTitle,
          httpStatus,
          elapsedMs,
          isBlogComment: false,
          spamFiltered: true,
          status: 'filtered_title_rule',
          statusLabel: '命中标题黑名单',
          confidence: 'high',
          formType: '标题黑名单熔断',
          hasUrlField: false,
          hasAuthorField: false,
          hasEmailField: false,
          hasCommentField: false,
          loginRequired: false,
          commentsClosed: false,
          matchedRule,
          filterCategory: 'title_rule',
          details: `命中网页标题黑名单规则: 包含 "${matchedRule}"（页面标题: "${pageTitle}"）。已熔断拦截，避免误报为外链博客。`
        };
      }
    }

    const analysis = analyzeBlogCommentPage(truncatedHtml, normalizedUrl, pageTitle);

    return {
      url: normalizedUrl,
      domain,
      title: pageTitle,
      httpStatus,
      elapsedMs,
      ...analysis
    };
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    const isTimeout = err.name === 'AbortError' || /timeout|aborted/i.test(err.message);
    return {
      url: normalizedUrl,
      domain,
      title: '',
      httpStatus: 0,
      elapsedMs,
      isBlogComment: false,
      status: isTimeout ? 'timeout' : 'network_error',
      statusLabel: isTimeout ? '连接超时' : '网络错误',
      confidence: 'none',
      formType: 'none',
      hasUrlField: false,
      hasAuthorField: false,
      hasEmailField: false,
      hasCommentField: false,
      loginRequired: false,
      commentsClosed: false,
      details: isTimeout ? `连接超时（超过 ${timeoutMs}ms 未响应）` : `请求异常：${err.message}`
    };
  }
}

/**
 * 内存探测任务管理单例
 */
class ProbeSessionManager {
  constructor() {
    this.sessions = new Map();
    this.latestSessionId = null;
  }

  get currentSession() {
    return this.latestSessionId ? this.sessions.get(this.latestSessionId) : null;
  }

  set currentSession(val) {
    if (val && val.id) {
      this.sessions.set(val.id, val);
      this.latestSessionId = val.id;
    }
  }

  /**
   * 启动一次批量探测任务
   * @param {string[]} urls 待探测的 URL 列表
   * @param {object} options 并发度、超时、库内已有映射、sessionId 等
   */
  startSession(urls, options = {}) {
    const rawList = (urls || [])
      .map((u) => String(u || '').trim())
      .filter((u) => u && !u.startsWith('#') && !u.startsWith('//'));

    const rawCount = rawList.length;
    if (rawCount === 0) {
      throw new Error('待探测 URL 列表为空');
    }

    // 1. 输入列表去重：精准过滤重复 URL 及同一批次内的同域名多个 URL（优先保留每域名首条代表 URL）
    const seenDomains = new Set();
    const uniqueCandidates = [];

    for (const rawUrl of rawList) {
      const fullUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      const domain = normalizeDomain(fullUrl);
      if (!domain || !domain.includes('.') || domain === 'localhost') {
        continue;
      }
      if (seenDomains.has(domain)) {
        continue;
      }
      seenDomains.add(domain);
      uniqueCandidates.push({
        url: fullUrl,
        domain
      });
    }

    if (uniqueCandidates.length === 0) {
      throw new Error('没有提取到有效合法的域名 URL');
    }

    const dedupCount = rawCount - uniqueCandidates.length;
    const concurrency = Math.max(1, Math.min(50, Number(options.concurrency || 20)));
    const timeoutMs = Math.max(2000, Math.min(30000, Number(options.timeoutMs || 8000)));
    const existingLibraryMap = options.existingLibraryMap || null;
    const skipExisting = options.skipExisting !== false && Boolean(existingLibraryMap);

    const sessionId = options.sessionId || `probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (this.sessions.has(sessionId)) {
      const existingSession = this.sessions.get(sessionId);
      if (existingSession && existingSession.status === 'running') {
        throw new Error('该探测任务正在执行中，请等待完成或先点击中止');
      }
    }

    // 清理老旧会话（保留最近 50 个）
    if (this.sessions.size > 50) {
      const keys = Array.from(this.sessions.keys());
      for (let i = 0; i < keys.length - 40; i++) {
        const oldS = this.sessions.get(keys[i]);
        if (oldS && oldS.status !== 'running') {
          this.sessions.delete(keys[i]);
        }
      }
    }

    const session = {
      id: sessionId,
      title: options.title || '',
      status: 'running', // 'running' | 'completed' | 'canceled'
      total: uniqueCandidates.length,
      processed: 0,
      concurrency,
      timeoutMs,
      startTime: Date.now(),
      endTime: null,
      stats: {
        rawCount,
        dedupCount,
        alreadyInLibrary: 0,
        spamFilteredUrl: 0,
        spamFilteredTitle: 0,
        spamFilteredTotal: 0,
        validBlogCommentWithUrl: 0,
        validBlogCommentNoUrl: 0,
        bloggerComment: 0,
        needReview: 0,
        commentsClosed: 0,
        loginRequired: 0,
        notBlogComment: 0,
        failed: 0
      },
      results: [],
      cancelRequested: false,
      onComplete: typeof options.onComplete === 'function' ? options.onComplete : null
    };

    this.sessions.set(sessionId, session);
    this.latestSessionId = sessionId;

    const filterRules = options.filterRules || DEFAULT_FILTER_RULES;

    // 2. 阶段 1：网络请求前，URL / 域名黑名单规则前置拦截（0毫秒快速剔除，免发网络请求）
    const urlRules = filterRules && filterRules.urlBlacklist;
    const isUrlRuleEnabled = urlRules && urlRules.enabled !== false && Array.isArray(urlRules.rules) && urlRules.rules.length > 0;
    const candidatesAfterUrlRules = [];

    for (const item of uniqueCandidates) {
      if (isUrlRuleEnabled) {
        const matchedRule = findMatchingRule(item.url, urlRules.rules);
        if (matchedRule) {
          session.results.push({
            url: item.url,
            domain: item.domain,
            title: '',
            httpStatus: 0,
            elapsedMs: 0,
            isBlogComment: false,
            spamFiltered: true,
            status: 'filtered_url_rule',
            statusLabel: '命中URL黑名单',
            confidence: 'high',
            formType: 'URL黑名单拦截',
            hasUrlField: false,
            hasAuthorField: false,
            hasEmailField: false,
            hasCommentField: false,
            loginRequired: false,
            commentsClosed: false,
            matchedRule,
            filterCategory: 'url_rule',
            details: `命中 URL/域名黑名单规则: 包含 "${matchedRule}"。已前置拦截，免发网络请求。`
          });
          session.stats.spamFilteredUrl++;
          session.stats.spamFilteredTotal++;
          session.processed++;
          continue;
        }
      }
      candidatesAfterUrlRules.push(item);
    }

    // 3. 检查资产库：已存在的引荐域名直接跳过网络探测，并计入独立分类
    const toProbeList = [];

    for (const item of candidatesAfterUrlRules) {
      if (skipExisting && existingLibraryMap.has(item.domain)) {
        const existing = existingLibraryMap.get(item.domain);
        const tierName =
          existing.quality_tier === 'high_quality'
            ? '优质外链'
            : existing.quality_tier === 'medium_quality'
            ? '普通外链'
            : existing.quality_tier === 'low_quality'
            ? '低质外链'
            : '未跑批';
        const rateText =
          existing.total_attempts > 0
            ? `${Number(existing.success_rate || 0)}% (${existing.success_count}/${existing.total_attempts}次成功)`
            : '无历史运行数据';

        session.results.push({
          url: item.url,
          domain: item.domain,
          title: '',
          httpStatus: 200,
          elapsedMs: 0,
          isBlogComment: false,
          alreadyInLibrary: true,
          status: 'already_in_library',
          statusLabel: '资产库已存在 (跳过)',
          confidence: 'high',
          formType: '库内已有资产',
          hasUrlField: false,
          hasAuthorField: false,
          hasEmailField: false,
          hasCommentField: false,
          loginRequired: false,
          commentsClosed: false,
          existingAsset: {
            referralDomain: existing.referral_domain,
            referralUrl: existing.referral_url,
            qualityTier: existing.quality_tier,
            successRate: existing.success_rate,
            successCount: existing.success_count,
            totalAttempts: existing.total_attempts,
            resourceType: existing.resource_type
          },
          details: `引荐域名已在资产库中（评级: ${tierName}，成功率: ${rateText}，库内URL: ${existing.referral_url}）。已自动跳过网络探测。`
        });
        session.stats.alreadyInLibrary++;
        session.processed++;
      } else {
        toProbeList.push(item);
      }
    }

    // 若全部都在规则拦截或资产库中已存在，则直接完成
    if (toProbeList.length === 0) {
      session.endTime = Date.now();
      session.status = 'completed';
      if (typeof session.onComplete === 'function') {
        try {
          session.onComplete(session);
        } catch (err) {
          console.error('[Probe] onComplete 触发异常：', err);
        }
      }
    } else {
      // 异步执行并发队列，不阻塞 HTTP 响应
      this._runQueue(toProbeList, session, filterRules);
    }

    return {
      sessionId: session.id,
      total: session.total,
      rawCount: session.stats.rawCount,
      dedupCount: session.stats.dedupCount,
      alreadyInLibrary: session.stats.alreadyInLibrary,
      spamFilteredTotal: session.stats.spamFilteredTotal,
      concurrency: session.concurrency,
      status: session.status
    };
  }

  async _runQueue(items, session, filterRules) {
    let index = 0;
    const total = items.length;

    const worker = async () => {
      while (index < total) {
        if (session.cancelRequested) {
          break;
        }
        const currentIndex = index++;
        const currentItem = items[currentIndex];
        const targetUrl = typeof currentItem === 'object' ? currentItem.url : currentItem;

        try {
          const result = await probeSingleUrl(targetUrl, {
            timeoutMs: session.timeoutMs,
            filterRules
          });

          session.results.push(result);
          session.processed++;

          // 归类统计计数
          if (result.status === 'valid_blog_comment_with_url') {
            session.stats.validBlogCommentWithUrl++;
          } else if (result.status === 'valid_blog_comment_no_url') {
            session.stats.validBlogCommentNoUrl++;
          } else if (result.status === 'valid_blog_comment_blogger') {
            session.stats.bloggerComment++;
          } else if (result.status === 'filtered_title_rule') {
            session.stats.spamFilteredTitle++;
            session.stats.spamFilteredTotal++;
          } else if (result.status === 'suspect_need_review' || result.status === 'blocked_challenge') {
            session.stats.needReview++;
          } else if (result.status === 'comments_closed') {
            session.stats.commentsClosed++;
          } else if (result.status === 'login_required') {
            session.stats.loginRequired++;
          } else if (result.status === 'not_blog_comment') {
            session.stats.notBlogComment++;
          } else {
            session.stats.failed++;
          }
        } catch (err) {
          session.processed++;
          session.stats.failed++;
          session.results.push({
            url: targetUrl,
            domain: normalizeDomain(targetUrl),
            title: '',
            httpStatus: 0,
            elapsedMs: 0,
            isBlogComment: false,
            status: 'error',
            statusLabel: '探测失败',
            confidence: 'none',
            formType: 'none',
            hasUrlField: false,
            hasAuthorField: false,
            hasEmailField: false,
            hasCommentField: false,
            loginRequired: false,
            commentsClosed: false,
            details: err.message
          });
        }
      }
    };

    // 启动指定数量的并发 worker
    const workers = [];
    const activeWorkersCount = Math.min(session.concurrency, total);
    for (let i = 0; i < activeWorkersCount; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    session.endTime = Date.now();
    session.status = session.cancelRequested ? 'canceled' : 'completed';
    if (typeof session.onComplete === 'function') {
      try {
        session.onComplete(session);
      } catch (err) {
        console.error('[Probe] onComplete 触发异常：', err);
      }
    }
  }

  /**
   * 取消任务（支持指定 sessionId，默认取消最近任务）
   */
  cancelSession(sessionId) {
    const targetSessionId = sessionId || this.latestSessionId;
    if (!targetSessionId || !this.sessions.has(targetSessionId)) {
      return { ok: false, message: '当前没有正在运行的探测任务' };
    }
    const session = this.sessions.get(targetSessionId);
    if (session.status !== 'running') {
      return { ok: false, message: '当前探测任务未在运行' };
    }
    session.cancelRequested = true;
    return { ok: true, message: '已发出中止信号' };
  }

  /**
   * 获取任务状态与结果（支持指定 sessionId 或兼容直接传 limit/offset）
   */
  getSessionStatus(sessionIdOrLimit = 200, limitOrOffset = 0, offsetVal = 0) {
    let targetSessionId = null;
    let limit = 200;
    let offset = 0;

    if (typeof sessionIdOrLimit === 'string') {
      targetSessionId = sessionIdOrLimit;
      if (typeof limitOrOffset === 'number') limit = limitOrOffset;
      if (typeof offsetVal === 'number') offset = offsetVal;
    } else {
      targetSessionId = this.latestSessionId;
      if (typeof sessionIdOrLimit === 'number') limit = sessionIdOrLimit;
      if (typeof limitOrOffset === 'number') offset = limitOrOffset;
    }

    if (!targetSessionId || !this.sessions.has(targetSessionId)) {
      return {
        hasSession: false,
        session: null
      };
    }

    const s = this.sessions.get(targetSessionId);
    const elapsedSeconds = Math.round(((s.endTime || Date.now()) - s.startTime) / 1000);
    const progressPercent = s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0;

    const totalResults = s.results.length;
    const slicedResults = s.results.slice(offset, offset + limit);

    return {
      hasSession: true,
      session: {
        id: s.id,
        status: s.status,
        total: s.total,
        processed: s.processed,
        progressPercent,
        concurrency: s.concurrency,
        elapsedSeconds,
        stats: s.stats,
        totalResults,
        results: slicedResults
      }
    };
  }
}

export const probeManager = new ProbeSessionManager();
