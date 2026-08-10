const { test, expect } = require('@playwright/test');
const { openApp, getDoc, getSel, addShape, dragBy } = require('./helpers');

/* let the capture the setup edit scheduled fire, then wipe it, so what a
   test asserts on afterwards can only be its own edit's capture */
async function settleAndClear(page) {
  await page.waitForFunction(() => localStorage.getItem('plakt:versions:untitled') !== null, { timeout: 5000 });
  await page.evaluate(() => localStorage.clear());
}

/* file:// localStorage isn't reliably isolated per test context, and every
   fresh doc defaults to the same name ("untitled") — clear it explicitly
   so tests don't see leftover versions from earlier runs or siblings. */
async function mockSavePicker(page) {
  await page.evaluate(() => {
    window.showSaveFilePicker = async () => ({
      name: 'untitled.html',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });
  });
}

test.describe('versions (local storage only, captured automatically)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.clear());
  });

  test('there is no manual save-version control anywhere', async ({ page }) => {
    expect(await page.locator('#saveVer').count()).toBe(0);
    expect(await page.locator('#fileMenu [data-fm="saveVersion"]').count()).toBe(0);
    const names = await page.evaluate(() => CMDS.map(c => c.n));
    expect(names).not.toContain('Save version');
  });

  test('an edit alone (no explicit save) captures a version once the debounce settles', async ({ page }) => {
    await addShape(page, 'r');

    // still within the debounce window — nothing captured yet
    let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled') || 'null'));
    expect(stored).toBeNull();

    await page.waitForFunction(() => localStorage.getItem('plakt:versions:untitled') !== null, { timeout: 5000 });
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(stored).toHaveLength(1);
    expect(stored[0].objects).toBe(1);
  });

  test('a burst of rapid edits collapses into a single debounced capture, not one per edit', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await addShape(page, 'r');
      await page.waitForTimeout(200); // well under the debounce window, keeps re-triggering it
    }
    await page.waitForFunction(() => localStorage.getItem('plakt:versions:untitled') !== null, { timeout: 5000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(stored).toHaveLength(1);       // one capture for the whole burst
    expect(stored[0].objects).toBe(5);    // reflecting the final settled state
  });

  test('dragging a shape (not just discrete edits) eventually captures a version with the new position', async ({ page }) => {
    // a drag mutates o.x/o.y directly frame-by-frame for performance and
    // only calls full() at the end, never touch() — so unless endDrag()
    // also schedules a capture, moving something would never version at all
    const id = await addShape(page, 'r');
    await page.waitForFunction(() => localStorage.getItem('plakt:versions:untitled') !== null, { timeout: 5000 });
    await page.evaluate(() => localStorage.clear()); // isolate the drag's own capture from the "shape added" one

    const before = (await getDoc(page)).objects.find(o => o.id === id);
    await dragBy(page, id, 80, 40);
    const after = (await getDoc(page)).objects.find(o => o.id === id);
    expect(after.x).not.toBe(before.x);

    await page.waitForFunction(() => localStorage.getItem('plakt:versions:untitled') !== null, { timeout: 5000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(stored[0].doc.objects[0].x).toBe(after.x);
    expect(stored[0].doc.objects[0].y).toBe(after.y);
  });

  /* the handlers below all deliberately skip touch() so they don't rebuild
     the panel out from under the field being typed in or scrubbed — which
     is exactly how they each used to lose their version capture too. */
  test('typing into a text object captures a version', async ({ page }) => {
    await addShape(page, 't');
    await settleAndClear(page);

    await page.click('#tstr');
    await page.keyboard.type('HELLO');
    expect((await getDoc(page)).objects[0].str).toContain('HELLO');

    await page.waitForFunction(() => localStorage.getItem('plakt:versions:untitled') !== null, { timeout: 5000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(stored).toHaveLength(1);                       // the whole typed burst, not one per keystroke
    expect(stored[0].doc.objects[0].str).toContain('HELLO');
  });

  test('scrubbing a panel number field captures a version without waiting for a deselect', async ({ page }) => {
    await addShape(page, 'r');
    await settleAndClear(page);

    const b = await page.locator('#panel .n[data-k="x"]').first().boundingBox();
    const cy = b.y + b.height / 2;
    await page.mouse.move(b.x + b.width / 2, cy);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 60, cy, { steps: 8 });
    await page.mouse.up();
    const x = (await getDoc(page)).objects[0].x;

    await page.waitForFunction(() => localStorage.getItem('plakt:versions:untitled') !== null, { timeout: 5000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(stored[0].doc.objects[0].x).toBe(x);
    expect(await getSel(page)).toHaveLength(1);           // still selected — nothing had to be deselected first
  });

  test('nudging a panel number field with ↑/↓ captures a version', async ({ page }) => {
    await addShape(page, 'r');
    await settleAndClear(page);

    await page.locator('#panel .n[data-k="x"]').first().click();
    await page.keyboard.press('ArrowUp');
    const x = (await getDoc(page)).objects[0].x;

    await page.waitForFunction(() => localStorage.getItem('plakt:versions:untitled') !== null, { timeout: 5000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(stored[0].doc.objects[0].x).toBe(x);
  });

  test('committing a panel number field with Enter captures a version', async ({ page }) => {
    await addShape(page, 'r');
    await settleAndClear(page);

    await page.locator('#panel .n[data-k="x"]').first().click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('333');
    await page.keyboard.press('Enter');
    expect((await getDoc(page)).objects[0].x).toBe(333);

    await page.waitForFunction(() => localStorage.getItem('plakt:versions:untitled') !== null, { timeout: 5000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(stored[0].doc.objects[0].x).toBe(333);
  });

  test('editing a palette swatch colour captures a version', async ({ page }) => {
    await addShape(page, 'r');
    await settleAndClear(page);

    await page.evaluate(() => { tab = 'doc'; panel(); });
    await page.locator('#panel input[data-edit]').first().evaluate(el => {
      el.value = '#ff0000';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.waitForFunction(() => localStorage.getItem('plakt:versions:untitled') !== null, { timeout: 5000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(stored[0].doc.palette.some(p => p.hex === '#ff0000')).toBe(true);
  });

  test('Save (⌘S) automatically captures a version', async ({ page }) => {
    await addShape(page, 'r');
    await mockSavePicker(page);
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('written back'));

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(stored).toHaveLength(1);
    expect(stored[0].objects).toBe(1);
    expect(stored[0].doc.objects).toHaveLength(1);
  });

  test("Save doesn't clobber its own flash message with the version capture", async ({ page }) => {
    await mockSavePicker(page);
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('written back'));
    expect(await page.locator('#msg').textContent()).toContain('written back into untitled.html');
  });

  test('Save as copy also captures a version, filed under the current document', async ({ page }) => {
    await addShape(page, 'c');
    await page.evaluate(() => {
      window.showSaveFilePicker = async () => ({
        name: 'untitled-copy.html',
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      });
    });
    await page.click('#fileMenuBtn');
    await page.click('#fileMenu [data-fm="saveCopy"]');
    await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('saved a copy'));

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(stored).toHaveLength(1);
  });

  test('the Versions tab badge reflects the stored count after a save', async ({ page }) => {
    await mockSavePicker(page);
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('written back'));
    await page.evaluate(() => { tab = 'versions'; panel(); });
    expect(await page.locator('.tab[data-tab="versions"] em').textContent()).toBe('1');
    await expect(page.locator('.vrow')).toHaveCount(1);
  });

  test('the Versions tab list itself refreshes live if it is the tab already open when a capture happens', async ({ page }) => {
    await page.evaluate(() => { tab = 'versions'; panel(); });
    await expect(page.locator('.vrow')).toHaveCount(0);

    await addShape(page, 'r'); // switches tab away to show the new object
    await page.evaluate(() => { tab = 'versions'; panel(); }); // switch back, as a user watching it would

    await page.waitForFunction(() => document.querySelectorAll('.vrow').length > 0, { timeout: 5000 });
    await expect(page.locator('.vrow')).toHaveCount(1);
  });

  test('the very first version ever captured for a document creates the tab badge, not just patches it', async ({ page }) => {
    expect(await page.locator('.tab[data-tab="versions"] em').count()).toBe(0); // no badge with zero versions
    await addShape(page, 'r');
    await page.waitForFunction(() => localStorage.getItem('plakt:versions:untitled') !== null, { timeout: 5000 });
    await expect(page.locator('.tab[data-tab="versions"] em')).toHaveText('1');
  });

  test('restoring a version replaces the document and is itself undoable', async ({ page }) => {
    await addShape(page, 'r');
    await page.evaluate(() => captureVersion()); // version A: 1 rect

    await addShape(page, 'c'); // now 2 objects, not saved as a version

    await page.evaluate(() => { tab = 'versions'; panel(); });
    await page.click('[data-restore]');
    expect((await getDoc(page)).objects).toHaveLength(1);

    await page.keyboard.press('Control+z');
    expect((await getDoc(page)).objects).toHaveLength(2); // the restore itself was undoable
  });

  test('deleting a version asks for confirmation and removes it from storage', async ({ page }) => {
    await page.evaluate(() => captureVersion());
    await page.evaluate(() => { tab = 'versions'; panel(); });
    await expect(page.locator('.vrow')).toHaveCount(1);

    page.on('dialog', dialog => dialog.accept());
    await page.click('[data-delver]');
    await expect(page.locator('.vrow')).toHaveCount(0);
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('plakt:versions:untitled')))).toHaveLength(0);
  });

  test('deleting a version is cancellable', async ({ page }) => {
    await page.evaluate(() => captureVersion());
    await page.evaluate(() => { tab = 'versions'; panel(); });
    page.on('dialog', dialog => dialog.dismiss());
    await page.click('[data-delver]');
    await expect(page.locator('.vrow')).toHaveCount(1);
  });

  test('versions are scoped by document name', async ({ page }) => {
    await page.evaluate(() => captureVersion());
    await page.evaluate(() => { tab = 'versions'; panel(); });
    await expect(page.locator('.vrow')).toHaveCount(1);

    await page.click('#fname');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('other-doc');
    await page.keyboard.press('Enter');
    await page.evaluate(() => { panel(); });
    await expect(page.locator('.vrow')).toHaveCount(0);

    const untitledStore = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(untitledStore).toHaveLength(1); // still there under the old name's key
  });

  test('the version cap prunes the oldest entries, keeping the newest first', async ({ page }) => {
    const cap = await page.evaluate(() => VERSION_CAP);
    await page.evaluate((cap) => {
      const list = [];
      for (let i = 0; i < cap + 5; i++) list.push({ id: i, ts: i, objects: 0, doc: { objects: [] } });
      localStorage.setItem('plakt:versions:untitled', JSON.stringify(list));
    }, cap);
    await addShape(page, 'r');
    await page.evaluate(() => captureVersion());
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('plakt:versions:untitled')));
    expect(stored).toHaveLength(cap);
    expect(stored[0].objects).toBe(1); // the newest one just captured, unshifted to the front
  });
});

test.describe('resuming from the last version on page load', () => {
  test('reloading resumes from a differing local version, marks the doc dirty, and flashes', async ({ page }) => {
    // openApp()'s addInitScript clear would also fire on reload() below,
    // wiping the very version this test needs to survive it — do a
    // one-time page.evaluate clear instead, scoped to just this load.
    await page.goto('plakt.html');
    await page.evaluate(() => localStorage.clear());
    await page.keyboard.press('e');
    await addShape(page, 'r');
    await page.evaluate(() => captureVersion());

    await page.reload();
    await expect(page.locator('#doc-svg')).toBeVisible();

    expect((await getDoc(page)).objects).toHaveLength(1);
    expect(await page.evaluate(() => dirty)).toBe(true);
    expect((await page.locator('#msg').textContent()).toLowerCase()).toContain('resumed');
  });

  test('a normal load with no differing local version does not flash or mark dirty', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('plakt.html');
    await expect(page.locator('#doc-svg')).toBeVisible();
    expect(await page.evaluate(() => dirty)).toBe(false);
    expect(await page.locator('#msg').textContent()).not.toContain('resumed');
  });

  test('a file with no local version history at all loads its embedded doc-data unchanged', async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto('plakt.html');
    await expect(page.locator('#doc-svg')).toBeVisible();
    const d = await getDoc(page);
    expect(d.objects).toHaveLength(0);
    expect(d.name).toBe('untitled');
  });
});
