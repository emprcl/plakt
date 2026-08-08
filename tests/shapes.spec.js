const { test, expect } = require('@playwright/test');
const { openApp, getDoc } = require('./helpers');
const path = require('path');
const os = require('os');
const fs = require('fs');

test.describe('triangle, line, and image shapes', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('"p" draws a triangle rendered as a closed path', async ({ page }) => {
    await page.keyboard.press('p');
    const id = await page.evaluate(() => sel[0]);
    const o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.type).toBe('triangle');
    const d = await page.locator(`[data-id="${id}"]`).getAttribute('d');
    expect(d.trim().endsWith('Z')).toBe(true);
    const box = await page.locator(`[data-id="${id}"]`).boundingBox();
    expect(box.width).toBeGreaterThan(10);
    expect(box.height).toBeGreaterThan(10);
  });

  test('"l" draws a line with a stroke (no fill) and an editable WEIGHT', async ({ page }) => {
    await page.keyboard.press('l');
    const id = await page.evaluate(() => sel[0]);
    const o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.type).toBe('line');
    expect(o.sw).toBeGreaterThan(0);

    const el = page.locator(`[data-id="${id}"]`);
    expect(await el.getAttribute('fill')).toBeFalsy();
    expect(await el.getAttribute('stroke')).toBeTruthy();

    const weightInput = page.locator('#panel input[data-k="sw"]');
    await weightInput.fill('12');
    await weightInput.dispatchEvent('change');
    const o2 = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o2.sw).toBe(12);
    expect(await el.getAttribute('stroke-width')).toBe('12');
  });

  test('a fresh line is flat by default and shows p1/p2 endpoint handles instead of a box', async ({ page }) => {
    await page.keyboard.press('l');
    const id = await page.evaluate(() => sel[0]);
    const o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.h).toBe(0);

    expect(await page.locator('#handles [data-h="p1"]').count()).toBe(1);
    expect(await page.locator('#handles [data-h="p2"]').count()).toBe(1);
    expect(await page.locator('#handles [data-h="nw"]').count()).toBe(0);
    expect(await page.locator('#handles [data-h="rot"]').count()).toBe(0);
  });

  test('dragging endpoint p2 moves only that end; p1 stays fixed', async ({ page }) => {
    await page.keyboard.press('l');
    const id = await page.evaluate(() => sel[0]);
    const before = (await getDoc(page)).objects.find(o => o.id === id);

    const p2 = page.locator('#handles [data-h="p2"]');
    const box = await p2.boundingBox();
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 90, { steps: 8 });
    await page.mouse.up();

    const after = (await getDoc(page)).objects.find(o => o.id === id);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.h).toBeGreaterThan(0);
  });

  test('dragging p1 past p2 gives a negative w/h that still renders and groups with a correct bbox', async ({ page }) => {
    await page.keyboard.press('l');
    const id = await page.evaluate(() => sel[0]);
    const doc0 = (await getDoc(page)).objects.find(o => o.id === id);

    const p1 = page.locator('#handles [data-h="p1"]');
    const box = await p1.boundingBox();
    const targetX = box.x + doc0.w + 200;
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await page.mouse.down();
    await page.mouse.move(targetX, box.y + 5, { steps: 8 });
    await page.mouse.up();

    const after = (await getDoc(page)).objects.find(o => o.id === id);
    expect(after.w).toBeLessThan(0);

    const el = page.locator(`[data-id="${id}"]`);
    expect(+(await el.getAttribute('x1'))).toBeCloseTo(after.x, 0);
    expect(+(await el.getAttribute('x2'))).toBeCloseTo(after.x + after.w, 0);

    await page.keyboard.press('r');
    const rectId = await page.evaluate(() => sel[0]);
    await page.evaluate(({ id, rectId }) => { sel = [id, rectId]; }, { id, rectId });
    await page.keyboard.press('Meta+g');
    const group = (await getDoc(page)).objects.find(o => o.type === 'group');
    expect(group.w).toBeGreaterThan(0);
    expect(group.h).toBeGreaterThan(0);
  });

  test('dragging a line endpoint works correctly while the line is a group child', async ({ page }) => {
    await page.keyboard.press('l');
    const lineId = await page.evaluate(() => sel[0]);
    await page.evaluate(id => { const o = doc.objects.find(o => o.id === id); o.w = 200; o.h = 0; touch(); }, lineId);
    await page.keyboard.press('r');
    const rectId = await page.evaluate(() => sel[0]);
    await page.evaluate(id => { const o = doc.objects.find(o => o.id === id); o.x += 500; o.y += 500; touch(); }, rectId);

    await page.evaluate(({ lineId, rectId }) => { sel = [lineId, rectId]; }, { lineId, rectId });
    await page.keyboard.press('Meta+g');
    const group = (await getDoc(page)).objects.find(o => o.type === 'group');

    const lineEl = page.locator(`[data-id="${lineId}"]`);
    const box = await lineEl.boundingBox();
    await page.mouse.dblclick(box.x + box.width/2, box.y + box.height/2);
    expect(await page.evaluate(() => entered)).toBe(group.id);
    expect(await page.evaluate(() => sel[0])).toBe(lineId);

    const p2 = page.locator('#handles [data-h="p2"]');
    const hbox = await p2.boundingBox();
    await page.mouse.move(hbox.x + hbox.width/2, hbox.y + hbox.height/2);
    await page.mouse.down();
    await page.mouse.move(hbox.x + 80, hbox.y + 40, { steps: 6 });
    await page.mouse.up();

    const child = (await getDoc(page)).objects.find(o => o.id === group.id).children.find(c => c.id === lineId);
    expect(child.w).not.toBe(200);
  });

  test('the IMAGE toolbar button is visible and opens a file chooser', async ({ page }) => {
    const btn = page.locator('#t-image');
    await expect(btn).toBeVisible();
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      btn.click(),
    ]);
    expect(fileChooser).toBeTruthy();
  });

  test('picking a file embeds it as a data URI and renders an <image>, with a REPLACE-only panel', async ({ page }) => {
    const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNk+M9QzzAKRsEoGAVoAAAKfAA9THQR9wAAAABJRU5ErkJggg==';
    const tmpPath = path.join(os.tmpdir(), 'plakt-test.png');
    fs.writeFileSync(tmpPath, Buffer.from(pngB64, 'base64'));
    try {
      await page.locator('#imgInput').setInputFiles(tmpPath);
      await page.waitForFunction(() => doc.objects.some(o => o.type === 'image'));

      const o = (await getDoc(page)).objects.find(o => o.type === 'image');
      expect(o.src.startsWith('data:image/png;base64,')).toBe(true);

      const el = page.locator(`[data-id="${o.id}"]`);
      expect(await el.evaluate(e => e.tagName.toLowerCase())).toBe('image');
      expect(await el.getAttribute('href')).toBe(o.src);

      await page.evaluate(id => { sel = [id]; tab = 'selection'; panel(); }, o.id);
      expect(await page.locator('#imgReplace').count()).toBe(1);
      expect(await page.locator('#fillSolid').count()).toBe(0);
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });
});
