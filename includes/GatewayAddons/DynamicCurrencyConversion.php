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
	}


	/**
	 * Relocalize cart total when DCC is enabled.
	 *
	 * @param  array $fragments Fragments to update via AJAX.
	 * @return array
	 */
	public function relocalize_cart_total( $fragments ) {

		if ( ! WC()->cart ) {
			return $fragments;
		}

		$this->maybe_update_hosted_session();

		$fragments[ $this->prefix_hook( 'cart_data' ) ] = wp_json_encode(
			array(
				'total'    => Utils::get_current_total_amount(),
				'currency' => get_woocommerce_currency(),
			)
		);

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
