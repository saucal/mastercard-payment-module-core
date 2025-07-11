<?php
/**
 * Multicurrency Selector html
 *
 * @since      1.0.0
 *
 * @package GatewayPaymentCore/Templates
 */

defined( 'ABSPATH' ) || exit;
?>
<form class="mastercard-multicurrency" method="post" action="<?php echo esc_attr( WC_AJAX::get_endpoint( 'mastercard_set_multicurrency' ) ); ?>">
	<input type="hidden" name="action" value="mastercard_multicurrency_action">
	<select name="mastercard_currency_selector" class="mastercard_currency_selector">
		<option <?php selected( $currency_selected, $original_currency ); ?> value="<?php echo esc_attr( $original_currency ); ?>"><?php esc_html_e( 'Default Currency', 'woocommerce-bluesnap-gateway' ); ?></option>
		<?php foreach ( $options as $option ) : ?>
			<option <?php selected( $currency_selected, $option ); ?> value="<?php echo esc_attr( $option ); ?>" <?php echo ( 'all' !== $allowed && ! isset( $allowed[ $option ] ) ) ? 'disabled="disabled"' : ''; ?>><?php echo esc_html( $option ); ?></option>
		<?php endforeach; ?>
	</select>
	<?php $multicurrency->nonce_field(); ?>
</form>