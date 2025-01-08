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
	public $name;


	/**
	 * The payment method's assets folder.
	 *
	 * @var string
	 */
	protected $assets_folder = 'mpgs-cc';


	/**
	 * Returns the frontend accessible data.
	 *
	 * Can be accessed by calling
	 * const settings = wc.wcSettings.getSetting( '{paymentMethodName}_data' );
	 *
	 * @return array
	 */
	public function get_payment_method_data() {

		$data = parent::get_payment_method_data();

		if ( ! $this->should_render() ) {
			return $data;
		}

		$gateway = $this->mpgs_plugin->registered_gateway_instance( $this->gateway_id );
		if ( ! $gateway ) {
			return $data;
		}

		return $gateway->add_payment_method_data( $data );
	}
}
