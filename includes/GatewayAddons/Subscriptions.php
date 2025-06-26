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
		// Ensure the trait is used in a class that extends WC_Abstract_Payment_Gateway.
		if ( ! is_a( $this, 'GatewayPaymentCore\Gateways\WC_Abstract_Payment_Gateway' ) ) {
			return;
		}

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

		add_filter( $this->prefix_hook( 'process_payment_hosted_session_data' ), array( $this, 'maybe_add_subscription_payment_data' ), 10, 2 );
	}


	/**
	 * Add subscription payment data to the payment request.
	 *
	 * @param array     $payment_data Payment data.
	 * @param \WC_Order $order        Order object.
	 * @return array
	 */
	public function maybe_add_subscription_payment_data( $payment_data, $order ) {
		if ( ! $this->has_subscription( $order ) ) {
			return $payment_data;
		}

		$subscription = $this->get_subscription_object( $order );

		if ( ! $subscription instanceof \WC_Subscription ) {
			return $payment_data;
		}

		$agreement_data = array(
			'amountVariability' => 'FIXED',
			'id'                => $this->unique_subscription_id( $subscription ),
			'paymentFrequency'  => $this->formatted_subscription_period( $subscription ),
			'startDate'         => 1,
		);

		return array_merge(
			$payment_data,
			array(
				'agreement' => array_filter( $agreement_data ),
			)
		);
	}


	/**
	 * Check if the order has a subscription.
	 *
	 * @param \WC_Order $order Order object.
	 * @return bool
	 */
	protected function has_subscription( $order ) {
		return ( function_exists( 'wcs_order_contains_subscription' ) && ( wcs_order_contains_subscription( $order, 'any' ) || wcs_is_subscription( $order ) || wcs_order_contains_renewal( $order ) ) );
	}


	/**
	 * Get the related subscription order from the order.
	 *
	 * @param \WC_Order $order Order object.
	 * @return \WC_Subscription|false
	 */
	protected function get_subscription_object( $order ) {
		if ( ! $this->has_subscription( $order ) ) {
			return false;
		}

		$subscriptions = wcs_get_subscriptions_for_order( $order->get_id() );

		if ( empty( $subscriptions ) || ! is_array( $subscriptions ) ) {
			return false;
		}

		$subscription = reset( $subscriptions );

		if ( ! $subscription instanceof \WC_Subscription ) {
			return false;
		}

		return $subscription;
	}


	/**
	 * Get the unique subscription ID for the order.
	 *
	 * @param \WC_Subscription $subscription Subscription object.
	 * @return string
	 */
	protected function unique_subscription_id( $subscription ) {
		if ( ! $subscription instanceof \WC_Subscription ) {
			return '';
		}

		return $this->prefix_hook( 'subscription-order-' . $subscription->get_id() );
	}


	/**
	 * Format the subscription period for the payment request.
	 *
	 * @param \WC_Subscription $subscription Subscription object.
	 * @return string
	 */
	protected function formatted_subscription_period( $subscription ) {
		if ( ! $subscription instanceof \WC_Subscription ) {
			return '';
		}

		$interval = $subscription->get_billing_interval();

		if ( 1 !== (int) $interval ) {
			return '';
		}

		$period = $subscription->get_billing_period();

		switch ( $period ) {
			case 'day':
				return array(
					'interval' => $interval,
					'unit'     => 'DAILY',
				);
			case 'week':
				return array(
					'interval' => $interval,
					'unit'     => 'WEEKLY',
				);
			case 'month':
				return array(
					'interval' => $interval,
					'unit'     => 'MONTHLY',
				);
			case 'year':
				return array(
					'interval' => $interval,
					'unit'     => 'YEARLY',
				);
			default:
				return '';
		}
	}
}
