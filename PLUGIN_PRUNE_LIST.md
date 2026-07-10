# 插件打包清单

个人本地版浏览器插件运行时需要保留：

- `manifest.json`
- `background.js`
- `ai-providers.js`
- `content.js`
- `illegal-site-filter.js`
- `options.html`
- `options.js`
- `batch.html`
- `batch.js`
- `index.html`
- `lib/papaparse.min.js`

## 可不随插件分发

以下文件只用于开发或校验，不是 Chrome 扩展运行时必需文件：

- `.git/`
- `.gitignore`
- `package.json`
- `pnpm-lock.yaml`
- `scripts/`
- `PLUGIN_PRUNE_LIST.md`

## 校验

修改扩展文件后建议执行：

```bash
pnpm validate
```

该命令会检查 `manifest.json`、核心 JS 语法以及运行时必需文件是否存在。
