(function () {
  'use strict';

  const DEFAULT_LOCAL_SERVER_BASE = 'http://127.0.0.1:17321';

  async function apiRequest(path, payload, options = {}) {
    const method = options.method || (payload ? 'POST' : 'GET');
    const headers = { 'Content-Type': 'application/json' };
    const fetchOptions = { method, headers };
    if (payload && method !== 'GET') {
      fetchOptions.body = JSON.stringify(payload);
    }
    const response = await fetch(`${DEFAULT_LOCAL_SERVER_BASE}${path}`, fetchOptions);
    const data = await response.json().catch(() => ({ ok: false, error: '本地服务响应不是合法 JSON' }));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
    }
    return data.data;
  }

  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let probeFilterRules = {
    urlBlacklist: { enabled: true, rules: [] },
    titleBlacklist: { enabled: true, rules: [] }
  };

  const probeState = {
    sessionId: null,
    activeHistoryId: null,
    status: 'idle', // 'idle' | 'running' | 'completed' | 'canceled'
    total: 0,
    processed: 0,
    progressPercent: 0,
    elapsedSeconds: 0,
    stats: {
      rawCount: 0,
      dedupCount: 0,
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
    selectedUrls: new Set(),
    activeTab: 'all', // 'all' | 'valid' | 'spam_filtered' | 'review' | 'closed' | 'in_library' | 'invalid'
    pollTimer: null
  };

  /**
   * 初始化探测 UI
   */
  function initProbeUI() {
    const container = document.getElementById('probeContainer');
    if (!container) return;

    renderProbeSkeleton(container);
    bindProbeEvents();
    checkCurrentProbeStatus();
    loadHistoryBadgeCount();
    loadProbeRules();
  }

  /**
   * 渲染探测主布局
   */
  function renderProbeSkeleton(container) {
    container.innerHTML = `
      <div class="probe-module-wrap">
        <div class="section-head" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
          <div>
            <div class="section-title" style="display:flex;align-items:center;gap:8px;">
              <span>🔎 博客外链探测</span>
              <span class="badge badge-info" id="probeStatusBadge" style="background:#e0e7ff;color:#3730a3;font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;">空闲就绪</span>
            </div>
            <div class="section-desc">
              提供竞品或海量外链 URL，本地高并发探测哪些是博客评论页面并侦探表单结构。自动识别 WordPress / Blogger / 通用博客，过滤评论已关闭或强制登录页面，支持分类复核与一键入库投产。
            </div>
          </div>
          <div style="flex-shrink:0;display:flex;align-items:center;gap:8px;">
            <button type="button" class="btn btn-secondary btn-sm" id="probeRulesBtn" style="display:flex;align-items:center;gap:6px;font-weight:600;padding:6px 12px;" title="配置垃圾外链与黑名单过滤规则（URL/域名黑名单、页面标题黑名单等）">
              <span>⚙️ 过滤规则</span>
              <span class="badge badge-secondary" id="probeRulesBadge" style="background:#f1f5f9;color:#0f172a;font-size:10px;padding:1px 6px;border-radius:10px;">--</span>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" id="probeHistoryBtn" style="display:flex;align-items:center;gap:6px;font-weight:600;padding:6px 12px;" title="查看与加载保存在数据库中的历史探测批次">
              <span>📜 探测历史档案</span>
              <span class="badge badge-secondary" id="probeHistoryBadge" style="background:#e2e8f0;color:#334155;font-size:10px;padding:1px 6px;border-radius:10px;">0</span>
            </button>
          </div>
        </div>

        <!-- 输入与配置卡片 -->
        <div class="card" style="margin-bottom:16px;">
          <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
            <span>📋 输入待测外链列表</span>
            <div style="font-size:12px;font-weight:normal;color:#64748b;">
              支持粘贴 URL 列表，或上传 .txt / .csv 文件（自动按引荐域名去重）
            </div>
          </div>

          <div style="margin-bottom:12px;">
            <textarea id="probeUrlsTextarea" rows="6" placeholder="请在此粘贴竞品外链或待测 URL，一行一个，例如：&#10;https://example-blog.com/top-ai-tools/&#10;https://another-site.org/news/post-101/&#10;https://industry-review.net/guide/" style="width:100%;font-size:12px;line-height:1.5;font-family:monospace;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;"></textarea>
          </div>

          <div class="probe-config-bar">
            <div class="probe-config-group-left">
              <button type="button" class="btn btn-secondary btn-sm" id="probeUploadFileBtn">📂 上传 TXT/CSV 文件</button>
              <input type="file" id="probeFileInput" accept=".txt,.csv" style="display:none;" />
              <button type="button" class="btn btn-secondary btn-sm" id="probeCleanDedupBtn" title="对输入框内的待测 URL 立即按域名去重整理">🧹 去重整理</button>
              
              <div class="probe-field-inline">
                <label for="probeConcurrency">并发线程：</label>
                <select id="probeConcurrency">
                  <option value="10">10 并发</option>
                  <option value="20" selected>20 并发 (推荐)</option>
                  <option value="30">30 并发 (高速)</option>
                  <option value="50">50 并发 (极限)</option>
                </select>
              </div>

              <div class="probe-field-inline">
                <label for="probeTimeout">超时时间：</label>
                <select id="probeTimeout">
                  <option value="5000">5 秒</option>
                  <option value="8000" selected>8 秒 (标准)</option>
                  <option value="12000">12 秒</option>
                </select>
              </div>

              <label class="probe-field-inline" style="cursor:pointer;" title="开启后，若引荐域名已在外链资产库中，直接免测跳过，节省请求与时间并保留库内历史表现">
                <input type="checkbox" id="probeSkipExisting" checked style="cursor:pointer;" />
                <span style="font-size:12px;font-weight:600;color:#475569;">跳过资产库已存域名</span>
              </label>

              <span id="probeInputCountDisplay" class="probe-count-badge">待测域名：0 个</span>
            </div>

            <div class="probe-config-group-right">
              <button type="button" class="btn btn-secondary" id="probeBenchmarkBtn" title="使用库内 Top 50 条实际跑通的优质外链跑算法基准测试">🎯 跑库内优质资产基准</button>
              <button type="button" class="btn btn-primary" id="probeStartBtn" style="font-weight:600;padding:7px 18px;">🚀 开始并发探测</button>
              <button type="button" class="btn btn-secondary btn-danger-outline" id="probeCancelBtn" style="display:none;">⏹ 停止探测</button>
            </div>
          </div>
        </div>

        <!-- 进度与指标仪表盘 -->
        <div class="card" id="probeProgressCard" style="margin-bottom:16px;display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:600;color:#1e293b;">
              <span id="probeProgressLabel">正在探测中...</span>
              <span id="probeProgressCounter" style="color:#2563eb;margin-left:8px;">0 / 0</span>
            </div>
            <div style="font-size:12px;color:#64748b;">
              已耗时：<strong id="probeElapsedSeconds">0</strong> 秒
            </div>
          </div>

          <div style="width:100%;height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin-bottom:16px;">
            <div id="probeProgressBar" style="width:0%;height:100%;background:linear-gradient(90deg, #3b82f6, #10b981);transition:width 0.2s ease;"></div>
          </div>

          <!-- 统计指标格 -->
          <div class="probe-stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;">
            <div class="probe-stat-item" style="padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
              <div style="font-size:11px;color:#166534;">🟢 可发外链 (带URL框)</div>
              <div id="statProbeValidWithUrl" style="font-size:18px;font-weight:700;color:#15803d;margin-top:2px;">0</div>
            </div>
            <div class="probe-stat-item" style="padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
              <div style="font-size:11px;color:#166534;">🟢 开放评论 (正文外链)</div>
              <div id="statProbeValidNoUrl" style="font-size:18px;font-weight:700;color:#15803d;margin-top:2px;">0</div>
            </div>
            <div class="probe-stat-item" style="padding:10px 12px;background:#fefce8;border:1px solid #fef08a;border-radius:8px;">
              <div style="font-size:11px;color:#854d0e;">🟡 需人工复核 (403/盾)</div>
              <div id="statProbeNeedReview" style="font-size:18px;font-weight:700;color:#a16207;margin-top:2px;">0</div>
            </div>
            <div class="probe-stat-item" style="padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
              <div style="font-size:11px;color:#991b1b;">🔒 评论关闭 / 需登录</div>
              <div id="statProbeClosedOrLogin" style="font-size:18px;font-weight:700;color:#b91c1c;margin-top:2px;">0</div>
            </div>
            <div class="probe-stat-item" style="padding:10px 12px;background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;">
              <div style="font-size:11px;color:#9f1239;">🚫 垃圾规则过滤</div>
              <div id="statProbeSpamFiltered" style="font-size:18px;font-weight:700;color:#e11d48;margin-top:2px;">0</div>
            </div>
            <div class="probe-stat-item" style="padding:10px 12px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;">
              <div style="font-size:11px;color:#6d28d9;">⏩ 资产库已存在 (跳过)</div>
              <div id="statProbeAlreadyInLibrary" style="font-size:18px;font-weight:700;color:#6d28d9;margin-top:2px;">0</div>
            </div>
            <div class="probe-stat-item" style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
              <div style="font-size:11px;color:#475569;">🔴 非博客 / 超时失败</div>
              <div id="statProbeInvalidOrFailed" style="font-size:18px;font-weight:700;color:#475569;margin-top:2px;">0</div>
            </div>
          </div>
        </div>

        <!-- 结果展示表格 -->
        <div class="card probe-table-card" id="probeResultsCard" style="display:none;">
          <!-- 历史归档查看提示横幅 -->
          <div id="probeHistoryActiveBanner" style="display:none;margin:12px 16px 0;padding:10px 14px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;align-items:center;justify-content:space-between;">
            <div style="font-size:12px;color:#1e1b4b;display:flex;align-items:center;gap:8px;">
              <span style="font-size:16px;">📂</span>
              <span>当前正在查看历史探测归档：<strong id="probeHistoryActiveTitle" style="color:#3730a3;">--</strong></span>
              <span style="font-size:11px;color:#6366f1;">(支持自由校对、人工复核、一键入库或导出 Excel)</span>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" id="probeExitHistoryBtn" style="font-size:11px;padding:3px 10px;color:#4338ca;border-color:#c7d2fe;">✕ 退出历史查看</button>
          </div>

          <div class="probe-table-header-bar">
            <!-- 分类选项卡 -->
            <div class="probe-filter-tabs" style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm probe-tab active" data-tab="all">全部 (<span id="probeTabCountAll">0</span>)</button>
              <button type="button" class="btn btn-secondary btn-sm probe-tab" data-tab="valid" style="color:#15803d;">🟢 可用博客外链 (<span id="probeTabCountValid">0</span>)</button>
              <button type="button" class="btn btn-secondary btn-sm probe-tab" data-tab="spam_filtered" style="color:#e11d48;">🚫 垃圾过滤 (<span id="probeTabCountSpam">0</span>)</button>
              <button type="button" class="btn btn-secondary btn-sm probe-tab" data-tab="review" style="color:#b45309;">🟡 待人工复核 (<span id="probeTabCountReview">0</span>)</button>
              <button type="button" class="btn btn-secondary btn-sm probe-tab" data-tab="closed" style="color:#b91c1c;">🔒 已关闭/需登录 (<span id="probeTabCountClosed">0</span>)</button>
              <button type="button" class="btn btn-secondary btn-sm probe-tab" data-tab="in_library" style="color:#6d28d9;">⏩ 资产库已存在 (<span id="probeTabCountInLibrary">0</span>)</button>
              <button type="button" class="btn btn-secondary btn-sm probe-tab" data-tab="invalid" style="color:#64748b;">🔴 非博客/失败 (<span id="probeTabCountInvalid">0</span>)</button>
            </div>

            <!-- 批量操作 -->
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" id="probeSelectValidBtn">勾选全部可用博客</button>
              <button type="button" class="btn btn-primary btn-sm" id="probeOpenImportModalBtn">📥 批量导入选中的外链入库 (<span id="probeSelectedCountDisplay">0</span>)</button>
              <button type="button" class="btn btn-secondary btn-sm" id="probeExportExcelBtn" style="display:flex;align-items:center;gap:4px;">📊 导出结果 Excel</button>
            </div>
          </div>

          <div class="probe-table-wrap">
            <table class="probe-table" id="probeResultTable">
              <thead>
                <tr>
                  <th style="width:38px;text-align:center;"><input type="checkbox" id="probeSelectAllCheckbox" /></th>
                  <th style="width:160px;">引荐域名</th>
                  <th style="width:200px;">网页标题 (Title)</th>
                  <th>入口引荐 URL</th>
                  <th style="width:190px;">博客系统 / 识别结论</th>
                  <th style="width:125px;">外链字段能力</th>
                  <th style="width:115px;">响应状态</th>
                  <th style="width:115px;text-align:center;">操作</th>
                </tr>
              </thead>
              <tbody id="probeResultTableBody">
                <tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8;">暂无探测数据</td></tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <!-- 探测结果入库确认 Modal -->
      <div class="asset-modal-overlay" id="probeImportConfirmModal" style="display:none;">
        <div class="asset-modal-dialog">
          <div class="asset-modal-header">
            <div class="asset-modal-title">📥 批量导入探测成果到「外链资产库」</div>
            <button type="button" class="asset-modal-close" id="probeCloseImportModalBtn">×</button>
          </div>
          <div class="asset-modal-body">
            <div style="font-size:13px;color:#334155;margin-bottom:12px;">
              即将把选中的 <strong id="probeModalCountDisplay" style="color:#2563eb;font-size:15px;">0</strong> 条优质博客外链持久化沉淀到外链资产库。
            </div>

            <div style="margin-bottom:12px;">
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">外链资源类型：</label>
              <select id="probeImportTypeSelect" style="width:100%;">
                <option value="blog_comment" selected>💬 博客评论 (Blog Comment)</option>
              </select>
            </div>

            <div style="margin-bottom:12px;">
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">批次标签（自动归类，便于资产库筛选）：</label>
              <input type="text" id="probeImportTagsInput" placeholder="例如：probe-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}, 竞品A" style="width:100%;font-size:12px;" />
              <div class="hint">多个标签用英文逗号分隔；导入后可在资产库按标签或“今天添加”一键筛选并跑批。</div>
            </div>

            <div style="margin-bottom:14px;">
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">域名重复处理策略：</label>
              <div style="font-size:12px;color:#475569;display:flex;flex-direction:column;gap:6px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="radio" name="probeDuplicateStrategy" value="skip" checked />
                  <span>跳过已存在域名（保留库内已有入口 URL 与历史表现）</span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="radio" name="probeDuplicateStrategy" value="update_url" />
                  <span>覆盖更新入口 URL（更新为新探测到的 URL，若 URL 变更则自动清空页面深度待重测）</span>
                </label>
              </div>
            </div>

            <div style="padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;color:#166534;">
              💡 <strong>提示</strong>：来源渠道将自动标记为 <code>🔍 博客探测入库 (probe_discovery)</code>。入库完成后可一键跳转外链资产库投产跑批！
            </div>
          </div>
          <div class="asset-modal-footer">
            <button type="button" class="btn btn-secondary" id="probeCancelImportModalBtn">取消</button>
            <button type="button" class="btn btn-primary" id="probeExecuteImportBtn">确认一键入库</button>
          </div>
        </div>
      </div>

      <!-- 探测历史档案 Modal -->
      <div class="asset-modal-overlay" id="probeHistoryModal" style="display:none;">
        <div class="asset-modal-dialog" style="max-width:760px;">
          <div class="asset-modal-header">
            <div class="asset-modal-title" style="display:flex;align-items:center;gap:8px;">
              <span>📜 博客探测历史档案</span>
              <span style="font-size:11px;font-weight:normal;color:#64748b;">(自动保存在本地数据库，重装或关闭插件不丢失)</span>
            </div>
            <button type="button" class="asset-modal-close" id="probeCloseHistoryModalBtn">×</button>
          </div>
          <div class="asset-modal-body" style="max-height:65vh;overflow-y:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <span style="font-size:12px;color:#64748b;">本地共存储 <strong id="probeHistoryTotalCount" style="color:#2563eb;">0</strong> 个历史探测批次</span>
              <button type="button" class="btn btn-secondary btn-sm" id="probeClearAllHistoryBtn" style="color:#b91c1c;border-color:#fecaca;font-size:11px;">🗑️ 清空全部历史记录</button>
            </div>
            <div id="probeHistoryListContainer" style="display:flex;flex-direction:column;gap:10px;">
              <div style="text-align:center;padding:30px;color:#94a3b8;font-size:12px;">正在读取历史归档...</div>
            </div>
          </div>
          <div class="asset-modal-footer">
            <button type="button" class="btn btn-secondary" id="probeCancelHistoryModalBtn">关闭</button>
          </div>
        </div>
      </div>

      <!-- 垃圾外链过滤规则配置 Modal -->
      <div class="asset-modal-overlay" id="probeRulesModal" style="display:none;">
        <div class="asset-modal-dialog" style="max-width:720px;">
          <div class="asset-modal-header">
            <div class="asset-modal-title" style="display:flex;align-items:center;gap:8px;">
              <span>⚙️ 垃圾外链与黑名单过滤规则配置</span>
              <span style="font-size:11px;font-weight:normal;color:#64748b;">(支持子串模糊包含、通配符与正则)</span>
            </div>
            <button type="button" class="asset-modal-close" id="probeCloseRulesModalBtn">×</button>
          </div>
          <div class="asset-modal-body" style="max-height:70vh;overflow-y:auto;">
            <div style="font-size:12px;color:#475569;line-height:1.6;margin-bottom:14px;background:#f8fafc;padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0;">
              <div style="font-weight:700;color:#1e293b;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
                <span>📖 规则怎么写？（3 种模式说明与示例对照）</span>
              </div>
              <div style="color:#64748b;font-size:11px;margin-bottom:8px;">
                系统采用分层过滤：<strong>URL 黑名单</strong>在发网络请求前（0ms）即时拦截；<strong>网页标题黑名单</strong>在抓取后嗅探 <code>&lt;title&gt;</code> 立即熔断。
              </div>
              <table style="width:100%;font-size:11px;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e2e8f0;">
                <thead>
                  <tr style="background:#f1f5f9;color:#334155;text-align:left;">
                    <th style="padding:6px 10px;border-bottom:1px solid #e2e8f0;width:24%;">匹配模式</th>
                    <th style="padding:6px 10px;border-bottom:1px solid #e2e8f0;width:30%;">写法示例</th>
                    <th style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">匹配逻辑与效果</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#15803d;">① 默认模糊包含<br/><span style="font-size:10px;color:#64748b;font-weight:normal;">(最常用，推荐直接写)</span></td>
                    <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-family:monospace;color:#0f172a;">seo<br/>pay.<br/>8coint.com</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#475569;"><strong>直接写关键词即可，前后无需加 * 符号</strong>。等同于 SQL <code>LIKE '%词%'</code>，只要 URL 或标题中出现该字样（忽略大小写）即被拦截。</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#2563eb;">② 通配符 *<br/><span style="font-size:10px;color:#64748b;font-weight:normal;">(跨词/组合匹配)</span></td>
                    <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-family:monospace;color:#0f172a;">buy*online<br/>/tag/*</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#475569;"><code>*</code> 代表中间可以间隔任意字符。例如 <code>buy*online</code> 可匹配标题 <code>Buy Backlinks Online</code>（中间隔了单词）。</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 10px;font-weight:600;color:#7c3aed;">③ 正则表达式<br/><span style="font-size:10px;color:#64748b;font-weight:normal;">(专家模式，/开头/结尾)</span></td>
                    <td style="padding:6px 10px;font-family:monospace;color:#0f172a;">/\.(top|xyz|loan)$/i<br/>/\d{4,}\.com/i</td>
                    <td style="padding:6px 10px;color:#475569;">以 <code>/</code> 包裹。例如 <code>/\.(top|xyz)$/i</code> 一次性拦截多种指定后缀；<code>/\d{4,}\.com/i</code> 拦截4位以上纯数字泛滥垃圾域名。</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 卡片 1: URL / 域名黑名单 -->
            <div class="probe-rules-card">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <label style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;color:#1e293b;cursor:pointer;">
                  <input type="checkbox" id="probeRuleUrlEnabled" checked />
                  <span>启用 URL / 域名黑名单过滤（网络请求前 0ms 拦截）</span>
                </label>
                <span style="font-size:11px;color:#64748b;" id="probeRuleUrlCountDisplay">0 条规则</span>
              </div>
              <textarea id="probeRuleUrlTextarea" class="probe-rules-textarea" rows="4" placeholder="每行一条，例如：&#10;yahoo.com&#10;8coint.com&#10;gridinsoft.com&#10;ready.pro&#10;linkz.us&#10;pay.&#10;trackitonline&#10;seo&#10;links&#10;yandex.com"></textarea>
              <div class="hint" style="margin-top:4px;">每行一条。直接输入关键词即可（默认全模糊包含，前后无需加 *）。以 # 开头的行视为注释。</div>
            </div>

            <!-- 卡片 2: 网页标题 (<title>) 黑名单 -->
            <div class="probe-rules-card">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <label style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;color:#1e293b;cursor:pointer;">
                  <input type="checkbox" id="probeRuleTitleEnabled" checked />
                  <span>启用 网页标题 (&lt;title&gt;) 黑名单过滤（抓取后嗅探熔断）</span>
                </label>
                <span style="font-size:11px;color:#64748b;" id="probeRuleTitleCountDisplay">0 条规则</span>
              </div>
              <textarea id="probeRuleTitleTextarea" class="probe-rules-textarea" rows="4" placeholder="每行一条，例如：&#10;backlink&#10;domain&#10;buy&#10;url shared&#10;seo&#10;links"></textarea>
              <div class="hint" style="margin-top:4px;">每行一条。直接输入标题关键词（如 backlink、domain、buy 等）。网页标题中包含上述词汇时立即熔断剔除。</div>
            </div>

            <!-- 卡片 3: 实时规则命中测试小工具 -->
            <div class="probe-rule-test-box">
              <div style="font-weight:700;font-size:12px;color:#334155;margin-bottom:8px;">🔍 规则实时匹配测试工具</div>
              <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
                <input type="text" id="probeRuleTestUrl" placeholder="测试 URL（如 https://8coint.com/blog 或 https://test.org/seo）" style="flex:1;min-width:200px;font-size:12px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:4px;" />
                <input type="text" id="probeRuleTestTitle" placeholder="测试网页标题（如 Best Free Backlinks 2026）" style="flex:1;min-width:200px;font-size:12px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:4px;" />
                <button type="button" class="btn btn-secondary btn-sm" id="probeRuleRunTestBtn">测试匹配</button>
              </div>
              <div id="probeRuleTestResult" style="font-size:12px;display:none;padding:6px 10px;border-radius:6px;line-height:1.4;"></div>
            </div>
          </div>
          <div class="asset-modal-footer" style="display:flex;justify-content:space-between;align-items:center;">
            <button type="button" class="btn btn-secondary btn-sm" id="probeRuleResetBtn" style="color:#b91c1c;border-color:#fecaca;" title="恢复系统内置默认过滤规则">↺ 恢复推荐默认规则</button>
            <div style="display:flex;gap:8px;">
              <button type="button" class="btn btn-secondary" id="probeCancelRulesModalBtn">取消</button>
              <button type="button" class="btn btn-primary" id="probeSaveRulesBtn">💾 保存过滤规则</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function normalizeDomain(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
      const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
      return text.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').toLowerCase();
    }
  }

  function parseUrlsFromText(text) {
    if (!text) return { urls: [], rawCount: 0, dedupCount: 0 };
    const rawLines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));

    const seenDomains = new Set();
    const uniqueUrls = [];

    for (const line of rawLines) {
      const fullUrl = /^https?:\/\//i.test(line) ? line : `https://${line}`;
      const domain = normalizeDomain(fullUrl);
      if (!domain || !domain.includes('.') || domain === 'localhost') continue;
      if (seenDomains.has(domain)) continue;
      seenDomains.add(domain);
      uniqueUrls.push(fullUrl);
    }

    return {
      urls: uniqueUrls,
      rawCount: rawLines.length,
      dedupCount: rawLines.length - uniqueUrls.length
    };
  }

  function updateInputCountDisplay() {
    const urlsTextarea = document.getElementById('probeUrlsTextarea');
    const inputCountDisplay = document.getElementById('probeInputCountDisplay');
    if (!urlsTextarea || !inputCountDisplay) return;
    const { urls, rawCount, dedupCount } = parseUrlsFromText(urlsTextarea.value);
    if (rawCount === 0) {
      inputCountDisplay.innerHTML = '待测域名：0 个';
    } else if (dedupCount > 0) {
      inputCountDisplay.innerHTML = `待测有效域名：<strong style="color:#2563eb;">${urls.length}</strong> 个 <span style="font-size:11px;color:#64748b;font-weight:normal;">(原始 ${rawCount} 条，已去重 ${dedupCount} 条)</span>`;
    } else {
      inputCountDisplay.innerHTML = `待测有效域名：<strong style="color:#2563eb;">${urls.length}</strong> 个`;
    }
  }

  /**
   * 绑定事件监听器
   */
  function bindProbeEvents() {
    const urlsTextarea = document.getElementById('probeUrlsTextarea');

    urlsTextarea?.addEventListener('input', updateInputCountDisplay);

    // 清理去重
    document.getElementById('probeCleanDedupBtn')?.addEventListener('click', () => {
      if (!urlsTextarea) return;
      const { urls, rawCount, dedupCount } = parseUrlsFromText(urlsTextarea.value);
      if (rawCount === 0) return;
      urlsTextarea.value = urls.join('\n');
      updateInputCountDisplay();
    });

    // 上传文件
    const uploadBtn = document.getElementById('probeUploadFileBtn');
    const fileInput = document.getElementById('probeFileInput');
    uploadBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target.result;
        const { urls } = parseUrlsFromText(text);
        if (urlsTextarea) {
          urlsTextarea.value = urls.join('\n');
          updateInputCountDisplay();
        }
      };
      reader.readAsText(file);
    });

    // 开始探测
    document.getElementById('probeStartBtn')?.addEventListener('click', startProbe);
    // 基准测试
    document.getElementById('probeBenchmarkBtn')?.addEventListener('click', startBenchmark);
    // 停止探测
    document.getElementById('probeCancelBtn')?.addEventListener('click', cancelProbe);

    // 过滤选项卡切换
    document.querySelectorAll('.probe-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.probe-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        probeState.activeTab = btn.dataset.tab;
        renderProbeResultTable();
      });
    });

    // 全选当前页
    document.getElementById('probeSelectAllCheckbox')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      const visible = getFilteredResults();
      visible.forEach((r) => {
        if (checked) probeState.selectedUrls.add(r.url);
        else probeState.selectedUrls.delete(r.url);
      });
      updateSelectedCountDisplay();
      renderProbeResultTable();
    });

    // 一键勾选可用（排除已在资产库的条目）
    document.getElementById('probeSelectValidBtn')?.addEventListener('click', () => {
      probeState.results.forEach((r) => {
        if (r.isBlogComment && r.status !== 'already_in_library') {
          probeState.selectedUrls.add(r.url);
        }
      });
      updateSelectedCountDisplay();
      renderProbeResultTable();
    });

    // 垃圾过滤规则管理
    document.getElementById('probeRulesBtn')?.addEventListener('click', openRulesModal);
    document.getElementById('probeCloseRulesModalBtn')?.addEventListener('click', closeRulesModal);
    document.getElementById('probeCancelRulesModalBtn')?.addEventListener('click', closeRulesModal);
    document.getElementById('probeSaveRulesBtn')?.addEventListener('click', saveProbeRules);
    document.getElementById('probeRuleResetBtn')?.addEventListener('click', resetProbeRules);
    document.getElementById('probeRuleRunTestBtn')?.addEventListener('click', testProbeRulesLocally);
    document.getElementById('probeRuleUrlTextarea')?.addEventListener('input', updateRuleModalCounts);
    document.getElementById('probeRuleTitleTextarea')?.addEventListener('input', updateRuleModalCounts);

    // 历史档案管理
    document.getElementById('probeHistoryBtn')?.addEventListener('click', openHistoryModal);
    document.getElementById('probeCloseHistoryModalBtn')?.addEventListener('click', closeHistoryModal);
    document.getElementById('probeCancelHistoryModalBtn')?.addEventListener('click', closeHistoryModal);
    document.getElementById('probeClearAllHistoryBtn')?.addEventListener('click', clearAllHistory);
    document.getElementById('probeExitHistoryBtn')?.addEventListener('click', exitHistoryView);

    // 导出 Excel (.xlsx)
    document.getElementById('probeExportExcelBtn')?.addEventListener('click', exportProbeExcel);
    document.getElementById('probeExportCsvBtn')?.addEventListener('click', exportProbeExcel);

    // 入库弹窗
    document.getElementById('probeOpenImportModalBtn')?.addEventListener('click', openImportModal);
    document.getElementById('probeCloseImportModalBtn')?.addEventListener('click', closeImportModal);
    document.getElementById('probeCancelImportModalBtn')?.addEventListener('click', closeImportModal);
    document.getElementById('probeExecuteImportBtn')?.addEventListener('click', executeImport);
  }

  /**
   * 加载过滤规则
   */
  async function loadProbeRules() {
    try {
      const res = await apiRequest('/api/probe/rules');
      if (res && (res.urlBlacklist || res.titleBlacklist)) {
        probeFilterRules = res;
      }
    } catch (err) {
      console.warn('获取过滤规则失败：', err.message);
    }
    updateRulesBadge();
  }

  function updateRulesBadge() {
    const badge = document.getElementById('probeRulesBadge');
    if (!badge) return;
    const urlCount = (probeFilterRules.urlBlacklist?.enabled ? probeFilterRules.urlBlacklist?.rules?.length : 0) || 0;
    const titleCount = (probeFilterRules.titleBlacklist?.enabled ? probeFilterRules.titleBlacklist?.rules?.length : 0) || 0;
    badge.textContent = `${urlCount + titleCount}条`;
  }

  function openRulesModal() {
    const modal = document.getElementById('probeRulesModal');
    if (!modal) return;
    modal.style.display = 'flex';

    // 填充数据
    const urlCb = document.getElementById('probeRuleUrlEnabled');
    const titleCb = document.getElementById('probeRuleTitleEnabled');
    const urlTa = document.getElementById('probeRuleUrlTextarea');
    const titleTa = document.getElementById('probeRuleTitleTextarea');

    if (urlCb) urlCb.checked = probeFilterRules.urlBlacklist?.enabled !== false;
    if (titleCb) titleCb.checked = probeFilterRules.titleBlacklist?.enabled !== false;
    if (urlTa) urlTa.value = (probeFilterRules.urlBlacklist?.rules || []).join('\n');
    if (titleTa) titleTa.value = (probeFilterRules.titleBlacklist?.rules || []).join('\n');

    updateRuleModalCounts();

    const testRes = document.getElementById('probeRuleTestResult');
    if (testRes) testRes.style.display = 'none';
  }

  function closeRulesModal() {
    const modal = document.getElementById('probeRulesModal');
    if (!modal) return;
    modal.style.display = 'none';
  }

  function updateRuleModalCounts() {
    const urlTa = document.getElementById('probeRuleUrlTextarea');
    const titleTa = document.getElementById('probeRuleTitleTextarea');
    const urlCountEl = document.getElementById('probeRuleUrlCountDisplay');
    const titleCountEl = document.getElementById('probeRuleTitleCountDisplay');

    const urlList = (urlTa?.value || '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.startsWith('//'));
    const titleList = (titleTa?.value || '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.startsWith('//'));

    if (urlCountEl) urlCountEl.textContent = `${urlList.length} 条规则`;
    if (titleCountEl) titleCountEl.textContent = `${titleList.length} 条规则`;
  }

  async function saveProbeRules() {
    const urlCb = document.getElementById('probeRuleUrlEnabled');
    const titleCb = document.getElementById('probeRuleTitleEnabled');
    const urlTa = document.getElementById('probeRuleUrlTextarea');
    const titleTa = document.getElementById('probeRuleTitleTextarea');

    const urlRules = (urlTa?.value || '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.startsWith('//'));
    const titleRules = (titleTa?.value || '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.startsWith('//'));

    const payload = {
      urlBlacklist: {
        enabled: Boolean(urlCb?.checked),
        rules: urlRules
      },
      titleBlacklist: {
        enabled: Boolean(titleCb?.checked),
        rules: titleRules
      }
    };

    try {
      const saved = await apiRequest('/api/probe/rules', payload);
      if (saved) probeFilterRules = saved;
      updateRulesBadge();
      closeRulesModal();
      alert('✅ 过滤规则保存成功！下次探测或资产库导入将立即按新规则执行。');
    } catch (err) {
      alert(`保存规则失败：${err.message}`);
    }
  }

  async function resetProbeRules() {
    if (!confirm('确定将过滤规则恢复为系统内置的推荐默认规则吗？')) return;
    try {
      const reset = await apiRequest('/api/probe/rules/reset', {});
      if (reset) probeFilterRules = reset;
      openRulesModal();
      updateRulesBadge();
    } catch (err) {
      alert(`重置规则失败：${err.message}`);
    }
  }

  function testProbeRulesLocally() {
    const testUrl = (document.getElementById('probeRuleTestUrl')?.value || '').trim();
    const testTitle = (document.getElementById('probeRuleTestTitle')?.value || '').trim();
    const resultBox = document.getElementById('probeRuleTestResult');
    if (!resultBox) return;

    if (!testUrl && !testTitle) {
      alert('请至少输入一个测试 URL 或网页标题');
      return;
    }

    const urlCb = document.getElementById('probeRuleUrlEnabled');
    const titleCb = document.getElementById('probeRuleTitleEnabled');
    const urlTa = document.getElementById('probeRuleUrlTextarea');
    const titleTa = document.getElementById('probeRuleTitleTextarea');

    const urlRules = (urlTa?.value || '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.startsWith('//'));
    const titleRules = (titleTa?.value || '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.startsWith('//'));

    function matchSingle(text, ruleStr) {
      const trimmed = ruleStr.trim();
      if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
        const lastSlash = trimmed.lastIndexOf('/');
        try {
          const re = new RegExp(trimmed.slice(1, lastSlash), trimmed.slice(lastSlash + 1) || 'i');
          return re.test(text);
        } catch (_) {}
      }
      if (trimmed.includes('*')) {
        const escaped = trimmed.replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&');
        const re = new RegExp(escaped.replace(/\\\*/g, '.*'), 'i');
        return re.test(text);
      }
      return text.toLowerCase().includes(trimmed.toLowerCase());
    }

    let matchedUrlRule = null;
    if (urlCb?.checked && testUrl) {
      for (const r of urlRules) {
        if (matchSingle(testUrl, r)) {
          matchedUrlRule = r;
          break;
        }
      }
    }

    let matchedTitleRule = null;
    if (titleCb?.checked && testTitle) {
      for (const r of titleRules) {
        if (matchSingle(testTitle, r)) {
          matchedTitleRule = r;
          break;
        }
      }
    }

    resultBox.style.display = 'block';
    if (matchedUrlRule) {
      resultBox.style.background = '#fee2e2';
      resultBox.style.color = '#991b1b';
      resultBox.style.border = '1px solid #fca5a5';
      resultBox.innerHTML = `🚫 <strong>命中 URL 黑名单规则</strong>：包含 <code>"${escapeHtml(matchedUrlRule)}"</code>（将在发起请求前 0ms 直接前置剔除）`;
    } else if (matchedTitleRule) {
      resultBox.style.background = '#ffedd5';
      resultBox.style.color = '#9a3412';
      resultBox.style.border = '1px solid #fdba74';
      resultBox.innerHTML = `🚫 <strong>命中 网页标题 黑名单规则</strong>：包含 <code>"${escapeHtml(matchedTitleRule)}"</code>（抓取后嗅探标题立即熔断剔除）`;
    } else {
      resultBox.style.background = '#f0fdf4';
      resultBox.style.color = '#166534';
      resultBox.style.border = '1px solid #bbf7d0';
      resultBox.innerHTML = `🟢 <strong>安全通过</strong>：未命中当前配置的任何黑名单规则，允许正常抓取并分析博客表单。`;
    }
  }

  /**
   * 启动批量探测任务
   */
  async function startProbe() {
    const urlsTextarea = document.getElementById('probeUrlsTextarea');
    const { urls } = parseUrlsFromText(urlsTextarea?.value || '');

    if (urls.length === 0) {
      alert('请先输入或上传待探测的 URL 列表');
      return;
    }

    if (probeState.activeHistoryId) {
      probeState.activeHistoryId = null;
      const banner = document.getElementById('probeHistoryActiveBanner');
      if (banner) banner.style.display = 'none';
    }

    const concurrency = Number(document.getElementById('probeConcurrency')?.value || 20);
    const timeoutMs = Number(document.getElementById('probeTimeout')?.value || 8000);
    const skipExisting = document.getElementById('probeSkipExisting')?.checked !== false;

    const startBtn = document.getElementById('probeStartBtn');
    const cancelBtn = document.getElementById('probeCancelBtn');
    if (startBtn) startBtn.disabled = true;

    try {
      const now = new Date();
      const title = `${now.toLocaleString('zh-CN', { hour12: false })} (共 ${urls.length} 条待测)`;
      const res = await apiRequest('/api/probe/start', {
        title,
        urls,
        concurrency,
        timeoutMs,
        skipExisting
      });

      probeState.sessionId = res.sessionId;
      probeState.status = 'running';
      probeState.selectedUrls.clear();

      if (cancelBtn) cancelBtn.style.display = 'inline-block';
      document.getElementById('probeProgressCard').style.display = 'block';
      document.getElementById('probeResultsCard').style.display = 'block';

      startPolling();
    } catch (err) {
      alert(`启动探测失败：${err.message}`);
      if (startBtn) startBtn.disabled = false;
    }
  }

  /**
   * 运行基准测试
   */
  async function startBenchmark() {
    if (!confirm('确定运行库内 Top 50 条优质资产基准测试吗？这将自动提取数据库中历史成功率最高的 50 条外链验证算法准确率。')) {
      return;
    }

    const concurrency = Number(document.getElementById('probeConcurrency')?.value || 20);
    const startBtn = document.getElementById('probeStartBtn');
    const cancelBtn = document.getElementById('probeCancelBtn');
    if (startBtn) startBtn.disabled = true;

    try {
      const res = await apiRequest('/api/probe/benchmark', {
        limit: 50,
        concurrency
      });

      probeState.sessionId = res.sessionId;
      probeState.status = 'running';
      probeState.selectedUrls.clear();

      if (cancelBtn) cancelBtn.style.display = 'inline-block';
      document.getElementById('probeProgressCard').style.display = 'block';
      document.getElementById('probeResultsCard').style.display = 'block';

      startPolling();
    } catch (err) {
      alert(`启动基准测试失败：${err.message}`);
      if (startBtn) startBtn.disabled = false;
    }
  }

  /**
   * 取消当前探测
   */
  async function cancelProbe() {
    if (!confirm('确定中止当前的探测任务吗？已探测的结果将被保留。')) return;

    try {
      await apiRequest('/api/probe/cancel', {});
    } catch (err) {
      console.warn('取消探测失败：', err.message);
    }
  }

  /**
   * 轮询后端进度
   */
  function startPolling() {
    if (probeState.pollTimer) clearInterval(probeState.pollTimer);

    probeState.pollTimer = setInterval(async () => {
      try {
        const res = await apiRequest('/api/probe/status?limit=1000');
        if (!res.hasSession || !res.session) return;

        const s = res.session;
        probeState.status = s.status;
        probeState.total = s.total;
        probeState.processed = s.processed;
        probeState.progressPercent = s.progressPercent;
        probeState.elapsedSeconds = s.elapsedSeconds;
        probeState.stats = s.stats;
        probeState.results = s.results;

        updateProgressUI();
        renderProbeResultTable();

        if (s.status === 'completed' || s.status === 'canceled') {
          clearInterval(probeState.pollTimer);
          probeState.pollTimer = null;
          document.getElementById('probeStartBtn').disabled = false;
          document.getElementById('probeCancelBtn').style.display = 'none';

          const statusBadge = document.getElementById('probeStatusBadge');
          if (statusBadge) {
            statusBadge.textContent = s.status === 'completed' ? '探测完成' : '已中止';
            statusBadge.style.background = s.status === 'completed' ? '#dcfce7' : '#fee2e2';
            statusBadge.style.color = s.status === 'completed' ? '#15803d' : '#991b1b';
          }
          loadHistoryBadgeCount();
        }
      } catch (err) {
        console.error('获取探测进度异常：', err);
      }
    }, 800);
  }

  async function checkCurrentProbeStatus() {
    try {
      const res = await apiRequest('/api/probe/status?limit=1000');
      if (res.hasSession && res.session) {
        const s = res.session;
        probeState.status = s.status;
        probeState.total = s.total;
        probeState.processed = s.processed;
        probeState.progressPercent = s.progressPercent;
        probeState.elapsedSeconds = s.elapsedSeconds;
        probeState.stats = s.stats;
        probeState.results = s.results;

        document.getElementById('probeProgressCard').style.display = 'block';
        document.getElementById('probeResultsCard').style.display = 'block';

        updateProgressUI();
        renderProbeResultTable();

        if (s.status === 'running') {
          document.getElementById('probeStartBtn').disabled = true;
          document.getElementById('probeCancelBtn').style.display = 'inline-block';
          startPolling();
        }
      }
    } catch (_) {}
  }

  function updateProgressUI() {
    const s = probeState;
    const progressLabel = document.getElementById('probeProgressLabel');
    const counter = document.getElementById('probeProgressCounter');
    const progressBar = document.getElementById('probeProgressBar');
    const elapsed = document.getElementById('probeElapsedSeconds');
    const statusBadge = document.getElementById('probeStatusBadge');

    const dedupText = s.stats && s.stats.dedupCount > 0 ? ` · 去重 ${s.stats.dedupCount} 条` : '';
    if (counter) counter.textContent = `${s.processed} / ${s.total} (${s.progressPercent}%)${dedupText}`;
    if (progressBar) progressBar.style.width = `${s.progressPercent}%`;
    if (elapsed) elapsed.textContent = s.elapsedSeconds;

    if (progressLabel) {
      progressLabel.textContent = s.status === 'running' ? '正在并发探测中...' : (s.status === 'completed' ? '探测完成！' : '任务已中止');
    }

    if (statusBadge) {
      if (s.status === 'running') {
        statusBadge.textContent = '运行中 ⚡';
        statusBadge.style.background = '#dbeafe';
        statusBadge.style.color = '#1e40af';
      }
    }

    // 更新各统计数字
    document.getElementById('statProbeValidWithUrl').textContent = s.stats.validBlogCommentWithUrl;
    document.getElementById('statProbeValidNoUrl').textContent = s.stats.validBlogCommentNoUrl;
    document.getElementById('statProbeNeedReview').textContent = s.stats.needReview;
    document.getElementById('statProbeClosedOrLogin').textContent = s.stats.commentsClosed + s.stats.loginRequired;
    const spamCount = (s.stats && s.stats.spamFilteredTotal) || 0;
    const spamElem = document.getElementById('statProbeSpamFiltered');
    if (spamElem) spamElem.textContent = spamCount;
    document.getElementById('statProbeAlreadyInLibrary').textContent = s.stats.alreadyInLibrary || 0;
    document.getElementById('statProbeInvalidOrFailed').textContent = s.stats.notBlogComment + s.stats.failed;

    // 选项卡统计
    const validCount = s.stats.validBlogCommentWithUrl + s.stats.validBlogCommentNoUrl + s.stats.bloggerComment;
    const inLibCount = s.stats.alreadyInLibrary || 0;
    document.getElementById('probeTabCountAll').textContent = s.results.length;
    document.getElementById('probeTabCountValid').textContent = validCount;
    const tabSpamElem = document.getElementById('probeTabCountSpam');
    if (tabSpamElem) tabSpamElem.textContent = spamCount;
    document.getElementById('probeTabCountReview').textContent = s.stats.needReview;
    document.getElementById('probeTabCountClosed').textContent = s.stats.commentsClosed + s.stats.loginRequired;
    document.getElementById('probeTabCountInLibrary').textContent = inLibCount;
    document.getElementById('probeTabCountInvalid').textContent = s.stats.notBlogComment + s.stats.failed;
  }

  function getFilteredResults() {
    const tab = probeState.activeTab;
    return probeState.results.filter((r) => {
      if (tab === 'all') return true;
      if (tab === 'valid') return r.isBlogComment && r.status !== 'already_in_library';
      if (tab === 'spam_filtered') return r.status === 'filtered_url_rule' || r.status === 'filtered_title_rule' || r.spamFiltered;
      if (tab === 'in_library') return r.status === 'already_in_library';
      if (tab === 'review') return r.status === 'suspect_need_review' || r.status === 'blocked_challenge';
      if (tab === 'closed') return r.status === 'comments_closed' || r.status === 'login_required';
      if (tab === 'invalid') return !r.isBlogComment && !r.spamFiltered && r.status !== 'already_in_library' && r.status !== 'suspect_need_review' && r.status !== 'blocked_challenge' && r.status !== 'comments_closed' && r.status !== 'login_required' && r.status !== 'filtered_url_rule' && r.status !== 'filtered_title_rule';
      return true;
    });
  }

  function renderProbeResultTable() {
    const tbody = document.getElementById('probeResultTableBody');
    if (!tbody) return;

    const visibleItems = getFilteredResults();
    if (visibleItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8;">当前分类下无结果</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    visibleItems.forEach((item) => {
      const tr = document.createElement('tr');
      const isSelected = probeState.selectedUrls.has(item.url);
      if (isSelected) tr.style.background = '#f0fdf4';

      let conclusionBadge = '';
      if (item.status === 'already_in_library') {
        conclusionBadge = `<span class="probe-conclusion-badge" style="background:#ede9fe;color:#6d28d9;border:1px solid #ddd6fe;">⏩ 资产库已存在</span>`;
      } else if (item.status === 'filtered_url_rule') {
        conclusionBadge = `<span class="probe-conclusion-badge probe-pill-rule-url">🚫 命中URL黑名单 [${escapeHtml(item.matchedRule || '')}]</span>`;
      } else if (item.status === 'filtered_title_rule') {
        conclusionBadge = `<span class="probe-conclusion-badge probe-pill-rule-title">🚫 命中标题黑名单 [${escapeHtml(item.matchedRule || '')}]</span>`;
      } else if (item.isBlogComment) {
        conclusionBadge = `<span class="probe-conclusion-badge" style="background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;">🟢 ${escapeHtml(item.formType || '开放博客评论')}</span>`;
      } else if (item.status === 'suspect_need_review' || item.status === 'blocked_challenge') {
        conclusionBadge = `<span class="probe-conclusion-badge" style="background:#fef9c3;color:#854d0e;border:1px solid #fef08a;">🟡 ${escapeHtml(item.statusLabel || '待人工复核')}</span>`;
      } else if (item.status === 'comments_closed') {
        conclusionBadge = `<span class="probe-conclusion-badge" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;">🔒 评论已关闭</span>`;
      } else if (item.status === 'login_required') {
        conclusionBadge = `<span class="probe-conclusion-badge" style="background:#ffedd5;color:#9a3412;border:1px solid #fed7aa;">🔑 必须登录</span>`;
      } else {
        conclusionBadge = `<span class="probe-conclusion-badge" style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;">🔴 ${escapeHtml(item.statusLabel || '非博客')}</span>`;
      }

      // 外链字段能力标签
      let fieldCapHtml = '';
      if (item.status === 'already_in_library') {
        fieldCapHtml = `<span class="probe-field-badge" style="color:#6d28d9;background:#f5f3ff;border:1px solid #ddd6fe;" title="该域名已在外链资产库中，本次免测跳过">⏩ 库内已有资产</span>`;
      } else if (item.spamFiltered) {
        fieldCapHtml = `<span class="probe-field-badge" style="color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;" title="命中过滤规则，已剔除">🚫 规则剔除</span>`;
      } else if (item.hasUrlField) {
        fieldCapHtml = `<span class="probe-field-badge" style="color:#15803d;background:#ecfdf5;border:1px solid #a7f3d0;" title="页面含有独立的 Website/URL 网址输入框">🔗 独立外链URL</span>`;
      } else if (item.hasCommentField) {
        fieldCapHtml = `<span class="probe-field-badge" style="color:#0284c7;background:#f0f9ff;border:1px solid #bae6fd;" title="页面有评论框与姓名邮箱，外链需通过 AI 生成在评论正文里">📝 正文插入外链</span>`;
      } else {
        fieldCapHtml = `<span style="font-size:11px;color:#94a3b8;white-space:nowrap;">无评论表单</span>`;
      }

      // 响应耗时与状态
      let httpBadge = '';
      if (item.status === 'already_in_library') {
        httpBadge = `<span class="probe-status-text" style="color:#6d28d9;">⚡ 免测跳过 (0ms)</span>`;
      } else if (item.status === 'filtered_url_rule') {
        httpBadge = `<span class="probe-status-text" style="color:#b91c1c;">⚡ 前置拦截 (0ms)</span>`;
      } else if (item.status === 'filtered_title_rule') {
        httpBadge = `<span class="probe-status-text" style="color:#ea580c;">🛑 标题熔断 (${item.elapsedMs}ms)</span>`;
      } else if (item.httpStatus === 200) {
        httpBadge = `<span class="probe-status-text" style="color:#059669;">200 OK (${item.elapsedMs}ms)</span>`;
      } else if (item.httpStatus > 0) {
        httpBadge = `<span class="probe-status-text" style="color:#dc2626;">HTTP ${item.httpStatus}</span>`;
      } else {
        httpBadge = `<span class="probe-status-text" style="color:#b91c1c;">${escapeHtml(item.statusLabel)}</span>`;
      }

      tr.innerHTML = `
        <td style="text-align:center;">
          <input type="checkbox" class="probe-row-checkbox" data-url="${escapeHtml(item.url)}" ${isSelected ? 'checked' : ''} />
        </td>
        <td>
          <div style="font-weight:700;color:#1e293b;font-size:13px;">${escapeHtml(item.domain)}</div>
        </td>
        <td class="probe-title-cell" title="${escapeHtml(item.title || '')}">
          ${item.title ? escapeHtml(item.title) : '<span style="color:#94a3b8;font-size:11px;">—</span>'}
        </td>
        <td class="probe-url-cell">
          <div>
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="probe-url-link" title="${escapeHtml(item.url)}">
              ${escapeHtml(item.url)}
            </a>
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" style="color:#64748b;text-decoration:none;margin-left:4px;font-size:11px;" title="新标签页打开">↗</a>
          </div>
          <div class="probe-url-details">${escapeHtml(item.details || '')}</div>
        </td>
        <td>${conclusionBadge}</td>
        <td>${fieldCapHtml}</td>
        <td>${httpBadge}</td>
        <td style="text-align:center;">
          <div class="probe-actions-cell">
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-xs" style="text-decoration:none;padding:3px 8px;white-space:nowrap;" title="在浏览器新标签页打开核验">🔗 验证</a>
            ${
              item.status === 'already_in_library'
                ? `<button type="button" class="btn btn-secondary btn-xs btn-probe-view-asset" data-domain="${escapeHtml(item.domain)}" style="padding:3px 8px;white-space:nowrap;color:#6d28d9;" title="前往外链资产库查看此域名的历史沉淀">👁️ 查资产</button>`
                : `<button type="button" class="btn btn-secondary btn-xs btn-probe-single-import" data-url="${escapeHtml(item.url)}" data-domain="${escapeHtml(item.domain)}" style="padding:3px 8px;white-space:nowrap;">📥 入库</button>`
            }
          </div>
        </td>
      `;

      tr.querySelector('.probe-row-checkbox')?.addEventListener('change', (e) => {
        const u = e.target.dataset.url;
        if (e.target.checked) probeState.selectedUrls.add(u);
        else probeState.selectedUrls.delete(u);
        tr.style.background = e.target.checked ? '#f0fdf4' : '';
        updateSelectedCountDisplay();
      });

      tr.querySelector('.btn-probe-single-import')?.addEventListener('click', () => {
        probeState.selectedUrls.clear();
        probeState.selectedUrls.add(item.url);
        updateSelectedCountDisplay();
        openImportModal();
      });

      tr.querySelector('.btn-probe-view-asset')?.addEventListener('click', () => {
        const assetsTabBtn = document.querySelector('[data-tab-target="assets"]');
        if (assetsTabBtn) {
          assetsTabBtn.click();
          setTimeout(() => {
            const kwInput = document.getElementById('assetFilterKeyword');
            if (kwInput) {
              kwInput.value = item.domain;
              kwInput.dispatchEvent(new Event('input'));
              document.getElementById('assetSearchBtn')?.click();
            }
          }, 250);
        }
      });

      tbody.appendChild(tr);
    });
  }

  function updateSelectedCountDisplay() {
    const el = document.getElementById('probeSelectedCountDisplay');
    if (el) el.textContent = probeState.selectedUrls.size;
  }

  function openImportModal() {
    if (probeState.selectedUrls.size === 0) {
      alert('请先勾选需要入库的外链（或点击“勾选全部可用博客”）');
      return;
    }

    const modal = document.getElementById('probeImportConfirmModal');
    const modalCount = document.getElementById('probeModalCountDisplay');
    const tagsInput = document.getElementById('probeImportTagsInput');

    if (modalCount) modalCount.textContent = probeState.selectedUrls.size;
    if (tagsInput && !tagsInput.value) {
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      tagsInput.value = `probe-${todayStr}`;
    }

    if (modal) modal.style.display = 'flex';
  }

  function closeImportModal() {
    const modal = document.getElementById('probeImportConfirmModal');
    if (modal) modal.style.display = 'none';
  }

  /**
   * 执行一键入库到外链资产库
   */
  async function executeImport() {
    const selectedUrlsList = Array.from(probeState.selectedUrls);
    if (selectedUrlsList.length === 0) return;

    const itemsToImport = probeState.results
      .filter((r) => probeState.selectedUrls.has(r.url))
      .map((r) => ({
        url: r.url,
        domain: r.domain,
        details: r.details || r.formType || '博客外链探测'
      }));

    const tagsInput = document.getElementById('probeImportTagsInput');
    const rawTags = tagsInput?.value || '';
    const tags = rawTags.split(',').map((t) => t.trim()).filter(Boolean);

    const duplicateStrategyEl = document.querySelector('input[name="probeDuplicateStrategy"]:checked');
    const duplicateStrategy = duplicateStrategyEl?.value || 'skip';
    const defaultType = document.getElementById('probeImportTypeSelect')?.value || 'blog_comment';

    const execBtn = document.getElementById('probeExecuteImportBtn');
    if (execBtn) {
      execBtn.disabled = true;
      execBtn.textContent = '正在入库...';
    }

    try {
      const result = await apiRequest('/api/probe/import', {
        items: itemsToImport,
        duplicateStrategy,
        tags,
        defaultType
      });

      closeImportModal();
      alert(`🎉 成功入库！\n- 新增入库：${result.insertedCount} 个\n- 跳过/更新已有：${result.skippedCount} 个\n已打上标签并在外链资产库沉淀完毕。`);

      // 询问用户是否跳转资产库筛选跑批
      if (confirm('是否立即前往「外链资产库」查看新入库的外链并一键注入跑批任务？')) {
        const assetsTabBtn = document.querySelector('[data-tab-target="assets"]');
        if (assetsTabBtn) {
          assetsTabBtn.click();
          setTimeout(() => {
            const timeFilter = document.getElementById('assetFilterTimeRange');
            if (timeFilter) {
              timeFilter.value = 'today';
              timeFilter.dispatchEvent(new Event('change'));
            }
          }, 300);
        }
      }
    } catch (err) {
      alert(`入库失败：${err.message}`);
    } finally {
      if (execBtn) {
        execBtn.disabled = false;
        execBtn.textContent = '确认一键入库';
      }
    }
  }

  /**
   * 导出 Excel (.xlsx)
   */
  function exportProbeExcel() {
    if (probeState.results.length === 0) {
      alert('暂无探测结果可导出');
      return;
    }

    const headers = [
      '引荐域名',
      '网页标题',
      '入口引荐URL',
      '是否博客评论',
      '判定状态',
      '博客系统/表单类型',
      '独立外链URL字段',
      '作者姓名输入框',
      '电子邮箱输入框',
      '评论内容输入框',
      'HTTP响应状态',
      '探测耗时(ms)',
      '资产库已存状态',
      '命中黑名单规则',
      '判定详细说明'
    ];

    const rows = probeState.results.map((r) => {
      let blogStatus = '否';
      if (r.status === 'already_in_library') blogStatus = '库内已有资产';
      else if (r.status === 'filtered_url_rule' || r.status === 'filtered_title_rule' || r.spamFiltered) blogStatus = '垃圾黑名单剔除';
      else if (r.isBlogComment) blogStatus = '是 (开放博客)';
      else if (r.status === 'comments_closed') blogStatus = '博客但评论已关闭';
      else if (r.status === 'login_required') blogStatus = '博客但需登录';

      return [
        r.domain || '',
        r.title || '',
        r.url || '',
        blogStatus,
        r.statusLabel || '',
        r.formType || '',
        r.hasUrlField ? '支持 (独立字段)' : '不支持 (需正文插入)',
        r.hasAuthorField ? '有' : '无',
        r.hasEmailField ? '有' : '无',
        r.hasCommentField ? '有' : '无',
        r.httpStatus || 0,
        r.elapsedMs || 0,
        r.status === 'already_in_library' ? '已在库内 (已跳过)' : (r.spamFiltered ? '垃圾规则拦截' : '新发现外链'),
        r.matchedRule ? `命中 [${r.matchedRule}]` : '—',
        (r.details || '').replace(/\r?\n/g, ' ')
      ];
    });

    if (window.XLSX && window.XLSX.utils) {
      const aoa = [headers, ...rows];
      const ws = window.XLSX.utils.aoa_to_sheet(aoa);

      ws['!cols'] = [
        { wch: 22 }, // 引荐域名
        { wch: 30 }, // 网页标题
        { wch: 50 }, // 入口URL
        { wch: 18 }, // 是否博客
        { wch: 26 }, // 判定状态
        { wch: 22 }, // 表单类型
        { wch: 20 }, // 外链字段
        { wch: 14 }, // 作者框
        { wch: 14 }, // 邮箱框
        { wch: 14 }, // 评论框
        { wch: 14 }, // HTTP状态
        { wch: 14 }, // 耗时(ms)
        { wch: 18 }, // 库内状态
        { wch: 20 }, // 命中黑名单规则
        { wch: 60 }  // 判定详情
      ];

      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, '博客探测明细');

      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      window.XLSX.writeFile(wb, `博客外链探测结果_${dateStr}_共${probeState.results.length}条.xlsx`);
    } else {
      exportProbeCsv();
    }
  }

  /**
   * 兜底回退 CSV 导出
   */
  function exportProbeCsv() {
    if (probeState.results.length === 0) {
      alert('暂无探测结果可导出');
      return;
    }

    const headers = ['引荐域名', '入口URL', '是否博客评论', '判定状态', '博客表单类型', '是否有独立外链URL字段', 'HTTP状态', '耗时(ms)', '判定说明'];
    const rows = probeState.results.map((r) => [
      `"${(r.domain || '').replace(/"/g, '""')}"`,
      `"${(r.url || '').replace(/"/g, '""')}"`,
      r.status === 'already_in_library' ? '库内已有' : (r.isBlogComment ? '是' : '否'),
      `"${(r.statusLabel || '').replace(/"/g, '""')}"`,
      `"${(r.formType || '').replace(/"/g, '""')}"`,
      r.hasUrlField ? '支持' : '不支持',
      r.httpStatus,
      r.elapsedMs,
      `"${(r.details || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `probe_results_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // --- 历史档案相关方法 ---

  /**
   * 加载历史记录总数徽标
   */
  async function loadHistoryBadgeCount() {
    try {
      const res = await apiRequest('/api/probe/history?limit=1');
      const badge = document.getElementById('probeHistoryBadge');
      if (badge && res && res.total !== undefined) {
        badge.textContent = res.total;
      }
    } catch (e) {
      console.warn('获取探测历史数量失败：', e);
    }
  }

  /**
   * 打开历史档案弹窗
   */
  async function openHistoryModal() {
    const modal = document.getElementById('probeHistoryModal');
    if (!modal) return;
    modal.style.display = 'flex';

    const container = document.getElementById('probeHistoryListContainer');
    const totalCountEl = document.getElementById('probeHistoryTotalCount');
    if (container) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:#94a3b8;font-size:12px;">正在读取历史归档...</div>';
    }

    try {
      const res = await apiRequest('/api/probe/history?limit=100');
      const items = (res && res.items) || [];
      if (totalCountEl) totalCountEl.textContent = items.length;
      const badge = document.getElementById('probeHistoryBadge');
      if (badge) badge.textContent = items.length;

      if (items.length === 0) {
        if (container) {
          container.innerHTML = `
            <div style="text-align:center;padding:40px 20px;color:#94a3b8;font-size:13px;background:#f8fafc;border-radius:8px;">
              <div style="font-size:32px;margin-bottom:8px;">📭</div>
              <div>暂无历史探测归档记录</div>
              <div style="font-size:11px;color:#cbd5e1;margin-top:4px;">每次启动并发探测完成后，系统均会自动沉淀在本地数据库中，关闭或重装插件不丢失</div>
            </div>
          `;
        }
        return;
      }

      renderHistoryList(items, container);
    } catch (err) {
      if (container) {
        container.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;font-size:12px;">读取历史记录失败：${escapeHtml(err.message)}</div>`;
      }
    }
  }

  /**
   * 关闭历史档案弹窗
   */
  function closeHistoryModal() {
    const modal = document.getElementById('probeHistoryModal');
    if (modal) modal.style.display = 'none';
  }

  /**
   * 渲染历史档案列表
   */
  function renderHistoryList(items, container) {
    if (!container) return;
    container.innerHTML = items
      .map((item) => {
        const timeStr = new Date(item.created_at).toLocaleString('zh-CN', { hour12: false });
        const isCurrentActive = probeState.activeHistoryId === item.id;
        const total = item.total_count || 0;
        const valid = item.valid_blog_count || 0;
        const inLib = item.already_in_library_count || 0;
        const closed = item.closed_or_login_count || 0;
        const invalid = (item.not_blog_count || 0) + (item.failed_count || 0);

        return `
          <div class="probe-history-item" style="${isCurrentActive ? 'border-color:#6366f1;background:#eef2ff;' : ''}">
            <div class="probe-history-meta">
              <div style="display:flex;align-items:center;gap:8px;">
                <strong style="font-size:13px;color:#0f172a;">${escapeHtml(item.title || timeStr)}</strong>
                ${isCurrentActive ? '<span class="badge badge-info" style="background:#4f46e5;color:#fff;font-size:10px;">当前正在查看</span>' : ''}
                <span class="badge" style="background:${item.status === 'completed' ? '#ecfdf5;color:#065f46;' : '#fef2f2;color:#991b1b;'}font-size:10px;">
                  ${item.status === 'completed' ? '已完成' : '已中止'}
                </span>
              </div>
              <div style="font-size:11px;color:#64748b;">
                探测时间：${timeStr} · 耗时：${item.elapsed_seconds || 0}秒 · 并发：${item.concurrency || 20}
              </div>
              <div class="probe-history-badges">
                <span class="probe-history-pill" style="background:#f1f5f9;color:#334155;">共 ${total} 条</span>
                <span class="probe-history-pill" style="background:#ecfdf5;color:#065f46;">🟢 ${valid} 可用博客</span>
                <span class="probe-history-pill" style="background:#eff6ff;color:#1e40af;">⏩ ${inLib} 库内已有</span>
                <span class="probe-history-pill" style="background:#fffbeb;color:#92400e;">🔒 ${closed} 评论关闭/需登录</span>
                <span class="probe-history-pill" style="background:#fef2f2;color:#991b1b;">🔴 ${invalid} 非博客/失败</span>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <button type="button" class="btn btn-primary btn-sm btn-load-history" data-history-id="${item.id}" style="padding:4px 10px;font-size:11px;">
                📂 载入此批次校对
              </button>
              <button type="button" class="btn btn-secondary btn-sm btn-delete-history" data-history-id="${item.id}" style="padding:4px 8px;font-size:11px;color:#b91c1c;border-color:#fecaca;" title="删除该批次归档">
                🗑️
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('.btn-load-history').forEach((btn) => {
      btn.addEventListener('click', () => {
        loadHistorySession(btn.dataset.historyId);
      });
    });

    container.querySelectorAll('.btn-delete-history').forEach((btn) => {
      btn.addEventListener('click', () => {
        deleteHistorySession(btn.dataset.historyId);
      });
    });
  }

  /**
   * 载入指定历史会话到主界面进行校对
   */
  async function loadHistorySession(sessionId) {
    try {
      const res = await apiRequest(`/api/probe/history/${sessionId}`);
      if (!res) {
        alert('未找到该探测历史归档');
        return;
      }

      if (probeState.pollTimer) {
        clearInterval(probeState.pollTimer);
        probeState.pollTimer = null;
      }

      probeState.sessionId = res.id;
      probeState.status = res.status;
      probeState.total = res.total_count || 0;
      probeState.processed = res.processed_count || 0;
      probeState.progressPercent = 100;
      probeState.elapsedSeconds = res.elapsed_seconds || 0;
      probeState.stats = res.stats || {};
      probeState.results = res.results || [];
      probeState.selectedUrls.clear();
      probeState.activeHistoryId = res.id;

      // 隐藏进度卡片，显示结果卡片
      const progressCard = document.getElementById('probeProgressCard');
      if (progressCard) progressCard.style.display = 'none';

      const resultsCard = document.getElementById('probeResultsCard');
      if (resultsCard) resultsCard.style.display = 'block';

      // 显示历史查看横幅
      const banner = document.getElementById('probeHistoryActiveBanner');
      const titleEl = document.getElementById('probeHistoryActiveTitle');
      if (banner) banner.style.display = 'flex';
      if (titleEl) {
        titleEl.textContent = `${res.title || new Date(res.created_at).toLocaleString('zh-CN')} (共 ${probeState.results.length} 条结果)`;
      }

      // 刷新界面数据与表格
      updateProgressUI();
      renderProbeResultTable();

      closeHistoryModal();

      resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      alert(`载入历史记录失败：${err.message}`);
    }
  }

  /**
   * 退出历史查看，回到初始或最新状态
   */
  function exitHistoryView() {
    probeState.activeHistoryId = null;
    const banner = document.getElementById('probeHistoryActiveBanner');
    if (banner) banner.style.display = 'none';
    checkCurrentProbeStatus();
  }

  /**
   * 删除单条历史记录
   */
  async function deleteHistorySession(sessionId) {
    if (!confirm('确定要删除这条探测历史记录吗？此操作不可撤销。')) return;
    try {
      await apiRequest(`/api/probe/history/${sessionId}`, null, { method: 'DELETE' });
      if (probeState.activeHistoryId === sessionId) {
        exitHistoryView();
      }
      openHistoryModal();
      loadHistoryBadgeCount();
    } catch (err) {
      alert(`删除失败：${err.message}`);
    }
  }

  /**
   * 清空全部历史记录
   */
  async function clearAllHistory() {
    if (!confirm('确定要清空所有的历史探测记录吗？此操作将彻底删除所有本地归档。')) return;
    try {
      await apiRequest('/api/probe/history/clear', {});
      if (probeState.activeHistoryId) {
        exitHistoryView();
      }
      openHistoryModal();
      loadHistoryBadgeCount();
    } catch (err) {
      alert(`清空失败：${err.message}`);
    }
  }

  // 页面加载就绪时初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProbeUI);
  } else {
    initProbeUI();
  }
})();
