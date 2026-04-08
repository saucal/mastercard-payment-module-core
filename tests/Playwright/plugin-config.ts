import type { PluginConfig } from './plugin-config.types';

const slug = process.env.GATEWAY_SLUG || 'acme';

const config: PluginConfig = {
  paymentMethodSlug: slug,
  paymentMethodSlugsAlt: slug === 'acme' ? ['mastercard_merchant_cloud'] : ['acme'],
  displayName: process.env.GATEWAY_DISPLAY_NAME || 'WooCommerce Gateway Acme Plugin',
  settingsOptionName: `woocommerce_${slug}_settings`,
  mpgsIframePattern: 'iframe[src*="test-gateway.mastercard.com"]',
  transactionIdMetaKey: `${slug}_order_id`,
  sessionIdMetaKey: `${slug}_session_id`,
  tokenMetaKey: `${slug}_token`,
  products: {
    physical: parseInt(process.env.PRODUCT_PHYSICAL || '61', 10),
    digital: parseInt(process.env.PRODUCT_DIGITAL || '316', 10),
    subscription: parseInt(process.env.PRODUCT_SUBSCRIPTION || '66', 10),
  },
};

export default config;
