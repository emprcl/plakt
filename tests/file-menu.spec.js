const { test, expect } = require('@playwright/test');
const { openApp, getDoc, addShape } = require('./helpers');
const path = require('path');
const os = require('os');
const fs = require('fs');

test.describe('file menu', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('opens with every item carrying a tooltip, marks the button as open, and closes on outside click', async ({ page }) => {
    await expect(page.locator('#fileMenu')).not.toHaveClass(/open/);
    await page.click('#fileMenuBtn');
    await expect(page.locator('#fileMenu')).toHaveClass(/open/);
    await expect(page.locator('#fileMenuBtn')).toHaveClass(/open/);

    const items = await page.locator('#fileMenu [data-fm]').all();
    expect(items.length).toBeGreaterThanOrEqual(11); // save, open, saveCopy, replace, copyJson, copySvg, 4 exports, new
    for (const item of items) {
      const title = await item.getAttribute('title');
      expect(title && title.length > 0).toBe(true);
    }

    await page.click('body', { position: { x: 5, y: 5 } });
    await expect(page.locator('#fileMenu')).not.toHaveClass(/open/);
    await expect(page.locator('#fileMenuBtn')).not.toHaveClass(/open/);
  });

  test('every file menu action, including exports, is also reachable from the command palette', async ({ page }) => {
    const names = await page.evaluate(() => CMDS.map(c => c.n));
    for (const name of [
      'Save', 'Open…', 'Save as copy', 'Replace from JSON', 'Copy JSON', 'Copy SVG', 'New',
      'Export SVG', 'Export PNG @1x', 'Export PNG @2x', 'Export PNG @4x',
    ]) {
      expect(names).toContain(name);
    }
  });

  test('Export SVG downloads a standalone SVG file', async ({ page }) => {
    await addShape(page, 'c');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#fileMenuBtn'),
      page.click('#fileMenu [data-fm="exportSvg"]'),
    ]);
    expect(dl.suggestedFilename()).toMatch(/\.svg$/);
    const stream = await dl.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    expect(text).toContain('<svg');
    expect(text).toContain('<ellipse');
  });

  test('Copy JSON copies the document JSON to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await addShape(page, 'r');
    await page.click('#fileMenuBtn');
    await page.click('#fileMenu [data-fm="copyJson"]');
    await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('copied JSON'));
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const parsed = JSON.parse(clip);
    expect(parsed.objects).toHaveLength(1);
  });

  test('Copy SVG copies standalone SVG markup to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await addShape(page, 'c');
    await page.click('#fileMenuBtn');
    await page.click('#fileMenu [data-fm="copySvg"]');
    await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('copied SVG'));
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('<svg');
    expect(clip).toContain('<ellipse');
  });

  test('Replace from JSON swaps in a whole new document', async ({ page }) => {
    await addShape(page, 'r');
    const replacement = JSON.stringify({
      name: 'replaced-doc', w: 500, h: 500, cols: 1, rows: 1, gap: 0, margin: 0,
      webfonts: [], guides: { v: [], h: [] },
      palette: [{ id: 'BG', hex: '#fff' }, { id: 'INK', hex: '#000' }],
      objects: [{ id: 1, type: 'ellipse', x: 5, y: 5, w: 20, h: 20, rot: 0, fill: 'INK' }],
    });
    const tmpPath = path.join(os.tmpdir(), 'plakt-replace-test.json');
    fs.writeFileSync(tmpPath, replacement);
    try {
      await page.locator('#jsonInput').setInputFiles(tmpPath);
      await page.waitForFunction(() => doc.name === 'replaced-doc');
      const d = await getDoc(page);
      expect(d.objects).toHaveLength(1);
      expect(d.objects[0].type).toBe('ellipse');
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  test('Replace from JSON rejects a file that is not a plakt document, leaving the doc untouched', async ({ page }) => {
    await addShape(page, 'r');
    const before = await getDoc(page);
    const tmpPath = path.join(os.tmpdir(), 'plakt-bad.json');
    fs.writeFileSync(tmpPath, '{"not":"a plakt doc"}');
    try {
      await page.locator('#jsonInput').setInputFiles(tmpPath);
      await page.waitForFunction(() => document.querySelector('#msg').textContent.includes("doesn't look like"));
      const after = await getDoc(page);
      expect(after.objects).toEqual(before.objects);
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  test('New resets to a blank document and clears the save handle, after confirming', async ({ page }) => {
    await addShape(page, 'r');
    await page.evaluate(() => { handle = { name: 'fake.html' }; }); // simulate a previously-opened file
    page.on('dialog', dialog => dialog.accept());
    await page.click('#fileMenuBtn');
    await page.click('#fileMenu [data-fm="new"]');
    const d = await getDoc(page);
    const hasHandle = await page.evaluate(() => !!handle);
    expect(d.objects).toHaveLength(0);
    expect(d.name).toBe('untitled');
    expect(hasHandle).toBe(false);
  });

  test('New respects cancelling the confirmation and leaves the document untouched', async ({ page }) => {
    await addShape(page, 'r');
    page.on('dialog', dialog => dialog.dismiss());
    await page.click('#fileMenuBtn');
    await page.click('#fileMenu [data-fm="new"]');
    const d = await getDoc(page);
    expect(d.objects).toHaveLength(1);
  });

  test('Save as copy writes to a new file without touching the handle Save/Open use', async ({ page }) => {
    await addShape(page, 'r');
    await page.evaluate(() => {
      window.__saveAsCopyCalls = 0;
      window.showSaveFilePicker = async () => {
        window.__saveAsCopyCalls++;
        return { name: 'copy.html', createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
      };
    });
    await page.click('#fileMenuBtn');
    await page.click('#fileMenu [data-fm="saveCopy"]');
    await page.waitForFunction(() => window.__saveAsCopyCalls > 0);
    const handleAfter = await page.evaluate(() => handle);
    expect(handleAfter).toBe(null);
    expect(await page.locator('#msg').textContent()).toContain('saved a copy to copy.html');
  });
});

test.describe('artboard name in the status bar', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('clicking the name selects it, and committing a new value renames the document', async ({ page }) => {
    const fname = page.locator('#fname');
    await expect(fname).toHaveValue('untitled');

    await fname.click();
    expect(await fname.evaluate(el => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);

    await page.keyboard.type('My Poster');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => doc.name)).toBe('My Poster');
    await expect(fname).toHaveValue('My Poster');
  });

  test('the "Rename plakt" command focuses the same field', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await page.locator('#cmdin').fill('Rename plakt');
    await page.keyboard.press('Enter');
    await expect(page.locator('#fname')).toBeFocused();
  });
});
