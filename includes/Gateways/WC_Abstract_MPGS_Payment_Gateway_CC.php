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

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Show the payment form for Mastercard Payment Gateway.
 */
class WC_Abstract_MPGS_Payment_Gateway_CC extends WC_Abstract_MPGS_Payment_Gateway {


	/**
	 * Saved cards enabled.
	 *
	 * @var bool
	 */
	protected $saved_cards = false;


	/**
	 * Initialize Payment Gateway
	 */
	public function init() {

		$this->enabled = $this->get_option( 'enabled' );

		$this->saved_cards = ! empty( $this->get_option( 'saved_cards' ) && 'yes' === $this->get_option( 'saved_cards' ) );

		// Load form fields.
		$this->init_form_fields();
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
}
