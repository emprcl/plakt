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
