/**
 * LinkPilot 外链资产库（Backlink Asset Library）前端核心管理模块。
 * 负责资产库统计、多维筛选（含新站点隔离矩阵）、批量选择操作、导入查重解析与向批量任务分发。
 */
(function (root) {
  'use strict';

  // 外链类型注册表（非硬编码设计，可任意横向扩展）
  const RESOURCE_TYPES = {
    blog_comment: {
      id: 'blog_comment',
      label: '博客评论',
      icon: '💬',
      badgeClass: 'type-badge-blue',
      color: '#2563eb',
      bg: '#eff6ff',
      border: '#bfdbfe',
      desc: '在博客文章评论区留言并留下反向链接'
    },
    directory_submission: {
      id: 'directory_submission',
      label: '导航目录站',
      icon: '📑',
      badgeClass: 'type-badge-purple',
      color: '#7c3aed',
      bg: '#f5f3ff',
      border: '#ddd6fe',
      desc: '向分类目录、工具聚合站或网址导航提交收录'
    },
    forum_thread: {
      id: 'forum_thread',
      label: '论坛社区',
      icon: '🗣️',
      badgeClass: 'type-badge-orange',
      color: '#ea580c',
      bg: '#fff7ed',
      border: '#fed7aa',
      desc: '在相关行业论坛、主题版块发帖或回帖互动'
    },
    guest_post: {
      id: 'guest_post',
      label: '文章投稿',
      icon: '📝',
      badgeClass: 'type-badge-green',
      color: '#16a34a',
      bg: '#f0fdf4',
      border: '#bbf7d0',
      desc: '向支持投稿的媒体或个人专栏投递整篇文章'
    },
    profile_link: {
      id: 'profile_link',
      label: '个人主页',
      icon: '👤',
      badgeClass: 'type-badge-gray',
      color: '#4b5563',
      bg: '#f3f4f6',
      border: '#e5e7eb',
      desc: '在平台注册 Profile 资料页并附带网站链接'
    },
    other: {
      id: 'other',
      label: '其他外链',
      icon: '🔗',
      badgeClass: 'type-badge-slate',
      color: '#64748b',
      bg: '#f8fafc',
      border: '#cbd5e1',
      desc: '其他未分类形式的外部引荐链接'
    }
  };

  // 质量评级字典
  const QUALITY_TIERS = {
    high_quality: {
      id: 'high_quality',
      label: '优质可用',
      icon: '🟢',
      badgeClass: 'tier-badge-high',
      color: '#059669',
      bg: '#ecfdf5',
      desc: '历史成功率高（≥50%）且最近执行成功'
    },
    manual_needed: {
      id: 'manual_needed',
      label: '需人工',
      icon: '🟡',
      badgeClass: 'tier-badge-manual',
      color: '#d97706',
      bg: '#fffbeb',
      desc: '包含复杂验证码、需登录或富文本表单'
    },
    broken: {
      id: 'broken',
      label: '失效/无框',
      icon: '🔴',
      badgeClass: 'tier-badge-broken',
      color: '#dc2626',
      bg: '#fef2f2',
      desc: '多次检测无评论框或无法完成提交'
    },
    untested: {
      id: 'untested',
      label: '未测试',
      icon: '⚪',
      badgeClass: 'tier-badge-untested',
      color: '#6b7280',
      bg: '#f9fafb',
      desc: '外部新导入，尚未在实际任务中执行探测'
    },
    blacklisted: {
      id: 'blacklisted',
      label: '风险拦截',
      icon: '⛔',
      badgeClass: 'tier-badge-blacklisted',
      color: '#991b1b',
      bg: '#fee2e2',
      desc: '涉黄涉赌或命中违规站点黑名单'
    }
  };

  const DEFAULT_LOCAL_SERVER_BASE = 'http://127.0.0.1:17321';

  /**
   * 安全网络请求本地 Node.js 微服务。
   */
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

  function formatRelativeTime(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    if (!Number.isFinite(date.getTime())) return '—';
    const now = Date.now();
    const diffSec = Math.floor((now - date.getTime()) / 1000);
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
    if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)} 天前`;
    return date.toLocaleDateString();
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

  // 资产库状态管理器
  const state = {
    assets: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    selectedDomains: new Set(),
    summary: null,
    availablePromotionSites: [],
    activeTargetSiteDomain: '',
    filters: {
      resourceType: 'all',
      qualityTier: 'all',
      successRateRange: 'all',
      targetSiteDomain: '',
      targetSiteStatus: 'all',
      keyword: '',
      sortBy: 'success_rate',
      sortOrder: 'desc'
    },
    isLoading: false
  };

  /**
   * 初始化外链资产库 DOM 节点与事件绑定。
   */
  function initAssetLibraryUI() {
    const container = document.getElementById('assetLibraryContainer');
    if (!container) return;

    renderAssetLibrarySkeleton(container);
    bindEvents();
    loadPromotionSitesForAssetFilter();
    refreshAll();
  }

  /**
   * 渲染资产库主页面布局骨架。
   */
  function renderAssetLibrarySkeleton(container) {
    container.innerHTML = `
      <div class="asset-library-wrap">
        <!-- 顶部操作与标题栏 -->
        <div class="asset-header">
          <div>
            <div class="section-title" style="display:flex;align-items:center;gap:8px;">
              <span>💎 外链资产库</span>
              <span class="badge badge-info" id="assetTotalHeaderBadge">0 个</span>
            </div>
            <div class="section-desc">将实际执行过与外部导入的外链沉淀为持久资产。支持多维表现统计、智能质量评级、目标站点隔离筛选与一键投产。</div>
          </div>
          <div class="asset-header-actions">
            <button type="button" class="btn btn-secondary" id="assetExportBtn" title="把当前所有筛选与搜索条件匹配的全部数据导出为 Excel (CSV) 表格（导出全部匹配数据，非仅当前页）">📊 导出当前结果 (Excel)</button>
            <button type="button" class="btn btn-secondary" id="assetBootstrapBtn" title="扫描历史运行批次，一键回填建库">🔄 从历史任务建库</button>
            <button type="button" class="btn btn-primary" id="assetOpenImportModalBtn">📥 批量导入外链</button>
            <button type="button" class="btn btn-secondary" id="assetRefreshBtn" title="刷新列表与指标">🔄 刷新</button>
          </div>
        </div>

        <!-- 概览指标卡片 -->
        <div class="asset-summary-grid">
          <div class="asset-stat-card" data-tier-filter="all">
            <div class="stat-label">总外链资产</div>
            <div class="stat-num stat-total" id="statAssetTotal">0</div>
            <div class="stat-foot" id="statAssetTypesFoot">博客评论: 0</div>
          </div>
          <div class="asset-stat-card" data-tier-filter="high_quality" title="点击快速筛选优质外链">
            <div class="stat-label">🟢 优质可用</div>
            <div class="stat-num stat-high" id="statAssetHigh">0</div>
            <div class="stat-foot">高成功率 / 最近成功</div>
          </div>
          <div class="asset-stat-card" data-tier-filter="manual_needed" title="点击快速筛选需人工外链">
            <div class="stat-label">🟡 需人工处理</div>
            <div class="stat-num stat-manual" id="statAssetManual">0</div>
            <div class="stat-foot">验证码 / 需登录</div>
          </div>
          <div class="asset-stat-card" data-tier-filter="broken" title="点击快速筛选失效外链">
            <div class="stat-label">🔴 失效/无框</div>
            <div class="stat-num stat-broken" id="statAssetBroken">0</div>
            <div class="stat-foot">无评论框 / 连续失败</div>
          </div>
          <div class="asset-stat-card" data-tier-filter="untested" title="点击快速筛选未测试外链">
            <div class="stat-label">⚪ 外部新录入</div>
            <div class="stat-num stat-untested" id="statAssetUntested">0</div>
            <div class="stat-foot">待执行探测</div>
          </div>
          <div class="asset-stat-card" title="全库平均自动化成功率">
            <div class="stat-label">📈 平均成功率</div>
            <div class="stat-num stat-rate" id="statAssetAvgRate">0.0%</div>
            <div class="stat-foot">加权实际表现</div>
          </div>
        </div>

        <!-- 筛选与控制面板 -->
        <div class="card asset-filter-card">
          <div class="asset-filter-row">
            <div class="filter-group">
              <label>外链类型：</label>
              <select id="assetFilterType">
                <option value="all">全部类型 (全部)</option>
                ${Object.values(RESOURCE_TYPES).map((t) => `<option value="${t.id}">${t.icon} ${t.label}</option>`).join('')}
              </select>
            </div>

            <div class="filter-group">
              <label>质量评级：</label>
              <select id="assetFilterQuality">
                <option value="all">全部评级 (全部)</option>
                ${Object.values(QUALITY_TIERS).map((q) => `<option value="${q.id}">${q.icon} ${q.label}</option>`).join('')}
              </select>
            </div>

            <div class="filter-group">
              <label>成功率阈值：</label>
              <select id="assetFilterSuccessRate">
                <option value="all">不限成功率</option>
                <option value="80">≥ 80% (极高成功)</option>
                <option value="60">≥ 60% (高成功率)</option>
                <option value="40">≥ 40% (可用)</option>
                <option value="0">0% (全部未成)</option>
              </select>
            </div>

            <div class="filter-group">
              <label>页面深度：</label>
              <select id="assetFilterPageDepth">
                <option value="all">全部深度 (全部)</option>
                <option value="shallow">🟢 浅页面 (≤20 屏 - 推荐)</option>
                <option value="medium">🟡 中等 (20~50 屏)</option>
                <option value="deep">🟠 较深 (50~100 屏)</option>
                <option value="very_deep">🔴 极深 (>100 屏 - 需换页)</option>
                <option value="unknown">⚪ 深度未知</option>
              </select>
            </div>

            <!-- 录入时间筛选 -->
            <div class="filter-group">
              <label>添加时间：</label>
              <select id="assetFilterTimeRange">
                <option value="all">全部时间</option>
                <option value="today">⚡ 今天添加</option>
                <option value="3days">近 3 天</option>
                <option value="7days">近 7 天</option>
                <option value="30days">近 30 天</option>
              </select>
            </div>

            <!-- 来源渠道筛选 -->
            <div class="filter-group">
              <label>来源渠道：</label>
              <select id="assetFilterSourceChannel">
                <option value="all">全部来源</option>
                <option value="probe_discovery">🔍 博客探测入库</option>
                <option value="run_harvest">🤖 任务自动沉淀</option>
                <option value="batch_import">📂 表格/手动导入</option>
              </select>
            </div>

            <!-- 核心：新网站隔离矩阵筛选 -->
            <div class="filter-group filter-target-matrix">
              <label>🎯 目标站专属隔离：</label>
              <div class="matrix-select-wrap">
                <select id="assetFilterTargetDomain" title="选择要建立外链的目标网站">
                  <option value="">-- 选择目标站点 --</option>
                </select>
                <select id="assetFilterTargetStatus" title="针对该目标站的历史关系筛选">
                  <option value="never_succeeded">🌟 未为该站点成功做过 (挑新外链)</option>
                  <option value="never_run">⚪ 从未在该站点跑过</option>
                  <option value="succeeded">✅ 已为该站点成功发布</option>
                  <option value="all">不限关系</option>
                </select>
              </div>
            </div>

            <div class="filter-group" style="flex:1;min-width:200px;">
              <label>搜索：</label>
              <input type="text" id="assetFilterKeyword" placeholder="搜域名 / 入口URL / 标签 / 备注..." autocomplete="off" />
            </div>

            <div class="filter-group">
              <label>排序方式：</label>
              <select id="assetSortBy">
                <option value="success_rate-desc">成功率 降序</option>
                <option value="page_depth-asc">页面深度 升序 (优先浅页)</option>
                <option value="page_depth-desc">页面深度 降序</option>
                <option value="total_attempts-desc">执行次数 降序</option>
                <option value="last_executed_at-desc">最近执行 降序</option>
                <option value="created_at-desc">录入时间 降序</option>
                <option value="referral_domain-asc">域名 A-Z</option>
              </select>
            </div>
          </div>
        </div>

        <!-- 浮动多选批量操作条 -->
        <div class="asset-batch-action-bar" id="assetBatchActionBar" style="display:none;">
          <div class="batch-bar-info">
            <span>已勾选 <strong id="assetSelectedCount">0</strong> 个外链域名</span>
          </div>
          <div class="batch-bar-btns">
            <button type="button" class="btn btn-primary" id="assetBatchSendToTaskBtn">🚀 批量添加到任务执行列表</button>
            <button type="button" class="btn btn-secondary" id="assetBatchChangeTypeBtn">🏷️ 批量设为类型</button>
            <button type="button" class="btn btn-secondary btn-danger-outline" id="assetBatchDeleteBtn">🗑️ 批量删除</button>
            <button type="button" class="btn btn-secondary" id="assetClearSelectionBtn">取消勾选</button>
          </div>
        </div>

        <!-- 资产表格主体 -->
        <div class="card asset-table-card">
          <div class="asset-table-wrap">
            <table class="asset-table" id="assetTable">
              <thead>
                <tr>
                  <th style="width:38px;text-align:center;">
                    <input type="checkbox" id="assetSelectAllCheckbox" title="全选当前页" />
                  </th>
                  <th>引荐域名</th>
                  <th style="width:105px;">外链类型</th>
                  <th>入口引荐 URL</th>
                  <th style="width:115px;">页面深度</th>
                  <th style="width:135px;">执行表现 / 成功率</th>
                  <th style="width:95px;">质量评级</th>
                  <th style="width:120px;">最近执行</th>
                  <th>目标站覆盖</th>
                  <th>备注 / 标签</th>
                  <th style="width:105px;text-align:center;">操作</th>
                </tr>
              </thead>
              <tbody id="assetTableBody">
                <tr><td colspan="11" style="text-align:center;padding:40px;color:#94a3b8;">正在加载外链资产...</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 分页控件 -->
          <div class="asset-pagination">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
              <div class="asset-page-info" id="assetPaginationInfo">显示 0 - 0 条，共 0 条</div>
              <button type="button" class="btn btn-secondary btn-xs" id="assetExportFooterBtn" title="把当前查询与筛选条件匹配的全部数据导出为 Excel (CSV) 表格（非仅当前页）">📊 导出全部查询结果 (Excel)</button>
            </div>
            <div class="asset-page-controls">
              <label style="font-size:12px;color:#64748b;margin-right:6px;">每页：</label>
              <select id="assetPageSizeSelect" style="width:70px;padding:3px 6px;margin-right:12px;">
                <option value="20">20</option>
                <option value="50" selected>50</option>
                <option value="100">100</option>
              </select>
              <button type="button" class="btn btn-secondary btn-sm" id="assetPrevPageBtn" disabled>上一页</button>
              <span id="assetCurrentPageDisplay" style="font-size:12px;font-weight:600;padding:0 8px;">1 / 1</span>
              <button type="button" class="btn btn-secondary btn-sm" id="assetNextPageBtn" disabled>下一页</button>
            </div>
          </div>
        </div>

      </div>

      <!-- 批量导入 Modal -->
      <div class="asset-modal-overlay" id="assetImportModal" style="display:none;">
        <div class="asset-modal-dialog">
          <div class="asset-modal-header">
            <div class="asset-modal-title">📥 批量导入外链资源</div>
            <button type="button" class="asset-modal-close" id="assetCloseImportModalBtn">×</button>
          </div>
          <div class="asset-modal-body">
            <div class="asset-import-tabs">
              <button type="button" class="import-tab-btn active" data-import-tab="csv">📂 上传 CSV 文件 (Semrush/Ahrefs)</button>
              <button type="button" class="import-tab-btn" data-import-tab="paste">📋 纯文本直接粘贴 URL</button>
            </div>

            <div class="import-tab-pane active" id="importTabCsv">
              <div class="upload-zone" id="assetImportUploadZone" style="padding:24px;border:2px dashed #cbd5e1;border-radius:8px;text-align:center;cursor:pointer;background:#f8fafc;">
                <div style="font-size:32px;margin-bottom:6px;">📄</div>
                <div style="font-size:13px;font-weight:600;color:#334155;">拖拽 CSV 文件至此处，或点击选择</div>
                <div class="hint">支持 Semrush Backlinks、Ahrefs 或自定义外链 CSV，自动识别引荐 URL 与域名</div>
                <input type="file" id="assetCsvFileInput" accept=".csv,text/csv" style="display:none;" />
              </div>
              <div id="assetImportFileInfo" style="display:none;margin-top:10px;font-size:12px;color:#059669;background:#ecfdf5;padding:8px 12px;border-radius:6px;"></div>
            </div>

            <div class="import-tab-pane" id="importTabPaste" style="display:none;">
              <textarea id="assetImportTextarea" rows="6" placeholder="一行一个引荐 URL 或域名，例如：&#10;https://techblog.com/post-101&#10;https://aimagazine.io/submit-link&#10;newdomain.org" style="font-size:12px;"></textarea>
              <div class="hint">支持一行一条；系统将自动补齐协议并精确解析提取根域名。</div>
            </div>

            <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">默认外链类型：</label>
                <select id="assetImportDefaultType">
                  ${Object.values(RESOURCE_TYPES).map((t) => `<option value="${t.id}">${t.icon} ${t.label}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">来源渠道标记：</label>
                <select id="assetImportSourceChannel">
                  <option value="semrush">Semrush 导出</option>
                  <option value="ahrefs">Ahrefs 导出</option>
                  <option value="manual_paste">手动收集/粘贴</option>
                  <option value="other_csv">通用 CSV 导入</option>
                </select>
              </div>
            </div>

            <!-- 博客评论智能侦测配置区 -->
            <div id="assetImportProbeConfigBox" style="margin-top:12px;padding:10px 12px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;font-size:12px;">
              <div style="display:flex;align-items:flex-start;gap:8px;">
                <input type="checkbox" id="assetImportEnableProbe" checked style="margin-top:2px;cursor:pointer;" />
                <div style="flex:1;">
                  <label for="assetImportEnableProbe" style="font-weight:700;color:#1e1b4b;cursor:pointer;display:flex;align-items:center;gap:6px;">
                    <span>启用博客表单智能侦测（推荐）</span>
                    <span style="background:#4338ca;color:#fff;font-size:10px;font-weight:600;padding:1px 6px;border-radius:10px;">高质量防污染</span>
                  </label>
                  <div style="color:#4338ca;margin-top:3px;font-size:11px;line-height:1.5;">
                    自动高并发深度侦探页面源码表单，<strong>仅将真实开放评论的博客页面入库</strong>；自动过滤拦截非博客（新闻/电商/404）、评论已关闭、需登录页面。
                  </div>
                  <div id="assetImportProbeSettings" style="display:flex;align-items:center;gap:12px;margin-top:6px;font-size:11px;">
                    <label style="color:#334155;font-weight:600;display:flex;align-items:center;gap:4px;">
                      并发线程：
                      <select id="assetImportProbeConcurrency" style="padding:2px 6px;font-size:11px;border:1px solid #cbd5e1;border-radius:4px;">
                        <option value="10">10 并发</option>
                        <option value="20" selected>20 并发 (推荐)</option>
                        <option value="30">30 并发</option>
                        <option value="50">50 并发 (极速)</option>
                      </select>
                    </label>
                    <span style="color:#64748b;">单页超时：8秒</span>
                  </div>
                </div>
              </div>
            </div>

            <div style="margin-top:12px;padding:10px 12px;background:#f1f5f9;border-radius:8px;font-size:12px;">
              <div style="font-weight:600;color:#334155;margin-bottom:6px;">查重与过滤策略：</div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="radio" name="assetDedupeStrategy" value="skip" checked />
                  <span><strong>跳过重复域名（推荐）</strong>：已存在域名保留其历史执行统计与标签，不重复新增</span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="radio" name="assetDedupeStrategy" value="update_url" />
                  <span><strong>覆盖更新入口 URL</strong>：已存在域名保留历史统计；若导入了新 URL 则更新为新 URL 并将页面深度自动置为空（待任务重新探测）</span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:4px;">
                  <input type="checkbox" id="assetImportFilterIllegal" checked />
                  <span>自动拦截博彩、色情等违规站点黑名单（基于本地词库）</span>
                </label>
              </div>
            </div>

            <!-- 实时并发侦测进度条与动态看板 -->
            <div id="assetImportProgressSection" style="display:none;margin-top:14px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px;">
                <span style="font-weight:600;color:#1e293b;display:flex;align-items:center;gap:6px;">
                  <span class="probe-pulse">⚡</span>
                  <span id="assetImportProgressTitle">正在高并发侦测博客表单...</span>
                </span>
                <span style="font-weight:700;color:#2563eb;" id="assetImportProgressPercent">0% (0 / 0)</span>
              </div>
              <div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin-bottom:10px;">
                <div id="assetImportProgressBar" style="height:100%;width:0%;background:#2563eb;transition:width 0.2s;"></div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;font-size:11px;text-align:center;">
                <div style="background:#ecfdf5;color:#065f46;padding:5px 6px;border-radius:6px;border:1px solid #a7f3d0;">
                  <div style="font-size:10px;color:#047857;">开放博客</div>
                  <strong id="liveValidCount" style="font-size:14px;font-weight:800;">0</strong>
                </div>
                <div style="background:#eff6ff;color:#1e40af;padding:5px 6px;border-radius:6px;border:1px solid #bfdbfe;">
                  <div style="font-size:10px;color:#1d4ed8;">库内已有跳过</div>
                  <strong id="liveSkipCount" style="font-size:14px;font-weight:800;">0</strong>
                </div>
                <div style="background:#fffbeb;color:#92400e;padding:5px 6px;border-radius:6px;border:1px solid #fde68a;">
                  <div style="font-size:10px;color:#b45309;">评论关闭/需登录</div>
                  <strong id="liveClosedCount" style="font-size:14px;font-weight:800;">0</strong>
                </div>
                <div style="background:#fef2f2;color:#991b1b;padding:5px 6px;border-radius:6px;border:1px solid #fecaca;">
                  <div style="font-size:10px;color:#b91c1c;">非博客/失效拦截</div>
                  <strong id="liveInvalidCount" style="font-size:14px;font-weight:800;">0</strong>
                </div>
              </div>
              <div style="margin-top:8px;text-align:right;">
                <button type="button" class="btn btn-secondary btn-sm" id="assetImportAbortBtn" style="color:#b91c1c;border-color:#fecaca;padding:2px 8px;font-size:11px;">⏹ 中止侦测</button>
              </div>
            </div>

            <!-- 导入反馈报表区 -->
            <div id="assetImportReportSection" style="display:none;margin-top:14px;border-top:1px solid #e2e8f0;padding-top:12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div style="font-weight:700;font-size:13px;color:#1e293b;">📊 导入处理结果统计：</div>
                <button type="button" class="btn btn-secondary btn-sm" id="assetExportSkippedCsvBtn" style="display:none;font-size:11px;padding:3px 8px;">
                  📊 导出未入库/过滤明细 (Excel)
                </button>
              </div>
              <div class="asset-import-stat-banner" id="assetImportStatBanner">
                <div class="stat-pill"><span class="pill-num" id="reportTotalRead">0</span> 总读取</div>
                <div class="stat-pill pill-success"><span class="pill-num" id="reportInserted">0</span> 成功新增入库</div>
                <div class="stat-pill pill-info"><span class="pill-num" id="reportAlreadyInLibrary">0</span> 资产库已存跳过</div>
                <div class="stat-pill pill-warning"><span class="pill-num" id="reportClosedOrLogin">0</span> 评论关闭/需登录</div>
                <div class="stat-pill pill-danger"><span class="pill-num" id="reportNonBlogOrFailed">0</span> 非博客/失效拦截</div>
              </div>
              <div id="assetImportSummaryAlert" style="margin-top:8px;font-size:12px;color:#1e293b;background:#f8fafc;border:1px solid #e2e8f0;padding:8px 12px;border-radius:6px;line-height:1.5;"></div>
              <div id="assetImportReportDetail" style="margin-top:8px;max-height:110px;overflow-y:auto;font-size:11px;color:#475569;background:#f8fafc;padding:8px;border-radius:6px;"></div>
            </div>
          </div>
          <div class="asset-modal-footer">
            <button type="button" class="btn btn-secondary" id="assetCancelImportBtn">取消</button>
            <button type="button" class="btn btn-primary" id="assetExecuteImportBtn">🚀 开始智能侦测并导入</button>
            <button type="button" class="btn btn-primary" id="assetGoToTaskAfterImportBtn" style="display:none;">🚀 立即为新增外链执行批量任务</button>
          </div>
        </div>
      </div>

      <!-- 单条资产编辑 Modal -->
      <div class="asset-modal-overlay" id="assetEditModal" style="display:none;">
        <div class="asset-modal-dialog" style="max-width:540px;">
          <div class="asset-modal-header">
            <div class="asset-modal-title">✏️ 编辑外链资产</div>
            <button type="button" class="asset-modal-close" id="assetCloseEditModalBtn">×</button>
          </div>
          <div class="asset-modal-body">
            <div id="assetEditDepthAlert" style="display:none;margin-bottom:12px;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.5;"></div>

            <div style="margin-bottom:10px;">
              <label style="font-size:12px;font-weight:600;">引荐域名（主键）：</label>
              <input type="text" id="assetEditDomain" readonly style="background:#f1f5f9;color:#64748b;" />
            </div>
            <div style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <label style="font-size:12px;font-weight:600;">入口 / 提交引荐 URL：</label>
                <a id="assetEditFindShallowLink" href="#" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:#2563eb;text-decoration:underline;display:none;">🔍 谷歌搜该站新页面 (找浅页)</a>
              </div>
              <input type="url" id="assetEditUrl" placeholder="https://..." />
              <div id="assetEditUrlHint" style="display:none;font-size:11px;color:#059669;margin-top:4px;">
                💡 检测到入口 URL 已变更，页面深度已自动重置为空（未知），待下次自动化任务重新探测实际深度。
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
              <div>
                <label style="font-size:12px;font-weight:600;">外链形态类型：</label>
                <select id="assetEditType">
                  ${Object.values(RESOURCE_TYPES).map((t) => `<option value="${t.id}">${t.icon} ${t.label}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size:12px;font-weight:600;">质量评级：</label>
                <select id="assetEditQuality">
                  ${Object.values(QUALITY_TIERS).map((q) => `<option value="${q.id}">${q.icon} ${q.label}</option>`).join('')}
                </select>
              </div>
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <label style="font-size:12px;font-weight:600;">页面深度：</label>
                  <button type="button" id="assetEditResetDepthBtn" style="border:none;background:none;color:#64748b;font-size:11px;cursor:pointer;padding:0;text-decoration:underline;" title="修改URL后清空，待下次任务自动重新探测">清空</button>
                </div>
                <div style="display:flex;align-items:center;gap:4px;">
                  <input type="number" step="0.1" id="assetEditPageDepth" placeholder="未测" style="width:100%;" />
                  <span style="font-size:11px;color:#64748b;white-space:nowrap;">屏</span>
                </div>
              </div>
            </div>
            <div style="margin-bottom:10px;">
              <label style="font-size:12px;font-weight:600;">标签（逗号分隔）：</label>
              <input type="text" id="assetEditTags" placeholder="例如：tech, ai, dofollow, high-dr" />
            </div>
            <div style="margin-bottom:10px;">
              <label style="font-size:12px;font-weight:600;">备注说明：</label>
              <textarea id="assetEditNotes" rows="3" placeholder="例如：评论需审核但通过率高，支持锚文本"></textarea>
            </div>
          </div>
          <div class="asset-modal-footer">
            <button type="button" class="btn btn-secondary" id="assetCancelEditBtn">取消</button>
            <button type="button" class="btn btn-primary" id="assetSaveEditBtn">保存修改</button>
          </div>
        </div>
      </div>

      <!-- 批量投产到任务确认 Modal -->
      <div class="asset-modal-overlay" id="assetSendToTaskModal" style="display:none;">
        <div class="asset-modal-dialog" style="max-width:540px;">
          <div class="asset-modal-header">
            <div class="asset-modal-title">🚀 批量添加到任务执行列表</div>
            <button type="button" class="asset-modal-close" id="assetCloseSendToTaskModalBtn">×</button>
          </div>
          <div class="asset-modal-body">
            <div style="font-size:13px;color:#334155;margin-bottom:12px;">
              即将把选中的 <strong id="sendToTaskCountDisplay" style="color:#2563eb;font-size:15px;">0</strong> 个外链的入口 URL 注入到批量任务执行队列中。
            </div>
            <div style="margin-bottom:12px;">
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px;">请确认本批次推广的目标网站（可在任务中进一步调整）：</label>
              <select id="sendToTaskSiteSelect" style="width:100%;">
                <option value="">-- 请选择目标网站 --</option>
              </select>
            </div>
            <div style="padding:10px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:12px;color:#1e40af;">
              💡 <strong>提示</strong>：注入成功后将自动切换至「博客自动外链」视图并渲染待处理列表，您可以直接点击「▶ 开始批量处理」进行全自动发布或探测！
            </div>
          </div>
          <div class="asset-modal-footer">
            <button type="button" class="btn btn-secondary" id="assetCancelSendToTaskBtn">取消</button>
            <button type="button" class="btn btn-primary" id="assetConfirmSendToTaskBtn">注入队列并前往执行</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 绑定界面所有交互事件。
   */
  function bindEvents() {
    // 顶部与导出按钮
    document.getElementById('assetRefreshBtn')?.addEventListener('click', () => refreshAll());
    document.getElementById('assetBootstrapBtn')?.addEventListener('click', handleBootstrap);
    document.getElementById('assetExportBtn')?.addEventListener('click', exportCurrentAssetsExcel);
    document.getElementById('assetExportFooterBtn')?.addEventListener('click', exportCurrentAssetsExcel);
    document.getElementById('assetOpenImportModalBtn')?.addEventListener('click', openImportModal);
    document.getElementById('assetCloseImportModalBtn')?.addEventListener('click', closeImportModal);
    document.getElementById('assetCancelImportBtn')?.addEventListener('click', closeImportModal);

    // 筛选条件变化
    ['assetFilterType', 'assetFilterQuality', 'assetFilterSuccessRate', 'assetFilterPageDepth', 'assetFilterTimeRange', 'assetFilterSourceChannel', 'assetFilterTargetStatus', 'assetSortBy'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        state.page = 1;
        fetchAssets();
      });
    });

    document.getElementById('assetFilterTargetDomain')?.addEventListener('change', (e) => {
      state.filters.targetSiteDomain = e.target.value;
      state.page = 1;
      fetchAssets();
    });

    // 搜索框防抖
    let searchTimeout = null;
    document.getElementById('assetFilterKeyword')?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.filters.keyword = e.target.value.trim();
        state.page = 1;
        fetchAssets();
      }, 300);
    });

    // 分页
    document.getElementById('assetPrevPageBtn')?.addEventListener('click', () => {
      if (state.page > 1) {
        state.page--;
        fetchAssets();
      }
    });
    document.getElementById('assetNextPageBtn')?.addEventListener('click', () => {
      if (state.page < state.totalPages) {
        state.page++;
        fetchAssets();
      }
    });
    document.getElementById('assetPageSizeSelect')?.addEventListener('change', (e) => {
      state.pageSize = Number(e.target.value) || 50;
      state.page = 1;
      fetchAssets();
    });

    // 表头全选
    document.getElementById('assetSelectAllCheckbox')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      state.assets.forEach((item) => {
        if (checked) state.selectedDomains.add(item.referral_domain);
        else state.selectedDomains.delete(item.referral_domain);
      });
      updateSelectionBar();
      renderAssetTableRows();
    });

    // 批量操作条按钮
    document.getElementById('assetClearSelectionBtn')?.addEventListener('click', () => {
      state.selectedDomains.clear();
      updateSelectionBar();
      renderAssetTableRows();
    });

    document.getElementById('assetBatchDeleteBtn')?.addEventListener('click', handleBatchDelete);
    document.getElementById('assetBatchChangeTypeBtn')?.addEventListener('click', handleBatchChangeType);
    document.getElementById('assetBatchSendToTaskBtn')?.addEventListener('click', openSendToTaskModal);

    // 发送到任务弹窗
    document.getElementById('assetCloseSendToTaskModalBtn')?.addEventListener('click', closeSendToTaskModal);
    document.getElementById('assetCancelSendToTaskBtn')?.addEventListener('click', closeSendToTaskModal);
    document.getElementById('assetConfirmSendToTaskBtn')?.addEventListener('click', executeSendToTask);

    // 概览卡片快捷过滤
    document.querySelectorAll('.asset-stat-card[data-tier-filter]').forEach((card) => {
      card.addEventListener('click', () => {
        const tier = card.dataset.tierFilter;
        const select = document.getElementById('assetFilterQuality');
        if (select) {
          select.value = tier;
          state.page = 1;
          fetchAssets();
        }
      });
    });

    // 导入 Modal 内的 Tab 切换
    document.querySelectorAll('.import-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.import-tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.importTab;
        document.getElementById('importTabCsv').style.display = tab === 'csv' ? 'block' : 'none';
        document.getElementById('importTabPaste').style.display = tab === 'paste' ? 'block' : 'none';
      });
    });

    // 导入文件上传点击与拖拽
    const uploadZone = document.getElementById('assetImportUploadZone');
    const fileInput = document.getElementById('assetCsvFileInput');
    if (uploadZone && fileInput) {
      uploadZone.addEventListener('click', () => fileInput.click());
      uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = '#2563eb';
      });
      uploadZone.addEventListener('dragleave', () => {
        uploadZone.style.borderColor = '#cbd5e1';
      });
      uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.style.borderColor = '#cbd5e1';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          fileInput.files = e.dataTransfer.files;
          handleCsvFileSelected(fileInput.files[0]);
        }
      });
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          handleCsvFileSelected(e.target.files[0]);
        }
      });
    }

    // 执行导入
    document.getElementById('assetExecuteImportBtn')?.addEventListener('click', executeImport);

    // 导入 Modal：类型与智能侦测联动及操作
    document.getElementById('assetImportDefaultType')?.addEventListener('change', updateImportProbeUiState);
    document.getElementById('assetImportEnableProbe')?.addEventListener('change', updateImportProbeUiState);
    document.getElementById('assetImportAbortBtn')?.addEventListener('click', abortProbeImport);
    document.getElementById('assetExportSkippedCsvBtn')?.addEventListener('click', exportSkippedOrFilteredCsv);

    // 编辑 Modal
    document.getElementById('assetCloseEditModalBtn')?.addEventListener('click', closeEditModal);
    document.getElementById('assetCancelEditBtn')?.addEventListener('click', closeEditModal);
    document.getElementById('assetSaveEditBtn')?.addEventListener('click', saveEditModal);
    document.getElementById('assetEditResetDepthBtn')?.addEventListener('click', () => {
      const depthInput = document.getElementById('assetEditPageDepth');
      if (depthInput) depthInput.value = '';
    });
    document.getElementById('assetEditUrl')?.addEventListener('input', (e) => {
      const currentUrl = state.currentEditingAsset?.referral_url || '';
      const newUrl = e.target.value.trim();
      const hint = document.getElementById('assetEditUrlHint');
      const depthInput = document.getElementById('assetEditPageDepth');
      const isChanged = newUrl !== '' && newUrl !== currentUrl;
      if (hint) hint.style.display = isChanged ? 'block' : 'none';
      if (isChanged && depthInput) {
        depthInput.value = '';
      } else if (!isChanged && depthInput && state.currentEditingAsset) {
        depthInput.value = state.currentEditingAsset.page_depth != null ? state.currentEditingAsset.page_depth : '';
      }
    });
  }

  let selectedImportFile = null;
  let lastImportResultData = null;
  let currentImportProbeSessionId = null;
  let importProbePollTimer = null;
  let currentSkippedItemsToExport = [];

  function handleCsvFileSelected(file) {
    selectedImportFile = file;
    const fileInfo = document.getElementById('assetImportFileInfo');
    if (fileInfo) {
      fileInfo.style.display = 'block';
      fileInfo.textContent = `已选择文件：${file.name} (${Math.round(file.size / 1024)} KB)`;
    }
  }

  /**
   * 加载配置中的目标站点列表，用于目标站隔离筛选下拉框。
   */
  async function loadPromotionSitesForAssetFilter() {
    try {
      chrome.storage.local.get(['auto_comment_sites_config'], (data) => {
        const config = data.auto_comment_sites_config;
        const sites = (config && Array.isArray(config.sites)) ? config.sites : [];
        state.availablePromotionSites = sites;

        const filterSelect = document.getElementById('assetFilterTargetDomain');
        const modalSelect = document.getElementById('sendToTaskSiteSelect');

        if (filterSelect) {
          filterSelect.innerHTML = '<option value="">-- 选择目标站点 (隔离矩阵) --</option>';
          sites.forEach((site) => {
            const domain = normalizeDomain(site.url);
            const opt = document.createElement('option');
            opt.value = domain;
            opt.textContent = `${site.name || domain} (${domain})`;
            filterSelect.appendChild(opt);
          });
        }

        if (modalSelect) {
          modalSelect.innerHTML = '<option value="">-- 请选择目标站点 --</option>';
          sites.forEach((site) => {
            const opt = document.createElement('option');
            opt.value = site.id;
            opt.textContent = `${site.name} (${site.url})`;
            modalSelect.appendChild(opt);
          });
        }
      });
    } catch (_) {}
  }

  /**
   * 刷新指标概览与表格列表。
   */
  async function refreshAll() {
    await Promise.all([fetchSummary(), fetchAssets()]);
  }

  /**
   * 获取总体指标。
   */
  async function fetchSummary() {
    try {
      const summary = await apiRequest('/api/assets/summary');
      state.summary = summary;
      renderSummaryCards(summary);
    } catch (error) {
      console.warn('获取资产库指标失败：', error.message);
    }
  }

  function renderSummaryCards(summary) {
    if (!summary) return;
    document.getElementById('assetTotalHeaderBadge').textContent = `${summary.total || 0} 个`;
    document.getElementById('statAssetTotal').textContent = summary.total || 0;
    document.getElementById('statAssetHigh').textContent = summary.highQualityCount || 0;
    document.getElementById('statAssetManual').textContent = summary.manualNeededCount || 0;
    document.getElementById('statAssetBroken').textContent = summary.brokenCount || 0;
    document.getElementById('statAssetUntested').textContent = summary.untestedCount || 0;
    const avgRateEl = document.getElementById('statAssetAvgRate');
    if (avgRateEl) {
      avgRateEl.textContent = `${summary.avgSuccessRate || 0}%`;
      const foot = avgRateEl.parentElement?.querySelector('.stat-foot');
      if (foot && summary.avgPageDepth !== undefined) {
        foot.textContent = `均深 ${summary.avgPageDepth} 屏 | 浅页 ${summary.shallowCount || 0}`;
      }
    }

    const typeSummary = Object.entries(summary.byType || {})
      .map(([k, v]) => `${(RESOURCE_TYPES[k] && RESOURCE_TYPES[k].label) || k}: ${v}`)
      .join(' | ');
    document.getElementById('statAssetTypesFoot').textContent = typeSummary || '暂无分类';
  }

  /**
   * 收集当前界面激活的多维筛选与排序参数。
   */
  function getCurrentFilterParams() {
    const sortVal = (document.getElementById('assetSortBy')?.value || 'success_rate-desc').split('-');
    const sortBy = sortVal[0];
    const sortOrder = sortVal[1] || 'desc';

    const rateVal = document.getElementById('assetFilterSuccessRate')?.value;
    let minRate = null;
    let maxRate = null;
    if (rateVal === '80') minRate = 80;
    else if (rateVal === '60') minRate = 60;
    else if (rateVal === '40') minRate = 40;
    else if (rateVal === '0') { minRate = 0; maxRate = 0; }

    const pageDepth = document.getElementById('assetFilterPageDepth')?.value || 'all';

    const params = {
      resourceType: document.getElementById('assetFilterType')?.value || 'all',
      qualityTier: document.getElementById('assetFilterQuality')?.value || 'all',
      targetDomain: document.getElementById('assetFilterTargetDomain')?.value || '',
      targetSiteStatus: document.getElementById('assetFilterTargetStatus')?.value || 'all',
      keyword: document.getElementById('assetFilterKeyword')?.value?.trim() || '',
      sortBy,
      sortOrder
    };

    if (minRate !== null) params.minSuccessRate = minRate;
    if (maxRate !== null) params.maxSuccessRate = maxRate;
    if (pageDepth && pageDepth !== 'all') params.pageDepthRange = pageDepth;

    const timeRange = document.getElementById('assetFilterTimeRange')?.value || 'all';
    if (timeRange && timeRange !== 'all') params.timeRange = timeRange;

    const sourceChannel = document.getElementById('assetFilterSourceChannel')?.value || 'all';
    if (sourceChannel && sourceChannel !== 'all') params.sourceChannel = sourceChannel;

    return params;
  }

  /**
   * 查询外链资产列表。
   */
  async function fetchAssets() {
    const tbody = document.getElementById('assetTableBody');
    if (!tbody) return;

    state.isLoading = true;
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:#94a3b8;">正在加载资产数据...</td></tr>';

    const filterParams = getCurrentFilterParams();
    const queryParams = new URLSearchParams({
      page: state.page,
      pageSize: state.pageSize,
      ...filterParams
    });

    try {
      const data = await apiRequest(`/api/assets?${queryParams.toString()}`);
      state.assets = data.items || [];
      state.total = data.total || 0;
      state.totalPages = data.totalPages || 1;
      state.page = data.page || 1;

      renderAssetTableRows();
      renderPaginationControls();
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:30px;color:#dc2626;">加载失败：${escapeHtml(error.message)}</td></tr>`;
    } finally {
      state.isLoading = false;
    }
  }

  function formatDateTime(val) {
    if (!val) return '-';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      const Y = d.getFullYear();
      const M = String(d.getMonth() + 1).padStart(2, '0');
      const D = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    } catch (_) {
      return String(val);
    }
  }

  /**
   * 导出当前筛选与搜索条件下的全部外链资产（不限当前分页）为 Excel 兼容 CSV。
   */
  async function exportCurrentAssetsExcel() {
    const topBtn = document.getElementById('assetExportBtn');
    const footerBtn = document.getElementById('assetExportFooterBtn');
    const origTopText = topBtn ? topBtn.innerHTML : '';
    const origFooterText = footerBtn ? footerBtn.innerHTML : '';

    if (topBtn) {
      topBtn.disabled = true;
      topBtn.textContent = '⏳ 正在导出...';
    }
    if (footerBtn) {
      footerBtn.disabled = true;
      footerBtn.textContent = '⏳ 正在导出...';
    }

    try {
      const filterParams = getCurrentFilterParams();
      const queryParams = new URLSearchParams({
        exportAll: 'true',
        ...filterParams
      });

      const data = await apiRequest(`/api/assets/export?${queryParams.toString()}`);
      const items = Array.isArray(data && data.items) ? data.items : [];
      if (items.length === 0) {
        alert('当前查询与筛选条件下没有匹配的外链资产可供导出');
        return;
      }

      const headers = [
        '引荐域名',
        '入口引荐URL',
        '外链类型',
        '质量评级',
        '成功率(%)',
        '成功次数',
        '跳过次数',
        '失败次数',
        '总执行次数',
        '页面深度(屏数)',
        '来源渠道',
        '标签',
        'DR评分',
        '月自然流量',
        '最近执行时间',
        '最近执行状态',
        '目标站投放覆盖',
        '备注',
        '添加建库时间'
      ];

      const rows = items.map((a) => {
        const typeInfo = RESOURCE_TYPES[a.resource_type] || { label: a.resource_type || '博客评论' };
        const qualityInfo = QUALITY_TIERS[a.quality_tier] || { label: a.quality_tier || '未测试' };
        const rateNum = Number(a.success_rate || 0);

        let sourceChannelLabel = '手动/表格导入';
        if (a.source_channel === 'probe_discovery') sourceChannelLabel = '博客探测入库';
        else if (a.source_channel === 'run_harvest') sourceChannelLabel = '任务自动沉淀';
        else if (a.source_channel === 'batch_import') sourceChannelLabel = '表格/手动导入';

        const depthText = (a.page_depth !== null && a.page_depth !== undefined && a.page_depth !== '')
          ? Number(a.page_depth).toFixed(1)
          : '未知';

        const coverageList = Array.isArray(a.target_coverage) ? a.target_coverage : [];
        const coverageText = coverageList.length > 0
          ? coverageList.map((c) => `${c.target_domain}(成功${c.success_count}次)`).join('; ')
          : '未关联';

        const tagsText = Array.isArray(a.tags) ? a.tags.join(', ') : (a.tags || '');

        let lastResultText = '无记录';
        if (a.last_run_result === 'success') lastResultText = '成功';
        else if (a.last_run_result === 'skipped') lastResultText = '跳过';
        else if (a.last_run_result === 'failed') lastResultText = '失败';
        else if (a.last_run_result) lastResultText = String(a.last_run_result);

        return [
          a.referral_domain || '',
          a.referral_url || '',
          typeInfo.label,
          qualityInfo.label,
          rateNum,
          a.success_count || 0,
          a.skipped_count || 0,
          a.fail_count || 0,
          a.total_attempts || 0,
          depthText,
          sourceChannelLabel,
          tagsText,
          a.domain_rating !== null && a.domain_rating !== undefined ? a.domain_rating : '',
          a.organic_traffic !== null && a.organic_traffic !== undefined ? a.organic_traffic : '',
          formatDateTime(a.last_executed_at),
          lastResultText,
          coverageText,
          a.notes || '',
          formatDateTime(a.created_at)
        ];
      });

      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

      if (window.XLSX && window.XLSX.utils) {
        const aoa = [headers, ...rows];
        const ws = window.XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [
          { wch: 22 }, // 引荐域名
          { wch: 50 }, // 入口URL
          { wch: 14 }, // 外链类型
          { wch: 14 }, // 质量评级
          { wch: 12 }, // 成功率(%)
          { wch: 10 }, // 成功次数
          { wch: 10 }, // 跳过次数
          { wch: 10 }, // 失败次数
          { wch: 12 }, // 总执行次数
          { wch: 14 }, // 页面深度
          { wch: 16 }, // 来源渠道
          { wch: 22 }, // 标签
          { wch: 10 }, // DR评分
          { wch: 14 }, // 月自然流量
          { wch: 20 }, // 最近执行时间
          { wch: 14 }, // 最近执行状态
          { wch: 30 }, // 目标站覆盖
          { wch: 30 }, // 备注
          { wch: 20 }  // 创建时间
        ];
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, '外链资产明细');
        window.XLSX.writeFile(wb, `外链资产库导出_${dateStr}_共${items.length}条.xlsx`);
      } else {
        const csvRows = rows.map((r) =>
          r.map((val) => `"${String(val ?? '').replace(/"/g, '""')}"`).join(',')
        );
        const csvContent = '\uFEFF' + [headers.map((h) => `"${h}"`).join(','), ...csvRows].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `外链资产库导出_${dateStr}_共${items.length}条.csv`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      alert(`导出失败：${err.message}`);
    } finally {
      if (topBtn) {
        topBtn.disabled = false;
        topBtn.innerHTML = origTopText;
      }
      if (footerBtn) {
        footerBtn.disabled = false;
        footerBtn.innerHTML = origFooterText;
      }
    }
  }

  /**
   * 渲染表格行内容。
   */
  function renderAssetTableRows() {
    const tbody = document.getElementById('assetTableBody');
    if (!tbody) return;

    if (state.assets.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align:center;padding:50px 20px;">
            <div style="font-size:36px;margin-bottom:10px;">🔍</div>
            <div style="font-size:14px;font-weight:600;color:#475569;">暂无符合条件的外链资产</div>
            <div class="hint" style="margin-bottom:16px;">您可以调整筛选条件、批量导入新外链，或从历史任务一键回填建库。</div>
            <button type="button" class="btn btn-secondary btn-sm" id="emptyBootstrapBtn" style="margin-right:8px;">🔄 从历史任务建库</button>
            <button type="button" class="btn btn-primary btn-sm" id="emptyImportBtn">📥 批量导入外链</button>
          </td>
        </tr>
      `;
      tbody.querySelector('#emptyBootstrapBtn')?.addEventListener('click', handleBootstrap);
      tbody.querySelector('#emptyImportBtn')?.addEventListener('click', openImportModal);
      return;
    }

    tbody.innerHTML = '';
    state.assets.forEach((asset) => {
      const tr = document.createElement('tr');
      const isSelected = state.selectedDomains.has(asset.referral_domain);
      if (isSelected) tr.classList.add('selected-row');

      const typeInfo = RESOURCE_TYPES[asset.resource_type] || RESOURCE_TYPES.other;
      const qualityInfo = QUALITY_TIERS[asset.quality_tier] || QUALITY_TIERS.untested;
      const rateNum = Number(asset.success_rate || 0);

      // 页面深度屏数与警示
      const rawDepth = asset.page_depth;
      const hasDepth = rawDepth !== null && rawDepth !== undefined && rawDepth !== '';
      const depthNum = hasDepth ? Number(rawDepth) : null;

      let depthHtml = '';
      if (!hasDepth || isNaN(depthNum)) {
        depthHtml = '<span class="depth-badge depth-unknown" title="尚未探测该网页屏数">⚪ 未知</span>';
      } else if (depthNum <= 20) {
        depthHtml = `<span class="depth-badge depth-shallow" title="页面较浅（≤20屏），评论竞争小，建议优先发布">🟢 ${depthNum.toFixed(1)} 屏</span>`;
      } else if (depthNum <= 50) {
        depthHtml = `<span class="depth-badge depth-medium" title="页面深度中等（20~50屏）">🟡 ${depthNum.toFixed(1)} 屏</span>`;
      } else if (depthNum <= 100) {
        depthHtml = `<span class="depth-badge depth-deep" title="页面较深（50~100屏），已有较多评论">🟠 ${depthNum.toFixed(1)} 屏</span>`;
      } else {
        depthHtml = `
          <div class="depth-cell-alert">
            <span class="depth-badge depth-very-deep" title="页面极深（${depthNum.toFixed(1)}屏）！历史评论极度膨胀，新留言极易沉底。强烈建议换浅页！">⚠️ ${depthNum.toFixed(1)} 屏</span>
            <button type="button" class="btn-replace-shallow" data-domain="${escapeHtml(asset.referral_domain)}" title="寻找该站评论较少的新文章并替换入口URL">🔄 换浅页</button>
          </div>
        `;
      }

      // 覆盖标签
      const coverage = Array.isArray(asset.target_coverage) ? asset.target_coverage : [];
      const coverageTagsHtml = coverage.length > 0
        ? coverage.map((c) => `<span class="target-badge" title="已在此目标站成功 ${c.success_count} 次">${escapeHtml(c.target_domain)}</span>`).join('')
        : '<span style="color:#94a3b8;font-size:11px;">未关联</span>';

      tr.innerHTML = `
        <td style="text-align:center;">
          <input type="checkbox" class="asset-row-checkbox" data-domain="${escapeHtml(asset.referral_domain)}" ${isSelected ? 'checked' : ''} />
        </td>
        <td>
          <div class="domain-cell">
            <span class="domain-text" title="${escapeHtml(asset.referral_domain)}">${escapeHtml(asset.referral_domain)}</span>
            <button type="button" class="btn-icon-copy" data-copy="${escapeHtml(asset.referral_domain)}" title="复制域名">📋</button>
          </div>
        </td>
        <td>
          <span class="type-badge ${typeInfo.badgeClass}" style="background:${typeInfo.bg};color:${typeInfo.color};border:1px solid ${typeInfo.border};">
            ${typeInfo.icon} ${typeInfo.label}
          </span>
        </td>
        <td>
          <div class="url-cell">
            <a href="${escapeHtml(asset.referral_url)}" target="_blank" rel="noopener noreferrer" class="url-link" title="${escapeHtml(asset.referral_url)}">
              ${escapeHtml(asset.referral_url)}
            </a>
            <a href="${escapeHtml(asset.referral_url)}" target="_blank" rel="noopener noreferrer" class="btn-icon-link" title="新标签页打开">↗</a>
          </div>
        </td>
        <td>
          <div class="depth-cell">${depthHtml}</div>
        </td>
        <td>
          <div class="perf-cell" title="执行详情：成功 ${asset.success_count || 0} 次${asset.skipped_count > 0 ? `，跳过 ${asset.skipped_count} 次` : ''}${asset.fail_count > 0 ? `，失败 ${asset.fail_count} 次` : ''}（共 ${asset.total_attempts || 0} 次）">
            <div class="perf-bar-wrap">
              <div class="perf-bar" style="width:${Math.min(100, Math.max(0, rateNum))}%;background:${rateNum >= 60 ? '#10b981' : (rateNum >= 30 ? '#f59e0b' : '#ef4444')};"></div>
            </div>
            <div class="perf-text">
              <strong style="color:${rateNum >= 60 ? '#059669' : (rateNum >= 30 ? '#d97706' : '#dc2626')}">${rateNum.toFixed(1)}%</strong>
              <span style="color:#94a3b8;margin-left:4px;">(${asset.success_count || 0}/${asset.total_attempts || 0}次${asset.skipped_count > 0 ? ` <span title="其中 ${asset.skipped_count} 次因防重复已评论而跳过" style="color:#64748b;font-size:10px;">[${asset.skipped_count}跳过]</span>` : ''})</span>
            </div>
          </div>
        </td>
        <td>
          <span class="tier-badge ${qualityInfo.badgeClass}" style="background:${qualityInfo.bg};color:${qualityInfo.color};">
            ${qualityInfo.icon} ${qualityInfo.label}
          </span>
        </td>
        <td>
          <div style="font-size:11px;color:#334155;">${formatRelativeTime(asset.last_executed_at)}</div>
          <div style="font-size:10px;color:#94a3b8;">${escapeHtml(asset.last_run_result || '无记录')}</div>
        </td>
        <td>
          <div class="coverage-cell">${coverageTagsHtml}</div>
        </td>
        <td>
          <div class="notes-cell" title="${escapeHtml(asset.notes || '')}">
            ${asset.source_channel === 'probe_discovery' ? '<span class="tag-pill" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;font-weight:600;">🔍 探测入库</span>' : ''}
            ${asset.source_channel === 'run_harvest' ? '<span class="tag-pill" style="background:#f8fafc;color:#475569;border-color:#e2e8f0;">🤖 任务沉淀</span>' : ''}
            ${asset.notes ? `<span class="notes-text">${escapeHtml(asset.notes)}</span>` : (!asset.source_channel && (!asset.tags || asset.tags.length === 0) ? '<span style="color:#cbd5e1;">—</span>' : '')}
            ${Array.isArray(asset.tags) && asset.tags.length > 0 ? asset.tags.map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('') : ''}
          </div>
        </td>
        <td style="text-align:center;">
          <div class="row-actions">
            <button type="button" class="btn btn-secondary btn-xs btn-edit-asset" data-domain="${escapeHtml(asset.referral_domain)}">编辑</button>
            <button type="button" class="btn btn-secondary btn-xs btn-del-asset" data-domain="${escapeHtml(asset.referral_domain)}" style="color:#dc2626;">删除</button>
          </div>
        </td>
      `;

      // 绑定单行复选框
      tr.querySelector('.asset-row-checkbox')?.addEventListener('change', (e) => {
        const d = e.target.dataset.domain;
        if (e.target.checked) state.selectedDomains.add(d);
        else state.selectedDomains.delete(d);
        tr.classList.toggle('selected-row', e.target.checked);
        updateSelectionBar();
      });

      // 复制按钮
      tr.querySelector('.btn-icon-copy')?.addEventListener('click', (e) => {
        const text = e.target.dataset.copy;
        navigator.clipboard.writeText(text).then(() => {
          e.target.textContent = '✓';
          setTimeout(() => { e.target.textContent = '📋'; }, 1200);
        });
      });

      // 换浅页快捷操作
      tr.querySelector('.btn-replace-shallow')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(asset, { promptShallow: true });
      });

      // 单行编辑与删除
      tr.querySelector('.btn-edit-asset')?.addEventListener('click', () => openEditModal(asset));
      tr.querySelector('.btn-del-asset')?.addEventListener('click', () => handleSingleDelete(asset.referral_domain));

      tbody.appendChild(tr);
    });

    // 更新表头全选框状态
    const allChecked = state.assets.length > 0 && state.assets.every((a) => state.selectedDomains.has(a.referral_domain));
    const selectAllBox = document.getElementById('assetSelectAllCheckbox');
    if (selectAllBox) selectAllBox.checked = allChecked;
  }

  /**
   * 更新批量勾选浮动条。
   */
  function updateSelectionBar() {
    const bar = document.getElementById('assetBatchActionBar');
    const countDisplay = document.getElementById('assetSelectedCount');
    const count = state.selectedDomains.size;
    if (!bar || !countDisplay) return;

    countDisplay.textContent = count;
    bar.style.display = count > 0 ? 'flex' : 'none';
  }

  function renderPaginationControls() {
    const info = document.getElementById('assetPaginationInfo');
    const prevBtn = document.getElementById('assetPrevPageBtn');
    const nextBtn = document.getElementById('assetNextPageBtn');
    const currentDisplay = document.getElementById('assetCurrentPageDisplay');

    const start = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.total, state.page * state.pageSize);

    if (info) info.textContent = `显示 ${start} - ${end} 条，共 ${state.total} 条`;
    if (currentDisplay) currentDisplay.textContent = `${state.page} / ${state.totalPages}`;
    if (prevBtn) prevBtn.disabled = state.page <= 1;
    if (nextBtn) nextBtn.disabled = state.page >= state.totalPages;
  }

  /**
   * 从历史任务建库。
   */
  async function handleBootstrap() {
    if (!confirm('确定要扫描所有历史批次并自动聚合建库吗？这将自动回填所有历史域名的表现统计。')) return;
    try {
      const btn = document.getElementById('assetBootstrapBtn');
      if (btn) { btn.disabled = true; btn.textContent = '正在回填建库...'; }
      const res = await apiRequest('/api/assets/bootstrap', {});
      alert(`🎉 历史建库成功！已同步更新 ${res.updatedCount || 0} 个域名的资产记录。`);
      refreshAll();
    } catch (err) {
      alert(`建库失败：${err.message}`);
    } finally {
      const btn = document.getElementById('assetBootstrapBtn');
      if (btn) { btn.disabled = false; btn.textContent = '🔄 从历史任务建库'; }
    }
  }

  /**
   * 更新导入弹窗内博客侦测配置的展示与按钮文案
   */
  function updateImportProbeUiState() {
    const defaultType = document.getElementById('assetImportDefaultType')?.value || 'blog_comment';
    const configBox = document.getElementById('assetImportProbeConfigBox');
    const enableProbeCheck = document.getElementById('assetImportEnableProbe');
    const execBtn = document.getElementById('assetExecuteImportBtn');

    if (defaultType === 'blog_comment') {
      if (configBox) configBox.style.display = 'block';
      const isProbe = enableProbeCheck ? enableProbeCheck.checked : true;
      if (execBtn) {
        execBtn.textContent = isProbe ? '🚀 开始智能侦测并导入' : '开始解析导入';
      }
    } else {
      if (configBox) configBox.style.display = 'none';
      if (execBtn) {
        execBtn.textContent = '开始解析导入';
      }
    }
  }

  /**
   * 中止正在执行的博客侦测
   */
  async function abortProbeImport() {
    if (!currentImportProbeSessionId) return;
    const abortBtn = document.getElementById('assetImportAbortBtn');
    if (abortBtn) {
      abortBtn.disabled = true;
      abortBtn.textContent = '正在中止...';
    }
    try {
      await apiRequest('/api/probe/cancel', { sessionId: currentImportProbeSessionId });
    } catch (err) {
      console.warn('中止探测请求失败：', err);
    }
  }

  /**
   * 导出未入库/过滤的明细列表为 Excel (.xlsx) 表格（支持 SheetJS，降级 CSV）
   */
  function exportSkippedOrFilteredExcel() {
    if (!currentSkippedItemsToExport || currentSkippedItemsToExport.length === 0) {
      alert('当前没有可导出的未入库或过滤明细');
      return;
    }

    const headers = ['引荐域名', '入口URL', '过滤分类', '状态说明', '判定详情'];
    const rows = currentSkippedItemsToExport.map((item) => [
      item.domain || '',
      item.url || '',
      item.category || '',
      item.status || '',
      (item.details || '').replace(/\r?\n/g, ' ')
    ]);

    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

    if (window.XLSX && window.XLSX.utils) {
      const aoa = [headers, ...rows];
      const ws = window.XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [
        { wch: 22 }, // 引荐域名
        { wch: 50 }, // 入口URL
        { wch: 18 }, // 过滤分类
        { wch: 22 }, // 状态说明
        { wch: 60 }  // 判定详情
      ];
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, '未入库明细');
      window.XLSX.writeFile(wb, `未入库外链明细_${dateStr}_共${currentSkippedItemsToExport.length}条.xlsx`);
    } else {
      const csvRows = rows.map((row) =>
        row
          .map((field) => `"${String(field ?? '').replace(/"/g, '""')}"`)
          .join(',')
      );
      const csvContent = '\uFEFF' + [headers.map((h) => `"${h}"`).join(','), ...csvRows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `未入库外链明细_${dateStr}_共${currentSkippedItemsToExport.length}条.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    }
  }

  // 保持向后兼容别名
  const exportSkippedOrFilteredCsv = exportSkippedOrFilteredExcel;

  /**
   * 打开批量导入 Modal。
   */
  function openImportModal() {
    const modal = document.getElementById('assetImportModal');
    if (modal) modal.style.display = 'flex';
    currentImportProbeSessionId = null;
    if (importProbePollTimer) {
      clearInterval(importProbePollTimer);
      importProbePollTimer = null;
    }
    currentSkippedItemsToExport = [];

    const progressSec = document.getElementById('assetImportProgressSection');
    if (progressSec) progressSec.style.display = 'none';

    const reportSec = document.getElementById('assetImportReportSection');
    if (reportSec) reportSec.style.display = 'none';

    const taskBtn = document.getElementById('assetGoToTaskAfterImportBtn');
    if (taskBtn) taskBtn.style.display = 'none';

    const exportCsvBtn = document.getElementById('assetExportSkippedCsvBtn');
    if (exportCsvBtn) exportCsvBtn.style.display = 'none';

    const execBtn = document.getElementById('assetExecuteImportBtn');
    if (execBtn) execBtn.disabled = false;

    updateImportProbeUiState();
  }

  function closeImportModal() {
    const modal = document.getElementById('assetImportModal');
    if (modal) modal.style.display = 'none';
    if (importProbePollTimer) {
      clearInterval(importProbePollTimer);
      importProbePollTimer = null;
    }
    selectedImportFile = null;
    currentImportProbeSessionId = null;
    const fileInfo = document.getElementById('assetImportFileInfo');
    if (fileInfo) fileInfo.style.display = 'none';
  }

  /**
   * 解析并执行批量导入（支持智能博客表单探测或快速直接导入）。
   */
  async function executeImport() {
    const isCsvTab = document.querySelector('.import-tab-btn.active')?.dataset.importTab === 'csv';
    const defaultType = document.getElementById('assetImportDefaultType')?.value || 'blog_comment';
    const sourceChannel = document.getElementById('assetImportSourceChannel')?.value || 'manual_import';
    const duplicateStrategy = document.querySelector('input[name="assetDedupeStrategy"]:checked')?.value || 'skip';
    const filterIllegal = document.getElementById('assetImportFilterIllegal')?.checked ?? true;
    const isBlogProbeEnabled =
      defaultType === 'blog_comment' && (document.getElementById('assetImportEnableProbe')?.checked ?? true);

    let itemsToImport = [];

    if (isCsvTab) {
      if (!selectedImportFile) {
        alert('请先选择或拖拽一个 CSV 文件！');
        return;
      }
      itemsToImport = await parseCsvFileForAssets(selectedImportFile);
    } else {
      const text = document.getElementById('assetImportTextarea')?.value || '';
      itemsToImport = parseTextForAssets(text);
    }

    if (itemsToImport.length === 0) {
      alert('未提取到任何有效的引荐 URL 或域名，请检查输入！');
      return;
    }

    // 执行非法站点前置过滤
    let filteredIllegalCount = 0;
    const illegalItems = [];
    if (filterIllegal && root.AutoCommentIllegalSiteFilter && root.AutoCommentIllegalSiteFilter.evaluateUrl) {
      const cleanList = [];
      itemsToImport.forEach((item) => {
        const check = root.AutoCommentIllegalSiteFilter.evaluateUrl(item.referralUrl || item.referralDomain);
        if (check && check.blocked) {
          filteredIllegalCount++;
          illegalItems.push({
            domain: normalizeDomain(item.referralDomain || item.referralUrl),
            url: item.referralUrl || item.referralDomain,
            category: '违规站点拦截',
            status: '违规黑名单',
            details: check.reason || '命中违规词库'
          });
        } else {
          cleanList.push(item);
        }
      });
      itemsToImport = cleanList;
    }

    if (itemsToImport.length === 0) {
      alert('所有提取到的条目均被安全词库拦截！');
      return;
    }

    // 若未启用博客智能探测，执行快速直接入库
    if (!isBlogProbeEnabled) {
      return executeDirectImport(
        itemsToImport,
        defaultType,
        sourceChannel,
        duplicateStrategy,
        filteredIllegalCount,
        illegalItems
      );
    }

    // 启用智能博客评论表单探测
    return executeProbeAndImport(
      itemsToImport,
      defaultType,
      sourceChannel,
      duplicateStrategy,
      filteredIllegalCount,
      illegalItems
    );
  }

  /**
   * 智能博客探测入库通道
   */
  async function executeProbeAndImport(
    itemsToImport,
    defaultType,
    sourceChannel,
    duplicateStrategy,
    filteredIllegalCount,
    illegalItems
  ) {
    const execBtn = document.getElementById('assetExecuteImportBtn');
    const progressSec = document.getElementById('assetImportProgressSection');
    const reportSec = document.getElementById('assetImportReportSection');
    const taskBtn = document.getElementById('assetGoToTaskAfterImportBtn');
    const progressBar = document.getElementById('assetImportProgressBar');
    const progressPercent = document.getElementById('assetImportProgressPercent');
    const progressTitle = document.getElementById('assetImportProgressTitle');
    const liveValidCount = document.getElementById('liveValidCount');
    const liveSkipCount = document.getElementById('liveSkipCount');
    const liveClosedCount = document.getElementById('liveClosedCount');
    const liveInvalidCount = document.getElementById('liveInvalidCount');
    const abortBtn = document.getElementById('assetImportAbortBtn');

    if (reportSec) reportSec.style.display = 'none';
    if (taskBtn) taskBtn.style.display = 'none';
    if (progressSec) progressSec.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.textContent = '0% (0 / 0)';
    if (progressTitle) progressTitle.textContent = '正在高并发深度侦测博客表单...';
    if (liveValidCount) liveValidCount.textContent = '0';
    if (liveSkipCount) liveSkipCount.textContent = '0';
    if (liveClosedCount) liveClosedCount.textContent = '0';
    if (liveInvalidCount) liveInvalidCount.textContent = '0';
    if (abortBtn) {
      abortBtn.disabled = false;
      abortBtn.textContent = '⏹ 中止侦测';
    }
    if (execBtn) {
      execBtn.disabled = true;
      execBtn.textContent = '正在并发探测中...';
    }

    const targetUrls = itemsToImport.map((it) => it.referralUrl || it.referralDomain);
    const concurrency = Number(document.getElementById('assetImportProbeConcurrency')?.value || 20);
    const sessionId = `import_probe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    currentImportProbeSessionId = sessionId;

    try {
      const startRes = await apiRequest('/api/probe/start', {
        sessionId,
        urls: targetUrls,
        concurrency,
        skipExisting: duplicateStrategy === 'skip'
      });

      const totalTarget = startRes.total || targetUrls.length;

      // 启动进度轮询
      const sessionData = await new Promise((resolve) => {
        // 若直接已完成（例如全部都在库内）
        if (startRes.status === 'completed') {
          apiRequest(`/api/probe/status?sessionId=${sessionId}&limit=10000`).then((res) => {
            resolve(res.session || startRes);
          });
          return;
        }

        importProbePollTimer = setInterval(async () => {
          try {
            const statusRes = await apiRequest(`/api/probe/status?sessionId=${sessionId}&limit=10000`);
            if (!statusRes.hasSession || !statusRes.session) return;
            const s = statusRes.session;

            if (progressBar) progressBar.style.width = `${s.progressPercent || 0}%`;
            if (progressPercent)
              progressPercent.textContent = `${s.progressPercent || 0}% (${s.processed || 0} / ${s.total || totalTarget})`;

            const validCount =
              (s.stats.validBlogCommentWithUrl || 0) +
              (s.stats.validBlogCommentNoUrl || 0) +
              (s.stats.bloggerComment || 0);
            const closedCount = (s.stats.commentsClosed || 0) + (s.stats.loginRequired || 0);
            const invalidCount = (s.stats.notBlogComment || 0) + (s.stats.failed || 0);

            if (liveValidCount) liveValidCount.textContent = validCount;
            if (liveSkipCount) liveSkipCount.textContent = s.stats.alreadyInLibrary || 0;
            if (liveClosedCount) liveClosedCount.textContent = closedCount;
            if (liveInvalidCount) liveInvalidCount.textContent = invalidCount;

            if (s.status === 'completed' || s.status === 'canceled') {
              clearInterval(importProbePollTimer);
              importProbePollTimer = null;
              resolve(s);
            }
          } catch (pollErr) {
            console.warn('轮询探测进度异常：', pollErr);
          }
        }, 400);
      });

      if (progressSec) progressSec.style.display = 'none';

      // 分析探测结果
      const allResults = sessionData.results || [];
      const validResults = [];
      const alreadyInLibraryResults = [];
      const closedOrLoginResults = [];
      const nonBlogOrFailedResults = [];

      for (const r of allResults) {
        if (r.status === 'already_in_library') {
          alreadyInLibraryResults.push(r);
        } else if (r.isBlogComment) {
          validResults.push(r);
        } else if (r.status === 'comments_closed' || r.status === 'login_required') {
          closedOrLoginResults.push(r);
        } else {
          nonBlogOrFailedResults.push(r);
        }
      }

      // 保存未入库或过滤明细，供一键导出 CSV
      currentSkippedItemsToExport = [];
      for (const it of illegalItems) {
        currentSkippedItemsToExport.push(it);
      }
      for (const r of closedOrLoginResults) {
        currentSkippedItemsToExport.push({
          domain: r.domain,
          url: r.url,
          category: r.status === 'login_required' ? '需登录博客' : '评论已关闭',
          status: r.statusLabel,
          details: r.details || ''
        });
      }
      for (const r of nonBlogOrFailedResults) {
        let cat = '非博客或请求异常';
        if (r.status === 'filtered_url_rule') cat = `命中URL黑名单 [${r.matchedRule || ''}]`;
        else if (r.status === 'filtered_title_rule') cat = `命中标题黑名单 [${r.matchedRule || ''}]`;
        currentSkippedItemsToExport.push({
          domain: r.domain,
          url: r.url,
          category: cat,
          status: r.statusLabel,
          details: r.details || ''
        });
      }
      for (const r of alreadyInLibraryResults) {
        currentSkippedItemsToExport.push({
          domain: r.domain,
          url: r.url,
          category: '资产库已存在',
          status: r.statusLabel,
          details: r.details || ''
        });
      }

      // 仅将判定为真实开放的博客（validResults）组织为资产入库
      let importResult = { insertedCount: 0, skippedCount: 0, insertedDomains: [], skippedDomains: [] };

      if (validResults.length > 0) {
        const origMap = new Map();
        itemsToImport.forEach((it) => {
          const d = normalizeDomain(it.referralDomain || it.referralUrl);
          if (d && !origMap.has(d)) origMap.set(d, it);
        });

        const assetsToImport = validResults.map((vr) => {
          const orig = origMap.get(vr.domain) || {};
          return {
            referralUrl: vr.url,
            referralDomain: vr.domain,
            domainRating: orig.domainRating || null,
            organicTraffic: orig.organicTraffic || null,
            resourceType: defaultType,
            notes: `[博客智能侦测] ${vr.statusLabel} (${vr.formType || 'Blog'})`
          };
        });

        importResult = await apiRequest('/api/assets/import', {
          items: assetsToImport,
          defaultType,
          sourceChannel: sourceChannel || 'probe_discovery',
          duplicateStrategy
        });
      }

      // 呈现多维统计结果
      renderProbeImportReport({
        rawCount: (sessionData.stats && sessionData.stats.rawCount) || itemsToImport.length,
        total: sessionData.total || itemsToImport.length,
        dedupCount: (sessionData.stats && sessionData.stats.dedupCount) || 0,
        insertedCount: importResult.insertedCount || 0,
        insertedDomains: importResult.insertedDomains || [],
        alreadyInLibraryCount: (sessionData.stats && sessionData.stats.alreadyInLibrary || 0) + (importResult.skippedCount || 0),
        closedOrLoginCount: closedOrLoginResults.length,
        nonBlogOrFailedCount: nonBlogOrFailedResults.length + filteredIllegalCount,
        skippedList: currentSkippedItemsToExport
      });

      refreshAll();
    } catch (err) {
      if (progressSec) progressSec.style.display = 'none';
      alert(`智能侦测并导入失败：${err.message}`);
    } finally {
      if (importProbePollTimer) {
        clearInterval(importProbePollTimer);
        importProbePollTimer = null;
      }
      if (execBtn) {
        execBtn.disabled = false;
        execBtn.textContent = '🚀 开始智能侦测并导入';
      }
    }
  }

  /**
   * 渲染智能探测入库的多维统计报告
   */
  function renderProbeImportReport(reportData) {
    const reportSec = document.getElementById('assetImportReportSection');
    const taskBtn = document.getElementById('assetGoToTaskAfterImportBtn');
    const exportCsvBtn = document.getElementById('assetExportSkippedCsvBtn');
    const summaryAlert = document.getElementById('assetImportSummaryAlert');
    const detailBox = document.getElementById('assetImportReportDetail');

    if (!reportSec) return;
    reportSec.style.display = 'block';

    document.getElementById('reportTotalRead').textContent = reportData.rawCount;
    document.getElementById('reportInserted').textContent = reportData.insertedCount;
    document.getElementById('reportAlreadyInLibrary').textContent = reportData.alreadyInLibraryCount;
    document.getElementById('reportClosedOrLogin').textContent = reportData.closedOrLoginCount;
    document.getElementById('reportNonBlogOrFailed').textContent = reportData.nonBlogOrFailedCount;

    if (summaryAlert) {
      const filteredTotal = reportData.closedOrLoginCount + reportData.nonBlogOrFailedCount;
      summaryAlert.innerHTML = `
        <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">
          🎯 博客外链智能甄别完成：共读取 ${reportData.rawCount} 条（去重后 ${reportData.total} 个独立域名）
        </div>
        <div style="line-height:1.6;color:#334155;">
          • <strong>${reportData.insertedCount}</strong> 条判定为真实开放评论的博客页面，已成功入库沉淀为资产。<br/>
          • <strong>${reportData.alreadyInLibraryCount}</strong> 条域名在资产库中已存在，已自动跳过。<br/>
          • <strong>${filteredTotal}</strong> 条非博客或评论关闭链接已自动拦截过滤，有力保障资产库质量！
        </div>
      `;
    }

    if (detailBox) {
      let detailHtml = '';
      if (reportData.insertedCount > 0) {
        detailHtml += `<strong>🟢 成功入库真博客（前 ${Math.min(30, reportData.insertedDomains.length)} 个）：</strong><br/>`;
        detailHtml += reportData.insertedDomains.slice(0, 30).join(', ');
      } else {
        detailHtml += `<span style="color:#64748b;">本批次未发现可新增入库的开放博客评论页面。</span>`;
      }
      detailBox.innerHTML = detailHtml;
    }

    if (exportCsvBtn) {
      if (reportData.skippedList && reportData.skippedList.length > 0) {
        exportCsvBtn.style.display = 'inline-flex';
        exportCsvBtn.textContent = `📊 导出未入库/过滤明细 (${reportData.skippedList.length}条 Excel)`;
      } else {
        exportCsvBtn.style.display = 'none';
      }
    }

    if (taskBtn) {
      if (reportData.insertedCount > 0) {
        taskBtn.style.display = 'inline-flex';
        taskBtn.onclick = () => {
          closeImportModal();
          const insertedSet = new Set(reportData.insertedDomains || []);
          state.selectedDomains = insertedSet;
          updateSelectionBar();
          openSendToTaskModal();
        };
      } else {
        taskBtn.style.display = 'none';
      }
    }
  }

  /**
   * 快速直接入库通道（未启用博客探测或非博客类型外链）
   */
  async function executeDirectImport(
    itemsToImport,
    defaultType,
    sourceChannel,
    duplicateStrategy,
    filteredIllegalCount,
    illegalItems
  ) {
    const execBtn = document.getElementById('assetExecuteImportBtn');
    if (execBtn) {
      execBtn.disabled = true;
      execBtn.textContent = '正在快速导入并查重...';
    }

    try {
      const result = await apiRequest('/api/assets/import', {
        items: itemsToImport,
        defaultType,
        sourceChannel,
        duplicateStrategy
      });

      result.filteredIllegalCount = filteredIllegalCount;
      lastImportResultData = result;

      currentSkippedItemsToExport = [];
      for (const it of illegalItems) {
        currentSkippedItemsToExport.push(it);
      }
      for (const d of result.skippedDomains || []) {
        currentSkippedItemsToExport.push({
          domain: d,
          url: '',
          category: '资产库已存在',
          status: '跳过重复域名',
          details: '引荐域名已在资产库中'
        });
      }

      renderDirectImportReport(result);
      refreshAll();
    } catch (err) {
      alert(`导入失败：${err.message}`);
    } finally {
      if (execBtn) {
        execBtn.disabled = false;
        execBtn.textContent = '开始解析导入';
      }
    }
  }

  /**
   * 渲染普通快速导入的结果反馈面板
   */
  function renderDirectImportReport(res) {
    const reportSec = document.getElementById('assetImportReportSection');
    const taskBtn = document.getElementById('assetGoToTaskAfterImportBtn');
    const exportCsvBtn = document.getElementById('assetExportSkippedCsvBtn');
    const summaryAlert = document.getElementById('assetImportSummaryAlert');
    const detailBox = document.getElementById('assetImportReportDetail');
    if (!reportSec) return;

    reportSec.style.display = 'block';
    document.getElementById('reportTotalRead').textContent = res.total || 0;
    document.getElementById('reportInserted').textContent = res.insertedCount || 0;
    document.getElementById('reportAlreadyInLibrary').textContent = res.skippedCount || 0;
    document.getElementById('reportClosedOrLogin').textContent = '0 (未测)';
    document.getElementById('reportNonBlogOrFailed').textContent =
      (res.invalidCount || 0) + (res.filteredIllegalCount || 0);

    if (summaryAlert) {
      summaryAlert.innerHTML = `
        <div style="font-weight:700;color:#0f172a;margin-bottom:3px;">
          快速导入完成：共读取 ${res.total || 0} 条，成功新增 <strong>${res.insertedCount || 0}</strong> 条资产，跳过重复 ${res.skippedCount || 0} 条。
        </div>
      `;
    }

    if (detailBox) {
      let detailHtml = `<strong>新增域名（前 ${Math.min(50, (res.insertedDomains || []).length)} 个）：</strong><br/>`;
      detailHtml += (res.insertedDomains || []).slice(0, 50).join(', ') || '无';
      if (res.skippedCount > 0) {
        detailHtml += `<br/><br/><strong>跳过重复域名（前 ${Math.min(30, (res.skippedDomains || []).length)} 个）：</strong><br/>`;
        detailHtml += (res.skippedDomains || []).slice(0, 30).join(', ');
      }
      detailBox.innerHTML = detailHtml;
    }

    if (exportCsvBtn) {
      if (currentSkippedItemsToExport.length > 0) {
        exportCsvBtn.style.display = 'inline-flex';
        exportCsvBtn.textContent = `📊 导出跳过明细 (${currentSkippedItemsToExport.length}条 Excel)`;
      } else {
        exportCsvBtn.style.display = 'none';
      }
    }

    if (taskBtn && res.insertedCount > 0) {
      taskBtn.style.display = 'inline-flex';
      taskBtn.onclick = () => {
        closeImportModal();
        const insertedSet = new Set(res.insertedDomains || []);
        state.selectedDomains = insertedSet;
        updateSelectionBar();
        openSendToTaskModal();
      };
    } else if (taskBtn) {
      taskBtn.style.display = 'none';
    }
  }

  /**
   * 解析 CSV 文件提取外链对象。
   */
  function parseCsvFileForAssets(file) {
    return new Promise((resolve) => {
      if (!root.Papa) {
        alert('缺少 PapaParse 库，无法解析 CSV');
        resolve([]);
        return;
      }
      root.Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data || [];
          const items = [];
          rows.forEach((row) => {
            const url = findFirstMatchingKey(row, ['引荐URL', '引荐 url', 'Source url', 'source_url', 'url', 'Page AS', 'Page URL', 'Referral URL', 'Referring page URL']);
            const domain = findFirstMatchingKey(row, ['引荐域名', 'referring_domain', 'domain', 'Source domain', 'Referring domain']);
            const dr = findFirstMatchingKey(row, ['页面AS', '域名AS', 'Domain Rating', 'DR', 'AS', 'Authority Score', 'as_score']);
            const traffic = findFirstMatchingKey(row, ['Traffic', 'Organic Traffic', '流量', '自然流量']);
            const type = findFirstMatchingKey(row, ['类型', 'Type', 'resource_type']);

            if (url || domain) {
              items.push({
                referralUrl: String(url || '').trim(),
                referralDomain: String(domain || '').trim(),
                domainRating: dr ? Number(dr) : null,
                organicTraffic: traffic ? Number(traffic) : null,
                resourceType: type || undefined
              });
            }
          });
          resolve(items);
        },
        error: () => resolve([])
      });
    });
  }

  function findFirstMatchingKey(row, candidateKeys) {
    for (const key of candidateKeys) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
        return row[key];
      }
      // 大小写不敏感匹配
      const foundKey = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
      if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && String(row[foundKey]).trim() !== '') {
        return row[foundKey];
      }
    }
    return '';
  }

  /**
   * 解析纯文本行。
   */
  function parseTextForAssets(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items = [];
    lines.forEach((line) => {
      // 兼容可能以逗号分隔
      const parts = line.split(/[,\t]/);
      const url = parts[0]?.trim();
      if (url) {
        items.push({ referralUrl: url });
      }
    });
    return items;
  }

  /**
   * 打开编辑单条资产 Modal。
   */
  function openEditModal(asset, options = {}) {
    const modal = document.getElementById('assetEditModal');
    if (!modal) return;
    state.currentEditingAsset = asset;

    const urlHint = document.getElementById('assetEditUrlHint');
    if (urlHint) urlHint.style.display = 'none';

    document.getElementById('assetEditDomain').value = asset.referral_domain;
    document.getElementById('assetEditUrl').value = asset.referral_url;
    document.getElementById('assetEditType').value = asset.resource_type || 'blog_comment';
    document.getElementById('assetEditQuality').value = asset.quality_tier || 'untested';
    document.getElementById('assetEditTags').value = Array.isArray(asset.tags) ? asset.tags.join(', ') : '';
    document.getElementById('assetEditNotes').value = asset.notes || '';

    const depthInput = document.getElementById('assetEditPageDepth');
    if (depthInput) {
      depthInput.value = asset.page_depth != null ? asset.page_depth : '';
    }

    const alertBanner = document.getElementById('assetEditDepthAlert');
    const findLink = document.getElementById('assetEditFindShallowLink');

    if (findLink) {
      findLink.href = `https://www.google.com/search?q=site:${encodeURIComponent(asset.referral_domain)}`;
      findLink.style.display = 'inline-block';
    }

    const depthNum = asset.page_depth != null ? Number(asset.page_depth) : null;
    if (alertBanner) {
      if (options.promptShallow || (depthNum !== null && depthNum > 100)) {
        alertBanner.style.display = 'block';
        alertBanner.style.background = '#fef2f2';
        alertBanner.style.border = '1px solid #fca5a5';
        alertBanner.style.color = '#991b1b';
        alertBanner.innerHTML = `
          <strong>⚠️ 该网页当前深度达 ${depthNum != null ? depthNum.toFixed(1) : ''} 屏（历史评论极多）！</strong><br/>
          评论极易被淹没沉底。建议点击右上角搜索该站评论少的新文章，替换下方入口 URL。保存后可清空深度，由自动化任务下次运行时自动探测写入。
        `;
      } else {
        alertBanner.style.display = 'none';
        alertBanner.innerHTML = '';
      }
    }

    modal.style.display = 'flex';

    if (options.promptShallow) {
      const urlInput = document.getElementById('assetEditUrl');
      if (urlInput) {
        urlInput.focus();
        urlInput.select();
      }
    }
  }

  function closeEditModal() {
    const modal = document.getElementById('assetEditModal');
    if (modal) modal.style.display = 'none';
    state.currentEditingAsset = null;
  }

  async function saveEditModal() {
    const domain = document.getElementById('assetEditDomain').value;
    const referralUrl = document.getElementById('assetEditUrl').value.trim();
    const resourceType = document.getElementById('assetEditType').value;
    const qualityTier = document.getElementById('assetEditQuality').value;
    const tags = document.getElementById('assetEditTags').value.split(',').map((t) => t.trim()).filter(Boolean);
    const notes = document.getElementById('assetEditNotes').value.trim();
    const pageDepthRaw = document.getElementById('assetEditPageDepth')?.value.trim();

    const isUrlChanged = state.currentEditingAsset && referralUrl !== state.currentEditingAsset.referral_url;
    // 如果 URL 发生改变且用户未输入自定义数值，则置空为 null（未知）
    const pageDepth = pageDepthRaw !== '' ? Number(pageDepthRaw) : (isUrlChanged ? null : (state.currentEditingAsset?.page_depth ?? null));

    if (!referralUrl) {
      alert('入口 URL 不能为空');
      return;
    }

    try {
      await apiRequest(`/api/assets/${encodeURIComponent(domain)}`, {
        referralUrl,
        resourceType,
        qualityTier,
        tags,
        notes,
        pageDepth
      }, { method: 'PATCH' });

      closeEditModal();
      refreshAll();
    } catch (err) {
      alert(`保存失败：${err.message}`);
    }
  }

  /**
   * 单个删除。
   */
  async function handleSingleDelete(domain) {
    if (!confirm(`确定要从外链资产库中删除域名 [${domain}] 吗？`)) return;
    try {
      await apiRequest(`/api/assets/${encodeURIComponent(domain)}`, undefined, { method: 'DELETE' });
      state.selectedDomains.delete(domain);
      updateSelectionBar();
      refreshAll();
    } catch (err) {
      alert(`删除失败：${err.message}`);
    }
  }

  /**
   * 批量删除。
   */
  async function handleBatchDelete() {
    const domains = Array.from(state.selectedDomains);
    if (domains.length === 0) return;
    if (!confirm(`确定要批量删除已勾选的 ${domains.length} 个外链资产吗？此操作不可逆。`)) return;

    try {
      await apiRequest('/api/assets/batch-delete', { domains });
      state.selectedDomains.clear();
      updateSelectionBar();
      refreshAll();
    } catch (err) {
      alert(`批量删除失败：${err.message}`);
    }
  }

  /**
   * 批量修改外链类型。
   */
  async function handleBatchChangeType() {
    const domains = Array.from(state.selectedDomains);
    if (domains.length === 0) return;

    const optionsStr = Object.values(RESOURCE_TYPES).map((t, idx) => `${idx + 1}. ${t.label} (${t.id})`).join('\n');
    const input = prompt(`请选择要批量设置的新外链类型（输入编号或类型代码）：\n${optionsStr}`);
    if (!input) return;

    let targetType = input.trim();
    const typeList = Object.values(RESOURCE_TYPES);
    const num = parseInt(targetType, 10);
    if (num >= 1 && num <= typeList.length) {
      targetType = typeList[num - 1].id;
    }

    if (!RESOURCE_TYPES[targetType]) {
      alert(`无效的外链类型：${targetType}`);
      return;
    }

    try {
      for (const d of domains) {
        await apiRequest(`/api/assets/${encodeURIComponent(d)}`, { resourceType: targetType }, { method: 'PATCH' });
      }
      alert(`成功将 ${domains.length} 个外链更新为【${RESOURCE_TYPES[targetType].label}】！`);
      refreshAll();
    } catch (err) {
      alert(`修改失败：${err.message}`);
    }
  }

  /**
   * 打开批量添加到任务 Modal。
   */
  function openSendToTaskModal() {
    const count = state.selectedDomains.size;
    if (count === 0) {
      alert('请先在表格中勾选要执行的外链！');
      return;
    }
    const modal = document.getElementById('assetSendToTaskModal');
    const countEl = document.getElementById('sendToTaskCountDisplay');
    if (countEl) countEl.textContent = count;
    if (modal) modal.style.display = 'flex';
  }

  function closeSendToTaskModal() {
    const modal = document.getElementById('assetSendToTaskModal');
    if (modal) modal.style.display = 'none';
  }

  /**
   * 执行将勾选的外链注入批量任务队列，并无缝跳转到「博客自动外链」Tab。
   */
  async function executeSendToTask() {
    const selectedDomains = Array.from(state.selectedDomains);
    if (selectedDomains.length === 0) return;

    // 获取选中的外链完整信息
    // 优先从 state.assets 拿，若有跨页选取的则查库获取
    let assetsToSend = state.assets.filter((a) => state.selectedDomains.has(a.referral_domain));

    if (assetsToSend.length < selectedDomains.length) {
      try {
        const queryRes = await apiRequest(`/api/assets?pageSize=200`);
        const queried = (queryRes.items || []).filter((a) => state.selectedDomains.has(a.referral_domain));
        const map = new Map();
        assetsToSend.forEach((a) => map.set(a.referral_domain, a));
        queried.forEach((a) => map.set(a.referral_domain, a));
        assetsToSend = Array.from(map.values());
      } catch (_) {}
    }

    const items = assetsToSend.map((a) => ({
      url: a.referral_url,
      sourceDomain: a.referral_domain
    }));

    closeSendToTaskModal();

    // 检查 options.html / batch.js 的全局接入点
    if (typeof root.applyParsedUrlItems === 'function') {
      root.applyParsedUrlItems(items, {
        sourceName: `资产库沉淀外链 (${items.length} 个)`,
        sourceType: 'asset_library'
      });
    }

    // 尝试切换到批量任务 Tab
    const batchTabBtn = document.querySelector('[data-tab-target="batch"]');
    if (batchTabBtn) {
      batchTabBtn.click();
    }

    alert(`🚀 成功将 ${items.length} 条外链载入批量执行队列！已自动切换至批量外链面板。`);
  }

  // 暴露模块到全局
  root.LinkPilotAssetLibrary = {
    init: initAssetLibraryUI,
    refresh: refreshAll,
    RESOURCE_TYPES,
    QUALITY_TIERS,
    apiRequest,
    openImportModal
  };

  // 页面加载完成后自动绑定
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAssetLibraryUI);
  } else {
    initAssetLibraryUI();
  }

})(typeof globalThis !== 'undefined' ? globalThis : window);
