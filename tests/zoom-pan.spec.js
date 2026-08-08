const { test, expect } = require('@playwright/test');
const { openApp, getZoom, getPan } = require('./helpers');

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
});
