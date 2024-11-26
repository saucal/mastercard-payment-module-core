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

use MPGSCore\MpgsAPI;
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
	 * MPGS API instance.
	 *
	 * @var MpgsAPI
	 */
	protected $mpgs_api;


	/**
	 * Is gateway enabled.
	 *
	 * @var bool
	 */
	public function is_enabled() {
		return 'yes' === $this->get_option( 'enabled' );
	}


	/**
	 * Is gateway available.
	 *
	 * @return bool
	 */
	public function is_available() {
		if ( ! parent::is_available() ) {
			return false;
		}

		if ( empty( $this->mpgs_plugin ) ) {
			return false;
		}

		if ( empty( $this->mpgs_api() ) ) {
			return false;
		}

		return true;
	}


	/**
	 * Get the MPGS Plugin instance.
	 *
	 * @return MpgsPlugin
	 */
	public function mpgs_plugin() {
		return $this->mpgs_plugin;
	}


	/**
	 * Get the MPGS API instance.
	 *
	 * @return MpgsAPI
	 */
	public function mpgs_api() {
		if ( ! $this->mpgs_api ) {
			$this->mpgs_api = new MpgsAPI( $this->mpgs_plugin );
		}

		return $this->mpgs_api;
	}
}
