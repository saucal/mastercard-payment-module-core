<?php
/**
 * Abstract CC Payment Gateway class.
 *
 * @class       AbstractPaymentGateway
 * @version     1.0.0
 * @package     MPGSCore/Gateways/
 */

namespace MPGSCore\Gateways;

use MPGSCore\Logger;
use MPGSCore\MpgsAPI;
use WC_Admin_Settings;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Show the payment form for Mastercard Payment Gateway.
 */
abstract class WC_Abstract_MPGS_Payment_Gateway_CC extends WC_Abstract_MPGS_Payment_Gateway {


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
		$this->title       = $this->get_option( 'title' );
		$this->enabled     = $this->get_option( 'enabled' );
		$this->description = $this->get_option( 'description' );
		$this->saved_cards = ! empty( $this->get_option( 'saved_cards' ) && 'yes' === $this->get_option( 'saved_cards' ) );
		$this->debug       = ! empty( $this->get_option( 'debug' ) && 'yes' === $this->get_option( 'debug' ) );

		// Add hooks.
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'validate_credentials' ) );

		add_filter( $this->mpgs_plugin->mpgs_core()->prefix_hook( 'enqueue_scripts' ), array( $this, 'enqueue_scripts' ), 20 );
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
	 * Payment fields.
	 *
	 * @return void
	 */
	public function payment_fields() {
		switch ( $this->checkout_mode() ) {
			case 'hosted_checkout':
				$this->mpgs_plugin->mpgs_core()->template()->get(
					'payment-fields-hosted-checkout.php',
					array(
						'gateway' => $this,
					)
				);
				break;
			case 'hosted_session':
				$this->mpgs_plugin->mpgs_core()->template()->get(
					'payment-fields-hosted-session.php',
					array(
						'gateway' => $this,
					)
				);
				break;
		}
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

		if ( 'hosted_checkout' === $this->checkout_mode() ) {
			$scripts['mpgs_hosted_checkout'] = array(
				'src' => $this->hosted_checkout_url(),
			);

			$gateway_script = $this->mpgs_plugin->mpgs_core()->prefix_hook( 'gateway' );

			if ( isset( $scripts[ $gateway_script ] ) ) {
				$scripts[ $gateway_script ]['deps'] = array_merge(
					array( 'mpgs_hosted_checkout' ),
					$scripts[ $gateway_script ]['deps'] ?? array()
				);
			}
		}

		return $scripts;
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
	 * Initiate checkout session.
	 *
	 * @return string Session ID.
	 */
	public function session_id() {
		// Bail if the cart is not defined.
		if ( ! function_exists( 'WC' ) || empty( WC()->cart ) ) {
			return '';
		}

		$session_key = $this->mpgs_plugin->mpgs_core()->prefix_hook( WC()->cart->get_cart_hash(), 'session_id_' );

		if ( ! empty( WC()->session ) ) {
			$session_id = WC()->session->get( $session_key );

			if ( ! empty( $session_id ) ) {
				return $session_id;
			}
		}

		$order_payload = apply_filters(
			$this->mpgs_plugin->mpgs_core()->prefix_hook( 'checkout_session_payload' ),
			array(
				'currency' => get_woocommerce_currency(),
				'amount'   => WC()->cart->total,
				'id'       => WC()->cart->get_cart_hash(),
			)
		);

		if ( empty( $order_payload['currency'] ) || empty( $order_payload['amount'] ) || empty( $order_payload['id'] ) ) {
			return '';
		}

		$payload = array(
			'apiOperation' => 'INITIATE_CHECKOUT',
			'interaction'  => array(
				'operation' => 'AUTHORIZE',
				'merchant'  => array(
					'name' => $this->mpgs_plugin->get_gateway_setting( 'merchant_name' ),
				),
			),
			'order'        => $order_payload,
		);

		$response = $this->mpgs_api()->create_session( $payload );

		if ( ! $response['success'] || empty( $response['body']['session']['id'] ) ) {
			return '';
		}

		$session_id = $response['body']['session']['id'];

		if ( ! empty( WC()->session ) ) {
			WC()->session->set( $session_key, $session_id );
		}

		return $session_id;
	}
}
