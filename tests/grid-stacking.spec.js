const { test, expect } = require('@playwright/test');
const { openApp, getSel, addShape } = require('./helpers');

/* The grid used to paint under the artwork, so the moment anything
   covered the artboard — a full-bleed image, a background rect — the
   lines you were lining it up against disappeared behind it. */
test.describe('grid stacking', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.clear());
  });

  /* a rect covering the whole artboard, with a grid to show through it */
  const fullBleed = async page => {
    const id = await addShape(page, 'r');
    await page.evaluate(id => {
      const o = doc.objects.find(o => o.id === id);
      o.x = 0; o.y = 0; o.w = doc.w; o.h = doc.h;
      doc.cols = 3; doc.rows = 4;
      touch();
    }, id);
    return id;
  };

  test('the grid paints over the artwork, still inside the artboard clip', async ({ page }) => {
    const id = await fullBleed(page);
    const order = await page.evaluate(() =>
      [...document.querySelector('#art').children].map(n => n.id || n.getAttribute('data-id')));

    expect(order).toEqual(['bg', String(id), 'gridlines']);   // grid last = grid on top
    // and it is inside #art, so it crops with the artboard rather than
    // running out over the stage
    expect(await page.evaluate(() =>
      document.querySelector('#gridlines').closest('#art') !== null)).toBe(true);
  });

  test('the grid does not swallow clicks meant for the shape beneath it', async ({ page }) => {
    const id = await fullBleed(page);
    await page.evaluate(() => { sel = []; marks(); panel(); });

    const board = await page.locator('#board').boundingBox();
    // dead centre — over both the shape and the grid's gap lines
    await page.mouse.click(board.x + board.width / 2, board.y + board.height / 2);
    expect(await getSel(page)).toEqual([id]);
  });

  test('the grid is still left out of exports', async ({ page }) => {
    await fullBleed(page);
    expect(await page.evaluate(() => standaloneSVG())).not.toContain('id="gridlines"');
  });
});
