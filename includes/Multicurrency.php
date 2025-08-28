<?php
/**
 * Class to interact with the Multicurrency.
 *
 * @class       Multicurrency
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore;

use GatewayPaymentCore\API;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Multicurrency class.
 */
final class Multicurrency {

	/**
	 * Cookie name used for currency selection.
	 *
	 * @var string
	 */
	const COOKIE_CURRENCY_NAME = 'wc_mastercard_currency';

	/**
	 * Transient name used to store exchange rates.
	 *
	 * @var string
	 */
	const CURRENCY_RATES_TRANSIENT = 'wc_mastercard_currency_rates';

	/**
	 * Plugin core instance.
	 *
	 * @var CorePlugin
	 */
	private $core_plugin;

	/**
	 * Selected currency by user or session.
	 *
	 * @var string
	 */
	protected $currency_selected;

	/**
	 * Original store currency.
	 *
	 * @var string
	 */
	public $original_currency;

	/**
	 * Currency config.
	 *
	 * @var string
	 */
	protected $currency_config;

	/**
	 * API instance.
	 *
	 * @var API
	 */
	protected $api;

	/**
	 * Constructor.
	 *
	 * @param CorePlugin $core_plugin Core plugin instance.
	 */
	public function __construct( CorePlugin $core_plugin ) {
		$this->core_plugin = $core_plugin;
		$this->original_currency = 'USD';

		if ( $this->is_multicurrency_enabled() ) {
			add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_dcc_inline_data' ), 20 );
			add_action( $this->core_plugin->payment_core()->prefix_hook( 'gateway_dcc_probe' ), array( $this, 'maybe_throw_dcc_sentinel' ), 10, 3 );
			add_filter( $this->core_plugin->payment_core()->prefix_hook( 'gateway_adjust_payment_data' ), array( $this, 'filter_adjust_payment_data' ), 10, 1 );
			add_filter( $this->core_plugin->payment_core()->prefix_hook( 'enqueue_scripts' ), array( $this, 'add_multicurrency_js' ) );
		}
	}

	/**
	 * Adjusts payment_data with user-selected currency and conversion quote.
	 *
	 * @param array     $payment_data Base payload prepared for the PSP.
	 * @return array
	 */
	public function filter_adjust_payment_data( array $payment_data ) : array {

		if( $this->is_multicurrency_enabled()  && isset( $_POST['payment_currency'] ) ) {
			$conversion = WC()->session ? WC()->session->get( 'currency_conversion' ) : null;
			if( $_POST['payment_currency'] === $conversion['payerCurrency'] ) {
				$payment_data['order']['currency'] = $conversion['payerCurrency'];
				$payment_data['order']['amount']   = $conversion['payerAmount'];
			}
		}

		return $payment_data;
	}


	/**
	 * Checks for DCC availability and throws a sentinel exception to let the UI
	 * present currency choices on the checkout screen.
	 *
	 * @param \WC_Order $order   The WooCommerce order object (not yet charged).
	 * @param array     $session Hosted Session array (contains the session id).
	 *
	 * @return void
	 * @throws \Exception When conversion is available (sentinel) or on hard failures.
	 */
	public function maybe_throw_dcc_sentinel( \WC_Order $order, array $session, $api ) : void {

		if ( ! $this->is_multicurrency_enabled() || isset( $_POST['payment_currency'] )) {
			return;
		}

		$data = array(
			'order'   => array(
				'amount'   => $order->get_total(),
				'currency' => 'USD',
			),
			'session' => $session,
		);

		$response = $api->payment_options_inquiry( $data );
		$conversion = $response['body']['paymentTypes']['card']['currencyConversion'] ?? null;

		if ( ! empty( $conversion )
			&& isset( $conversion['gatewayCode'] )
			&& 'QUOTE_PROVIDED' === $conversion['gatewayCode']
		) {
			if ( WC()->session ) {
				WC()->session->set( 'currency_conversion', $conversion );
			}

			$message = __( '[ACME_DCC_AVAILABLE] Currency conversion available.', $this->core_plugin->text_domain() );
			throw new \Exception( $message );
		}
	}

	public function enqueue_dcc_inline_data() : void {
		// Only on classic/blocks checkout page, not on thankyou.
		if ( ! function_exists( 'is_checkout' ) || ! is_checkout() || is_order_received_page() ) {
			return;
		}

		if ( ! WC()->session ) {
			return;
		}

		$conv = WC()->session->get( 'currency_conversion' );
		if ( empty( $conv ) ) {
			return;
		}

		// Prepare values.
		$eur_amount   = wc_format_decimal( $conv['payerAmount'], 2 );
		$eur_currency = isset( $conv['payerCurrency'] ) ? (string) $conv['payerCurrency'] : 'EUR';

		// Ensure a valid target handle is enqueued.
		// Classic checkout uses 'wc-checkout'; Blocks use 'wc-blocks-checkout'.
		$handle = null;

		// If not already enqueued, enqueue classic checkout to attach inline code.
		if ( wp_script_is( 'wc-checkout', 'enqueued' ) || wp_script_is( 'wc-checkout', 'registered' ) ) {
			wp_enqueue_script( 'wc-checkout' );
			$handle = 'wc-checkout';
		}

		// Fallback for Checkout Blocks.
		if ( ! $handle && ( wp_script_is( 'wc-blocks-checkout', 'enqueued' ) || wp_script_is( 'wc-blocks-checkout', 'registered' ) ) ) {
			wp_enqueue_script( 'wc-blocks-checkout' );
			$handle = 'wc-blocks-checkout';
		}

		if ( ! $handle ) {
			// Nothing to attach to; bail out.
			return;
		}

		// Build a safe JS payload (use wp_json_encode to avoid quoting issues).
		$payload = sprintf(
			'window.currencyConversion = { amount: %s, currency: %s };',
			wp_json_encode( (string) $eur_amount ),
			wp_json_encode( (string) $eur_currency )
		);

		// Print before the target handle (works for both classic and blocks).
		wp_add_inline_script( $handle, $payload, 'before' );
	}

	/**
	 * Checks if multicurrency feature is enabled.
	 *
	 * @return bool True if enabled, false otherwise.
	 */
	public function is_multicurrency_enabled() {
		return 'yes' === $this->core_plugin->get_gateway_setting( 'multicurrency' );
	}

	/**
	 * Enqueue multicurrency js only if it is active.
	 *
	 * @param array $args Enqueued scripts.
	 *
	 * @return array
	 */
	public function add_multicurrency_js( $args ) {
		if ( $this->is_multicurrency_enabled() ) {
			$args[ $this->core_plugin->payment_core()->prefix_hook( 'multicurrency' ) ] = array(
				'src'  => $this->core_plugin->assets_controller()->localize_asset( 'js/frontend/multicurrency.js' ),
				'data' => array(
					'ajax_url'    => 'adsf',
					'cookie_name' => '123',
				),
			);
		}
		return $args;
	}
}
