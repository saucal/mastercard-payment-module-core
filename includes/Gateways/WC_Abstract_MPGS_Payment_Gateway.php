<?php
/**
 * Abstract Payment Gateway class.
 *
 * @class       AbstractPaymentGateway
 * @version     1.0.0
 * @package     MPGSCore/Gateways/
 */

namespace MPGSCore\Gateways;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

use MPGSCore\MpgsAPI;
use MPGSCore\MpgsPlugin;
use MPGSCore\Utils;
use WC_Payment_Gateway_CC;

/**
 * Show the payment form for Mastercard Payment Gateway.
 */
class WC_Abstract_MPGS_Payment_Gateway extends WC_Payment_Gateway_CC {


	/**
	 * Plugin instance.
	 *
	 * @var MpgsPlugin
	 */
	protected $mpgs_plugin;


	/**
	 * MPGS API instance.
	 *
	 * @var MpgsAPI
	 */
	protected $mpgs_api;


	/**
	 * Partner solution ID.
	 *
	 * @var string
	 */
	protected $partner_solution_id;


	/**
	 * Get the partner solution ID.
	 *
	 * @return string
	 */
	public function get_partner_solution_id() {
		return $this->partner_solution_id;
	}


	/**
	 * Is gateway enabled.
	 *
	 * @var bool
	 */
	public function is_enabled() {
		return 'yes' === $this->get_option( 'enabled' );
	}


	/**
	 * Is gateway available.
	 *
	 * @return bool
	 */
	public function is_available() {
		if ( ! parent::is_available() ) {
			return false;
		}

		if ( empty( $this->mpgs_plugin ) ) {
			return false;
		}

		if ( empty( $this->mpgs_api() ) ) {
			return false;
		}

		return true;
	}


	/**
	 * Get the MPGS Plugin instance.
	 *
	 * @return MpgsPlugin
	 */
	public function mpgs_plugin() {
		return $this->mpgs_plugin;
	}


	/**
	 * Prefix hook.
	 *
	 * @param string $hook   Hook name.
	 * @param string $prefix Prefix.
	 *
	 * @return string
	 */
	public function prefix_hook( $hook, $prefix = '' ) {
		return $this->mpgs_plugin->mpgs_core()->prefix_hook( $hook, $prefix );
	}


	/**
	 * Get the MPGS API instance.
	 *
	 * @return MpgsAPI
	 */
	public function mpgs_api() {
		if ( ! $this->mpgs_api ) {
			$this->mpgs_api = new MpgsAPI( $this->mpgs_plugin );
		}

		return $this->mpgs_api;
	}


	/**
	 * Get base order payload.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return array
	 */
	protected function base_order_payload( $order ) {
		return array(
			'reference'       => $order->get_id(),
			'currency'        => get_woocommerce_currency(),
			'amount'          => $order->get_total(),
			'description'     => $this->mpgs_plugin->get_gateway_setting( 'merchant_name' ),
			'notificationUrl' => add_query_arg(
				array(
					'wc-api'   => $this->prefix_hook( 'wc-webhook' ),
					'order-id' => $order->get_id(),
					'nonce'    => wp_create_nonce( $this->prefix_hook( 'webhook-nonce' ) ),
				),
				trailingslashit( get_home_url() )
			),
		);
	}


	/**
	 * Maybe add customer data to the payload.
	 *
	 * @param array    $payload Payload.
	 * @param WC_Order $order Order.
	 *
	 * @return array
	 */
	protected function maybe_add_customer_data( $payload, $order ) {
		$formatted_billing_info = Utils::get_formatted_info_billing( $order );
		if ( ! empty( $formatted_billing_info ) ) {
			$payload['billing'] = $formatted_billing_info;
		}

		$formatted_shipping_info = Utils::get_formatted_info_shipping( $order );
		if ( ! empty( $formatted_shipping_info ) ) {
			$payload['shipping'] = $formatted_shipping_info;
		}

		$formatted_customer_info = Utils::get_formatted_info_customer( $order );
		if ( ! $this->mpgs_plugin->is_sandbox() && ! empty( $formatted_customer_info ) ) {
			$payload['customer'] = $formatted_customer_info;
		}

		return $payload;
	}


	/**
	 * Get the unique order ID.
	 *
	 * @param WC_Order $order Order.
	 *
	 * @return string
	 */
	protected function unique_order_id( $order ) {
		return $order->get_id() . '-' . md5( get_site_url() . '-' . $order->get_cart_hash() );
	}


	/**
	 * Get unique transaction ID.
	 *
	 * @param WC_Order $order Order.
	 *
	 * @return string
	 */
	protected function unique_transaction_id( $order ) {

		$last_transaction_id = $order->get_meta( $this->prefix_hook( 'transaction_attempt' ), true );

		if ( ! $last_transaction_id ) {
			$last_transaction_id = 1;
		}

		$order->update_meta_data( $this->prefix_hook( 'transaction_attempt' ), $last_transaction_id + 1 );
		$order->save();

		return $this->unique_order_id( $order ) . '-' . ( $last_transaction_id + 1 );
	}


	/**
	 * Set order status and add an order notice with the error message as presented to the customer.
	 *
	 * @param WP_Error      $error_message Error message.
	 * @param WC_Order|null $order         Order.
	 *
	 * @return void
	 */
	public function handle_failed_payment( $error_message, $order = null ) {

		if ( ! $order ) {
			return;
		}

		$order_note = __( 'Error processing payment. Reason: ', $this->mpgs_plugin->text_domain() ) . $error_message->getMessage();

		if ( ! $order->has_status( 'failed' ) ) {
			$order->update_status( 'failed', $order_note );
		} else {
			$order->add_order_note( $order_note );
		}
	}


	/**
	 * Get mapped error code.
	 *
	 * @param string $error_code Error code.
	 *
	 * @return string
	 */
	public function get_mapped_error_code( $error_code ) {

		switch ( $error_code ) {
			case 'DECLINED':
				return __( 'Payment unsuccessful; your card has been declined.', $this->mpgs_plugin->text_domain() );
			case 'EXPIRED_CARD':
				return __( 'The card has expired. Please enter a new card for payment.', $this->mpgs_plugin->text_domain() );
			case 'TIMED_OUT':
				return __( 'We couldn\'t process your card request within the allotted time, and it timed out.', $this->mpgs_plugin->text_domain() );
			case 'ACQUIRER_SYSTEM_ERROR':
				return __( 'The transaction was disrupted due to an issue in the acquirer\'s system.', $this->mpgs_plugin->text_domain() );
			case 'UNSPECIFIED_FAILURE':
				return __( 'An unspecified issue has occurred with your card. Please check the details and try again.', $this->mpgs_plugin->text_domain() );
			case 'EXPIRED_CARD':
				return __( 'The card not authorized. Please enter a new card for payment.', $this->mpgs_plugin->text_domain() );
			default:
				return __( 'The payment was declined.', $this->mpgs_plugin->text_domain() );
		}
	}
}
