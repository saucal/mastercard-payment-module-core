<?php
/**
 * Template to display the hosted checkout payment fields.
 *
 * @since 1.0.0
 *
 * @package MPGSCore/Templates
 */

defined( 'ABSPATH' ) || exit;

if ( empty( $gateway ) || empty( $session_id ) ) {
	return;
}

$prefix      = $gateway->mpgs_plugin()->mpgs_core()->get_prefix();
$is_embedded = 'embedded' === $gateway->get_option( 'hosted_checkout_mode' );
?>
<div id="<?php echo esc_attr( $prefix ); ?>-hosted-checkout-container" class="mpgs-hosted-checkout-container <?php echo esc_attr( $prefix ); ?>-hosted-checkout<?php echo esc_attr( $is_embedded ) ? ' embedded-checkout' : ''; ?>" data-session-id="<?php echo esc_attr( $session_id ); ?>">
	<?php if ( ! $is_embedded ) : ?>
		<p><?php echo esc_html( $gateway->description ); ?></p>
	<?php endif; ?>
</div>
<script>
	function <?php echo esc_html( $prefix ); ?>ErrorCallback( error ) {
		document.dispatchEvent( new CustomEvent( '<?php echo esc_html( $prefix ); ?>_error_callback', { detail: error } ) );
	}

	function <?php echo esc_html( $prefix ); ?>CancelCallback() {
		document.dispatchEvent( new CustomEvent( '<?php echo esc_html( $prefix ); ?>_cancel_callback' ) );
	}
</script>
