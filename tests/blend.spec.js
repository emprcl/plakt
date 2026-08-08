const { test, expect } = require('@playwright/test');
const { openApp, getDoc } = require('./helpers');

test.describe('group blend mode', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('the BLEND dropdown only appears for groups', async ({ page }) => {
    await page.keyboard.press('r');
    expect(await page.locator('#panel select[data-blend]').count()).toBe(0);
  });

  test('setting a blend mode applies mix-blend-mode + isolation; NORMAL clears it', async ({ page }) => {
    await page.keyboard.press('r');
    const id1 = await page.evaluate(() => sel[0]);
    await page.keyboard.press('c');
    const id2 = await page.evaluate(() => sel[0]);
    await page.evaluate(({ id1, id2 }) => { sel = [id1, id2]; }, { id1, id2 });
    await page.keyboard.press('Meta+g');
    const group = (await getDoc(page)).objects.find(o => o.type === 'group');

    await page.evaluate(id => { sel = [id]; tab = 'selection'; panel(); }, group.id);
    const el = page.locator(`[data-id="${group.id}"]`);
    expect(await el.getAttribute('style')).toBeNull();

    const blendSel = page.locator('#panel select[data-blend]');
    await blendSel.selectOption('multiply');
    const o = (await getDoc(page)).objects.find(o => o.id === group.id);
    expect(o.blend).toBe('multiply');
    const style = await el.getAttribute('style');
    expect(style).toContain('mix-blend-mode:multiply');
    expect(style).toContain('isolation:isolate');

    await blendSel.selectOption('normal');
    expect((await getDoc(page)).objects.find(o => o.id === group.id).blend).toBe('normal');
    expect(await el.getAttribute('style')).toBeNull();
  });

  test('multiply blend visibly changes the rendered overlap pixels vs normal', async ({ page }) => {
    await page.keyboard.press('r');
    const id1 = await page.evaluate(() => sel[0]);
    await page.evaluate(id => {
      const o = doc.objects.find(o => o.id === id);
      o.x = 100; o.y = 100; o.w = 300; o.h = 300; o.fill = 'RED'; touch();
    }, id1);
    await page.keyboard.press('r');
    const id2 = await page.evaluate(() => sel[0]);
    await page.evaluate(id => {
      const o = doc.objects.find(o => o.id === id);
      o.x = 250; o.y = 100; o.w = 300; o.h = 300; o.fill = 'BLU'; touch();
    }, id2);

    await page.evaluate(({ id1, id2 }) => { sel = [id1, id2]; }, { id1, id2 });
    await page.keyboard.press('Meta+g');
    const group = (await getDoc(page)).objects.find(o => o.type === 'group');

    const pt = await page.evaluate(() => {
      const svg = document.getElementById('doc-svg');
      const p = svg.createSVGPoint(); p.x = 270; p.y = 150;
      const s = p.matrixTransform(svg.getScreenCTM());
      return { x: s.x, y: s.y };
    });
    const before = await page.screenshot({ clip: { x: pt.x - 1, y: pt.y - 1, width: 2, height: 2 } });

    await page.evaluate(id => { sel = [id]; tab = 'selection'; panel(); }, group.id);
    await page.locator('#panel select[data-blend]').selectOption('multiply');

    const after = await page.screenshot({ clip: { x: pt.x - 1, y: pt.y - 1, width: 2, height: 2 } });
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('ungrouping drops the blend property along with the group itself', async ({ page }) => {
    await page.keyboard.press('r');
    const id1 = await page.evaluate(() => sel[0]);
    await page.keyboard.press('c');
    const id2 = await page.evaluate(() => sel[0]);
    await page.evaluate(({ id1, id2 }) => { sel = [id1, id2]; }, { id1, id2 });
    await page.keyboard.press('Meta+g');
    const group = (await getDoc(page)).objects.find(o => o.type === 'group');
    await page.evaluate(id => { doc.objects.find(o => o.id === id).blend = 'screen'; touch(); }, group.id);

    await page.keyboard.press('Shift+Meta+g');
    const after = await getDoc(page);
    expect(after.objects.every(o => o.type !== 'group')).toBe(true);
  });
});
