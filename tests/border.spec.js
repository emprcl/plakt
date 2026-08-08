const { test, expect } = require('@playwright/test');
const { openApp, getDoc } = require('./helpers');

test.describe('shape borders', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('a fresh shape has no border section state until BORDER is switched on', async ({ page }) => {
    await page.keyboard.press('r');
    expect(await page.locator('#borderOn').count()).toBe(1);
    expect(await page.locator('#panel .sw[data-strokeslot]').count()).toBe(0);
    expect(await page.locator(`[data-id="${await page.evaluate(() => sel[0])}"]`).getAttribute('stroke')).toBeNull();
  });

  test('turning a border on/off/on again preserves the last colour and weight', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    const el = page.locator(`[data-id="${id}"]`);

    await page.click('#borderOn');
    let o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.stroke).toBeTruthy();
    expect(o.sw).toBe(2);
    expect(await el.getAttribute('stroke-width')).toBe('2');

    await page.click('#panel .sw[data-strokeslot="BLU"]');
    const weightInput = page.locator('#panel input[data-k="sw"]');
    await weightInput.fill('6');
    await weightInput.dispatchEvent('change');
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.stroke).toBe('BLU');
    expect(o.sw).toBe(6);
    expect(await el.getAttribute('stroke-width')).toBe('6');

    await page.click('#borderOff');
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.stroke).toBeUndefined();
    expect(await el.getAttribute('stroke')).toBeNull();

    await page.click('#borderOn');
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.stroke).toBe('BLU');
    expect(o.sw).toBe(6);
  });

  test('a swatch used only as a border cannot be deleted, and renaming updates the border', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    await page.click('#borderOn');
    await page.click('#panel .sw[data-strokeslot="YEL"]');

    await page.evaluate(() => { tab = 'artboard'; panel(); });
    await page.click('#panel .swx[data-del="YEL"]');
    expect((await getDoc(page)).palette.some(p => p.id === 'YEL')).toBe(true);

    const renameInput = page.locator('#panel input[data-ren="YEL"]');
    await renameInput.fill('SUN');
    await renameInput.dispatchEvent('change');
    const o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.stroke).toBe('SUN');
  });

  test('a bordered shape keeps a correctly-scaled border after group resize + ungroup', async ({ page }) => {
    await page.keyboard.press('r');
    const id1 = await page.evaluate(() => sel[0]);
    await page.click('#borderOn');
    await page.evaluate(id => { const o = doc.objects.find(o => o.id === id); o.sw = 4; touch(); }, id1);
    await page.keyboard.press('c');
    const id2 = await page.evaluate(() => sel[0]);
    await page.evaluate(id => { const o = doc.objects.find(o => o.id === id); o.x += 500; o.y += 500; touch(); }, id2);

    await page.evaluate(({ id1, id2 }) => { sel = [id1, id2]; }, { id1, id2 });
    await page.keyboard.press('Meta+g');
    const group = (await getDoc(page)).objects.find(o => o.type === 'group');

    await page.evaluate(id => { sel = [id]; tab = 'selection'; panel(); }, group.id);
    const wInput = page.locator('#panel input[data-k="w"]');
    const beforeW = (await getDoc(page)).objects.find(o => o.id === group.id).w;
    await wInput.fill(String(Math.round(beforeW * 3)));
    await wInput.dispatchEvent('change');

    await page.keyboard.press('Shift+Meta+g');
    const rectAfter = (await getDoc(page)).objects.find(o => o.id === id1);
    expect(rectAfter.sw).toBeCloseTo(12, 0);
    expect(rectAfter.stroke).toBeTruthy();
  });
});
