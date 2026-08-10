const { test, expect } = require('@playwright/test');
const { openApp, getDoc, getSel, addShape } = require('./helpers');

/* Showing an image only where a shape covers it is a question about
   coverage, not colour, so no blend mode can express it — it's a clip.
   One child of a group can be flagged as its mask, and the rest of the
   group is cut to that shape. Which child is flagged is what matters,
   not where it sits in the stack. */

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

/* a full-bleed rect standing in for the artwork, an ellipse over it to
   mask with, both grouped */
async function grouped(page, { backdrop = 'rect' } = {}) {
  const art = backdrop === 'image'
    ? await page.evaluate(src => {
        const o = { id: nextId(), type: 'image', x: 0, y: 0, w: doc.w, h: doc.h, rot: 0, src };
        doc.objects.push(o); return o.id;
      }, PIXEL)
    : await addShape(page, 'r');
  await page.evaluate(id => {
    const o = doc.objects.find(o => o.id === id);
    o.x = 0; o.y = 0; o.w = doc.w; o.h = doc.h; o.fill = 'RED';
  }, art);

  const shape = await addShape(page, 'c');
  await page.evaluate(id => {
    const o = doc.objects.find(o => o.id === id);
    o.x = 300; o.y = 500; o.w = 600; o.h = 600;
  }, shape);

  await page.evaluate(() => { sel = doc.objects.map(o => o.id); groupSel(); });
  const gid = await page.evaluate(() => doc.objects[0].id);
  await page.evaluate(() => { tab = 'layers'; panel(); });
  return { art, shape, gid };
}

const flagsOf = page => page.evaluate(() =>
  doc.objects[0].children.map(c => [c.type, !!c.mask]));

test.describe('masking a group to one of its shapes', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.clear());
  });

  test('MASK is offered on group children only', async ({ page }) => {
    await grouped(page);
    // the group's own row has no MASK — a mask is a relationship between
    // siblings, so the group itself can't be one
    expect(await page.locator('[data-mask]').count()).toBe(2);
    expect(await page.locator('.ly:not([data-parent]) [data-mask]').count()).toBe(0);
  });

  test('flagging a shape clips the rest of the group to it', async ({ page }) => {
    const { art, shape, gid } = await grouped(page);
    await page.locator(`.ly[data-pick="${shape}"] [data-mask]`).click();

    expect(await page.locator(`#doc-svg clipPath#mask-${gid}`).count()).toBe(1);
    const clipped = page.locator(`#doc-svg [clip-path="url(#mask-${gid})"]`);
    await expect(clipped).toHaveCount(1);
    // the backdrop is inside the clip; the mask shape is not — it defines
    // the hole rather than sitting in it
    expect(await clipped.locator(`[data-id="${art}"]`).count()).toBe(1);
    expect(await clipped.locator(`[data-id="${shape}"]`).count()).toBe(0);
    expect(await page.locator(`#doc-svg clipPath [data-id="${shape}"]`).count()).toBe(1);
  });

  test('only one child can be the mask at a time', async ({ page }) => {
    const { art, shape } = await grouped(page);
    await page.locator(`.ly[data-pick="${shape}"] [data-mask]`).click();
    await page.locator(`.ly[data-pick="${art}"] [data-mask]`).click();
    expect(await flagsOf(page)).toEqual([['rect', true], ['ellipse', false]]);
  });

  test('toggling it off restores the whole group', async ({ page }) => {
    const { shape, gid } = await grouped(page);
    await page.locator(`.ly[data-pick="${shape}"] [data-mask]`).click();
    await page.locator(`.ly[data-pick="${shape}"] [data-mask]`).click();
    expect(await page.locator(`#doc-svg clipPath#mask-${gid}`).count()).toBe(0);
    expect(await flagsOf(page)).toEqual([['rect', false], ['ellipse', false]]);
  });

  test('an image cannot be the mask — it has no outline to cut with', async ({ page }) => {
    const { art } = await grouped(page, { backdrop: 'image' });
    await page.locator(`.ly[data-pick="${art}"] [data-mask]`).click();
    expect(await flagsOf(page)).toEqual([['image', false], ['ellipse', false]]);
    expect(await page.locator('#msg').textContent()).toContain('no outline to cut with');
  });

  test('a hidden mask switches the clip off without losing the flag', async ({ page }) => {
    const { shape, gid } = await grouped(page);
    await page.locator(`.ly[data-pick="${shape}"] [data-mask]`).click();
    await page.locator(`.ly[data-pick="${shape}"] [data-vis]`).click();

    expect(await page.locator(`#doc-svg clipPath#mask-${gid}`).count()).toBe(0);
    expect(await flagsOf(page)).toEqual([['rect', false], ['ellipse', true]]); // flag survives
    await page.locator(`.ly[data-pick="${shape}"] [data-vis]`).click();
    expect(await page.locator(`#doc-svg clipPath#mask-${gid}`).count()).toBe(1);
  });

  test('text works as a mask', async ({ page }) => {
    await addShape(page, 'r');
    const txt = await addShape(page, 't');
    await page.evaluate(id => {
      const o = doc.objects.find(o => o.id === id);
      o.str = 'PLAKT'; o.size = 300;
    }, txt);
    await page.evaluate(() => { sel = doc.objects.map(o => o.id); groupSel(); });
    await page.evaluate(() => { tab = 'layers'; panel(); });

    await page.locator(`.ly[data-pick="${txt}"] [data-mask]`).click();
    expect(await page.locator('#doc-svg clipPath text').count()).toBe(1);
  });

  test('hiding is undoable, and so is masking', async ({ page }) => {
    const { shape, gid } = await grouped(page);
    await page.locator(`.ly[data-pick="${shape}"] [data-mask]`).click();
    await page.keyboard.press('Control+z');
    expect(await page.locator(`#doc-svg clipPath#mask-${gid}`).count()).toBe(0);
  });

  test.describe('the ghost outline', () => {
    test('appears only while you are inside the group', async ({ page }) => {
      const { shape, gid } = await grouped(page);
      await page.locator(`.ly[data-pick="${shape}"] [data-mask]`).click();
      expect(await page.locator('.mg').count()).toBe(0);

      await page.evaluate(gid => { enter(gid); marks(); panel(); }, gid);
      expect(await page.locator('.mg').count()).toBe(1);

      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => entered)).toBeNull();
      expect(await page.locator('.mg').count()).toBe(0);
    });

    test('is clickable, so the mask can still be selected on the artboard', async ({ page }) => {
      const { shape, gid } = await grouped(page);
      await page.locator(`.ly[data-pick="${shape}"] [data-mask]`).click();
      await page.evaluate(gid => { enter(gid); marks(); panel(); }, gid);

      const g = await page.locator('.mg').boundingBox();
      await page.mouse.click(g.x + g.width / 2, g.y + 1);   // on the outline itself
      expect(await getSel(page)).toEqual([shape]);
    });

    test('moves with the clip when the mask is dragged', async ({ page }) => {
      const { shape, gid } = await grouped(page);
      await page.locator(`.ly[data-pick="${shape}"] [data-mask]`).click();
      await page.evaluate(gid => { enter(gid); marks(); panel(); }, gid);

      // patch() has to reach both copies or the revealed area lags the outline
      const after = await page.evaluate(s => {
        const o = doc.objects[0].children.find(c => c.id === s);
        o.x += 100; patch(o);
        return {
          clip: document.querySelector(`clipPath [data-id="${s}"]`).getAttribute('cx'),
          ghost: document.querySelector(`.mg[data-id="${s}"]`).getAttribute('cx'),
        };
      }, shape);
      expect(after.clip).toBe(after.ghost);
    });
  });

  test('exports carry the clip but not the ghost', async ({ page }) => {
    const { shape, gid } = await grouped(page);
    await page.locator(`.ly[data-pick="${shape}"] [data-mask]`).click();
    await page.evaluate(gid => { enter(gid); marks(); panel(); }, gid);

    const svg = await page.evaluate(() => standaloneSVG());
    expect(svg).toContain(`mask-${gid}`);
    expect(svg).not.toMatch(/class="[^"]*\bmg\b/);   // no ghost outline in the artwork
  });

  test('ungrouping drops the flag — a loose shape is just a shape again', async ({ page }) => {
    const { shape, gid } = await grouped(page);
    await page.locator(`.ly[data-pick="${shape}"] [data-mask]`).click();
    await page.evaluate(gid => { enter(null); sel = [gid]; tab = 'selection'; panel(); ungroupSel(); }, gid);

    expect((await getDoc(page)).objects.every(o => !o.mask)).toBe(true);
    expect(await page.locator('#doc-svg clipPath').count()).toBe(1); // the artboard's, and only that
  });
});
