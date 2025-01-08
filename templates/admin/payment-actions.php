<?php
/**
 * Template to display the partial capture form.
 *
 * @since 1.0.0
 *
 * @package MPGSCore/Templates
 */

defined( 'ABSPATH' ) || exit;

if ( empty( $gateway ) || empty( $order ) ) {
	return;
}

if ( ! empty( $authorized_transaction ) ) :
	?>
	<div class="mpgs-void-form <?php echo esc_attr( $gateway->id ); ?>-void-form">
		<h4><?php esc_html_e( 'The Authorization can be Cancelled.', $gateway->mpgs_plugin()->text_domain() ); ?></h4>
		<div>
			<button type="submit" id="<?php echo esc_attr( $gateway->prefix_hook( 'void_transaction_button' ) ) ?>" type="submit" class="button button-primary"><?php esc_html_e( 'Cancel Authorization', $gateway->mpgs_plugin()->text_domain() ); ?></button>
			<input type="hidden" name="<?php echo esc_attr( $gateway->prefix_hook( 'void_transaction' ) ); ?>" value="0" />
		</div>
	</div>
	<?php
endif;

if ( ! empty( $auth_amount ) && $auth_amount > 0 ) :
	?>
	<div class="mpgs-capture-form <?php echo esc_attr( $gateway->id ); ?>-capture-form">
		<h4>
			<?php
			esc_html_e( 'Funds available to be captured', $gateway->mpgs_plugin()->text_domain() );
			echo wp_kses_post(
				wc_help_tip(
					__( 'The amount of authorized funds that can be captured.', $gateway->mpgs_plugin()->text_domain() )
				)
			);
			?>
		</h4>

		<span><?php echo wp_kses_post( wc_price( $auth_amount, array( 'currency', $order->get_currency() ) ) ); ?></span>

		<p>
			<input type="number" step="0.01" min="0.01" name="<?php echo esc_attr( $gateway->prefix_hook( 'capture_amount' ) ); ?>" id="<?php echo esc_attr( $gateway->prefix_hook( 'capture_amount' ) ); ?>" />
			<button type="submit" class="button button-primary"><?php esc_html_e( 'Capture', $gateway->mpgs_plugin()->text_domain() ); ?></button>
		</p>
	</div>
<?php endif; ?>
