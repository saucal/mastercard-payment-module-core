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
use WC_Order;
use WC_Payment_Token_CC;
use WC_Subscription;
use WC_Subscriptions_Cart;
use WC_Subscriptions_Product;
use WCS_Payment_Tokens;

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
		add_filter( $this->prefix_hook( 'process_payment_hosted_session_3ds_authenticate_payer_data' ), array( $this, 'maybe_add_subscription_authentication_data' ), 10, 2 );

		// Remove redirect to checkout page for subscriptions.
		add_filter( 'woocommerce_get_checkout_url', array( __CLASS__, 'maybe_remove_redirect_to_checkout' ) );

		// Hide the save payment method checkbox for subscriptions.
		add_filter( 'wc_' . $this->id . '_display_save_payment_method_checkbox', array( $this, 'maybe_display_save_checkbox_subscription' ) );
		add_filter( $this->prefix_hook( 'payment_method_data' ), array( $this, 'maybe_add_display_save_card_notice' ) );

		// Forcefully save the payment method for subscriptions.
		add_filter( $this->prefix_hook( 'forced_save_payment_method' ), array( $this, 'maybe_force_save_method' ) );

		// Add the payment token as a meta data to the subscription order.
		add_action( $this->prefix_hook( 'payment_method_saved' ), array( $this, 'save_payment_token' ), 10, 2 );

		// Process renewal orders.
		add_action( 'woocommerce_scheduled_subscription_payment_' . $this->id, array( $this, 'scheduled_subscription_payment' ), 10, 2 );

		// Remove the parent unique order ID from the renewal order.
		add_action( $this->prefix_hook( 'process_payment_before' ), array( $this, 'remove_parent_unique_order_id' ) );

		add_action( 'woocommerce_payment_token_deleted', array( $this, 'maybe_remove_token_from_subscriptions' ), 10, 2 );

		// Handle subscription change payment method.
		add_filter( $this->prefix_hook( 'unique_order_id' ), array( $this, 'maybe_bump_order_id_change_payment_method' ), 10, 2 );
		add_filter( $this->prefix_hook( 'process_payment_addon' ), array( $this, 'maybe_handle_sub_change_payment_method' ), 10, 2 );
		add_action( 'wc_ajax_' . $this->prefix_hook( 'update_hosted_session' ), array( $this, 'handle_change_payment_method' ) );
		add_filter( $this->prefix_hook( 'process_payment_hosted_session_3ds_authenticate_payer_data' ), array( $this, 'maybe_change_3ds_return_url' ) );
		add_filter( $this->prefix_hook( '3ds_return_redirect' ), array( $this, 'maybe_add_change_payment_method_flag' ) );
		add_filter( $this->prefix_hook( '3ds_process_redirect' ), array( $this, 'maybe_change_3ds_processed_redirect' ), 10, 2 );

		// Hide the capture meta box for the subscription order.
		add_filter( $this->prefix_hook( 'add_meta_boxes' ), array( $this, 'maybe_hide_capture_meta_box_subscription' ), 10, 2 );

		// Subscriptions are never considered "paid".
		add_filter( $this->prefix_hook( 'validate_order_as_paid' ), array( $this, 'maybe_avoid_subscription_as_paid' ), 10, 2 );
	}


	/**
	 * Add subscription payment data to the payment request.
	 *
	 * @param array    $payment_data Payment data.
	 * @param WC_Order $order        Order object.
	 * @return array
	 */
	public function maybe_add_subscription_payment_data( $payment_data, $order ) {
		if ( ! $this->has_subscription( $order ) ) {
			return $payment_data;
		}

		$subscription = $this->get_subscription_object( $order );

		if ( ! $subscription instanceof WC_Subscription ) {
			return $payment_data;
		}

		return array_merge(
			$payment_data,
			array(
				'apiOperation' => $this->is_subs_change_payment( false ) ? 'AUTHORIZE' : 'PAY',
				'agreement'    => array_filter( $this->get_agreement_data( $subscription ) ),
			)
		);
	}


	/**
	 * Add subscription authentication data to the payment request.
	 *
	 * @param array    $payment_data Payment data.
	 * @param WC_Order $order        Order object.
	 * @return array
	 */
	public function maybe_add_subscription_authentication_data( $payment_data, $order ) {
		if ( ! $this->has_subscription( $order ) ) {
			return $payment_data;
		}

		$subscription = $this->get_subscription_object( $order );
		if ( ! $subscription instanceof WC_Subscription ) {
			return $payment_data;
		}

		$payment_data['agreement'] = array_filter( $this->get_agreement_data( $subscription ) );

		$has_free_trial = $this->order_contains_free_trial( $subscription ) || ( class_exists( 'WC_Subscriptions_Cart' ) && WC_Subscriptions_Cart::cart_contains_free_trial() );

		if ( ! $has_free_trial && ! $this->is_subs_change_payment() ) {
			return $payment_data;
		}

		if ( ! isset( $payment_data['order'] ) || ! is_array( $payment_data['order'] ) ) {
			$payment_data['order'] = array();
		}
		$payment_data['order']['amount'] = $subscription->get_total( 'edit' );

		return $payment_data;
	}


	/**
	 * Get agreement data for the subscription.
	 *
	 * @param WC_Subscription $subscription Subscription object.
	 * @return array
	 */
	protected function get_agreement_data( $subscription ) {
		if ( ! $subscription instanceof WC_Subscription ) {
			return array();
		}

		$end_date = $subscription->get_date( 'end' );

		if ( empty( $end_date ) ) {
			$end_date = $subscription->get_date( 'next_payment' );
		}

		return array(
			'type'                       => 'RECURRING',
			'amountVariability'          => 'FIXED',
			'id'                         => $this->unique_subscription_id( $subscription ),
			'paymentFrequency'           => $this->formatted_subscription_period( $subscription ),
			'startDate'                  => gmdate( 'Y-m-d' ),
			'expiryDate'                 => gmdate( 'Y-m-d', ! empty( $end_date ) ? strtotime( $end_date ) : strtotime( '+1 year' ) ),
			'minimumDaysBetweenPayments' => $this->calculate_min_days_between_payments( $subscription ),
		);
	}


	/**
	 * Calculate minimum days between payments.
	 *
	 * @param WC_Subscription $subscription Subscription object.
	 * @return int
	 */
	protected function calculate_min_days_between_payments( $subscription ) {
		if ( ! $subscription instanceof WC_Subscription ) {
			return 1;
		}

		$next_payment_date = $subscription->get_date( 'next_payment' );

		if ( empty( $next_payment_date ) ) {
			return 1;
		}

		$next_payment_date = strtotime( $next_payment_date );
		if ( ! $next_payment_date ) {
			return 1;
		}

		$time_diff = $next_payment_date - time();

		return (int) ceil( $time_diff / DAY_IN_SECONDS );
	}


	/**
	 * Check if the order has a subscription.
	 *
	 * @param WC_Order $order Order object.
	 * @return bool
	 */
	protected function has_subscription( $order ) {
		return ( function_exists( 'wcs_order_contains_subscription' ) && ( wcs_order_contains_subscription( $order, 'any' ) || wcs_is_subscription( $order ) || wcs_order_contains_renewal( $order ) ) );
	}


	/**
	 * Get the related subscription order from the order.
	 *
	 * @param WC_Order $order Order object.
	 * @return WC_Subscription|false
	 */
	protected function get_subscription_object( $order ) {
		if ( ! $this->has_subscription( $order ) ) {
			return false;
		}

		if ( $order instanceof WC_Subscription ) {
			return $order; // If the order is already a subscription, return it.
		}

		$subscription_id = $order->get_meta( '_subscription_renewal' );
		if ( ! empty( $subscription_id ) && wcs_is_subscription( $subscription_id ) ) {
			$subscription = wcs_get_subscription( $subscription_id );
			if ( $subscription instanceof WC_Subscription ) {
				return $subscription;
			}
		}

		$subscriptions = wcs_get_subscriptions_for_order( $order->get_id() );

		if ( empty( $subscriptions ) || ! is_array( $subscriptions ) ) {
			return false;
		}

		$subscription = reset( $subscriptions );

		if ( ! $subscription instanceof WC_Subscription ) {
			return false;
		}

		return $subscription;
	}


	/**
	 * Get the unique subscription ID for the order.
	 *
	 * @param WC_Subscription $subscription Subscription object.
	 * @return string
	 */
	protected function unique_subscription_id( $subscription ) {
		if ( ! $subscription instanceof WC_Subscription ) {
			return '';
		}

		return $this->prefix_hook( 'subscription-order-' . $subscription->get_id() );
	}


	/**
	 * Format the subscription period for the payment request.
	 *
	 * @param WC_Subscription $subscription Subscription object.
	 * @return string
	 */
	protected function formatted_subscription_period( $subscription ) {
		if ( ! $subscription instanceof WC_Subscription ) {
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
	protected function is_subs_change_payment( $from_pay_for_order = true ) {
		return isset( $_GET['change_payment_method'] ) && ( $from_pay_for_order ? isset( $_GET['pay_for_order'] ) : true ); // WPCS: CSRF ok.
	}


	/**
	 * Hide the save payment method checkbox for subscriptions.
	 *
	 * @param bool $display_tokenization Whether to display the checkbox.
	 * @return bool
	 */
	public function maybe_display_save_checkbox_subscription( $display_tokenization ) {
		if ( is_wc_endpoint_url( 'order-pay' ) && $this->is_subs_change_payment() ) {
			return false;
		}

		if ( $this->cart_contains_subscription() ) {
			return false;
		}

		return $display_tokenization;
	}


	/**
	 * Maybe add display save card notice flag to payment method data.
	 *
	 * @param array $data Payment method data.
	 * @return array
	 */
	public function maybe_add_display_save_card_notice( $data ) {
		if ( $this->display_save_checkbox ) {
			return $data;
		}

		if ( ! is_array( $data ) ) {
			$data = array();
		}

		$data['saveCardNotice'] = $this->save_card_notice_text();

		return $data;
	}


	/**
	 * Forcefully save the payment method for subscriptions.
	 *
	 * @param bool $force_save Whether to force save the payment method.
	 * @return bool
	 */
	public function maybe_force_save_method( $force_save ) {
		if ( $this->is_subs_change_payment( false ) ) {
			return true;
		}

		if ( $this->maybe_display_save_checkbox_subscription( true ) ) {
			return $force_save;
		}

		return true;
	}


	/**
	 * Handle subscription change payment method.
	 *
	 * @param bool     $process_payment Whether to process the payment.
	 * @param WC_Order $order           The order object.
	 *
	 * @return array|bool
	 */
	public function maybe_handle_sub_change_payment_method( $process_payment, $order ) {
		if ( ! $this->is_subs_change_payment( false ) ) {
			return $process_payment;
		}

		return $this->process_payment_hosted_session( $order );
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
		// Ensure the renewal order doesn't have a parent unique order ID.
		$this->remove_parent_unique_order_id( $order );

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
		if ( ! $parent_order instanceof WC_Order ) {
			throw new Exception( __( 'The subscription order was not found.', $this->core_plugin->text_domain() ) );
		}

		// This meta duplicates the gateway token ID to the meta.
		// TODO: Consider revising this behavior in the future using the integrated get_payment_tokens on subscriptions. 
		// That method typically adds items to an array, for which we'll have to reconsider to have only one token associated at a time to an order.
		$payment_token = $subscription->get_meta( $this->prefix_hook( 'payment_token' ) );
		if ( empty( $payment_token ) ) {
			$payment_tokens = $parent_order->get_payment_tokens();
			if ( empty( $payment_tokens ) || ! is_array( $payment_tokens ) ) {
				throw new Exception( __( 'No payment token found for the subscription order.', $this->core_plugin->text_domain() ) );
			}

			$payment_token = new WC_Payment_Token_CC( reset( $payment_tokens ) );
			if ( ! $payment_token instanceof WC_Payment_Token_CC ) {
				throw new Exception( __( 'Invalid payment token for the subscription order.', $this->core_plugin->text_domain() ) );
			}

			$payment_token = $payment_token->get_token();
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
				'token' => $payment_token,
			),
		);

		$this->create_payment_transaction(
			$order,
			$this->unique_order_id( $order ),
			$this->unique_transaction_id( $order ),
			$payment_data,
		);
	}


	/**
	 * Save the payment token for the subscription order.
	 *
	 * @param WC_Order $order    The order object.
	 * @param int      $token_id The payment token ID.
	 * @return void
	 */
	public function save_payment_token( $order, $token_id ) {
		if ( ! $order instanceof WC_Order || ! $token_id ) {
			return;
		}

		$subscription = $this->get_subscription_object( $order );
		if ( ! $subscription instanceof WC_Subscription ) {
			return;
		}

		$payment_token = new WC_Payment_Token_CC( $token_id );
		if ( ! $payment_token instanceof WC_Payment_Token_CC ) {
			return;
		}

		// This adds a list of tokens endlessly after several changes, making it very difficult to be useful.
		// TODO: Consider revising this behavior in the future.
		$subscription->add_payment_token( $payment_token->get_id() );
		$subscription->update_meta_data( $this->prefix_hook( 'payment_token' ), $payment_token->get_token() );
		$subscription->save();
	}


	/**
	 * Remove the parent unique order ID from the renewal order.
	 *
	 * @param WC_Order $renewal_order The renewal order object.
	 * @return void
	 */
	public function remove_parent_unique_order_id( $renewal_order ) {
		if ( ! $renewal_order instanceof WC_Order ) {
			return;
		}

		if ( empty( $renewal_order->get_meta( '_subscription_renewal' ) ) ) {
			return;
		}

		$renewal_order->delete_meta_data( $this->prefix_hook( 'order_id' ) );
		$renewal_order->save_meta_data();
	}


	/**
	 * Bump the order ID for subscription change payment method.
	 *
	 * @param string   $unique_order_id The unique order ID.
	 * @param WC_Order $order           The order object.
	 * @return string
	 */
	public function maybe_bump_order_id_change_payment_method( $unique_order_id, $order ) {
		if ( ! isset( $_POST['change_payment_method'] ) && ! $this->is_subs_change_payment() ) {
			return $unique_order_id;
		}

		$subscription = $this->get_subscription_object( $order );
		if ( ! $subscription instanceof WC_Subscription ) {
			return $unique_order_id;
		}

		$unique_order_id = md5( $unique_order_id . time() );

		$order->update_meta_data( $this->prefix_hook( 'order_id' ), $unique_order_id );
		$order->save_meta_data();

		remove_filter( $this->prefix_hook( 'unique_order_id' ), array( $this, 'maybe_bump_order_id_change_payment_method' ), 10 );

		return $unique_order_id;
	}


	/**
	 * Change the 3DS return URL for subscription change payment method.
	 *
	 * @param array $payment_data Payment data.
	 *
	 * @return array
	 */
	public function maybe_change_3ds_return_url( $payment_data ) {
		if ( ! isset( $_POST['change_payment_method'] ) ) {
			return $payment_data;
		}

		if ( ! isset( $payment_data['authentication']['redirectResponseUrl'] ) ) {
			return $payment_data;
		}

		$payment_data['authentication']['redirectResponseUrl'] = wp_nonce_url(
			add_query_arg(
				array(
					'change_payment_method' => 1,
				),
				$payment_data['authentication']['redirectResponseUrl']
			)
		);

		return $payment_data;
	}


	/**
	 * Add change_payment_method flag to the 3DS return URL.
	 *
	 * @param string $redirect_url The redirect URL.
	 * @return string
	 */
	public function maybe_add_change_payment_method_flag( $redirect_url ) {
		if ( ! isset( $_GET['change_payment_method'] ) ) {
			return $redirect_url;
		}

		return add_query_arg( 'change_payment_method', 1, $redirect_url );
	}


	/**
	 * Change the 3DS processed redirect for subscription change payment method.
	 *
	 * @param string   $redirect_url The redirect URL.
	 * @param WC_Order $order       The order object.
	 * @return string
	 */
	public function maybe_change_3ds_processed_redirect( $redirect_url, $order ) {
		if ( ! $this->is_subs_change_payment( false ) ) {
			return $redirect_url;
		}

		$subscription = $this->get_subscription_object( $order );
		if ( ! $subscription instanceof WC_Subscription ) {
			return $redirect_url;
		}

		// Clean forced order ID.
		$order->delete_meta_data( $this->prefix_hook( 'order_id' ) );
		$order->save_meta_data();

		$notice = $subscription->has_payment_gateway() ? __( 'Payment method updated.', $this->core_plugin->text_domain() ) : __( 'Payment method added.', $this->core_plugin->text_domain() );
		wc_add_notice( $notice );

		return $subscription->get_view_order_url();
	}


	/**
	 * Maybe remove the payment token from subscriptions when deleted.
	 *
	 * @param int    $token_id The payment token ID.
	 * @param object $token    The payment token object.
	 * @return void
	 */
	public function maybe_remove_token_from_subscriptions( $token_id, $token ) {
		if ( ! class_exists( 'WCS_Payment_Tokens' ) ) {
			return;
		}

		$subscriptions = WCS_Payment_Tokens::get_subscriptions_from_token( $token );

		if ( empty( $subscriptions ) ) {
			return;
		}

		foreach ( $subscriptions as $subscription ) {
			if ( $token->get_token() !== $subscription->get_meta( $this->prefix_hook( 'payment_token' ) ) ) {
				continue;
			}

			$subscription->delete_meta_data( $this->prefix_hook( 'payment_token' ) );
			$subscription->save_meta_data();
		}
	}


	/**
	 * Hide the capture meta box for the subscription order.
	 *
	 * @param bool     $add_meta_box Whether to add the meta box.
	 * @param WC_Order $order        The order object.
	 * @return bool
	 */
	public function maybe_hide_capture_meta_box_subscription( $add_meta_box, $order ) {
		if ( $this->has_subscription( $order ) ) {
			return false;
		}

		return $add_meta_box;
	}


	/**
	 * Check if the order has a free trial.
	 *
	 * @param WC_Subscription $subscription Subscription object.
	 *
	 * @return bool
	 */
	protected function order_contains_free_trial( $subscription ) {
		if ( ! $subscription instanceof WC_Subscription ) {
			return false;
		}

		if ( ! class_exists( 'WC_Subscriptions_Product' ) ) {
			return false;
		}

		foreach ( $subscription->get_items() as $item ) {
			if( ! is_a( $item, 'WC_Order_Item_Product' ) ) {
				continue;
			}
			$product = $item->get_product();
			if ( $product && WC_Subscriptions_Product::get_trial_length( $product ) > 0 ) {
				return true;
			}
		}

		return false;
	}

	public function maybe_avoid_subscription_as_paid( $is_paid, $order ) {
		return \wcs_is_subscription( $order ) ? false : $is_paid;
	}
}
