// 使用实际发布的DSH客户端和工具注册器验证本服务；不调用模型或发送QQ消息。
// DSH_RUNTIME_DIR指向另行安装@deepseek-ai/dsh-mcp-client的目录，避免改项目依赖。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requireApi = createRequire(join(root, 'package.json'));
const requireRuntime = createRequire(join(resolve(process.env.DSH_RUNTIME_DIR), 'package.json'));
const load = (name) => import(pathToFileURL(requireRuntime.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt');
const { ToolRegistry } = await load('@deepseek-ai/dsh-tools');
const mcp = await load('@deepseek-ai/dsh-mcp-client');
const express = requireApi('express');
const mongoose = requireApi('mongoose');
const { MongoMemoryServer } = requireApi('mongodb-memory-server');
const { createPublicCanteenRouter } = await import(pathToFileURL(join(root, 'dist/server/lib.js')).href);
const directory = await mkdtemp(join(tmpdir(), 'canteen-dsh-'));
const mongo = await MongoMemoryServer.create();
const contexts = [];
let http;
let capturedCode;
try {
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use(
    await createPublicCanteenRouter(mongoose, {
      publicUrl: 'https://example.com',
      preferencesFile: join(directory, 'owner.json'),
      secureCookies: false,
      mailReady: true,
      sendMail: async ({ text }) => {
        capturedCode = text.match(/\d{6}/)[0];
      },
    }),
  );
  http = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => http.once('listening', resolve));
  const base = `http://127.0.0.1:${http.address().port}`;
  const post = (path, body, cookie) =>
    fetch(base + '/api/canteen-public/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
  async function profile(email) {
    assert.equal((await post('code', { email })).status, 200);
    const verified = await post('verify', { email, code: capturedCode });
    assert.equal(verified.status, 200);
    const cookie = verified.headers.get('set-cookie').split(';')[0];
    const created = await post('connections', { name: 'DSH实际客户端' }, cookie);
    assert.equal(created.status, 200);
    return (await created.json()).token;
  }
  async function connect(token) {
    const ctx = new Context();
    const prompt = await ctx.plugin(SystemPrompt, {});
    const tools = await ctx.plugin(ToolRegistry, {});
    const connection = await ctx.plugin(mcp, {
      transport: 'streamable-http',
      serverName: 'basan',
      url: base + '/mcp/canteen-public',
      headers: { Authorization: 'Bearer ' + token },
      toolCallTimeoutMs: 15000,
      failOnStartupError: true,
    });
    contexts.push({ ctx, connection, tools, prompt });
    const schemas = ctx.tools.schemas();
    assert.equal(schemas.length, 4);
    return ctx;
  }
  let sequence = 0;
  async function call(ctx, name, args) {
    const result = await ctx.tools.execute({
      callId: 'compatibility-' + ++sequence,
      name: 'mcp__basan__' + name,
      arguments: args,
      signal: new AbortController().signal,
    });
    assert.equal(result.isError, false, JSON.stringify(result.error));
    return JSON.stringify(result.content);
  }
  const token = await profile('a@example.com');
  const a = await connect(token);
  const b = await connect(await profile('b@example.com'));
  assert.match(await call(a, 'get_canteen_menu', {}), /八食堂三楼/);
  const results = await call(a, 'search_canteen_dishes', { keyword: '火锅鸡' });
  assert.match(results, /招牌火锅鸡/);
  await call(a, 'set_canteen_dish_preference', { dish_name: '招牌火锅鸡', preference: '喜欢' });
  await call(a, 'set_canteen_dish_note', { dish_name: '招牌火锅鸡', note: 'DSH兼容验证备注' });
  assert.match(await call(a, 'search_canteen_dishes', { keyword: '火锅鸡' }), /DSH兼容验证备注/);
  assert.doesNotMatch(
    await call(b, 'search_canteen_dishes', { keyword: '火锅鸡' }),
    /DSH兼容验证备注/,
  );
  const previous = contexts[0];
  await previous.connection.dispose();
  const again = await connect(token);
  assert.match(
    await call(again, 'search_canteen_dishes', { keyword: '火锅鸡' }),
    /DSH兼容验证备注/,
  );
  console.log(
    JSON.stringify({
      result: 'passed',
      tools: 4,
      separateProfiles: true,
      reconnectRead: true,
      modelCalls: 0,
    }),
  );
} finally {
  for (const { connection, tools, prompt } of contexts.reverse()) {
    await connection.dispose();
    await tools.dispose();
    await prompt.dispose();
  }
  if (http) {
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  }
  await mongoose.disconnect();
  await mongo.stop();
  await rm(directory, { recursive: true, force: true });
}
