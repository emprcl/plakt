const { test, expect } = require('@playwright/test');
const { openApp, getDoc } = require('./helpers');
const path = require('path');
const os = require('os');
const fs = require('fs');

test.describe('preserve-aspect-ratio on resize', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('a fresh shape defaults to LOCK on, so editing W proportionally updates H', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    await page.evaluate(id => { const o = doc.objects.find(o => o.id === id); o.w = 200; o.h = 100; touch(); }, id);
    await page.evaluate(() => { panel(); });

    let o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.lockAspect).toBe(true);
    expect(await page.locator('#panel [data-lock]').textContent()).toBe('ON');

    const wInput = page.locator('#panel input[data-k="w"]');
    await wInput.fill('400');
    await wInput.dispatchEvent('change');
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.w).toBe(400);
    expect(o.h).toBe(200);

    const hInput = page.locator('#panel input[data-k="h"]');
    await hInput.fill('50');
    await hInput.dispatchEvent('change');
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.h).toBe(50);
    expect(o.w).toBe(100);
  });

  test('clicking LOCK turns it off (ON/OFF text, same as SNAP/SHOW), and W/H become independent', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    await page.evaluate(id => { const o = doc.objects.find(o => o.id === id); o.w = 200; o.h = 100; touch(); }, id);
    await page.evaluate(() => { panel(); });

    await page.click('#panel [data-lock]');
    let o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.lockAspect).toBe(false);
    expect(await page.locator('#panel [data-lock]').textContent()).toBe('OFF');

    const wInput = page.locator('#panel input[data-k="w"]');
    await wInput.fill('999');
    await wInput.dispatchEvent('change');
    o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.w).toBe(999);
    expect(o.h).toBe(100);
  });

  test('shift-drag a corner handle preserves aspect ratio even with LOCK off', async ({ page }) => {
    await page.keyboard.press('r');
    const id = await page.evaluate(() => sel[0]);
    await page.evaluate(id => { const o = doc.objects.find(o => o.id === id); o.x = 100; o.y = 100; o.w = 200; o.h = 100; o.lockAspect = false; touch(); }, id);
    await page.evaluate(() => { panel(); });

    const se = page.locator('#handles [data-h="se"]');
    const box = await se.boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 10, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const o = (await getDoc(page)).objects.find(o => o.id === id);
    expect(o.w / o.h).toBeCloseTo(2, 1);
  });

  test('a fresh image also defaults to LOCK on', async ({ page }) => {
    const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNk+M9QzzAKRsEoGAVoAAAKfAA9THQR9wAAAABJRU5ErkJggg==';
    const tmpPath = path.join(os.tmpdir(), 'plakt-lock-test.png');
    fs.writeFileSync(tmpPath, Buffer.from(pngB64, 'base64'));
    try {
      await page.locator('#imgInput').setInputFiles(tmpPath);
      await page.waitForFunction(() => doc.objects.some(o => o.type === 'image'));
      const o = (await getDoc(page)).objects.find(o => o.type === 'image');
      expect(o.lockAspect).toBe(true);
      expect(await page.locator('#panel [data-lock]').textContent()).toBe('ON');
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  test('LOCK does not appear for lines (no W/H fields) or groups (already always proportional)', async ({ page }) => {
    await page.keyboard.press('l');
    expect(await page.locator('#panel [data-lock]').count()).toBe(0);

    await page.keyboard.press('r');
    const id1 = await page.evaluate(() => sel[0]);
    await page.keyboard.press('c');
    const id2 = await page.evaluate(() => sel[0]);
    await page.evaluate(({ id1, id2 }) => { sel = [id1, id2]; }, { id1, id2 });
    await page.keyboard.press('Meta+g');
    const group = (await getDoc(page)).objects.find(o => o.type === 'group');
    await page.evaluate(id => { sel = [id]; tab = 'selection'; panel(); }, group.id);
    expect(await page.locator('#panel [data-lock]').count()).toBe(0);
  });
});
