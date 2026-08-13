import type { PluginConfig } from './plugin-config.types';

const slug = process.env.GATEWAY_SLUG || 'acme';
// Meta key prefix: in unbuilt state, the plugin uses the literal placeholder
// 'PAYMENTS_CORE_HOOK_PREFIX'. After build, it's replaced with the slug (e.g. 'acme').
const metaPrefix = process.env.META_PREFIX || 'PAYMENTS_CORE_HOOK_PREFIX';

const config: PluginConfig = {
  paymentMethodSlug: slug,
  paymentMethodSlugsAlt: slug === 'acme' ? ['mastercard_merchant_cloud'] : ['acme'],
  displayName: process.env.GATEWAY_DISPLAY_NAME || 'WooCommerce Gateway Acme Plugin',
  settingsOptionName: `woocommerce_${slug}_settings`,
  mpgsIframePattern: 'iframe[src*="test-gateway.mastercard.com"]',
  transactionIdMetaKey: `${metaPrefix}_order_id`,
  sessionIdMetaKey: `${metaPrefix}_session_id`,
  tokenMetaKey: `${metaPrefix}_token`,
  products: {
    physical: parseInt(process.env.PRODUCT_PHYSICAL || '61', 10),
    digital: parseInt(process.env.PRODUCT_DIGITAL || '316', 10),
    subscription: parseInt(process.env.PRODUCT_SUBSCRIPTION || '66', 10),
    // Both verified on mastercard.mystagingwebsite.com 2026-08-13: simple
    // products with _wc_pre_orders_enabled=yes and the charge mode below.
    // Override per install — suite 20 asserts both are non-zero, since a
    // non-pre-order product would make its assertions pass vacuously.
    preOrderUpfront: parseInt(process.env.PRODUCT_PREORDER_UPFRONT || '1595', 10),
    preOrderRelease: parseInt(process.env.PRODUCT_PREORDER_RELEASE || '4789', 10),
  },
  // Written by DynamicCurrencyConversion::process_dcc_data, prefixed with the
  // same build-time hook prefix as every other meta key.
  dccMetaKeys: {
    exchangeRate: `${metaPrefix}_dcc_exchange_rate`,
    currency: `${metaPrefix}_dcc_currency`,
    amount: `${metaPrefix}_dcc_amount`,
  },
};

export default config;
