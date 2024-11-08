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
	 * Initialize Payment Gateway
	 */
	public function init() {
		$this->init_form_fields();
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
