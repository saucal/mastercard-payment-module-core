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
use MPGSCore\Main;

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
	 * Initialize Payment Gateway.
	 */
	abstract public function build();


	/**
	 * Init hooks.
	 */
	abstract public function init();


	/**
	 * Constructor.
	 */
	public function __construct() {
		// Load gateway settings.
		$this->build();

		// Load the gateway support features.
		$this->init_supports();

		// Load the form fields.
		$this->init_form_fields();

		// Load the settings.
		$this->init_settings();

		// Load common settings.
		$this->saved_cards = ! empty( $this->get_option( 'saved_cards' ) && 'yes' === $this->get_option( 'saved_cards' ) );
		$this->debug       = ! empty( $this->get_option( 'debug' ) && 'yes' === $this->get_option( 'debug' ) );

		// Init debug mode.
		$this->init_debug();

		$this->init();

		// Add hooks.
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
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
	 * Init debug mode.
	 *
	 * @return void
	 */
	public function init_debug() {
		if ( ! $this->is_debug() ) {
			return;
		}

		$this->logger()->set_debug( true );
	}


	/**
	 * Get the logger instance.
	 *
	 * @return Logger
	 */
	public function logger() {
		return Main::instance( $this->mpgs_core_prefix() )->logger();
	}


	/**
	 * Log message.
	 *
	 * @param string $message Log message.
	 * @param string $level   Log level.
	 */
	public function log( $message, $level = 'debug' ) {
		$this->logger()->log( $message, $level, $this->id . '-gateway' );
	}


	/**
	 * Is debug enabled.
	 *
	 * @return bool
	 */
	public function is_debug() {
		return $this->debug;
	}
}
