import { test, expect } from '@playwright/test';
import { addToCartAndCheckout } from '../../helpers/cart';
import { selectPaymentMethod, clickPlaceOrder, getCheckoutError } from '../../helpers/checkout';
import { fillHostedSessionCCPartial } from '../../helpers/hosted-session';
import { waitForUnblock } from '../../helpers/block-ui';
import config from '../../plugin-config';

test.describe.serial('MC-003 - Invalid missing expiry month (Classic)', () => {
  test('Place order with missing expiry month shows error', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCCPartial(page, config, {
      number: '5123456789012346',
      year: '39',
      cvv: '100',
    });
    await clickPlaceOrder(page);
    await waitForUnblock(page);

    const error = await getCheckoutError(page);
    expect(error).toContain('Expiry month invalid or missing');
  });
});
