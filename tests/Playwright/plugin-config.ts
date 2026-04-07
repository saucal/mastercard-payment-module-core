import type { PluginConfig } from './plugin-config.types';

const config: PluginConfig = {
  paymentMethodSlug: 'mastercard_merchant_cloud',
  paymentMethodSlugsAlt: ['acme'],
  displayName: 'WooCommerce Gateway Acme Plugin',
  settingsOptionName: 'woocommerce_mastercard_merchant_cloud_settings',
  mpgsIframePattern: 'iframe[src*="test-gateway.mastercard.com"]',
  transactionIdMetaKey: 'mastercard_merchant_cloud_order_id',
  products: {
    physical: 1103,
    digital: 1594,
    subscription: 1274,
  },
};

export default config;
