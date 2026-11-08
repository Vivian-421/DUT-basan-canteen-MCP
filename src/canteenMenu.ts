import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import bundledMenu from './canteenMenu.snapshot.json';
import {
  CanteenPreferencesError,
  CanteenPreferencesStore,
  normalizeCanteenDishName,
} from './canteenPreferences';
import type { CanteenDishFeedback } from './canteenPreferences';

export const CANTEEN_INTRO: string =
  '这是用户的学校食堂八三，中午和晚上营业，晚上一般营业至23:00，可以堂食、打包自提、外卖送到宿舍楼下。可查询菜单、价格、月售、用户偏好及菜品备注，并根据用户评价修改偏好或简短备注。';

const feedbackFor = (
  saved: Record<string, CanteenDishFeedback>,
  name: string,
): CanteenDishFeedback =>
  saved[normalizeCanteenDishName(name)] ?? { preference: '未评价', note: '' };

const menuItemSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative(),
  priceFrom: z.boolean().default(false),
  originalPrice: z.number().nonnegative().optional(),
  monthlySales: z.string().optional(),
  tags: z.array(z.string()).default([]),
  options: z.array(z.string()).optional(),
});
const dishSchema = menuItemSchema.extend({ addOns: z.array(menuItemSchema).optional() });
const canteenSnapshotSchema = z.object({
  restaurant: z.string().min(1),
  address: z.string(),
  source: z.string(),
  capturedAt: z.iso.datetime({ offset: true }),
  notices: z.array(z.string()),
  categories: z.array(
    z.object({
      name: z.string().min(1),
      complete: z.boolean(),
      withdrawn: z.boolean().default(false),
      capturedAt: z.iso.datetime({ offset: true }),
      dishes: z.array(dishSchema),
      addOns: z.array(menuItemSchema).optional(),
    }),
  ),
});
type MenuItem = {
  name: string;
  price: number;
  priceFrom: boolean;
  originalPrice?: number;
  monthlySales?: string;
  tags: string[];
  options?: string[];
};
type Dish = MenuItem & { addOns?: MenuItem[] };
export type CanteenSnapshot = {
  restaurant: string;
  address: string;
  source: string;
  capturedAt: string;
  notices: string[];
  categories: Array<{
    name: string;
    complete: boolean;
    withdrawn: boolean;
    capturedAt: string;
    dishes: Dish[];
    addOns?: MenuItem[];
  }>;
};
export type CanteenConfig = { menuFile?: string; preferencesFile?: string };
const normalize = normalizeCanteenDishName;
const money = (price: number): string => `${price.toFixed(2)}元`;
const itemLine = (dish: MenuItem): string =>
  [
    `${dish.name}｜${money(dish.price)}${dish.priceFrom ? '起（规格价格未全量采集）' : ''}`,
    dish.originalPrice !== undefined ? `原价${money(dish.originalPrice)}` : '',
    dish.monthlySales !== undefined ? `采集时月售${dish.monthlySales}` : '月售未显示',
    dish.options?.length ? `已核对口味：${dish.options.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('｜');
const addOnLines = (items: MenuItem[], title = '可加料/调料（另计价，不作为独立菜品）'): string =>
  items.length
    ? `\n  ${title}：\n${items.map((item) => `    - ${itemLine(item)}`).join('\n')}`
    : '';
const line = (dish: Dish, feedback: CanteenDishFeedback, sharedAddOns: MenuItem[] = []): string =>
  `${itemLine(dish)}｜用户偏好：${feedback.preference}${feedback.note ? `｜菜品备注：${feedback.note}` : ''}${addOnLines([...(dish.addOns ?? []), ...sharedAddOns])}`;
const header = (menu: CanteenSnapshot): string =>
  `${menu.restaurant}｜${menu.address}\n来源：${menu.source}\n采集时间：${menu.capturedAt}\n` +
  '这是保存的菜单，价格和月售以采集时信息为准；用户偏好为当前保存的评价。不支持下单，未采集的规格、份量和配料不作推断。\n';

export function createCanteenMenuServer(config: CanteenConfig = {}): McpServer {
  const server = new McpServer(
    { name: 'dut-basan-canteen', version: '1.3.0' },
    { instructions: CANTEEN_INTRO },
  );
  const file = config.menuFile ?? process.env.CANTEEN_MENU_FILE;
  const preferences = new CanteenPreferencesStore(
    config.preferencesFile ??
      process.env.CANTEEN_PREFERENCES_FILE ??
      (file ? join(dirname(file), 'preferences.json') : './data/canteen/preferences.json'),
  );
  const load = async (): Promise<CanteenSnapshot> =>
    canteenSnapshotSchema.parse(file ? JSON.parse(await readFile(file, 'utf8')) : bundledMenu);
  const run = async (
    query: (
      menu: CanteenSnapshot,
      saved: Record<string, CanteenDishFeedback>,
    ) => string | Promise<string>,
  ) => {
    try {
      const menu = await load();
      const saved = await preferences.read();
      return { content: [{ type: 'text' as const, text: await query(menu, saved) }] };
    } catch (error: unknown) {
      if (error instanceof CanteenPreferencesError) {
        return { isError: true, content: [{ type: 'text' as const, text: error.message }] };
      }
      const message =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
          ? '菜单文件不存在，请先导入菜单。'
          : '菜单无法读取或格式不正确，请检查保存的菜单。';
      return { isError: true, content: [{ type: 'text' as const, text: message }] };
    }
  };
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const categoryInput = z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('菜单中的分类名称；先查询分类总览获取名称');

  server.registerTool(
    'get_canteen_menu',
    {
      title: '查看食堂菜单',
      description:
        '查询学校食堂八三已保存的菜单。不传分类时返回分类总览和公告；传分类名返回菜品、价格、月售、用户偏好及备注。加料/调料附在对应主菜或分类下，另计价，不算独立菜品。默认未评价不代表没吃过。',
      inputSchema: { category: categoryInput },
      annotations,
    },
    async ({ category }) =>
      run((menu, saved) => {
        if (!category) {
          return (
            header(menu) +
            '\n分类（重复出现在优惠区的菜按各分类计数）：\n' +
            menu.categories
              .map((c) => {
                const additions =
                  (c.addOns?.length ?? 0) +
                  c.dishes.reduce((n, dish) => n + (dish.addOns?.length ?? 0), 0);
                return `${c.name}：${c.dishes.length}项，${c.complete ? '已读到分类末尾' : '尚未采集完整'}${c.withdrawn ? '，分类标为下架' : ''}${additions ? `；另有${additions}项加料/调料` : ''}`;
              })
              .join('\n') +
            '\n\n门店公告：\n' +
            (menu.notices.join('\n') || '未记录公告')
          );
        }
        const selected = menu.categories.find((c) => normalize(c.name) === normalize(category));
        if (!selected)
          return (
            header(menu) +
            `\n未找到分类“${category}”。可用分类：${menu.categories.map((c) => c.name).join('、')}`
          );
        return (
          header(menu) +
          `\n${selected.name}（${selected.dishes.length}项；${selected.complete ? '已采集完整' : '尚未采集完整'}${selected.withdrawn ? '；该分类标为下架' : ''}）\n` +
          (selected.dishes.map((dish) => line(dish, feedbackFor(saved, dish.name))).join('\n') ||
            '该分类没有展示菜品。') +
          addOnLines(selected.addOns ?? [], '本分类可加调料（另计价，不作为独立菜品）')
        );
      }),
  );

  server.registerTool(
    'search_canteen_dishes',
    {
      title: '按菜名和预算找菜',
      description:
        '在学校食堂八三菜单中按菜名、分类、主菜单项最高价格和用户偏好筛选，返回价格、月售、当前偏好及备注。未评价和没吃过是两个不同状态。加料/调料仅随主菜展示，不单独匹配或计数，加料另计价。重复展示合并，不同月售分别保留。起价不代表所有规格价格。',
      inputSchema: {
        keyword: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe('菜名关键词，例如鸡、虾仁、盖饭；按原菜名匹配，不推断配料'),
        category: categoryInput,
        max_price: z
          .number()
          .nonnegative()
          .optional()
          .describe('主菜单项最高价格，单位元；不含可选加料费用，起价商品按起价筛选并标注'),
        preference: z
          .enum(['未评价', '没吃过', '不喜欢', '一般', '喜欢', '很喜欢'])
          .optional()
          .describe(
            '按已保存偏好筛选；未评价包含没有记录的菜品，没吃过仅匹配明确记录为没吃过的菜品',
          ),
        sort: z.enum(['menu', 'price_asc', 'price_desc']).default('menu'),
        offset: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .describe('跳过前多少条匹配结果，用于续读'),
        limit: z.number().int().min(1).max(80).default(30).describe('本次最多返回多少条'),
      },
      annotations,
    },
    async ({ keyword, category, max_price, preference, sort, offset, limit }) =>
      run((menu, saved) => {
        const merged = new Map<
          string,
          { dish: Dish; categories: string[]; withdrawn: boolean; sharedAddOns: MenuItem[] }
        >();
        for (const group of menu.categories) {
          if (category && normalize(group.name) !== normalize(category)) continue;
          if (group.withdrawn && !category) continue;
          for (const dish of group.dishes) {
            if (preference && feedbackFor(saved, dish.name).preference !== preference) continue;
            if (keyword && !normalize(dish.name).includes(normalize(keyword))) continue;
            if (max_price !== undefined && dish.price > max_price) continue;
            const key = JSON.stringify([
              dish.name,
              dish.price,
              dish.priceFrom,
              group.withdrawn,
              dish.monthlySales,
              dish.originalPrice,
              dish.options,
              dish.addOns,
              group.addOns,
            ]);
            const existing = merged.get(key);
            if (existing) existing.categories.push(group.name);
            else
              merged.set(key, {
                dish,
                categories: [group.name],
                withdrawn: group.withdrawn,
                sharedAddOns: group.addOns ?? [],
              });
          }
        }
        const matches = [...merged.values()];
        if (sort !== 'menu')
          matches.sort((a, b) => (a.dish.price - b.dish.price) * (sort === 'price_asc' ? 1 : -1));
        const page = matches.slice(offset, offset + limit);
        const incomplete = menu.categories.filter((c) => !c.complete).map((c) => c.name);
        return (
          header(menu) +
          (incomplete.length ? `\n尚未采集完整的分类：${incomplete.join('、')}\n` : '') +
          `\n找到${matches.length}项，本次显示${page.length}项（已跳过${offset}项）。\n` +
          (page
            .map(
              ({ dish, categories, withdrawn, sharedAddOns }) =>
                `${categories.join('、')}${withdrawn ? '（下架分类）' : ''}｜${line(dish, feedbackFor(saved, dish.name), sharedAddOns)}`,
            )
            .join('\n') || '没有匹配结果；不代表门店实时无此商品。') +
          (offset + page.length < matches.length
            ? `\n还有${matches.length - offset - page.length}项；保持筛选条件，offset设为${offset + page.length}继续查询。`
            : '')
        );
      }),
  );
  server.registerTool(
    'set_canteen_dish_preference',
    {
      title: '修改菜品偏好',
      description:
        '根据用户对学校食堂八三菜品的评价保存或修改偏好。使用完整菜名，同名菜跨分类共用。可设未评价、没吃过、不喜欢、一般、喜欢、很喜欢；未评价不等于没吃过，不根据月售推测口味。加料/调料不单独评价，修改偏好保留备注。',
      inputSchema: {
        dish_name: z.string().trim().min(1).describe('菜单中已有菜品的完整名称'),
        preference: z
          .enum(['未评价', '没吃过', '不喜欢', '一般', '喜欢', '很喜欢'])
          .describe('用户对这道菜的偏好；未评价用于清除喜好评价，没吃过表示用户明确说尚未吃过'),
      },
      annotations: { ...annotations, readOnlyHint: false },
    },
    async ({ dish_name, preference }) =>
      run(async (menu) => {
        const name = normalize(dish_name);
        const dish = menu.categories
          .flatMap((group) => group.dishes)
          .find((item) => normalize(item.name) === name);
        if (!dish)
          return `未找到可独立评价的菜品“${dish_name}”，请先查询菜单并使用完整主菜名；加料/调料不单独评价，偏好未修改。`;
        const previous = await preferences.set(dish.name, preference);
        return `${dish.name}｜用户偏好：${previous} → ${preference}，已保存。同名菜品在各分类共用此偏好。`;
      }),
  );
  server.registerTool(
    'set_canteen_dish_note',
    {
      title: '修改菜品备注',
      description:
        '用户对八三菜品给出有用、值得留作以后选餐参考的评价时，可将其提炼为一句简短备注并保存，最多200字。使用菜单中的完整主菜名；更新时结合已有备注保留仍有用的信息，不把助手猜测或尚未发生的就餐计划写成体验。此工具更新整条备注，不改变偏好；传空字符串可清除备注。加料/调料不单独评价。',
      inputSchema: {
        dish_name: z.string().trim().min(1).describe('菜单中已有菜品的完整名称'),
        note: z
          .string()
          .trim()
          .max(200)
          .describe('值得以后选餐参考的用户评价，建议一句话，最多200字；空字符串表示清除'),
      },
      annotations: { ...annotations, readOnlyHint: false },
    },
    async ({ dish_name, note }) =>
      run(async (menu) => {
        const dish = menu.categories
          .flatMap((group) => group.dishes)
          .find((item) => normalize(item.name) === normalize(dish_name));
        if (!dish)
          return `未找到可独立评价的菜品“${dish_name}”，请先查询菜单并使用完整主菜名；备注未修改。`;
        const previous = await preferences.setNote(dish.name, note);
        return `${dish.name}｜原备注：${previous || '无'}｜菜品备注：${note || '已清除'}，已保存。`;
      }),
  );
  return server;
}
