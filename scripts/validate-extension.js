import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

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

validateRequiredFiles();
validateManifest();
validateJavaScriptSyntax();

console.log('扩展校验通过：manifest 和核心 JS 文件均可加载。');
