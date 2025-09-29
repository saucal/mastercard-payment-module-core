<?php
/**
 * Preorder interface.
 *
 * @class       Preorder
 * @version     1.0.0
 * @package     GatewayPaymentCore/GatewayAddons/
 */

namespace GatewayPaymentCore\GatewayAddons;

use Exception;
use WC_Order;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * WooCommerce PreOrders Interface.
 */
trait Preorder {


	/**
	 * Initialize Preorder support features.
	 *
	 * @return void
	 */
	public function init_addon_preorders() {
		// Ensure the trait is used in a class that extends WC_Abstract_Payment_Gateway.
		if ( ! is_a( $this, 'GatewayPaymentCore\Gateways\WC_Abstract_Payment_Gateway' ) ) {
			return;
		}

		$this->supports = array_merge(
			$this->supports,
			array(
				'pre-orders',
			)
		);

        add_filter( $this->prefix_hook( 'process_payment_addon' ), array( $this, 'maybe_handle_pre_order_payment' ), 10, 3 );
        add_filter( $this->prefix_hook( 'process_payment_data' ), array( $this, 'maybe_handle_payment_data' ), 10, 3 );

        // Capture when merchant marks the order as completed.
		add_action( 'woocommerce_order_status_completed', array( $this, 'capture_on_order_completed' ), 10, 1 );
	}

	/**
	 * Handle payment data.
	 *
	 * @param WC_Order $order           The order object.
     * @param string   $transaction_type The transaction type.
	 *
	 * @return array|bool
	 */
	public function maybe_handle_payment_data( $payment_data, $order, $transaction_type ) {
        if ( 'pre-order' === $transaction_type ) {
            $payment_data['apiOperation'] = 'AUTHORIZE';
        }

        return $payment_data;
	}

	/**
	 * Handle subscription change payment method.
	 *
	 * @param bool     $process_payment Whether to process the payment.
	 * @param WC_Order $order           The order object.
     * @param string   $transaction_type The transaction type.
	 *
	 * @return array|bool
	 */
	public function maybe_handle_pre_order_payment( $process_payment, $order, $transaction_type ) {
        if ( $transaction_type !== 'pre-order' && $this->has_pre_order( $order->get_id() ) ) {
            return $this->process_pre_order( $order->get_id() );
        }
	}

	/**
	 * @param $order_id
	 *
	 * @return bool
	 */
	protected function has_pre_order( $order_id ) {
		return \class_exists( 'WC_Pre_Orders_Order' ) && \WC_Pre_Orders_Order::order_contains_pre_order( $order_id );
	}

	/**
	 * It process a preorder.
	 *
	 * @param $order_id
	 *
	 * @return array
	 * @throws Exception
	 */
	public function process_pre_order( $order_id ) {
		if ( \WC_Pre_Orders_Order::order_requires_payment_tokenization( $order_id ) ) {
			$response = $this->process_payment( $order_id, 'pre-order' );

			if ( 'success' === $response['result'] ) {
				// Remove from cart
				WC()->cart->empty_cart();
				// Mark order as preordered
				\WC_Pre_Orders_Order::mark_order_as_pre_ordered( $order_id );
			}

			return $response;
		}
		// Preorder charged upfront or order used "pay later" gateway
		// and now is a normal order needing payment, normal process.
		return $this->process_payment( $order_id );
	}


	/**
	 * Capture authorized funds when order is marked as completed.
	 *
	 * @param int $order_id Order ID.
	 * @return void
	 */
	public function capture_on_order_completed( $order_id ) {
		if ( ! \class_exists( 'WC_Pre_Orders_Order' ) ) {
			return;
		}

		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return;
		}

		if ( $order->get_payment_method() !== $this->id ) {
			return;
		}

		if ( ! \WC_Pre_Orders_Order::order_contains_pre_order( $order_id ) ) {
			return;
		}

		if ( $order->get_meta( $this->prefix_hook( 'order_captured' ) ) ) {
			return;
		}

		// Determine authorized amount still available to capture.
		// get_authorized_amount() returns (authorized - already captured).
		$authorized_to_capture = 0.0;
		try {
			$authorized_to_capture = (float) $this->get_authorized_amount( $order );
		} catch ( \Exception $e ) {
			// Optional: log error via your logger, but avoid breaking completion.
			$this->core_plugin->logger()->log( $e->getMessage(), 'error' );
			return;
		}

		if ( $authorized_to_capture <= 0 ) {
			return;
		}

		// Decide capture amount: capture the full remaining authorized amount or order total if you prefer.
		// Here we capture the remaining authorized amount to be safe.
		$capture_amount = $authorized_to_capture;

		try {
			// Perform capture. Third argument ($auth_amount) lets the gateway auto-INCREMENT if needed.
			$this->process_capture_payment( $order, $capture_amount, $authorized_to_capture );
		} catch ( \Exception $e ) {
			// Add a note so merchants see why completion didn’t settle the charge.
			$order->add_order_note(
				sprintf(
					/* translators: %s error message */
					__( 'Pre-Order capture on completion failed: %s', $this->core_plugin->text_domain() ),
					$e->getMessage()
				)
			);
		}
	}    
}
