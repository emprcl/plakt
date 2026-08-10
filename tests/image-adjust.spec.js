const { test, expect } = require('@playwright/test');
const { openApp, getDoc } = require('./helpers');

/* Brightness and contrast collapse into one linear ramp per channel:
   out = in·b·c + (½ − ½c). Emitted as a real SVG <filter> rather than the
   CSS filter property, because export rasterises the SVG through an
   <img> — its own document, which can't see this page's stylesheet. */

/* 2x2: mid grey, white, dark grey, black */
const IMG = 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">
     <rect width="1" height="1" fill="#808080"/><rect x="1" width="1" height="1" fill="#fff"/>
     <rect y="1" width="1" height="1" fill="#404040"/><rect x="1" y="1" width="1" height="1" fill="#000"/>
   </svg>`).toString('base64');

async function addImage(page, extra = {}) {
  const id = await page.evaluate(([src, extra]) => {
    const o = { id: nextId(), type: 'image', x: 100, y: 100, w: 800, h: 800, rot: 0, src, ...extra };
    doc.objects.push(o); sel = [o.id]; tab = 'selection'; touch();
    return o.id;
  }, [IMG, extra]);
  return id;
}

test.describe('image brightness and contrast', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.clear());
  });

  test('the image panel offers both, defaulting to 100%', async ({ page }) => {
    await addImage(page);
    await expect(page.locator('#panel .n[data-k="bright"]')).toHaveValue('100');
    await expect(page.locator('#panel .n[data-k="contrast"]')).toHaveValue('100');
  });

  test('an untouched image carries no filter at all', async ({ page }) => {
    await addImage(page);
    expect(await page.locator('#doc-svg image[filter]').count()).toBe(0);
    expect(await page.locator('#doc-svg filter').count()).toBe(0);
    expect((await getDoc(page)).objects[0].bright).toBeUndefined();
  });

  test('adjusting one builds the filter and points the image at it', async ({ page }) => {
    await addImage(page);
    await page.locator('#panel .n[data-k="bright"]').fill('150');
    await page.locator('#panel .n[data-k="bright"]').press('Enter');

    expect((await getDoc(page)).objects[0].bright).toBe(150);
    expect(await page.locator('#doc-svg image').getAttribute('filter')).toMatch(/^url\(#imgfx\d+\)$/);
    // brightness alone: slope = b, intercept = 0
    const fn = await page.locator('#doc-svg filter feFuncR');
    expect(+(await fn.getAttribute('slope'))).toBeCloseTo(1.5, 5);
    expect(+(await fn.getAttribute('intercept'))).toBeCloseTo(0, 5);
  });

  test('the two combine into a single ramp: slope b·c, intercept ½−½c', async ({ page }) => {
    await addImage(page, { bright: 150, contrast: 130 });
    await page.evaluate(() => renderSVG());
    const fn = page.locator('#doc-svg filter feFuncR');
    expect(+(await fn.getAttribute('slope'))).toBeCloseTo(1.5 * 1.3, 5);
    expect(+(await fn.getAttribute('intercept'))).toBeCloseTo(0.5 - 0.5 * 1.3, 5);
    // all three channels move together — this is a tone curve, not a tint
    for (const ch of ['R', 'G', 'B'])
      expect(await page.locator(`#doc-svg filter feFunc${ch}`).getAttribute('slope'))
        .toBe(await fn.getAttribute('slope'));
  });

  test('filters render in sRGB, not the linearRGB default', async ({ page }) => {
    // without this the adjustment silently brightens everything on its own
    await addImage(page, { bright: 150 });
    await page.evaluate(() => renderSVG());
    expect(await page.locator('#doc-svg filter').getAttribute('color-interpolation-filters')).toBe('sRGB');
  });

  test('images sharing settings share one filter definition', async ({ page }) => {
    await addImage(page, { bright: 150, contrast: 130 });
    await addImage(page, { bright: 150, contrast: 130 });
    await addImage(page, { bright: 80 });
    await page.evaluate(() => renderSVG());
    expect(await page.locator('#doc-svg filter').count()).toBe(2);
  });

  test('values clamp to 0–200', async ({ page }) => {
    await addImage(page);
    await page.evaluate(() => { fieldSet('bright', 900); fieldSet('contrast', -50); });
    const o = (await getDoc(page)).objects[0];
    expect(o.bright).toBe(200);
    expect(o.contrast).toBe(0);
  });

  test('back to 100/100 drops the filter again', async ({ page }) => {
    await addImage(page, { bright: 150 });
    await page.evaluate(() => renderSVG());
    expect(await page.locator('#doc-svg image[filter]').count()).toBe(1);

    await page.evaluate(() => { fieldSet('bright', 100); renderSVG(); });
    expect(await page.locator('#doc-svg image[filter]').count()).toBe(0);
    expect(await page.locator('#doc-svg filter').count()).toBe(0);
  });

  test('the adjustment survives into the SVG export', async ({ page }) => {
    await addImage(page, { bright: 150, contrast: 130 });
    await page.evaluate(() => renderSVG());
    const svg = await page.evaluate(() => standaloneSVG());
    expect(svg).toContain('feComponentTransfer');
    expect(svg).toMatch(/<image[^>]*filter="url\(#imgfx\d+\)"/);
  });

  test('a PNG export of an adjusted image still rasterises', async ({ page }) => {
    await addImage(page, { bright: 150, contrast: 130 });
    await page.evaluate(() => renderSVG());
    await page.evaluate(() => {
      window.__png = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = b => { window.__png = b.size; return orig(b); };
    });
    await page.evaluate(() => exportPNG(1));
    await page.waitForFunction(() => window.__png !== null, { timeout: 10000 });
    expect(await page.evaluate(() => window.__png)).toBeGreaterThan(0);
  });

  test('adjusting is undoable', async ({ page }) => {
    await addImage(page);
    await page.locator('#panel .n[data-k="contrast"]').fill('40');
    await page.locator('#panel .n[data-k="contrast"]').press('Enter');
    expect((await getDoc(page)).objects[0].contrast).toBe(40);

    await page.keyboard.press('Control+z');
    expect((await getDoc(page)).objects[0].contrast ?? 100).toBe(100);
  });

  test('non-image objects get no adjust controls', async ({ page }) => {
    await page.keyboard.press('r');
    await page.evaluate(() => { tab = 'selection'; panel(); });
    expect(await page.locator('#panel .n[data-k="bright"]').count()).toBe(0);
  });
});
