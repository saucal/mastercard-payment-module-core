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
use WC_Subscriptions_Switcher;
use WC_Subscriptions_Product;
use WCS_Payment_Tokens;
use Automattic\WooCommerce\Utilities\NumberUtil;

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

		$supported_operations = $this->core_plugin->get_transaction_sources();

		if ( ! isset( $supported_operations['card'] ) || ! in_array( 'MERCHANT', $supported_operations['card'], true ) ) {
			if ( $this->core_plugin->is_settings_page() && $this->core_plugin->is_merchant_connected() ) {
				$this->core_plugin->notices()->add_message(
					__( 'WooCommerce Subscriptions support require "Merchant Initiated Transactions" to be enabled in your account. Contact your acquirer to verify this issue.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'error'
				);
			}
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

		// Add subscription payment data to the payment request.
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_hosted_session_data', array( $this, 'maybe_add_subscription_payment_data' ), 10, 2 );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_hosted_session_3ds_data', array( $this, 'maybe_add_subscription_authentication_initiate_data' ), 10, 2 );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_hosted_session_3ds_authenticate_payer_data', array( $this, 'maybe_add_subscription_authentication_data' ), 10, 2 );

		// Remove redirect to checkout page for subscriptions.
		add_filter( 'woocommerce_get_checkout_url', array( __CLASS__, 'maybe_remove_redirect_to_checkout' ) );

		// Hide the save payment method checkbox for subscriptions.
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_display_save_payment_method_checkbox', array( $this, 'maybe_display_save_checkbox_subscription' ) );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_payment_method_data', array( $this, 'maybe_add_display_save_card_notice' ) );

		// Forcefully save the payment method for subscriptions.
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_forced_save_payment_method', array( $this, 'maybe_force_save_method' ) );

		// A plan switch establishes a new agreement, so the customer goes through
		// the gateway even when the switch costs nothing now.
		add_filter( 'woocommerce_cart_needs_payment', array( $this, 'maybe_require_payment_for_switch' ), 20, 2 );

		// Once a switch is paid or verified, renewals move to its agreement.
		add_action( 'PAYMENTS_CORE_HOOK_PREFIX_payment_success', array( $this, 'maybe_adopt_switch_agreement' ) );

		// Add the payment token as a meta data to the subscription order.
		add_action( 'PAYMENTS_CORE_HOOK_PREFIX_payment_method_saved', array( $this, 'save_payment_token' ), 10, 2 );

		// Process renewal orders.
		add_action( 'woocommerce_scheduled_subscription_payment_' . $this->id, array( $this, 'scheduled_subscription_payment' ), 10, 2 );

		// Remove the parent unique order ID from the renewal order.
		add_action( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_before', array( $this, 'remove_parent_unique_order_id' ) );

		add_action( 'woocommerce_payment_token_deleted', array( $this, 'maybe_remove_token_from_subscriptions' ), 10, 2 );

		// Keep a customer from removing a card their subscriptions renew with,
		// even when they have another one (see is_subscription_token_locked()).
		add_filter( 'woocommerce_payment_methods_list_item', array( $this, 'maybe_block_subscription_token_deletion' ), 20, 2 );
		add_action( 'woocommerce_before_account_payment_methods', array( $this, 'print_subscription_token_notices' ) );
		add_action( 'wp', array( $this, 'maybe_refuse_subscription_token_deletion' ), 10 );

		// Handle subscription change payment method.
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_unique_order_id', array( $this, 'maybe_bump_order_id_change_payment_method' ), 10, 2 );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_addon', array( $this, 'maybe_handle_sub_change_payment_method' ), 10, 2 );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_hosted_session_3ds_authenticate_payer_data', array( $this, 'maybe_change_3ds_return_url' ) );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_3ds_return_redirect', array( $this, 'maybe_add_change_payment_method_flag' ) );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_3ds_process_redirect', array( $this, 'maybe_change_3ds_processed_redirect' ), 10, 2 );

		// Hide the capture meta box for the subscription order.
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_add_meta_boxes', array( $this, 'maybe_hide_capture_meta_box_subscription' ), 10, 2 );

		// Subscriptions are never considered "paid".
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_validate_order_as_paid', array( $this, 'maybe_avoid_subscription_as_paid' ), 10, 2 );
	}


	/**
	 * Add subscription payment data to the payment request.
	 *
	 * @param array         $payment_data Payment data.
	 * @param WC_Order|null $order        Order object.
	 * @return array
	 */
	public function maybe_add_subscription_payment_data( $payment_data, $order ) {
		$subscription = $this->get_subscription_object( $order );
		if ( ! $subscription instanceof WC_Subscription || $this->is_payer_paid_renewal( $order ) ) {
			return $payment_data;
		}

		$api_operation = 'PAY';
		/**
		 * If we're adding a card for the subscription, we're likely changing payment method.
		 * Alternatively, there's also the case where the total for the order is zero
		 * (while the subscription is being created with a free trial, or a coupon).
		 *
		 * In either case, we need to set the apiOperation to be VERIFY, to allow a 0 dollar amount
		 */
		if ( $this->order_is_empty_or_subscription( $order, $subscription ) ) {
			$api_operation = 'VERIFY';
		}

		// A switch that costs nothing now verifies at the recurring amount its
		// authentication used (AUTHENTICATE_PAYER rejects 0); a VERIFY charges
		// nothing, and the gateway rejects one that does not match its 3DS
		// authentication.
		if ( 'VERIFY' === $api_operation && $this->is_switch_order( $order ) ) {
			$payment_data['order']['amount'] = $subscription->get_total( 'edit' );
		}

		return array_merge(
			$payment_data,
			array(
				'apiOperation'  => $api_operation,
				'agreement'     => array_filter( $this->get_agreement_data( $subscription, false, $order ) ),
				'sourceOfFunds' => array(
					'provided' => array(
						'card' => array(
							'storedOnFile' => 'TO_BE_STORED',
						),
					),
				),
			)
		);
	}

	/**
	 * Add subscription authentication data to the payment request.
	 *
	 * @param array         $init_authentication Init authentication data.
	 * @param WC_Order|null $order               Order object.
	 * @return array
	 */
	public function maybe_add_subscription_authentication_initiate_data( $init_authentication, $order ) {
		$subscription = $this->get_subscription_object( $order );
		if ( ! $subscription instanceof WC_Subscription ) {
			return $init_authentication;
		}

		/**
		 * If we're adding a card for the subscription, we're likely changing payment method.
		 * Alternatively, there's also the case where the total for the order is zero
		 * (while the subscription is being created with a free trial, or a coupon).
		 *
		 * In either case, we need to set the purpose to ADD_CARD.
		 */
		if ( $this->order_is_empty_or_subscription( $order, $subscription ) ) {
			$init_authentication['authentication']['purpose'] = 'ADD_CARD';
		}

		return $init_authentication;
	}


	/**
	 * Add subscription authentication data to the payment request.
	 *
	 * @param array    $payment_data Payment data.
	 * @param WC_Order $order        Order object.
	 * @return array
	 */
	public function maybe_add_subscription_authentication_data( $payment_data, $order ) {
		$subscription = $this->get_subscription_object( $order );
		if ( ! $subscription instanceof WC_Subscription || $this->is_payer_paid_renewal( $order ) ) {
			return $payment_data;
		}

		$payment_data['agreement'] = array_filter( $this->get_agreement_data( $subscription, true, $order ) );

		$has_free_trial = $this->order_contains_free_trial( $subscription ) || ( class_exists( 'WC_Subscriptions_Cart' ) && WC_Subscriptions_Cart::cart_contains_free_trial() );
		// AUTHENTICATE_PAYER rejects amount 0, so a switch that costs nothing now
		// authenticates the recurring amount it agrees to, as a free trial does.
		$is_free_switch = $this->is_switch_order( $order ) && $this->order_is_empty_or_subscription( $order, $subscription );

		if ( ! $has_free_trial && ! $is_free_switch && ! $this->is_subs_change_payment() ) {
			return $payment_data;
		}

		if ( ! isset( $payment_data['order'] ) || ! is_array( $payment_data['order'] ) ) {
			$payment_data['order'] = array();
		}
		$payment_data['order']['amount'] = $subscription->get_total( 'edit' );

		return $payment_data;
	}


	/**
	 * Whether the payer is paying a renewal order themselves: "Renew now", or
	 * paying a failed renewal from My Account.
	 *
	 * Such a payment must not carry the subscription's agreement. The gateway
	 * treats any payment reusing an agreement.id as the next one in that series
	 * and rejects it unless transaction.source is MERCHANT — but the payer is
	 * present and authenticating, so it is INTERNET. It goes as a plain
	 * cardholder-initiated payment instead; the automatic renewals keep the
	 * agreement through process_subscription_payment(), not these filters.
	 *
	 * A plan switch is different: it establishes a new agreement of its own
	 * (see agreement_id_for_order()), so it goes through these filters.
	 *
	 * @param WC_Order|null $order Order object.
	 * @return bool
	 */
	protected function is_payer_paid_renewal( $order ) {
		return $order instanceof WC_Order && function_exists( 'wcs_order_contains_renewal' ) && wcs_order_contains_renewal( $order );
	}


	/**
	 * Whether the order switches a subscription to another plan.
	 *
	 * @param WC_Order|null $order Order object.
	 * @return bool
	 */
	protected function is_switch_order( $order ) {
		return $order instanceof WC_Order && function_exists( 'wcs_order_contains_switch' ) && wcs_order_contains_switch( $order );
	}


	/**
	 * The agreement a subscription's renewals currently run under.
	 *
	 * Set when a plan switch establishes a new agreement; until then it is the
	 * one the subscription's first checkout established.
	 *
	 * @param WC_Subscription $subscription Subscription object.
	 * @return string
	 */
	protected function current_agreement_id( $subscription ) {
		$agreement_id = $subscription->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_agreement_id' );
		return $agreement_id ? $agreement_id : $this->unique_subscription_id( $subscription );
	}


	/**
	 * The agreement a customer-present order for this subscription establishes.
	 *
	 * A plan switch changes the terms the renewals are charged under, so it
	 * establishes a new agreement rather than reuse the current one: the
	 * gateway accepts re-authenticating an existing agreement.id, but then
	 * treats the payment that references that authentication as the next
	 * payment in the series and rejects it as cardholder-initiated. A new
	 * agreement keeps the switch to a single payment with a single 3DS
	 * challenge, exactly like the first checkout.
	 *
	 * @param WC_Subscription $subscription Subscription object.
	 * @param WC_Order|null   $order        The order being paid.
	 * @return string
	 */
	protected function agreement_id_for_order( $subscription, $order = null ) {
		if ( $this->is_switch_order( $order ) ) {
			return $this->unique_subscription_id( $subscription ) . '-switch-' . $order->get_id();
		}

		return $this->current_agreement_id( $subscription );
	}


	/**
	 * After a switch is paid or verified, move the subscription's renewals to
	 * the agreement it established, and record the old one as superseded.
	 *
	 * Superseding it means it is never sent again: renewals use the new
	 * agreement.id and reference the switch's gateway order. The old one is
	 * left to expire rather than sent to "Agreement: Cancel Agreement", which
	 * Mastercard says is needed only where the acquirer or regional
	 * regulations require agreements to be recorded.
	 *
	 * @param WC_Order $order The paid order.
	 * @return void
	 */
	public function maybe_adopt_switch_agreement( $order ) {
		if ( ! $this->is_switch_order( $order ) || $order->get_payment_method() !== $this->id || ! function_exists( 'wcs_get_subscriptions_for_switch_order' ) ) {
			return;
		}

		foreach ( wcs_get_subscriptions_for_switch_order( $order ) as $subscription ) {
			$old_agreement = $this->current_agreement_id( $subscription );
			$new_agreement = $this->agreement_id_for_order( $subscription, $order );
			if ( $old_agreement === $new_agreement ) {
				continue;
			}

			$subscription->update_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_agreement_id', $new_agreement );
			$subscription->update_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_agreement_reference_order_id', $this->unique_order_id( $order ) );
			$subscription->save_meta_data();

			$subscription->add_order_note(
				sprintf(
					// translators: 1: old agreement id, 2: new agreement id, 3: order number.
					__( 'Plan change: payment agreement %1$s replaced by %2$s (order #%3$s). Renewals now use the new agreement; the old one is no longer used.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					$old_agreement,
					$new_agreement,
					$order->get_order_number()
				)
			);
		}
	}


	/**
	 * Require payment for a plan switch of a subscription this gateway renews,
	 * even when it costs nothing now (a downgrade, or upgrades set not to
	 * prorate): the switch establishes a new agreement, which needs the
	 * customer present, so it goes through the gateway as a VERIFY.
	 *
	 * @param bool    $needs_payment Whether the cart needs payment.
	 * @param WC_Cart $cart          Cart.
	 * @return bool
	 */
	public function maybe_require_payment_for_switch( $needs_payment, $cart ) {
		if ( $needs_payment || ! class_exists( 'WC_Subscriptions_Switcher' ) ) {
			return $needs_payment;
		}

		$switch_items = WC_Subscriptions_Switcher::cart_contains_switches( 'any' );
		if ( empty( $switch_items ) ) {
			return $needs_payment;
		}

		foreach ( $switch_items as $switch_item ) {
			$subscription = ! empty( $switch_item['subscription_id'] ) ? wcs_get_subscription( $switch_item['subscription_id'] ) : false;
			if ( $subscription && ! $subscription->is_manual() && $subscription->get_payment_method() === $this->id ) {
				return true;
			}
		}

		return $needs_payment;
	}


	/**
	 * Get agreement data for the subscription.
	 *
	 * @param WC_Subscription $subscription Subscription object.
	 * @param bool            $establishing Whether this operation establishes the agreement.
	 * @param WC_Order|null   $order        The order being paid, if any.
	 * @return array
	 */
	protected function get_agreement_data( $subscription, $establishing = false, $order = null ) {
		if ( ! $subscription instanceof WC_Subscription ) {
			return array();
		}

		/**
		 * The expiry is sent only where the agreement is established.
		 *
		 * Payments omit it. Mastercard Gateway Support, 2026-09: for agreements
		 * with no contractual end, expiryDate and numberOfPayments "should not be
		 * provided" - which, they later clarified, refers to PAYMENT transactions.
		 *
		 * The AUTHENTICATE_PAYER that establishes the agreement is different: it
		 * rejects the request without one ("Authentication requests to establish
		 * recurring and installment agreements must provide recurring expiry"),
		 * and support confirmed "for AUTHENTICATE_PAYER transactions that start
		 * Agreements agreement.expiryDate must be provided".
		 *
		 * That date is binding. Once it passes, merchant-initiated renewals stop
		 * working, and extending the agreement takes a new payer authentication
		 * with the customer present - which an unattended renewal cannot do. So a
		 * subscription with a real end date sends that date, and one that runs
		 * until cancelled sends a date "sufficiently far into the future so that
		 * it would not present an issue" (support's words; they give no specific
		 * value). See agreement_expiry_date(). Callers array_filter() this array,
		 * so an empty string omits the field.
		 */
		$end_date = $subscription->get_date( 'end' );

		return array(
			'type'                       => 'RECURRING',
			'amountVariability'          => 'FIXED',
			'id'                         => $this->agreement_id_for_order( $subscription, $order ),
			'paymentFrequency'           => $this->formatted_subscription_period( $subscription ),
			'startDate'                  => gmdate( 'Y-m-d' ),
			'expiryDate'                 => $this->agreement_expiry_date( $end_date, $establishing ),
			// max(1): array_filter() below drops a 0, and a dropped value fails the
			// same validation as omitting it — which would bite whenever the next
			// payment is less than a day away.
			'minimumDaysBetweenPayments' => $establishing ? max( 1, $this->calculate_min_days_between_payments( $subscription ) ) : '',
		);
	}


	/**
	 * The agreement expiry to send, or '' to omit it.
	 *
	 * @param string $end_date       Subscription end date, empty when open-ended.
	 * @param bool   $establishing   Whether this operation establishes the agreement.
	 * @return string
	 */
	protected function agreement_expiry_date( $end_date, $establishing ) {
		if ( ! empty( $end_date ) ) {
			return gmdate( 'Y-m-d', strtotime( $end_date ) );
		}

		// ponytail: fixed 20-year horizon, no gateway maximum is documented; if one
		// turns up, clamp to it here.
		return $establishing ? gmdate( 'Y-m-d', strtotime( '+20 years' ) ) : '';
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
		if ( ! $this->is_order( $order ) ) {
			return false;
		}

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

		return 'PAYMENTS_CORE_HOOK_PREFIX_subscription-order-' . $subscription->get_id();
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
	 * @param bool $from_pay_for_order Whether to also check for pay_for_order parameter.
	 *
	 * @return bool
	 */
	protected function is_subs_change_payment( $from_pay_for_order = true ) {
		return isset( $_GET['change_payment_method'] ) && ( $from_pay_for_order ? isset( $_GET['pay_for_order'] ) : true ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
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

			/**
			 * Fires after subscription payments are processed for an order.
			 *
			 * @since 1.0.0
			 */
			do_action( 'processed_subscription_payments_for_order', $renewal_order ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- WooCommerce Subscriptions integration hook.
			/**
			 * Fires after a scheduled subscription payment succeeds.
			 *
			 * @since 1.0.0
			 */
			do_action( 'PAYMENTS_CORE_HOOK_PREFIX_scheduled_subscription_success', $total_amount, $renewal_order );
		} catch ( Exception $e ) {

			$order_note = __( 'Error processing scheduled_subscription_payment. Reason: ', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) . $e->getMessage();

			if ( ! $renewal_order->has_status( 'failed' ) ) {
				$renewal_order->update_status( 'failed', $order_note );
			} else {
				$renewal_order->add_order_note( $order_note );
			}

			if ( isset( $_REQUEST['process_early_renewal'] ) && ! wp_doing_cron() ) { //phpcs:ignore WordPress.Security.NonceVerification.Recommended
				wc_add_notice( $e->getMessage(), 'error' );
			}

			$this->core_plugin->logger()->log( $e->getMessage(), 'error' );

			/**
			 * Fires after a subscription payment failure for an order.
			 *
			 * @since 1.0.0
			 */
			do_action( 'processed_subscription_payment_failure_for_order', $renewal_order ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- WooCommerce Subscriptions integration hook.
			/**
			 * Fires after a scheduled subscription payment fails.
			 *
			 * @since 1.0.0
			 */
			do_action( 'PAYMENTS_CORE_HOOK_PREFIX_scheduled_subscription_failure', $total_amount, $renewal_order );
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
			throw new Exception( esc_html( __( 'The subscription order was not found.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		$parent_id = ! empty( $subscription_id ) ? wc_get_order( $subscription_id )->get_parent_id() : null;
		if ( ! $parent_id ) {
			throw new Exception( esc_html( __( 'No subscription found for this renewal order.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		$parent_order = wc_get_order( $parent_id );
		if ( ! $parent_order instanceof WC_Order ) {
			throw new Exception( esc_html( __( 'The subscription order was not found.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
		}

		// This meta duplicates the gateway token ID to the meta.
		// TODO: Consider revising this behavior in the future using the integrated get_payment_tokens on subscriptions.
		// That method typically adds items to an array, for which we'll have to reconsider to have only one token associated at a time to an order.
		$payment_token = $subscription->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_payment_token' );
		if ( empty( $payment_token ) ) {
			$payment_tokens = $parent_order->get_payment_tokens();
			if ( empty( $payment_tokens ) || ! is_array( $payment_tokens ) ) {
				throw new Exception( esc_html( __( 'No payment token found for the subscription order.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
			}

			$payment_token = new WC_Payment_Token_CC( reset( $payment_tokens ) );
			if ( ! $payment_token instanceof WC_Payment_Token_CC ) {
				throw new Exception( esc_html( __( 'Invalid payment token for the subscription order.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) ) );
			}

			$payment_token = $payment_token->get_token();
		}

		$this->create_merchant_initiated_payment(
			$order,
			$this->unique_order_id( $order ),
			array(
				'id'                => $this->current_agreement_id( $subscription ),
				'type'              => 'RECURRING',
				'amountVariability' => 'FIXED',
			),
			// The gateway order that established the current agreement: the first
			// checkout, or the latest plan switch.
			$subscription->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_agreement_reference_order_id' ) ?: $this->unique_order_id( $parent_order ),
			$payment_token
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
		$subscription->update_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_payment_token', $payment_token->get_token() );
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

		$renewal_order->delete_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_order_id' );
		$renewal_order->save_meta_data();
	}


	/**
	 * Bump the order ID for subscription change payment method.
	 *
	 * @param string        $unique_order_id The unique order ID.
	 * @param WC_Order|null $order           The order object.
	 * @return string
	 */
	public function maybe_bump_order_id_change_payment_method( $unique_order_id, $order ) {
		if ( ! isset( $_POST['change_payment_method'] ) && ! $this->is_subs_change_payment() ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
			return $unique_order_id;
		}

		$subscription = $this->get_subscription_object( $order );
		if ( ! $subscription instanceof WC_Subscription ) {
			return $unique_order_id;
		}

		$unique_order_id = md5( $unique_order_id . time() );

		$order->update_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_order_id', $unique_order_id );
		$order->save_meta_data();

		// TODO: This is a weird way of bumping the order_id once per request. Consider revising in the future.
		remove_filter( 'PAYMENTS_CORE_HOOK_PREFIX_unique_order_id', array( $this, 'maybe_bump_order_id_change_payment_method' ), 10 );

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
		if ( ! isset( $_POST['change_payment_method'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
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
		if ( ! isset( $_GET['change_payment_method'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
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
		$subscription = $this->get_subscription_object( $order );
		if ( ! $subscription instanceof WC_Subscription ) {
			return $redirect_url;
		}

		if ( $subscription->get_id() !== $order->get_id() ) {
			return $redirect_url;
		}

		// Clean forced order ID.
		$order->delete_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_order_id' );
		$order->save_meta_data();

		$notice = $subscription->has_payment_gateway() ? __( 'Payment method updated.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) : __( 'Payment method added.', '__PAYMENTS_CORE_TEXT_DOMAIN__' );
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
			if ( $token->get_token() !== $subscription->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_payment_token' ) ) {
				continue;
			}

			$subscription->delete_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_payment_token' );
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
			if ( ! is_a( $item, 'WC_Order_Item_Product' ) ) {
				continue;
			}
			$product = $item->get_product();
			if ( $product && WC_Subscriptions_Product::get_trial_length( $product ) > 0 ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Maybe avoid marking a subscription as paid.
	 *
	 * @param bool     $is_paid Whether the order is paid.
	 * @param WC_Order $order   The order object.
	 *
	 * @return bool
	 */
	public function maybe_avoid_subscription_as_paid( $is_paid, $order ) {
		return \wcs_is_subscription( $order ) ? false : $is_paid;
	}

	/**
	 * Check if the order is empty or is a subscription (no parent order total).
	 *
	 * @param WC_Order        $order        The order object.
	 * @param WC_Subscription $subscription The subscription object.
	 *
	 * @return bool
	 */
	public function order_is_empty_or_subscription( $order, $subscription ) {
		return $subscription->get_id() === $order->get_id() || NumberUtil::round( $order->get_total(), \WC_ROUNDING_PRECISION ) <= 0;
	}


	/**
	 * The customer's active subscriptions that renew with this card.
	 *
	 * @param WC_Payment_Token $token Saved card.
	 * @return WC_Subscription[]
	 */
	protected function subscriptions_using_token( $token ) {
		if ( ! $token instanceof \WC_Payment_Token || $token->get_gateway_id() !== $this->id || ! class_exists( 'WCS_Payment_Tokens' ) ) {
			return array();
		}

		return array_values( WCS_Payment_Tokens::get_subscriptions_from_token( $token ) );
	}


	/**
	 * Whether active subscriptions renew with this card.
	 *
	 * WooCommerce Subscriptions only stops this when the customer has no other
	 * card; with another one it lets the card go and repoints the subscriptions.
	 * That cannot work here: the gateway binds the agreement to the card of its
	 * last cardholder-initiated payment and refuses a merchant-initiated charge
	 * on any other card ("The card number provided for this merchant-initiated
	 * transaction does not match the card number used for the last
	 * customer-initiated transaction in this series of payments"). Observed: the
	 * next renewal failed and the subscription went On hold. The card can change
	 * through "Change payment method", which the customer completes at the
	 * gateway.
	 *
	 * @param WC_Payment_Token $token Saved card.
	 * @return bool
	 */
	protected function is_subscription_token_locked( $token ) {
		return ! empty( $this->subscriptions_using_token( $token ) );
	}


	/**
	 * Remove the Delete action from a card subscriptions renew with. Runs after
	 * WooCommerce Subscriptions' own filter.
	 *
	 * @param array             $item  Payment method list item.
	 * @param \WC_Payment_Token $token Saved card.
	 * @return array
	 */
	public function maybe_block_subscription_token_deletion( $item, $token ) {
		if ( isset( $item['actions']['delete'] ) && $this->is_subscription_token_locked( $token ) ) {
			unset( $item['actions']['delete'] );
		}

		return $item;
	}


	/**
	 * Explain on My Account > Payment methods why a card cannot be removed.
	 *
	 * @return void
	 */
	public function print_subscription_token_notices() {
		if ( ! is_user_logged_in() ) {
			return;
		}

		foreach ( \WC_Payment_Tokens::get_customer_tokens( get_current_user_id(), $this->id ) as $token ) {
			$subscriptions = $this->subscriptions_using_token( $token );
			if ( empty( $subscriptions ) ) {
				continue;
			}

			$numbers = array_map(
				function ( $subscription ) {
					return '#' . $subscription->get_order_number();
				},
				$subscriptions
			);

			wc_print_notice(
				sprintf(
					// translators: 1: card label, 2: subscription numbers.
					__( '%1$s is used to renew your subscription %2$s, so it cannot be removed. To use another card, change the subscription\'s payment method first.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					$token->get_display_name(),
					implode( ', ', $numbers )
				),
				'notice'
			);
		}
	}


	/**
	 * Refuse a direct delete request for a card subscriptions renew with.
	 *
	 * Runs before WooCommerce handles the delete-payment-method endpoint (its
	 * handler is on 'wp' at priority 20).
	 *
	 * @return void
	 */
	public function maybe_refuse_subscription_token_deletion() {
		global $wp;

		if ( ! isset( $wp->query_vars['delete-payment-method'] ) ) {
			return;
		}

		$token = \WC_Payment_Tokens::get( absint( $wp->query_vars['delete-payment-method'] ) );
		if ( ! $token || $token->get_user_id() !== get_current_user_id() || ! $this->is_subscription_token_locked( $token ) ) {
			return;
		}

		wc_add_notice( __( 'This card is used to renew a subscription, so it cannot be removed. To use another card, change the subscription\'s payment method first.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ), 'error' );
		wp_safe_redirect( wc_get_account_endpoint_url( 'payment-methods' ) );
		exit;
	}
}
