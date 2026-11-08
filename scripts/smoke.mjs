import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory = await mkdtemp(join(tmpdir(), 'basan-built-smoke-'));
let mongo;
let child;
const client = new Client({ name: 'basan-built-smoke', version: '1' });
try {
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['dist/server/stdio.js'],
    env: { ...process.env, CANTEEN_PREFERENCES_FILE: join(directory, 'stdio.json'), CANTEEN_MENU_FILE: '' },
  }));
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 4);
  const menu = await client.callTool({ name: 'get_canteen_menu', arguments: {} });
  assert.equal(menu.isError, undefined);
  assert(JSON.stringify(menu).includes('八食堂三楼'));
  await client.close();

  mongo = await MongoMemoryServer.create();
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  let output = '';
  child = spawn(process.execPath, ['dist/server/http.js'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
      MONGO_URI: mongo.getUri(), CANTEEN_MCP_PUBLIC_URL: origin,
      CANTEEN_SMTP_USER: '', CANTEEN_SMTP_PASSWORD: '',
      CANTEEN_PREFERENCES_FILE: join(directory, 'http.json'), CANTEEN_MENU_FILE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { output += bytes; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('独立HTTP入口退出：' + output);
    try {
      ready = (await fetch(origin + '/health', { signal: AbortSignal.timeout(1000) })).ok;
      if (ready) break;
    } catch { /* 等待本地进程启动 */ }
    await delay(100);
  }
  assert(ready, '独立HTTP入口未就绪：' + output);
  const status = await (await fetch(origin + '/api/canteen-public/status')).json();
  assert.equal(status.endpoint, origin + '/mcp/canteen-public');
  assert.equal(status.mailReady, false);
  for (const route of ['/', '/canteen']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert(html.includes('八三食堂 MCP'));
    const asset = html.match(/src="([^"]+\.js)"/)[1];
    const code = await (await fetch(origin + asset)).text();
    assert(code.includes('邮箱验证用于保存个人喜好'));
  }
  const anonymous = await fetch(origin + '/mcp/canteen-public', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(anonymous.status, 401);
  console.log(JSON.stringify({ stdioTools: 4, standaloneHttp: true, builtWeb: true, realMailSent: false, paidCalls: 0 }));
} finally {
  await client.close();
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  await mongo?.stop();
  await rm(directory, { recursive: true, force: true });
}
