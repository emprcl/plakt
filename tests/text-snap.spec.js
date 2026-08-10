const { test, expect } = require('@playwright/test');
const { openApp, addShape } = require('./helpers');

/* Snapping used to reach only with the selection box, which for text is
   the frame — and the frame is invisible. A short centred line in a wide
   frame would refuse to line up with a guide its visible left edge was
   sitting right on. Text now reaches with both boxes: the frame (still
   what you resize) and the ink (what you see). */
test.describe('text snaps on its glyphs, not just its frame', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.clear());
    await addShape(page, 't');
    await page.evaluate(() => {
      const o = doc.objects[0];
      o.str = 'HI'; o.al = 'c'; o.w = 600;   // short, centred, deliberately narrower than its frame
      touch();
    });
  });

  test('the ink box is genuinely inside the frame for centred copy', async ({ page }) => {
    const { ink, box } = await page.evaluate(() => {
      const o = doc.objects[0];
      return { ink: textInk(o), box: textBox(o) };
    });
    expect(ink.w).toBeLessThan(box.w);       // otherwise this suite proves nothing
    expect(ink.x).toBeGreaterThan(box.x);
  });

  test('snapping offers the ink edges as well as the frame edges', async ({ page }) => {
    const { vx, frame, ink } = await page.evaluate(() => {
      const o = doc.objects[0], b = localBox(o);
      return {
        vx: snapOffsets(o, b.w, b.h).vx,
        frame: [b.x - o.x, b.x + b.w / 2 - o.x, b.x + b.w - o.x],
        ink: (i => [i.x - o.x, i.x + i.w / 2 - o.x, i.x + i.w - o.x])(textInk(o)),
      };
    });
    for (const v of [...frame, ...ink]) expect(vx.some(x => Math.abs(x - v) < 0.01)).toBe(true);
  });

  test('dragging lands the visible left edge on the guide, not the frame edge', async ({ page }) => {
    const r = await page.evaluate(() => {
      const o = doc.objects[0];
      const target = Math.round(textInk(o).x) + 30;   // where the ink edge will be after a 30px move
      guides().v.push(target);
      const b = localBox(o);
      const [nx] = snapToGuides(o.x + 30, o.y, b.w, b.h, o);
      return { target, frameX: nx, inkX: textInk({ ...o, x: nx }).x, hot: snapG.v };
    });
    expect(Math.round(r.inkX)).toBe(r.target);        // the glyphs sit on the guide
    expect(r.frameX).not.toBe(r.target);              // the frame is somewhere else entirely
    expect(r.hot).toBe(r.target);                     // and the guide lights up
  });

  test('the frame still snaps too — this adds edges, it does not swap them', async ({ page }) => {
    const r = await page.evaluate(() => {
      const o = doc.objects[0];
      const target = Math.round(o.x) + 25;            // where the *frame's* left edge will be
      guides().v.push(target);
      const b = localBox(o);
      const [nx] = snapToGuides(o.x + 25, o.y, b.w, b.h, o);
      return { target, frameX: nx };
    });
    expect(Math.round(r.frameX)).toBe(r.target);
  });

  test('a rotated text object snaps on its rotated ink corners', async ({ page }) => {
    const ok = await page.evaluate(() => {
      const o = doc.objects[0];
      o.rot = 30;
      const b = localBox(o);
      const withInk = snapOffsets(o, b.w, b.h).vx.length;
      const t = o.type; o.type = 'rect';               // same box, no ink contribution
      const withoutInk = snapOffsets(o, b.w, b.h).vx.length;
      o.type = t;
      return { withInk, withoutInk };
    });
    expect(ok.withInk).toBe(ok.withoutInk * 2);       // corners + centre of a second box
  });
});
