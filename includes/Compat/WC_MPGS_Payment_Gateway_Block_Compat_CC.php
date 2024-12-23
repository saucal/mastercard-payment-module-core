<?php
/**
 * Abstract Woo Blocks Compatibility Class.
 *
 * @class       AbstractPaymentGateway
 * @version     1.0.0
 * @package     MPGSCore/Compat/
 */

namespace MPGSCore\Compat;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Adds support for the MPGS CC Gateway in the checkout Block of WooCommerce Blocks.
 */
class WC_MPGS_Payment_Gateway_Block_Compat_CC extends Abstract_Block_Compat {

	/**
	 * The payment method's name.
	 *
	 * @var string
	 */
	public $name = 'WC_Abstract_MPGS_Payment_Gateway_CC';
}
