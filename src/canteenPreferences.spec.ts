import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanteenPreferencesStore } from './canteenPreferences';

test('独立实例同时修改偏好和备注时保留全部字段及其他菜品', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canteen-feedback-'));
  try {
    const file = join(dir, 'preferences.json');
    await new CanteenPreferencesStore(file).set('其他菜', '很喜欢');
    await Promise.all(
      Array.from({ length: 12 }, (_, index) => [
        new CanteenPreferencesStore(file).set('菜' + index, '一般'),
        new CanteenPreferencesStore(file).setNote('菜' + index, '备注' + index),
      ]).flat(),
    );
    const saved = await new CanteenPreferencesStore(file).read();
    expect(Object.keys(saved)).toHaveLength(13);
    expect(saved['其他菜'].preference).toBe('很喜欢');
    for (let index = 0; index < 12; index++) {
      expect(saved['菜' + index]).toEqual({ preference: '一般', note: '备注' + index });
    }
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(saved);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
