import http from 'node:http';
import { spawn } from 'node:child_process';

async function main() {
  const serverProcess = spawn('node', ['server/index.js'], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });

  // 等待服务启动
  await new Promise((resolve) => setTimeout(resolve, 1500));

  async function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:17321${path}`, options, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (_) {
            resolve({ raw: data, statusCode: res.statusCode });
          }
        });
      });
      req.on('error', reject);
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  }

  try {
    console.log('--- 测试 1: GET /health ---');
    const health = await request('/health');
    console.log('Health:', health);

    console.log('--- 测试 2: GET /api/assets/summary ---');
    const summary = await request('/api/assets/summary');
    console.log('Summary:', summary);

    console.log('--- 测试 3: GET /api/assets?pageSize=5&sortBy=success_rate ---');
    const assets = await request('/api/assets?pageSize=5&sortBy=success_rate');
    console.log(`Assets total: ${assets.data.total}, page: ${assets.data.page}, returned: ${assets.data.items.length}`);
    if (assets.data.items[0]) {
      console.log('Sample asset:', {
        domain: assets.data.items[0].referral_domain,
        url: assets.data.items[0].referral_url,
        rate: assets.data.items[0].success_rate,
        tier: assets.data.items[0].quality_tier
      });
    }

    console.log('--- 测试 4: POST /api/assets/import (测试导入与查重) ---');
    const importRes = await request('/api/assets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        items: [
          { referralUrl: 'https://new-test-domain-xyz123.com/blog/test', resourceType: 'blog_comment' },
          { referralUrl: assets.data.items[0].referral_url, resourceType: 'blog_comment' } // duplicate!
        ],
        duplicateStrategy: 'skip'
      }
    });
    console.log('Import result:', importRes);

    console.log('--- 测试 5: PATCH /api/assets/new-test-domain-xyz123.com ---');
    const patchRes = await request('/api/assets/new-test-domain-xyz123.com', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: { notes: '自动化测试新增备注', tags: ['seo', 'test'] }
    });
    console.log('Patch result:', patchRes.data && patchRes.data.notes);

    console.log('--- 测试 6: 清理测试数据 DELETE /api/assets/new-test-domain-xyz123.com ---');
    const delRes = await request('/api/assets/new-test-domain-xyz123.com', {
      method: 'DELETE'
    });
    console.log('Delete result:', delRes);

    console.log('✅ 所有后端 API 测试全部通过！');
  } catch (err) {
    console.error('测试失败：', err);
    process.exitCode = 1;
  } finally {
    serverProcess.kill('SIGTERM');
  }
}

main();
