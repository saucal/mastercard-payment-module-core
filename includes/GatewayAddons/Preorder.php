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
		add_action( 'wc_pre_orders_process_pre_order_completion_payment_' . $this->id, array( $this, 'capture_on_order_completed' ), 10, 1 );

		// --- FORCE SAVE CARD (pay-later only) ---
		add_filter( 'wc_' . $this->id . '_display_save_payment_method_checkbox', array( $this, 'maybe_display_save_checkbox_for_preorder' ), 10, 1 );
		add_filter( $this->prefix_hook( 'forced_save_payment_method' ), array( $this, 'force_save_card_for_preorder' ), 10, 1 );
		add_filter( $this->prefix_hook( 'add_payment_method_data' ), array( $this, 'inject_blocks_preorder_flags' ), 10, 1 );		
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
		if($transaction_type === 'pre-order'){
			return;
		}

		if ( $this->has_pre_order( $order->get_id() ) && \WC_Pre_Orders_Order::order_requires_payment_tokenization( $order->get_id() ) ) {
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
		$response = $this->process_payment( $order_id, 'pre-order' );

		if ( 'success' === $response['result'] ) {
			// Remove from cart
			WC()->cart->empty_cart();
			// Mark order as preordered
			\WC_Pre_Orders_Order::mark_order_as_pre_ordered( $order_id );
		}

		return $response;
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

		if ( ! \WC_Pre_Orders_Order::order_requires_payment_tokenization( $order_id ) ) {
			return;
		}		

		if ( $order->get_meta( $this->prefix_hook( 'order_captured' ) ) ) {
			return;
		}

		$authorized_to_capture = 0.0;
		try {
			$authorized_to_capture = (float) $this->get_authorized_amount( $order );
		} catch ( \Exception $e ) {
			$this->core_plugin->logger()->log( $e->getMessage(), 'error' );
			return;
		}

		if ( $authorized_to_capture <= 0 ) {
			return;
		}

		$capture_amount = $authorized_to_capture;

		try {
			$this->process_capture_payment( $order, $capture_amount, $authorized_to_capture );
		} catch ( \Exception $e ) {
			$order->add_order_note(
				sprintf(
					__( 'Pre-Order capture on completion failed: %s', $this->core_plugin->text_domain() ),
					$e->getMessage()
				)
			);
		}
	}    


	/**
	 * Display the "save card" checkbox when order is a pay-later pre-order.
	 *
	 * @param bool $display Default display value.
	 * @return bool
	 */
	public function maybe_display_save_checkbox_for_preorder( $display ) {
		if ( class_exists( 'WC_Pre_Orders_Cart' ) && \WC_Pre_Orders_Cart::cart_contains_pre_order() ) {
			foreach ( WC()->cart->get_cart() as $item ) {
				$product = isset( $item['data'] ) && $item['data'] instanceof \WC_Product
					? $item['data']
					: wc_get_product( $item['product_id'] );

				if ( ! $product ) {
					continue;
				}

				if (
					\WC_Pre_Orders_Product::product_can_be_pre_ordered( $product ) &&
					\WC_Pre_Orders_Product::product_is_charged_upon_release( $product )
				) {
					return false;
				}
			}
		}

		return $display;
	}


    /**
	 * Force backend to save card when it's a pay-later pre-order.
	 *
	 * @param bool $force_save Current flag.
	 * @return bool
	 */
	public function force_save_card_for_preorder( $force_save ) {
		$order = \GatewayPaymentCore\Utils::get_current_order();

		if ( ! $order || $this->maybe_display_save_checkbox_for_preorder( true ) ) {
			return $force_save;
		}

		// Pay-later -> must save card; Pay-now -> do not force.
		return \WC_Pre_Orders_Order::order_requires_payment_tokenization( $order->get_id() ) ? true : $force_save;
	}

	/**
	 * Add helpful flags for Checkout Blocks/front-end integration.
	 *
	 * @param array $data Existing payload.
	 * @return array
	 */
	public function inject_blocks_preorder_flags( $data ) {
		$order = \GatewayPaymentCore\Utils::get_current_order();

		$is_preorder   = (bool) ( $order && $this->has_pre_order( $order->get_id() ) );
		$is_pay_later  = (bool) ( $is_preorder && \WC_Pre_Orders_Order::order_requires_payment_tokenization( $order->get_id() ) );

		$data['isPreOrder']               = $is_preorder;
		$data['isPreOrderPayLater']       = $is_pay_later;
		$data['requiresTokenization']     = $is_pay_later; // UI can hide checkbox.
		$data['shouldSavePaymentMethod']  = $is_pay_later; // Mirror backend force-save.

		return $data;
	}

}
