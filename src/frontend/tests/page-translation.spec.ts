import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, '../public/samples/test-board.bvr');

// What Chrome's "Translate page" does to the DOM: every text node it handles is
// replaced by <font><font>text</font></font>. React still holds the original
// node, so inserting an element next to a translated text node throws
// NotFoundError and the panel's error boundary takes the whole board viewer down.
function simulateTranslation() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const parent = t.parentElement;
    if (t.nodeValue?.trim() && parent && !parent.closest('[translate="no"], script, style, font, canvas')) nodes.push(t);
  }
  for (const t of nodes) {
    const outer = document.createElement('font');
    const inner = document.createElement('font');
    inner.textContent = t.nodeValue;
    outer.appendChild(inner);
    t.parentNode!.replaceChild(outer, t);
  }
}

test('selecting pins after "Translate page" does not crash the Info panel', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('[data-testid="file-input"]', FIXTURE);
  await expect(page.getByTestId('statusbar')).toContainText('Components:', { timeout: 60000 });
  await page.locator('.board-sidebar-toggle').first().click();
  await page.locator('[data-board-tab="info"]').click();

  const target = await page.evaluate(() => {
    const parts = (window as unknown as { __boardStore: { activeTab: { board: { parts: { pins: unknown[] }[] } } } })
      .__boardStore.activeTab.board.parts;
    const i = parts.findIndex(p => p.pins.length >= 4);
    return { partIndex: i, pins: parts[i].pins.length };
  });
  await page.evaluate((i) => (window as unknown as { __boardStore: { selectPart(i: number): void } }).__boardStore.selectPart(i), target.partIndex);
  await expect(page.getByTestId('component-info')).toBeVisible();

  // Selecting a pin mounts the net caret and counts beside the net name. Try
  // pins until one has a net with a branch, translating before each.
  for (let pin = 0; pin < target.pins; pin++) {
    await page.evaluate(simulateTranslation);
    await page.evaluate(([i, p]) => (window as unknown as { __boardStore: { selectPin(i: number, p: number): void } })
      .__boardStore.selectPin(i, p), [target.partIndex, pin]);
    await expect(page.getByText('This panel crashed')).toHaveCount(0);
    if (await page.getByTestId('net-caret').count()) break;
  }
  await expect(page.getByTestId('net-caret')).toBeVisible();
});
