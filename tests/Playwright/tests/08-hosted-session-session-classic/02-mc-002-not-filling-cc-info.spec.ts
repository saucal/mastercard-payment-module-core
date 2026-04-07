import { test, expect } from '@playwright/test';
import { addToCartAndCheckout } from '../../helpers/cart';
import { selectPaymentMethod, clickPlaceOrder, getCheckoutError } from '../../helpers/checkout';
import { waitForUnblock } from '../../helpers/block-ui';
import config from '../../plugin-config';

test.describe.serial('MC-002 - Not filling CC info (Classic)', () => {
  test('Place order without CC shows validation error', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await clickPlaceOrder(page);
    await waitForUnblock(page);

    const error = await getCheckoutError(page);
    expect(error).toContain('Card number invalid or missing');
    expect(error).toContain('Expiry month invalid or missing');
    expect(error).toContain('Expiry year invalid or missing');
  });
});
