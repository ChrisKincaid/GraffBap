import { expect, test } from '@playwright/test';

test('local Admin can inspect competition entries and disqualify with an audited reason', async ({ page }) => {
  await page.goto('http://127.0.0.1:4201/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('admin@example.test');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('LocalTest123!');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByRole('heading', { name: 'Graph Bap Competitions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Graph Bap Competitions', exact: true })).toBeVisible();
  await expect(page.getByText('Automation:', { exact: false })).toBeVisible();
  const competition = page.getByRole('combobox', { name: 'Competition', exact: true });
  const id = await competition.locator('option').evaluateAll(options =>
    options.find(option => option.textContent?.includes('Haunted Yard') && option.textContent?.includes('open'))?.getAttribute('value'));
  expect(id).toBeTruthy();
  await competition.selectOption(id!);
  const article = page.locator('article').filter({ hasText: 'Demo HAUNTED' });
  await expect(article).toBeVisible();
  const dialogs: string[] = [];
  page.on('dialog', async dialog => {
    dialogs.push(dialog.type());
    await dialog.accept(dialog.type() === 'prompt' ? 'Local browser test: off-theme demonstration' : undefined);
  });
  await article.getByRole('button', { name: 'Disqualify Entry', exact: true }).click();
  await expect(article).toContainText('Status: buffed', { timeout: 15_000 });
  await expect(article.getByRole('button', { name: 'Disqualify Entry', exact: true })).toBeDisabled();
  expect(dialogs).toEqual(['prompt', 'confirm']);
});
