import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';
const ITEM_NAME = 'Farinha E2E';
const ITEM_SKU = 'E2E-FAR-001';
const PRODUCT_NAME = 'Pao E2E';
const PRODUCT_SKU = 'E2E-PROD-001';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Senha').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function openNav(page: Page, href: string, readySelector: () => Promise<void>) {
  const modalOverlays = page.locator('.modal-overlay');
  if ((await modalOverlays.count()) > 0) {
    const overlay = modalOverlays.last();
    if (await overlay.isVisible().catch(() => false)) {
      const closeButton = overlay.getByRole('button', { name: 'Fechar' });
      if ((await closeButton.count()) > 0 && (await closeButton.first().isVisible().catch(() => false))) {
        await closeButton.first().click();
      } else {
        await overlay.click({ position: { x: 8, y: 8 } });
      }
      await expect(overlay).toBeHidden({ timeout: 5000 });
    }
  }

  await page.locator(`a[href="${href}"]`).click();
  await readySelector();
}

async function expectItemStock(page: Page, expected: RegExp) {
  const row = page.locator('tr', { hasText: ITEM_NAME }).first();
  await expect(row).toBeVisible();
  const stockCell = row.locator('td').nth(4);
  await expect(stockCell).toContainText(expected);
}

test.describe.serial('stock platform e2e', () => {
  test('flow 4: login and protected access', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await login(page);
    await expect(page.locator('.topbar-title')).toHaveText(ADMIN_EMAIL);
  });

  test('flow 1: create item/product/BOM and outbound qty=2 updates stock and cost', async ({ page }) => {
    await login(page);

    await openNav(page, '/items', async () => {
      await expect(page.getByRole('heading', { name: 'Itens / Materia-prima' })).toBeVisible();
    });
    await page.getByRole('button', { name: 'Criar item' }).click();
    await expect(page.getByRole('heading', { name: 'Criar item' })).toBeVisible();

    const createItemPanel = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Criar item' }) });
    await createItemPanel.getByLabel('Nome').fill(ITEM_NAME);
    await createItemPanel.getByLabel('SKU').fill(ITEM_SKU);
    await createItemPanel.getByLabel('Unidade').fill('kg');
    await createItemPanel.getByLabel(/Pre/).fill('10');
    await createItemPanel.getByLabel('Qtd inicial').fill('20');
    await createItemPanel.getByLabel(/Estoque minimo/i).fill('5');
    await createItemPanel.getByRole('button', { name: 'Criar item' }).click();
    await expect(page.getByText('Item criado com sucesso.')).toBeVisible();
    await expectItemStock(page, /20/);

    await openNav(page, '/products', async () => {
      await expect(page.getByRole('heading', { name: 'Produtos finais' })).toBeVisible();
    });
    await page.getByRole('button', { name: 'Criar produto' }).click();
    await expect(page.getByRole('heading', { name: 'Criar produto' })).toBeVisible();

    const createProductPanel = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Criar produto' }) });
    await createProductPanel.getByLabel('Nome').fill(PRODUCT_NAME);
    await createProductPanel.getByLabel('SKU').fill(PRODUCT_SKU);
    await createProductPanel.getByRole('button', { name: 'Criar produto' }).click();
    await expect(page.getByText('Produto criado com sucesso.')).toBeVisible();

    const productRow = page.locator('tr', { hasText: PRODUCT_NAME }).first();
    await productRow.getByRole('button', { name: 'Editar / BOM' }).click();

    const editPanel = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Editar produto / BOM' }) });
    await editPanel.getByRole('button', { name: 'Adicionar item' }).click();
    const bomRowPanel = editPanel.locator('.panel').last();
    await bomRowPanel.locator('select').selectOption({ index: 1 });
    await bomRowPanel.locator('input').first().fill('2.5');
    await editPanel.getByRole('button', { name: 'Salvar BOM' }).click();
    await expect(page.getByText('BOM salva com sucesso.')).toBeVisible();
    await expect(editPanel).toContainText(ITEM_NAME);

    await openNav(page, '/operations', async () => {
      await expect(page.getByRole('button', { name: 'Gerar preview' })).toBeVisible();
    });

    await page.getByLabel('Produto', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('Quantidade de produtos').fill('2');
    await page.getByRole('button', { name: 'Gerar preview' }).click();

    const previewPanel = page.locator('.panel').filter({ hasText: 'Custo total' }).first();
    await expect(previewPanel).toContainText('50');
    await expect(previewPanel).toContainText('25');
    await expect(previewPanel).toContainText(ITEM_NAME);

    await page.getByRole('button', { name: /Confirmar/ }).click();
    await expect(page.getByText(/sucesso/i)).toBeVisible();

    await openNav(page, '/items', async () => {
      await expect(page.getByRole('heading', { name: 'Itens / Materia-prima' })).toBeVisible();
    });
    await expectItemStock(page, /15/);
  });

  test('flow 2: inbound qty=3 credits stock', async ({ page }) => {
    await login(page);

    await openNav(page, '/operations', async () => {
      await expect(page.getByRole('button', { name: 'Gerar preview' })).toBeVisible();
    });
    await page.getByRole('button', { name: /Registrar entrada/ }).click();
    await page.getByLabel('Produto', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('Quantidade de produtos').fill('3');
    await page.getByLabel(/Origem \(link, vendedor, revenda, etc\)/).fill('Fornecedor teste');
    await page.getByRole('button', { name: 'Gerar preview' }).click();
    await expect(page.getByRole('button', { name: /Confirmar/ })).toBeEnabled();
    await page.getByRole('button', { name: /Confirmar/ }).click();
    await expect(page.getByText(/sucesso/i)).toBeVisible();

    await openNav(page, '/items', async () => {
      await expect(page.getByRole('heading', { name: 'Itens / Materia-prima' })).toBeVisible();
    });
    await expectItemStock(page, /22[,.]5/);
  });

  test('flow 3: outbound without stock shows blocker and does not change stock', async ({ page }) => {
    await login(page);

    await openNav(page, '/operations', async () => {
      await expect(page.getByRole('button', { name: 'Gerar preview' })).toBeVisible();
    });
    await page.getByRole('button', { name: /Registrar sa/ }).click();
    await page.getByLabel('Produto', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('Quantidade de produtos').fill('100');
    await page.getByRole('button', { name: 'Gerar preview' }).click();

    const previewPanel = page.locator('.panel').filter({ hasText: 'Bloqueios de estoque' }).first();
    await expect(previewPanel).toBeVisible();
    await expect(page.getByRole('button', { name: /Confirmar/ })).toBeDisabled();

    await openNav(page, '/items', async () => {
      await expect(page.getByRole('heading', { name: 'Itens / Materia-prima' })).toBeVisible();
    });
    await expectItemStock(page, /22[,.]5/);
  });
});
