<?php
/**
 * Template to display the hosted session payment fields.
 *
 * @since 1.0.0
 *
 * @package MPGSCore/Templates
 *
 * @var MPGSCore\Gateways\WC_Abstract_MPGS_Payment_Gateway_CC $gateway
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( empty( $gateway ) || empty( $session_id ) || empty( $session_attempt ) ) {
	return;
}

?>
<fieldset id="wc-<?php echo esc_attr( $gateway->id ); ?>-cc-form" class="wc-credit-card-form wc-payment-form <?php echo esc_attr( $gateway->id ); ?>-payment-form" data-field-type="card">
	<div class="form-row form-row-wide">
		<label for="<?php echo esc_attr( $gateway->id ); ?>-card-number"><?php esc_html_e( 'Card number', $gateway->mpgs_plugin()->text_domain() ); ?><span class="required">*</span></label>
		<input id="<?php echo esc_attr( $gateway->id ); ?>-card-number-<?php echo esc_attr( $session_id ); ?>" readonly="readonly" class="input-text wc-credit-card-form-card-number" inputmode="numeric" autocomplete="cc-number" autocorrect="no" autocapitalize="no" spellcheck="no" type="tel" placeholder="&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull;" style="background-image:none;" />
	</div>
	<div class="form-row form-row-first">
		<label for="<?php echo esc_attr( $gateway->id ); ?>-card-expiry-month"><?php esc_html_e( 'Expiry (MM)', $gateway->mpgs_plugin()->text_domain() ); ?><span class="required">*</span></label>
		<input id="<?php echo esc_attr( $gateway->id ); ?>-card-expiry-month-<?php echo esc_attr( $session_id ); ?>" readonly="readonly" class="input-text wc-credit-card-form-card-expiry" inputmode="numeric" autocomplete="cc-exp" autocorrect="no" autocapitalize="no" spellcheck="no" type="tel" placeholder="<?php esc_attr_e( 'MM', $gateway->mpgs_plugin()->text_domain() ); ?>" />
	</div>
	<div class="form-row form-row-last">
		<label for="<?php echo esc_attr( $gateway->id ); ?>-card-expiry-year"><?php esc_html_e( 'Expiry (YY)', $gateway->mpgs_plugin()->text_domain() ); ?><span class="required">*</span></label>
		<input id="<?php echo esc_attr( $gateway->id ); ?>-card-expiry-year-<?php echo esc_attr( $session_id ); ?>" readonly="readonly" class="input-text wc-credit-card-form-card-expiry" inputmode="numeric" autocomplete="cc-exp" autocorrect="no" autocapitalize="no" spellcheck="no" type="tel" placeholder="<?php esc_attr_e( 'YY', $gateway->mpgs_plugin()->text_domain() ); ?>" />
	</div>
	<div class="form-row form-row-wide">
		<label for="<?php echo esc_attr( $gateway->id ); ?>-card-cvc"><?php esc_html_e( 'Card code', $gateway->mpgs_plugin()->text_domain() ); ?><span class="required">*</span></label>
		<input id="<?php echo esc_attr( $gateway->id ); ?>-card-cvc-<?php echo esc_attr( $session_id ); ?>" readonly="readonly" class="input-text wc-credit-card-form-card-cvc" inputmode="numeric" autocomplete="off" autocorrect="no" autocapitalize="no" spellcheck="no" type="tel" maxlength="4" placeholder="<?php esc_attr_e( 'CVC', $gateway->mpgs_plugin()->text_domain() ); ?>" />
	</div>
	<div class="clear"></div>
	<input type="hidden" id="<?php echo esc_attr( $gateway->id ); ?>_session_id" name="<?php echo esc_attr( $gateway->id ); ?>_session_id" value="<?php echo esc_attr( $session_id ); ?>" />
	<input type="hidden" id="<?php echo esc_attr( $gateway->id ); ?>_session_attempt" name="<?php echo esc_attr( $gateway->id ); ?>_session_attempt" value="<?php echo esc_attr( $session_attempt ); ?>" />
	<input type="hidden" id="<?php echo esc_attr( $gateway->id ); ?>_session_version" name="<?php echo esc_attr( $gateway->id ); ?>_session_version" />
</fieldset>
