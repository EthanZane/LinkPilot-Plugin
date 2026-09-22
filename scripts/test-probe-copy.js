import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootDir = process.cwd();
const probeCode = readFileSync(path.join(rootDir, 'probe.js'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Build a mock DOM environment
const domStore = new Map();
function makeMockElement(id = '', tagName = 'div') {
  return {
    id,
    tagName: tagName.toUpperCase(),
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    _tc: '',
    get textContent() { return this._tc; },
    set textContent(v) { this._tc = String(v ?? ''); },
    innerHTML: '',
    value: '',
    disabled: false,
    dataset: {},
    children: [],
    listeners: {},
    addEventListener(event, fn) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    },
    dispatchEvent(evt) {
      const list = this.listeners[evt?.type || evt] || [];
      list.forEach((fn) => fn(evt));
    },
    click() {
      this.dispatchEvent({ type: 'click', currentTarget: this, stopPropagation() {} });
    },
    focus() {},
    scrollIntoView() {},
    querySelector(sel) {
      if (sel === '.btn-probe-copy-single') {
        return this.children.find((c) => c.classListContains?.('btn-probe-copy-single')) || null;
      }
      return null;
    },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); }
  };
}

let clipboardText = '';
const mockDocument = {
  readyState: 'complete',
  addEventListener() {},
  getElementById(id) {
    if (!domStore.has(id)) {
      domStore.set(id, makeMockElement(id));
    }
    return domStore.get(id);
  },
  querySelector(sel) {
    if (sel === '[data-tab-target="batch"]') {
      return this.getElementById('batchTabBtn');
    }
    return null;
  },
  querySelectorAll() { return []; },
  createElement(tag) { return makeMockElement('', tag); },
  body: makeMockElement('body')
};

let lastAlert = '';
const mockWindow = {
  document: mockDocument,
  navigator: {
    clipboard: {
      async writeText(text) {
        clipboardText = text;
      }
    }
  },
  isSecureContext: true,
  alert(msg) { lastAlert = msg; },
  confirm() { return true; },
  setTimeout(fn, delay) { return setTimeout(fn, delay); },
  clearTimeout(id) { clearTimeout(id); },
  Event: class { constructor(type) { this.type = type; } }
};

const sandbox = {
  window: mockWindow,
  document: mockDocument,
  navigator: mockWindow.navigator,
  alert: mockWindow.alert,
  confirm: mockWindow.confirm,
  setTimeout: mockWindow.setTimeout,
  clearTimeout: mockWindow.clearTimeout,
  Event: mockWindow.Event,
  fetch: async () => ({ ok: true, json: async () => ({ ok: true, data: {} }) }),
  console,
  Set,
  Map,
  Array,
  Object,
  String,
  Number,
  Date,
  URL: globalThis.URL
};

vm.createContext(sandbox);

// Unwrap IIFE to allow test introspection
const unwrappedProbeCode = probeCode
  .replace(/^\(function\s*\(\)\s*\{\s*'use strict';/m, '')
  .replace(/\}\)\(\);\s*$/m, '');

// Run probe.js
vm.runInContext(unwrappedProbeCode, sandbox);

console.log('Testing probe UI elements initialization...');
const copyBtn = mockDocument.getElementById('probeCopySelectedUrlsBtn');
assert(copyBtn, 'probeCopySelectedUrlsBtn 必须被渲染');
const sendBatchBtn = mockDocument.getElementById('probeSendToBatchBtn');
assert(sendBatchBtn, 'probeSendToBatchBtn 必须被渲染');
const copyCountDisplay = mockDocument.getElementById('probeCopyCountDisplay');
assert(copyCountDisplay, 'probeCopyCountDisplay 必须被渲染');

console.log('Testing empty selection guard...');
copyBtn.click();
assert(lastAlert.includes('请先勾选'), '未勾选时点击复制必须弹出友好提示');

// Test with simulated results and selections
console.log('Testing selection and one-per-line copying...');
vm.runInContext(`
  probeState.results = [
    { url: 'https://blog1.com/post-a', domain: 'blog1.com', isBlogComment: true },
    { url: 'https://blog2.org/article-b', domain: 'blog2.org', isBlogComment: true },
    { url: 'https://blog3.net/review-c', domain: 'blog3.net', isBlogComment: false }
  ];
  probeState.selectedUrls.add('https://blog1.com/post-a');
  probeState.selectedUrls.add('https://blog2.org/article-b');
  updateSelectedCountDisplay();
`, sandbox);

assert(mockDocument.getElementById('probeSelectedCountDisplay').textContent === '2', '所选总数应显示 2');
assert(mockDocument.getElementById('probeCopyCountDisplay').textContent === '2', '复制按钮角标应显示 2');

// Trigger copy button
clipboardText = '';
copyBtn.click();

// Give async clipboard promise a tick
await new Promise((r) => setTimeout(r, 50));

assert(clipboardText === 'https://blog1.com/post-a\nhttps://blog2.org/article-b', 
  `剪贴板内容必须是一行一个 URL，当前为: ${JSON.stringify(clipboardText)}`);

console.log('Testing send to batch input box...');
const manualInput = mockDocument.getElementById('manualUrlsInput');
const batchTabBtn = mockDocument.getElementById('batchTabBtn');
let batchTabClicked = false;
batchTabBtn.addEventListener('click', () => { batchTabClicked = true; });

clipboardText = '';
sendBatchBtn.click();
await new Promise((r) => setTimeout(r, 50));

assert(manualInput.value === 'https://blog1.com/post-a\nhttps://blog2.org/article-b', 
  `自动外链输入框内容必须被填入且为一行一个，当前为: ${JSON.stringify(manualInput.value)}`);
assert(batchTabClicked, '必须自动触发切换到「博客自动外链」Tab');
assert(clipboardText === manualInput.value, '填入的同时必须同步复制到剪贴板');

console.log('✅ 所有探测外链复制与填入测试全部通过！');
