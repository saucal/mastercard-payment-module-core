<?php
/**
 * Subscriptions interface.
 *
 * @class   Subscriptions
 * @version 1.0.0
 * @package GatewayPaymentCore/GatewayAddons/
 */

namespace GatewayPaymentCore\GatewayAddons;

use GatewayPaymentCore\Utils;
use WC_Order;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Dynamic Currency Conversion Interface.
 */
trait DynamicCurrencyConversion {

	/**
	 * Whether DCC is enabled.
	 *
	 * @var bool
	 */
	protected $dcc_enabled = false;

	/**
	 * Initialize Subscription support features.
	 *
	 * @return void
	 */
	public function init_addon_dcc() {
		// Ensure the trait is used in a class that extends WC_Abstract_Payment_Gateway.
		if ( ! is_a( $this, 'GatewayPaymentCore\Gateways\WC_Abstract_Payment_Gateway' ) ) {
			return;
		}

		// Process DCC when the payment is processed.
		add_action( $this->prefix_hook( 'payment_success' ), array( $this, 'process_dcc_data' ), 10, 2 );

		// Render DCC data on the order edit page.
		add_action( 'woocommerce_admin_order_data_after_billing_address', array( $this, 'render_dcc_data' ) );

		if ( $this->is_hosted_checkout() ) {
			return; // DCC is automatically supported in hosted checkout mode.
		}

		// Add DCC settings to the gateway settings.
		add_filter( $this->prefix_hook( 'gateway_settings' ), array( $this, 'settings_addon_dcc' ) );

		$this->dcc_enabled = ! empty( $this->get_option( 'currency_conversion' ) && 'yes' === $this->get_option( 'currency_conversion' ) );

		if ( ! $this->dcc_enabled ) {
			return;
		}

		// Get a quote for a saved token.
		add_action( 'wc_ajax_' . $this->prefix_hook( 'dcc_quote' ), array( $this, 'ajax_dcc_quote' ) );

		add_action( $this->prefix_hook( 'hosted_session_created' ), array( $this, 'clean_cached_total' ) );

		add_action( $this->prefix_hook( 'after_payment_fields_hosted_session' ), array( $this, 'display_dcc_info_area' ), 20 );

		add_action( $this->prefix_hook( 'payment_fields_hosted_session_template_data' ), array( $this, 'dcc_payment_fields_hosted_session_template_data' ) );

		add_action( $this->prefix_hook( 'after_payment_method_fields', 'wc_' ), array( $this, 'dcc_after_payment_method_fields' ) );

		add_action( 'woocommerce_cart_loaded_from_session', array( $this, 'init_dcc_hooks' ), 20 );
	}

	/**
	 * Add DCC settings to the gateway settings.
	 *
	 * @param array $settings Gateway settings.
	 *
	 * @return array
	 */
	public function settings_addon_dcc( $settings ) {
		$settings = Utils::insert_around_key(
			$settings,
			'advanced',
			array(
				'currency_conversion' => array(
					'title'       => __( 'Dynamic Currency Conversion', $this->core_plugin->text_domain() ),
					'label'       => __( 'Enable the Dynamic Currency Conversion (DCC) feature.', $this->core_plugin->text_domain() ),
					'type'        => 'checkbox',
					'default'     => 'yes',
					'description' => __(
						'If enabled, offers real-time exchange rates and lets payers choose between paying in your preferred currency or their card\'s currency.',
						$this->core_plugin->text_domain()
					),
					'desc_tip'    => true,
				),
			),
			0
		);
		return $settings;
	}


	/**
	 * Initialization hooks.
	 */
	public function init_dcc_hooks() {
		if ( is_callable( array( $this, 'cart_contains_subscription' ) ) && self::cart_contains_subscription() ) {
			return; // DCC is not supported with subscriptions.
		}

		add_filter( $this->prefix_hook( 'localize_frontend_script' ), array( $this, 'add_dcc_script_data' ) );

		// Validate fields to ensure DCC data is correct.
		add_filter( $this->prefix_hook( 'validate_fields' ), array( $this, 'validate_dcc_data' ), 10, 1 );

		// Add DCC data to the payment data.
		add_filter( $this->prefix_hook( 'process_payment_hosted_session_data' ), array( $this, 'maybe_add_dcc_payment_data' ), 10, 2 );
		add_filter( $this->prefix_hook( 'process_payment_hosted_session_3ds_data' ), array( $this, 'maybe_add_dcc_payment_data' ), 10, 2 );

		// Render DCC data on the order receipt page.
		add_filter( 'woocommerce_get_order_item_totals', array( $this, 'render_dcc_data_receipt' ), 10, 2 );
	}


	/**
	 * Add DCC related data to the localized script data.
	 *
	 * @param  array $data Existing localized data.
	 * @return array
	 */
	public function add_dcc_script_data( $data ) {
		$data = array_merge(
			$data,
			array(
				'dccEnabled'         => $this->core_plugin->is_currency_conversion_enabled(),
				'dccRequestEndpoint' => $this->api()->get_domain() . 'paymentOptionsInquiry',
				'dccNonce'           => wp_create_nonce( $this->prefix_hook( 'dcc_nonce' ) ),
			)
		);

		return $data;
	}

	/**
	 * Validate DCC data.
	 *
	 * @param \WP_Error $errors Existing errors.
	 *
	 * @return \WP_Error
	 */
	public function validate_dcc_data( $errors ) {
		if ( empty( $_POST[ $this->id . '_dcc_request_id' ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return $errors;
		}

		if ( ! isset( $_POST['dccOfferState'] ) && ! isset( $_POST['dccofferstate'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
			$errors->add( 'dcc_offer_state_missing', __( 'Please select whether you want to accept or reject the currency conversion offer.', $this->core_plugin->text_domain() ) );
		}

		return $errors;
	}


	/**
	 * Add DCC payment data to the hosted session payment data if available.
	 *
	 * @param  array         $payment_data Existing payment data.
	 * @param  WC_Order|null $order        Order object.
	 *
	 * @return array
	 */
	public function maybe_add_dcc_payment_data( $payment_data, $order ) {
		if ( ! $this->is_order( $order ) ) {
			return $payment_data;
		}

		if ( empty( $_POST[ $this->id . '_dcc_request_id' ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return $payment_data;
		}

		$dcc_request_id = wc_clean( wp_unslash( $_POST[ $this->id . '_dcc_request_id' ] ) ); // phpcs:ignore WordPress.Security.NonceVerification

		$payment_data['currencyConversion'] = array(
			'requestId' => $dcc_request_id,
			'uptake'    => 'NOT_AVAILABLE',
		);

		// Assume the offer was rejected if no offer state is provided.
		$offer_state = false;
		if ( isset( $_POST['dccOfferState'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
			$offer_state = wc_clean( wp_unslash( $_POST['dccOfferState'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		} elseif ( isset( $_POST['dccofferstate'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
			// Checkout Blocks lowercase the field names.
			$offer_state = wc_clean( wp_unslash( $_POST['dccofferstate'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		}

		if ( (bool) $offer_state ) {
			if ( 'Unavailable' === $offer_state ) {
				$payment_data['currencyConversion']['uptake'] = 'NOT_AVAILABLE';
			} else {
				$payment_data['currencyConversion']['uptake'] = 'Accept' === $offer_state ? 'ACCEPTED' : 'DECLINED';
			}
		}

		return $payment_data;
	}


	/**
	 * Process DCC data after a successful payment.
	 *
	 * @param \WC_Order $order       Order object.
	 * @param array     $order_data  Order data.
	 *
	 * @return void
	 */
	public function process_dcc_data( $order, $order_data ) {
		if ( empty( $order_data['currencyConversion']['uptake'] ) || 'ACCEPTED' !== $order_data['currencyConversion']['uptake'] ) {
			return;
		}

		if ( empty( $order_data['currencyConversion']['payerExchangeRate'] ) || empty( $order_data['currencyConversion']['payerCurrency'] ) || empty( $order_data['currencyConversion']['payerAmount'] ) ) {
			return;
		}

		$order->update_meta_data( $this->prefix_hook( 'dcc_exchange_rate' ), $order_data['currencyConversion']['payerExchangeRate'] );
		$order->update_meta_data( $this->prefix_hook( 'dcc_currency' ), $order_data['currencyConversion']['payerCurrency'] );
		$order->update_meta_data( $this->prefix_hook( 'dcc_amount' ), $order_data['currencyConversion']['payerAmount'] );
		$order->save_meta_data();
	}


	/**
	 * Clean cached total when a new hosted session is created.
	 *
	 * @param string $session_id Hosted session ID.
	 * @return void
	 */
	public function clean_cached_total( $session_id ) {
		if ( ! WC()->session ) {
			return;
		}

		$session_key = $this->prefix_hook( 'session_total_' . $session_id );
		WC()->session->__unset( $session_key );
	}


	/**
	 * Render DCC data on the order receipt page.
	 *
	 * @param array     $order_total_items Order total items.
	 * @param \WC_Order $order             Order object.
	 *
	 * @return array
	 */
	public function render_dcc_data_receipt( $order_total_items, $order ) {
		$dcc_data = $this->get_dcc_data_from_order( $order );
		if ( ! $dcc_data ) {
			return $order_total_items;
		}

		$dcc_item = array(
			'dcc_info' => array(
				'label' => __( 'Paid Amount:', $this->core_plugin->text_domain() ),
				'value' => sprintf(
					/* translators: 1: Converted amount with currency symbol, 2: Currency code */
					__( '%1$s (%2$s)', $this->core_plugin->text_domain() ),
					wc_price( $dcc_data['amount'], array( 'currency' => $dcc_data['currency'] ) ),
					$dcc_data['currency'],
				),
			),
		);

		$order_total_items = array_merge( $order_total_items, $dcc_item );
		return $order_total_items;
	}


	/**
	 * Render DCC data on the order edit page.
	 *
	 * @param \WC_Order $order Order object.
	 * @return void
	 */
	public function render_dcc_data( $order ) {
		$dcc_data = $this->get_dcc_data_from_order( $order );
		if ( ! $dcc_data ) {
			return;
		}

		?>
		<h4><?php esc_html_e( 'Dynamic Currency Conversion (DCC)', $this->core_plugin->text_domain() ); ?></h4>
		<p>
			<strong><?php esc_html_e( 'Original Currency:', $this->core_plugin->text_domain() ); ?></strong> <?php echo esc_html( $order->get_currency() ); ?>
			<br />
			<strong><?php esc_html_e( 'Payment Currency:', $this->core_plugin->text_domain() ); ?></strong> <?php echo esc_html( $dcc_data['currency'] ); ?>
			<br />
			<strong><?php esc_html_e( 'Original Amount:', $this->core_plugin->text_domain() ); ?></strong> <?php echo wp_kses_post( wc_price( $order->get_total(), array( 'currency' => $order->get_currency() ) ) ); ?>
			<br />
			<strong><?php esc_html_e( 'Paid Amount (Converted):', $this->core_plugin->text_domain() ); ?></strong> <?php echo wp_kses_post( wc_price( $dcc_data['amount'], array( 'currency' => $dcc_data['currency'] ) ) ); ?>
			<br />
			<strong><?php esc_html_e( 'Exchange Rate:', $this->core_plugin->text_domain() ); ?></strong> <?php echo esc_html( $dcc_data['exchange_rate'] ); ?>
		</p>
		<?php
	}


	/**
	 * Get DCC data from an order.
	 *
	 * @param \WC_Order $order Order object.
	 * @return array|null
	 */
	public function get_dcc_data_from_order( $order ) {
		if ( ! is_a( $order, 'WC_Order' ) ) {
			return null;
		}

		$dcc_exchange_rate = $order->get_meta( $this->prefix_hook( 'dcc_exchange_rate' ) );
		$dcc_currency      = $order->get_meta( $this->prefix_hook( 'dcc_currency' ) );
		$dcc_amount        = $order->get_meta( $this->prefix_hook( 'dcc_amount' ) );

		if ( ! $dcc_exchange_rate || ! $dcc_currency || ! $dcc_amount ) {
			return null;
		}

		return array(
			'exchange_rate' => $dcc_exchange_rate,
			'currency'      => $dcc_currency,
			'amount'        => $dcc_amount,
		);
	}


	/**
	 * AJAX handler to get a DCC quote for a saved token.
	 *
	 * @return void
	 */
	public function ajax_dcc_quote() {
		if ( ! isset( $_POST['nonce'] ) || ! wp_verify_nonce( wc_clean( wp_unslash( $_POST['nonce'] ) ), $this->prefix_hook( 'dcc_nonce' ) ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			wp_send_json_error();
		}

		if ( ! isset( $_POST['token_id'] ) ) {
			wp_send_json_error();
		}

		if ( ! WC()->cart || ! WC()->session ) {
			wp_send_json_error();
		}

		$token_id = wc_clean( wp_unslash( $_POST['token_id'] ) );
		$order    = null;
		if ( isset( $_POST['order_id'] ) ) {
			$order_id = wc_clean( wp_unslash( $_POST['order_id'] ) );
			$order    = wc_get_order( $order_id );
		}

		try {
			$token = new \WC_Payment_Token_CC( $token_id );

			if ( ! $token->get_id() || $token->get_user_id() !== get_current_user_id() || $token->get_gateway_id() !== $this->id ) {
				wp_send_json_error();
			}

			$result = $this->api()->payment_options_inquiry(
				array(
					'apiOperation'  => 'PAYMENT_OPTIONS_INQUIRY',
					'order'         => array(
						'amount'   => Utils::get_current_total_amount( $order ),
						'currency' => Utils::get_current_currency( $order ),
					),
					'sourceOfFunds' => array(
						'token' => $token->get_token(),
					),
				)
			);

			if ( 'SUCCESS' !== $result['body']['result'] ) {
				$this->core_plugin->logger()->log( 'DCC quote request failed: ' . wp_json_encode( $result ), 'error' );
				wp_send_json_error();
			}

			if ( empty( $result['body']['paymentTypes']['card']['currencyConversion'] ) ) {
				wp_send_json_success();
			}

			$request_id = $result['body']['paymentTypes']['card']['currencyConversion']['requestId'] ?? null;
			$offer_text = $result['body']['paymentTypes']['card']['currencyConversion']['offerText'] ?? null;

			if ( ! $request_id || ! $offer_text ) {
				wp_send_json_error();
			}

			wp_send_json_success(
				array(
					'requestId' => $request_id,
					'offerText' => $offer_text,
				)
			);
		} catch ( \Exception $e ) {
			$this->core_plugin->logger()->log( 'DCC quote request failed: ' . $e->getMessage(), 'error' );
			wp_send_json_error();
		}
	}

	/**
	 * Display DCC info area on the checkout page.
	 *
	 * @return void
	 */
	public function display_dcc_info_area() {
		if ( $this->dcc_enabled && ! is_add_payment_method_page() ) {
			echo '<div id="' . esc_attr( $this->id ) . '_currency_conversion" class="payment-core-currency-conversion"></div>';
		}
	}

	/**
	 * Add DCC data to the hosted session template data.
	 *
	 * @param array $template_data Template data.
	 *
	 * @return array
	 */
	public function dcc_payment_fields_hosted_session_template_data( $template_data ) {
		$template_data['dcc_enabled'] = $this->dcc_enabled;
		return $template_data;
	}

	/**
	 * Output hidden DCC request ID field after payment method fields.
	 *
	 * @return void
	 */
	public function dcc_after_payment_method_fields() {
		echo '<input type="hidden" id="' . esc_attr( $this->id ) . '_dcc_request_id" name="' . esc_attr( $this->id ) . '_dcc_request_id" />';
	}
}
