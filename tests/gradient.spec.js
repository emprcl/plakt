const { test, expect } = require('@playwright/test');
const { openApp, getDoc } = require('./helpers');

test.describe('gradient fills', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('switching an object to gradient renders a linearGradient and updates on angle/stop changes', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);

    await page.click('#fillGrad');
    let o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.fill.startsWith('grad:')).toBe(true);

    const fillAttr = await page.locator(`[data-id="${id}"]`).getAttribute('fill');
    expect(fillAttr.startsWith('url(#grad')).toBe(true);
    expect(await page.locator('#doc-svg defs linearGradient stop').count()).toBe(2);

    const angleInput = page.locator('#panel input[data-k="gang"]');
    await angleInput.fill('45');
    await angleInput.dispatchEvent('change');
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.fill.split(':')[1]).toBe('45');

    await page.click('#panel .sw[data-gradb="BLU"]');
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.fill.split(':')[3]).toBe('BLU');

    // switching back to solid resolves to the gradient's FROM stop, not the raw grad string
    await page.click('#fillSolid');
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.fill.startsWith('grad:')).toBe(false);
    expect(o.fill).toBe('INK');
  });

  test('re-clicking GRADIENT does not reset its params, and SOLID→GRADIENT restores the last config', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);

    await page.click('#fillGrad');
    const angleInput = page.locator('#panel input[data-k="gang"]');
    await angleInput.fill('222');
    await angleInput.dispatchEvent('change');
    await page.click('#panel .sw[data-gradb="YEL"]');
    let o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.fill).toBe('grad:222:INK:YEL:0:100');

    await page.click('#fillGrad'); // already gradient — must be a no-op
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.fill).toBe('grad:222:INK:YEL:0:100');

    await page.click('#fillSolid');
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.fill).toBe('INK');

    await page.click('#fillGrad'); // should restore, not regenerate from scratch
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.fill).toBe('grad:222:INK:YEL:0:100');
  });

  test('offset and length control where along the gradient line the blend happens', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    await page.click('#fillGrad');

    const offInput = page.locator('#panel input[data-k="goff"]');
    await offInput.fill('30');
    await offInput.dispatchEvent('change');
    const lenInput = page.locator('#panel input[data-k="glen"]');
    await lenInput.fill('20');
    await lenInput.dispatchEvent('change');

    let o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.fill).toBe('grad:90:INK:BG:30:20');

    const stops = await page.locator('#doc-svg defs linearGradient stop').all();
    const offsets = await Promise.all(stops.map(s => s.getAttribute('offset')));
    expect(offsets).toEqual(['0.3', '0.5']);

    // changing the angle afterwards must not reset offset/length
    const angleInput = page.locator('#panel input[data-k="gang"]');
    await angleInput.fill('10');
    await angleInput.dispatchEvent('change');
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.fill).toBe('grad:10:INK:BG:30:20');
  });

  test('renaming a swatch updates a gradient that references it as either stop', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    await page.click('#fillGrad');
    const before = (await getDoc(page)).objects.find(o => o.id === id).fill; // grad:90:INK:BG
    const fromId = before.split(':')[2];

    await page.evaluate(() => { tab = 'artboard'; panel(); });
    const renameInput = page.locator(`#panel input[data-ren="${fromId}"]`);
    await renameInput.fill('ZZZ');
    await renameInput.dispatchEvent('change');

    const after = (await getDoc(page)).objects.find(o => o.id === id).fill;
    expect(after).toBe('grad:90:ZZZ:BG:0:100');
  });

  test('a swatch used only as a gradient stop cannot be deleted', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    await page.click('#fillGrad');
    const stopB = (await getDoc(page)).objects.find(o => o.id === id).fill.split(':')[3]; // 'BG'

    await page.evaluate(() => { tab = 'artboard'; panel(); });
    await page.click(`#panel .swx[data-del="${stopB}"]`);
    const doc = await getDoc(page);
    expect(doc.palette.some(p => p.id === stopB)).toBe(true);
  });

  test('clipData carries both of a gradient\'s stop swatches', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    await page.click('#fillGrad');
    const [, , a, b] = (await getDoc(page)).objects.find(o => o.id === id).fill.split(':');

    const clip = await page.evaluate(id => clipData([doc.objects.find(o => o.id === id)]), id);
    const ids = clip.palette.map(p => p.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });
});
