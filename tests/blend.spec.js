const { test, expect } = require('@playwright/test');
const { openApp, getDoc, addShape } = require('./helpers');

/* Blend applies at two levels and `isolation` is what separates them:
   on a shape it mixes with what's painted beneath it inside its own
   group; on a group the group composites internally first and blends
   that result as one unit against what's behind the group. A group is
   therefore always isolated, so a child's blend reaches its siblings and
   stops there. */

/* Rasterise the real export and read a pixel out of it — the only way to
   prove a blend actually composited rather than just checking that an
   attribute is present. Coordinates are in document units. */
const pixelAt = (page, x, y) => page.evaluate(([x, y]) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = doc.w; c.height = doc.h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, doc.w, doc.h);
    const [r, gr, b] = g.getImageData(x, y, 1, 1).data;
    res([r, gr, b]);
  };
  img.onerror = () => rej(new Error('raster failed'));
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(standaloneSVG());
}), [x, y]);

const near = (got, want, tol = 12) =>
  got.every((v, i) => Math.abs(v - want[i]) <= tol);

test.describe('blend modes', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.clear());
  });

  /* a blue panel over the left half, a yellow disc straddling its right
     edge, so one sample lands on the overlap and one on the bare artboard */
  async function stack(page) {
    await page.evaluate(() => { doc.palette[0].hex = '#e6e1d7'; });
    const panel = await addShape(page, 'r');
    await page.evaluate(id => {
      const o = doc.objects.find(o => o.id === id);
      o.x = 0; o.y = 0; o.w = 600; o.h = 1600; o.fill = 'BLU';
    }, panel);
    const disc = await addShape(page, 'c');
    await page.evaluate(id => {
      const o = doc.objects.find(o => o.id === id);
      o.x = 300; o.y = 600; o.w = 600; o.h = 600; o.fill = 'YEL';
      sel = [o.id]; tab = 'selection'; touch();
    }, disc);
    return { panel, disc };
  }

  test('a shape gets its own BLEND control', async ({ page }) => {
    await addShape(page, 'r');
    await page.evaluate(() => { tab = 'selection'; panel(); });
    await expect(page.locator('#panel [data-blend]')).toHaveCount(1);
    const opts = await page.locator('#panel [data-blend] option').evaluateAll(o => o.map(x => x.value));
    expect(opts).toContain('multiply');
    expect(opts[0]).toBe('normal');
  });

  test('images get one too', async ({ page }) => {
    await page.evaluate(() => {
      const o = { id: nextId(), type: 'image', x: 0, y: 0, w: 100, h: 100, rot: 0,
        src: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' };
      doc.objects.push(o); sel = [o.id]; tab = 'selection'; touch();
    });
    await expect(page.locator('#panel [data-blend]')).toHaveCount(1);
  });

  test('normal writes no style at all', async ({ page }) => {
    const { disc } = await stack(page);
    expect(await page.locator(`#doc-svg [data-id="${disc}"]`).getAttribute('style')).toBeNull();
  });

  test('a loose shape blends against what is under it on the artboard', async ({ page }) => {
    const { disc } = await stack(page);
    const plain = await pixelAt(page, 450, 900);        // over the blue panel
    await page.selectOption('#panel [data-blend]', 'multiply');

    expect((await getDoc(page)).objects[1].blend).toBe('multiply');
    expect(await page.locator(`#doc-svg [data-id="${disc}"]`).getAttribute('style'))
      .toBe('mix-blend-mode:multiply');

    const mixed = await pixelAt(page, 450, 900);
    expect(near(mixed, plain)).toBe(false);             // it actually composited
    // YEL #efb700 x BLU #1a4f9c, multiplied per channel
    expect(near(mixed, [0x18, 0x39, 0x00])).toBe(true);
  });

  test('grouping seals the blend in: the same shape stops reaching the artboard', async ({ page }) => {
    await stack(page);
    await page.selectOption('#panel [data-blend]', 'multiply');
    // the disc overhangs the blue panel, so this point is disc-over-artboard
    const loose = await pixelAt(page, 750, 900);

    await page.evaluate(() => { sel = doc.objects.map(o => o.id); groupSel(); });
    const gid = await page.evaluate(() => doc.objects[0].id);
    expect(await page.locator(`#doc-svg [data-id="${gid}"]`).getAttribute('style'))
      .toBe('isolation:isolate');

    const grouped = await pixelAt(page, 750, 900);
    expect(near(grouped, loose)).toBe(false);
    // nothing of the group's own beneath it there, so the disc paints flat
    expect(near(grouped, [0xef, 0xb7, 0x00])).toBe(true);
    // and over its sibling it still blends
    expect(near(await pixelAt(page, 450, 900), [0x18, 0x39, 0x00])).toBe(true);
  });

  test('a group is isolated whether or not it has a blend of its own', async ({ page }) => {
    await addShape(page, 'r');
    await addShape(page, 'c');
    await page.evaluate(() => { sel = doc.objects.map(o => o.id); groupSel(); });
    const gid = await page.evaluate(() => doc.objects[0].id);
    expect(await page.locator(`#doc-svg [data-id="${gid}"]`).getAttribute('style'))
      .toBe('isolation:isolate');

    await page.evaluate(gid => { sel = [gid]; tab = 'selection'; panel(); }, gid);
    await page.selectOption('#panel [data-blend]', 'screen');
    expect(await page.locator(`#doc-svg [data-id="${gid}"]`).getAttribute('style'))
      .toBe('isolation:isolate;mix-blend-mode:screen');
  });

  test('a child blend and a group blend coexist', async ({ page }) => {
    await stack(page);
    await page.selectOption('#panel [data-blend]', 'multiply');
    await page.evaluate(() => { sel = doc.objects.map(o => o.id); groupSel(); });
    const gid = await page.evaluate(() => doc.objects[0].id);
    await page.evaluate(gid => { sel = [gid]; tab = 'selection'; panel(); }, gid);
    await page.selectOption('#panel [data-blend]', 'screen');

    const d = await getDoc(page);
    expect(d.objects[0].blend).toBe('screen');
    expect(d.objects[0].children.find(c => c.blend).blend).toBe('multiply');
  });

  test('NORMAL clears the blend, leaving a group with just its isolation', async ({ page }) => {
    const { disc } = await stack(page);
    await page.selectOption('#panel [data-blend]', 'multiply');
    await page.selectOption('#panel [data-blend]', 'normal');
    expect(await page.locator(`#doc-svg [data-id="${disc}"]`).getAttribute('style')).toBeNull();

    await page.evaluate(() => { sel = doc.objects.map(o => o.id); groupSel(); });
    const gid = await page.evaluate(() => doc.objects[0].id);
    await page.evaluate(gid => { sel = [gid]; tab = 'selection'; panel(); }, gid);
    await page.selectOption('#panel [data-blend]', 'screen');
    await page.selectOption('#panel [data-blend]', 'normal');
    expect(await page.locator(`#doc-svg [data-id="${gid}"]`).getAttribute('style')).toBe('isolation:isolate');
  });

  test("a group's own blend still changes how it composites over the artboard", async ({ page }) => {
    await stack(page);
    await page.evaluate(() => { sel = doc.objects.map(o => o.id); groupSel(); });
    const gid = await page.evaluate(() => doc.objects[0].id);
    const before = await pixelAt(page, 450, 900);

    await page.evaluate(gid => { sel = [gid]; tab = 'selection'; panel(); }, gid);
    await page.selectOption('#panel [data-blend]', 'multiply');
    expect(near(await pixelAt(page, 450, 900), before)).toBe(false);
  });

  test('ungrouping drops the blend along with the group itself', async ({ page }) => {
    await stack(page);
    await page.evaluate(() => { sel = doc.objects.map(o => o.id); groupSel(); });
    const gid = await page.evaluate(() => doc.objects[0].id);
    await page.evaluate(gid => { sel = [gid]; tab = 'selection'; panel(); ungroupSel(); }, gid);

    const after = await getDoc(page);
    expect(after.objects.every(o => o.type !== 'group')).toBe(true);
    expect(await page.locator('#doc-svg [style*="isolation"]').count()).toBe(0);
  });

  test('the blend survives into the export', async ({ page }) => {
    await stack(page);
    await page.selectOption('#panel [data-blend]', 'multiply');
    const svg = await page.evaluate(() => standaloneSVG());
    expect(svg).toContain('mix-blend-mode:multiply');
  });

  test('setting a blend is undoable', async ({ page }) => {
    await stack(page);
    await page.selectOption('#panel [data-blend]', 'overlay');
    expect((await getDoc(page)).objects[1].blend).toBe('overlay');
    await page.keyboard.press('Control+z');
    expect((await getDoc(page)).objects[1].blend ?? 'normal').toBe('normal');
  });
});
