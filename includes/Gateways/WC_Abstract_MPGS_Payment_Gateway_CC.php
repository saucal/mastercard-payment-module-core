<?php
/**
 * Abstract CC Payment Gateway class.
 *
 * @class       AbstractPaymentGateway
 * @version     1.0.0
 * @package     MPGSCore/Gateways/
 */

namespace MPGSCore\Gateways;

use MPGSCore\Admin\GatewaySettings;
use MPGSCore\Logger;
use MPGSCore\Main;
use MPGSCore\MpgsAPI;
use MPGSCore\MpgsPlugin;
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
	 * MPGS Core instance prefix.
	 */
	abstract public function mpgs_core_prefix();


	/**
	 * Constructor.
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
		$this->form_fields = GatewaySettings::get_settings( $this->id );
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
			WC_Admin_Settings::add_error( __( 'Merchant ID and API Key are required.', MpgsPlugin::text_domain() ) );
		}

		$response = MpgsAPI::payment_options_inquiry();

		if ( ! $response['success'] || empty( $response['body'] ) ) {
			WC_Admin_Settings::add_error( __( 'Failed to validate API credentials. Please validate your credentials and save your account details again.', MpgsPlugin::text_domain() ) );
			MpgsPlugin::update_validated_credentials( false );
			MpgsPlugin::update_payment_operations( array() );
			return;
		}

		Logger::log( __( 'API credentials validated successfully.', MpgsPlugin::text_domain() ) );

		MpgsPlugin::update_validated_credentials( true );

		MpgsPlugin::update_payment_operations( $response['body']['supportedPaymentOperations'] ?? array() );
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

		if ( ! MpgsPlugin::is_enabled() ) {
			return false;
		}

		if ( ! MpgsPlugin::get_validated_credentials() ) {
			return false;
		}

		return true;
	}


	/**
	 * Get checkout mode.
	 *
	 * @return string
	 */
	public function get_checkout_mode() {
		$chosen_method = $this->get_option( 'checkout_mode' );

		if ( ! in_array( $chosen_method, array_keys( GatewaySettings::checkout_modes() ), true ) ) {
			$chosen_method = 'hosted_session';
		}

		return $chosen_method;
	}


	/**
	 * Payment fields.
	 *
	 * @return void
	 */
	public function payment_fields() {
		switch ( $this->get_checkout_mode() ) {
			case 'hosted_checkout':
				MpgsPlugin::mpgs_core()->template()->get( 'payment-fields-hosted-checkout.php' );
				break;
			case 'hosted_session':
				MpgsPlugin::mpgs_core()->template()->get( 'payment-fields-hosted-session.php' );
				break;
		}
	}
}
