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
use WC_Payment_Token_CC;

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
	protected $block_compat_class = 'WC_MPGS_Payment_Gateway_Block_Compat_CC';


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
	 * Debug enabled.
	 *
	 * @var bool
	 */
	protected $debug = false;


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
		$this->debug                = ! empty( $this->get_option( 'debug' ) && 'yes' === $this->get_option( 'debug' ) );

		// Load the gateway support features.
		$this->init_supports();

		// Add hooks.
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'validate_credentials' ) );
		add_action( 'woocommerce_receipt_' . $this->id, array( $this, 'payment_fields' ) );
		add_action( $this->prefix_hook( 'process_payment_error' ), array( $this, 'handle_failed_payment' ) );
		add_filter( 'woocommerce_get_customer_payment_tokens', array( $this, 'hide_saved_token_hosted_checkout' ), 10 );

		// Add plugin return callbacks.
		add_action( 'template_redirect', array( $this, 'maybe_handle_return_callback' ) );

		// Add API actions.
		add_action( 'woocommerce_api_' . $this->prefix_hook( 'wc-webhook' ), array( $this, 'process_notification_api_callback' ) );

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
		$merchant_id = isset( $_POST[ $this->prefix_hook( 'merchant_id', 'woocommerce_' ) ] ) ? wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'merchant_id', 'woocommerce_' ) ] ) ) : $this->get_option( 'merchant_id' ); // phpcs:ignore WordPress.Security.NonceVerification.Missing
		$password    = isset( $_POST[ $this->prefix_hook( 'password', 'woocommerce_' ) ] ) ? wc_clean( wp_unslash( $_POST[ $this->prefix_hook( 'password', 'woocommerce_' ) ] ) ) : $this->get_option( 'password' ); // phpcs:ignore WordPress.Security.NonceVerification.Missing

		if ( empty( $merchant_id ) || empty( $password ) ) {
			WC_Admin_Settings::add_error( __( 'Merchant ID and API Key are required.', $this->mpgs_plugin->text_domain() ) );
		}

		$this->mpgs_plugin->update_gateway_setting( 'merchant_id', $merchant_id );
		$this->mpgs_plugin->update_gateway_setting( 'password', $password );

		$response = $this->mpgs_api()->payment_options_inquiry();

		if ( ! $response['success'] || empty( $response['body'] ) ) {
			WC_Admin_Settings::add_error( __( 'Failed to validate API credentials. Please validate your credentials and save your account details again.', $this->mpgs_plugin->text_domain() ) );
			$this->mpgs_plugin->update_validated_credentials( false );
			$this->mpgs_plugin->update_payment_operations( array() );
			$this->init_form_fields();
			return;
		}

		$this->mpgs_plugin->logger()->log( __( 'API credentials validated successfully.', $this->mpgs_plugin->text_domain() ) );

		$this->mpgs_plugin->update_validated_credentials( true );

		$this->mpgs_plugin->update_payment_operations( $response['body']['supportedPaymentOperations'] ?? array() );

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

		if ( ! $this->mpgs_plugin->is_enabled() ) {
			return false;
		}

		if ( ! $this->mpgs_plugin->get_validated_credentials() ) {
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
		$prefix_test = $this->mpgs_plugin->is_sandbox() && ! ( defined( 'MGPS_MID_FORCE_TEST' ) && MGPS_MID_FORCE_TEST ) ? 'TEST' : '';
		return $prefix_test . $this->merchant_id;
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
			wc_print_notice( __( 'There was an error creating the payment session. Please review your data and try again or try a different payment method.', $this->mpgs_plugin->text_domain() ), 'error' );
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
		// Display the description.
		echo wp_kses_post( $this->description );

		$session_id = $this->hosted_session_id();

		if ( ! $session_id ) {
			wc_add_notice( __( 'There was an error creating the payment session. Please refresh the page and try again.', $this->mpgs_plugin->text_domain() ), 'error' );
			return;
		}

		$this->maybe_load_tokenization_scripts();

		wp_enqueue_script( 'wc-credit-card-form' );

		$display_tokenization = $this->display_saved_card_methods();

		if ( $display_tokenization ) {
			$this->saved_payment_methods();
		}

		$this->mpgs_plugin->mpgs_core()->template()->get(
			'payment-fields-hosted-session.php',
			array(
				'gateway'         => $this,
				'session_id'      => $session_id,
				'session_attempt' => uniqid( $session_id ),
			)
		);

		$display_save_checkbox = apply_filters( 'wc_' . $this->id . '_display_save_payment_method_checkbox', $display_tokenization );

		if ( $display_save_checkbox && ! is_add_payment_method_page() ) {
			$this->save_payment_method_checkbox();
		}
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

		try {
			$order = wc_get_order( $order_id );

			if ( ! $order ) {
				throw new Exception( __( 'Invalid order.', $this->mpgs_plugin->text_domain() ), 'error' );
			}

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
				return $this->process_payment_hosted_session( $order );
			}

			return array(
				'result'   => 'success',
				'redirect' => $order->get_checkout_payment_url(),
			);
		} catch ( Exception $e ) {
			$this->mpgs_plugin->logger()->log( $e->getMessage(), 'error' );
			wc_add_notice( $e->getMessage(), 'error' );

			do_action( $this->prefix_hook( 'process_payment_error' ), $e, ! empty( $order ) ? $order : null );

			return array(
				'result'   => 'failure',
				'redirect' => '',
				'messages' => array( $e->getMessage() ),
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
		$session = $processing_3ds_callback ? $order->get_meta( $this->prefix_hook( 'payment_session' ) ) : $this->get_posted_session_data();

		if ( empty( $session ) ) {
			throw new Exception( __( 'There was an error obtaining the payment session. Please refresh the page and try again.', $this->mpgs_plugin->text_domain() ) );
		}

		$session_data = $this->retrieve_payment_session( $session['id'] );

		if ( empty( $session_data['sourceOfFunds'] ) ) {
			throw new Exception( __( 'There was an error validating the payment session. Please refresh the page and try again.', $this->mpgs_plugin->text_domain() ) );
		}

		$transaction_id = $this->unique_transaction_id( $order );

		$payment_data = array(
			'apiOperation' => 'AUTHORIZE' === $this->transaction_mode ? 'AUTHORIZE' : 'PAY',
			'order'        => $this->hosted_session_order_payload( $order ),
			'session'      => $session,
			'transaction'  => array(
				'source' => 'INTERNET',
			),
		);

		$unique_order_id = $this->unique_order_id( $order );

		if ( $this->enable_3ds ) {
			$authentication_transaction_id = $this->get_3ds_authentication( $order, $session, $unique_order_id, $processing_3ds_callback );

			if ( is_array( $authentication_transaction_id ) ) {
				return $authentication_transaction_id;
			}

			$payment_data['authentication'] = array(
				'transactionId' => $authentication_transaction_id,
			);
		}

		$payment_data['transaction']['reference'] = $transaction_id;

		$response = $this->mpgs_api()->create_transaction( $unique_order_id, $transaction_id, $payment_data );

		if ( ! $response['success'] || empty( $response['body']['result'] ) || ! empty( $response['error'] ) ) {
			$error = __( 'There was an error processing the payment. Please try again.', $this->mpgs_plugin->text_domain() );
			throw new Exception( $error );
		}

		if ( 'SUCCESS' !== $response['body']['result'] ) {
			$error = __( 'There was an error processing the payment. Please try again.', $this->mpgs_plugin->text_domain() );
			if ( ! empty( $response['body']['response']['acquirerMessage'] ) ) {
				$error = $response['body']['response']['acquirerMessage'];
			} elseif ( ! empty( $response['body']['response']['gatewayCode'] ) ) {
				$error = $this->get_mapped_error_code( $response['body']['response']['gatewayCode'] );
			}
			throw new Exception( $error );
		}

		if ( empty( $response['body']['transaction'] ) || empty( $response['body']['transaction']['id'] ) ) {
			throw new Exception( __( 'There was an error obtaining the transaction.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( empty( $response['body']['order'] ) ) {
			throw new Exception( __( 'There was an error obtaining the order data.', $this->mpgs_plugin->text_domain() ) );
		}

		$this->process_wc_order( $order, $response['body']['order'], $response['body']['transaction'] );

		$this->maybe_save_cards( $order, $session );

		return array(
			'result'   => 'success',
			'redirect' => $this->get_return_url( $order ),
		);
	}


	/**
	 * Maybe save the cards.
	 *
	 * @param WC_Order $order   Order object.
	 * @param array    $session Session data.
	 */
	public function maybe_save_cards( $order, $session ) {
		if ( ! $this->saved_cards || ! $this->is_saving_payment_method() ) {
			return;
		}

		$this->payment_token()->process_saved_cards( $session['id'], $order->get_user_id( 'system' ) );
	}


	/**
	 * Get the 3DS authentication from the order.
	 *
	 * @param WC_Order $order                   Order object.
	 * @param array    $session                 Session data.
	 * @param string   $unique_order_id         Unique order ID.
	 * @param bool     $processing_3ds_callback Processing 3DS callback.
	 *
	 * @return string
	 */
	public function get_3ds_authentication( $order, $session, $unique_order_id, $processing_3ds_callback ) {
		if ( $processing_3ds_callback ) {
			$transaction_id = $order->get_meta( $this->prefix_hook( '3ds_transaction_id' ) );

			if ( empty( $transaction_id ) || ! $this->validate_authentication( $unique_order_id, $transaction_id ) ) {
				throw new Exception( __( 'There was an error with the payment authentication. Please try again.', $this->mpgs_plugin->text_domain() ) );
			}

			return $transaction_id;
		}

		$transaction_id = $this->unique_transaction_id( $order );

		$processed_3ds = $this->process_3ds_authentication( $order, $session, $unique_order_id, $transaction_id );

		if ( is_array( $processed_3ds ) ) {
			return $processed_3ds;
		}

		return $processed_3ds ? $transaction_id : '';
	}


	/**
	 * Process 3DS authentication.
	 *
	 * @param WC_Order $order          Order object.
	 * @param array    $session        Session data (ID and version).
	 * @param int      $order_id       Order ID.
	 * @param string   $transaction_id Transaction ID.
	 *
	 * @return bool
	 * @throws Exception Exception.
	 */
	protected function process_3ds_authentication( $order, $session, $order_id, $transaction_id ) {

		$init_authentication = array(
			'apiOperation'   => 'INITIATE_AUTHENTICATION',
			'authentication' => array(
				'channel' => 'PAYER_BROWSER',
			),
			'order'          => array(
				'currency' => $order->get_currency(),
			),
			'session'        => $session,
		);

		$response = $this->mpgs_api()->init_authentication( $order_id, $transaction_id, $init_authentication );

		if ( ! $this->validate_authentication_response( $response ) ) {
			return false;
		}

		$authenticate_payer = array(
			'apiOperation'   => 'AUTHENTICATE_PAYER',
			'authentication' => array(
				'redirectResponseUrl' => add_query_arg(
					array(
						$this->prefix_hook( 'callback', '', '-' ) => 'wc-3ds',
						'order-id'  => $order->get_id(),
						'signature' => $this->hashed_signature( $order, $transaction_id ),
						'nonce'     => wp_create_nonce( $this->prefix_hook( '3ds_nonce' ) ),
					),
					home_url( '/' )
				),
			),
			'device'         => $this->get_device_details(),
			'order'          => array(
				'amount'   => $order->get_total(),
				'currency' => $order->get_currency(),
			),
			'session'        => $session,
		);

		$authentication_response = $this->mpgs_api()->authenticate_payer( $order_id, $transaction_id, $authenticate_payer );

		return $this->process_authentication_response( $authentication_response, $order, $transaction_id, $session );
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
		return $this->validate_authentication_response( $this->mpgs_api()->retrieve_transaction( $order_id, $transaction_id ) );
	}


	/**
	 * Get browser device details for 3DS.
	 *
	 * @return array
	 * @throws Exception Exception.
	 */
	protected function get_device_details() {
		if ( ! isset( $_SERVER['HTTP_USER_AGENT'] ) || empty( $_POST[ $this->prefix_hook( '3ds_data' ) ] ) ) {
			throw new Exception( __( 'There was an error with the payment authentication.', $this->mpgs_plugin->text_domain() ) );
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
			throw new Exception( __( 'There was an error with the payment authentication.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( ! empty( $response['body']['authentication'] ) && ! is_array( $response['body']['authentication'] ) && 'NONE' === $response['body']['authentication'] ) {
			return false;
		}

		if ( ( ! empty( $response['body']['transaction']['authenticationStatus'] ) && 'AUTHENTICATION_NOT_SUPPORTED' === $response['body']['transaction']['authenticationStatus'] ) ) {
			return false;
		}

		if ( ! empty( $response['body']['response']['gatewayRecommendation'] ) && 'PROCEED' !== $response['body']['response']['gatewayRecommendation'] ) {

			if ( 'RESUBMIT_WITH_ALTERNATIVE_PAYMENT_DETAILS' === $response['body']['response']['gatewayRecommendation'] ) {
				throw new Exception( __( 'The payment method was declined. Please try again with a different payment method.', $this->mpgs_plugin->text_domain() ) );
			}

			throw new Exception( __( 'The payment method was declined.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( empty( $response['body']['result'] ) || 'SUCCESS' !== $response['body']['result'] ) {
			throw new Exception( __( 'There was an error with the payment authentication.', $this->mpgs_plugin->text_domain() ) );
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
			throw new Exception( __( 'There was an error with the payment authentication.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( empty( $response['body']['result'] ) || ! in_array( $response['body']['result'], array( 'SUCCESS', 'PENDING' ), true ) ) {
			throw new Exception( __( 'There was an error with the payment authentication.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( 'PROCEED' !== $response['body']['response']['gatewayRecommendation'] ) {

			if ( 'RESUBMIT_WITH_ALTERNATIVE_PAYMENT_DETAILS' === $response['body']['response']['gatewayRecommendation'] ) {
				throw new Exception( __( 'The payment method was declined. Please try again with a different payment method.', $this->mpgs_plugin->text_domain() ) );
			}

			throw new Exception( __( 'The payment method was declined.', $this->mpgs_plugin->text_domain() ) );
		}

		// Send the ACS form to the client.
		if ( ! empty( $response['body']['authentication']['redirect']['customizedHtml']['3ds2']['acsUrl'] ) || ! empty( $response['body']['authentication']['redirect']['customizedHtml']['3ds2']['cReq'] ) ) {

			$order->update_meta_data( $this->prefix_hook( 'payment_session' ), $session );
			$order->update_meta_data( $this->prefix_hook( '3ds_transaction_id' ), $transaction_id );
			$order->save();

			$this->maybe_save_cards( $order, $session );

			return array(
				'result'                         => 'success',
				'redirect'                       => '#',
				$this->prefix_hook( '3ds_url' )  => $response['body']['authentication']['redirect']['customizedHtml']['3ds2']['acsUrl'],
				$this->prefix_hook( '3ds_data' ) => $response['body']['authentication']['redirect']['customizedHtml']['3ds2']['cReq'],
			);
		}

		return true;
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
			$errors->add( 'invalid_session', __( 'There was an error obtaining the payment session. Please try again.', $this->mpgs_plugin->text_domain() ) );
		}

		// Validate the session.
		if ( ! $this->validate_payment_session_status( $session['id'], $session['version'] ) ) {
			$this->maybe_clean_hosted_cached_session();
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
	 * Is saved payment method used.
	 *
	 * @return bool
	 */
	public function is_saved_payment_method() {
		return isset( $_POST[ $this->payment_token_key() ] ) && 'new' !== wc_clean( $_POST[ $this->payment_token_key() ] );
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

		$response = $this->mpgs_api()->update_session( $session_id, $payload );

		if ( ! $response['success'] || empty( $response['body']['session']['id'] ) || empty( $response['body']['session']['version'] ) ) {
			$this->mpgs_plugin->logger()->log( __( 'There was an error updating the payment session. Please try again.', $this->mpgs_plugin->text_domain() ), 'error' );
			return array();
		}

		return array(
			'id'      => $session_id,
			'version' => $response['body']['session']['version'],
		);
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
				throw new Exception( __( 'No logged-in user found.', $this->mpgs_plugin->text_domain() ) );
			}

			$session = $this->get_posted_session_data();

			if ( empty( $session ) ) {
				throw new Exception( __( 'There was an error obtaining the payment details.', $this->mpgs_plugin->text_domain() ) );
			}

			$token_id = $this->payment_token()->process_saved_cards( $session['id'], get_current_user_id() );

			if ( ! $token_id ) {
				throw new Exception( __( 'There was an error saving the card.', $this->mpgs_plugin->text_domain() ) );
			}

			do_action( $this->prefix_hook( 'add_payment_method_success', 'wc_' ), $token_id, $this );

			return array(
				'result'   => 'success',
				'redirect' => wc_get_endpoint_url( 'payment-methods' ),
			);
		} catch ( Exception $e ) {
			$this->mpgs_plugin->logger()->log( $e->getMessage(), 'error' );
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
		$data['pluginPrefix'] = $this->mpgs_plugin->plugin_id();

		switch ( $this->checkout_mode ) {
			case 'hosted_checkout':
				$data['sessionId']          = $this->checkout_session_id();
				$data['hostedCheckoutMode'] = $this->hosted_checkout_mode;
				break;
			case 'hosted_session':
				$session_id             = $this->hosted_session_id();
				$data['sessionId']      = $session_id;
				$data['sessionAttempt'] = uniqid( $session_id );
				break;
		}

		return $data;
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

		if ( $this->saved_cards ) {
			$payload['interaction']['saveCardForCredentialOnFile'] = 'PAYER_INITIATED_PAYMENTS';
		}

		$payload = $this->maybe_add_customer_data( $payload, $order );

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
			$attempts   = WC()->session->get( $this->hosted_session_attempt_key() ) ?? 0;

			if ( $session_id && $this->is_session_valid( WC()->session->get( $this->hosted_session_duration_key() ) ) && $attempts < ( self::HOSTED_SESSION_ATTEMPT_LIMIT - 5 ) ) {
				WC()->session->set( $this->hosted_session_attempt_key(), $attempts + 1 );
				return $session_id;
			}
		}

		$response = $this->mpgs_api()->create_session(
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
			array_merge(
				$this->base_order_payload( $order )
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
			)
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
	 * @return void
	 */
	public function maybe_clean_hosted_cached_session() {
		if ( ! function_exists( 'WC' ) || ! WC()->cart || empty( WC()->session ) ) {
			return;
		}

		WC()->session->set( $this->hosted_session_id_key(), null );
		WC()->session->set( $this->hosted_session_attempt_key(), 0 );
		WC()->session->set( $this->hosted_session_duration_key(), null );
	}


	/**
	 * Get hosted session ID key.
	 *
	 * @return string
	 */
	protected function hosted_session_id_key() {
		return $this->mpgs_plugin()->mpgs_core()->utils()->hosted_session_id_key();
	}


	/**
	 * Get hosted session attempt key.
	 *
	 * @return string
	 */
	protected function hosted_session_attempt_key() {
		return $this->mpgs_plugin()->mpgs_core()->utils()->hosted_session_attempt_key();
	}


	/**
	 * Get hosted session duration key.
	 *
	 * @return string
	 */
	protected function hosted_session_duration_key() {
		return $this->mpgs_plugin()->mpgs_core()->utils()->hosted_session_duration_key();
	}


	/**
	 * Get hosted session data hash key.
	 *
	 * @return string
	 */
	protected function hosted_session_data_hash_key() {
		return $this->mpgs_plugin()->mpgs_core()->utils()->hosted_session_data_hash_key();
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
			case 'wc':
				$this->process_return_callback();
				break;
			case 'wc-3ds':
				$this->process_3ds_return_callback();
				break;
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
				throw new Exception( __( 'Nonce verification is missing or invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			if ( ! isset( $_REQUEST['order-id'] ) || ! isset( $_REQUEST['resultIndicator'] ) ) {
				throw new Exception( __( 'Missing arguments.', $this->mpgs_plugin->text_domain() ) );
			}

			$order_id = (int) wc_clean( wp_unslash( $_REQUEST['order-id'] ) );

			if ( ! $order_id ) {
				throw new Exception( __( 'The order ID parameter is invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			$order = wc_get_order( $order_id );

			if ( ! $order ) {
				throw new Exception( __( 'The order cannot be found.', $this->mpgs_plugin->text_domain() ) );
			}

			if ( $order->is_paid() ) {
				throw new Exception( __( 'The order has already been processed.', $this->mpgs_plugin->text_domain() ) );
			}

			$success_indicator = wc_clean( wp_unslash( $_REQUEST['resultIndicator'] ) );

			if ( ! $success_indicator || $order->get_meta( $this->prefix_hook( 'success_indicator' ) ) !== $success_indicator ) {
				throw new Exception( __( 'The payment session is invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			$order_data = $this->retrieve_order( $order );

			$this->validate_payment_status( $order, $order_data );

			$transaction = ! empty( $order_data['body']['transaction'] ) ? $this->get_approved_transaction( $order_data['body']['transaction'] ) : array();

			$this->process_wc_order( $order, $order_data['body'], $transaction );

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
	 * Redirect after the 3DS return callback.
	 *
	 * @return void
	 */
	private function process_3ds_return_callback() {
		wp_safe_redirect(
			add_query_arg(
				array(
					$this->prefix_hook( 'callback', '', '-' ) => 'wc-3ds-process',
					'order-id'  => wc_clean( wp_unslash( $_REQUEST['order-id'] ) ) ?? '',
					'signature' => wc_clean( wp_unslash( $_REQUEST['signature'] ) ) ?? '',
					'nonce'     => wc_clean( wp_unslash( $_REQUEST['nonce'] ) ) ?? '',
				),
				home_url( '/' )
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
				throw new Exception( __( 'Nonce verification is missing or invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			if ( ! isset( $_REQUEST['order-id'] ) ) {
				throw new Exception( __( 'Missing arguments.', $this->mpgs_plugin->text_domain() ) );
			}

			$order_id = (int) wc_clean( wp_unslash( $_REQUEST['order-id'] ) );

			if ( ! $order_id ) {
				throw new Exception( __( 'The order ID parameter is invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			$order = wc_get_order( $order_id );

			if ( ! $order ) {
				throw new Exception( __( 'The order cannot be found.', $this->mpgs_plugin->text_domain() ) );
			}

			if ( $order->is_paid() ) {
				throw new Exception( __( 'The order has already been processed.', $this->mpgs_plugin->text_domain() ) );
			}

			$signature = wc_clean( wp_unslash( $_REQUEST['signature'] ) ) ?? '';

			if ( ! $signature || ! hash_equals( $signature, $this->hashed_signature( $order, $order->get_meta( $this->prefix_hook( '3ds_transaction_id' ) ) ) ) ) {
				throw new Exception( __( 'There was an error validating the authentication request.', $this->mpgs_plugin->text_domain() ) );
			}

			$result = $this->process_payment_hosted_session( $order, true );

			if ( empty( $result['result'] ) || 'success' !== $result['result'] || empty( $result['redirect'] ) ) {
				throw new Exception( __( 'There was an error processing the payment.', $this->mpgs_plugin->text_domain() ) );
			}

			wp_safe_redirect( $result['redirect'] );
			exit();
		} catch ( Exception $e ) {
			$this->mpgs_plugin->logger()->log( $e->getMessage(), 'error' );

			wc_add_notice( $e->getMessage(), 'error' );

			$redirect_url = ( is_checkout_pay_page() && $order ) ? $order->get_checkout_payment_url() : wc_get_checkout_url();
			wp_safe_redirect( $redirect_url );

			exit();
		}
	}


	/**
	 * Process the return callback.
	 *
	 * @return void
	 * @throws Exception Exception.
	 */
	public function process_notification_api_callback() {
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

		$response = $this->mpgs_api()->retrieve_session( $session_id );

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
		if ( $this->display_saved_card_methods() ) {
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
}
