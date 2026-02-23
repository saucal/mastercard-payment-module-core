<?php
/**
 * PreOrders interface.
 *
 * @class       PreOrders
 * @version     1.0.0
 * @package     GatewayPaymentCore/GatewayAddons/
 */

namespace GatewayPaymentCore\GatewayAddons;

use Exception;
use WC_Order;
use WC_Pre_Orders_Order;
use WC_Pre_Orders_Cart;
use WC_Pre_Orders_Product;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * WooCommerce PreOrders Interface.
 */
trait PreOrders {


	/**
	 * Initialize PreOrders support features.
	 *
	 * @return void
	 */
	public function init_addon_pre_orders() {
		// Ensure the trait is used in a class that extends WC_Abstract_Payment_Gateway.
		if ( ! is_a( $this, 'GatewayPaymentCore\Gateways\WC_Abstract_Payment_Gateway' ) ) {
			return;
		}

		if ( ! class_exists( 'WC_Pre_Orders' ) || ! class_exists( 'WC_Pre_Orders_Cart' ) || ! class_exists( 'WC_Pre_Orders_Order' ) ) {
			return;
		}

		// Hosted checkout is not compatible with pre-orders that require tokenization.
		if ( $this->is_hosted_checkout() && $this->cart_contains_pre_order_tokenization() ) {
			return;
		}

		$this->supports = array_merge(
			$this->supports,
			array(
				'pre-orders',
			)
		);

		// Add pre-order payment data to the payment request.
		add_filter( $this->prefix_hook( 'process_payment_data' ), array( $this, 'maybe_add_pre_order_payment_data' ), 10, 2 );
		add_filter( $this->prefix_hook( 'process_payment_hosted_session_data' ), array( $this, 'maybe_add_pre_order_payment_data' ), 10, 2 );

		// Hide the save payment method checkbox for subscriptions.
		add_filter( 'wc_' . $this->id . '_display_save_payment_method_checkbox', array( $this, 'maybe_display_save_checkbox_pre_orders' ) );

		// Force save payment method for pre-orders that require tokenization.
		add_filter( $this->prefix_hook( 'forced_save_payment_method' ), array( $this, 'maybe_force_save_method_pre_order' ) );

		// Adjust the save card notice display for pre-orders.
		add_filter( $this->prefix_hook( 'save_card_notice' ), array( $this, 'change_save_card_notice_pre_order' ) );

		// Flag pre-order as completed after successful payment.
		add_action( $this->prefix_hook( 'payment_success' ), array( $this, 'maybe_flag_pre_order_as_completed' ) );
		add_filter( $this->prefix_hook( 'change_order_status' ), array( $this, 'maybe_bypass_change_status' ), 10, 2 );

		// Process pre-order payment when released (charged upon release).
		add_action( 'wc_pre_orders_process_pre_order_completion_payment_' . $this->id, array( $this, 'process_pre_order_release_payment' ), 10, 1 );

		// Hide the capture meta box for the pre-order order.
		add_filter( $this->prefix_hook( 'add_meta_boxes' ), array( $this, 'maybe_hide_capture_meta_box_pre_order' ), 10, 2 );
	}


	/**
	 * Add pre-order payment data to the payment request.
	 *
	 * @param array         $payment_data Payment data.
	 * @param WC_Order|null $order        Order object.
	 *
	 * @return array
	 */
	public function maybe_add_pre_order_payment_data( $payment_data, $order ) {
		if ( ! $this->is_order( $order ) ) {
			return $payment_data;
		}

		if ( ! $this->has_pre_order( $order->get_id() ) ) {
			return $payment_data;
		}

		// For pre-orders charged upfront, process payment normally.
		if ( ! WC_Pre_Orders_Order::order_requires_payment_tokenization( $order ) ) {
			return $payment_data;
		}

		// Use AUTHORIZE operation for pre-orders that will be charged upon release.
		$payment_data['apiOperation'] = 'AUTHORIZE';

		return $payment_data;
	}


	/**
	 * Force save payment method for pre-orders that require tokenization.
	 *
	 * @param bool $force_save Whether to force save payment method.
	 *
	 * @return bool
	 */
	public function maybe_force_save_method_pre_order( $force_save ) {
		if ( $force_save ) {
			return $force_save;
		}

		// Force save if cart contains pre-order that requires tokenization.
		if ( $this->cart_contains_pre_order_tokenization() ) {
			return true;
		}

		return $force_save;
	}


	/**
	 * Check if cart contains a pre-order product that requires tokenization.
	 *
	 * @return bool
	 */
	protected function cart_contains_pre_order_tokenization() {
		$pre_order_product = WC_Pre_Orders_Cart::get_pre_order_product();
		return $pre_order_product && WC_Pre_Orders_Product::product_is_charged_upon_release( $pre_order_product );
	}


	/**
	 * Flag pre-order as completed after successful payment.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return void
	 */
	public function maybe_flag_pre_order_as_completed( $order ) {
		if ( ! $this->has_pre_order( $order->get_id() ) ) {
			return;
		}

		if ( ! WC_Pre_Orders_Order::order_requires_payment_tokenization( $order ) ) {
			return;
		}

		WC_Pre_Orders_Order::mark_order_as_pre_ordered( $order );
	}


	/**
	 * Maybe bypass changing order status for pre-orders.
	 *
	 * @param bool     $bypass Whether to bypass changing order status.
	 * @param WC_Order $order  Order object.
	 *
	 * @return bool
	 */
	public function maybe_bypass_change_status( $bypass, $order ) {
		if ( ! $this->has_pre_order( $order->get_id() ) ) {
			return $bypass;
		}

		if ( WC_Pre_Orders_Order::order_requires_payment_tokenization( $order ) || WC_Pre_Orders_Order::order_will_be_charged_upon_release( $order ) ) {
			return false;
		}

		return $bypass;
	}


	/**
	 * Check if the order contains a pre-order.
	 *
	 * @param int $order_id Order ID.
	 *
	 * @return bool
	 */
	protected function has_pre_order( $order_id ) {
		return WC_Pre_Orders_Order::order_contains_pre_order( $order_id );
	}


	/**
	 * Process pre-order release payment (capture authorized funds).
	 *
	 * @param int $order_id Order ID.
	 *
	 * @return void
	 *
	 * @throws Exception Exception.
	 */
	public function process_pre_order_release_payment( $order_id ) {
		$order = wc_get_order( $order_id );

		if ( ! $order ) {
			$this->core_plugin->logger()->log( sprintf( 'Pre-order release: Invalid order ID %d', $order_id ), 'error' );
			return;
		}

		// Ensure this is our gateway.
		if ( $order->get_payment_method() !== $this->id ) {
			return;
		}

		// Ensure this is a pre-order.
		if ( ! WC_Pre_Orders_Order::order_contains_pre_order( $order_id ) ) {
			return;
		}

		// Check if already captured.
		if ( $order->get_meta( $this->prefix_hook( 'order_captured' ) ) ) {
			$this->core_plugin->logger()->log( sprintf( 'Pre-order %d already captured', $order_id ), 'info' );
			return;
		}

		try {
			// Get the authorized amount.
			$authorized_amount = $this->get_authorized_amount( $order );

			if ( $authorized_amount <= 0 ) {
				throw new Exception( __( 'No authorized amount found for this pre-order.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			// Capture the payment.
			$this->process_capture_payment( $order, $authorized_amount, $authorized_amount );

			// Add order note.
			$order->add_order_note(
				sprintf(
					// translators: %1$s: Gateway title, %2$s: Amount.
					__( '%1$s pre-order payment captured: %2$s', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					$this->title,
					wc_price( $authorized_amount, array( 'currency' => $order->get_currency() ) )
				)
			);

			// Mark payment complete.
			$order->payment_complete( $order->get_transaction_id() );

			$this->core_plugin->logger()->log( sprintf( 'Pre-order %d payment captured successfully', $order_id ), 'info' );

		} catch ( Exception $e ) {
			$order->update_status(
				'failed',
				sprintf(
					// translators: %s: Error message.
					__( 'Pre-order release payment failed: %s', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					$e->getMessage()
				)
			);

			$this->core_plugin->logger()->log(
				sprintf( 'Pre-order %d payment capture failed: %s', $order_id, $e->getMessage() ),
				'error'
			);
		}
	}


	/**
	 * Hide the save payment method checkbox for subscriptions.
	 *
	 * @param bool $display_tokenization Whether to display the checkbox.
	 * @return bool
	 */
	public function maybe_display_save_checkbox_pre_orders( $display_tokenization ) {
		if ( $this->cart_contains_pre_order_tokenization() ) {
			return false;
		}

		return $display_tokenization;
	}


	/**
	 * Change the save card notice for pre-orders.
	 *
	 * @param string $notice The original notice.
	 *
	 * @return string
	 */
	public function change_save_card_notice_pre_order( $notice ) {
		if ( ! $this->cart_contains_pre_order_tokenization() ) {
			return $notice;
		}

		return __( 'By providing your card information, you are allowing to charge your card for future payments.', '__PAYMENTS_CORE_TEXT_DOMAIN__' );
	}


	/**
	 * Hide the capture meta box for the pre-order order.
	 *
	 * @param bool     $add_meta_box Whether to add the meta box.
	 * @param WC_Order $order        The order object.
	 * @return bool
	 */
	public function maybe_hide_capture_meta_box_pre_order( $add_meta_box, $order ) {
		if ( $this->has_pre_order( $order->get_id() ) ) {
			return false;
		}

		return $add_meta_box;
	}
}
