const { expect } = require('@playwright/test');

/* Open plakt.html and enter edit mode ('e') — almost everything (drawing,
   selecting, dragging) only responds while body has the 'edit' class.
   file:// localStorage isn't reliably isolated per test context, and every
   fresh doc defaults to the same name ("untitled") — plakt's own boot
   sequence resumes from the newest local version for that name if one
   exists, so a leftover version from an earlier test could silently swap
   in a different document here. Clear it via addInitScript, which runs
   before the page's own script does, so nothing is left for boot to find. */
async function openApp(page) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('plakt.html');
  await expect(page.locator('#doc-svg')).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.locator('body')).toHaveClass(/edit/);
}

/* plakt.html's <script id="app"> is a classic (non-module) script, so its
   top-level `let`/`const`/`function` bindings — doc, sel, zoom, panX,
   snapOffsets, renderSVG, etc. — live in the page's shared global lexical
   scope and are reachable from page.evaluate() like any other page global.
   That lets tests assert on the app's real internal state instead of only
   what's visible in the DOM. */
const getDoc  = page => page.evaluate(() => JSON.parse(JSON.stringify(doc)));
const getSel  = page => page.evaluate(() => [...sel]);
const getZoom = page => page.evaluate(() => zoom);
const getPan  = page => page.evaluate(() => ({ x: panX, y: panY }));

async function addShape(page, key) {
  const before = await page.evaluate(() => doc.objects.length);
  await page.keyboard.press(key);
  await expect.poll(() => page.evaluate(() => doc.objects.length)).toBe(before + 1);
  return page.evaluate(() => sel[0]);
}

const boxOf = (page, id) => page.locator(`[data-id="${id}"]`).boundingBox();

/* new shapes always land at the same default spot (see add() in the app),
   so tests that need two distinct, non-overlapping objects reposition one
   directly through the shared doc state rather than fighting z-order with
   a real drag — the drag itself is exercised separately by dragBy(). */
async function moveObj(page, id, dx, dy) {
  await page.evaluate(({ id, dx, dy }) => {
    const o = doc.objects.find(o => o.id === id);
    o.x += dx; o.y += dy;
    touch();
  }, { id, dx, dy });
}

/* drag whatever's under the pointer by (dx, dy) screen pixels */
async function dragBy(page, id, dx, dy, { modifiers = [] } = {}) {
  const b = await boxOf(page, id);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}

async function clickObject(page, id, { modifiers = [] } = {}) {
  const b = await boxOf(page, id);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  for (const m of modifiers) await page.keyboard.up(m);
}

module.exports = { openApp, getDoc, getSel, getZoom, getPan, addShape, boxOf, dragBy, clickObject, moveObj };
