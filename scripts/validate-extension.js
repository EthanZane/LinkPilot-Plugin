import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';

const rootDir = process.cwd();

const requiredFiles = [
  'manifest.json',
  'background.js',
  'ai-providers.js',
  'content.js',
  'illegal-site-filter.js',
  'options.html',
  'options.js',
  'batch.html',
  'batch.js',
  'lib/papaparse.min.js'
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateManifest() {
  const manifestPath = path.join(rootDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  assert(manifest.manifest_version === 3, 'manifest_version 必须为 3');
  assert(manifest.background && manifest.background.service_worker === 'background.js', 'background.service_worker 必须指向 background.js');
  assert(manifest.background && manifest.background.type === 'module', 'background.type 必须为 module，以便加载 AI Provider 模块');
  assert(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0, '必须配置 content_scripts');
  assert(Array.isArray(manifest.host_permissions) && manifest.host_permissions.includes('https://*/*'), '必须允许访问用户配置的 HTTPS AI Provider');
  assert(manifest.host_permissions.includes('http://*/*'), '必须允许访问用户配置的 HTTP 本地或局域网 AI Provider');
  assert(Array.isArray(manifest.permissions) && manifest.permissions.includes('unlimitedStorage'), '必须允许本地保存未同步批次的完整结果');
}

function validateRequiredFiles() {
  for (const file of requiredFiles) {
    assert(existsSync(path.join(rootDir, file)), `缺少扩展运行文件：${file}`);
  }
}

function validateJavaScriptSyntax() {
  const jsFiles = [
    'background.js',
    'ai-providers.js',
    'content.js',
    'illegal-site-filter.js',
    'options.js',
    'batch.js'
  ];

  for (const file of jsFiles) {
    const result = spawnSync(process.execPath, ['--check', file], {
      cwd: rootDir,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(`JS 语法校验失败：${file}\n${result.stderr || result.stdout}`);
    }
  }
}

/**
 * 按设置页真实加载顺序组合解析普通脚本，捕获单文件语法检查无法发现的顶层 const/let 重名问题。
 */
function validateOptionsPageScriptScope() {
  const scriptFiles = ['illegal-site-filter.js', 'options.js', 'batch.js'];
  const combinedSource = scriptFiles
    .map((file) => `\n// 来源文件：${file}\n${readFileSync(path.join(rootDir, file), 'utf8')}`)
    .join('\n');

  try {
    new vm.Script(combinedSource, { filename: 'options.html 普通脚本组合校验' });
  } catch (error) {
    throw new Error(`设置页脚本作用域校验失败：${error.message}`);
  }
}

/**
 * 批量功能实际运行在 options.html，校验新增交互节点，避免只修改独立 batch.html 后设置页没有界面。
 */
function validateBatchUiBindings() {
  const optionsHtml = readFileSync(path.join(rootDir, 'options.html'), 'utf8');
  const requiredElementIds = [
    'databasePersistence',
    'databasePersistenceMessage',
    'retryDatabaseBtn',
    'importResultCsvBtn',
    'resultCsvInput',
    'batchHistoryEmpty',
    'batchHistoryWrap',
    'batchHistoryBody'
  ];
  for (const elementId of requiredElementIds) {
    assert(optionsHtml.includes(`id="${elementId}"`), `options.html 缺少批量功能节点：${elementId}`);
  }
}

/**
 * 校验表单填充和页面悬浮入口的触发边界，避免普通网页加载时再次出现无授权填表。
 */
function validateManualFormFillingAndFloatingButtons() {
  const contentSource = readFileSync(path.join(rootDir, 'content.js'), 'utf8');
  const optionsSource = readFileSync(path.join(rootDir, 'options.js'), 'utf8');
  const optionsHtml = readFileSync(path.join(rootDir, 'options.html'), 'utf8');

  assert(
    !/await restoreBatchContext\(\);\s*fillInputs\(\);/.test(contentSource),
    '普通页面初始化流程不得自动调用 fillInputs'
  );
  assert(
    contentSource.includes("fillFormBtn.addEventListener('click'"),
    'AI 评论面板必须保留用户手动触发表单填充的入口'
  );
  assert(
    /message\.type === 'BATCH_HANDLE'[\s\S]{0,2500}await fillInputs\(\);/.test(contentSource),
    '批量自动提交任务必须保留显式填表流程'
  );
  assert(
    optionsHtml.includes('id="togglePageFloatingButtonsBtn"')
      && optionsSource.includes('SHOW_PAGE_FLOATING_BUTTONS_STORAGE_KEY'),
    '设置页必须提供统一控制两个页面悬浮按钮的开关'
  );
}

validateRequiredFiles();
validateManifest();
validateJavaScriptSyntax();
validateOptionsPageScriptScope();
validateBatchUiBindings();
validateManualFormFillingAndFloatingButtons();

console.log('扩展校验通过：manifest、核心 JS 文件及设置页组合脚本均可加载。');
