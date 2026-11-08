import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createCanteenModels } from './models';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createPublicCanteenRouter, PUBLIC_CANTEEN_MCP } from './canteenPublic';
import snapshot from './canteenMenu.snapshot.json';
import { normalizeCanteenDishName } from './canteenPreferences';

let mongo: MongoMemoryServer;
let http: Server;
let base: string;
let directory: string;
let ownerFile: string;
let mailReady = true;
let failMail = false;
const mail = new Map<string, string>();
const clients: Client[] = [];
const dish = snapshot.categories[0].dishes[0].name;
const api = '/api/canteen-public';

async function serve() {
  const app = express();
  app.use(express.json());
  app.use(
    await createPublicCanteenRouter(mongoose, {
      publicUrl: 'https://menu.example.com',
      preferencesFile: ownerFile,
      mailReady,
      secureCookies: false,
      sendMail: async ({ to, text }) => {
        if (failMail) throw new Error('SMTP unavailable');
        mail.set(to, text.match(/\d{6}/)![0]);
      },
    }),
  );
  http = app.listen(0);
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}
async function request(path: string, method = 'GET', body?: object, cookie?: string) {
  return fetch(base + api + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function login(email: string) {
  expect((await request('/code', 'POST', { email })).status).toBe(200);
  const result = await request('/verify', 'POST', { email, code: mail.get(email.toLowerCase()) });
  expect(result.status).toBe(200);
  return result.headers.get('set-cookie')!.split(';')[0];
}
async function credential(cookie: string) {
  const result = await request('/connections', 'POST', { name: '我的DSH／QQ AI' }, cookie);
  expect(result.status).toBe(200);
  return (await result.json()).token as string;
}
async function connect(token: string) {
  const client = new Client({ name: 'dsh-compatible-client', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + PUBLIC_CANTEEN_MCP), {
      requestInit: { headers: { Authorization: 'Bearer ' + token } },
    }),
  );
  clients.push(client);
  return client;
}
const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  JSON.stringify(await client.callTool({ name, arguments: args }));

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'basan-public-'));
  ownerFile = join(directory, 'preferences.json');
  await writeFile(
    ownerFile,
    JSON.stringify({
      [normalizeCanteenDishName(dish)]: { preference: '很喜欢', note: '主人已有的私人评价' },
    }),
  );
  mailReady = true;
  failMail = false;
  mail.clear();
  const models = createCanteenModels(mongoose);
  await Promise.all([
    models.profiles.deleteMany({}),
    models.codes.deleteMany({}),
    models.credentials.deleteMany({}),
  ]);
  await serve();
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

it('offers independent email sign-in and does not redirect visitors to VivianChat', async () => {
  expect(await (await request('/status')).json()).toEqual({
    mailReady: true,
    endpoint: 'https://menu.example.com/mcp/canteen-public',
  });
  const anonymous = await request('/profile');
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get('location')).toBeNull();
  const cookie = await login('Person@Example.com');
  expect(await (await request('/profile', 'GET', undefined, cookie)).json()).toEqual({
    email: 'person@example.com',
    connections: [],
  });
  expect(mongoose.models.User).toBeUndefined();
});

it('runs all four real MCP tools and keeps both public profiles separate from the owner', async () => {
  const before = await readFile(ownerFile, 'utf8');
  const a = await connect(await credential(await login('a@example.com')));
  const b = await connect(await credential(await login('b@example.com')));
  expect((await a.listTools()).tools.map((tool) => tool.name)).toEqual([
    'get_canteen_menu',
    'search_canteen_dishes',
    'set_canteen_dish_preference',
    'set_canteen_dish_note',
  ]);
  expect(await call(a, 'get_canteen_menu', {})).toContain('八食堂三楼');
  const initial = await call(a, 'search_canteen_dishes', { keyword: dish });
  expect(initial).toContain('未评价');
  expect(initial).not.toContain('主人已有的私人评价');
  await call(a, 'set_canteen_dish_preference', { dish_name: dish, preference: '喜欢' });
  await call(a, 'set_canteen_dish_note', { dish_name: dish, note: '我喜欢这道菜的口味' });
  expect(await call(a, 'search_canteen_dishes', { keyword: dish })).toContain('我喜欢这道菜的口味');
  const other = await call(b, 'search_canteen_dishes', { keyword: dish });
  expect(other).toContain('未评价');
  expect(other).not.toContain('我喜欢这道菜的口味');
  expect(await readFile(ownerFile, 'utf8')).toBe(before);
});

it('reads saved feedback after a new login, credential, client and HTTP server restart', async () => {
  const cookie = await login('a@example.com');
  const a = await connect(await credential(cookie));
  await call(a, 'set_canteen_dish_note', { dish_name: dish, note: '换聊天也保留' });
  await a.close();
  clients.splice(clients.indexOf(a), 1);
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
  await serve();
  await createCanteenModels(mongoose).codes.deleteMany({});
  const next = await connect(await credential(await login('A@example.com')));
  expect(await call(next, 'search_canteen_dishes', { keyword: dish })).toContain('换聊天也保留');
  expect(await createCanteenModels(mongoose).profiles.countDocuments()).toBe(1);
});

it('revokes one profile connections without losing feedback or affecting another profile', async () => {
  const cookie = await login('a@example.com');
  const token = await credential(cookie);
  const a = await connect(token);
  const b = await connect(await credential(await login('b@example.com')));
  await call(a, 'set_canteen_dish_note', { dish_name: dish, note: '保留评价' });
  expect((await request('/connections', 'DELETE', undefined, cookie)).status).toBe(200);
  await expect(call(a, 'get_canteen_menu', {})).rejects.toThrow();
  expect(await call(b, 'get_canteen_menu', {})).toContain('八食堂三楼');
  const renewed = await connect(await credential(cookie));
  expect(await call(renewed, 'search_canteen_dishes', { keyword: dish })).toContain('保留评价');
});

it('rejects expired, reused and repeatedly incorrect email codes', async () => {
  await login('a@example.com');
  expect(
    (await request('/verify', 'POST', { email: 'a@example.com', code: mail.get('a@example.com') }))
      .status,
  ).toBe(400);
  await request('/code', 'POST', { email: 'b@example.com' });
  expect((await request('/code', 'POST', { email: 'b@example.com' })).status).toBe(429);
  for (let i = 0; i < 5; i++)
    expect(
      (await request('/verify', 'POST', { email: 'b@example.com', code: '000000' })).status,
    ).toBe(400);
  expect(
    (await request('/verify', 'POST', { email: 'b@example.com', code: mail.get('b@example.com') }))
      .status,
  ).toBe(400);
  await request('/code', 'POST', { email: 'c@example.com' });
  await createCanteenModels(mongoose).codes.updateOne(
    { _id: 'c@example.com' },
    { expiresAt: new Date(0) },
  );
  expect(
    (await request('/verify', 'POST', { email: 'c@example.com', code: mail.get('c@example.com') }))
      .status,
  ).toBe(400);
});

it('reports mail delivery failure and allows retry after it is fixed', async () => {
  failMail = true;
  expect((await request('/code', 'POST', { email: 'a@example.com' })).status).toBe(503);
  failMail = false;
  expect(await login('a@example.com')).toContain('canteen_session=');
});

it('keeps browser sessions separate from MCP credentials and supports logout', async () => {
  const cookie = await login('a@example.com');
  const token = await credential(cookie);
  expect((await request('/profile', 'GET', undefined, 'canteen_session=' + token)).status).toBe(
    401,
  );
  expect((await request('/logout', 'POST', undefined, cookie)).status).toBe(200);
  expect((await request('/profile', 'GET', undefined, cookie)).status).toBe(401);
  expect(await call(await connect(token), 'get_canteen_menu', {})).toContain('八食堂三楼');
});
