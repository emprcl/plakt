const { test, expect } = require('@playwright/test');
const { openApp, getDoc } = require('./helpers');

async function threeRects(page) {
  const ids = [];
  const specs = [[100,100,200,150],[500,400,80,80],[900,50,300,300]];
  for (const [x,y,w,h] of specs) {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    await page.evaluate(({ id, x, y, w, h }) => {
      const o = doc.objects.find(o => o.id === id);
      o.x = x; o.y = y; o.w = w; o.h = h; touch();
    }, { id, x, y, w, h });
    ids.push(id);
  }
  return ids;
}

test.describe('align and distribute', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('aligns left and middle across three differently-sized rects', async ({ page }) => {
    const [id1, id2, id3] = await threeRects(page);
    await page.evaluate(ids => { sel = ids; tab = 'selection'; panel(); }, [id1, id2, id3]);

    await page.click('[data-align="left"]');
    let d = await getDoc(page);
    const get = id => d.objects.find(o => o.id === id);
    const minX = 100;
    expect(get(id1).x).toBeCloseTo(minX, 0);
    expect(get(id2).x).toBeCloseTo(minX, 0);
    expect(get(id3).x).toBeCloseTo(minX, 0);

    await page.click('[data-align="centerY"]');
    d = await getDoc(page);
    const cy1 = get(id1).y + get(id1).h/2, cy2 = get(id2).y + get(id2).h/2, cy3 = get(id3).y + get(id3).h/2;
    expect(cy1).toBeCloseTo(cy2, 0);
    expect(cy2).toBeCloseTo(cy3, 0);
  });

  test('distribute horizontal equalises gaps and keeps the first/last object fixed', async ({ page }) => {
    const [id1, id2, id3] = await threeRects(page);
    await page.evaluate(ids => { sel = ids; tab = 'selection'; panel(); }, [id1, id2, id3]);
    await page.click('#distX');

    const d = await getDoc(page);
    const get = id => d.objects.find(o => o.id === id);
    const [a, b, c] = [get(id1), get(id2), get(id3)];
    expect(a.x).toBeCloseTo(100, 0);
    expect(c.x).toBeCloseTo(900, 0);
    const gap1 = b.x - (a.x + a.w), gap2 = c.x - (b.x + b.w);
    expect(gap1).toBeCloseTo(gap2, 0);
  });

  test('align/distribute flash instead of erroring when the selection is too small', async ({ page }) => {
    await page.keyboard.press('r');
    const id1 = await page.evaluate(() => sel[0]);
    await page.keyboard.press('c');
    const id2 = await page.evaluate(() => sel[0]);
    await page.evaluate(({ id1, id2 }) => { sel = [id1, id2]; tab = 'selection'; panel(); }, { id1, id2 });
    await page.click('#distX');
    expect((await page.locator('#msg').textContent()).toLowerCase()).toContain('select at least 3');
  });

  test('aligning children inside a rotated group operates in the group\'s own local frame', async ({ page }) => {
    const [id1, id2, id3] = await threeRects(page);
    await page.evaluate(ids => { sel = ids; }, [id1, id2, id3]);
    await page.keyboard.press('Meta+g');
    const group = (await getDoc(page)).objects.find(o => o.type === 'group');
    await page.evaluate(id => { doc.objects.find(o => o.id === id).rot = 25; touch(); }, group.id);

    await page.evaluate(id => {
      entered = id; sel = doc.objects.find(o => o.id === id).children.map(c => c.id);
      tab = 'selection'; panel();
    }, group.id);
    await page.click('[data-align="top"]');

    const g = (await getDoc(page)).objects.find(o => o.id === group.id);
    const ys = g.children.map(c => c.y);
    expect(ys[0]).toBeCloseTo(ys[1], 0);
    expect(ys[1]).toBeCloseTo(ys[2], 0);
  });
});
