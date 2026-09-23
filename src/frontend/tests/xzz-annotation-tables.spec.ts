import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// iPhoneXSMAX Common problems: a 3-board pack whose repair table (caption 通病,
// header 故障现象 / 故障点 / 处理方法, 7 rows) is drawn as 32 loose text records.
// Before the 0x06 TEXT block was read, BoardRipper drew the table's ruled lines
// and none of its text.
const FILE = path.resolve(__dirname, '../../../samples/XZZ PCB SAMPLES/iPhoneXSMAX/iPhoneXSMAX Common problems.pcb');
const haveSample = fs.existsSync(FILE);

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
});

test('annotation table renders as an HTML table with lang and translate hints', async ({ page }) => {
  test.skip(!haveSample, 'samples/XZZ PCB SAMPLES/iPhoneXSMAX not present');
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(FILE);
  await expect(page.getByTestId('statusbar')).toContainText('Components:', { timeout: 120000 });

  await page.locator('.board-sidebar-toggle').first().click();
  await page.locator('[data-board-tab="info"]').click();
  const table = page.getByTestId('annotation-table');
  await expect(table).toHaveCount(1);
  await expect(table.locator('caption')).toHaveText('通病');
  await expect(table.locator('thead th')).toHaveText(['故障现象', '故障点', '处理方法']);
  await expect(table.locator('tbody tr')).toHaveCount(7);

  // Chinese runs are tagged for the translator; identifiers are fenced off
  // from it, and the ones this board carries are chips that select them.
  await expect(table.locator('th[lang="zh-CN"]')).toHaveCount(3);
  await expect(table.locator('[translate="no"] [data-part="J3200"]')).toHaveCount(1);

  if (process.env.ANNOTATION_SHOT) {
    await page.locator('.annotation-tables').screenshot({ path: process.env.ANNOTATION_SHOT });
    await page.screenshot({ path: process.env.ANNOTATION_SHOT.replace(/\.png$/, '-full.png') });
  }
});

test('a net with a glossary description shows it under the net name in the pin table', async ({ page }) => {
  test.skip(!haveSample, 'samples/XZZ PCB SAMPLES/iPhoneXSMAX not present');
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(FILE);
  await expect(page.getByTestId('statusbar')).toContainText('Components:', { timeout: 120000 });
  await page.locator('.board-sidebar-toggle').first().click();
  await page.locator('[data-board-tab="info"]').click();

  // Any part with a pin on a described net; select it the way the other specs do.
  const target = await page.evaluate(() => {
    const board = (window as unknown as { __boardStore: { activeTab: { board: {
      parts: { name: string; pins: { net: string }[] }[]; netDescriptions?: Map<string, string>;
    } } } }).__boardStore.activeTab.board;
    const i = board.parts.findIndex(p => p.pins.some(pin => board.netDescriptions?.has(pin.net)));
    const net = board.parts[i].pins.find(pin => board.netDescriptions?.has(pin.net))!.net;
    return { partIndex: i, desc: board.netDescriptions!.get(net)! };
  });
  await page.evaluate((i) => (window as unknown as { __boardStore: { selectPart(i: number): void } }).__boardStore.selectPart(i), target.partIndex);

  const desc = page.getByTestId('pin-net-desc').filter({ hasText: target.desc }).first();
  await expect(desc).toBeVisible();
  await expect(desc).toHaveAttribute('lang', 'zh-CN');

  if (process.env.ANNOTATION_SHOT) {
    await page.getByTestId('component-info').screenshot({ path: process.env.ANNOTATION_SHOT.replace(/\.png$/, '-pinnet.png') });
  }
});

test('the net glossary renders as a second, collapsible table under the fault table', async ({ page }) => {
  test.skip(!haveSample, 'samples/XZZ PCB SAMPLES/iPhoneXSMAX not present');
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(FILE);
  await expect(page.getByTestId('statusbar')).toContainText('Components:', { timeout: 120000 });
  await page.locator('.board-sidebar-toggle').first().click();
  await page.locator('[data-board-tab="info"]').click();

  const glossary = page.getByTestId('net-glossary');
  await expect(glossary.locator('summary')).toHaveText('Net descriptions (505)');
  await glossary.locator('summary').click();
  await expect(glossary.getByTestId('net-glossary-entry')).toHaveCount(505);
  // A described net this board carries is a chip; its description is tagged.
  const entry = glossary.getByTestId('net-glossary-entry').filter({ has: page.locator('[data-net="PP_VDD_BOOST"]') });
  await expect(entry.locator('[lang="zh-CN"]')).toHaveText('升压供电');

  if (process.env.ANNOTATION_SHOT) {
    await page.locator('.annotation-tables').screenshot({ path: process.env.ANNOTATION_SHOT.replace(/\.png$/, '-glossary.png') });
  }
});
