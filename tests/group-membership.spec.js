const { test, expect } = require('@playwright/test');
const { openApp, getDoc, getSel, addShape, moveObj, clickObject } = require('./helpers');

/* Moving an object in or out of a group is a coordinate change, not just a
   list change — a child's x/y live in its group's local frame. So almost
   every test here measures the same thing: the object's *document-space*
   box before and after, which must not budge. */
const docBox = (page, id) => page.evaluate(id => {
  const g = doc.objects.find(o => o.type === 'group' && o.children.some(c => c.id === id));
  const o = g ? bakeChild(g.children.find(c => c.id === id), g)
              : doc.objects.find(o => o.id === id);
  if (!o) return null;
  const b = localBox(o);
  const r = n => Math.round(n * 10) / 10;
  return { x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) };
}, id);

const near = (a, b, tol = 1) =>
  ['x', 'y', 'w', 'h'].every(k => Math.abs(a[k] - b[k]) <= tol);

/* two shapes at distinct positions, grouped, plus a third left loose */
async function scene(page) {
  const id1 = await addShape(page, 'r');
  await moveObj(page, id1, 300, 300);
  const id2 = await addShape(page, 'c');
  await clickObject(page, id1, { modifiers: ['Shift'] });
  await page.keyboard.press('Control+g');
  const groupId = await page.evaluate(() => doc.objects.find(o => o.type === 'group').id);

  const loose = await addShape(page, 'r');
  await moveObj(page, loose, -700, 800);      // well clear of the group's bbox
  return { id1, id2, groupId, loose };
}

const join = (page, ids, gid) => page.evaluate(([ids, gid]) => {
  moveMembership(ids, gid);
}, [ids, gid]);
const leave = (page, ids) => page.evaluate(ids => { moveMembership(ids, null); }, ids);

test.describe('group membership', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test.describe('joining a group', () => {
    test('a loose object keeps its place on the artboard', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      const before = await docBox(page, loose);

      await join(page, [loose], groupId);

      const d = await getDoc(page);
      expect(d.objects).toHaveLength(1);                       // absorbed
      expect(d.objects[0].children).toHaveLength(3);
      expect(near(await docBox(page, loose), before)).toBe(true);
    });

    test('and so do the objects already in there', async ({ page }) => {
      const { id1, id2, groupId, loose } = await scene(page);
      const b1 = await docBox(page, id1), b2 = await docBox(page, id2);

      await join(page, [loose], groupId);

      expect(near(await docBox(page, id1), b1)).toBe(true);
      expect(near(await docBox(page, id2), b2)).toBe(true);
    });

    test('the group grows to enclose the newcomer', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      const before = await getDoc(page);
      const g0 = before.objects.find(o => o.id === groupId);

      await join(page, [loose], groupId);

      const g1 = (await getDoc(page)).objects[0];
      expect(g1.w).toBeGreaterThan(g0.w);
      expect(g1.h).toBeGreaterThan(g0.h);
    });

    test('it survives a rotated, resized group', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      await page.evaluate(gid => {
        const g = doc.objects.find(o => o.id === gid);
        g.rot = 37; g.w = g.w * 1.4; g.h = g.h * 1.4; touch();
      }, groupId);
      const before = await docBox(page, loose);

      await join(page, [loose], groupId);

      expect(near(await docBox(page, loose), before, 2)).toBe(true);
    });

    test('a group refuses to go inside another group', async ({ page }) => {
      const { groupId } = await scene(page);
      const a = await addShape(page, 'r');
      await moveObj(page, a, -900, 900);
      const b = await addShape(page, 'c');
      await moveObj(page, b, -900, 1200);
      await page.evaluate(([a, b]) => { sel = [a, b]; groupSel(); }, [a, b]);
      const other = await page.evaluate(() =>
        doc.objects.filter(o => o.type === 'group').map(o => o.id).find(id => id));

      const n = (await getDoc(page)).objects.length;
      await join(page, [other], groupId);
      const d = await getDoc(page);
      expect(d.objects).toHaveLength(n);                       // nothing moved
      expect(d.objects.every(o => o.type !== 'group' ||
        o.children.every(c => c.type !== 'group'))).toBe(true);
    });

    test('⌘G on a group plus loose objects grows the group', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      await page.evaluate(([gid, l]) => { sel = [gid, l]; }, [groupId, loose]);
      await page.keyboard.press('Control+g');

      const d = await getDoc(page);
      expect(d.objects).toHaveLength(1);
      expect(d.objects[0].id).toBe(groupId);
      expect(d.objects[0].children.map(c => c.id)).toContain(loose);
    });

    test('two groups still refuse to merge', async ({ page }) => {
      const { groupId } = await scene(page);
      const a = await addShape(page, 'r');
      await moveObj(page, a, -900, 900);
      const b = await addShape(page, 'c');
      await moveObj(page, b, -900, 1200);
      await page.evaluate(([a, b]) => { sel = [a, b]; groupSel(); }, [a, b]);

      const before = await getDoc(page);
      await page.evaluate(() => {
        sel = doc.objects.filter(o => o.type === 'group').map(o => o.id); groupSel();
      });
      expect((await getDoc(page)).objects).toHaveLength(before.objects.length);
    });

    test('joining is undoable', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      await join(page, [loose], groupId);
      expect((await getDoc(page)).objects).toHaveLength(1);
      await page.keyboard.press('Control+z');
      const d = await getDoc(page);
      expect(d.objects).toHaveLength(2);
      expect(d.objects.find(o => o.id === loose)).toBeTruthy();
    });
  });

  test.describe('leaving a group', () => {
    /* a third child, so the group still has two left and survives the exit */
    async function trio(page) {
      const s = await scene(page);
      await join(page, [s.loose], s.groupId);
      return s;
    }

    test('the object keeps its place on the artboard', async ({ page }) => {
      const { loose } = await trio(page);
      const before = await docBox(page, loose);
      await leave(page, [loose]);

      const d = await getDoc(page);
      expect(d.objects).toHaveLength(2);
      expect(d.objects.find(o => o.id === loose)).toBeTruthy();
      expect(near(await docBox(page, loose), before)).toBe(true);
    });

    test('the ones staying behind keep theirs too', async ({ page }) => {
      const { id1, id2, loose } = await trio(page);
      const b1 = await docBox(page, id1), b2 = await docBox(page, id2);
      await leave(page, [loose]);
      expect(near(await docBox(page, id1), b1)).toBe(true);
      expect(near(await docBox(page, id2), b2)).toBe(true);
    });

    test('it lands just above the group it left, not on top of everything', async ({ page }) => {
      const { groupId, loose } = await trio(page);
      // joining leaves you drilled into the group, where a new shape would
      // land inside it — back out first so this one really is top-level
      await page.evaluate(() => { enter(null); sel = []; });
      // something above the group, so "on top" and "above the group" differ
      const over = await addShape(page, 'c');
      await moveObj(page, over, 900, -400);

      await leave(page, [loose]);
      const ids = (await getDoc(page)).objects.map(o => o.id);
      expect(ids.indexOf(loose)).toBe(ids.indexOf(groupId) + 1);
      expect(ids[ids.length - 1]).toBe(over);          // still the topmost
    });

    test('a group dropping below two children dissolves', async ({ page }) => {
      const { id1, id2 } = await scene(page);
      await leave(page, [id1]);
      const d = await getDoc(page);
      expect(d.objects.some(o => o.type === 'group')).toBe(false);
      expect(d.objects.map(o => o.id)).toEqual(expect.arrayContaining([id1, id2]));
    });

    test('a mask flag does not survive the trip out', async ({ page }) => {
      const { id1, loose } = await trio(page);
      await page.evaluate(id => { toggleMask(id); }, id1);
      expect(await page.evaluate(id =>
        !!doc.objects[0].children.find(c => c.id === id).mask, id1)).toBe(true);

      await leave(page, [id1]);
      expect(await page.evaluate(id =>
        !!doc.objects.find(o => o.id === id).mask, id1)).toBe(false);
    });

    test('leaving is undoable', async ({ page }) => {
      const { loose } = await trio(page);
      await leave(page, [loose]);
      expect((await getDoc(page)).objects).toHaveLength(2);
      await page.keyboard.press('Control+z');
      const d = await getDoc(page);
      expect(d.objects).toHaveLength(1);
      expect(d.objects[0].children).toHaveLength(3);
    });
  });

  test.describe('from the layers list', () => {
    const openLayers = page => page.evaluate(() => { tab = 'layers'; panel(); });

    /* HTML5 drag-and-drop can't be driven by mouse events in Playwright, so
       these fire the same DataTransfer sequence the list listens for. What
       gets aimed at is a *gap*: `above`/`below` name the row it sits against,
       `bottom` is the strip under the last row. The pointer's x rides along
       too — past the children's indent means "into the group" on the one gap
       where two lists overlap. */
    async function dragTo(page, fromId, { above, below, bottom, indent = false, dropIt = true } = {}) {
      await page.evaluate(([f, above, below, bottom, indent, dropIt]) => {
        const list = document.getElementById('layerList');
        const lb = list.getBoundingClientRect();
        const src = document.querySelector(`.ly[data-pick="${f}"]`);
        let target, clientY;
        if (bottom) {
          const rows = [...list.querySelectorAll('.ly[data-pick]')];
          target = list;
          clientY = rows[rows.length - 1].getBoundingClientRect().bottom + 6;
        } else {
          const anchor = above != null ? above : below;
          target = document.querySelector(`.ly[data-pick="${anchor}"]`);
          const r = target.getBoundingClientRect();
          // top quarter reads as "above this row", bottom quarter as "below"
          clientY = above != null ? r.top + r.height * 0.25 : r.top + r.height * 0.75;
        }
        const clientX = lb.left + (indent ? 60 : 2);
        const dt = new DataTransfer();
        const ev = (type, opts) => new DragEvent(type,
          { bubbles: true, cancelable: true, dataTransfer: dt, ...opts });
        src.dispatchEvent(ev('dragstart'));
        target.dispatchEvent(ev('dragover', { clientX, clientY }));
        if (dropIt) target.dispatchEvent(ev('drop', { clientX, clientY }));
      }, [fromId, above, below, bottom, indent, dropIt]);
    }
    /* where the indicator sits, as a gap index: how many rows start above it */
    const lineAt = page => page.evaluate(() => {
      const line = document.getElementById('dropline');
      if (line.style.display === 'none' || !line.style.display) return null;
      const y = line.getBoundingClientRect().top;
      const rows = [...document.querySelectorAll('#layerList .ly[data-pick]')];
      return { gap: rows.filter(r => r.getBoundingClientRect().top < y - 1).length,
               into: line.classList.contains('in') };
    });
    /* the rendered order, top of the stack first — what the list shows */
    const rowsOf = page => page.evaluate(() =>
      [...document.querySelectorAll('.ly[data-pick]')].map(r => ({
        id: +r.dataset.pick, parent: r.dataset.parent ? +r.dataset.parent : null })));

    test('a gap between a group\'s children takes the object into the group', async ({ page }) => {
      const { id1, groupId, loose } = await scene(page);
      const before = await docBox(page, loose);
      await openLayers(page);
      await dragTo(page, loose, { below: id1, indent: true });

      const d = await getDoc(page);
      expect(d.objects).toHaveLength(1);
      expect(d.objects[0].id).toBe(groupId);
      expect(d.objects[0].children.map(c => c.id)).toContain(loose);
      expect(near(await docBox(page, loose), before)).toBe(true);
    });

    /* the gap directly under a group's own row can only mean one thing:
       there is no top-level position between a group and its first child */
    test('the gap under the group row is the first slot inside it', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      await openLayers(page);
      await dragTo(page, loose, { below: groupId });

      const rows = await rowsOf(page);
      expect(rows[0]).toEqual({ id: groupId, parent: null });
      expect(rows[1]).toEqual({ id: loose, parent: groupId });
      expect((await getDoc(page)).objects).toHaveLength(1);
    });

    /* the gap past a group's last child is the one place two lists overlap */
    test('past the last child, the indent picks bottom-of-group over top level', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      await openLayers(page);
      const lastKid = (await rowsOf(page)).filter(r => r.parent === groupId).pop().id;

      await dragTo(page, loose, { below: lastKid, indent: true });
      const rows = await rowsOf(page);
      expect(rows[rows.length - 1]).toEqual({ id: loose, parent: groupId });
      expect((await getDoc(page)).objects).toHaveLength(1);
    });

    test('…and the gutter there keeps it at the top level, below the group', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      await openLayers(page);
      const lastKid = (await rowsOf(page)).filter(r => r.parent === groupId).pop().id;

      await dragTo(page, loose, { below: lastKid });
      const d = await getDoc(page);
      expect(d.objects).toHaveLength(2);
      expect(d.objects[0].id).toBe(loose);            // below the group in the stack
      expect(d.objects.find(o => o.id === groupId).children).toHaveLength(2);
    });

    /* the two positions no row-as-target scheme could ever name */
    test('the gap above the first row is the very top of the stack', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      await openLayers(page);
      expect((await rowsOf(page))[0].id).toBe(loose);  // loose is added last, so it starts on top

      await dragTo(page, groupId, { above: loose });
      const rows = await rowsOf(page);
      expect(rows[0]).toEqual({ id: groupId, parent: null });
      expect((await getDoc(page)).objects).toHaveLength(2);
    });

    test('the strip below the last row is the very bottom', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      await openLayers(page);
      // loose starts at the bottom of doc.objects; put it on top, then send it back
      await page.evaluate(l => {
        const i = doc.objects.findIndex(o => o.id === l);
        doc.objects.push(doc.objects.splice(i, 1)[0]); touch();
      }, loose);
      expect((await rowsOf(page))[0].id).toBe(loose);

      await dragTo(page, loose, { bottom: true });
      const d = await getDoc(page);
      expect(d.objects[0].id).toBe(loose);            // array index 0 == bottom of the stack
      expect(d.objects.find(o => o.id === groupId).children).toHaveLength(2);
    });

    /* the case that has no other gesture at all: nothing is at the top level
       except the group, so both escape hatches are the list's outer gaps */
    test.describe('when every object lives in one group', () => {
      async function allInside(page) {
        const s = await scene(page);
        await join(page, [s.loose], s.groupId);       // doc.objects === [group]
        await page.evaluate(() => { enter(null); sel = []; });
        return s;
      }

      test('a child can be dragged out over the top gap', async ({ page }) => {
        const { groupId } = await allInside(page);
        await openLayers(page);
        expect((await getDoc(page)).objects).toHaveLength(1);

        const kid = (await rowsOf(page)).filter(r => r.parent === groupId)[0].id;
        const before = await docBox(page, kid);
        await dragTo(page, kid, { above: groupId });

        const d = await getDoc(page);
        expect(d.objects).toHaveLength(2);
        expect(d.objects.find(o => o.id === kid)).toBeTruthy();
        expect((await rowsOf(page))[0]).toEqual({ id: kid, parent: null });
        expect(near(await docBox(page, kid), before)).toBe(true);
      });

      test('or out over the bottom gap', async ({ page }) => {
        const { groupId } = await allInside(page);
        await openLayers(page);
        const kid = (await rowsOf(page)).filter(r => r.parent === groupId).pop().id;
        const before = await docBox(page, kid);

        await dragTo(page, kid, { bottom: true });    // gutter x, so: top level

        const d = await getDoc(page);
        expect(d.objects).toHaveLength(2);
        expect(d.objects[0].id).toBe(kid);            // bottom of the stack
        expect(near(await docBox(page, kid), before)).toBe(true);
      });
    });

    test('the line is drawn where the object will actually land', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      await openLayers(page);
      // rendered top-first: [loose, group, kid, kid] — 4 rows, 5 gaps
      const kids = (await rowsOf(page)).filter(r => r.parent === groupId);
      const lastKid = kids[kids.length - 1].id;

      await dragTo(page, loose, { below: lastKid, indent: true, dropIt: false });
      expect(await lineAt(page)).toEqual({ gap: 4, into: true });

      // same pixel row, gutter x: the top level below the *whole* group. The
      // group's children render under it, so that is the same gap — the
      // indent is the only thing that can tell the two apart, and does.
      await dragTo(page, loose, { below: lastKid, dropIt: false });
      expect(await lineAt(page)).toEqual({ gap: 4, into: false });

      // dragging the group itself to the top gap reads as the top gap
      await dragTo(page, groupId, { above: loose, dropIt: false });
      expect(await lineAt(page)).toEqual({ gap: 0, into: false });
    });

    test('a group row cannot be dropped into a group', async ({ page }) => {
      const { id1, groupId } = await scene(page);
      const a = await addShape(page, 'r');
      await moveObj(page, a, -900, 900);
      const b = await addShape(page, 'c');
      await moveObj(page, b, -900, 1200);
      await page.evaluate(([a, b]) => { sel = [a, b]; groupSel(); }, [a, b]);
      const other = await page.evaluate(() =>
        doc.objects.filter(o => o.type === 'group').find(g => g.id !== undefined).id);

      await openLayers(page);
      const before = (await getDoc(page)).objects.length;
      // aimed squarely inside the other group's children
      await dragTo(page, other, { below: id1, indent: true });
      const d = await getDoc(page);
      expect(d.objects).toHaveLength(before);
      expect(d.objects.every(o => o.type !== 'group' ||
        o.children.every(c => c.type !== 'group'))).toBe(true);
    });

    /* rearranging a stack is a run of small moves — switching to the
       selection tab after each drop puts the list back behind a tab click */
    test('a drop leaves you in the layers tab, whichever way it went', async ({ page }) => {
      const { id1, groupId, loose } = await scene(page);
      await openLayers(page);

      await dragTo(page, loose, { below: id1, indent: true });    // into the group
      expect(await page.evaluate(() => tab)).toBe('layers');
      expect(await getSel(page)).toEqual([loose]);                // still selects it

      await dragTo(page, loose, { above: groupId });              // and back out
      expect(await page.evaluate(() => tab)).toBe('layers');
    });

    test('so does a plain same-list reorder', async ({ page }) => {
      const { id1, id2 } = await scene(page);
      await openLayers(page);
      await dragTo(page, id1, { below: id2, indent: true });
      expect(await page.evaluate(() => tab)).toBe('layers');
    });

    test('reordering within one list is untouched', async ({ page }) => {
      const { id1, id2, groupId } = await scene(page);
      await openLayers(page);
      const kids0 = (await rowsOf(page)).filter(r => r.parent === groupId).map(r => r.id);
      // send the top child to the bottom of its own list
      await dragTo(page, kids0[0], { below: kids0[kids0.length - 1], indent: true });

      const d = await getDoc(page);
      expect(d.objects).toHaveLength(2);                          // nobody left the group
      const kids = d.objects.find(o => o.id === groupId).children.map(c => c.id);
      expect(kids).toHaveLength(2);
      expect(kids).toEqual(expect.arrayContaining([id1, id2]));
      expect((await rowsOf(page)).filter(r => r.parent === groupId).map(r => r.id))
        .toEqual([...kids0].reverse());
    });
  });

  test.describe('the panel offers it', () => {
    test('ADD TO GROUP appears for a group plus a loose object', async ({ page }) => {
      const { groupId, loose } = await scene(page);
      await page.evaluate(([g, l]) => { sel = [g, l]; tab = 'selection'; panel(); }, [groupId, loose]);
      await expect(page.locator('#addToGroup')).toHaveCount(1);
    });

    test('MOVE OUT appears for a child, and works', async ({ page }) => {
      const { id1 } = await scene(page);
      await page.evaluate(id => { sel = [id]; entered = null; tab = 'selection'; panel(); }, id1);
      await expect(page.locator('#outOfGroup')).toHaveCount(1);
      await page.locator('#outOfGroup').click();
      expect((await getDoc(page)).objects.find(o => o.id === id1)).toBeTruthy();
    });

    test('neither shows for a plain loose object', async ({ page }) => {
      const { loose } = await scene(page);
      await page.evaluate(l => { sel = [l]; tab = 'selection'; panel(); }, loose);
      await expect(page.locator('#addToGroup')).toHaveCount(0);
      await expect(page.locator('#outOfGroup')).toHaveCount(0);
    });
  });
});
