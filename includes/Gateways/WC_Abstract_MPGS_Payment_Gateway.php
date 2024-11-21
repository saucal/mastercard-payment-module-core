<?php
/**
 * Abstract Payment Gateway class.
 *
 * @class       AbstractPaymentGateway
 * @version     1.0.0
 * @package     MPGSCore/Gateways/
 */

namespace MPGSCore\Gateways;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

use MPGSCore\MpgsPlugin;
use WC_Payment_Gateway_CC;

/**
 * Show the payment form for Mastercard Payment Gateway.
 */
class WC_Abstract_MPGS_Payment_Gateway extends WC_Payment_Gateway_CC {


	/**
	 * Plugin instance.
	 *
	 * @var MpgsPlugin
	 */
	protected $mpgs_plugin;


	/**
	 * Is gateway enabled.
	 *
	 * @var bool
	 */
	public function is_enabled() {
		return 'yes' === $this->get_option( 'enabled' );
	}
}
