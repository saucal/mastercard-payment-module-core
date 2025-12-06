<?php
/**
 * Abstract CC Payment Gateway class.
 *
 * @class       AbstractPaymentGateway
 * @version     1.0.0
 * @package     GatewayPaymentCore/Gateways/
 */

namespace GatewayPaymentCore\Gateways;

use WC_Admin_Settings;
use WC_Order;
use Exception;
use WP_Error;
use GatewayPaymentCore\Utils;
use WC_Payment_Token_CC;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Show the payment form for the Payment Gateway.
 */
abstract class WC_Abstract_Payment_Gateway_CC extends WC_Abstract_Payment_Gateway {

	// Register the Addons trait.
	use \GatewayPaymentCore\GatewayAddons\Subscriptions;
	use \GatewayPaymentCore\GatewayAddons\PreOrders;
	use \GatewayPaymentCore\GatewayAddons\DynamicCurrencyConversion;


	/**
	 * Hosted checkout handle.
	 *
	 * @var string
	 */
	const HOSTED_CHECKOUT_HANDLE = 'hosted_checkout';


	/**
	 * Hosted session handle.
	 *
	 * @var string
	 */
	const HOSTED_SESSION_HANDLE = 'hosted_session';


	/**
	 * Hosted session attempt limit.
	 *
	 * @var int
	 */
	const HOSTED_SESSION_ATTEMPT_LIMIT = 20;


	/**
	 * Block compatibility class.
	 *
	 * @var string
	 */
	protected $block_compat_class = 'WC_Payment_Gateway_Block_Compat_CC';


	/**
	 * Merchant ID.
	 *
	 * @var string
	 */
	protected $merchant_id;


	/**
	 * Merchant name.
	 *
	 * @var string
	 */
	protected $merchant_name;


	/**
	 * Checkout mode.
	 *
	 * @var string
	 */
	protected $checkout_mode;


	/**
	 * Hosted checkout mode.
	 *
	 * @var string
	 */
	protected $hosted_checkout_mode;


	/**
	 * Transaction mode.
	 *
	 * @var string
	 */
	protected $transaction_mode;


	/**
	 * Saved cards enabled.
	 *
	 * @var bool
	 */
	protected $saved_cards = false;


	/**
	 * 3DS enabled.
	 *
	 * @var bool
	 */
	protected $enable_3ds = false;


	/**
	 * DCC enabled.
	 *
	 * @var bool
	 */
	protected $dcc_enabled = false;


	/**
	 * Debug enabled.
	 *
	 * @var bool
	 */
	protected $debug = false;


	/**
	 * Display save card checkbox.
	 *
	 * @param bool
	 */
	protected $display_save_checkbox = true;


	/**
	 * Initialize the gateway.
	 */
	public function build() {

		// Load the form fields.
		$this->init_form_fields();

		// Load the settings.
		$this->init_settings();

		// Load common settings.
		$this->title                = $this->get_option( 'title' );
		$this->enabled              = $this->get_option( 'enabled' );
		$this->description          = $this->get_option( 'description' );
		$this->checkout_mode        = $this->get_option( 'checkout_mode' );
		$this->hosted_checkout_mode = $this->get_option( 'hosted_checkout_mode' );
		$this->transaction_mode     = $this->get_option( 'transaction_mode' );
		$this->merchant_id          = $this->get_option( 'merchant_id' );
		$this->merchant_name        = ! empty( $this->get_option( 'merchant_name' ) ) ? $this->get_option( 'merchant_name' ) : get_bloginfo( 'name' );
		$this->saved_cards          = ! empty( $this->get_option( 'saved_cards' ) && 'yes' === $this->get_option( 'saved_cards' ) );
		$this->enable_3ds           = ! empty( $this->get_option( '_3d_secure' ) && 'yes' === $this->get_option( '_3d_secure' ) );
		$this->dcc_enabled          = ! empty( $this->get_option( 'currency_conversion' ) && 'yes' === $this->get_option( 'currency_conversion' ) );
		$this->debug                = ! empty( $this->get_option( 'debug' ) && 'yes' === $this->get_option( 'debug' ) );

		// Load the gateway support features.
		$this->init_supports();

		// Initialize the Addons.
		$this->init_addons();

		// Add hooks.
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'validate_credentials' ) );
		add_action( 'woocommerce_receipt_' . $this->id, array( $this, 'payment_fields' ) );
		add_action( $this->prefix_hook( 'process_payment_error' ), array( $this, 'handle_failed_payment' ), 10, 2 );
		add_filter( 'woocommerce_get_customer_payment_tokens', array( $this, 'hide_saved_token_hosted_checkout' ), 10 );
		add_action( 'set_logged_in_cookie', array( $this, 'set_cookie_on_current_request' ) );

		// Add plugin return callbacks.
		add_action( 'template_redirect', array( $this, 'maybe_handle_return_callback' ) );

		// Add API actions.
		add_action( 'woocommerce_api_' . $this->prefix_hook( 'wc-webhook' ), array( $this, 'process_notification_api_callback' ) );

		add_filter( $this->prefix_hook( 'enqueue_scripts' ), array( $this, 'enqueue_scripts' ), 20 );
		add_filter( 'script_loader_tag', array( $this, 'maybe_add_callbacks_attr' ), 10, 3 );

		// Gateway AJAX actions.
		add_action( 'wc_ajax_' . $this->prefix_hook( 'reset_hosted_session' ), array( $this, 'ajax_clean_hosted_cached_session' ) );
		add_action( 'wc_ajax_' . $this->prefix_hook( 'update_hosted_session_from_token' ), array( $this, 'ajax_update_hosted_session_from_token' ) );
		add_action( 'wc_ajax_' . $this->prefix_hook( 'authenticate_payer' ), array( $this, 'ajax_authenticate_payer' ) );

		// Session handling
		add_filter( 'woocommerce_update_order_review_fragments', array( $this, 'relocalize_cart_total' ) );
		add_action( 'woocommerce_after_calculate_totals', array( $this, 'maybe_update_hosted_session' ) );
	}


	/**
	 * Initialize gateway support features.
	 *
	 * @return void
	 */
	public function init_supports() {

		$supports = $this->get_supports();

		if ( $this->saved_cards && ! $this->is_hosted_checkout() ) {
			$supports[] = 'tokenization';
		}

		$this->supports = $supports;
	}


	/**
	 * Initialize addons.
	 *
	 * @return void
	 */
	public function init_addons() {
		$this->init_addon_subscriptions();
		$this->init_addon_pre_orders();
		$this->init_addon_dcc();
	}


	/**
	 * Initialize form fields.
	 *
	 * @return void
	 */
	public function init_form_fields() {
		$this->form_fields = $this->core_plugin->gateway_settings()->get_settings( true );
	}


	/**
	 * Process the admin options.
	 *
	 * @return void
	 */
	public function process_admin_options() {
		// Update settings that needs to be updated before saving to correctly display the notices.
		$notification_secret = isset( $_POST[ $this->prefix_hook( 'notification_secret', 'woocommerce_' ) ] ) ? wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'notification_secret', 'woocommerce_' ) ] ) ) : $this->get_option( 'notification_secret' ); // phpcs:ignore WordPress.Security.NonceVerification.Missing

		$this->core_plugin->update_gateway_setting( 'notification_secret', $notification_secret );

		parent::process_admin_options();
	}


	/**
	 * Validate API keys.
	 *
	 * @return void
	 */
	public function validate_credentials() {
		$merchant_id = isset( $_POST[ $this->prefix_hook( 'merchant_id', 'woocommerce_' ) ] ) ? wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'merchant_id', 'woocommerce_' ) ] ) ) : $this->get_option( 'merchant_id' ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$password    = isset( $_POST[ $this->prefix_hook( 'password', 'woocommerce_' ) ] ) ? wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'password', 'woocommerce_' ) ] ) ) : $this->get_option( 'password' ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$is_sandbox  = isset( $_POST[ $this->prefix_hook( 'sandbox', 'woocommerce_' ) ] ) ? wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'sandbox', 'woocommerce_' ) ] ) ) : $this->get_option( 'sandbox' ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$region      = isset( $_POST[ $this->prefix_hook( 'region', 'woocommerce_' ) ] ) ? wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'region', 'woocommerce_' ) ] ) ) : $this->get_option( 'region' ); // phpcs:ignore WordPress.Security.NonceVerification.Missing

		if ( empty( $merchant_id ) || empty( $password ) ) {
			WC_Admin_Settings::add_error( __( 'Merchant ID and API Key are required.', $this->core_plugin->text_domain() ) );
		}

		$this->core_plugin->update_gateway_setting( 'merchant_id', $merchant_id );
		$this->core_plugin->update_gateway_setting( 'password', $password );
		$this->core_plugin->update_gateway_setting( 'sandbox', ! empty( $is_sandbox ) ? 'yes' : 'no' );
		$this->core_plugin->update_gateway_setting( 'region', $region );

		$response = $this->api()->payment_options_inquiry();

		if ( ! $response['success'] || empty( $response['body'] ) ) {
			WC_Admin_Settings::add_error( __( 'Failed to validate API credentials. Please validate your credentials and save your account details again.', $this->core_plugin->text_domain() ) );
			$this->core_plugin->update_validated_credentials( false );
			$this->core_plugin->update_payment_operations( array() );
			$this->init_form_fields();
			return;
		}

		$this->core_plugin->logger()->log( __( 'API credentials validated successfully.', $this->core_plugin->text_domain() ) );

		$this->core_plugin->update_validated_credentials( true );

		$this->core_plugin->update_payment_operations( $response['body']['supportedPaymentOperations'] ?? array() );

		$this->init_form_fields();
	}


	/**
	 * Is the gateway available.
	 *
	 * @return bool
	 */
	public function is_available() {
		if ( ! parent::is_available() ) {
			return false;
		}

		if ( ! $this->core_plugin->is_enabled() ) {
			return false;
		}

		if ( ! $this->core_plugin->get_validated_credentials() ) {
			return false;
		}

		return true;
	}


	/**
	 * Get the merchant ID.
	 *
	 * @return string
	 */
	public function merchant_id() {
		return $this->merchant_id;
	}


	/**
	 * Get checkout mode.
	 *
	 * @return string
	 */
	public function checkout_mode() {
		return $this->core_plugin->get_checkout_mode();
	}


	/**
	 * Is hosted checkout mode.
	 *
	 * @return bool
	 */
	public function is_hosted_checkout() {
		return 'hosted_checkout' === $this->checkout_mode;
	}


	/**
	 * Is hosted session mode.
	 *
	 * @return bool
	 */
	public function is_hosted_session() {
		return 'hosted_session' === $this->checkout_mode;
	}


	/**
	 * Is embedded checkout mode.
	 *
	 * @return bool
	 */
	public function is_embedded_checkout() {
		return $this->is_hosted_checkout() && 'embedded' === $this->hosted_checkout_mode;
	}


	/**
	 * Is redirect checkout mode.
	 *
	 * @return bool
	 */
	public function is_redirect_checkout() {
		return $this->is_hosted_checkout() && 'redirect' === $this->hosted_checkout_mode;
	}


	/**
	 * Should render embedded checkout.
	 *
	 * @return bool
	 */
	public function should_render_hosted_checkout() {
		return $this->is_hosted_checkout() && is_wc_endpoint_url( 'order-pay' );
	}


	/**
	 * Should render hosted session.
	 *
	 * @return bool
	 */
	public function should_render_hosted_session() {
		if ( ! $this->is_hosted_session() ) {
			return false;
		}

		if ( is_order_received_page() ) {
			return false;
		}

		if ( is_cart() || is_checkout() || is_add_payment_method_page() || is_checkout_pay_page() ) {
			return true;
		}

		if ( function_exists( 'has_block' ) && ( has_block( 'woocommerce/cart' ) || has_block( 'woocommerce/checkout' ) ) ) {
			return true;
		}

		return false;
	}


	/**
	 * Payment fields.
	 *
	 * @return void
	 */
	public function payment_fields() {

		// TODO: Document why is this needed.
		if ( is_checkout_pay_page() ) {
			$this->maybe_flag_order_as_paid( Utils::get_current_order() );
		}

		switch ( $this->checkout_mode ) {
			case 'hosted_checkout':
				$this->payment_fields_hosted_checkout();
				break;
			case 'hosted_session':
				$this->payment_fields_hosted_session();
				break;
		}
	}


	/**
	 * Payment fields: Hosted checkout mode.
	 *
	 * @return void
	 */
	protected function payment_fields_hosted_checkout() {
		if ( ! $this->should_render_hosted_checkout() ) {
			echo wp_kses_post( $this->description );
			return;
		}

		$session_id = $this->checkout_session_id();

		if ( ! $session_id ) {
			if ( is_wc_endpoint_url( 'order-pay' ) ) {
				wc_print_notice( __( 'There was an error creating the payment session. Please review your data and try again or try a different payment method.', $this->core_plugin->text_domain() ), 'error' );
			} else {
				echo wp_kses_post( $this->description );
			}
			return;
		}

		$this->core_plugin->payment_core()->template()->get(
			'payment-fields-hosted-checkout.php',
			array(
				'gateway'    => $this,
				'session_id' => $session_id,
			)
		);

		$this->clean_hosted_checkout_session();
	}


	/**
	 * Payment fields: Hosted session mode.
	 *
	 * @return void
	 */
	protected function payment_fields_hosted_session() {
		// Display the description.
		echo wp_kses_post( $this->description );

		$session_id = $this->hosted_session_id();

		if ( ! $session_id ) {
			wc_add_notice( __( 'There was an error creating the payment session. Please refresh the page and try again.', $this->core_plugin->text_domain() ), 'error' );
			return;
		}

		$this->maybe_load_tokenization_scripts();

		wp_enqueue_script( 'wc-credit-card-form' );

		$template_data = array(
			'gateway'         => $this,
			'session_id'      => $session_id,
			'session_attempt' => uniqid( $session_id ),
			'enable_3ds'      => $this->enable_3ds,
			'dcc_enabled'     => $this->dcc_enabled,
		);

		if ( $this->enable_3ds && $this->is_pay_for_order_page() ) {
			$template_data['threeds_data'] = $this->get_cached_3ds_data();
		}

		$display_tokenization = $this->display_saved_card_methods();

		// There is an ongoing 3DS transaction, do not display the tokenization.
		if ( ! empty( $template_data['threeds_data'] ) ) {
			$display_tokenization = false;
		}

		if ( $display_tokenization ) {
			$this->saved_payment_methods();
		}

		$this->display_save_checkbox = apply_filters( 'wc_' . $this->id . '_display_save_payment_method_checkbox', $display_tokenization );

		$this->core_plugin->payment_core()->template()->get(
			'payment-fields-hosted-session.php',
			$template_data,
		);

		if ( $this->dcc_enabled && ! is_add_payment_method_page() ) {
			echo '<div id="' . esc_attr( $this->id ) . '_currency_conversion" class="payment-core-currency-conversion"></div>';
		}

		if ( $this->display_save_checkbox && ! is_add_payment_method_page() ) {
			$this->save_payment_method_checkbox();
		}
	}


	/**
	 * Process Payment.
	 * First of all and most important is to process the payment.
	 * Second if needed, save payment token card.
	 *
	 * @param int $order_id Order ID.
	 *
	 * @return array
	 *
	 * @throws Exception Exception.
	 */
	public function process_payment( $order_id ) {

		try {
			$order = wc_get_order( $order_id );

			if ( ! $order ) {
				throw new Exception( __( 'Invalid order.', $this->core_plugin->text_domain() ), 'error' );
			}

			do_action( $this->prefix_hook( 'process_payment_before' ), $order );

			$addon_payment = apply_filters( $this->prefix_hook( 'process_payment_addon' ), false, $order );
			if ( ! empty( $addon_payment ) && is_array( $addon_payment ) ) {
				return $addon_payment;
			}

			// TODO: Document why is this needed.
			if ( ! empty( $order->get_date_paid( 'edit' ) ) || $this->maybe_flag_order_as_paid( $order, false ) ) {
				return array(
					'result'   => 'success',
					'redirect' => $this->get_return_url( $order ),
				);
			}

			if ( $this->is_hosted_checkout() ) {
				return $this->process_payment_hosted_checkout( $order );
			}

			if ( $this->is_hosted_session() ) {
				return $this->process_payment_hosted_session( $order, false );
			}

			return array(
				'result'   => 'success',
				'redirect' => $order->get_checkout_payment_url(),
			);
		} catch ( Exception $e ) {
			$this->core_plugin->logger()->log( $e->getMessage(), 'error' );
			wc_add_notice( $e->getMessage(), 'error' );

			$this->clean_cached_3ds_data( $order );
			$this->maybe_clean_hosted_cached_session( $this->get_hosted_session_data_hash() );

			do_action( $this->prefix_hook( 'process_payment_error' ), $e, ! empty( $order ) ? $order : null );

			return array(
				'result'       => 'failure',
				'redirect'     => '',
				'messages'     => (array) $e->getMessage(),
				'errorMessage' => $e->getMessage(),
			);
		}

		// It is a success anyways, since the order at this point is completed.
		return array(
			'result'   => 'success',
			'redirect' => $this->get_return_url( $order ),
		);
	}

	/**
	 * Process payment using the hosted checkout mode.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return array
	 */
	protected function process_payment_hosted_checkout( $order ) {
		$order->update_status( 'pending', __( 'Pending payment', $this->core_plugin->text_domain() ) );

		if ( 'redirect' === $this->hosted_checkout_mode ) {

			$session_id = $this->checkout_session_id( $order );

			if ( ! $session_id ) {
				wc_add_notice( __( 'There was an error creating the payment session. Please try again.', $this->core_plugin->text_domain() ), 'error' );
				return array(
					'result'   => 'failure',
					'redirect' => $order->get_checkout_payment_url(),
				);
			}

			return array(
				'result'    => 'success',
				'pluginId'  => $this->id,
				'sessionId' => $session_id,
				'redirect'  => '#',
			);
		}

		return array(
			'result'   => 'success',
			'redirect' => $order->get_checkout_payment_url(),
		);
	}


	/**
	 * Process payment using the hosted session mode.
	 *
	 * @param WC_Order $order                   Order object.
	 * @param bool     $processing_3ds_callback Processing 3DS callback.
	 *
	 * @return array
	 * @throws Exception Exception.
	 */
	protected function process_payment_hosted_session( $order, $processing_3ds_callback = false ) {
		if ( $processing_3ds_callback ) {
			$session = null;
			if ( null !== $order && $order instanceof WC_Order ) {
				$session = $order->get_meta( $this->prefix_hook( 'payment_session' ) );
			} else {
				if ( empty( WC()->session ) ) {
					throw new Exception( __( 'There was an error with the payment authentication. Please try again.', $this->core_plugin->text_domain() ) );
				}
				$session = WC()->session->get( $this->prefix_hook( 'payment_session' ) );
			}
		} else {
			$session = $this->get_posted_session_data();
		}

		if ( empty( $session ) ) {
			throw new Exception( __( 'There was an error obtaining the payment session. Please refresh the page and try again.', $this->core_plugin->text_domain() ) );
		}

		// TODO: Maybe avoid fetching the session if it was fetched within get_posted_session_data (updated with token ID).
		$session_data = $this->retrieve_payment_session( $session['id'] );

		if ( empty( $session_data['sourceOfFunds'] ) ) {
			throw new Exception( __( 'There was an error validating the payment session. Please refresh the page and try again.', $this->core_plugin->text_domain() ) );
		}

		// Forcefully validate CVC value.
		if (
			! $this->is_saved_payment_method() &&
			! empty( $session_data['sourceOfFunds']['provided']['card'] ) &&
			empty( $session_data['sourceOfFunds']['provided']['card']['securityCode'] )
		) {
			throw new Exception( __( 'Security code is missing.', $this->core_plugin->text_domain() ) );
		}

		if ( null !== $order && $order instanceof WC_Order ) {
			$api_operation = ( 'AUTHORIZE' === $this->transaction_mode ) ? 'AUTHORIZE' : 'PAY';
		} else {
			$api_operation = 'VERIFY';
		}

		$payment_data = array(
			'apiOperation' => $api_operation,
			'order'        => $this->hosted_session_order_payload( $order ),
			'session'      => $session,
			'transaction'  => array(
				'source' => 'INTERNET',
			),
		);

		$payment_data = apply_filters( $this->prefix_hook( 'process_payment_data' ), $payment_data, $order );

		if ( $this->enable_3ds ) {
			$authentication_transaction_id = $this->get_3ds_authentication( $order, $session, $processing_3ds_callback );

			if ( is_array( $authentication_transaction_id ) ) {

				$this->maybe_cache_saving_card( $order );

				return $authentication_transaction_id;
			}

			// Clean the current authentication once the payment is authorized.
			$this->clean_cached_3ds_data( $order, true );

			if ( 'not_supported' === $authentication_transaction_id ) {
				$authentication_transaction_id = null;
			}

			if ( ! empty( $authentication_transaction_id ) ) {
				$payment_data['authentication'] = array(
					'transactionId' => $authentication_transaction_id,
				);
			}
		}

		$unique_order_id = $this->unique_order_id( $order );
		$transaction_id  = $this->unique_transaction_id( $order );

		$payment_data['transaction']['reference'] = $transaction_id;

		$payment_data = apply_filters(
			$this->prefix_hook( 'process_payment_hosted_session_data' ),
			$payment_data,
			$order,
			$session
		);

		if ( 'VERIFY' === $payment_data['apiOperation'] || empty( $order->get_date_paid( 'edit' ) ) || ! $this->maybe_flag_order_as_paid( $order ) ) {
			$this->create_payment_transaction( $order, $unique_order_id, $transaction_id, $payment_data );
		}

		$this->maybe_clean_hosted_cached_session( $this->get_hosted_session_data_hash() );

		$this->maybe_save_cards( $order, $session_data );

		if ( $this->enable_3ds ) {
			// Clean once more after saving the cards.
			$this->clean_cached_3ds_data( $order );
		}

		return array(
			'result'   => 'success',
			'redirect' => $this->get_return_url( $order ),
		);
	}


	/**
	 * Create payment transaction.
	 *
	 * @param WC_Order $order           Order object.
	 * @param string   $unique_order_id Unique order ID.
	 * @param string   $transaction_id  Transaction ID.
	 * @param array    $payment_data    Payment data.
	 *
	 * @return array
	 * @throws Exception Exception.
	 */
	public function create_payment_transaction( $order, $unique_order_id, $transaction_id, $payment_data ) {

		if ( empty( $unique_order_id ) || empty( $transaction_id ) || empty( $payment_data ) ) {
			throw new Exception( __( 'There was an error processing the payment. Please try again.', $this->core_plugin->text_domain() ) );
		}

		$response = $this->api()->create_transaction( $unique_order_id, $transaction_id, $payment_data );

		if ( ! $response['success'] || empty( $response['body']['result'] ) || ! empty( $response['error'] ) ) {
			$error = __( 'There was an error processing the payment. Please try again.', $this->core_plugin->text_domain() );
			throw new Exception( $error );
		}

		if ( 'SUCCESS' !== $response['body']['result'] ) {
			$error = __( 'There was an error processing the payment. Please try again.', $this->core_plugin->text_domain() );
			if ( ! empty( $response['body']['response']['acquirerMessage'] ) ) {
				$error = $response['body']['response']['acquirerMessage'];
			} elseif ( ! empty( $response['body']['response']['gatewayCode'] ) ) {
				$error = $this->get_mapped_error_code( $response['body']['response']['gatewayCode'] );
			}
			throw new Exception( $error );
		}

		if ( empty( $response['body']['transaction'] ) || empty( $response['body']['transaction']['id'] ) ) {
			throw new Exception( __( 'There was an error obtaining the transaction. Please try again.', $this->core_plugin->text_domain() ) );
		}

		if ( empty( $response['body']['order'] ) ) {
			throw new Exception( __( 'There was an error obtaining the order data. Please try again.', $this->core_plugin->text_domain() ) );
		}

		$order_data = $this->api()->retrieve_order( $unique_order_id );
		if ( ! empty( $order_data['body'] ) ) {
			$order_data = $order_data['body'];
		} else {
			$order_data = $response['body']['order'];
		}

		if( null !== $order && $order instanceof WC_Order ) {
			$this->process_wc_order( $order, $order_data, $response['body']['transaction'] );
		}

		return $order_data;
	}

	/**
	 * Is forcing the save of the payment method.
	 *
	 * @return bool
	 */
	public function is_forcing_save_payment_method() {
		// Always save on add payment method page
		if ( is_add_payment_method_page() ) {
			return true;
		}

		$forced_save = (bool) apply_filters( $this->prefix_hook( 'forced_save_payment_method' ), false );
		return $forced_save;
	}


	/**
	 * Maybe save the cards.
	 *
	 * @param WC_Order $order        Order object.
	 * @param array    $session_data Session data.
	 */
	public function maybe_save_cards( $order, $session_data ) {
		$forced_save = $this->is_forcing_save_payment_method();

		if ( ! $forced_save && ! $this->saved_cards ) {
			return;
		}

		if ( $this->is_saved_payment_method() || ( $session_data['sourceOfFunds']['type'] === 'CARD' && isset( $session_data['sourceOfFunds']['token'] ) ) ) {
			$current_token_id = null;
			if ( $this->is_saved_payment_method() ) {
				$current_token_id = $this->get_current_saved_payment_method();
			} else {
				$tokens = $this->get_tokens();
				foreach ( $tokens as $token ) {
					if ( $token->get_token() === $session_data['sourceOfFunds']['token'] ) {
						$current_token_id = $token->get_id();
						break;
					}
				}
			}
			if ( ! $current_token_id ) {
				return;
			}
			do_action( $this->prefix_hook( 'payment_method_saved' ), $order, $current_token_id );
			return;
		}

		if ( ! $forced_save && ! $this->is_saving_payment_method() && ! WC()->session->get( $this->prefix_hook( 'saving_payment_method' ) ) ) {
			return;
		}

		$user_id = $order ? $order->get_user_id( 'system' ) : get_current_user_id();
		if ( ! $user_id ) {
			return;
		}

		$payment_token_id = $this->payment_token()->process_saved_cards( $session_data, $user_id );

		if ( ! $payment_token_id ) {
			return;
		}

		if ( null !== $order && $order instanceof WC_Order ) {
			// This adds a list of tokens endlessly after several changes, making it very difficult to be useful.
			// TODO: Consider revising this behavior in the future.
			$order->add_payment_token( new WC_Payment_Token_CC( $payment_token_id ) );
		}

		do_action( $this->prefix_hook( 'payment_method_saved' ), $order, $payment_token_id );

		WC()->session->__unset( $this->prefix_hook( 'saving_payment_method' ) );
	}


	/**
	 * Maybe cache the saving card.
	 */
	public function maybe_cache_saving_card() {
		if ( ! $this->saved_cards ) {
			return;
		}

		if ( ! $this->is_saving_payment_method() && ! \is_add_payment_method_page() && ! ( isset( $_REQUEST['order_id'] ) && $_REQUEST['order_id'] === 'add_payment_method' ) ) {
			return;
		}

		WC()->session->set( $this->prefix_hook( 'saving_payment_method' ), true );
	}


	/**
	 * Get the 3DS authentication from the order.
	 *
	 * @param WC_Order $order                   Order object.
	 * @param array    $session                 Session data.
	 * @param bool     $processing_3ds_callback Processing 3DS callback.
	 *
	 * @return string|array
	 */
	public function get_3ds_authentication( $order, $session, $processing_3ds_callback = false ) {
		$unique_order_id = $this->unique_order_id( $order );
		if ( $processing_3ds_callback ) {
			$transaction_id = $this->get_authentication_transaction( $order );

			if ( empty( $transaction_id ) || ! $this->validate_authentication( $unique_order_id, $transaction_id ) ) {
				throw new Exception( __( 'There was an error with the payment authentication. Please try again.', $this->core_plugin->text_domain() ) );
			}

			return $transaction_id;
		}

		$processed_3ds = $this->process_3ds_authentication( $order, $session, $unique_order_id );

		if ( 'not_supported' === $processed_3ds ) {
			return 'not_supported';
		}

		if ( is_array( $processed_3ds ) ) {
			return $processed_3ds;
		}

		return $processed_3ds ? $this->get_authentication_transaction( $order ) : '';
	}

	protected function intiate_3ds_authentication( $order, $session, $unique_order_id ) {
		$transaction_id = $this->unique_transaction_id( $order );

		$init_authentication = array(
				'apiOperation' => 'INITIATE_AUTHENTICATION',
				'session'      => $session,
			);

			$init_authentication = apply_filters(
				$this->prefix_hook( 'process_payment_hosted_session_3ds_data' ),
				$init_authentication,
				$order,
			$session
		);

		$response = $this->api()->init_authentication( $unique_order_id, $transaction_id, $init_authentication );

		$this->update_authentication_transaction( $order, $transaction_id );

		return array( $transaction_id, $response );
	}


	/**
	 * Process 3DS authentication.
	 *
	 * @param WC_Order $order           Order object.
	 * @param array    $session         Session data (ID and version).
	 * @param int      $unique_order_id Order ID.
	 *
	 * @return bool
	 * @throws Exception Exception.
	 */
	protected function process_3ds_authentication( $order, $session, $unique_order_id ) {
		$transaction_id = $this->get_authentication_transaction( $order );

		if ( empty( $transaction_id ) ) {
			list( $transaction_id, $response ) = $this->intiate_3ds_authentication( $order, $session, $unique_order_id );
		} else {
			$response = $this->api()->retrieve_transaction( $unique_order_id, $transaction_id );
		}

		try {
			if ( $this->validate_authentication_not_supported( $response ) ) {
				$this->clean_cached_3ds_data( $order, true );
				return 'not_supported';
			}

			if ( ! $this->validate_authentication_response( $response ) ) {
				$this->clean_cached_3ds_data( $order );
				return false;
			}

			$authenticate_payer = array(
				'authentication' => array(
					'redirectResponseUrl' => add_query_arg(
						array(
							$this->prefix_hook( 'callback', '', '-' ) => 'wc-3ds',
							'order-id'  => $order ? $order->get_id() : null,
							'signature' => $this->hashed_signature( $order, $transaction_id ),
							'nonce'     => wp_create_nonce( $this->prefix_hook( '3ds_nonce' ) ),
						),
						home_url( '/' )
					),
				),
				'device'         => $this->get_device_details(),
				'order'          => array(
					'amount'   => $order ? $order->get_total() : null,
					'currency' => $order ? $order->get_currency() : null,
				),
				'session'        => $session,
			);

			$authenticate_payer = apply_filters(
				$this->prefix_hook( 'process_payment_hosted_session_3ds_authenticate_payer_data' ),
				$authenticate_payer,
				$order,
				$session
			);

			$authenticate_payer['apiOperation'] = 'AUTHENTICATE_PAYER';

			$authentication_response = $this->api()->authenticate_payer( $unique_order_id, $transaction_id, $authenticate_payer );

			return $this->process_authentication_response( $authentication_response, $order, $transaction_id, $session );
		} catch ( Exception $e ) {
			$this->clean_cached_3ds_data( $order );
			throw new Exception( $e->getMessage() );
		}
	}


	/**
	 * Validate the 3DS authentication.
	 *
	 * @param int    $order_id       Order ID.
	 * @param string $transaction_id Transaction ID.
	 *
	 * @return bool
	 */
	protected function validate_authentication( $order_id, $transaction_id ) {
		return $this->validate_authentication_response( $this->api()->retrieve_transaction( $order_id, $transaction_id ) );
	}


	/**
	 * Clean the cached authentication transaction.
	 *
	 * @param WC_Order $order          Order object.
	 * @param string   $transaction_id Transaction ID.
	 *
	 * @return void
	 */
	protected function get_authentication_transaction( $order = null ) {
		if ( null !== $order && $order instanceof WC_Order ) {
			return $order->get_meta( $this->prefix_hook( 'authentication_transaction' ) );
		} else {
			if ( empty( WC()->session ) ) {
				return null;
			}
			return WC()->session->get( $this->prefix_hook( 'authentication_transaction' ) );
		}
	}


	/**
	 * Clean the cached authentication transaction.
	 *
	 * @param WC_Order $order          Order object.
	 * @param string   $transaction_id Transaction ID.
	 *
	 * @return void
	 */
	protected function update_authentication_transaction( $order, $transaction_id, $save = true ) {
		if ( null !== $order && $order instanceof WC_Order ) {
			// Clean the authentication transaction.
			if ( null !== $transaction_id ) {
				$order->update_meta_data( $this->prefix_hook( 'authentication_transaction' ), $transaction_id );
			} else {
				$order->delete_meta_data( $this->prefix_hook( 'authentication_transaction' ) );
			}

			if ( $save ) {
				$order->save_meta_data();
			}
		} else {
			if ( empty( WC()->session ) ) {
				return;
			}

			// Clean the authentication transaction.
			if ( null !== $transaction_id ) {
				WC()->session->set( $this->prefix_hook( 'authentication_transaction' ), $transaction_id );
			} else {
				WC()->session->__unset( $this->prefix_hook( 'authentication_transaction' ) );
			}

			// $save is irrelevant in this context.
		}
	}


	/**
	 * Get browser device details for 3DS.
	 *
	 * @return array
	 * @throws Exception Exception.
	 */
	protected function get_device_details() {
		if ( ! isset( $_SERVER['HTTP_USER_AGENT'] ) || empty( $_POST[ $this->prefix_hook( '3ds_data' ) ] ) ) {
			throw new Exception( __( 'There was an error with the payment authentication. Please try again.', $this->core_plugin->text_domain() ) );
		}

		return array(
			'browser'        => wc_clean( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ),
			'browserDetails' => wp_parse_args(
				json_decode( wc_clean( wp_unslash( $_POST[ $this->prefix_hook( '3ds_data' ) ] ) ), true ),
				array(
					'3DSecureChallengeWindowSize' => 'FULL_SCREEN',
					'acceptHeaders'               => isset( $_SERVER['HTTP_ACCEPT'] ) ? wc_clean( wp_unslash( $_SERVER['HTTP_ACCEPT'] ) ) : '',
					'javaEnabled'                 => false,
					'javaScriptEnabled'           => false,
				),
			),
		);
	}


	/**
	 * Validate authentication transaction response.
	 *
	 * @param array $response The response data.
	 *
	 * @return bool
	 * @throws Exception Exception.
	 */
	public function validate_authentication_response( $response ) {
		if ( ! $response['success'] ) {
			throw new Exception( __( 'There was an error with the payment authentication. Please try again.', $this->core_plugin->text_domain() ) );
		}

		if ( ! empty( $response['body']['authentication'] ) && ! is_array( $response['body']['authentication'] ) && 'NONE' === $response['body']['authentication'] ) {
			return false;
		}

		if ( ! empty( $response['body']['response']['gatewayRecommendation'] ) && 'PROCEED' !== $response['body']['response']['gatewayRecommendation'] ) {

			if ( 'RESUBMIT_WITH_ALTERNATIVE_PAYMENT_DETAILS' === $response['body']['response']['gatewayRecommendation'] ) {
				throw new Exception( __( 'The payment method was declined. Please try again with a different payment method.', $this->core_plugin->text_domain() ) );
			}

			throw new Exception( __( 'The payment method was declined.', $this->core_plugin->text_domain() ) );
		}

		if ( empty( $response['body']['result'] ) || 'SUCCESS' !== $response['body']['result'] ) {
			throw new Exception( __( 'There was an error with the payment authentication. Please try again.', $this->core_plugin->text_domain() ) );
		}

		return true;
	}


	/**
	 * Validate if the authentication is supported for the transaction.
	 *
	 * @param array $response The response data.
	 *
	 * @return bool
	 * @throws Exception Exception.
	 */
	public function validate_authentication_not_supported( $response ) {
		if ( empty( $response['body']['transaction']['authenticationStatus'] ) || 'AUTHENTICATION_NOT_SUPPORTED' !== $response['body']['transaction']['authenticationStatus'] ) {
			return false;
		}

		if ( empty( $response['body']['response']['gatewayRecommendation'] ) || 'PROCEED' !== $response['body']['response']['gatewayRecommendation'] ) {
			return false;
		}

		return true;
	}


	/**
	 * Process authentication response.
	 *
	 * @param array    $response       The response data.
	 * @param WC_Order $order          Order object.
	 * @param string   $transaction_id Transaction ID.
	 * @param array    $session        Session data.
	 *
	 * @return bool
	 * @throws Exception Exception.
	 */
	public function process_authentication_response( $response, $order, $transaction_id, $session ) {
		if ( ! $response['success'] ) {
			throw new Exception( __( 'There was an error with the payment authentication. Please try again.', $this->core_plugin->text_domain() ) );
		}

		if ( empty( $response['body']['result'] ) || ! in_array( $response['body']['result'], array( 'SUCCESS', 'PENDING' ), true ) ) {
			throw new Exception( __( 'There was an error with the payment authentication. Please try again.', $this->core_plugin->text_domain() ) );
		}

		if ( 'PROCEED' !== $response['body']['response']['gatewayRecommendation'] ) {

			if ( 'RESUBMIT_WITH_ALTERNATIVE_PAYMENT_DETAILS' === $response['body']['response']['gatewayRecommendation'] ) {
				throw new Exception( __( 'The payment method was declined. Please try again with a different payment method.', $this->core_plugin->text_domain() ) );
			}

			throw new Exception( __( 'The payment method was declined.', $this->core_plugin->text_domain() ) );
		}

		$data = $this->formatted_3ds_data( $response );

		if ( empty( $data ) || 'SUCCESS' === $response['body']['result'] ) {
			return true;
		}

		if ( 'PENDING' === $response['body']['result'] && empty( $data['action'] ) ) {
			throw new Exception( __( 'There was an error with the payment authentication. Please try again.', $this->core_plugin->text_domain() ) );
		}

		if ( null !== $order && $order instanceof WC_Order ) {
			// Send the ACS form to the client.
			$order->update_meta_data( $this->prefix_hook( 'payment_session' ), $session );
			$order->save();
		} else {
			if ( empty( WC()->session ) ) {
				throw new Exception( __( 'There was an error with the payment authentication. Please try again.', $this->core_plugin->text_domain() ) );
			}
			WC()->session->set( $this->prefix_hook( 'payment_session' ), $session );
		}

		$return = array(
			'result'   => 'success',
			'redirect' => '#',
		);

		// Cache the 3DS data when paying an existing order.
		if ( $this->is_pay_for_order_page() ) {
			$this->cache_3ds_data( $data, $order );
			return $return;
		}

		$return[ $this->prefix_hook( '3ds' ) ] = wp_json_encode( $data );

		return $return;
	}


	/**
	 * Format the 3DS response data.
	 *
	 * @param array $response The response data of the 3DS authentication.
	 *
	 * @return array
	 */
	public function formatted_3ds_data( $response ) {

		$data = array();

		// Challenge authentication.
		$data['action'] = $response['body']['authentication']['redirect']['customizedHtml']['3ds2']['acsUrl'] ?? '';
		$data['creq']   = $response['body']['authentication']['redirect']['customizedHtml']['3ds2']['cReq'] ?? '';

		return array_filter( $data );
	}


	/**
	 * Cache the 3DS data.
	 *
	 * @param array    $data  The 3DS data.
	 * @param WC_Order $order Order object.
	 *
	 * @return void
	 */
	public function cache_3ds_data( $data, $order ) {
		if ( empty( WC()->session ) ) {
			$order->update_meta_data( $this->prefix_hook( '3ds_data' ), $data );
			$order->save_meta_data();
			return;
		}

		WC()->session->set( $this->prefix_hook( '3ds_data', $order->get_id() ), $data );
	}


	/**
	 * Get the cached 3DS data.
	 *
	 * @param WC_Order|null $order Order object.
	 *
	 * @return array
	 */
	public function get_cached_3ds_data( $order = null ) {
		if ( ! $order ) {
			$order = Utils::get_current_order();
		}

		if ( ! $order ) {
			return array();
		}

		$data = array();

		if ( ! empty( WC()->session ) ) {
			$data = WC()->session->get( $this->prefix_hook( '3ds_data', $order->get_id() ) );
		}

		if ( empty( $data ) ) {
			$data = $order->get_meta( $this->prefix_hook( '3ds_data' ) );
		}

		return $data;
	}


	/**
	 * Clean the cached 3DS data.
	 *
	 * @param WC_Order|null $order Order object.
	 *
	 * @return void
	 */
	public function clean_cached_3ds_data( $order = null, $is_success = false ) {
		$this->update_authentication_transaction( $order, null, false );
		if ( ! empty( WC()->session ) ) {
			WC()->session->__unset( $this->prefix_hook( '3ds_data' ) );
			if ( ! $is_success ) {
				WC()->session->__unset( $this->prefix_hook( 'order_id' ) );
			}
		}

		if ( $order instanceof \WC_Order ) {
			$order->delete_meta_data( $this->prefix_hook( '3ds_data' ) );
			$order->save_meta_data();
		}
	}


	/**
	 * Validate fields.
	 *
	 * @return bool
	 */
	public function validate_fields() {
		if ( $this->is_hosted_checkout() ) {
			return true;
		}

		if ( $this->is_saved_payment_method() ) {
			return;
		}

		$errors = new WP_Error();

		$session = $this->get_posted_session_data();

		// Validate the session values.
		if ( empty( $session ) ) {
			$errors->add( 'invalid_session', __( 'There was an error obtaining the payment session. Please try again.', $this->core_plugin->text_domain() ) );
		}

		// Validate the session.
		if ( ! $this->validate_payment_session_status( $session['id'], $session['version'] ) ) {
			$this->maybe_clean_hosted_cached_session();
			$errors->add( 'invalid_session', __( 'The Payment Session is invalid or has expired. Please try again.', $this->core_plugin->text_domain() ) );
		}

		$errors = apply_filters( $this->prefix_hook( 'validate_fields' ), $errors );

		$errors_messages = $errors->get_error_messages();
		if ( ! empty( $errors_messages ) ) {
			foreach ( $errors_messages as $message ) {
				wc_add_notice( $message, 'error' );
			}
			return false;
		}

		return true;
	}


	/**
	 * Get posted session data.
	 *
	 * @return array
	 */
	public function get_posted_session_data() {
		$id = ! empty( $_POST[ $this->prefix_hook( 'session_id' ) ] ) ? wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'session_id' ) ] ) ) : '';
		if ( ! $id ) {
			return array();
		}

		if ( $this->is_saved_payment_method() ) {
			return $this->update_session_saved_payment_method( $id );
		}

		$version = ! empty( $_POST[ $this->prefix_hook( 'session_version' ) ] ) ? wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'session_version' ) ] ) ) : '';
		if ( ! $version ) {
			return array();
		}

		return array(
			'id'      => $id,
			'version' => $version,
		);
	}


	/**
	 * Is pay for order page.
	 *
	 * @return bool
	 */
	public function is_pay_for_order_page() {
		return is_checkout() && isset( $_GET['pay_for_order'] );
	}


	/**
	 * Is saved payment method used.
	 *
	 * @return bool
	 */
	public function is_saved_payment_method() {
		return isset( $_POST[ $this->payment_token_key() ] ) && 'new' !== wc_clean( $_POST[ $this->payment_token_key() ] );
	}


	/**
	 * Get saved payment method used by the user.
	 *
	 * @return int|null
	 */
	public function get_current_saved_payment_method() {
		return $this->is_saved_payment_method() ? absint( wc_clean( $_POST[ $this->payment_token_key() ] ) ) : null;
	}


	/**
	 * Is saving payment method.
	 *
	 * @return bool
	 */
	protected function is_saving_payment_method() {
		return isset( $_POST[ 'wc-' . $this->id . '-new-payment-method' ] ) && ( $_POST[ 'wc-' . $this->id . '-new-payment-method' ] ); // WPCS: CSRF ok.
	}


	/**
	 * Get the $_POST key for the saved payment method.
	 *
	 * @return string
	 */
	protected function payment_token_key() {
		return 'wc-' . $this->id . '-payment-token';
	}


	/**
	 * Update the session if using saved payment method.
	 *
	 * @param array $session_id Session ID.
	 *
	 * @return array
	 */
	public function update_session_saved_payment_method( $session_id ) {
		if ( ! $this->is_saved_payment_method() ) {
			return array();
		}

		$payment_token_id = wc_clean( $_POST[ $this->payment_token_key() ] );

		return $this->update_session_with_token( $session_id, $payment_token_id );
	}

	protected function update_session_with_token( $session_id, $payment_token_id, $return_response = false ) {
		$payment_token = $this->payment_token()->get_payment_token( $payment_token_id );

		if ( ! $payment_token ) {
			return array();
		}

		$payload = array(
			'apiOperation'  => 'UPDATE_SESSION',
			'sourceOfFunds' => array(
				'type'  => 'CARD',
				'token' => $payment_token->get_token(),
			),
		);

		$response = $this->api()->update_session( $session_id, $payload );

		if ( ! $response['success'] || empty( $response['body']['session']['id'] ) || empty( $response['body']['session']['version'] ) ) {
			$this->core_plugin->logger()->log( __( 'There was an error updating the payment session. Please try again.', $this->core_plugin->text_domain() ), 'error' );
			return array();
		}

		$data = array(
			'id'      => $response['body']['session']['id'],
			'version' => $response['body']['session']['version'],
		);

		if ( $return_response ) {
			// Replicate the body structure, similar to what the JS API returns when updating a session.
			$data['response']           = $response['body'];
			$data['response']['status'] = 'ok';
		}

		return $data;
	}


	/**
	 * Add Payment Method hook on My account.
	 *
	 * @return array
	 * @throws Exception
	 */
	public function add_payment_method() {
		try {
			if ( ! is_user_logged_in() ) {
				throw new Exception( __( 'No logged-in user found.', $this->core_plugin->text_domain() ) );
			}

			$session = $this->get_posted_session_data();

			if ( empty( $session ) ) {
				throw new Exception( __( 'There was an error obtaining the payment details. Please try again.', $this->core_plugin->text_domain() ) );
			}

			$session_data = $this->retrieve_payment_session( $session['id'] );

			// Forcefully validate CVC value.
			if (
				! empty( $session_data['sourceOfFunds']['provided']['card'] ) &&
				empty( $session_data['sourceOfFunds']['provided']['card']['securityCode'] )
			) {
				wc_add_notice( __( 'Security code is missing.', $this->core_plugin->text_domain() ), 'error' );
				return array(
					'result' => 'invalid_data',
				);
			}

			// TODO: Handle 3DS doing a verify tx first, not just tokenizing the session

			$token_id = $this->payment_token()->process_saved_cards( $session_data, get_current_user_id() );

			if ( ! $token_id ) {
				throw new Exception( __( 'There was an error saving the card. Please try again.', $this->core_plugin->text_domain() ) );
			}

			do_action( $this->prefix_hook( 'add_payment_method_success', 'wc_' ), $token_id, $this );

			$this->maybe_clean_hosted_cached_session();

			return array(
				'result'   => 'success',
				'redirect' => wc_get_endpoint_url( 'payment-methods' ),
			);
		} catch ( Exception $e ) {
			$this->core_plugin->logger()->log( $e->getMessage(), 'error' );
			wc_add_notice( $e->getMessage(), 'error' );
			return array(
				'result'   => 'failure',
				'redirect' => wc_get_endpoint_url( 'payment-methods' ),
			);
		}
	}


	/**
	 * Get the hosted checkout script handle.
	 *
	 * @return string
	 */
	public function hosted_checkout_script_handle() {
		return $this->prefix_hook( self::HOSTED_CHECKOUT_HANDLE );
	}


	/**
	 * Get the hosted session script handle.
	 *
	 * @return string
	 */
	public function hosted_session_script_handle() {
		return $this->prefix_hook( self::HOSTED_SESSION_HANDLE );
	}


	/**
	 * Enqueue gateway scripts.
	 *
	 * @param array $scripts Scripts to enqueue.
	 *
	 * @return array
	 */
	public function enqueue_scripts( $scripts ) {

		if ( ! $this->is_available() ) {
			return $scripts;
		}

		$gateway_script = $this->prefix_hook( 'gateway' );

		if ( ! Utils::is_request( 'frontend' ) ) {
			return $scripts;
		}

		if ( $this->is_hosted_checkout() ) {
			$scripts[ $this->hosted_checkout_script_handle() ] = array(
				'src' => $this->hosted_checkout_url(),
			);

			if ( isset( $scripts[ $gateway_script ] ) ) {
				$scripts[ $gateway_script ]['deps'] = array_merge(
					array( $this->hosted_checkout_script_handle() ),
					$scripts[ $gateway_script ]['deps'] ?? array()
				);
			}
		} else {
			$scripts[ $this->hosted_session_script_handle() ] = array(
				'src' => $this->hosted_session_url(),
			);

			if ( isset( $scripts[ $gateway_script ] ) ) {
				$scripts[ $gateway_script ]['deps'] = array_merge(
					array(
						$this->hosted_session_script_handle(),
						'jquery-payment',
					),
					$scripts[ $gateway_script ]['deps'] ?? array()
				);
			}
		}

		return $scripts;
	}


	/**
	 * Add payment method data for Woo Blocks compatibility.
	 *
	 * @param array $data Payment method data.
	 *
	 * @return array
	 */
	public function add_payment_method_data( $data ) {

		$data['checkoutMode'] = $this->checkout_mode;
		$data['pluginPrefix'] = $this->core_plugin->plugin_id();

		switch ( $this->checkout_mode ) {
			case 'hosted_checkout':
				$data['sessionId']          = $this->checkout_session_id();
				$data['hostedCheckoutMode'] = $this->hosted_checkout_mode;
				break;
			case 'hosted_session':
				if ( $this->should_render_hosted_session() ) {
					$this->display_save_checkbox = apply_filters( 'wc_' . $this->id . '_display_save_payment_method_checkbox', $this->display_saved_card_methods() );

					$session_id                      = $this->hosted_session_id();
					$data['sessionId']               = $session_id;
					$data['sessionAttempt']          = uniqid( $session_id );
					$data['displaySaveCardCheckbox'] = $this->display_save_checkbox;
				}
				break;
		}

		return apply_filters( $this->prefix_hook( 'payment_method_data' ), $data, $this );
	}


	/**
	 * Maybe add the 'callback' attribute to the script tag.
	 *
	 * @param string $tag    The script tag.
	 * @param string $handle The script handle.
	 *
	 * @return string
	 */
	public function maybe_add_callbacks_attr( $tag, $handle ) {
		if ( $this->hosted_checkout_script_handle() === $handle ) {
			$tag = str_replace(
				'></script>',
				sprintf(
					' data-error="%1$sErrorCallback"></script>',
					$this->core_plugin->payment_core()->get_prefix(),
				),
				$tag
			);
		}

		return $tag;
	}


	/**
	 * Get the hosted checkout URL.
	 *
	 * @return string
	 */
	public function hosted_checkout_url() {
		return untrailingslashit( $this->core_plugin->gateway_url() ) . '/static/checkout/checkout.min.js';
	}


	/**
	 * Get the hosted session URL.
	 *
	 * @return string
	 */
	public function hosted_session_url() {
		return sprintf(
			'%1$s/form/version/%2$s/merchant/%3$s/session.js',
			untrailingslashit( $this->core_plugin->gateway_url() ),
			100,
			$this->merchant_id()
		);
	}


	/**
	 * Initiate hosted checkout session.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return string Session ID.
	 */
	protected function checkout_session_id( $order = null ) {
		static $session_id;

		// Bail if the cart is not defined.
		if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
			return '';
		}

		if ( ! $order ) {
			$order = Utils::get_current_order();
		}

		if ( ! $order ) {
			return '';
		}

		if ( $session_id ) {
			return $session_id;
		}

		$order_id = $order->get_id();

		$session_key          = $this->prefix_hook( 'session_id_' . $order_id );
		$session_duration_key = $this->prefix_hook( 'session_duration_' . $order_id );

		if ( ! isset( $_POST['createaccount'] ) && ! empty( WC()->session ) ) {
			$session_id = WC()->session->get( $session_key );

			if ( $session_id && $this->is_session_valid( WC()->session->get( $session_duration_key ) ) ) {
				return $session_id;
			}
		}

		$order_payload = $this->hosted_checkout_order_payload( $order );

		if ( empty( $order_payload['currency'] ) || empty( $order_payload['amount'] ) || empty( $order_payload['id'] ) ) {
			return '';
		}

		$payload = array(
			'apiOperation'      => 'INITIATE_CHECKOUT',
			'partnerSolutionId' => $this->get_partner_solution_id(),
			'order'             => $order_payload,
			'interaction'       => $this->hosted_checkout_interaction_payload( $order ),
		);

		if ( $this->is_hosted_checkout() && 'yes' === $this->core_plugin->get_gateway_setting( 'display_logo' ) && ! empty( $this->icon ) ) {
			$payload['interaction']['merchant']['logo'] = str_replace( 'http:', 'https:', $this->icon );
		}

		$payload = $this->maybe_add_customer_data( $payload, $order );

		$payload = apply_filters(
			$this->prefix_hook( 'checkout_session_payload' ),
			$payload,
			$order,
		);

		$response = $this->api()->create_session( $payload );

		if ( ! $response['success'] || empty( $response['body']['session']['id'] ) || empty( $response['body']['successIndicator'] ) ) {
			return '';
		}

		$session_id        = $response['body']['session']['id'];
		$success_indicator = $response['body']['successIndicator'];

		$order->update_meta_data( $this->prefix_hook( 'session_id' ), $session_id );
		$order->update_meta_data( $this->prefix_hook( 'success_indicator' ), $success_indicator );
		$order->save();

		if ( ! empty( WC()->session ) ) {
			WC()->session->set( $session_key, $session_id );
			WC()->session->set( $session_duration_key, time() + 3 * MINUTE_IN_SECONDS );
		}

		return $session_id;
	}


	/**
	 * Initiate hosted session.
	 *
	 * @return string
	 */
	protected function hosted_session_id() {
		// Bail if the cart is not defined.
		if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
			return '';
		}

		$session_id = $this->current_hosted_session_id();

		if ( ! empty( $session_id ) ) {
			$this->maybe_update_hosted_session_config( $session_id );
			return $session_id;
		}

		$response = $this->api()->create_session(
			array(
				'session' => array(
					'authenticationLimit' => self::HOSTED_SESSION_ATTEMPT_LIMIT,
				),
			)
		);

		if ( ! $response['success'] || empty( $response['body']['session']['id'] ) ) {
			return '';
		}

		$session_id = $response['body']['session']['id'];

		if ( ! empty( WC()->session ) ) {
			WC()->session->set( $this->hosted_session_id_key(), $session_id );
			WC()->session->set( $this->hosted_session_attempt_key(), 1 );
			WC()->session->set( $this->hosted_session_duration_key(), time() + 5 * MINUTE_IN_SECONDS );
			$this->set_hosted_session_data_hash();

			do_action( $this->prefix_hook( 'hosted_session_created' ), $session_id, $this );
		}

		$this->maybe_update_hosted_session_config( $session_id );

		return $session_id;
	}


	protected function maybe_update_hosted_session_config( $session_id ) {

		$current_hash = $this->get_hosted_session_data_hash();

		$session_config = WC()->session->get( $this->hosted_session_config_key( $current_hash ) );

		$target_config = array(
			'order' => array(
				'currency' => get_woocommerce_currency(),
			),
		);

		$current_total = Utils::get_current_total_amount();
		if ( $current_total > 0 ) {
			$target_config['order']['amount'] = $current_total;
		}

		if ( $this->enable_3ds ) {
			$target_config['authentication'] = array(
				'channel' => 'PAYER_BROWSER',
				'purpose' => 'PAYMENT_TRANSACTION',
			);
			// add redirectResponseUrl maybe?
		}

		if ( \is_add_payment_method_page() ) {
			$target_config['order']['amount'] = 0;
			if ( $this->enable_3ds ) {
				$target_config['authentication']['purpose'] = 'ADD_CARD';
			}
		}

		$current_config = md5( \wp_json_encode( $target_config ) );

		if ( $current_config === $session_config ) {
			return;
		}

		$payload = array_merge(
			$target_config,
			array(
				'apiOperation' => 'UPDATE_SESSION',
			)
		);

		try {
			$this->api()->update_session( $session_id, $payload );
		} catch ( \Exception $e ) {
			$this->core_plugin->logger()->log( 'Failed to update hosted session: ' . $e->getMessage(), 'error' );
		}

		WC()->session->set( $this->hosted_session_config_key( $current_hash ), $current_config );
	}


	/**
	 * Get current hosted session ID.
	 *
	 * @return string
	 */
	protected function current_hosted_session_id() {
		if ( empty( WC()->session ) ) {
			return '';
		}

		$current_hash = $this->get_hosted_session_data_hash();

		$session_id = WC()->session->get( $this->hosted_session_id_key( $current_hash ) );
		$attempts   = WC()->session->get( $this->hosted_session_attempt_key( $current_hash ) ) ?? 0;

		if ( ! $session_id ) {
			$this->maybe_clean_hosted_cached_session( $current_hash );
			return '';
		}

		if ( ! $this->is_session_valid( WC()->session->get( $this->hosted_session_duration_key( $current_hash ) ) ) ) {
			$this->maybe_clean_hosted_cached_session( $current_hash );
			return '';
		}

		if ( $attempts >= ( self::HOSTED_SESSION_ATTEMPT_LIMIT - 5 ) ) {
			$this->maybe_clean_hosted_cached_session( $current_hash );
			return '';
		}

		WC()->session->set( $this->hosted_session_attempt_key( $current_hash ), $attempts + 1 );
		return $session_id;
	}


	/**
	 * Get the order payload for the hosted checkout.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return array
	 */
	protected function hosted_checkout_order_payload( $order ) {
		return apply_filters(
			$this->prefix_hook( 'checkout_session_order_payload' ),
			array_merge(
				$this->base_order_payload( $order ),
				array(
					'id' => $this->unique_order_id( $order ),
				),
			)
		);
	}


	/**
	 * Get the order payload for the hosted session.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return array
	 */
	protected function hosted_session_order_payload( $order ) {
		return apply_filters(
			$this->prefix_hook( 'session_order_payload' ),
			$this->base_order_payload( $order ),
			$order
		);
	}


	/**
	 * Get the interaction payload for the hosted checkout.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return array
	 */
	protected function hosted_checkout_interaction_payload( $order ) {
		return apply_filters(
			$this->prefix_hook( 'checkout_session_interaction_payload' ),
			array(
				'operation'      => $this->transaction_mode,
				'returnUrl'      => add_query_arg(
					array(
						$this->prefix_hook( 'callback', '', '-' ) => 'wc',
						'order-id' => $order->get_id(),
						'nonce'    => wp_create_nonce( $this->prefix_hook( 'nonce' ) ),
					),
					trailingslashit( get_home_url() )
				),
				'cancelUrl'      => $order->get_checkout_payment_url(),
				'timeoutUrl'     => $order->get_checkout_payment_url(),
				'merchant'       => array(
					'name' => $this->merchant_name,
				),
				'displayControl' => array(
					'customerEmail'  => 'HIDE',
					'billingAddress' => 'HIDE',
					'shipping'       => 'HIDE',
				),
			),
			$order
		);
	}


	/**
	 * Check if the session is valid.
	 *
	 * @param string $session_duration Session duration.
	 *
	 * @return bool
	 */
	protected function is_session_valid( $session_duration ) {
		$session_duration = (int) $session_duration;

		if ( ! $session_duration ) {
			return false;
		}

		return time() < $session_duration;
	}


	/**
	 * Clean hosted checkout session.
	 *
	 * @return void
	 */
	protected function clean_hosted_checkout_session() {
		if ( empty( WC()->session ) ) {
			return;
		}

		$order = Utils::get_current_order();

		if ( ! $order ) {
			return;
		}

		$order_id = $order->get_id();

		$session_key          = $this->prefix_hook( 'session_id_' . $order_id );
		$session_duration_key = $this->prefix_hook( 'session_duration_' . $order_id );

		WC()->session->set( $session_key, null );
		WC()->session->set( $session_duration_key, null );
	}


	/**
	 * Maybe clean hosted cached session.
	 *
	 * @param string $cart_hash Current cart hash.
	 *
	 * @return void
	 */
	public function maybe_clean_hosted_cached_session( $cart_hash = '' ) {
		if ( ! function_exists( 'WC' ) || ! WC()->cart || empty( WC()->session ) ) {
			return;
		}

		WC()->session->__unset( $this->hosted_session_id_key( $cart_hash ) );
		WC()->session->__unset( $this->hosted_session_attempt_key( $cart_hash ) );
		WC()->session->__unset( $this->hosted_session_config_key( $cart_hash ) );
		WC()->session->__unset( $this->hosted_session_duration_key( $cart_hash ) );
	}


	/**
	 * Get hosted session ID key.
	 *
	 * @param string $cart_hash Current cart hash.
	 *
	 * @return string
	 */
	protected function hosted_session_id_key( $cart_hash = '' ) {
		return $this->core_plugin()->payment_core()->utils()->hosted_session_id_key( $cart_hash );
	}


	/**
	 * Get hosted session attempt key.
	 *
	 * @param string $cart_hash Current cart hash.
	 *
	 * @return string
	 */
	protected function hosted_session_attempt_key( $cart_hash = '' ) {
		return $this->core_plugin()->payment_core()->utils()->hosted_session_attempt_key( $cart_hash );
	}


	/**
	 * Get hosted session currency key.
	 *
	 * @param string $cart_hash Current cart hash.
	 *
	 * @return string
	 */
	protected function hosted_session_config_key( $cart_hash = '' ) {
		return $this->core_plugin()->payment_core()->utils()->hosted_session_config_key( $cart_hash );
	}


	/**
	 * Get hosted session duration key.
	 *
	 * @param string $cart_hash Current cart hash.
	 *
	 * @return string
	 */
	protected function hosted_session_duration_key( $cart_hash = '' ) {
		return $this->core_plugin()->payment_core()->utils()->hosted_session_duration_key( $cart_hash );
	}


	/**
	 * Get hosted session data hash.
	 *
	 * @return string
	 */
	protected function get_hosted_session_data_hash() {
		$current_hash = $this->get_current_hosted_session_data_hash();

		if ( ! $current_hash ) {
			$current_hash = $this->core_plugin()->payment_core()->utils()->unique_cart_hash();
		}

		return $current_hash;
	}


	/**
	 * Get hosted session data hash.
	 *
	 * @return string
	 */
	protected function get_current_hosted_session_data_hash() {
		return ! empty( WC()->session ) ? WC()->session->get( $this->prefix_hook( 'session_data_hash' ), '' ) : '';
	}


	/**
	 * Set hosted session data hash.
	 *
	 * @param string $hash Hash.
	 *
	 * @return void
	 */
	protected function set_hosted_session_data_hash( $hash = '' ) {
		if ( ! empty( WC()->session ) ) {
			WC()->session->set( $this->prefix_hook( 'session_data_hash' ), $hash ? $hash : $this->core_plugin()->payment_core()->utils()->unique_cart_hash() );
		}
	}


	/**
	 * Maybe handle return callback.
	 *
	 * @return void
	 */
	public function maybe_handle_return_callback() {
		if ( ! isset( $_GET[ $this->prefix_hook( 'callback', '', '-' ) ] ) ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$callback = wc_clean( wp_unslash( $_GET[ $this->prefix_hook( 'callback', '', '-' ) ] ) );

		switch ( $callback ) {
			// Hande hosted checkout
			case 'wc':
				$this->process_return_callback();
				break;
			// Handle 3DS redirect to processing url
			case 'wc-3ds':
				$this->process_3ds_return_callback();
				break;
			// Actually handle 3DS authentication
			case 'wc-3ds-process':
				$this->process_3ds_process_callback();
				break;
		}
	}


	/**
	 * Process the return callback.
	 *
	 * @return void
	 * @throws Exception Exception.
	 */
	public function process_return_callback() {
		try {
			if ( ! isset( $_REQUEST['nonce'] ) || ! wp_verify_nonce( wc_clean( wp_unslash( $_REQUEST['nonce'] ) ), $this->prefix_hook( 'nonce' ) ) ) {
				throw new Exception( __( 'Nonce verification is missing or invalid.', $this->core_plugin->text_domain() ) );
			}

			if ( ! isset( $_REQUEST['order-id'] ) || ! isset( $_REQUEST['resultIndicator'] ) ) {
				throw new Exception( __( 'Missing arguments.', $this->core_plugin->text_domain() ) );
			}

			$order_id = (int) wc_clean( wp_unslash( $_REQUEST['order-id'] ) );

			if ( ! $order_id ) {
				throw new Exception( __( 'The order ID parameter is invalid.', $this->core_plugin->text_domain() ) );
			}

			$order = wc_get_order( $order_id );

			if ( ! $order ) {
				throw new Exception( __( 'The order cannot be found.', $this->core_plugin->text_domain() ) );
			}

			if ( $order->is_paid() ) {
				throw new Exception( __( 'The order has already been processed.', $this->core_plugin->text_domain() ) );
			}

			$success_indicator = wc_clean( wp_unslash( $_REQUEST['resultIndicator'] ) );

			if ( ! $success_indicator || $order->get_meta( $this->prefix_hook( 'success_indicator' ) ) !== $success_indicator ) {
				throw new Exception( __( 'The payment session is invalid.', $this->core_plugin->text_domain() ) );
			}

			$order_data = $this->retrieve_order( $order );

			$this->validate_payment_status( $order, $order_data );

			$transaction = ! empty( $order_data['body']['transaction'] ) ? $this->get_approved_transaction( $order_data['body']['transaction'] ) : array();

			WC()->customer->set_props(
				array(
					'billing_country'  => $order->get_billing_country() ? $order->get_billing_country() : null,
					'billing_state'    => $order->get_billing_state() ? $order->get_billing_state() : null,
					'billing_postcode' => $order->get_billing_postcode() ? $order->get_billing_postcode() : null,
					'billing_city'     => $order->get_billing_city() ? $order->get_billing_city() : null,
				)
			);
			WC()->customer->save();

			$this->process_wc_order( $order, $order_data['body'], $transaction );

			wp_safe_redirect( $this->get_return_url( $order ) );
			exit();
		} catch ( Exception $e ) {
			$this->core_plugin->logger()->log( $e->getMessage(), 'error' );
			wc_add_notice( $e->getMessage(), 'error' );
			wp_safe_redirect( wc_get_checkout_url() );
			exit();
		}
	}


	/**
	 * Redirect after the 3DS return callback.
	 *
	 * @return void
	 */
	private function process_3ds_return_callback() {
		// Redirect to self because of SameSite cookie issues.
		// Data posted from a third party will not be able to handle sessions.
		wp_safe_redirect(
			apply_filters(
				$this->prefix_hook( '3ds_return_redirect' ),
				add_query_arg(
					array(
						$this->prefix_hook( 'callback', '', '-' ) => 'wc-3ds-process',
						'order-id'  => wc_clean( wp_unslash( $_REQUEST['order-id'] ) ) ?? '',
						'signature' => wc_clean( wp_unslash( $_REQUEST['signature'] ) ) ?? '',
						'nonce'     => wc_clean( wp_unslash( $_REQUEST['nonce'] ) ) ?? '',
					),
					home_url( '/' )
				),
			)
		);
	}


	/**
	 * Process the 3DS return callback.
	 *
	 * @return void
	 * @throws Exception Exception.
	 */
	private function process_3ds_process_callback() {
		try {

			if ( ! isset( $_REQUEST['nonce'] ) || ! wp_verify_nonce( wc_clean( wp_unslash( $_REQUEST['nonce'] ) ), $this->prefix_hook( '3ds_nonce' ) ) ) {
				throw new Exception( __( 'Nonce verification is missing or invalid.', $this->core_plugin->text_domain() ) );
			}

			$order = null;
			if ( ! empty( $_REQUEST['order-id'] ) ) {
				$order_id = (int) wc_clean( wp_unslash( $_REQUEST['order-id'] ) );

				if ( ! $order_id ) {
				throw new Exception( __( 'The order ID parameter is invalid.', $this->core_plugin->text_domain() ) );
			}

			$order = wc_get_order( $order_id );

				if ( ! $order ) {
					throw new Exception( __( 'The order cannot be found.', $this->core_plugin->text_domain() ) );
				}
			}

			$signature = wc_clean( wp_unslash( $_REQUEST['signature'] ) ) ?? '';

			if ( ! $signature || ! hash_equals( $signature, $this->hashed_signature( $order, $this->get_authentication_transaction( $order ) ) ) ) {
				throw new Exception( __( 'There was an error validating the authentication request. Please try again.', $this->core_plugin->text_domain() ) );
			}

			$result = $this->process_payment_hosted_session( $order, true );

			if ( empty( $result['result'] ) || 'success' !== $result['result'] || empty( $result['redirect'] ) ) {
				throw new Exception( __( 'There was an error processing the payment. Please try again.', $this->core_plugin->text_domain() ) );
			}

			wp_safe_redirect( apply_filters( $this->prefix_hook( '3ds_process_redirect' ), $result['redirect'], $order, $this ) );
			exit();
		} catch ( Exception $e ) {
			$this->core_plugin->logger()->log( $e->getMessage(), 'error' );

			wc_add_notice( $e->getMessage(), 'error' );

			$this->clean_cached_3ds_data( $order );
			$this->maybe_clean_hosted_cached_session( $this->get_hosted_session_data_hash() );

			$redirect_url = ( is_checkout_pay_page() && $order ) ? $order->get_checkout_payment_url() : wc_get_checkout_url();
			wp_safe_redirect( $redirect_url );

			exit();
		}
	}


	/**
	 * Validate Payment Session status.
	 *
	 * @param string $session_id      Session ID.
	 * @param string $session_version Session version.
	 *
	 * @return bool
	 */
	protected function validate_payment_session_status( $session_id, $session_version ) {
		$session = $this->retrieve_payment_session( $session_id );

		if ( empty( $session ) ) {
			return false;
		}

		if ( empty( $session['session']['updateStatus'] ) || 'SUCCESS' !== $session['session']['updateStatus'] ) {
			return false;
		}

		if ( empty( $session['session']['version'] ) || $session['session']['version'] !== $session_version ) {
			return false;
		}

		return true;
	}


	/**
	 * Retrieve Payment Session.
	 *
	 * @param string $session_id Session ID.
	 *
	 * @return array
	 */
	protected function retrieve_payment_session( $session_id ) {
		static $sessions = array();

		if ( isset( $sessions[ $session_id ] ) ) {
			return $sessions[ $session_id ];
		}

		$response = $this->api()->retrieve_session( $session_id );

		if ( ! $response['success'] || empty( $response['body']['session']['id'] ) ) {
			return array();
		}

		$sessions[ $session_id ] = $response['body'];

		return $sessions[ $session_id ];
	}


	/**
	 * Load tokenization scripts.
	 */
	public function maybe_load_tokenization_scripts() {
		if ( ! $this->supports( 'tokenization' ) ) {
			return;
		}
		if ( is_checkout() || is_add_payment_method_page() || is_checkout_pay_page() ) {
			$this->tokenization_script();
		}
	}


	/**
	 * Check if save card feature is available.
	 *
	 * @return bool
	 */
	public function display_saved_card_methods() {
		global $wp;

		if ( is_add_payment_method_page() && isset( $wp->query_vars['add-payment-method'] ) ) {
			return false;
		}

		return $this->saved_cards && ! $this->is_hosted_checkout();
	}


	/**
	 * Hide saved token hosted checkout.
	 *
	 * @param array $tokens The tokens.
	 *
	 * @return array
	 */
	public function hide_saved_token_hosted_checkout( $tokens ) {
		if ( $this->saved_cards && ! $this->is_hosted_checkout() ) {
			return $tokens;
		}

		foreach ( $tokens as $key => $token ) {
			if ( ! $token instanceof WC_Payment_Token_CC || $this->id !== $token->get_gateway_id() ) {
				continue;
			}
			unset( $tokens[ $key ] );
		}

		return $tokens;
	}


	/**
	 * Proceed with current request using new login session (to ensure consistent nonce).
	 *
	 * @param string $cookie The cookie.
	 */
	public function set_cookie_on_current_request( $cookie ) {
		$_COOKIE[ LOGGED_IN_COOKIE ] = $cookie;
	}


	/**
	 * Maybe clean hosted cached session.
	 *
	 * @return void
	 */
	public function ajax_clean_hosted_cached_session() {
		$this->maybe_clean_hosted_cached_session();
		wp_send_json(
			$this->hosted_session_id()
		);
	}

	public function ajax_update_hosted_session_from_token() {
		$session_id = wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'session_id' ) ] ?? $this->hosted_session_id() ) );
		$token_id   = wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'token_id' ) ] ?? '' ) );

		$updated_session = $this->update_session_with_token( $session_id, $token_id, true );

		if ( empty( $updated_session ) ) {
			wp_send_json_error(
				array(
					'message' => __( 'There was an error updating the payment session. Please try again.', $this->core_plugin->text_domain() ),
				)
			);
		}

		wp_send_json_success( $updated_session );
	}


	/**
	 * Authenticate payer.
	 *
	 * @return void
	 */
	public function ajax_authenticate_payer() {
		// The authentication is not required if 3DS is disabled.
		if ( ! $this->enable_3ds ) {
			wp_send_json_success();
		}

		try {
			if ( ! isset( $_POST['order_id'] ) ) {
				throw new Exception( __( 'Missing order ID.', $this->core_plugin->text_domain() ) );
			}

			$order = null;

			$order_id = wc_clean( wp_unslash( $_POST['order_id'] ) );
			if ( 'add_payment_method' !== $order_id ) {
				$order_id = absint( $order_id );
				if ( ! $order_id ) {
					throw new Exception( __( 'There was an error obtaining the order. Please refresh the page and try again.', $this->core_plugin->text_domain() ) );
				}

				$order = wc_get_order( $order_id );
				if ( ! $order ) {
					throw new Exception( __( 'There was an error obtaining the order. Please refresh the page and try again.', $this->core_plugin->text_domain() ) );
				}
			}

			$session = $this->get_posted_session_data();
			if ( empty( $session ) ) {
				throw new Exception( __( 'There was an error obtaining the payment session. Please refresh the page and try again.', $this->core_plugin->text_domain() ) );
			}

			$session_data = $this->retrieve_payment_session( $session['id'] );
			if ( empty( $session_data['sourceOfFunds'] ) ) {
				throw new Exception( __( 'There was an error validating the payment session. Please refresh the page and try again.', $this->core_plugin->text_domain() ) );
			}

			$authentication_transaction_id = $this->get_3ds_authentication( $order, $session );

			if ( is_array( $authentication_transaction_id ) ) {

				$this->maybe_cache_saving_card( $order );

				wp_send_json_success( $authentication_transaction_id );
			}

			// Clean the current authentication once the payment is authorized.
			$this->clean_cached_3ds_data( $order, true );

			wp_send_json_success();
		} catch ( Exception $e ) {
			$this->clean_cached_3ds_data( $order );
			$this->core_plugin->logger()->log( $e->getMessage(), 'error' );
			wp_send_json_error(
				array(
					'message' => $e->getMessage(),
				)
			);
		}
	}


	/**
	 * Display a notice after the save payment method checkbox.
	 *
	 * @return void
	 */
	public function maybe_display_save_card_notice() {
		// If we're displaying the checkbox, no need to show the notice.
		if ( $this->display_save_checkbox ) {
			return;
		}

		// Unless we're forcing the save payment method, no notice is needed.
		if ( ! $this->is_forcing_save_payment_method() ) {
			return;
		}

		// It is an overstatement to show the notice when adding a payment method.
		if ( is_add_payment_method_page() ) {
			return;
		}

		echo '<p class="wc-gateway-' . esc_attr( $this->id ) . '-save-card-notice"><i>' . wp_kses_post( $this->save_card_notice_text() ) . '</i></p>';
	}


	/**
	 * Get save card notice text.
	 *
	 * @return string
	 */
	protected function save_card_notice_text() {
		return apply_filters(
			$this->prefix_hook( 'save_card_notice' ),
			__( 'Your payment method will be saved for future purchases.', $this->core_plugin->text_domain() )
		);
	}


	/**
	 * Relocalize cart total when DCC is enabled.
	 *
	 * @param  array $fragments Fragments to update via AJAX.
	 * @return array
	 */
	public function relocalize_cart_total( $fragments ) {
		$this->maybe_update_hosted_session();
		return $fragments;
	}


	/**
	 * Update the order amount and currency in the hosted session if needed.
	 *
	 * @return void
	 */
	public function maybe_update_hosted_session() {
		if ( ! WC()->cart || empty( WC()->session ) ) {
			return;
		}

		$current_session = $this->current_hosted_session_id();
		if ( ! $current_session ) {
			return;
		}

		$this->maybe_update_hosted_session_config( $current_session );
	}
}
