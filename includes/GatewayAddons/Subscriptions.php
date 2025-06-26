<?php
/**
 * Subscriptions interface.
 *
 * @class       Subscriptions
 * @version     1.0.0
 * @package     GatewayPaymentCore/GatewayAddons/
 */

namespace GatewayPaymentCore\GatewayAddons;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * WooCommerce Subscriptions Interface.
 */
trait Subscriptions {


	/**
	 * Initialize Subscription support features.
	 *
	 * @return void
	 */
	public function init_addon_subscriptions() {
		if ( ! class_exists( 'WC_Subscriptions' ) ) {
			return;
		}

		$this->supports = array_merge(
			$this->supports,
			array(
				'subscriptions',
				'subscription_cancellation',
				'subscription_suspension',
				'subscription_reactivation',
				'subscription_amount_changes',
				'subscription_date_changes',
				'subscription_payment_method_change',
				'subscription_payment_method_change_customer',
			)
		);
	}
}
