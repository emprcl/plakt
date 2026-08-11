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

  /* Align now measures against one of two rectangles, and which one is the
     user's choice — see alignSel(). alignRefFor() narrows that choice to
     what the current selection can actually run, so the buttons in the
     panel and the commands behind them can never disagree. */
  test.describe('the reference', () => {
    const refOf = page => page.evaluate(() => alignRefFor());
    const boxOfId = (page, id) => page.evaluate(id => {
      const o = doc.objects.find(o => o.id === id);
      return localBox(o);
    }, id);

    test('a single object aligns against the artboard', async ({ page }) => {
      const [id1] = await threeRects(page);
      await page.evaluate(id => { sel = [id]; tab = 'selection'; panel(); }, id1);
      expect(await refOf(page)).toBe('artboard');

      await page.click('[data-align="left"]');
      expect((await boxOfId(page, id1)).x).toBeCloseTo(0, 0);

      await page.click('[data-align="right"]');
      const b = await boxOfId(page, id1), w = await page.evaluate(() => doc.w);
      expect(b.x + b.w).toBeCloseTo(w, 0);
    });

    test('CENTER on one object centres it on the page', async ({ page }) => {
      const [id1] = await threeRects(page);
      await page.evaluate(id => { sel = [id]; tab = 'selection'; panel(); }, id1);
      await page.click('[data-align="centerX"]');
      const b = await boxOfId(page, id1), w = await page.evaluate(() => doc.w);
      expect(b.x + b.w / 2).toBeCloseTo(w / 2, 0);
    });

    /* the old behaviour, and still the default: deliberately selecting
       several objects means you want them aligned to each other */
    test('a multi-selection defaults to the selection box', async ({ page }) => {
      const [id1, id2, id3] = await threeRects(page);
      await page.evaluate(ids => { sel = ids; tab = 'selection'; panel(); }, [id1, id2, id3]);
      expect(await refOf(page)).toBe('selection');
      await page.click('[data-align="left"]');
      const d = await getDoc(page);
      expect(d.objects.every(o => Math.abs(o.x - 100) < 0.5)).toBe(true);
    });

    test('switching to ARTBOARD sends the same selection to the page edge', async ({ page }) => {
      const [id1, id2, id3] = await threeRects(page);
      await page.evaluate(ids => { sel = ids; tab = 'selection'; panel(); }, [id1, id2, id3]);
      await page.click('[data-alignref="artboard"]');
      expect(await refOf(page)).toBe('artboard');

      await page.click('[data-align="left"]');
      const d = await getDoc(page);
      expect(d.objects.every(o => Math.abs(o.x) < 0.5)).toBe(true);
    });

    test('SELECTION is out of reach with one object, ARTBOARD from inside a group', async ({ page }) => {
      const [id1, id2, id3] = await threeRects(page);
      await page.evaluate(id => { sel = [id]; tab = 'selection'; panel(); }, id1);
      await expect(page.locator('[data-alignref="selection"]')).toBeDisabled();
      await expect(page.locator('[data-alignref="artboard"]')).toBeEnabled();

      await page.evaluate(ids => { sel = ids; }, [id1, id2, id3]);
      await page.keyboard.press('Meta+g');
      const gid = await page.evaluate(() => doc.objects.find(o => o.type === 'group').id);
      await page.evaluate(id => {
        entered = id; sel = doc.objects.find(o => o.id === id).children.map(c => c.id);
        tab = 'selection'; panel();
      }, gid);
      expect(await refOf(page)).toBe('selection');
      await expect(page.locator('[data-alignref="artboard"]')).toBeDisabled();
    });

    /* Escape backs out of a group without clearing the selection, so a child
       can be selected with `entered` already null — the artboard reference
       has to stay barred by parentage, not by the drilled-in flag, or a
       single child would be aligned as though its local x/y were page ones */
    test('a child selected from outside its group still cannot use ARTBOARD', async ({ page }) => {
      const [id1, id2, id3] = await threeRects(page);
      await page.evaluate(ids => { sel = ids; }, [id1, id2, id3]);
      await page.keyboard.press('Meta+g');
      await page.evaluate(id => {
        entered = null; sel = [id]; tab = 'selection'; panel();
      }, id1);

      expect(await page.evaluate(() => entered)).toBeNull();
      expect(await refOf(page)).toBe('selection');
      await expect(page.locator('[data-alignref="artboard"]')).toBeDisabled();

      const before = await page.evaluate(id =>
        doc.objects[0].children.find(c => c.id === id).x, id1);
      await page.evaluate(() => alignSel('left', 'artboard'));
      expect(await page.evaluate(id =>
        doc.objects[0].children.find(c => c.id === id).x, id1)).toBe(before);
      expect((await page.locator('#msg').textContent()).toLowerCase()).toContain('inside a group');

      // and with neither reference reachable, the directions say so
      await expect(page.locator('[data-align="left"]')).toBeDisabled();
    });

    test('the directions come back once a sibling joins the selection', async ({ page }) => {
      const [id1, id2, id3] = await threeRects(page);
      await page.evaluate(ids => { sel = ids; }, [id1, id2, id3]);
      await page.keyboard.press('Meta+g');
      await page.evaluate(ids => { entered = null; sel = ids; tab = 'selection'; panel(); }, [id1, id2]);

      expect(await refOf(page)).toBe('selection');
      await expect(page.locator('[data-align="left"]')).toBeEnabled();
      await page.click('[data-align="left"]');
      const xs = await page.evaluate(ids =>
        ids.map(id => doc.objects[0].children.find(c => c.id === id).x), [id1, id2]);
      expect(xs[0]).toBeCloseTo(xs[1], 0);
    });

    test('the align buttons are there for a single object at all', async ({ page }) => {
      const [id1] = await threeRects(page);
      await page.evaluate(id => { sel = [id]; tab = 'selection'; panel(); }, id1);
      for (const m of ['left','centerX','right','top','centerY','bottom'])
        await expect(page.locator(`[data-align="${m}"]`)).toHaveCount(1);
    });

    test('aligning is undoable', async ({ page }) => {
      const [id1] = await threeRects(page);
      await page.evaluate(id => { sel = [id]; tab = 'selection'; panel(); }, id1);
      await page.click('[data-align="left"]');
      expect((await boxOfId(page, id1)).x).toBeCloseTo(0, 0);
      await page.keyboard.press('Control+z');
      expect((await boxOfId(page, id1)).x).toBeCloseTo(100, 0);
    });
  });
});
