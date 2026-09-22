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
use WC_Payment_Tokens;

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
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_data', array( $this, 'maybe_add_pre_order_payment_data' ), 10, 2 );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_hosted_session_data', array( $this, 'maybe_add_pre_order_payment_data' ), 10, 2 );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_hosted_session_3ds_data', array( $this, 'maybe_add_pre_order_authentication_initiate_data' ), 10, 2 );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_process_payment_hosted_session_3ds_authenticate_payer_data', array( $this, 'maybe_add_pre_order_authentication_data' ), 10, 2 );

		// Verified at checkout, paid at release: do not record the payment yet.
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_verification_completes_payment', array( $this, 'maybe_defer_pre_order_payment' ), 10, 2 );

		// Hide the save payment method checkbox for subscriptions.
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_display_save_payment_method_checkbox', array( $this, 'maybe_display_save_checkbox_pre_orders' ) );

		// Force save payment method for pre-orders that require tokenization.
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_forced_save_payment_method', array( $this, 'maybe_force_save_method_pre_order' ) );

		// Adjust the save card notice display for pre-orders.
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_save_card_notice', array( $this, 'change_save_card_notice_pre_order' ) );

		// Flag pre-order as completed after successful payment.
		add_action( 'PAYMENTS_CORE_HOOK_PREFIX_payment_success', array( $this, 'maybe_flag_pre_order_as_completed' ) );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_change_order_status', array( $this, 'maybe_bypass_change_status' ), 10, 2 );

		// Process pre-order payment when released (charged upon release).
		add_action( 'wc_pre_orders_process_pre_order_completion_payment_' . $this->id, array( $this, 'process_pre_order_release_payment' ), 10, 1 );

		// Hide the capture meta box for the pre-order order.
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_add_meta_boxes', array( $this, 'maybe_hide_capture_meta_box_pre_order' ), 10, 2 );
	}


	/**
	 * Store the card and establish an agreement for a pre-order charged on release.
	 *
	 * Nothing is taken at checkout. This used to AUTHORIZE the full amount and
	 * CAPTURE it at release, which fails once the authorization expires, and
	 * releases are routinely weeks or months away. Mastercard Gateway Support:
	 * "If an Authorization expires you will no longer be able to Capture it... it
	 * may be best to use MIT with the agreement.id".
	 *
	 * So the checkout is a cardholder-initiated VERIFY that opens an UNSCHEDULED
	 * agreement, and the release is a merchant-initiated PAY under it - see
	 * process_pre_order_release_payment(). storedOnFile TO_BE_STORED is left to
	 * the base gateway: saving is forced for these carts, and the base sets the
	 * flag after this filter runs, so anything set here would be overwritten.
	 *
	 * A pre-order charged upfront is an ordinary payment and is left alone.
	 *
	 * @param array         $payment_data Payment data.
	 * @param WC_Order|null $order        Order object.
	 *
	 * @return array
	 */
	public function maybe_add_pre_order_payment_data( $payment_data, $order ) {
		if ( ! $this->is_pre_order_charged_on_release( $order ) ) {
			return $payment_data;
		}

		$payment_data['apiOperation'] = 'VERIFY';
		$payment_data['agreement']    = $this->pre_order_agreement( $order );

		return $payment_data;
	}


	/**
	 * Authenticate the payer for adding a card rather than for a payment.
	 *
	 * @param array         $init_authentication INITIATE_AUTHENTICATION data.
	 * @param WC_Order|null $order               Order object.
	 *
	 * @return array
	 */
	public function maybe_add_pre_order_authentication_initiate_data( $init_authentication, $order ) {
		if ( $this->is_pre_order_charged_on_release( $order ) ) {
			$init_authentication['authentication']['purpose'] = 'ADD_CARD';
		}

		return $init_authentication;
	}


	/**
	 * Carry the agreement into AUTHENTICATE_PAYER, which is where it is
	 * established.
	 *
	 * Unlike a RECURRING agreement, an UNSCHEDULED one needs no expiryDate and no
	 * minimumDaysBetweenPayments here: the gateway's "must provide recurring
	 * expiry and recurring frequency" check is scoped to recurring and
	 * installment agreements, and does not fire for UNSCHEDULED. The order amount
	 * stays as it is - AUTHENTICATE_PAYER rejects a zero amount.
	 *
	 * @param array         $payment_data AUTHENTICATE_PAYER data.
	 * @param WC_Order|null $order        Order object.
	 *
	 * @return array
	 */
	public function maybe_add_pre_order_authentication_data( $payment_data, $order ) {
		if ( $this->is_pre_order_charged_on_release( $order ) ) {
			$payment_data['agreement'] = $this->pre_order_agreement( $order );
		}

		return $payment_data;
	}


	/**
	 * Do not mark a pre-order charged on release as paid when its card is
	 * verified. WC_Pre_Orders_Order::mark_order_as_pre_ordered() takes over from
	 * here, via the payment_success action.
	 *
	 * @param bool     $complete Whether the verification completes the payment.
	 * @param WC_Order $order    Order object.
	 *
	 * @return bool
	 */
	public function maybe_defer_pre_order_payment( $complete, $order ) {
		return $this->is_pre_order_charged_on_release( $order ) ? false : $complete;
	}


	/**
	 * Whether the order is a pre-order that is charged on release and still
	 * needs its card taken.
	 *
	 * order_requires_payment_tokenization() turns false once
	 * mark_order_as_pre_ordered() has recorded the token, so this is only true
	 * during the checkout that establishes the agreement - never at release.
	 *
	 * @param WC_Order|null $order Order object.
	 *
	 * @return bool
	 */
	protected function is_pre_order_charged_on_release( $order ) {
		return $this->is_order( $order )
			&& $this->has_pre_order( $order->get_id() )
			&& WC_Pre_Orders_Order::order_requires_payment_tokenization( $order );
	}


	/**
	 * The agreement a pre-order is charged under. Derived from the order, so
	 * nothing needs storing to rebuild it at release.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return array
	 */
	protected function pre_order_agreement( $order ) {
		return array(
			'id'   => 'PAYMENTS_CORE_HOOK_PREFIX_pre-order-' . $order->get_id(),
			'type' => 'UNSCHEDULED',
		);
	}


	/**
	 * The gateway order the release is charged under.
	 *
	 * A subscription renewal gets a new gateway order for free, because
	 * WooCommerce creates a new WC order for it. A pre-order release charges the
	 * same WC order, and unique_order_id() is derived from it, so reusing that
	 * would put the charge on the gateway order the checkout VERIFY already
	 * created - where the Credential on File guide requires a delayed charge be
	 * "submitted as a new order". Created once and stored, so a retried release
	 * charges the same gateway order.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return string
	 */
	protected function pre_order_release_order_id( $order ) {
		$release_order_id = $order->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_release_order_id' );

		if ( ! $release_order_id ) {
			$release_order_id = $order->get_id() . '-release-' . substr( md5( get_site_url() . '-' . $order->get_id() . '-' . wp_generate_password( 12, false ) ), 0, 12 );
			$order->update_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_release_order_id', $release_order_id );
			$order->save_meta_data();
		}

		return $release_order_id;
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
	 * Charge a pre-order on release, as a merchant-initiated payment.
	 *
	 * Fired by WC_Pre_Orders_Manager::complete_pre_order() with the order - an
	 * object, not an ID, despite what this used to be typed as. An ID is still
	 * accepted.
	 *
	 * @param WC_Order|int $order Order.
	 *
	 * @return void
	 */
	public function process_pre_order_release_payment( $order ) {
		$order = wc_get_order( $order );

		if ( ! $order ) {
			$this->core_plugin->logger()->log( 'Pre-order release: invalid order', 'error' );
			return;
		}

		if ( $order->get_payment_method() !== $this->id || ! WC_Pre_Orders_Order::order_contains_pre_order( $order->get_id() ) ) {
			return;
		}

		if ( $order->is_paid() ) {
			$this->core_plugin->logger()->log( sprintf( 'Pre-order %d already paid', $order->get_id() ), 'info' );
			return;
		}

		try {
			$tokens = $order->get_payment_tokens();
			$token  = ! empty( $tokens ) ? WC_Payment_Tokens::get( reset( $tokens ) ) : null;
			if ( ! $token ) {
				throw new Exception( __( 'No stored card found for this pre-order.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ) );
			}

			// Read the checkout's gateway order before charging: processing the
			// release overwrites the order's gateway order id with the new one.
			$reference_order_id = $this->unique_order_id( $order );

			$this->create_merchant_initiated_payment(
				$order,
				$this->pre_order_release_order_id( $order ),
				$this->pre_order_agreement( $order ),
				$reference_order_id,
				$token->get_token()
			);
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
				sprintf( 'Pre-order %d release payment failed: %s', $order->get_id(), $e->getMessage() ),
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
