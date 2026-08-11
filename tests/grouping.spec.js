const { test, expect } = require('@playwright/test');
const { openApp, getDoc, getSel, addShape, moveObj, clickObject, dragBy } = require('./helpers');

/* two shapes at distinct, non-overlapping positions, selected and grouped */
async function makeGroup(page) {
  const id1 = await addShape(page, 'r');
  await moveObj(page, id1, 300, 300);
  const id2 = await addShape(page, 'c');
  await clickObject(page, id1, { modifiers: ['Shift'] });
  await page.keyboard.press('Control+g');
  const doc = await getDoc(page);
  const group = doc.objects.find(o => o.type === 'group');
  return { id1, id2, groupId: group.id };
}

test.describe('grouping', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('⌘G groups the selection into one object with the members as children', async ({ page }) => {
    const { id1, id2, groupId } = await makeGroup(page);
    const doc = await getDoc(page);
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0].id).toBe(groupId);
    expect(doc.objects[0].type).toBe('group');
    expect(doc.objects[0].children.map(c => c.id).sort()).toEqual([id1, id2].sort());
    expect(await getSel(page)).toEqual([groupId]);
  });

  test('grouping a single selected object is rejected', async ({ page }) => {
    await addShape(page, 'r');
    await page.keyboard.press('Control+g');
    const doc = await getDoc(page);
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0].type).not.toBe('group');
  });

  /* nesting is still off the table, so ⌘G on a selection holding exactly one
     group has only one sensible reading left: grow that group */
  test('grouping a selection that includes one group adds the rest to it', async ({ page }) => {
    const { groupId } = await makeGroup(page);
    const id3 = await addShape(page, 'r');   // a fresh top-level object alongside the group
    await moveObj(page, id3, -700, 700);     // clear of the group's bbox, or clicks would hit id3 instead
    await clickObject(page, groupId, { modifiers: ['Shift'] });
    expect(await getSel(page)).toEqual(expect.arrayContaining([groupId, id3]));

    await page.keyboard.press('Control+g');
    const doc = await getDoc(page);
    expect(doc.objects).toHaveLength(1);                     // the loose object was absorbed
    const g = doc.objects[0];
    expect(g.id).toBe(groupId);                              // the same group, not a new one
    expect(g.type).toBe('group');
    expect(g.children.map(c => c.id)).toContain(id3);
    expect(g.children).toHaveLength(3);
    expect(g.children.every(c => c.type !== 'group')).toBe(true);   // still one level deep
  });

  test('dragging the group moves both children together, preserving their relative offset', async ({ page }) => {
    const { id1, id2, groupId } = await makeGroup(page);
    const before = await getDoc(page);
    const b1 = before.objects[0].children.find(c => c.id === id1);
    const b2 = before.objects[0].children.find(c => c.id === id2);

    await dragBy(page, groupId, 80, 40);

    const after = await getDoc(page);
    expect(after.objects[0].x).not.toBe(before.objects[0].x);
    const a1 = after.objects[0].children.find(c => c.id === id1);
    const a2 = after.objects[0].children.find(c => c.id === id2);
    // children are stored relative to the group, so a rigid group move
    // leaves their own x/y completely untouched
    expect(a1).toEqual(b1);
    expect(a2).toEqual(b2);
  });

  test('rotating the group via its handle rotates the group, not the children\'s own rot', async ({ page }) => {
    const { groupId } = await makeGroup(page);
    await moveObj(page, groupId, 0, 300);   // clear the top-edge handle-clipping rough edge

    const rotHandle = page.locator('[data-h="rot"]');
    const hb = await rotHandle.boundingBox();
    const gb = await page.locator(`[data-id="${groupId}"]`).boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(gb.x + gb.width + 60, gb.y + gb.height / 2, { steps: 8 });
    await page.mouse.up();

    const doc = await getDoc(page);
    expect(doc.objects[0].rot).not.toBe(0);
    expect(doc.objects[0].children.every(c => (c.rot || 0) === 0)).toBe(true);
  });

  test('resizing a group is constrained to uniform scale', async ({ page }) => {
    const { groupId } = await makeGroup(page);
    const before = await getDoc(page);
    const w0 = before.objects[0].w, h0 = before.objects[0].h;

    const seHandle = page.locator('[data-h="se"]');
    const seb = await seHandle.boundingBox();
    await page.mouse.move(seb.x + seb.width / 2, seb.y + seb.height / 2);
    await page.mouse.down();
    await page.mouse.move(seb.x + 150, seb.y + 20, { steps: 8 }); // deliberately non-uniform drag
    await page.mouse.up();

    const after = await getDoc(page);
    expect(after.objects[0].w / w0).toBeCloseTo(after.objects[0].h / h0, 1);
  });

  test('⇧⌘G ungroups back to flat leaves without moving anything on screen', async ({ page }) => {
    const { id1, id2, groupId } = await makeGroup(page);
    await moveObj(page, groupId, 0, 300);

    const rotHandle = page.locator('[data-h="rot"]');
    const hb = await rotHandle.boundingBox();
    const gb = await page.locator(`[data-id="${groupId}"]`).boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(gb.x + gb.width + 60, gb.y + gb.height / 2, { steps: 8 });
    await page.mouse.up();

    const before = {
      [id1]: await page.locator(`[data-id="${id1}"]`).boundingBox(),
      [id2]: await page.locator(`[data-id="${id2}"]`).boundingBox(),
    };

    await page.keyboard.press('Shift+Control+g');

    const doc = await getDoc(page);
    expect(doc.objects).toHaveLength(2);
    expect(doc.objects.every(o => o.type !== 'group')).toBe(true);
    expect(await getSel(page)).toHaveLength(2);

    for (const id of [id1, id2]) {
      const after = await page.locator(`[data-id="${id}"]`).boundingBox();
      expect(after.x).toBeCloseTo(before[id].x, 0);
      expect(after.y).toBeCloseTo(before[id].y, 0);
      expect(after.width).toBeCloseTo(before[id].width, 0);
      expect(after.height).toBeCloseTo(before[id].height, 0);
    }
  });

  test('double-click drills into a group; Escape exits it without clearing the selection', async ({ page }) => {
    const { id1, groupId } = await makeGroup(page);
    const c1 = await page.locator(`[data-id="${id1}"]`).boundingBox();
    await page.mouse.dblclick(c1.x + c1.width / 2, c1.y + c1.height / 2);
    expect(await getSel(page)).toEqual([id1]);
    expect(await page.evaluate(() => entered)).toBe(groupId);

    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => entered)).toBe(null);
    expect(await getSel(page)).toEqual([id1]);
  });

  test('the selection outline for an entered child lines up with the shape (no top-left offset)', async ({ page }) => {
    const { id1, groupId } = await makeGroup(page);
    await moveObj(page, groupId, 200, 250);   // a non-trivial position exposes an unconverted-frame bug

    const c1 = await page.locator(`[data-id="${id1}"]`).boundingBox();
    await page.mouse.dblclick(c1.x + c1.width / 2, c1.y + c1.height / 2);
    expect(await getSel(page)).toEqual([id1]);

    const shapeBox = await page.locator(`[data-id="${id1}"]`).boundingBox();
    const selOutline = await page.locator('#handles .sel-o').boundingBox();
    // within a pixel or two for the outline's own stroke width, not the
    // hundreds-of-pixels offset a raw (unconverted) local coordinate would show
    expect(selOutline.x).toBeCloseTo(shapeBox.x, -1);
    expect(selOutline.y).toBeCloseTo(shapeBox.y, -1);
    expect(selOutline.width).toBeCloseTo(shapeBox.width, -1);
    expect(selOutline.height).toBeCloseTo(shapeBox.height, -1);
  });

  test('the outline stays aligned after Escape backs out of the group (child stays selected)', async ({ page }) => {
    const { id1, groupId } = await makeGroup(page);
    await moveObj(page, groupId, 200, 250);

    const c1 = await page.locator(`[data-id="${id1}"]`).boundingBox();
    await page.mouse.dblclick(c1.x + c1.width / 2, c1.y + c1.height / 2);
    expect(await page.evaluate(() => entered)).toBe(groupId);

    await page.keyboard.press('Escape');
    // Escape only exits the isolation — the child is still what's selected,
    // so displayObj() must key off the object's actual parent, not `entered`
    expect(await page.evaluate(() => entered)).toBe(null);
    expect(await getSel(page)).toEqual([id1]);

    const shapeBox = await page.locator(`[data-id="${id1}"]`).boundingBox();
    const selOutline = await page.locator('#handles .sel-o').boundingBox();
    expect(selOutline.x).toBeCloseTo(shapeBox.x, -1);
    expect(selOutline.y).toBeCloseTo(shapeBox.y, -1);
    expect(selOutline.width).toBeCloseTo(shapeBox.width, -1);
    expect(selOutline.height).toBeCloseTo(shapeBox.height, -1);
  });

  test('dragging a child inside a rotated group moves it in the direction the mouse actually moves', async ({ page }) => {
    const { id2, groupId } = await makeGroup(page);
    await moveObj(page, groupId, 0, 300);

    const rotHandle = page.locator('[data-h="rot"]');
    const hb = await rotHandle.boundingBox();
    const gb = await page.locator(`[data-id="${groupId}"]`).boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(gb.x + gb.width + 60, gb.y + gb.height / 2, { steps: 8 });
    await page.mouse.up();
    expect((await getDoc(page)).objects[0].rot).not.toBe(0);

    const c2 = await page.locator(`[data-id="${id2}"]`).boundingBox();
    await page.mouse.dblclick(c2.x + c2.width / 2, c2.y + c2.height / 2);
    expect(await getSel(page)).toEqual([id2]);

    const before = await page.locator(`[data-id="${id2}"]`).boundingBox();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2, { steps: 8 });
    await page.mouse.up();
    const after = await page.locator(`[data-id="${id2}"]`).boundingBox();

    // dragging 60px right on screen must move the shape right on screen,
    // regardless of the parent group's own rotation — a raw document-space
    // delta applied straight to the child's local x/y would go the wrong way
    expect(after.x - before.x).toBeGreaterThan(40);
    expect(Math.abs(after.y - before.y)).toBeLessThan(20);
  });

  test('deleting a group removes every member at once', async ({ page }) => {
    await makeGroup(page);
    await page.keyboard.press('Backspace');
    expect((await getDoc(page)).objects).toHaveLength(0);
  });

  test('duplicating a group deep-clones its children with fresh ids', async ({ page }) => {
    const { groupId } = await makeGroup(page);
    await page.keyboard.press('Control+d');
    const doc = await getDoc(page);
    expect(doc.objects).toHaveLength(2);
    const [g1, g2] = doc.objects;
    const ids1 = g1.children.map(c => c.id).sort(), ids2 = g2.children.map(c => c.id).sort();
    // no id collisions between the two groups' children
    expect(ids1.some(id => ids2.includes(id))).toBe(false);
    expect(g1.id).not.toBe(g2.id);
  });

  test('the Group button in the multi-select panel works too', async ({ page }) => {
    const id1 = await addShape(page, 'r');
    await moveObj(page, id1, 300, 300);
    const id2 = await addShape(page, 'c');
    await clickObject(page, id1, { modifiers: ['Shift'] });
    await page.locator('#msGroup').click();
    const doc = await getDoc(page);
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0].type).toBe('group');
  });

  test('layers panel shows the group with its children indented, and rows are clickable', async ({ page }) => {
    const { id1, id2, groupId } = await makeGroup(page);
    await page.locator('.tab[data-tab="layers"]').click();
    const rows = page.locator('#panel .ly[data-pick]');
    await expect(rows).toHaveCount(3);   // group row + 2 child rows

    const childRow = page.locator(`.ly[data-pick="${id1}"]`);
    await expect(childRow).toHaveAttribute('data-parent', String(groupId));
    await childRow.click();
    expect(await getSel(page)).toEqual([id1]);
    expect(await page.evaluate(() => entered)).toBe(groupId);
  });

  test('undo/redo across group and ungroup restores the exact structure', async ({ page }) => {
    await makeGroup(page);
    expect((await getDoc(page)).objects[0].type).toBe('group');

    await page.keyboard.press('Control+z');
    let doc = await getDoc(page);
    expect(doc.objects).toHaveLength(2);
    expect(doc.objects.every(o => o.type !== 'group')).toBe(true);

    await page.keyboard.press('Control+Shift+z');
    doc = await getDoc(page);
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0].type).toBe('group');
  });
});
