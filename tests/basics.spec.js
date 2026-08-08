const { test, expect } = require('@playwright/test');
const { openApp, getDoc, getSel, addShape } = require('./helpers');

test.describe('drawing, deleting, undo/redo', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('starts with an empty artboard', async ({ page }) => {
    const doc = await getDoc(page);
    expect(doc.objects).toHaveLength(0);
  });

  for (const [key, type] of [['r', 'rect'], ['c', 'ellipse'], ['h', 'half'], ['t', 'text']]) {
    test(`draws a ${type} with the "${key}" shortcut`, async ({ page }) => {
      const id = await addShape(page, key);
      const doc = await getDoc(page);
      expect(doc.objects).toHaveLength(1);
      expect(doc.objects[0].type).toBe(type);
      expect(await getSel(page)).toEqual([id]);
      await expect(page.locator(`[data-id="${id}"]`)).toBeVisible();
    });
  }

  test('deletes the selected object', async ({ page }) => {
    await addShape(page, 'r');
    await page.keyboard.press('Backspace');
    expect((await getDoc(page)).objects).toHaveLength(0);
    expect(await getSel(page)).toEqual([]);
  });

  test('duplicates the selected object with an offset', async ({ page }) => {
    const id = await addShape(page, 'r');
    const before = (await getDoc(page)).objects[0];
    await page.keyboard.press('Control+d');
    const objs = (await getDoc(page)).objects;
    expect(objs).toHaveLength(2);
    const dup = objs.find(o => o.id !== id);
    expect(dup.x).not.toBe(before.x);
  });

  test('undo removes the last drawn shape, redo brings it back', async ({ page }) => {
    await addShape(page, 'r');
    expect((await getDoc(page)).objects).toHaveLength(1);
    await page.keyboard.press('Control+z');
    expect((await getDoc(page)).objects).toHaveLength(0);
    await page.keyboard.press('Control+Shift+z');
    expect((await getDoc(page)).objects).toHaveLength(1);
  });
});
