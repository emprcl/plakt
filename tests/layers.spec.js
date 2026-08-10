const { test, expect } = require('@playwright/test');
const { openApp, getDoc, getSel, addShape } = require('./helpers');

const tabOf = page => page.evaluate(() => tab);
const hiddenOf = (page, id) => page.evaluate(id =>
  !!doc.objects.find(o => o.id === id).hidden, id);

test.describe('layers tab', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.clear());
  });

  const openLayers = page => page.evaluate(() => { tab = 'layers'; panel(); });

  /* picking down through a stack used to throw you into the object's own
     tab on every click, so you had to go back to Layers to try the next
     one. Selecting and inspecting are separate gestures now. */
  test('a single click selects without leaving the layers list', async ({ page }) => {
    const a = await addShape(page, 'r');
    const b = await addShape(page, 'c');
    await openLayers(page);

    await page.locator(`.ly[data-pick="${a}"]`).click();
    expect(await getSel(page)).toEqual([a]);
    expect(await tabOf(page)).toBe('layers');

    await page.locator(`.ly[data-pick="${b}"]`).click();
    expect(await getSel(page)).toEqual([b]);
    expect(await tabOf(page)).toBe('layers');       // still browsing
  });

  test('a double click opens the object', async ({ page }) => {
    const id = await addShape(page, 'r');
    await openLayers(page);
    await page.locator(`.ly[data-pick="${id}"]`).dblclick();
    expect(await getSel(page)).toEqual([id]);
    expect(await tabOf(page)).toBe('selection');
  });

  test('⇧ click still extends the selection and stays put', async ({ page }) => {
    const a = await addShape(page, 'r');
    const b = await addShape(page, 'c');
    await openLayers(page);
    await page.locator(`.ly[data-pick="${a}"]`).click();
    await page.locator(`.ly[data-pick="${b}"]`).click({ modifiers: ['Shift'] });
    expect((await getSel(page)).sort()).toEqual([a, b].sort());
    expect(await tabOf(page)).toBe('layers');
  });

  test.describe('hiding a layer', () => {
    test('HIDE takes it out of the render but leaves it in the document', async ({ page }) => {
      const id = await addShape(page, 'r');
      await openLayers(page);

      await page.locator(`.ly[data-pick="${id}"] [data-vis]`).click();

      expect(await hiddenOf(page, id)).toBe(true);
      expect(await page.locator(`#doc-svg [data-id="${id}"]`).count()).toBe(0);
      expect((await getDoc(page)).objects).toHaveLength(1);   // still in the stack
      await expect(page.locator(`.ly[data-pick="${id}"]`)).toHaveClass(/off/);
      await expect(page.locator(`.ly[data-pick="${id}"] [data-vis]`)).toHaveText('SHOW');
    });

    test('toggling it back restores it', async ({ page }) => {
      const id = await addShape(page, 'r');
      await openLayers(page);
      await page.locator(`.ly[data-pick="${id}"] [data-vis]`).click();
      await page.locator(`.ly[data-pick="${id}"] [data-vis]`).click();

      expect(await hiddenOf(page, id)).toBe(false);
      expect(await page.locator(`#doc-svg [data-id="${id}"]`).count()).toBe(1);
    });

    test('hiding drops it from the selection, so no handles float over nothing', async ({ page }) => {
      const id = await addShape(page, 'r');
      await openLayers(page);
      await page.locator(`.ly[data-pick="${id}"]`).click();
      expect(await getSel(page)).toEqual([id]);

      await page.locator(`.ly[data-pick="${id}"] [data-vis]`).click();
      expect(await getSel(page)).toEqual([]);
      expect(await page.locator('.hd').count()).toBe(0);
    });

    test('a hidden object is selectable from the list but draws no handles', async ({ page }) => {
      const id = await addShape(page, 'r');
      await openLayers(page);
      await page.locator(`.ly[data-pick="${id}"] [data-vis]`).click();

      await page.locator(`.ly[data-pick="${id}"]`).click();
      expect(await getSel(page)).toEqual([id]);      // reachable, so you can still unhide/inspect it
      expect(await page.locator('.hd').count()).toBe(0);
      expect(await page.locator('.sel-o').count()).toBe(0);
    });

    test('a hidden object cannot be caught by a marquee', async ({ page }) => {
      const id = await addShape(page, 'r');
      await openLayers(page);
      await page.locator(`.ly[data-pick="${id}"] [data-vis]`).click();

      const board = await page.locator('#board').boundingBox();
      await page.mouse.move(board.x + 4, board.y + 4);
      await page.mouse.down();
      await page.mouse.move(board.x + board.width - 4, board.y + board.height - 4, { steps: 8 });
      await page.mouse.up();
      expect(await getSel(page)).toEqual([]);
    });

    test('hidden layers are left out of the SVG export', async ({ page }) => {
      await addShape(page, 'r');
      const id = await addShape(page, 'c');
      await openLayers(page);
      await page.locator(`.ly[data-pick="${id}"] [data-vis]`).click();

      const svg = await page.evaluate(() => standaloneSVG());
      expect(svg).not.toContain('<ellipse');
      expect(svg).toContain('<rect');                // the visible one is still there
    });

    test('hiding is undoable', async ({ page }) => {
      const id = await addShape(page, 'r');
      await openLayers(page);
      await page.locator(`.ly[data-pick="${id}"] [data-vis]`).click();
      await page.keyboard.press('Control+z');

      expect(await hiddenOf(page, id)).toBe(false);
      expect(await page.locator(`#doc-svg [data-id="${id}"]`).count()).toBe(1);
    });

    test('hiding a group hides its children and backs out of it', async ({ page }) => {
      await addShape(page, 'r');
      await addShape(page, 'c');
      await page.keyboard.press('Control+a').catch(() => {});
      await page.evaluate(() => { sel = doc.objects.map(o => o.id); groupSel(); });
      const gid = await page.evaluate(() => doc.objects[0].id);
      await page.evaluate(gid => { entered = gid; panel(); }, gid);
      await openLayers(page);

      await page.locator(`.ly[data-pick="${gid}"] [data-vis]`).click();
      expect(await page.locator(`#doc-svg [data-id="${gid}"]`).count()).toBe(0);
      expect(await getSel(page)).toEqual([]);
      expect(await page.evaluate(() => entered)).toBeNull();
    });

    test('the toggle does not also select the row it sits in', async ({ page }) => {
      const a = await addShape(page, 'r');
      const b = await addShape(page, 'c');
      await openLayers(page);
      await page.locator(`.ly[data-pick="${a}"]`).click();

      await page.locator(`.ly[data-pick="${b}"] [data-vis]`).click();
      expect(await getSel(page)).toEqual([a]);       // selection untouched
      expect(await tabOf(page)).toBe('layers');
    });
  });
});
