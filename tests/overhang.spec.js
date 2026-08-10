const { test, expect } = require('@playwright/test');
const { openApp, getDoc, getSel, addShape } = require('./helpers');

/* An SVG root clips to its viewBox, so a shape dragged half off the
   artboard used to lose the part of its selection outline — and the
   handles — that hung over the edge, i.e. exactly the grips you need to
   drag it back. The art is clipped explicitly now and the SVG overflows,
   so the editor overlay stays whole while the artwork still crops. */
test.describe('selection chrome outside the artboard', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.clear());
  });

  /* park a shape hanging off the top-left corner of the artboard */
  const overhang = async (page, id) => page.evaluate(id => {
    const o = doc.objects.find(o => o.id === id);
    o.x = -180; o.y = -140; touch();
  }, id);

  test('the selection outline and handles stay visible past the edge', async ({ page }) => {
    const id = await addShape(page, 'r');
    await overhang(page, id);

    const board = await page.locator('#board').boundingBox();
    const nw = await page.locator('.hd[data-h="nw"]').boundingBox();
    expect(nw).not.toBeNull();
    expect(nw.x + nw.width).toBeLessThan(board.x);   // wholly outside, and still rendered
    expect(nw.y + nw.height).toBeLessThan(board.y);

    // the rotate handle sits above the shape, further out still
    const rot = await page.locator('.hd[data-h="rot"]').boundingBox();
    expect(rot.y).toBeLessThan(board.y);
  });

  test('a handle out past the edge is still draggable', async ({ page }) => {
    const id = await addShape(page, 'r');
    await overhang(page, id);
    const before = (await getDoc(page)).objects.find(o => o.id === id);

    const nw = await page.locator('.hd[data-h="nw"]').boundingBox();
    await page.mouse.move(nw.x + nw.width / 2, nw.y + nw.height / 2);
    await page.mouse.down();
    await page.mouse.move(nw.x + 40, nw.y + 40, { steps: 6 });
    await page.mouse.up();

    const after = (await getDoc(page)).objects.find(o => o.id === id);
    expect(after.w).not.toBe(before.w);               // the drag reached it
    expect(await getSel(page)).toEqual([id]);
  });

  test('the artwork itself is still cropped at the artboard', async ({ page }) => {
    const id = await addShape(page, 'r');
    await overhang(page, id);
    // the clip is what does it — without it the fill would spill onto the stage
    const clipped = await page.evaluate(id => {
      const el = document.querySelector(`[data-id="${id}"]`);
      const art = el.closest('#art');
      return { inArt: !!art, clip: art && art.getAttribute('clip-path') };
    }, id);
    expect(clipped.inArt).toBe(true);
    expect(clipped.clip).toBe('url(#artboard-clip)');

    // the clip is exactly the artboard rect, in document units
    expect(await page.evaluate(() => {
      const r = document.querySelector('#artboard-clip rect');
      return [+r.getAttribute('width'), +r.getAttribute('height')];
    })).toEqual([1200, 1600]);

    /* and it really crops: hit-testing honours clip-path, so the point
       where the shape's overhanging half would otherwise paint hits the
       stage behind the board rather than the shape */
    const board = await page.locator('#board').boundingBox();
    const hit = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el && (el.getAttribute('data-id') || el.id || el.tagName);
    }, [board.x - 30, board.y + 60]);
    expect(hit).not.toBe(String(id));
  });

  test('the overlay is not part of the clipped art, so exports are unaffected', async ({ page }) => {
    await addShape(page, 'r');
    const svg = await page.evaluate(() => standaloneSVG());
    expect(svg).not.toContain('id="handles"');
    expect(svg).not.toContain('id="guides"');
    expect(svg).toContain('artboard-clip');            // the crop survives into the export
  });
});
