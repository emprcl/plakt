const { test, expect } = require('@playwright/test');
const { openApp, getDoc, addShape } = require('./helpers');

/* WGHT used to be a free numeric field, so any integer at all was
   reachable by typing or scrubbing — including the ~890 values between
   the nine weights CSS actually defines, which just round to a real one
   at paint time. It is a picker now. */
test.describe('text font weight', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.clear());
    await addShape(page, 't');
  });

  test('offers the nine CSS weights and nothing in between', async ({ page }) => {
    const values = await page.locator('#panel [data-wt] option').evaluateAll(
      os => os.map(o => +o.value));
    expect(values).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    // named, not bare numbers — "600" alone doesn't tell you it's semi bold
    expect(await page.locator('#panel [data-wt] option[value="600"]').textContent())
      .toContain('SEMI BOLD');
    expect(await page.locator('#panel .n[data-k="wt"]').count()).toBe(0); // no scrubbable field left
  });

  test('picking a weight applies it to the object and the rendered SVG, undoably', async ({ page }) => {
    const before = (await getDoc(page)).objects[0].wt;

    await page.selectOption('#panel [data-wt]', '700');
    expect((await getDoc(page)).objects[0].wt).toBe(700);
    expect(await page.locator('#doc-svg text').getAttribute('font-weight')).toBe('700');

    await page.keyboard.press('Control+z');
    expect((await getDoc(page)).objects[0].wt).toBe(before);
  });

  test("the panel opens on the object's current weight", async ({ page }) => {
    await page.evaluate(() => { doc.objects[0].wt = 300; panel(); });
    expect(await page.locator('#panel [data-wt]').inputValue()).toBe('300');
  });

  test('an off-list weight from an older document is kept, not silently restyled', async ({ page }) => {
    await page.evaluate(() => { doc.objects[0].wt = 437; panel(); });
    expect(await page.locator('#panel [data-wt]').inputValue()).toBe('437');
    const values = await page.locator('#panel [data-wt] option').evaluateAll(
      os => os.map(o => +o.value));
    expect(values).toEqual([100, 200, 300, 400, 437, 500, 600, 700, 800, 900]); // in its sorted place
    expect((await getDoc(page)).objects[0].wt).toBe(437);
  });
});
