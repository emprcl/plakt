const { test, expect } = require('@playwright/test');
const { openApp, getDoc, addShape } = require('./helpers');
const path = require('path');
const os = require('os');
const fs = require('fs');

/* Replace from JSON used to go straight to a file picker, so pasting the
   JSON that Copy JSON had just put on the clipboard meant saving it to a
   file first. It is a dialog now: paste into it, or open a file into it,
   and either way you see what you are about to replace the document with
   before it happens. */
const DOC = JSON.stringify({
  name: 'replaced-doc', w: 500, h: 500, cols: 1, rows: 1, gap: 0, margin: 0,
  webfonts: [], guides: { v: [], h: [] },
  palette: [{ id: 'BG', hex: '#fff' }, { id: 'INK', hex: '#000' }],
  objects: [{ id: 1, type: 'ellipse', x: 5, y: 5, w: 20, h: 20, rot: 0, fill: 'INK' }],
});

/* the file input is what the dialog's "open a .json file" button clicks */
async function openIntoDialog(page, body, name) {
  const tmp = path.join(os.tmpdir(), name);
  fs.writeFileSync(tmp, body);
  try {
    await page.locator('#jsonInput').setInputFiles(tmp);
    await page.waitForFunction(() => document.querySelector('#jsonin').value.length > 0);
  } finally {
    fs.unlinkSync(tmp);
  }
}

test.describe('replace from JSON', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.clear());
    await addShape(page, 'r');
    await page.evaluate(() => replaceFromJSON());
  });

  test('pasted JSON replaces the document, undoably', async ({ page }) => {
    await page.fill('#jsonin', DOC);
    await page.click('#jsonOk');

    await expect(page.locator('#jsonk')).not.toHaveClass(/open/);
    const d = await getDoc(page);
    expect(d.name).toBe('replaced-doc');
    expect(d.objects).toHaveLength(1);
    expect(d.objects[0].type).toBe('ellipse');
    expect(await page.locator('#msg').textContent()).toContain('replaced from pasted JSON');

    await page.keyboard.press('Control+z');
    expect((await getDoc(page)).name).toBe('untitled');
  });

  test('⌘+Enter in the textarea is the same as pressing Replace', async ({ page }) => {
    await page.fill('#jsonin', DOC);
    await page.locator('#jsonin').press('Meta+Enter');
    expect((await getDoc(page)).name).toBe('replaced-doc');
  });

  test('opening a file loads it into the textarea to be confirmed, not applied on the spot', async ({ page }) => {
    await openIntoDialog(page, DOC, 'plakt-replace-test.json');

    expect(await page.locator('#jsonin').inputValue()).toContain('replaced-doc');
    expect((await getDoc(page)).name).toBe('untitled');   // nothing replaced yet
    await expect(page.locator('#jsonk')).toHaveClass(/open/);

    await page.click('#jsonOk');
    expect((await getDoc(page)).name).toBe('replaced-doc');
    // named after the file it came from, not "pasted JSON"
    expect(await page.locator('#msg').textContent()).toContain('plakt-replace-test.json');
  });

  test('malformed JSON keeps the dialog open with the text still in it', async ({ page }) => {
    const before = await getDoc(page);
    await page.fill('#jsonin', '{ not json');
    await page.click('#jsonOk');

    await expect(page.locator('#jsonk')).toHaveClass(/open/);
    expect(await page.locator('#jsonin').inputValue()).toBe('{ not json'); // still there to fix
    expect(await page.locator('#msg').textContent()).toContain('not valid JSON');
    expect((await getDoc(page)).objects).toEqual(before.objects);
  });

  test('valid JSON that is not a plakt document is refused', async ({ page }) => {
    const before = await getDoc(page);
    await page.fill('#jsonin', '{"not":"a plakt doc"}');
    await page.click('#jsonOk');

    await expect(page.locator('#jsonk')).toHaveClass(/open/);
    expect(await page.locator('#msg').textContent()).toContain("doesn't look like");
    expect((await getDoc(page)).objects).toEqual(before.objects);
  });

  test('Escape, Cancel and the backdrop all close it without replacing anything', async ({ page }) => {
    const before = await getDoc(page);

    await page.fill('#jsonin', DOC);
    await page.keyboard.press('Escape');
    await expect(page.locator('#jsonk')).not.toHaveClass(/open/);

    await page.evaluate(() => replaceFromJSON());
    await page.click('#jsonCancel');
    await expect(page.locator('#jsonk')).not.toHaveClass(/open/);

    await page.evaluate(() => replaceFromJSON());
    await page.mouse.click(8, 8);                          // the backdrop, outside the card
    await expect(page.locator('#jsonk')).not.toHaveClass(/open/);

    expect((await getDoc(page)).objects).toEqual(before.objects);
  });

  test('reopening starts empty — no leftover paste from last time', async ({ page }) => {
    await page.fill('#jsonin', DOC);
    await page.keyboard.press('Escape');
    await page.evaluate(() => replaceFromJSON());
    expect(await page.locator('#jsonin').inputValue()).toBe('');
  });

  test('shortcuts behind the dialog stay inert while it is up', async ({ page }) => {
    const before = await getDoc(page);
    await page.locator('#jsonin').press('r');              // would draw a rect
    await page.locator('#jsonin').press('Backspace');      // would delete the selection
    expect((await getDoc(page)).objects).toEqual(before.objects);
  });

  test('a saved file carries neither the pasted JSON nor an open dialog', async ({ page }) => {
    await page.fill('#jsonin', DOC);
    const html = await page.evaluate(() => serialize());
    expect(html).not.toContain('replaced-doc');
    expect(html).not.toMatch(/id="jsonk"[^>]*class="[^"]*open/);
  });
});
