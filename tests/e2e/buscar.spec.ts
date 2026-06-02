import { test, expect } from '@playwright/test';

test('buscar, filtrar y abrir detalle', async ({ page }) => {
  await page.goto('/buscar');
  await expect(page.getByText('Fierrin')).toBeVisible();

  // aplicar filtro de marca
  await page.locator('select').first().selectOption('Volkswagen');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page).toHaveURL(/brand=Volkswagen/);

  // abrir el primer resultado
  const firstCard = page.locator('a[href^="/aviso/"]').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();

  // el detalle muestra el link al portal original
  await expect(page.getByRole('link', { name: 'Ver publicación original' })).toBeVisible();
});
