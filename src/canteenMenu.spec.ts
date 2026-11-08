import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCanteenMenuServer } from './canteenMenu';
import { CANTEEN_INTRO } from './canteenMenu';
import type { CanteenSnapshot } from './canteenMenu';
import collectedMenu from './canteenMenu.snapshot.json';

const capturedAt = '2026-10-25T20:00:00+08:00';
const chicken = {
  name: '鸡煲＋米饭',
  price: 19,
  priceFrom: false,
  monthlySales: '615+',
  tags: [],
};
const snapshot: CanteenSnapshot = {
  restaurant: '合成食堂',
  address: '合成校区',
  source: '测试快照',
  capturedAt,
  notices: ['公告不作为菜品'],
  categories: [
    { name: '优惠', capturedAt, complete: true, withdrawn: false, dishes: [{ ...chicken }] },
    {
      name: '小煲',
      capturedAt,
      complete: true,
      withdrawn: false,
      dishes: [
        { ...chicken },
        { ...chicken, name: '鱼煲', price: 15, priceFrom: true },
        { ...chicken, name: '鸡肉', price: 25 },
      ],
    },
    {
      name: '下架',
      capturedAt,
      complete: true,
      withdrawn: true,
      dishes: [{ ...chicken, name: '旧套餐' }],
    },
    { name: '面条', capturedAt, complete: true, withdrawn: false, dishes: [] },
  ],
};

let directory: string;
let file: string;
let client: Client;
let server: ReturnType<typeof createCanteenMenuServer>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'canteen-menu-'));
  file = join(directory, 'menu.json');
  await writeFile(file, JSON.stringify(snapshot));
  server = createCanteenMenuServer({ menuFile: file });
  client = new Client({ name: 'canteen-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
});
afterEach(async () => {
  await client.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
});
const query = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return { result, text: (result.content as Array<{ text: string }>)[0].text };
};

it('discovers menu and preference tools and reports coverage, timestamp, notices and empty categories', async () => {
  const tools = (await client.listTools()).tools;
  expect(tools.map((t) => t.name)).toEqual([
    'get_canteen_menu',
    'search_canteen_dishes',
    'set_canteen_dish_preference',
    'set_canteen_dish_note',
  ]);
  expect(
    tools
      .filter((t) => !t.name.startsWith('set_canteen_dish_'))
      .every((t) => t.annotations?.readOnlyHint),
  ).toBe(true);
  expect(
    tools.find((t) => t.name === 'set_canteen_dish_preference')?.annotations?.readOnlyHint,
  ).toBe(false);
  const { text } = await query('get_canteen_menu');
  expect(text).toContain(capturedAt);
  expect(text).toContain('用户偏好为当前保存的评价');
  expect(text).toContain('公告不作为菜品');
  expect((await query('get_canteen_menu', { category: '面条' })).text).toContain('没有展示菜品');
});

it('exposes the canteen introduction during MCP initialization', () => {
  expect(client.getInstructions()).toBe(CANTEEN_INTRO);
});

it('filters budget, sorts, merges duplicate placement and pages without omission', async () => {
  const first = await query('search_canteen_dishes', {
    max_price: 20,
    sort: 'price_asc',
    limit: 1,
  });
  expect(first.text).toContain('找到2项');
  expect(first.text).toContain('鱼煲｜15.00元起');
  expect(first.text).toContain('offset设为1');
  const second = await query('search_canteen_dishes', {
    max_price: 20,
    sort: 'price_asc',
    limit: 1,
    offset: 1,
  });
  expect(second.text).toContain('鸡煲＋米饭');
  expect(second.text).toContain('优惠、小煲');
  expect(second.text).toContain('采集时月售615+');
  expect(second.text).toContain('用户偏好：未评价');
  expect(second.text).not.toContain('旧套餐');
  const changed = structuredClone(snapshot);
  Object.assign(changed.categories[1].dishes[2], { soldOut: true, remainingAtCapture: '仅剩1份' });
  await writeFile(file, JSON.stringify(changed));
  const former = await query('search_canteen_dishes', { keyword: '鸡肉' });
  expect(former.text).toContain('鸡肉');
  expect(former.text).not.toMatch(/售罄|仅剩/);
});

it('persists each preference across restarts, shares duplicate names and survives menu refresh', async () => {
  for (const preference of ['没吃过', '不喜欢', '一般', '喜欢', '很喜欢']) {
    expect(
      (await query('set_canteen_dish_preference', { dish_name: '鸡煲+米饭', preference })).text,
    ).toContain(`→ ${preference}`);
    expect((await query('search_canteen_dishes', { preference })).text).toContain('找到1项');
  }
  await client.close();
  await server.close();
  server = createCanteenMenuServer({ menuFile: file });
  client = new Client({ name: 'canteen-restarted', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const refreshed = structuredClone(snapshot);
  refreshed.categories[1].dishes[0].price = 20;
  await writeFile(file, JSON.stringify(refreshed));
  const category = await query('get_canteen_menu', { category: '小煲' });
  expect(category.text).toContain('20.00元');
  expect(category.text).toContain('用户偏好：很喜欢');
  expect((await query('get_canteen_menu', { category: '优惠' })).text).toContain(
    '用户偏好：很喜欢',
  );
  expect((await query('search_canteen_dishes', { preference: '未评价' })).text).not.toContain(
    '鸡煲＋米饭',
  );
  await query('set_canteen_dish_preference', {
    dish_name: '鸡煲＋米饭',
    preference: '未评价',
  });
  expect((await query('search_canteen_dishes', { keyword: '鸡煲' })).text).toContain(
    '用户偏好：未评价',
  );
});

it('keeps unrated separate from explicitly not tried and reads legacy preferences conservatively', async () => {
  await writeFile(
    join(directory, 'preferences.json'),
    JSON.stringify({ '鸡煲+米饭': '未评价/没吃过', 鱼煲: '喜欢' }),
  );
  expect((await query('search_canteen_dishes', { preference: '没吃过' })).text).toContain(
    '找到0项',
  );
  expect((await query('search_canteen_dishes', { preference: '未评价' })).text).toContain(
    '鸡煲＋米饭',
  );
  await query('set_canteen_dish_preference', { dish_name: '鸡煲＋米饭', preference: '没吃过' });
  expect((await query('search_canteen_dishes', { preference: '没吃过' })).text).toContain(
    '找到1项',
  );
  expect((await query('search_canteen_dishes', { preference: '未评价' })).text).not.toContain(
    '鸡煲＋米饭',
  );
  expect((await query('search_canteen_dishes', { preference: '喜欢' })).text).toContain('鱼煲');
});

it('persists useful notes independently, rejects over 200 characters and can clear a note', async () => {
  const note = '分量偏少，酱汁偏咸，适合配米饭。';
  await query('set_canteen_dish_preference', { dish_name: '鸡煲＋米饭', preference: '喜欢' });
  const changed = await query('set_canteen_dish_note', { dish_name: '鸡煲＋米饭', note });
  expect(changed.text).toContain(note);
  let menu = await query('get_canteen_menu', { category: '小煲' });
  expect(menu.text).toContain('菜品备注：' + note);
  expect(menu.text).toContain('用户偏好：喜欢');
  await query('set_canteen_dish_preference', { dish_name: '鸡煲＋米饭', preference: '未评价' });
  expect((await query('search_canteen_dishes', { keyword: '鸡煲' })).text).toContain(
    '菜品备注：' + note,
  );
  const oversized = await query('set_canteen_dish_note', {
    dish_name: '鸡煲＋米饭',
    note: '菜'.repeat(201),
  });
  expect(oversized.result.isError).toBe(true);
  expect((await query('search_canteen_dishes', { keyword: '鸡煲' })).text).toContain(note);
  expect(
    (await query('set_canteen_dish_note', { dish_name: '鸡煲＋米饭', note: '菜'.repeat(200) }))
      .result.isError,
  ).toBeUndefined();
  await query('set_canteen_dish_note', { dish_name: '鸡煲＋米饭', note: '' });
  expect((await query('search_canteen_dishes', { keyword: '鸡煲' })).text).not.toContain(
    '菜品备注：',
  );
});

it('does not create unknown dishes or overwrite a broken preference file', async () => {
  const unknown = await query('set_canteen_dish_preference', {
    dish_name: '编造菜名',
    preference: '喜欢',
  });
  expect(unknown.text).toContain('偏好未修改');
  await expect(readFile(join(directory, 'preferences.json'), 'utf8')).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await writeFile(join(directory, 'preferences.json'), '{');
  const invalid = await query('set_canteen_dish_preference', {
    dish_name: '鸡煲＋米饭',
    preference: '喜欢',
  });
  expect(invalid.result.isError).toBe(true);
  expect(invalid.text).toContain('菜品偏好文件');
  expect(await readFile(join(directory, 'preferences.json'), 'utf8')).toBe('{');
});

it('normalizes full-width names, keeps exact category lookup and makes missing results explicit', async () => {
  expect((await query('search_canteen_dishes', { keyword: '鸡煲+米饭' })).text).toContain(
    '找到1项',
  );
  expect((await query('get_canteen_menu', { category: '不存在' })).text).toContain('未找到分类');
  expect((await query('search_canteen_dishes', { max_price: 1 })).text).toContain('没有匹配结果');
});

it('keeps separately displayed sales for identical names in different categories', async () => {
  const changed = structuredClone(snapshot);
  changed.categories[1].dishes[0].monthlySales = '88';
  await writeFile(file, JSON.stringify(changed));
  const { text } = await query('search_canteen_dishes', { keyword: '鸡煲' });
  expect(text).toContain('找到2项');
  expect(text).toContain('月售615+');
  expect(text).toContain('月售88');
});

it('reads refreshed persisted data on the next call and reports invalid or missing files', async () => {
  const changed = structuredClone(snapshot);
  changed.categories[1].complete = false;
  changed.categories[1].dishes[1].price = 13;
  await writeFile(file, JSON.stringify(changed));
  const { text } = await query('search_canteen_dishes', { keyword: '鱼' });
  expect(text).toContain('13.00元起');
  expect(text).toContain('尚未采集完整的分类：小煲');
  await writeFile(file, '{');
  expect((await query('get_canteen_menu')).result.isError).toBe(true);
  await rm(file);
  expect((await query('get_canteen_menu')).text).toContain('菜单文件不存在');
});

it('keeps hotpot additions attached to their dish and out of standalone budget and preference results', async () => {
  await writeFile(file, JSON.stringify(collectedMenu));
  const category = await query('get_canteen_menu', { category: '招牌火锅鸡' });
  expect(category.text).toContain('招牌火锅鸡（1项');
  expect(category.text).toContain('可加料/调料（另计价，不作为独立菜品）');
  expect(category.text).toContain('单加宽粉｜10.00元起');
  expect(category.text).toContain('采集时月售226');
  expect(category.text).toContain('单家面筋6串｜10.00元');
  expect(category.text).toContain('单加排骨｜39.00元起');
  expect(
    (await query('search_canteen_dishes', { category: '招牌火锅鸡', max_price: 20 })).text,
  ).toContain('找到0项');
  expect((await query('search_canteen_dishes', { keyword: '单加宽粉' })).text).toContain('找到0项');
  const rejected = await query('set_canteen_dish_preference', {
    dish_name: '单加宽粉',
    preference: '喜欢',
  });
  expect(rejected.text).toContain('加料/调料不单独评价，偏好未修改');
  await query('set_canteen_dish_preference', { dish_name: '招牌火锅鸡', preference: '喜欢' });
  const preferred = await query('search_canteen_dishes', {
    category: '招牌火锅鸡',
    preference: '喜欢',
  });
  expect(preferred.text).toContain('找到1项');
  expect(preferred.text).toContain('招牌火锅鸡｜68.00元起');
  expect(preferred.text).toContain('单加宽粉');
  const summary = await query('get_canteen_menu');
  expect(summary.text).toContain('招牌火锅鸡：1项，已读到分类末尾；另有10项加料/调料');
});

it('retains dumpling and wonton condiment prices and distinct sales as category additions', async () => {
  await writeFile(file, JSON.stringify(collectedMenu));
  const dumplings = await query('get_canteen_menu', { category: '手工水饺' });
  const wontons = await query('get_canteen_menu', { category: '吉祥馄饨' });
  expect(dumplings.text).toContain('手工水饺（6项');
  expect(wontons.text).toContain('吉祥馄饨（11项');
  expect(dumplings.text).toContain('本分类可加调料');
  expect(dumplings.text).toContain('醋＋辣椒油包｜0.50元｜采集时月售200');
  expect(wontons.text).toContain('醋＋辣椒油包｜0.50元｜采集时月售63');
  expect((await query('search_canteen_dishes', { keyword: '醋＋辣椒油包' })).text).toContain(
    '找到0项',
  );
  const meal = await query('search_canteen_dishes', { keyword: '青椒猪肉水饺' });
  expect(meal.text).toContain('找到1项');
  expect(meal.text).toContain('醋＋辣椒油包｜0.50元｜采集时月售200');
});
