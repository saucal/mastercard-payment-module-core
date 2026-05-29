<?php
/**
 * Template to display the hosted checkout payment fields.
 *
 * @since 1.0.0
 *
 * @package GatewayPaymentCore/Templates
 */

defined( 'ABSPATH' ) || exit;

if ( empty( $gateway ) || empty( $session_id ) ) {
	return;
}

?>
<div id="PAYMENTS_CORE_HOOK_PREFIX-hosted-checkout-container" class="payment-core-hosted-checkout-container PAYMENTS_CORE_HOOK_PREFIX-hosted-checkout<?php echo esc_attr( $gateway->is_embedded_checkout() ) ? ' embedded-checkout' : ''; ?>" data-session-id="<?php echo esc_attr( $session_id ); ?>">
	<?php if ( ! $gateway->is_embedded_checkout() ) : ?>
		<p><?php echo esc_html( $gateway->description ); ?></p>
	<?php endif; ?>
</div>
