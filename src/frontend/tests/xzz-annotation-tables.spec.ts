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
