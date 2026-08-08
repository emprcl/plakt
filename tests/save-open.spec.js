const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers');

/* Opening a file via the OS gives the page no writable handle for it — the
   File System Access API only ever hands one out through an explicit
   picker call. Playwright can't drive that native OS dialog, so these
   tests mock window.showOpenFilePicker/showSaveFilePicker to exercise the
   app's own wiring: does openFile() load the picked doc and keep the
   handle, and does save() then write straight through it with no further
   dialog? */

const fakeHtml = `<!DOCTYPE html><html><head><script type="application/json" id="doc-data">
{"name":"loaded-doc","w":800,"h":600,"cols":1,"rows":1,"gap":0,"margin":0,"webfonts":[],
"guides":{"v":[],"h":[]},"palette":[{"id":"BG","hex":"#ffffff"},{"id":"INK","hex":"#000000"}],
"objects":[{"id":1,"type":"rect","x":10,"y":10,"w":50,"h":50,"rot":0,"fill":"INK"}]}
</script></head><body></body></html>`;

test.describe('open + direct save (File System Access API)', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('⌘O loads the picked file\'s doc and keeps a writable handle to it', async ({ page }) => {
    await page.evaluate((html) => {
      const fakeHandle = {
        name: 'loaded-doc.html',
        getFile: async () => ({ text: async () => html }),
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      };
      window.showOpenFilePicker = async () => [fakeHandle];
    }, fakeHtml);

    await page.keyboard.press('Meta+o');
    await page.waitForFunction(() => doc.name === 'loaded-doc');

    const after = await page.evaluate(() => ({ name: doc.name, objects: doc.objects, hasHandle: !!handle }));
    expect(after.name).toBe('loaded-doc');
    expect(after.objects).toHaveLength(1);
    expect(after.hasHandle).toBe(true);
  });

  test('after opening, ⌘S writes directly through the kept handle — no save-picker dialog', async ({ page }) => {
    await page.evaluate((html) => {
      window.__writes = []; window.__saveCalls = 0;
      const fakeHandle = {
        name: 'loaded-doc.html',
        getFile: async () => ({ text: async () => html }),
        createWritable: async () => ({
          write: async (data) => { window.__writes.push(data); },
          close: async () => {},
        }),
      };
      window.showOpenFilePicker = async () => [fakeHandle];
      window.showSaveFilePicker = async () => { window.__saveCalls++; return fakeHandle; };
    }, fakeHtml);

    await page.keyboard.press('Meta+o');
    await page.waitForFunction(() => doc.name === 'loaded-doc');

    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__writes.length > 0);

    const counts = await page.evaluate(() => ({ saves: window.__saveCalls, writes: window.__writes.length }));
    expect(counts.saves).toBe(0);
    expect(counts.writes).toBe(1);
    expect(await page.locator('#msg').textContent()).toContain('written back into loaded-doc.html');
  });

  test('⌘O flashes a graceful message when the File System Access API is unavailable', async ({ page }) => {
    // CAN_WRITE is computed once at script-load time from
    // 'showSaveFilePicker' in window, so the API must be gone *before*
    // the page's own script runs — deleting it after openApp() (which
    // already navigated) would be too late to flip that flag.
    await page.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
    await openApp(page);
    await page.keyboard.press('Meta+o');
    const msg = await page.locator('#msg').textContent();
    expect(msg.toLowerCase()).toContain("can't write files directly");
  });
});
