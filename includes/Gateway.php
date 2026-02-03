<?php
/**
 * Handle payment gateway actions.
 *
 * @class       Gateway
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore;

use GatewayPaymentCore\Gateways\WC_Abstract_Payment_Gateway;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Gateway class
 */
final class Gateway {


	/**
	 * Registered payment gateways.
	 *
	 * @var array
	 */
	private static $gateways;

	/**
	 * Initialize hooks.
	 *
	 * @return void
	 */
	public static function init() {
		// Add payment gateway.
		add_filter( 'woocommerce_payment_gateways', array( __CLASS__, 'add_gateways' ) );
	}


	/**
	 * Get registered payment gateways.
	 *
	 * @return array
	 */
	public static function payment_gateways() {

		if ( ! self::$gateways ) {
			self::$gateways = self::init_gateways();
		}

		return self::$gateways;
	}


	/**
	 * Initialize gateways.
	 *
	 * @return array
	 */
	private static function init_gateways() {
		/**
		 * Filters the list of payment gateways to register.
		 *
		 * @since 1.0.0
		 */
		$gateways = apply_filters( 'payment_core_payment_gateways', array() );

		if ( empty( $gateways ) || ! is_array( $gateways ) ) {
			return;
		}

		return array_filter(
			$gateways,
			function ( $gateway ) {
				return $gateway instanceof WC_Abstract_Payment_Gateway;
			}
		);
	}


	/**
	 * Add payment gateways.
	 *
	 * @param  array $methods Payment gateways.
	 * @return array
	 */
	public static function add_gateways( $methods ) {

		if ( empty( self::payment_gateways() ) || ! is_array( self::payment_gateways() ) ) {
			return $methods;
		}

		foreach ( self::payment_gateways() as $gateway ) {
			$methods[] = $gateway;
		}

		return $methods;
	}
}
