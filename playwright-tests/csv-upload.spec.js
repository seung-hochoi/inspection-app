const { test } = require('playwright/test');

test('csv upload probe', async ({ page }) => {
  const logs = [];
  const pageErrors = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => pageErrors.push(String(err)));

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.locator('input[type=file]').first().setInputFiles(String.raw`C:\Users\승호\OneDrive\문서\cshqdatacsrsendl142100100_20260326_logis.csv`);
  await page.waitForTimeout(8000);

  console.log('BODY_START');
  console.log(await page.locator('body').innerText());
  console.log('BODY_END');
  console.log('CONSOLE_START');
  for (const item of logs) console.log(item);
  console.log('CONSOLE_END');
  console.log('PAGEERROR_START');
  for (const item of pageErrors) console.log(item);
  console.log('PAGEERROR_END');

  await page.screenshot({ path: 'C:/inspection-app/artifacts/csv-after-upload-full.png', fullPage: true });
});
