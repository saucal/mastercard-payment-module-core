<?php
/**
 * Abstract CC Payment Gateway class.
 *
 * @class       AbstractPaymentGateway
 * @version     1.0.0
 * @package     MPGSCore/Gateways/
 */

namespace MPGSCore\Gateways;

use WC_Admin_Settings;
use WC_Order;
use Exception;
use WP_Error;
use MPGSCore\Utils;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Show the payment form for Mastercard Payment Gateway.
 */
abstract class WC_Abstract_MPGS_Payment_Gateway_CC extends WC_Abstract_MPGS_Payment_Gateway {


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
	 * Merchant ID.
	 *
	 * @var string
	 */
	protected $merchant_id;


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
	 * Debug enabled.
	 *
	 * @var bool
	 */
	protected $debug = false;


	/**
	 * Initialize the gateway.
	 */
	public function build() {

		// Load the gateway support features.
		$this->init_supports();

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
		$this->saved_cards          = ! empty( $this->get_option( 'saved_cards' ) && 'yes' === $this->get_option( 'saved_cards' ) );
		$this->debug                = ! empty( $this->get_option( 'debug' ) && 'yes' === $this->get_option( 'debug' ) );

		// Add hooks.
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'validate_credentials' ) );
		add_action( 'woocommerce_receipt_' . $this->id, array( $this, 'payment_fields' ) );
		add_action( 'woocommerce_api_' . $this->prefix_hook( 'wc' ), array( $this, 'process_return_callback' ) );
		add_action( 'woocommerce_api_' . $this->prefix_hook( 'wc-webhook' ), array( $this, 'process_notification_callback' ) );

		add_filter( $this->prefix_hook( 'enqueue_scripts' ), array( $this, 'enqueue_scripts' ), 20 );
		add_filter( 'script_loader_tag', array( $this, 'maybe_add_callbacks_attr' ), 10, 3 );
	}


	/**
	 * Initialize gateway support features.
	 *
	 * @return void
	 */
	public function init_supports() {

		$supports = array(
			'products',
			'refunds',
		);

		if ( $this->saved_cards ) {
			$supports[] = 'tokenization';
		}

		$this->supports = $supports;
	}


	/**
	 * Initialize form fields.
	 *
	 * @return void
	 */
	public function init_form_fields() {
		$this->form_fields = $this->mpgs_plugin->gateway_settings()->get_settings();
	}


	/**
	 * Validate API keys.
	 *
	 * @return void
	 */
	public function validate_credentials() {
		$merchant_id = $this->get_option( 'merchant_id' );
		$password    = $this->get_option( 'password' );

		if ( empty( $merchant_id ) || empty( $password ) ) {
			WC_Admin_Settings::add_error( __( 'Merchant ID and API Key are required.', $this->mpgs_plugin->text_domain() ) );
		}

		$response = $this->mpgs_api()->payment_options_inquiry();

		if ( ! $response['success'] || empty( $response['body'] ) ) {
			WC_Admin_Settings::add_error( __( 'Failed to validate API credentials. Please validate your credentials and save your account details again.', $this->mpgs_plugin->text_domain() ) );
			$this->mpgs_plugin->update_validated_credentials( false );
			$this->mpgs_plugin->update_payment_operations( array() );
			return;
		}

		$this->mpgs_plugin->logger()->log( __( 'API credentials validated successfully.', $this->mpgs_plugin->text_domain() ) );

		$this->mpgs_plugin->update_validated_credentials( true );

		$this->mpgs_plugin->update_payment_operations( $response['body']['supportedPaymentOperations'] ?? array() );
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

		if ( ! $this->mpgs_plugin->is_enabled() ) {
			return false;
		}

		if ( ! $this->mpgs_plugin->get_validated_credentials() ) {
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
		return $this->mpgs_plugin->get_checkout_mode();
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
	 * Payment fields.
	 *
	 * @return void
	 */
	public function payment_fields() {
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
			wc_add_notice( __( 'There was an error creating the payment session. Please review your data and try again or try a different payment method.', $this->mpgs_plugin->text_domain() ), 'error' );
			echo wp_kses_post( $this->description );
			return;
		}

		$this->mpgs_plugin->mpgs_core()->template()->get(
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

		wp_enqueue_script( 'wc-credit-card-form' );

		// Display the description.
		echo wp_kses_post( $this->description );

		$session_id = $this->hosted_session_id();

		if ( ! $session_id ) {
			wc_add_notice( __( 'There was an error creating the payment session. Please refresh the page and try again.', $this->mpgs_plugin->text_domain() ), 'error' );
			return;
		}

		$this->mpgs_plugin->mpgs_core()->template()->get(
			'payment-fields-hosted-session.php',
			array(
				'gateway'         => $this,
				'session_id'      => $session_id,
				'session_attempt' => uniqid( $session_id ),
			)
		);
	}


	/**
	 * Process Payment.
	 * First of all and most important is to process the payment.
	 * Second if needed, save payment token card.
	 *
	 * @param int         $order_id         Order ID.
	 * @param string      $transaction_type Transaction type.
	 * @param null|string $override_total   Override total.
	 * @param bool        $payment_complete Payment complete.
	 *
	 * @return array
	 *
	 * @throws Exception Exception.
	 */
	public function process_payment( $order_id, $transaction_type = null, $override_total = null, $payment_complete = true ) {

		$order = wc_get_order( $order_id );

		if ( ! $order ) {
			return array(
				'result'   => 'error',
				'redirect' => '',
			);
		}

		try {
			if ( 'hosted_checkout' === $this->checkout_mode ) {
				$order->update_status( 'pending', __( 'Pending payment', $this->mpgs_plugin->text_domain() ) );

				if ( 'redirect' === $this->hosted_checkout_mode ) {

					$session_id = $this->checkout_session_id( $order );

					return array(
						'result'    => 'success',
						'pluginId'  => $this->id,
						'sessionId' => $session_id,
						'redirect'  => '#',
					);
				}
			}

			return array(
				'result'   => 'success',
				'redirect' => $order->get_checkout_payment_url( true ),
			);
		} catch ( Exception $e ) {
			$this->mpgs_plugin->logger()->log( $e->getMessage(), 'error' );
			wc_add_notice( $e->getMessage(), 'error' );

			do_action( $this->prefix_hook( 'process_payment_error' ), $e, $order );

			return array(
				'result'   => 'fail',
				'redirect' => '',
			);
		}

		// It is a success anyways, since the order at this point is completed.
		return array(
			'result'   => 'success',
			'redirect' => $this->get_return_url( $order ),
		);
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

		$errors = new WP_Error();

		// Validate the session values.
		if ( empty( $_POST[ $this->prefix_hook( 'session_id' ) ] ) || empty( $_POST[ $this->prefix_hook( 'session_version' ) ] ) ) {
			$errors->add( 'invalid_session', __( 'There was an error obtaining the Payment Session. Please try again.', $this->mpgs_plugin->text_domain() ) );
		}

		$session_id      = wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'session_id' ) ] ) );
		$session_version = wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'session_version' ) ] ) );

		// Validate the session.
		if ( ! $this->validate_payment_session_status( $session_id, $session_version ) ) {
			$errors->add( 'invalid_session', __( 'The Payment Session is invalid or has expired. Please try again.', $this->mpgs_plugin->text_domain() ) );
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
					$this->mpgs_plugin->mpgs_core()->get_prefix(),
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
		return untrailingslashit( $this->mpgs_plugin->gateway_url() ) . '/static/checkout/checkout.min.js';
	}


	/**
	 * Get the hosted session URL.
	 *
	 * @return string
	 */
	public function hosted_session_url() {
		return sprintf(
			'%1$s/form/version/%2$s/merchant/%3$s/session.js',
			untrailingslashit( $this->mpgs_plugin->gateway_url() ),
			72,
			$this->get_option( 'merchant_id' )
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

		$this->maybe_flag_order_as_paid( $order );

		$order_id = $order->get_id();

		$session_key          = $this->prefix_hook( 'session_id_' . $order_id );
		$session_duration_key = $this->prefix_hook( 'session_duration_' . $order_id );

		if ( ! empty( WC()->session ) ) {
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

		if ( $this->is_hosted_checkout() && 'yes' === $this->mpgs_plugin->get_gateway_setting( 'display_logo' ) && ! empty( $this->icon ) ) {
			$payload['interaction']['merchant']['logo'] = str_replace( 'http:', 'https:', $this->icon );
		}

		$formatted_billing_info = Utils::get_formatted_info_billing( $order );
		if ( ! empty( $formatted_billing_info ) ) {
			$payload['billing'] = $formatted_billing_info;
		}

		$formatted_shipping_info = Utils::get_formatted_info_shipping( $order );
		if ( ! empty( $formatted_shipping_info ) ) {
			$payload['shipping'] = $formatted_shipping_info;
		}

		$formatted_customer_info = Utils::get_formatted_info_customer( $order );
		if ( ! $this->mpgs_plugin->is_sandbox() && ! empty( $formatted_customer_info ) ) {
			$payload['customer'] = $formatted_customer_info;
		}

		$response = $this->mpgs_api()->create_session( $payload );

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

		if ( ! empty( WC()->session ) ) {
			$session_id = WC()->session->get( $this->hosted_session_id_key() );

			if ( $session_id && $this->is_session_valid( WC()->session->get( $this->hosted_session_duration_key() ) ) ) {
				return $session_id;
			}
		}

		$response = $this->mpgs_api()->create_session();

		if ( ! $response['success'] || empty( $response['body']['session']['id'] ) ) {
			return '';
		}

		$session_id = $response['body']['session']['id'];

		if ( ! empty( WC()->session ) ) {
			WC()->session->set( $this->hosted_session_id_key(), $session_id );
			WC()->session->set( $this->hosted_session_duration_key(), time() + 3 * MINUTE_IN_SECONDS );
		}

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
			array(
				'id'              => $this->unique_order_id( $order ),
				'reference'       => $order->get_id(),
				'currency'        => get_woocommerce_currency(),
				'amount'          => $order->get_total(),
				'description'     => $this->mpgs_plugin->get_gateway_setting( 'merchant_name' ),
				'notificationUrl' => add_query_arg(
					array(
						'wc-api'   => $this->prefix_hook( 'wc-webhook' ),
						'order-id' => $order->get_id(),
						'nonce'    => wp_create_nonce( $this->prefix_hook( 'webhook-nonce' ) ),
					),
					trailingslashit( get_home_url() )
				),
			)
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
						'wc-api'   => $this->prefix_hook( 'wc' ),
						'order-id' => $order->get_id(),
						'nonce'    => wp_create_nonce( $this->prefix_hook( 'nonce' ) ),
					),
					trailingslashit( get_home_url() )
				),
				'cancelUrl'      => $order->get_checkout_payment_url(),
				'timeoutUrl'     => $order->get_checkout_payment_url(),
				'merchant'       => array(
					'name' => $this->mpgs_plugin->get_gateway_setting( 'merchant_name' ),
				),
				'displayControl' => array(
					'customerEmail'  => 'HIDE',
					'billingAddress' => 'HIDE',
					'shipping'       => 'HIDE',
				),
			)
		);
	}

	/**
	 * Get the unique order ID.
	 *
	 * @param WC_Order $order Order.
	 *
	 * @return string
	 */
	protected function unique_order_id( $order ) {
		return $order->get_id() . '-' . $order->get_cart_hash();
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
	 * @return void
	 */
	public function maybe_clean_hosted_cached_session() {
		if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
			return;
		}

		if ( ! $this->is_hosted_session() || empty( WC()->session ) ) {
			return;
		}

		WC()->session->set( $this->hosted_session_id_key(), null );
		WC()->session->set( $this->hosted_session_duration_key(), null );
	}


	/**
	 * Get hosted session ID key.
	 *
	 * @return string
	 */
	protected function hosted_session_id_key() {
		return $this->prefix_hook( 'session_id_' . WC()->cart->get_cart_hash() );
	}


	/**
	 * Get hosted session duration key.
	 *
	 * @return string
	 */
	protected function hosted_session_duration_key() {
		return $this->prefix_hook( 'session_duration_' . WC()->cart->get_cart_hash() );
	}


	/**
	 * Get hosted session data hash key.
	 *
	 * @return string
	 */
	protected function hosted_session_data_hash_key() {
		return $this->prefix_hook( 'session_data_hash_' . WC()->cart->get_cart_hash() );
	}


	/**
	 * Get hosted session data hash.
	 *
	 * @return string
	 */
	protected function get_hosted_session_data_hash() {
		return ! empty( WC()->session ) ? WC()->session->get( $this->hosted_session_data_hash_key(), '' ) : '';
	}


	/**
	 * Set hosted session data hash.
	 *
	 * @param string $hash Hash.
	 *
	 * @return void
	 */
	protected function set_hosted_session_data_hash( $hash ) {
		if ( ! empty( WC()->session ) ) {
			WC()->session->set( $this->hosted_session_data_hash_key(), $hash );
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
			if ( ! isset( $_REQUEST['nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_REQUEST['nonce'] ) ), $this->prefix_hook( 'nonce' ) ) ) {
				throw new Exception( __( 'Nonce verification is missing or invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			if ( ! isset( $_REQUEST['order-id'] ) || ! isset( $_REQUEST['resultIndicator'] ) ) {
				throw new Exception( __( 'Missing arguments.', $this->mpgs_plugin->text_domain() ) );
			}

			$order_id = (int) sanitize_text_field( wp_unslash( $_REQUEST['order-id'] ) );

			if ( ! $order_id ) {
				throw new Exception( __( 'The order ID parameter is invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			$order = wc_get_order( $order_id );

			if ( ! $order ) {
				throw new Exception( __( 'The order cannot be found.', $this->mpgs_plugin->text_domain() ) );
			}

			if ( $order->get_status() === 'completed' ) {
				throw new Exception( __( 'The order has already been processed.', $this->mpgs_plugin->text_domain() ) );
			}

			$success_indicator = sanitize_text_field( wp_unslash( $_REQUEST['resultIndicator'] ) );

			if ( ! $success_indicator || $order->get_meta( $this->prefix_hook( 'success_indicator' ) ) !== $success_indicator ) {
				throw new Exception( __( 'The payment session is invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			$order_data = $this->mpgs_api()->retrieve_order( $this->unique_order_id( $order ) );

			$this->validate_payment_status( $order, $order_data );

			$this->process_wc_order( $order, $order_data );

			wp_safe_redirect( $this->get_return_url( $order ) );
			exit();
		} catch ( Exception $e ) {
			$this->mpgs_plugin->logger()->log( $e->getMessage(), 'error' );
			wc_add_notice( $e->getMessage(), 'error' );
			wp_safe_redirect( wc_get_checkout_url() );
			exit();
		}
	}


	/**
	 * Validate if the order was paid agains the API.
	 *
	 * @param WC_Order $order      Order object.
	 * @param array    $order_data Order data.
	 *
	 * @return void
	 * @throws Exception Exception.
	 */
	protected function validate_payment_status( $order, $order_data = array() ) {

		if ( ! $order || ! is_a( $order, 'WC_Order' ) ) {
			throw new Exception( __( 'The order object is not valid.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( empty( $order_data ) ) {
			$order_data = $this->mpgs_api()->retrieve_order( $this->unique_order_id( $order ) );
		}

		if ( ! $order_data['success'] || empty( $order_data['body']['result'] ) ) {
			throw new Exception( __( 'Failed to retrieve the order.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( 'SUCCESS' !== $order_data['body']['result'] ) {
			throw new Exception( 'Payment was declined.', $this->mpgs_plugin->text_domain() );
		}
	}


	/**
	 * Maybe flag the order as paid.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return void
	 */
	protected function maybe_flag_order_as_paid( $order ) {
		try {
			if ( ! $order->needs_payment() ) {
				return;
			}

			$order_data = $this->mpgs_api()->retrieve_order( $this->unique_order_id( $order ) );

			$this->validate_payment_status( $order, $order_data );

			$this->process_wc_order( $order, $order_data );

			if ( $order->needs_payment() ) {
				return;
			}

			wp_safe_redirect( $this->get_return_url( $order ) );
			exit();
		} catch ( Exception $e ) {
			return;
		}
	}


	/**
	 * This function processes a WooCommerce order.
	 *
	 * @param object $order      The WooCommerce order object.
	 * @param array  $order_data Order data retrieved from the API.
	 *
	 * @return void
	 *
	 * @throws Exception Exception.
	 */
	protected function process_wc_order( $order, $order_data ) {

		if ( ! $order || ! is_a( $order, 'WC_Order' ) ) {
			throw new Exception( __( 'The order object is not valid.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( ! isset( $order_data['body']['status'] ) || ! isset( $order_data['body']['id'] ) ) {
			throw new Exception( __( 'The order data is not valid.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( empty( $order_data['body']['transaction'] ) || ! is_array( $order_data['body']['transaction'] ) ) {
			throw new Exception( __( 'The transaction data is not valid.', $this->mpgs_plugin->text_domain() ) );
		}

		$is_captured = 'CAPTURED' === $order_data['body']['status'];
		$order->add_meta_data( $this->prefix_hook( 'order_captured' ), $is_captured );
		$order->add_meta_data( $this->prefix_hook( 'transaction_id' ), $order_data['body']['id'] );

		if ( $is_captured ) {
			$order->payment_complete( $order_data['body']['id'] );

			$order->add_order_note(
				sprintf(
					// translators: %1$s: Gateway title, %2$s: Transaction ID.
					__( '%1$s payment was Captured (ID: %2$s)', $this->mpgs_plugin->text_domain() ),
					$this->title,
					$order_data['body']['id'],
				)
			);
		} else {
			$order->add_order_note(
				sprintf(
					// translators: %1$s: Gateway title, %2$s: Transaction ID.
					__( '%1$s payment was Authorized (ID: %2$s)', $this->mpgs_plugin->text_domain() ),
					$this->title,
					$order_data['body']['id'],
				)
			);
			$order->update_status( 'on-hold', __( 'Payment authorized, waiting for capture.', $this->mpgs_plugin->text_domain() ) );
		}
	}


	/**
	 * Process the return callback.
	 *
	 * @return void
	 * @throws Exception Exception.
	 */
	public function process_notification_callback() {
		// TODO: Implement process notification.
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
		$response = $this->mpgs_api()->retrieve_session( $session_id );

		if ( ! $response['success'] || empty( $response['body']['session']['id'] ) ) {
			return false;
		}

		if ( empty( $response['body']['session']['updateStatus'] ) || 'SUCCESS' !== $response['body']['session']['updateStatus'] ) {
			return false;
		}

		if ( empty( $response['body']['session']['version'] ) || $response['body']['session']['version'] !== $session_version ) {
			return false;
		}

		return true;
	}
}
