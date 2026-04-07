import { test, expect } from '@playwright/test';
import { switchCheckoutMode, configureGateway } from '../../helpers/api';
import { addToCartAndCheckout } from '../../helpers/cart';
import { selectPaymentMethod } from '../../helpers/checkout';
import { assertSessionFieldsPresent } from '../../helpers/hosted-session';
import config from '../../plugin-config';

test.describe.serial('MC-001 - Session loading (Blocks)', () => {
  test('Session iframe fields are present', async ({ page }) => {
    await switchCheckoutMode('blocks');
    await configureGateway(config, {
      _3d_secure: 'yes',
      saved_cards: 'yes',
      transaction_mode: 'PURCHASE',
      checkout_mode: 'hosted_session',
    });

    await addToCartAndCheckout(page, config.products.physical);
    await selectPaymentMethod(page, config);
    await assertSessionFieldsPresent(page, config);
  });
});
