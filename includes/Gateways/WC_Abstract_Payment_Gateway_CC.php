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
use GatewayPaymentCore\API;
use GatewayPaymentCore\Compat\WC_Payment_Gateway_Block_Compat_CC;
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
	protected $block_compat_class = WC_Payment_Gateway_Block_Compat_CC::class;


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
	 * Debug enabled.
	 *
	 * @var bool
	 */
	protected $debug = false;


	/**
	 * Display save card checkbox.
	 *
	 * @var bool
	 */
	protected $display_save_checkbox = true;

	/**
	 * List of disabled addons.
	 *
	 * @var array
	 */
	protected $disabled_addons = array();


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
		$this->merchant_name        = ! empty( $this->get_option( 'merchant_name' ) ) ? $this->get_option( 'merchant_name' ) : get_bloginfo( 'name' );
		$this->saved_cards          = ! empty( $this->get_option( 'saved_cards' ) && 'yes' === $this->get_option( 'saved_cards' ) );
		$this->enable_3ds           = ! empty( $this->get_option( '_3d_secure' ) && 'yes' === $this->get_option( '_3d_secure' ) );
		$this->debug                = ! empty( $this->get_option( 'debug' ) && 'yes' === $this->get_option( 'debug' ) );

		// Load the gateway support features.
		$this->init_supports();

		// Initialize the Addons.
		$this->init_addons();

		// Load the form fields.
		$this->init_form_fields();

		// Add hooks.
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
		add_action( 'woocommerce_receipt_' . $this->id, array( $this, 'payment_fields' ) );
		add_action( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_error', array( $this, 'handle_failed_payment' ), 10, 2 );
		add_filter( 'woocommerce_get_customer_payment_tokens', array( $this, 'hide_saved_token_hosted_checkout' ), 10 );
		add_action( 'set_logged_in_cookie', array( $this, 'set_cookie_on_current_request' ) );

		// Add plugin return callbacks.
		add_action( 'template_redirect', array( $this, 'maybe_handle_return_callback' ) );

		// Add API actions.
		add_action( 'woocommerce_api_PAYMENTS_CORE_HOOK_PREFIX_wc-webhook', array( $this, 'process_notification_api_callback' ) );

		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_enqueue_scripts', array( $this, 'enqueue_scripts' ), 20 );
		add_filter( 'script_loader_tag', array( $this, 'maybe_add_callbacks_attr' ), 10, 2 );

		// Gateway AJAX actions.
		add_action( 'wc_ajax_PAYMENTS_CORE_HOOK_PREFIX_reset_hosted_session', array( $this, 'ajax_clean_hosted_cached_session' ) );
		add_action( 'wc_ajax_PAYMENTS_CORE_HOOK_PREFIX_update_hosted_session_from_token', array( $this, 'ajax_update_hosted_session_from_token' ) );
		add_action( 'wc_ajax_PAYMENTS_CORE_HOOK_PREFIX_authenticate_payer', array( $this, 'ajax_authenticate_payer' ) );

		// Session handling.
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
		$addons = array(
			'subscriptions'               => 'init_addon_subscriptions',
			'pre_orders'                  => 'init_addon_pre_orders',
			'dynamic_currency_conversion' => 'init_addon_dcc',
		);
		foreach ( $addons as $addon => $init_method ) {
			if ( in_array( $addon, $this->disabled_addons, true ) ) {
				continue;
			}
			$this->{$init_method}();
		}
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
		// Fix issue when there's a single region, and the setting already exists.
		$regions = wp_list_pluck( $this->core_plugin->payment_regions(), 'name', 'code' );

		if ( isset( $regions['test'] ) ) {
			unset( $regions['test'] );
		}

		if ( empty( $regions ) || count( $regions ) < 2 ) {
			$_POST['woocommerce_PAYMENTS_CORE_HOOK_PREFIX_region'] = \array_key_first( $regions ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		}

		parent::process_admin_options();

		// Update settings that needs to be updated before saving to correctly display the notices.
		$this->validate_credentials();

		$this->init_form_fields();
	}

	/**
	 * Get a posted configuration value.
	 *
	 * @param string $key The configuration key.
	 *
	 * @return mixed
	 */
	private function get_posted_config_value( $key ) {
		return isset( $_POST[ 'woocommerce_PAYMENTS_CORE_HOOK_PREFIX_' . $key ] ) ? wc_clean( wp_unslash( $_POST[ 'woocommerce_PAYMENTS_CORE_HOOK_PREFIX_' . $key ] ) ) : $this->get_option( $key ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
	}


	/**
	 * Validate API keys.
	 *
	 * @return void
	 */
	public function validate_credentials() {
		$is_sandbox = 'no' === $this->get_posted_config_value( 'sandbox' ) ? false : true;
		$this->core_plugin->update_gateway_setting( 'sandbox', $is_sandbox ? 'yes' : 'no' );

		$region = $this->get_posted_config_value( 'region' );
		$this->core_plugin->update_gateway_setting( 'region', $region );

		$credentials = array(
			''      => false,
			'test_' => true,
		);

		foreach ( $credentials as $prefix => $is_set_for_test ) {
			$merchant_id         = $this->get_posted_config_value( $prefix . 'merchant_id' );
			$password            = $this->get_posted_config_value( $prefix . 'password' );
			$notification_secret = $this->get_posted_config_value( $prefix . 'notification_secret' );

			if ( $is_sandbox === $is_set_for_test ) {
				// Validate that at least the current set of credentials is set.
				if ( empty( $merchant_id ) || empty( $password ) ) {
					WC_Admin_Settings::add_error( __( 'Merchant ID and API Key are required.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
				}
			}

			$this->core_plugin->update_gateway_setting( $prefix . 'merchant_id', $merchant_id );
			$this->core_plugin->update_gateway_setting( $prefix . 'password', $password );
			$this->core_plugin->update_gateway_setting( $prefix . 'notification_secret', $notification_secret );
		}

		// Force read settings again.
		$this->core_plugin->merchant_id( true ); // Force refresh merchant ID.
		$this->core_plugin->password( true ); // Force refresh merchant password.
		$this->core_plugin->notification_secret( true ); // Force refresh merchant notification secret.

		$validated = false;
		$regions   = $this->core_plugin->payment_regions();

		$attempting_region = $is_sandbox ? 'test' : $region;

		if ( isset( $regions[ $attempting_region ] ) ) {
			$regions = array( $attempting_region => $regions[ $attempting_region ] );
		} else {
			// TODO: Maybe cycle through all regions if region is not set or invalid.
			$regions = array();
		}

		foreach ( $regions as $region_key => $region_info ) {
			$urls = isset( $region_info['urls'] ) ? $region_info['urls'] : array();
			if ( empty( $urls ) && isset( $region_info['url'] ) ) {
				$urls = array( $region_info['url'] );
			}
			foreach ( $urls as $url ) {
				$this->core_plugin->update_validated_domain( $url );
				$response = $this->api()->payment_options_inquiry();
				if ( $response['success'] && ! empty( $response['body'] ) ) {
					$validated = true;
					break 2;
				}
			}
		}

		if ( ! $validated || ! isset( $response ) ) {
			WC_Admin_Settings::add_error( __( 'Failed to validate API credentials. Please validate your credentials and save your account details again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			$this->core_plugin->update_validated_credentials( false );
			$this->core_plugin->update_validated_domain( false );
			$this->core_plugin->update_payment_operations( array() );
			$this->core_plugin->update_transaction_sources( array() );
			return;
		}

		$this->core_plugin->logger()->log( __( 'API credentials validated successfully.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );

		$this->core_plugin->update_validated_credentials( true );

		$this->core_plugin->update_payment_operations( $response['body']['supportedPaymentOperations'] ?? array() );

		$transaction_sources = array();
		foreach ( $response['body']['paymentTypes'] as $key => $info ) {
			$transaction_sources[ $key ] = array();
			foreach ( $info['transactionSources'] as $source ) {
				$transaction_sources[ $key ][] = $source['transactionSource'];
			}
		}
		$this->core_plugin->update_transaction_sources( $transaction_sources );
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
				wc_print_notice( __( 'There was an error creating the payment session. Please review your data and try again or try a different payment method.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ), 'error' );
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
			wc_add_notice( __( 'There was an error creating the payment session. Please refresh the page and try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ), 'error' );
			return;
		}

		$this->maybe_load_tokenization_scripts();

		wp_enqueue_script( 'wc-credit-card-form' );

		$template_data = array(
			'gateway'         => $this,
			'session_id'      => $session_id,
			'session_attempt' => uniqid( $session_id ),
			'enable_3ds'      => $this->enable_3ds,
		);

		/**
		 * Filter the hosted session payment fields template data.
		 *
		 * @since 1.0.0
		 */
		$template_data = apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_payment_fields_hosted_session_template_data', $template_data, $this );

		if ( $this->enable_3ds && $this->is_pay_for_order_page() ) {
			$template_data['threeds_data'] = $this->get_cached_3ds_data();
		}

		$template_data['order_id'] = false;
		$order                     = Utils::get_current_order();
		if ( $order instanceof WC_Order ) {
			$template_data['order_id'] = $order->get_id();
		}

		$display_tokenization = $this->display_saved_card_methods();

		// There is an ongoing 3DS transaction, do not display the tokenization.
		if ( ! empty( $template_data['threeds_data'] ) ) {
			$display_tokenization = false;
		}

		if ( $display_tokenization ) {
			$this->saved_payment_methods();
		}

		/**
		 * Filter whether to display the save payment method checkbox.
		 *
		 * @since 1.0.0
		 */
		$this->display_save_checkbox = apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_display_save_payment_method_checkbox', $display_tokenization );

		$this->core_plugin->payment_core()->template()->get(
			'payment-fields-hosted-session.php',
			$template_data,
		);

		/**
		 * Fires after the hosted session payment fields are rendered.
		 *
		 * @since 1.0.0
		 */
		do_action( 'PAYMENTS_CORE_HOOK_PREFIX_after_payment_fields_hosted_session', $this );

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
				throw new Exception( __( 'Invalid order.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ), 'error' );
			}

			/**
			 * Fires before the payment is processed.
			 *
			 * @since 1.0.0
			 */
			do_action( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_before', $order );

			/**
			 * Filter to allow addons to handle payment processing.
			 *
			 * @since 1.0.0
			 */
			$addon_payment = apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_addon', false, $order );
			if ( ! empty( $addon_payment ) && is_array( $addon_payment ) ) {
				return $addon_payment;
			}

			// Prevent double payment processing if the order is already paid. Specially relevant for hosted checkout mode.
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

			// Do cleanups.
			if ( $this->enable_3ds ) {
				// Clean once more after saving the cards.
				$this->clean_cached_3ds_data( $order );
			}
			$this->maybe_clean_hosted_cached_session( $this->get_hosted_session_data_hash() );

			/**
			 * Fires when a payment processing error occurs.
			 *
			 * @since 1.0.0
			 */
			do_action( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_error', $e, ! empty( $order ) ? $order : null );

			return array(
				'result'       => 'error',
				'redirect'     => '',
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
		$order->update_status( 'pending', __( 'Pending payment', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );

		if ( 'redirect' === $this->hosted_checkout_mode ) {

			$session_id = $this->checkout_session_id( $order );

			if ( ! $session_id ) {
				wc_add_notice( __( 'There was an error creating the payment session. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ), 'error' );
				return array(
					'result'   => 'error',
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

		// Set current payment method.
		WC()->session->set( 'chosen_payment_method', $this->id );

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
			if ( $this->is_order( $order ) ) {
				$session = $order->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_payment_session' );
			} else {
				if ( empty( WC()->session ) ) {
					throw new Exception( esc_html( __( 'There was an error with the payment authentication. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
				}
				$session = WC()->session->get( 'PAYMENTS_CORE_HOOK_PREFIX_payment_session' );
			}
		} else {
			$session = $this->get_posted_session_data();
		}

		if ( empty( $session ) ) {
			throw new Exception( esc_html( __( 'There was an error obtaining the payment session. Please refresh the page and try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		// TODO: Maybe avoid fetching the session if it was fetched within get_posted_session_data (updated with token ID).
		$session_data = $this->retrieve_payment_session( $session['id'] );

		if ( empty( $session_data['sourceOfFunds'] ) ) {
			throw new Exception( esc_html( __( 'There was an error validating the payment session. Please refresh the page and try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		// Forcefully validate CVC value.
		if (
			! $this->is_saved_payment_method() &&
			! empty( $session_data['sourceOfFunds']['provided']['card'] ) &&
			empty( $session_data['sourceOfFunds']['provided']['card']['securityCode'] )
		) {
			throw new Exception( esc_html( __( 'Security code is missing.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		if ( $this->is_order( $order ) ) {
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

		/**
		 * Filter the payment data before processing the transaction.
		 *
		 * @since 1.0.0
		 */
		$payment_data = apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_data', $payment_data, $order );

		if ( $this->enable_3ds ) {
			$authentication_transaction_id = $this->get_3ds_authentication( $order, $session, $processing_3ds_callback );

			if ( is_array( $authentication_transaction_id ) ) {

				$this->maybe_cache_location();

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

		/**
		 * Filter the hosted session payment data before processing.
		 *
		 * @since 1.0.0
		 */
		$payment_data = apply_filters(
			'PAYMENTS_CORE_HOOK_PREFIX_process_payment_hosted_session_data',
			$payment_data,
			$order,
			$session
		);

		$saving_card = $this->is_forcing_save_payment_method() || $this->is_saving_payment_method() || WC()->session->get( 'PAYMENTS_CORE_HOOK_PREFIX_saving_payment_method' );
		$using_token = $this->is_saved_payment_method() || ( 'CARD' === $session_data['sourceOfFunds']['type'] && isset( $session_data['sourceOfFunds']['token'] ) );
		if ( $saving_card || $using_token ) {
			if ( ! isset( $payment_data['sourceOfFunds'] ) ) {
				$payment_data['sourceOfFunds'] = array();
			}
			if ( ! isset( $payment_data['sourceOfFunds']['provided'] ) ) {
				$payment_data['sourceOfFunds']['provided'] = array();
			}
			if ( ! isset( $payment_data['sourceOfFunds']['provided']['card'] ) ) {
				$payment_data['sourceOfFunds']['provided']['card'] = array();
			}
			if ( $saving_card ) {
				$payment_data['sourceOfFunds']['provided']['card']['storedOnFile'] = 'TO_BE_STORED';
			} elseif ( $using_token ) {
				$payment_data['sourceOfFunds']['provided']['card']['storedOnFile'] = 'STORED';
			}
		}

		if ( 'VERIFY' === $payment_data['apiOperation'] || empty( $order->get_date_paid( 'edit' ) ) || ! $this->maybe_flag_order_as_paid( $order ) ) {
			$this->create_payment_transaction( $order, $unique_order_id, $transaction_id, $payment_data );
		}

		$saved_token_id = $this->maybe_save_cards( $order, $session_data );

		$return_url = $this->get_return_url( $order );

		// Do cleanups.
		if ( $this->enable_3ds ) {
			// Clean once more after saving the cards.
			$this->clean_cached_3ds_data( $order );
		}
		$this->maybe_clean_hosted_cached_session( $this->get_hosted_session_data_hash() );

		return array(
			'result'         => 'success',
			'redirect'       => $return_url,
			'saved_token_id' => $saved_token_id,
		);
	}

	/**
	 * Get the return URL.
	 *
	 * @param WC_Order|null $order   Order object.
	 * @param bool          $success Whether the payment was successful.
	 *
	 * @return string
	 */
	public function get_return_url( $order = null, $success = true ) {
		// Attempt to use a custom redirect URL if set in the session.
		$redirect = WC()->session->get( 'PAYMENTS_CORE_HOOK_PREFIX_payment_return_url_redirect' );
		if ( $redirect ) {
			WC()->session->__unset( 'PAYMENTS_CORE_HOOK_PREFIX_payment_return_url_redirect' );
			return $redirect;
		}

		if ( ! $success ) {
			$is_checkout_pay_page = $this->is_pay_for_order_page() || WC()->session->get( 'PAYMENTS_CORE_HOOK_PREFIX_pay_for_order_page', false );
			if ( $is_checkout_pay_page ) {
				WC()->session->__unset( 'PAYMENTS_CORE_HOOK_PREFIX_pay_for_order_page' );
			}
			return ( $is_checkout_pay_page && $order ) ? $order->get_checkout_payment_url() : wc_get_checkout_url();
		}

		// Fallback to the parent return URL.
		return parent::get_return_url( $order );
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
			throw new Exception( esc_html( __( 'There was an error processing the payment. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		$response = $this->api()->create_transaction( $unique_order_id, $transaction_id, $payment_data );

		if ( ! $response['success'] || empty( $response['body']['result'] ) || ! empty( $response['error'] ) ) {
			$error = __( 'There was an error processing the payment. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' );
			throw new Exception( esc_html( $error ) );
		}

		if ( 'SUCCESS' !== $response['body']['result'] ) {
			$error = __( 'There was an error processing the payment. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' );
			if ( ! empty( $response['body']['response']['acquirerMessage'] ) ) {
				$error = $response['body']['response']['acquirerMessage'];
			} elseif ( ! empty( $response['body']['response']['gatewayCode'] ) ) {
				$error = $this->get_mapped_error_code( $response['body']['response']['gatewayCode'] );
			}
			throw new Exception( esc_html( $error ) );
		}

		if ( empty( $response['body']['transaction'] ) || empty( $response['body']['transaction']['id'] ) ) {
			throw new Exception( esc_html( __( 'There was an error obtaining the transaction. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		if ( empty( $response['body']['order'] ) ) {
			throw new Exception( esc_html( __( 'There was an error obtaining the order data. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		$order_data = $this->api()->retrieve_order( $unique_order_id );
		if ( ! empty( $order_data['body'] ) ) {
			$order_data = $order_data['body'];
		} else {
			$order_data = $response['body']['order'];
		}

		if ( $this->is_order( $order ) ) {
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
		// Always save on add payment method page.
		if ( is_add_payment_method_page() ) {
			return true;
		}

		/**
		 * Filter whether saving the payment method should be forced.
		 *
		 * @since 1.0.0
		 */
		$forced_save = (bool) apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_forced_save_payment_method', false );
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

		if ( $this->is_saved_payment_method() || ( 'CARD' === $session_data['sourceOfFunds']['type'] && isset( $session_data['sourceOfFunds']['token'] ) ) ) {
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
			/**
			 * Fires after a payment method is saved to the order.
			 *
			 * @since 1.0.0
			 */
			do_action( 'PAYMENTS_CORE_HOOK_PREFIX_payment_method_saved', $order, $current_token_id );
			return $current_token_id;
		}

		if ( ! $forced_save && ! $this->is_saving_payment_method() && ! WC()->session->get( 'PAYMENTS_CORE_HOOK_PREFIX_saving_payment_method' ) ) {
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

		if ( $this->is_order( $order ) ) {
			// This adds a list of tokens endlessly after several changes, making it very difficult to be useful.
			// TODO: Consider revising this behavior in the future.
			$order->add_payment_token( new WC_Payment_Token_CC( $payment_token_id ) );
		}

		/**
		 * Fires after a new payment method token is saved.
		 *
		 * @since 1.0.0
		 */
		do_action( 'PAYMENTS_CORE_HOOK_PREFIX_payment_method_saved', $order, $payment_token_id );

		WC()->session->__unset( 'PAYMENTS_CORE_HOOK_PREFIX_saving_payment_method' );

		return $payment_token_id;
	}


	/**
	 * Maybe cache the saving card.
	 */
	public function maybe_cache_location() {
		if ( $this->saved_cards ) {
			if ( $this->is_saving_payment_method() || \is_add_payment_method_page() || ( isset( $_REQUEST['order_id'] ) && \wc_clean( \wp_unslash( $_REQUEST['order_id'] ) ) === 'add_payment_method' ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
				WC()->session->set( 'PAYMENTS_CORE_HOOK_PREFIX_saving_payment_method', true );
			}
		}

		if ( $this->is_pay_for_order_page() || ( isset( $_REQUEST['order_id'] ) && \wc_clean( \wp_unslash( $_REQUEST['order_id'] ) ) ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			WC()->session->set( 'PAYMENTS_CORE_HOOK_PREFIX_pay_for_order_page', true );
		}

		if ( doing_action( 'woocommerce_rest_checkout_process_payment_with_context' ) ) {
			WC()->session->set( 'PAYMENTS_CORE_HOOK_PREFIX_processing_via_api', true );
		}
	}


	/**
	 * Get the 3DS authentication from the order.
	 *
	 * @param WC_Order $order                   Order object.
	 * @param array    $session                 Session data.
	 * @param bool     $processing_3ds_callback Processing 3DS callback.
	 *
	 * @return string|array
	 * @throws Exception Exception.
	 */
	public function get_3ds_authentication( $order, $session, $processing_3ds_callback = false ) {
		$unique_order_id = $this->unique_order_id( $order );
		if ( $processing_3ds_callback ) {
			$transaction_id = $this->get_authentication_transaction( $order );

			if ( empty( $transaction_id ) || ! $this->validate_authentication( $unique_order_id, $transaction_id ) ) {
				throw new Exception( esc_html( __( 'There was an error with the payment authentication. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
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

	/**
	 * Initiate 3DS authentication.
	 *
	 * @param WC_Order $order           Order object.
	 * @param array    $session         Session data.
	 * @param string   $unique_order_id Unique order ID.
	 *
	 * @return array
	 */
	protected function intiate_3ds_authentication( $order, $session, $unique_order_id ) {
		$transaction_id = $this->unique_transaction_id( $order );

		$init_authentication = array(
			'apiOperation' => 'INITIATE_AUTHENTICATION',
			'session'      => $session,
		);

		/**
		 * Filter the 3DS authentication initiation data.
		 *
		 * @since 1.0.0
		 */
		$init_authentication = apply_filters(
			'PAYMENTS_CORE_HOOK_PREFIX_process_payment_hosted_session_3ds_data',
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
							'PAYMENTS_CORE_HOOK_PREFIX-callback' => 'wc-3ds',
							'order-id'  => $order ? $order->get_id() : null,
							'signature' => $this->hashed_signature( $order, $transaction_id ),
							'nonce'     => wp_create_nonce( 'PAYMENTS_CORE_HOOK_PREFIX_3ds_nonce' ),
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

			/**
			 * Filter the 3DS authenticate payer request data.
			 *
			 * @since 1.0.0
			 */
			$authenticate_payer = apply_filters(
				'PAYMENTS_CORE_HOOK_PREFIX_process_payment_hosted_session_3ds_authenticate_payer_data',
				$authenticate_payer,
				$order,
				$session
			);

			$authenticate_payer['apiOperation'] = 'AUTHENTICATE_PAYER';

			$authentication_response = $this->api()->authenticate_payer( $unique_order_id, $transaction_id, $authenticate_payer );

			return $this->process_authentication_response( $authentication_response, $order, $transaction_id, $session );
		} catch ( Exception $e ) {
			$this->clean_cached_3ds_data( $order );
			throw $e;
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
	 * Get the authentication transaction ID.
	 *
	 * @param WC_Order $order          Order object.
	 *
	 * @return string|null
	 */
	protected function get_authentication_transaction( $order = null ) {
		if ( $this->is_order( $order ) ) {
			return $order->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_authentication_transaction' );
		} else {
			if ( empty( WC()->session ) ) {
				return null;
			}
			return WC()->session->get( 'PAYMENTS_CORE_HOOK_PREFIX_authentication_transaction' );
		}
	}


	/**
	 * Clean the cached authentication transaction.
	 *
	 * @param WC_Order $order          Order object.
	 * @param string   $transaction_id Transaction ID.
	 * @param bool     $save           Whether to save the meta data.
	 *
	 * @return void
	 */
	protected function update_authentication_transaction( $order, $transaction_id, $save = true ) {
		if ( $this->is_order( $order ) ) {
			// Clean the authentication transaction.
			if ( null !== $transaction_id ) {
				$order->update_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_authentication_transaction', $transaction_id );
			} else {
				$order->delete_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_authentication_transaction' );
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
				WC()->session->set( 'PAYMENTS_CORE_HOOK_PREFIX_authentication_transaction', $transaction_id );
			} else {
				WC()->session->__unset( 'PAYMENTS_CORE_HOOK_PREFIX_authentication_transaction' );
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
		if ( ! isset( $_SERVER['HTTP_USER_AGENT'] ) || empty( $_POST['PAYMENTS_CORE_HOOK_PREFIX_3ds_data'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
			throw new Exception( esc_html( __( 'There was an error with the payment authentication. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		return array(
			'browser'        => wc_clean( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ),
			'browserDetails' => wp_parse_args(
				json_decode( wc_clean( wp_unslash( $_POST['PAYMENTS_CORE_HOOK_PREFIX_3ds_data'] ) ), true ), // phpcs:ignore WordPress.Security.NonceVerification.Missing
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
			throw new Exception( esc_html( __( 'There was an error with the payment authentication. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		if ( ! empty( $response['body']['authentication'] ) && ! is_array( $response['body']['authentication'] ) && 'NONE' === $response['body']['authentication'] ) {
			return false;
		}

		if ( ! empty( $response['body']['response']['gatewayRecommendation'] ) && 'PROCEED' !== $response['body']['response']['gatewayRecommendation'] ) {

			if ( 'RESUBMIT_WITH_ALTERNATIVE_PAYMENT_DETAILS' === $response['body']['response']['gatewayRecommendation'] ) {
				throw new Exception( esc_html( __( 'The payment method was declined. Please try again with a different payment method.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
			}

			throw new Exception( esc_html( __( 'The payment method was declined.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		if ( empty( $response['body']['result'] ) || 'SUCCESS' !== $response['body']['result'] ) {
			throw new Exception( esc_html( __( 'There was an error with the payment authentication. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
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
			throw new Exception( esc_html( __( 'There was an error with the payment authentication. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		if ( empty( $response['body']['result'] ) || ! in_array( $response['body']['result'], array( 'SUCCESS', 'PENDING' ), true ) ) {
			throw new Exception( esc_html( __( 'There was an error with the payment authentication. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		if ( 'PROCEED' !== $response['body']['response']['gatewayRecommendation'] ) {

			if ( 'RESUBMIT_WITH_ALTERNATIVE_PAYMENT_DETAILS' === $response['body']['response']['gatewayRecommendation'] ) {
				throw new Exception( esc_html( __( 'The payment method was declined. Please try again with a different payment method.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
			}

			throw new Exception( esc_html( __( 'The payment method was declined.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		$data = $this->formatted_3ds_data( $response );

		if ( empty( $data ) || 'SUCCESS' === $response['body']['result'] ) {
			return true;
		}

		if ( 'PENDING' === $response['body']['result'] && empty( $data['action'] ) ) {
			throw new Exception( esc_html( __( 'There was an error with the payment authentication. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		if ( $this->is_order( $order ) ) {
			// Send the ACS form to the client.
			$order->update_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_payment_session', $session );
			$order->save();
		} else {
			if ( empty( WC()->session ) ) {
				throw new Exception( esc_html( __( 'There was an error with the payment authentication. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
			}
			WC()->session->set( 'PAYMENTS_CORE_HOOK_PREFIX_payment_session', $session );
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

		$return['PAYMENTS_CORE_HOOK_PREFIX_3ds'] = wp_json_encode( $data );

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
			$order->update_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_3ds_data', $data );
			$order->save_meta_data();
			return;
		}

		WC()->session->set( $order->get_id() . 'PAYMENTS_CORE_HOOK_PREFIX_3ds_data', $data );
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
			$data = WC()->session->get( $order->get_id() . 'PAYMENTS_CORE_HOOK_PREFIX_3ds_data' );
		}

		if ( empty( $data ) ) {
			$data = $order->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_3ds_data' );
		}

		return $data;
	}


	/**
	 * Clean the cached 3DS data.
	 *
	 * @param WC_Order|null $order      Order object.
	 * @param bool          $is_success Whether the authentication was successful.
	 *
	 * @return void
	 */
	public function clean_cached_3ds_data( $order = null, $is_success = false ) {
		$this->update_authentication_transaction( $order, null, false );
		if ( ! empty( WC()->session ) ) {
			WC()->session->__unset( 'PAYMENTS_CORE_HOOK_PREFIX_3ds_data' );
			WC()->session->__unset( 'PAYMENTS_CORE_HOOK_PREFIX_payment_session' );
		}

		if ( $order instanceof WC_Order ) {
			$order->delete_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_3ds_data' );
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
			$errors->add( 'invalid_session', __( 'There was an error obtaining the payment session. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
		} elseif ( ! $this->validate_payment_session_status( $session['id'], $session['version'] ) ) {
			// Validate the session.
			$this->maybe_clean_hosted_cached_session();
			$errors->add( 'invalid_session', __( 'The Payment Session is invalid or has expired. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
		}

		/**
		 * Filter the validation errors for the payment fields.
		 *
		 * @since 1.0.0
		 */
		$errors = apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_validate_fields', $errors );

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
		$id = ! empty( $_POST['PAYMENTS_CORE_HOOK_PREFIX_session_id'] ) ? wc_clean( wp_unslash( $_POST['PAYMENTS_CORE_HOOK_PREFIX_session_id'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing
		if ( ! $id ) {
			return array();
		}

		$version = ! empty( $_POST['PAYMENTS_CORE_HOOK_PREFIX_session_version'] ) ? wc_clean( wp_unslash( $_POST['PAYMENTS_CORE_HOOK_PREFIX_session_version'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing
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
		return is_checkout() && isset( $_GET['pay_for_order'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	}


	/**
	 * Is saved payment method used.
	 *
	 * @return bool
	 */
	public function is_saved_payment_method() {
		return isset( $_POST[ $this->payment_token_key() ] ) && 'new' !== wc_clean( wp_unslash( $_POST[ $this->payment_token_key() ] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
	}


	/**
	 * Get saved payment method used by the user.
	 *
	 * @return int|null
	 */
	public function get_current_saved_payment_method() {
		return $this->is_saved_payment_method() && isset( $_POST[ $this->payment_token_key() ] ) ? absint( wc_clean( wp_unslash( $_POST[ $this->payment_token_key() ] ) ) ) : null; // phpcs:ignore WordPress.Security.NonceVerification.Missing
	}


	/**
	 * Is saving payment method.
	 *
	 * @return bool
	 */
	protected function is_saving_payment_method() {
		return isset( $_POST[ 'wc-' . $this->id . '-new-payment-method' ] ) && wc_clean( wp_unslash( $_POST[ 'wc-' . $this->id . '-new-payment-method' ] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
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
	 * Update session with payment token.
	 *
	 * @param string $session_id       Session ID.
	 * @param int    $payment_token_id Payment token ID.
	 * @param bool   $return_response  Whether to return the response.
	 *
	 * @return array
	 */
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
			$this->core_plugin->logger()->log( __( 'There was an error updating the payment session. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ), 'error' );
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
	 * @throws Exception Exception.
	 */
	public function add_payment_method() {
		try {
			WC()->session->set( 'PAYMENTS_CORE_HOOK_PREFIX_payment_return_url_redirect', wc_get_account_endpoint_url( 'payment-methods' ) );
			$result = $this->process_payment_hosted_session( null );

			if ( 'success' !== $result['result'] ) {
				return $result;
			}

			if ( isset( $result['saved_token_id'] ) ) {
				$token_id = $result['saved_token_id'];
			} else {
				throw new Exception( __( 'There was an error saving the payment method. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			/**
			 * Fires after a payment method is successfully added.
			 *
			 * @since 1.0.0
			 */
			do_action( 'PAYMENTS_CORE_HOOK_PREFIX_add_payment_method_success', $token_id, $this );

			return $result;
		} catch ( Exception $e ) {
			$this->maybe_clean_hosted_cached_session( $this->get_hosted_session_data_hash() );
			$this->core_plugin->logger()->log( $e->getMessage(), 'error' );
			wc_add_notice( $e->getMessage(), 'error' );
			return array(
				'result'   => 'error',
				'redirect' => wc_get_account_endpoint_url( 'payment-methods' ),
			);
		}
	}


	/**
	 * Get the hosted checkout script handle.
	 *
	 * @return string
	 */
	public function hosted_checkout_script_handle() {
		return 'PAYMENTS_CORE_HOOK_PREFIX_hosted_checkout';
	}


	/**
	 * Get the hosted session script handle.
	 *
	 * @return string
	 */
	public function hosted_session_script_handle() {
		return 'PAYMENTS_CORE_HOOK_PREFIX_hosted_session';
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

		$gateway_script = 'PAYMENTS_CORE_HOOK_PREFIX_gateway';

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

		if ( \is_add_payment_method_page() ) {
			$scripts[ $gateway_script ]['deps'] = array_merge(
				array( 'jquery-blockui' ),
				$scripts[ $gateway_script ]['deps'] ?? array()
			);
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
					/**
					 * Filter whether to display the save payment method checkbox in the hosted session.
					 *
					 * @since 1.0.0
					 */
					$this->display_save_checkbox = apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_display_save_payment_method_checkbox', $this->display_saved_card_methods() );

					$session_id                      = $this->hosted_session_id();
					$data['sessionId']               = $session_id;
					$data['sessionAttempt']          = uniqid( $session_id );
					$data['displaySaveCardCheckbox'] = $this->display_save_checkbox;

					// Handle notices in some cases with blocks.
					$maybe_display_payment_notice = WC()->session->get( 'PAYMENTS_CORE_HOOK_PREFIX_payment_error_message', false );
					if ( $maybe_display_payment_notice ) {
						$data['paymentErrorMessage'] = $maybe_display_payment_notice;
						WC()->session->__unset( 'PAYMENTS_CORE_HOOK_PREFIX_payment_error_message' );
					}
				}
				break;
		}

		/**
		 * Filter the payment method data passed to the frontend scripts.
		 *
		 * @since 1.0.0
		 */
		return apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_payment_method_data', $data, $this );
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
			API::API_VERSION,
			$this->core_plugin->merchant_id()
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

		$session_key          = 'PAYMENTS_CORE_HOOK_PREFIX_session_id_' . $order_id;
		$session_duration_key = 'PAYMENTS_CORE_HOOK_PREFIX_session_duration_' . $order_id;

		if ( ! isset( $_POST['createaccount'] ) && ! empty( WC()->session ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
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

		/**
		 * Filter the checkout session payload before creating the session.
		 *
		 * @since 1.0.0
		 */
		$payload = apply_filters(
			'PAYMENTS_CORE_HOOK_PREFIX_checkout_session_payload',
			$payload,
			$order,
		);

		$response = $this->api()->create_session( $payload );

		if ( ! $response['success'] || empty( $response['body']['session']['id'] ) || empty( $response['body']['successIndicator'] ) ) {
			return '';
		}

		$session_id        = $response['body']['session']['id'];
		$success_indicator = $response['body']['successIndicator'];

		$order->update_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_session_id', $session_id );
		$order->update_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_success_indicator', $success_indicator );
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

			/**
			 * Fires after a new hosted session is created.
			 *
			 * @since 1.0.0
			 */
			do_action( 'PAYMENTS_CORE_HOOK_PREFIX_hosted_session_created', $session_id, $this );
		}

		$this->maybe_update_hosted_session_config( $session_id );

		return $session_id;
	}


	/**
	 * Maybe update hosted session configuration.
	 *
	 * @param string $session_id Session ID.
	 *
	 * @return void
	 */
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
		/**
		 * Filter the order payload for the hosted checkout session.
		 *
		 * @since 1.0.0
		 */
		return apply_filters(
			'PAYMENTS_CORE_HOOK_PREFIX_checkout_session_order_payload',
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
		/**
		 * Filter the order payload for the hosted session.
		 *
		 * @since 1.0.0
		 */
		return apply_filters(
			'PAYMENTS_CORE_HOOK_PREFIX_session_order_payload',
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
		/**
		 * Filter the interaction payload for the hosted checkout session.
		 *
		 * @since 1.0.0
		 */
		return apply_filters(
			'PAYMENTS_CORE_HOOK_PREFIX_checkout_session_interaction_payload',
			array(
				'operation'      => $this->transaction_mode,
				'returnUrl'      => add_query_arg(
					array(
						'PAYMENTS_CORE_HOOK_PREFIX-callback' => 'wc',
						'order-id' => $order->get_id(),
						'nonce'    => wp_create_nonce( 'PAYMENTS_CORE_HOOK_PREFIX_nonce' ),
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

		$session_key          = 'PAYMENTS_CORE_HOOK_PREFIX_session_id_' . $order_id;
		$session_duration_key = 'PAYMENTS_CORE_HOOK_PREFIX_session_duration_' . $order_id;

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

		WC()->session->__unset( 'PAYMENTS_CORE_HOOK_PREFIX_payment_return_url_redirect' );
		WC()->session->__unset( 'PAYMENTS_CORE_HOOK_PREFIX_order_id' );
		WC()->session->__unset( 'PAYMENTS_CORE_HOOK_PREFIX_transaction_attempt' );
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
		return ! empty( WC()->session ) ? WC()->session->get( 'PAYMENTS_CORE_HOOK_PREFIX_session_data_hash', '' ) : '';
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
			WC()->session->set( 'PAYMENTS_CORE_HOOK_PREFIX_session_data_hash', $hash ? $hash : $this->core_plugin()->payment_core()->utils()->unique_cart_hash() );
		}
	}


	/**
	 * Maybe handle return callback.
	 *
	 * @return void
	 */
	public function maybe_handle_return_callback() {
		if ( ! isset( $_GET['PAYMENTS_CORE_HOOK_PREFIX-callback'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}

		$callback = wc_clean( wp_unslash( $_GET['PAYMENTS_CORE_HOOK_PREFIX-callback'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		switch ( $callback ) {
			// Handle hosted checkout.
			case 'wc':
				$this->process_return_callback();
				break;
			// Handle 3DS redirect to processing url.
			case 'wc-3ds':
				$this->process_3ds_return_callback();
				break;
			// Actually handle 3DS authentication.
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
			if ( ! isset( $_REQUEST['nonce'] ) || ! wp_verify_nonce( wc_clean( wp_unslash( $_REQUEST['nonce'] ) ), 'PAYMENTS_CORE_HOOK_PREFIX_nonce' ) ) {
				throw new Exception( __( 'Nonce verification is missing or invalid.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			if ( ! isset( $_REQUEST['order-id'] ) || ! isset( $_REQUEST['resultIndicator'] ) ) {
				throw new Exception( __( 'Missing arguments.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			$order_id = (int) wc_clean( wp_unslash( $_REQUEST['order-id'] ) );

			if ( ! $order_id ) {
				throw new Exception( __( 'The order ID parameter is invalid.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			$order = wc_get_order( $order_id );

			if ( ! $order ) {
				throw new Exception( __( 'The order cannot be found.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			if ( $order->is_paid() ) {
				throw new Exception( __( 'The order has already been processed.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			$success_indicator = wc_clean( wp_unslash( $_REQUEST['resultIndicator'] ) );

			if ( ! $success_indicator || $order->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_success_indicator' ) !== $success_indicator ) {
				throw new Exception( __( 'The payment session is invalid.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
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
			/**
			 * Filter the redirect URL after 3DS return callback.
			 *
			 * @since 1.0.0
			 */
			apply_filters(
				'PAYMENTS_CORE_HOOK_PREFIX_3ds_return_redirect',
				add_query_arg(
					array(
						'PAYMENTS_CORE_HOOK_PREFIX-callback' => 'wc-3ds-process',
						'order-id'  => isset( $_REQUEST['order-id'] ) ? wc_clean( wp_unslash( $_REQUEST['order-id'] ) ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
						'signature' => isset( $_REQUEST['signature'] ) ? wc_clean( wp_unslash( $_REQUEST['signature'] ) ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
						'nonce'     => isset( $_REQUEST['nonce'] ) ? wc_clean( wp_unslash( $_REQUEST['nonce'] ) ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
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
			$order = null;

			if ( ! isset( $_REQUEST['nonce'] ) || ! wp_verify_nonce( wc_clean( wp_unslash( $_REQUEST['nonce'] ) ), 'PAYMENTS_CORE_HOOK_PREFIX_3ds_nonce' ) ) {
				throw new Exception( __( 'Nonce verification is missing or invalid.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			if ( ! empty( $_REQUEST['order-id'] ) ) {
				$order_id = (int) wc_clean( wp_unslash( $_REQUEST['order-id'] ) );

				if ( ! $order_id ) {
					throw new Exception( __( 'The order ID parameter is invalid.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
				}

				$order = wc_get_order( $order_id );

				if ( ! $order ) {
					throw new Exception( __( 'The order cannot be found.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
				}
			}

			$signature = isset( $_REQUEST['signature'] ) ? wc_clean( wp_unslash( $_REQUEST['signature'] ) ) : '';

			if ( ! $signature || ! hash_equals( $signature, $this->hashed_signature( $order, $this->get_authentication_transaction( $order ) ) ) ) {
				throw new Exception( __( 'There was an error validating the authentication request. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			$result = $this->process_payment_hosted_session( $order, true );

			if ( empty( $result['result'] ) || 'success' !== $result['result'] || empty( $result['redirect'] ) ) {
				throw new Exception( __( 'There was an error processing the payment. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			// TODO: Maybe do this via action instead?
			if ( wc_get_account_endpoint_url( 'payment-methods' ) === $result['redirect'] ) {
				wc_add_notice( __( 'Payment method successfully added.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			/**
			 * Filter the redirect URL after 3DS processing completes.
			 *
			 * @since 1.0.0
			 */
			wp_safe_redirect( apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_3ds_process_redirect', $result['redirect'], $order, $this ) );
			exit();
		} catch ( Exception $e ) {
			$redirect_url = $this->get_return_url( $order, false );

			$this->core_plugin->logger()->log( $e->getMessage(), 'error' );

			// Need this trick here in case of blocks, as those don't display notices the regular way.
			if ( WC()->session->get( 'PAYMENTS_CORE_HOOK_PREFIX_processing_via_api', false ) ) {
				WC()->session->__unset( 'PAYMENTS_CORE_HOOK_PREFIX_processing_via_api' );
				WC()->session->set( 'PAYMENTS_CORE_HOOK_PREFIX_payment_error_message', $e->getMessage() );
			} else {
				wc_add_notice( $e->getMessage(), 'error' );
			}

			// Do cleanups.
			if ( $this->enable_3ds ) {
				// Clean once more after saving the cards.
				$this->clean_cached_3ds_data( $order );
			}
			$this->maybe_clean_hosted_cached_session( $this->get_hosted_session_data_hash() );

			/**
			 * Fires when a payment processing error occurs.
			 *
			 * @since 1.0.0
			 */
			do_action( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_error', $e, ! empty( $order ) ? $order : null );

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

	/**
	 * AJAX handler to update hosted session from token.
	 *
	 * @return void
	 */
	public function ajax_update_hosted_session_from_token() {
		$session_id = wc_clean( wp_unslash( $_POST['PAYMENTS_CORE_HOOK_PREFIX_session_id'] ?? $this->hosted_session_id() ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$token_id   = wc_clean( wp_unslash( $_POST['PAYMENTS_CORE_HOOK_PREFIX_token_id'] ?? '' ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing

		$updated_session = $this->update_session_with_token( $session_id, $token_id, true );

		if ( empty( $updated_session ) ) {
			wp_send_json_error(
				array(
					'message' => __( 'There was an error updating the payment session. Please try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				)
			);
		}

		wp_send_json_success( $updated_session );
	}


	/**
	 * Authenticate payer.
	 *
	 * @return void
	 * @throws Exception Exception.
	 */
	public function ajax_authenticate_payer() {
		// The authentication is not required if 3DS is disabled.
		if ( ! $this->enable_3ds ) {
			wp_send_json_success();
		}

		try {
			$order = null;

			if ( ! isset( $_POST['order_id'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
				throw new Exception( __( 'Missing order ID.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			$order_id = wc_clean( wp_unslash( $_POST['order_id'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
			if ( 'add_payment_method' !== $order_id ) {
				$order_id = absint( $order_id );
				if ( ! $order_id ) {
					throw new Exception( __( 'There was an error obtaining the order. Please refresh the page and try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
				}

				$order = wc_get_order( $order_id );
				if ( ! $order ) {
					throw new Exception( __( 'There was an error obtaining the order. Please refresh the page and try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
				}
			} else {
				WC()->session->set( 'PAYMENTS_CORE_HOOK_PREFIX_payment_return_url_redirect', wc_get_account_endpoint_url( 'payment-methods' ) );
			}

			$session = $this->get_posted_session_data();
			if ( empty( $session ) ) {
				throw new Exception( __( 'There was an error obtaining the payment session. Please refresh the page and try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			$session_data = $this->retrieve_payment_session( $session['id'] );
			if ( empty( $session_data['sourceOfFunds'] ) ) {
				throw new Exception( __( 'There was an error validating the payment session. Please refresh the page and try again.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			$authentication_transaction_id = $this->get_3ds_authentication( $order, $session );

			if ( is_array( $authentication_transaction_id ) ) {

				$this->maybe_cache_location();

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
		/**
		 * Filter the save card notice text displayed to the customer.
		 *
		 * @since 1.0.0
		 */
		return apply_filters(
			'PAYMENTS_CORE_HOOK_PREFIX_save_card_notice',
			__( 'Your payment method will be saved for future purchases.', '__PAYMENTS_CORE_TEXT_DOMAIN__' )
		);
	}


	/**
	 * Relocalize cart total when cart is updated.
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
