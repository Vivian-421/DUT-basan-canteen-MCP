import { mkdir, readFile, rename, writeFile, rmdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname } from 'node:path';
import { z } from 'zod/v4';

export type CanteenPreference = '未评价' | '没吃过' | '不喜欢' | '一般' | '喜欢' | '很喜欢';
export type CanteenDishFeedback = { preference: CanteenPreference; note: string };
export const normalizeCanteenDishName = (value: string): string =>
  value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

const preferenceSchema = z.enum(['未评价', '没吃过', '不喜欢', '一般', '喜欢', '很喜欢']);
const legacyPreferenceSchema = preferenceSchema.or(z.literal('未评价/没吃过'));
const feedbackSchema = z.object({
  preference: legacyPreferenceSchema.default('未评价'),
  note: z.string().max(200).default(''),
});
const savedSchema = z.record(z.string(), z.union([legacyPreferenceSchema, feedbackSchema]));

export class CanteenPreferencesError extends Error {}

export class CanteenPreferencesStore {
  constructor(private readonly file: string) {}

  async read(): Promise<Record<string, CanteenDishFeedback>> {
    try {
      const stored = savedSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
      const saved: Record<string, CanteenDishFeedback> = {};
      for (const [name, entry] of Object.entries(stored)) {
        const value = typeof entry === 'string' ? { preference: entry, note: '' } : entry;
        saved[name] = {
          preference: value.preference === '未评价/没吃过' ? '未评价' : value.preference,
          note: value.note,
        };
      }
      return saved;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return {};
      }
      throw new CanteenPreferencesError('菜品偏好文件无法读取或格式不正确，请检查保存的偏好。');
    }
  }

  async set(name: string, preference: CanteenPreference): Promise<CanteenPreference> {
    return this.update(name, { preference }).then((previous) => previous.preference);
  }

  async setNote(name: string, note: string): Promise<string> {
    return this.update(name, { note }).then((previous) => previous.note);
  }

  private async update(
    name: string,
    patch: Partial<CanteenDishFeedback>,
  ): Promise<CanteenDishFeedback> {
    await mkdir(dirname(this.file), { recursive: true });
    const lock = this.file + '.lock';
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 'EEXIST' ||
          Date.now() >= deadline
        ) {
          throw new CanteenPreferencesError('菜品偏好正在保存或持久目录不可用，请稍后重试。');
        }
        await delay(20);
      }
    }
    try {
      const saved = await this.read();
      const key = normalizeCanteenDishName(name);
      const previous = saved[key] ?? { preference: '未评价' as const, note: '' };
      saved[key] = { ...previous, ...patch };
      await this.save(saved);
      return previous;
    } finally {
      await rmdir(lock);
    }
  }

  private async save(saved: Record<string, CanteenDishFeedback>): Promise<void> {
    for (const [name, value] of Object.entries(saved)) {
      if (value.preference === '未评价' && !value.note) delete saved[name];
    }
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file + '.tmp', JSON.stringify(savedSchema.parse(saved), null, 2) + '\n');
      await rename(this.file + '.tmp', this.file);
    } catch {
      throw new CanteenPreferencesError('菜品偏好保存失败，请检查偏好文件的持久目录。');
    }
  }
}
