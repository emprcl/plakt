const { test, expect } = require('@playwright/test');
const { openApp, getDoc, getSel, addShape, dragBy, clickObject, moveObj } = require('./helpers');

test.describe('dragging and multi-select', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('dragging a shape moves it in document space', async ({ page }) => {
    const id = await addShape(page, 'r');
    const before = (await getDoc(page)).objects[0];
    await dragBy(page, id, 80, 40);
    const after = (await getDoc(page)).objects.find(o => o.id === id);
    // snapping is on, so the exact pixel delta can shift a bit — just
    // assert it moved in the right direction, not by an exact amount
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
  });

  test('shift-click adds a second object to the selection', async ({ page }) => {
    const id1 = await addShape(page, 'r');
    await moveObj(page, id1, 500, 500);      // new shapes all land in the same spot — separate them
    const id2 = await addShape(page, 'c');   // re-selects to just [id2]
    expect(await getSel(page)).toEqual([id2]);
    await clickObject(page, id1, { modifiers: ['Shift'] });
    const sel = await getSel(page);
    expect(sel).toContain(id1);
    expect(sel).toContain(id2);
    expect(sel).toHaveLength(2);
  });

  test('shift-click again removes it from the selection', async ({ page }) => {
    const id1 = await addShape(page, 'r');
    await moveObj(page, id1, 500, 500);
    const id2 = await addShape(page, 'c');
    await clickObject(page, id1, { modifiers: ['Shift'] });
    expect(await getSel(page)).toHaveLength(2);
    await clickObject(page, id1, { modifiers: ['Shift'] });
    expect(await getSel(page)).toEqual([id2]);
  });

  test('dragging one member of a multi-selection moves the whole group', async ({ page }) => {
    const id1 = await addShape(page, 'r');
    await moveObj(page, id1, 500, 500);
    const id2 = await addShape(page, 'c');
    await clickObject(page, id1, { modifiers: ['Shift'] });
    expect(await getSel(page)).toHaveLength(2);

    const before = await getDoc(page);
    const b1 = before.objects.find(o => o.id === id1), b2 = before.objects.find(o => o.id === id2);

    await dragBy(page, id2, 60, 30);

    const after = await getDoc(page);
    const a1 = after.objects.find(o => o.id === id1), a2 = after.objects.find(o => o.id === id2);
    expect(a1.x).not.toBe(b1.x);
    expect(a2.x).not.toBe(b2.x);
    // a rigid group move preserves the offset between members
    expect(a2.x - a1.x).toBeCloseTo(b2.x - b1.x, 0);
    expect(a2.y - a1.y).toBeCloseTo(b2.y - b1.y, 0);
  });

  test('marquee-drag from empty canvas selects everything it covers', async ({ page }) => {
    const id1 = await addShape(page, 'r');
    const id2 = await addShape(page, 'c');   // left overlapping on purpose — a full-board marquee covers both anyway
    const board = await page.locator('#board').boundingBox();
    // start from the empty bottom-right corner — both shapes default to the
    // top-left margin, and starting the drag on top of them would pick one
    // up and move it instead of rubber-banding a marquee
    await page.mouse.move(board.x + board.width - 5, board.y + board.height - 5);
    await page.mouse.down();
    await page.mouse.move(board.x + 5, board.y + 5, { steps: 10 });
    await page.mouse.up();
    const sel = await getSel(page);
    expect(sel).toContain(id1);
    expect(sel).toContain(id2);
  });

  test('deleting a multi-selection removes every member', async ({ page }) => {
    const id1 = await addShape(page, 'r');
    await moveObj(page, id1, 500, 500);
    const id2 = await addShape(page, 'c');
    await clickObject(page, id1, { modifiers: ['Shift'] });
    await page.keyboard.press('Backspace');
    expect((await getDoc(page)).objects).toHaveLength(0);
  });
});
