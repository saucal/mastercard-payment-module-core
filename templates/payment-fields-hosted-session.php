<?php
/**
 * Template to display the hosted session payment fields.
 *
 * @since 1.0.0
 *
 * @package GatewayPaymentCore/Templates
 *
 * @var GatewayPaymentCore\Gateways\WC_Abstract_Payment_Gateway_CC $gateway
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( empty( $gateway ) ) {
	return;
}

if ( isset( $threeds_data ) && ! empty( $threeds_data ) ) {
	?>
	<div id="<?php echo esc_attr( $gateway->id ); ?>_3ds_form" style="display: none;" data-3ds-data="<?php echo esc_attr( wp_json_encode( $threeds_data ) ); ?>"></div>
	<?php
	return;
}

if ( empty( $session_id ) || empty( $session_attempt ) ) {
	return;
}

?>
<fieldset id="wc-<?php echo esc_attr( $gateway->id ); ?>-cc-form" class="wc-credit-card-form wc-payment-form <?php echo esc_attr( $gateway->id ); ?>-payment-form payment-core-payment-form" data-field-type="card">
	<legend class="screen-reader-text">
		<span><?php esc_html_e( 'New card fields', $gateway->core_plugin()->text_domain() ); ?></span>
	</legend>
	<div class="<?php echo esc_attr( $gateway->id ); ?>-payment-form-elements payment-core-payment-form-elements">
		<div class="form-row form-row-wide">
			<label for="<?php echo esc_attr( $gateway->id ); ?>-card-number-<?php echo esc_attr( $session_id ); ?>"><?php esc_html_e( 'Card number', $gateway->core_plugin()->text_domain() ); ?><span class="required">*</span></label>
			<input id="<?php echo esc_attr( $gateway->id ); ?>-card-number-<?php echo esc_attr( $session_id ); ?>" readonly="readonly" class="input-text wc-credit-card-form-card-number" inputmode="numeric" autocomplete="cc-number" autocorrect="no" autocapitalize="no" spellcheck="no" type="text" placeholder="&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull;" aria-required="true" aria-invalid="false" aria-describedby="<?php echo esc_attr( $gateway->id ); ?>-card-number-label" />
		</div>
		<div class="form-row form-row-first">
			<label for="<?php echo esc_attr( $gateway->id ); ?>-card-expiry-month-<?php echo esc_attr( $session_id ); ?>"><?php esc_html_e( 'Expiry (MM)', $gateway->core_plugin()->text_domain() ); ?><span class="required">*</span></label>
			<input id="<?php echo esc_attr( $gateway->id ); ?>-card-expiry-month-<?php echo esc_attr( $session_id ); ?>" readonly="readonly" class="input-text wc-credit-card-form-card-expiry" inputmode="numeric" autocomplete="cc-exp" autocorrect="no" autocapitalize="no" spellcheck="no" type="text" placeholder="<?php esc_attr_e( 'MM', $gateway->core_plugin()->text_domain() ); ?>" aria-required="true" aria-invalid="false" aria-describedby="<?php echo esc_attr( $gateway->id ); ?>-card-expiry-month" />
		</div>
		<div class="form-row form-row-last">
			<label for="<?php echo esc_attr( $gateway->id ); ?>-card-expiry-year-<?php echo esc_attr( $session_id ); ?>"><?php esc_html_e( 'Expiry (YY)', $gateway->core_plugin()->text_domain() ); ?><span class="required">*</span></label>
			<input id="<?php echo esc_attr( $gateway->id ); ?>-card-expiry-year-<?php echo esc_attr( $session_id ); ?>" readonly="readonly" class="input-text wc-credit-card-form-card-expiry" inputmode="numeric" autocomplete="cc-exp" autocorrect="no" autocapitalize="no" spellcheck="no" type="text" placeholder="<?php esc_attr_e( 'YY', $gateway->core_plugin()->text_domain() ); ?>" aria-required="true" aria-invalid="false" aria-describedby="<?php echo esc_attr( $gateway->id ); ?>-card-expiry-year" />
		</div>
		<div class="form-row form-row-wide">
			<label for="<?php echo esc_attr( $gateway->id ); ?>-card-cvc-<?php echo esc_attr( $session_id ); ?>"><?php esc_html_e( 'Card code', $gateway->core_plugin()->text_domain() ); ?><span class="required">*</span></label>
			<input id="<?php echo esc_attr( $gateway->id ); ?>-card-cvc-<?php echo esc_attr( $session_id ); ?>" readonly="readonly" class="input-text wc-credit-card-form-card-cvc" inputmode="numeric" autocomplete="cc-csc" autocorrect="no" autocapitalize="no" spellcheck="no" type="text" maxlength="4" placeholder="<?php esc_attr_e( 'CVC', $gateway->core_plugin()->text_domain() ); ?>" aria-required="true" aria-invalid="false" aria-describedby="<?php echo esc_attr( $gateway->id ); ?>-card-cvc" />
		</div>
	</div>
	<div class="clear"></div>
	<input type="hidden" id="<?php echo esc_attr( $gateway->id ); ?>_session_id" name="<?php echo esc_attr( $gateway->id ); ?>_session_id" value="<?php echo esc_attr( $session_id ); ?>" />
	<input type="hidden" id="<?php echo esc_attr( $gateway->id ); ?>_session_attempt" name="<?php echo esc_attr( $gateway->id ); ?>_session_attempt" value="<?php echo esc_attr( $session_attempt ); ?>" />
	<input type="hidden" id="<?php echo esc_attr( $gateway->id ); ?>_session_version" name="<?php echo esc_attr( $gateway->id ); ?>_session_version" />
	<?php if( isset( $enable_3ds ) && $enable_3ds ): ?>
		<input type="hidden" id="<?php echo esc_attr( $gateway->id ); ?>_3ds_data" name="<?php echo esc_attr( $gateway->id ); ?>_3ds_data" />
	<?php endif; ?>
	<?php if( isset( $dcc_enabled ) && $dcc_enabled ): ?>
		<input type="hidden" id="<?php echo esc_attr( $gateway->id ); ?>_dcc_request_id" name="<?php echo esc_attr( $gateway->id ); ?>_dcc_request_id" />
	<?php endif; ?>

	<?php
	$gateway->maybe_display_save_card_notice();

	/**
	 * Render additional content after the payment method fields.
	 */
	do_action( 'wc_' . $gateway->id . '_after_payment_method_fields' );
	?>
</fieldset>
