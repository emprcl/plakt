const { test, expect } = require('@playwright/test');
const { openApp, getZoom, getPan, addShape } = require('./helpers');

/* Overlay chrome is sized in screen pixels, so measure it in screen
   pixels: getBBox() is document units, and the px-per-document-unit
   factor includes #board's CSS scale(--zoom). Stroke widths carry the
   inverse zoom baked in by calc(), so they multiply back out the same
   way — a value that stays put here is one that stays put on screen. */
const chromeSizes = page => page.evaluate(() => {
  const svg = document.querySelector('#doc-svg');
  const k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
  const sw = s => parseFloat(getComputedStyle(document.querySelector(s)).strokeWidth) * k;
  return {
    handle:    +(document.querySelector('.hd[data-h="nw"]').getBBox().width * k).toFixed(1),
    rotStem:   +(document.querySelector('.hd-l').getBBox().height * k).toFixed(1),
    selOuter:  +sw('.sel-o').toFixed(1),
    selInner:  +sw('.sel-i').toFixed(1),
    guide:     +sw('.gd').toFixed(1),
    guideGrab: +sw('.gh').toFixed(1),
  };
});

test.describe('zoom and pan', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('ctrl+scroll zooms in, plain scroll pans, ctrl+0 resets both', async ({ page }) => {
    const board = await page.locator('#board').boundingBox();
    await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2);

    expect(await getZoom(page)).toBe(1);

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);                 // scroll "up" = zoom in
    await page.keyboard.up('Control');
    await expect.poll(() => getZoom(page)).toBeGreaterThan(1);

    await page.mouse.wheel(40, 25);                   // no modifier: pans instead
    await expect.poll(() => getPan(page).then(p => p.x)).not.toBe(0);

    await page.keyboard.press('Control+0');
    expect(await getZoom(page)).toBe(1);
    expect(await getPan(page)).toEqual({ x: 0, y: 0 });
  });

  /* zoomed in, chrome scaled with the artboard: at 4x a 3px selection
     border painted as 12px and the corner handles swallowed the shape */
  test('selection handles, selection border and guides keep their screen size at any zoom', async ({ page }) => {
    await addShape(page, 'r');
    await page.evaluate(() => { guides().v.push(420); guides().h.push(500); renderSVG(); });

    const at1 = await chromeSizes(page);
    expect(at1.handle).toBeGreaterThan(4);   // guards against the whole thing measuring ~0

    for (const z of [0.3, 2, 4, 8]) {
      await page.evaluate(zz => setZoom(zz), z);
      expect(await getZoom(page)).toBe(z);
      // ±0.5px of slack for the sub-pixel rounding in the board's layout
      for (const [k, v] of Object.entries(await chromeSizes(page)))
        expect(Math.abs(v - at1[k]), `${k} at zoom ${z}`).toBeLessThan(0.5);
    }
  });

  test('a file saved while zoomed in opens back at 1:1', async ({ page }) => {
    // --zoom is baked into #board's inline style, but the script always
    // boots with zoom === 1 — leaving it in would put the CSS and the JS
    // out of step, and every hairline mis-sized by that stale factor
    await page.evaluate(() => setZoom(3));
    const html = await page.evaluate(() => serialize());
    const board = html.match(/id="board"[^>]*style="([^"]*)"/);
    expect(board[1]).not.toContain('--zoom');
    expect(board[1]).not.toContain('--panx');
    expect(board[1]).toContain('--ar');   // the artboard's real shape stays
  });
});
