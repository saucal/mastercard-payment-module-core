import { test, expect } from '../../fixtures/test';
import { addToCartAndCheckout } from '../../helpers/cart';
import { selectPaymentMethod, clickPlaceOrder, getCheckoutError } from '../../helpers/checkout';
import { fillHostedSessionCCPartial } from '../../helpers/hosted-session';
import { waitForUnblock } from '../../helpers/block-ui';
import config from '../../plugin-config';

test.describe.serial('MC-003 - Invalid missing expiry year (Classic)', () => {
  test('Place order with missing expiry year shows error', async ({ page }) => {
    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await fillHostedSessionCCPartial(page, config, {
      number: '5123456789012346',
      month: '01',
      cvv: '100',
    });
    await clickPlaceOrder(page);
    await waitForUnblock(page);

    const error = await getCheckoutError(page);
    expect(error).toContain('Expiry year invalid or missing');
  });
});
