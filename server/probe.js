import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

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
export function analyzeBlogCommentPage(html, url) {
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
    details
  };
}

/**
 * 针对单条 URL 执行 HTTP 抓取与分析
 * @param {string} targetUrl 目标 URL
 * @param {object} [options] 抓取配置（超时、User-Agent 等）
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

  let domain = '';
  try {
    domain = new URL(normalizedUrl).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    domain = normalizedUrl.split('/')[0].replace(/^www\./i, '').toLowerCase();
  }

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
      return {
        url: normalizedUrl,
        domain,
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
      return {
        url: normalizedUrl,
        domain,
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

    const analysis = analyzeBlogCommentPage(truncatedHtml, normalizedUrl);

    return {
      url: normalizedUrl,
      domain,
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
    this.currentSession = null;
  }

  /**
   * 启动一次批量探测任务
   * @param {string[]} urls 待探测的 URL 列表
   * @param {object} options 并发度、超时等
   */
  startSession(urls, options = {}) {
    if (this.currentSession && this.currentSession.status === 'running') {
      throw new Error('已有正在执行的探测任务，请等待完成或先点击中止');
    }

    const cleanUrls = Array.from(
      new Set(
        (urls || [])
          .map((u) => String(u || '').trim())
          .filter((u) => u && !u.startsWith('#') && !u.startsWith('//'))
      )
    );

    if (cleanUrls.length === 0) {
      throw new Error('待探测 URL 列表为空');
    }

    const concurrency = Math.max(1, Math.min(50, Number(options.concurrency || 20)));
    const timeoutMs = Math.max(2000, Math.min(30000, Number(options.timeoutMs || 8000)));

    const sessionId = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session = {
      id: sessionId,
      status: 'running', // 'running' | 'completed' | 'canceled'
      total: cleanUrls.length,
      processed: 0,
      concurrency,
      timeoutMs,
      startTime: Date.now(),
      endTime: null,
      stats: {
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
      cancelRequested: false
    };

    this.currentSession = session;

    // 异步执行并发队列，不阻塞 HTTP 响应
    this._runQueue(cleanUrls, session);

    return {
      sessionId: session.id,
      total: session.total,
      concurrency: session.concurrency,
      status: session.status
    };
  }

  async _runQueue(urls, session) {
    let index = 0;
    const total = urls.length;

    const worker = async () => {
      while (index < total) {
        if (session.cancelRequested) {
          break;
        }
        const currentIndex = index++;
        const targetUrl = urls[currentIndex];

        try {
          const result = await probeSingleUrl(targetUrl, {
            timeoutMs: session.timeoutMs
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
            domain: '',
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
  }

  /**
   * 取消当前任务
   */
  cancelSession() {
    if (!this.currentSession || this.currentSession.status !== 'running') {
      return { ok: false, message: '当前没有正在运行的探测任务' };
    }
    this.currentSession.cancelRequested = true;
    return { ok: true, message: '已发出中止信号' };
  }

  /**
   * 获取当前任务状态与结果
   */
  getSessionStatus(limit = 200, offset = 0) {
    if (!this.currentSession) {
      return {
        hasSession: false,
        session: null
      };
    }

    const s = this.currentSession;
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
