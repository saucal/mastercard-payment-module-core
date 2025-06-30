<?php
/**
 * Subscriptions interface.
 *
 * @class       Subscriptions
 * @version     1.0.0
 * @package     GatewayPaymentCore/GatewayAddons/
 */

namespace GatewayPaymentCore\GatewayAddons;

use Exception;
use GatewayPaymentCore\PaymentToken;
use WC_Payment_Token_CC;
use WC_Payment_Tokens;
use WC_Subscription;
use WC_Subscriptions_Cart;
use WC_Subscriptions_Product;

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

		if ( $this->is_hosted_checkout() ) {
			return; // Subscriptions are not supported in hosted checkout mode.
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

		// Add subscription payment data to the payment request.
		add_filter( $this->prefix_hook( 'process_payment_hosted_session_data' ), array( $this, 'maybe_add_subscription_payment_data' ), 10, 2 );
		add_filter( $this->prefix_hook( 'process_payment_hosted_session_3ds_data' ), array( $this, 'maybe_add_subscription_payment_data' ), 10, 2 );
		add_filter( $this->prefix_hook( 'process_payment_hosted_session_3ds_authenticate_payer_data' ), array( $this, 'maybe_add_subscription_payment_data' ), 10, 2 );

		// Remove redirect to checkout page for subscriptions.
		add_filter( 'woocommerce_get_checkout_url', array( __CLASS__, 'maybe_remove_redirect_to_checkout' ) );

		// Hide the save payment method checkbox for subscriptions.
		add_filter( 'wc_' . $this->id . '_display_save_payment_method_checkbox', array( $this, 'maybe_display_save_checkbox' ) );
		add_action( 'wc_' . $this->id . '_after_payment_method_fields', array( $this, 'maybe_display_save_card_notice' ) );

		// Forcefully save the payment method for subscriptions.
		add_filter( $this->prefix_hook( 'forced_save_payment_method' ), array( $this, 'maybe_force_save_method' ) );

		// Process renewal orders.
		add_action( 'woocommerce_scheduled_subscription_payment_' . $this->id, array( $this, 'scheduled_subscription_payment' ), 10, 2 );
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

		$end_date = $subscription->get_date( 'end' );

		if ( empty( $end_date ) ) {
			$end_date = $subscription->get_date( 'next_payment' );
		}

		$agreement_data = array(
			'type'                       => 'RECURRING',
			'amountVariability'          => 'FIXED',
			'id'                         => $this->unique_subscription_id( $subscription ),
			'paymentFrequency'           => $this->formatted_subscription_period( $subscription ),
			'startDate'                  => gmdate( 'Y-m-d' ),
			'expiryDate'                 => gmdate( 'Y-m-d', ! empty( $end_date ) ? strtotime( $end_date ) : strtotime( '+1 year' ) ),
			'minimumDaysBetweenPayments' => 1,
		);

		return array_merge(
			$payment_data,
			array(
				'apiOperation' => 'PAY', // Use 'PAY' for subscription payments.
				'agreement'    => array_filter( $agreement_data ),
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
			return 'OTHER';
		}

		$interval = $subscription->get_billing_interval();

		if ( 1 !== (int) $interval ) {
			return 'OTHER';
		}

		$period = $subscription->get_billing_period();

		switch ( $period ) {
			case 'day':
				return 'DAILY';
			case 'week':
				return 'WEEKLY';
			case 'month':
				return 'MONTHLY';
			case 'year':
				return 'YEARLY';
			default:
				return 'OTHER';
		}
	}


	/**
	 * Remove the redirect to the checkout page for subscriptions.
	 *
	 * @param string $checkout_url The checkout URL.
	 * @return string
	 */
	public static function maybe_remove_redirect_to_checkout( $checkout_url ) {
		if ( ! self::cart_contains_subscription() ) {
			return $checkout_url;
		}

		$subscription_cart_item_keys = array(
			'subscription_initial_payment',
			'subscription_resubscribe',
			'subscription_switch',
		);

		foreach ( $subscription_cart_item_keys as $cart_item_key ) {
			if ( did_action( 'woocommerce_setup_cart_for_' . $cart_item_key ) ) {
				return '';
			}
		}

		return $checkout_url;
	}


	/**
	 * Check if the cart contains a subscription.
	 *
	 * @return bool
	 */
	protected static function cart_contains_subscription() {
		if ( class_exists( 'WC_Subscriptions_Cart' ) && WC_Subscriptions_Cart::cart_contains_subscription() ) {
			return true;
		}
		if ( function_exists( 'wcs_cart_contains_renewal' ) && wcs_cart_contains_renewal() ) {
			return true;
		}
		if ( function_exists( 'wcs_cart_contains_resubscribe' ) && wcs_cart_contains_resubscribe() ) {
			return true;
		}
		return false;
	}


	/**
	 * Checks if page is pay for order and change subs payment page.
	 *
	 * @return bool
	 */
	protected function is_subs_change_payment() {
		return ( isset( $_GET['pay_for_order'] ) && isset( $_GET['change_payment_method'] ) ); // WPCS: CSRF ok.
	}


	/**
	 * Hide the save payment method checkbox for subscriptions.
	 *
	 * @param bool $display_tokenization Whether to display the checkbox.
	 * @return bool
	 */
	public function maybe_display_save_checkbox( $display_tokenization ) {
		if ( is_wc_endpoint_url( 'order-pay' ) && $this->is_subs_change_payment() ) {
			return false;
		}

		if ( $this->cart_contains_subscription() ) {
			return false;
		}

		return $display_tokenization;
	}


	/**
	 * Display a notice after the save payment method checkbox.
	 *
	 * @return void
	 */
	public function maybe_display_save_card_notice() {
		if ( $this->maybe_display_save_checkbox( true ) ) {
			return;
		}

		$save_card_notice = apply_filters(
			$this->prefix_hook( 'save_card_notice' ),
			__( 'Your payment method will be saved for future purchases.', $this->core_plugin->text_domain() )
		);

		echo '<p class="wc-gateway-' . $this->id . '-save-card-notice"><i>' . wp_kses_post( $save_card_notice ) . '</i></p>';
	}


	/**
	 * Forcefully save the payment method for subscriptions.
	 *
	 * @param bool $force_save Whether to force save the payment method.
	 * @return bool
	 */
	public function maybe_force_save_method( $force_save ) {
		if ( $this->maybe_display_save_checkbox( true ) ) {
			return $force_save;
		}

		return true;
	}


	/**
	 * Process scheduled subscription payment.
	 *
	 * @param float    $total_amount  Amount to charge for the subscription.
	 * @param WC_Order $renewal_order Renewal order object.
	 */
	public function scheduled_subscription_payment( $total_amount, $renewal_order ) {
		try {
			$this->process_subscription_payment( $renewal_order );

			do_action( 'processed_subscription_payments_for_order', $renewal_order );
			do_action( $this->prefix_hook( 'scheduled_subscription_success' ), $total_amount, $renewal_order );
		} catch ( Exception $e ) {

			$order_note = __( 'Error processing scheduled_subscription_payment. Reason: ', $this->core_plugin->text_domain() ) . $e->getMessage();

			if ( ! $renewal_order->has_status( 'failed' ) ) {
				$renewal_order->update_status( 'failed', $order_note );
			} else {
				$renewal_order->add_order_note( $order_note );
			}

			if ( isset( $_REQUEST['process_early_renewal'] ) && ! wp_doing_cron() ) { //phpcs:ignore WordPress.Security.NonceVerification.Recommended
				wc_add_notice( $e->getMessage(), 'error' );
			}

			$this->core_plugin->logger()->log( $e->getMessage(), 'error' );

			do_action( 'processed_subscription_payment_failure_for_order', $renewal_order );
			do_action( $this->prefix_hook( 'scheduled_subscription_failure' ), $total_amount, $renewal_order );
		}
	}


	/**
	 * Process subscription payment.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return void
	 * @throws Exception Exception.
	 */
	protected function process_subscription_payment( $order ) {

		$subscription_id = $order->get_meta( '_subscription_renewal' );
		$subscription    = wcs_get_subscription( $subscription_id );
		if ( ! $subscription instanceof WC_Subscription ) {
			throw new Exception( __( 'The subscription order was not found.', $this->core_plugin->text_domain() ) );
		}

		$parent_id = ! empty( $subscription_id ) ? wc_get_order( $subscription_id )->get_parent_id() : null;
		if ( ! $parent_id ) {
			throw new Exception( __( 'No subscription found for this renewal order.', $this->core_plugin->text_domain() ) );
		}

		$parent_order = wc_get_order( $parent_id );
		if ( ! $parent_order instanceof \WC_Order ) {
			throw new Exception( __( 'The subscription order was not found.', $this->core_plugin->text_domain() ) );
		}

		$payment_tokens = $parent_order->get_payment_tokens();
		if ( empty( $payment_tokens ) || ! is_array( $payment_tokens ) ) {
			throw new Exception( __( 'No payment token found for the subscription order.', $this->core_plugin->text_domain() ) );
		}

		$payment_token = new WC_Payment_Token_CC( reset( $payment_tokens ) );
		if ( ! $payment_token instanceof WC_Payment_Token_CC ) {
			throw new Exception( __( 'Invalid payment token for the subscription order.', $this->core_plugin->text_domain() ) );
		}

		$payment_data = array(
			'apiOperation'     => 'PAY',
			'order'            => $this->hosted_session_order_payload( $order ),
			'agreement'        => array(
				'id' => $this->unique_subscription_id( $subscription ),
			),
			'referenceOrderId' => $this->unique_order_id( $parent_order ),
			'sourceOfFunds'    => array(
				'type'  => 'CARD',
				'token' => $payment_token->get_token(),
			),
		);

		$this->create_payment_transaction(
			$order,
			$this->unique_order_id( $order ),
			$this->unique_transaction_id( $order ),
			$payment_data,
		);
	}
}
