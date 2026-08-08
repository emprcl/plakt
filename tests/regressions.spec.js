const { test, expect } = require('@playwright/test');
const { openApp, addShape } = require('./helpers');

/* Each test here pins down a bug that actually shipped and got fixed in
   this repo's history -- they exist to keep it fixed, not to explore new
   ground. */

test.describe('regression: font-family attribute quoting', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('a fresh text object gets a well-formed font-family attribute', async ({ page }) => {
    const id = await addShape(page, 't');
    // cssFont() wraps the family in literal double quotes for the CSS
    // value; embedding that unescaped inside the SVG's own double-quoted
    // attribute used to truncate font-family to "" for every text object
    const fam = await page.locator(`[data-id="${id}"]`).getAttribute('font-family');
    expect(fam).toBe('"Poppins", sans-serif');
  });

  test('clicking a different font in the panel actually changes it on the artboard', async ({ page }) => {
    const id = await addShape(page, 't');
    await page.locator('#panel .f[data-font="Lora"]').click();
    const fam = await page.locator(`[data-id="${id}"]`).getAttribute('font-family');
    expect(fam).toBe('"Lora", sans-serif');
  });
});

test.describe('regression: blank lines inside a text object', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('an empty line between two lines still renders as its own tspan', async ({ page }) => {
    const id = await addShape(page, 't');
    await page.locator('#tstr').fill('first\n\nthird');
    const tspans = page.locator(`[data-id="${id}"] tspan`);
    await expect(tspans).toHaveCount(3);
    // an empty <tspan> silently drops its dy in some browsers, collapsing
    // the blank line -- it must carry a non-breaking space, not be empty
    const middle = await tspans.nth(1).textContent();
    expect(middle).toBe(' ');
    expect(middle.length).toBeGreaterThan(0);
  });
});

test.describe('regression: text selection box grows to fit overflowing text', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('a word wider than the text box grows the selection/hit box instead of staying clamped to o.w', async ({ page }) => {
    const id = await addShape(page, 't');
    await page.evaluate(id => { const o = doc.objects.find(o => o.id === id); o.size = 20; o.str = 'hi'; o.w = 300; touch(); }, id);
    const fitBox = await page.evaluate(id => localBox(doc.objects.find(o => o.id === id)), id);
    expect(fitBox.w).toBeCloseTo(300, 0);

    await page.evaluate(id => { const o = doc.objects.find(o => o.id === id); o.str = 'SUPERCALIFRAGILISTICEXPIALIDOCIOUS'; touch(); }, id);
    const overflowBox = await page.evaluate(id => localBox(doc.objects.find(o => o.id === id)), id);
    expect(overflowBox.w).toBeGreaterThan(300);
  });

  test('overflow grows the box in the correct direction for every alignment', async ({ page }) => {
    const id = await addShape(page, 't');
    await page.evaluate(id => { const o = doc.objects.find(o => o.id === id); o.str = 'SUPERCALIFRAGILISTIC'; touch(); }, id);
    const textEl = page.locator(`[data-id="${id}"]`);

    for (const al of ['l', 'c', 'r']) {
      await page.evaluate(({ id, al }) => { const o = doc.objects.find(o => o.id === id); o.al = al; touch(); }, { id, al });
      const tb = await textEl.boundingBox();
      const sb = await page.locator('#handles .sel-o').boundingBox();
      expect(sb.x).toBeLessThanOrEqual(tb.x + 1);
      expect(sb.x + sb.width).toBeGreaterThanOrEqual(tb.x + tb.width - 1);
    }
  });
});

test.describe('regression: snapping follows a rotated shape\'s real corners', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('an upright box only needs its edge/centre offsets', async ({ page }) => {
    const off = await page.evaluate(() =>
      snapOffsets({ type: 'rect', x: 0, y: 0, w: 100, h: 100, rot: 0 }, 100, 100));
    expect(off.vx).toEqual([0, 50, 100]);
    expect(off.hy).toEqual([0, 50, 100]);
  });

  test('a 45deg-rotated box snaps on its actual rotated corners, not its unrotated bounds', async ({ page }) => {
    const off = await page.evaluate(() =>
      snapOffsets({ type: 'rect', x: 0, y: 0, w: 100, h: 100, rot: 45 }, 100, 100));
    const k = 50 * Math.SQRT2;               // 100x100 box, half-diagonal from centre
    // corners in nw, ne, se, sw, centre order (see marks()/groupBoxOf callers)
    expect(off.vx[0]).toBeCloseTo(50, 4);
    expect(off.vx[1]).toBeCloseTo(50 + k, 4);
    expect(off.vx[2]).toBeCloseTo(50, 4);
    expect(off.vx[3]).toBeCloseTo(50 - k, 4);
    expect(off.hy[0]).toBeCloseTo(50 - k, 4);
    expect(off.hy[1]).toBeCloseTo(50, 4);
    expect(off.hy[2]).toBeCloseTo(50 + k, 4);
    expect(off.hy[3]).toBeCloseTo(50, 4);
  });
});
