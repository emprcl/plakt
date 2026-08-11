const { test, expect } = require('@playwright/test');
const { openApp, getDoc } = require('./helpers');

test.describe('opacity, corner radius, dash pattern, and layer reordering', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('opacity field renders an SVG opacity attribute and round-trips', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    const el = page.locator(`[data-id="${id}"]`);
    expect(await el.getAttribute('opacity')).toBeNull(); // default 100% omits the attr

    const opInput = page.locator('#panel input[data-k="op"]');
    await opInput.fill('40');
    await opInput.dispatchEvent('change');
    const o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.op).toBe(40);
    expect(await el.getAttribute('opacity')).toBe('0.4');
  });

  test('corner radius only appears for rect and renders rx', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    expect(await page.locator('#panel input[data-k="rx"]').count()).toBe(1);

    const rxInput = page.locator('#panel input[data-k="rx"]');
    await rxInput.fill('25');
    await rxInput.dispatchEvent('change');
    const o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.rx).toBe(25);
    expect(await page.locator(`[data-id="${id}"]`).getAttribute('rx')).toBe('25');

    await page.keyboard.press('c'); // ellipse has no radius field
    expect(await page.locator('#panel input[data-k="rx"]').count()).toBe(0);
  });

  test('dash pattern toggles SOLID/DASHED/DOTTED for a line and a bordered shape', async ({ page }) => {
    await page.keyboard.press('l');
    const lineId = await page.evaluate(() => sel[0]);
    const lineEl = page.locator(`[data-id="${lineId}"]`);
    expect(await lineEl.getAttribute('stroke-dasharray')).toBeNull();
    await page.click('[data-dash="dashed"]');
    let o = (await getDoc(page)).objects.find(o => o.id === lineId);
    expect(o.dash).toBe('dashed');
    expect(await lineEl.getAttribute('stroke-dasharray')).toBeTruthy();

    await page.keyboard.press('r');
    const rectId = await page.evaluate(() => sel[0]);
    await page.click('#borderOn');
    await page.click('[data-dash="dotted"]');
    o = (await getDoc(page)).objects.find(o => o.id === rectId);
    expect(o.dash).toBe('dotted');
    expect(await page.locator(`[data-id="${rectId}"]`).getAttribute('stroke-dasharray')).toBeTruthy();

    await page.click('[data-dash=""]');
    o = (await getDoc(page)).objects.find(o => o.id === rectId);
    expect(o.dash).toBeFalsy();
  });

  test('dragging a layer row reorders the stack', async ({ page }) => {
    await page.keyboard.press('r');
    const id1 = await page.evaluate(() => sel[0]);
    await page.keyboard.press('c');
    const id2 = await page.evaluate(() => sel[0]);
    await page.keyboard.press('h');
    const id3 = await page.evaluate(() => sel[0]);

    await page.evaluate(() => { tab = 'layers'; panel(); });
    const before = (await getDoc(page)).objects.map(o => o.id);

    await page.locator(`.ly[data-pick="${id1}"]`).dragTo(page.locator(`.ly[data-pick="${id3}"]`));

    const after = (await getDoc(page)).objects.map(o => o.id);
    expect(after).not.toEqual(before);
    expect(after).toContain(id1);
    expect(after).toContain(id2);
    expect(after).toContain(id3);
  });

  /* this used to be a no-op — a cross-list drag was refused outright. It's a
     membership move now (see group-membership.spec.js for the coordinate
     side); what's checked here is that the row drag routes it that way. */
  test('dragging a top-level row onto a group child row moves it into the group', async ({ page }) => {
    await page.keyboard.press('r');
    const id1 = await page.evaluate(() => sel[0]);
    await page.keyboard.press('c');
    const id2 = await page.evaluate(() => sel[0]);
    await page.evaluate(({ id1, id2 }) => { sel = [id1, id2]; }, { id1, id2 });
    await page.keyboard.press('Meta+g');
    const group = (await getDoc(page)).objects.find(o => o.type === 'group');
    await page.keyboard.press('h');
    const id3 = await page.evaluate(() => sel[0]);

    await page.evaluate(() => { tab = 'layers'; panel(); });

    await page.locator(`.ly[data-pick="${id3}"]`).dragTo(page.locator(`.ly[data-pick="${id1}"]`));

    const after = await getDoc(page);
    expect(after.objects.map(o => o.id)).toEqual([group.id]);   // absorbed, nothing left loose
    const kids = after.objects[0].children.map(c => c.id);
    expect(kids).toContain(id3);
    expect(kids).toEqual(expect.arrayContaining([id1, id2, id3]));
  });

  test('a bordered rect keeps a proportionally-scaled corner radius after group resize + ungroup', async ({ page }) => {
    await page.keyboard.press('r');
    const id1 = await page.evaluate(() => sel[0]);
    await page.evaluate(id => {
      const o = doc.objects.find(o => o.id === id);
      o.rx = 10; touch();
    }, id1);
    await page.keyboard.press('c');
    const id2 = await page.evaluate(() => sel[0]);
    await page.evaluate(id => { const o = doc.objects.find(o => o.id === id); o.x += 500; o.y += 500; touch(); }, id2);

    await page.evaluate(({ id1, id2 }) => { sel = [id1, id2]; }, { id1, id2 });
    await page.keyboard.press('Meta+g');
    const group = (await getDoc(page)).objects.find(o => o.type === 'group');

    await page.evaluate(id => { sel = [id]; tab = 'selection'; panel(); }, group.id);
    const wInput = page.locator('#panel input[data-k="w"]');
    const beforeW = (await getDoc(page)).objects.find(o => o.id === group.id).w;
    await wInput.fill(String(Math.round(beforeW * 2)));
    await wInput.dispatchEvent('change');

    await page.keyboard.press('Shift+Meta+g');
    const rectAfter = (await getDoc(page)).objects.find(o => o.id === id1);
    expect(rectAfter.rx).toBeCloseTo(20, 0);
  });
});
