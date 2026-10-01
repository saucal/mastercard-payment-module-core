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
use WC_Payment_Token;

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

		/*
		 * Pre-orders charged on release need a stored card, and in hosted
		 * checkout mode we cannot guarantee one: the payer pays on Mastercard's
		 * page, which only stores the card if they tick an optional consent box
		 * (interaction.saveCardForCredentialOnFile), and INITIATE_CHECKOUT takes
		 * no storedOnFile. In hosted session mode the server tokenizes the
		 * session itself, unconditionally. Subscriptions are excluded from hosted
		 * checkout for the same reason (init_addon_subscriptions). So never claim
		 * 'pre-orders' there.
		 *
		 * This used to also require cart_contains_pre_order_tokenization(), but it
		 * runs from build(), before the cart is loaded, so that was always false
		 * and 'pre-orders' was always claimed. The cart check is not needed:
		 * WooCommerce Pre-Orders only asks gateways for supports('pre-orders') on
		 * pre-orders charged upon release, so upfront pre-orders still get this
		 * gateway, and the hooks below only act on tokenized pre-orders anyway.
		 */
		if ( $this->is_hosted_checkout() ) {
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

		// Record the card a pre-order charged on release will be charged to,
		// whether entered now or picked from the customer's saved cards.
		add_action( 'PAYMENTS_CORE_HOOK_PREFIX_payment_method_saved', array( $this, 'maybe_store_pre_order_token' ), 10, 2 );

		// Keep a customer from removing the card a pending pre-order will be
		// charged to (see is_pre_order_token_locked()).
		add_filter( 'woocommerce_payment_methods_list_item', array( $this, 'maybe_block_pre_order_token_deletion' ), 10, 2 );
		add_action( 'woocommerce_before_account_payment_methods', array( $this, 'print_pre_order_token_notices' ) );
		add_action( 'wp', array( $this, 'maybe_refuse_pre_order_token_deletion' ), 10 );
		add_action( 'woocommerce_payment_token_deleted', array( $this, 'note_pre_orders_on_deleted_token' ), 10, 2 );

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
			// The card recorded for this pre-order (see maybe_store_pre_order_token(),
			// and the guest path in maybe_save_cards()); older orders fall back to
			// the tokens attached to the order.
			$gateway_token = $order->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_payment_token' );
			if ( ! $gateway_token ) {
				$tokens        = $order->get_payment_tokens();
				$token         = ! empty( $tokens ) ? WC_Payment_Tokens::get( reset( $tokens ) ) : null;
				$gateway_token = $token ? $token->get_token() : '';
			}
			if ( ! $gateway_token ) {
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
				$gateway_token
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


	/**
	 * Record the card a pre-order charged on release will be charged to.
	 *
	 * Fired for a card entered and saved at checkout and for one picked from the
	 * customer's saved cards. The second never reached the order before, so a
	 * customer who pre-ordered with a saved card had nothing to charge at
	 * release ("No stored card found for this pre-order").
	 *
	 * @param WC_Order $order    Order object.
	 * @param int      $token_id Saved card (payment token) id.
	 *
	 * @return void
	 */
	public function maybe_store_pre_order_token( $order, $token_id ) {
		// Not is_pre_order_charged_on_release(): Pre-Orders' "requires
		// tokenization" turns false as soon as the order has a payment token,
		// and the gateway attaches the card just before this fires.
		if ( ! $this->is_order( $order ) || ! $this->has_pre_order( $order->get_id() ) || ! WC_Pre_Orders_Order::order_will_be_charged_upon_release( $order ) ) {
			return;
		}

		$token = WC_Payment_Tokens::get( $token_id );
		if ( ! $token || $token->get_gateway_id() !== $this->id ) {
			return;
		}

		$order->update_meta_data( 'PAYMENTS_CORE_HOOK_PREFIX_payment_token', $token->get_token() );
		$order->save_meta_data();
	}


	/**
	 * The customer's pending pre-orders that will be charged to this card.
	 *
	 * @param WC_Payment_Token $token Saved card.
	 *
	 * @return WC_Order[]
	 */
	protected function pre_orders_using_token( $token ) {
		if ( ! $token instanceof WC_Payment_Token || $token->get_gateway_id() !== $this->id || ! $token->get_user_id() ) {
			return array();
		}

		$orders = wc_get_orders(
			array(
				'customer_id'    => $token->get_user_id(),
				'payment_method' => $this->id,
				'status'         => array( 'pre-ordered' ),
				'limit'          => -1,
			)
		);

		return array_values(
			array_filter(
				$orders,
				function ( $order ) use ( $token ) {
					return $order->get_meta( 'PAYMENTS_CORE_HOOK_PREFIX_payment_token' ) === $token->get_token()
						&& WC_Pre_Orders_Order::order_will_be_charged_upon_release( $order );
				}
			)
		);
	}


	/**
	 * Whether a pending pre-order will be charged to this card.
	 *
	 * Such a card cannot be swapped for another one, even when the customer has
	 * one: the gateway binds an agreement to the card of its last
	 * cardholder-initiated payment, and refuses a merchant-initiated charge on
	 * any other card ("The card number provided for this merchant-initiated
	 * transaction does not match the card number used for the last
	 * customer-initiated transaction in this series of payments"). Pre-Orders
	 * has no flow for the customer to re-authorize with a new card, so the card
	 * stays until the pre-order is released or cancelled.
	 *
	 * @param WC_Payment_Token $token Saved card.
	 *
	 * @return bool
	 */
	protected function is_pre_order_token_locked( $token ) {
		return ! empty( $this->pre_orders_using_token( $token ) );
	}


	/**
	 * Remove the Delete action from a saved card a pending pre-order depends on.
	 *
	 * @param array            $item  Payment method list item.
	 * @param WC_Payment_Token $token Saved card.
	 *
	 * @return array
	 */
	public function maybe_block_pre_order_token_deletion( $item, $token ) {
		if ( isset( $item['actions']['delete'] ) && $this->is_pre_order_token_locked( $token ) ) {
			unset( $item['actions']['delete'] );
		}

		return $item;
	}


	/**
	 * Explain on My Account > Payment methods why a card cannot be removed.
	 *
	 * @return void
	 */
	public function print_pre_order_token_notices() {
		if ( ! is_user_logged_in() ) {
			return;
		}

		foreach ( WC_Payment_Tokens::get_customer_tokens( get_current_user_id(), $this->id ) as $token ) {
			if ( ! $this->is_pre_order_token_locked( $token ) ) {
				continue;
			}

			$order_numbers = array_map(
				function ( $order ) {
					return '#' . $order->get_order_number();
				},
				$this->pre_orders_using_token( $token )
			);

			wc_print_notice(
				sprintf(
					// translators: 1: card label, 2: pre-order numbers.
					__( '%1$s will be charged for your pre-order %2$s when it is released, so it cannot be removed until the pre-order is released or cancelled.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					$token->get_display_name(),
					implode( ', ', $order_numbers )
				),
				'notice'
			);
		}
	}


	/**
	 * Refuse a direct delete request for a card a pending pre-order depends on.
	 *
	 * Runs before WooCommerce handles the delete-payment-method endpoint (its
	 * handler is on 'wp' at priority 20), so a crafted request cannot get round
	 * the hidden button.
	 *
	 * @return void
	 */
	public function maybe_refuse_pre_order_token_deletion() {
		global $wp;

		if ( ! isset( $wp->query_vars['delete-payment-method'] ) ) {
			return;
		}

		$token = WC_Payment_Tokens::get( absint( $wp->query_vars['delete-payment-method'] ) );
		if ( ! $token || $token->get_user_id() !== get_current_user_id() || ! $this->is_pre_order_token_locked( $token ) ) {
			return;
		}

		wc_add_notice( __( 'This card will be charged for a pending pre-order, so it cannot be removed until the pre-order is released or cancelled.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ), 'error' );
		wp_safe_redirect( wc_get_account_endpoint_url( 'payment-methods' ) );
		exit;
	}


	/**
	 * Note on a pending pre-order when the card it will be charged to is removed
	 * anyway (customers cannot; an admin can). The release will fail: the
	 * gateway only accepts the card of the agreement's last cardholder-initiated
	 * payment, so the pre-order cannot be moved to another card.
	 *
	 * @param int              $token_id Deleted card id.
	 * @param WC_Payment_Token $token    Deleted card.
	 *
	 * @return void
	 */
	public function note_pre_orders_on_deleted_token( $token_id, $token ) {
		foreach ( $this->pre_orders_using_token( $token ) as $order ) {
			$order->add_order_note(
				sprintf(
					// translators: %s: removed card label.
					__( '%s, the card this pre-order is to be charged to on release, was removed. The release charge will fail.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					$token->get_display_name()
				)
			);
		}
	}
}
