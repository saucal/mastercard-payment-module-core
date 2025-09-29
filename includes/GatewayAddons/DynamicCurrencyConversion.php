<?php
/**
 * Subscriptions interface.
 *
 * @class   Subscriptions
 * @version 1.0.0
 * @package GatewayPaymentCore/GatewayAddons/
 */

namespace GatewayPaymentCore\GatewayAddons;

use GatewayPaymentCore\Utils;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Dynamic Currency Conversion Interface.
 */
trait DynamicCurrencyConversion {



	/**
	 * Initialize Subscription support features.
	 *
	 * @return void
	 */
	public function init_addon_dcc() {
		// Ensure the trait is used in a class that extends WC_Abstract_Payment_Gateway.
		if ( ! is_a( $this, 'GatewayPaymentCore\Gateways\WC_Abstract_Payment_Gateway' ) ) {
			return;
		}

		if ( $this->is_hosted_checkout() ) {
			return; // DCC is automatically supported in hosted checkout mode.
		}

		add_action( $this->prefix_hook( 'hosted_session_created' ), array( $this, 'clean_cached_total' ) );

		add_filter( 'woocommerce_update_order_review_fragments', array( $this, 'relocalize_cart_total' ) );

		// Add DCC data to the payment data.
		add_filter( $this->prefix_hook( 'process_payment_hosted_session_data' ), array( $this, 'maybe_add_dcc_payment_data' ), 10, 2 );
		add_filter( $this->prefix_hook( 'process_payment_hosted_session_3ds_data' ), array( $this, 'maybe_add_dcc_payment_data' ), 10, 2 );

		// Process DCC when the payment is processed.
		add_action( $this->prefix_hook( 'payment_success' ), array( $this, 'process_dcc_data' ), 10, 3 );
	}


	/**
	 * Relocalize cart total when DCC is enabled.
	 *
	 * @param  array $fragments Fragments to update via AJAX.
	 * @return array
	 */
	public function relocalize_cart_total( $fragments ) {
		$this->maybe_update_hosted_session();
		return $fragments;
	}


	/**
	 * Update the order amount and currency in the hosted session if needed.
	 *
	 * @return void
	 */
	public function maybe_update_hosted_session() {
		if ( ! WC()->cart || empty( WC()->session ) ) {
			return;
		}

		$current_session = $this->current_hosted_session_id();
		if ( ! $current_session ) {
			return;
		}

		$session_key = $this->prefix_hook( 'session_total_' . $current_session );

		$session_total = WC()->session->get( $session_key );
		$current_total = Utils::get_current_total_amount();

		if ( $current_total === $session_total ) {
			return; // No need to update the session.
		}

		$payload = array(
			'apiOperation' => 'UPDATE_SESSION',
			'order'        => array(
				'amount'   => $current_total,
				'currency' => get_woocommerce_currency(),
			),
		);

		try {
			$this->api()->update_session( $current_session, $payload );

			WC()->session->set( $session_key, $current_total );
		} catch ( \Exception $e ) {
			$this->log( 'Failed to update hosted session: ' . $e->getMessage(), 'error' );
		}
	}


	/**
	 * Add DCC payment data to the hosted session payment data if available.
	 *
	 * @param  array     $payment_data Existing payment data.
	 * @param  \WC_Order $order        Order object.
	 *
	 * @return array
	 */
	public function maybe_add_dcc_payment_data( $payment_data, $order ) {

		if ( empty( $_POST[ $this->id . '_dcc_request_id' ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return $payment_data;
		}

		$dcc_request_id = wc_clean( wp_unslash( $_POST[ $this->id . '_dcc_request_id' ] ) ); // phpcs:ignore WordPress.Security.NonceVerification

		// Assume the offer was rejected if no offer state is provided.
		$offer_state = isset( $_POST['dccOfferState'] ) ? wc_clean( wp_unslash( $_POST['dccOfferState'] ) ) : 'Reject'; // phpcs:ignore WordPress.Security.NonceVerification

		$payment_data['currencyConversion'] = array(
			'requestId' => $dcc_request_id,
			'uptake'    => 'Accept' === $offer_state ? 'ACCEPTED' : 'REJECTED',
		);

		return $payment_data;
	}


	/**
	 * Process DCC data after a successful payment.
	 *
	 * @param \WC_Order $order       Order object.
	 * @param array     $order_data  Order data.
	 * @param array     $transaction Transaction data.
	 *
	 * @return void
	 */
	public function process_dcc_data( $order, $order_data, $transaction ) {
		if ( empty( $order_data['currencyConversion']['uptake'] ) || 'ACCEPTED' !== $order_data['currencyConversion']['uptake'] ) {
			return;
		}

		if ( empty( $order_data['currencyConversion']['payerExchangeRate'] ) || empty( $order_data['currencyConversion']['payerCurrency'] ) || empty( $order_data['currencyConversion']['payerAmount'] ) ) {
			return;
		}

		$order->update_meta_data( $this->prefix_hook( 'dcc_request_id' ), $order_data['currencyConversion']['requestId'] );
		$order->update_meta_data( $this->prefix_hook( 'dcc_exchange_rate' ), $order_data['currencyConversion']['payerExchangeRate'] );
		$order->update_meta_data( $this->prefix_hook( 'dcc_currency' ), $order_data['currencyConversion']['payerCurrency'] );
		$order->update_meta_data( $this->prefix_hook( 'dcc_amount' ), $order_data['currencyConversion']['payerAmount'] );
		$order->save_meta_data();
	}


	/**
	 * Clean cached total when a new hosted session is created.
	 *
	 * @param string $session_id Hosted session ID.
	 * @return void
	 */
	public function clean_cached_total( $session_id ) {
		if ( ! WC()->session ) {
			return;
		}

		$session_key = $this->prefix_hook( 'session_total_' . $session_id );
		WC()->session->__unset( $session_key );
	}
}
