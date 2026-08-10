const { test, expect } = require('@playwright/test');

test.describe('view mode EDIT button', () => {
  test('is visible on load (before entering edit mode) and clicking it enters edit mode', async ({ page }) => {
    await page.goto('plakt.html');
    await expect(page.locator('#doc-svg')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/edit/);

    const btn = page.locator('#editBtn');
    await expect(btn).toBeVisible();
    expect(await btn.evaluate(el => getComputedStyle(el).opacity)).toBe('1');

    await btn.click();
    await expect(page.locator('body')).toHaveClass(/edit/);
  });

  test('fades out and stops being clickable once in edit mode', async ({ page }) => {
    await page.goto('plakt.html');
    await page.keyboard.press('e');
    await expect(page.locator('body')).toHaveClass(/edit/);

    const btn = page.locator('#editBtn');
    expect(await btn.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
    expect(await btn.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  });
});
