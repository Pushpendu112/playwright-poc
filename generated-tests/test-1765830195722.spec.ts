import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://github.com/');
  await page.getByRole('button', { name: 'Resources' }).click();
  await page.getByLabel('Global').getByRole('link', { name: 'AI' }).click();
  await page.getByTestId('Grid-:R3b:').getByText('Software Development', { exact: true }).click();
  await page.locator('[id="FormControl--:R3mmnb:"] > .Primer_Brand__Checkbox-module__Checkbox-wrapper___qo8KL > .Primer_Brand__Checkbox-module__Checkbox___T8FJa').click();
  await page.getByTestId('Grid-:R3b:').getByText('Security', { exact: true }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
});