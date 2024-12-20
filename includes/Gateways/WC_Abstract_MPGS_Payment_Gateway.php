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

use Exception;
use MPGSCore\MpgsAPI;
use MPGSCore\MpgsPlugin;
use MPGSCore\PaymentToken;
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
	 * Payment Token instance.
	 *
	 * @var PaymentToken
	 */
	protected $payment_token;


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
	 * Get the Payment Token instance.
	 *
	 * @return PaymentToken
	 */
	public function payment_token() {
		if ( ! $this->payment_token ) {
			$this->payment_token = new PaymentToken( $this );
		}

		return $this->payment_token;
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
		$unique_order_id = $order->get_meta( $this->prefix_hook( 'order_id' ) );

		if ( $unique_order_id ) {
			return $unique_order_id;
		}

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


	/**
	 * Maybe flag the order as paid.
	 *
	 * @param WC_Order $order    Order object.
	 * @param bool     $redirect Wether to forcefully redirect the user or not.
	 *
	 * @return bool
	 */
	protected function maybe_flag_order_as_paid( $order, $redirect = true ) {
		try {
			if ( ! $order || ! is_a( $order, 'WC_Order' ) ) {
				return false;
			}

			if ( $order->get_meta( $this->prefix_hook( 'order_captured' ) ) ) {
				return true;
			}

			$unique_order_id = $order->get_meta( $this->prefix_hook( 'order_id' ) );
			if ( ! $unique_order_id ) {
				$unique_order_id = $this->unique_order_id( $order );
			}

			$order_data = $this->mpgs_api()->retrieve_order( $unique_order_id );

			$this->validate_payment_status( $order, $order_data );

			$transaction_data = ! empty( $order_data['body']['transaction'] ) ? $this->get_approved_transaction( $order_data['body']['transaction'] ) : array();

			$this->process_wc_order( $order, $order_data['body'], $transaction_data );

			if ( ! $order->get_meta( $this->prefix_hook( 'order_captured' ) ) ) {
				return false;
			}

			if ( $redirect ) {
				wp_safe_redirect( $this->get_return_url( $order ) );
				exit();
			}

			return true;
		} catch ( Exception $e ) {
			return false;
		}
	}


	/**
	 * This function processes a WooCommerce order.
	 *
	 * @param object $order       The WooCommerce order object.
	 * @param array  $order_data  Order data retrieved from the API.
	 * @param array  $transaction Transaction data retrieved from the API.
	 *
	 * @return void
	 *
	 * @throws Exception Exception.
	 */
	protected function process_wc_order( $order, $order_data, $transaction ) {

		if ( ! $order || ! is_a( $order, 'WC_Order' ) ) {
			throw new Exception( __( 'The order object is not valid.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( ! isset( $order_data['status'] ) || ! isset( $order_data['id'] ) ) {
			throw new Exception( __( 'The order data is not valid.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( empty( $transaction['id'] ) ) {
			throw new Exception( __( 'The transaction data is not valid.', $this->mpgs_plugin->text_domain() ) );
		}

		$order->add_meta_data( $this->prefix_hook( 'order_captured' ), 'CAPTURED' === $order_data['status'] );
		$order->add_meta_data( $this->prefix_hook( 'order_id' ), $order_data['id'] );
		$order->add_meta_data( $this->prefix_hook( 'transaction_id' ), $transaction['id'] );

		switch ( $order_data['status'] ) {
			case 'CAPTURED':
				$order->payment_complete( $order_data['id'] );
				$order->add_order_note(
					sprintf(
						// translators: %1$s: Gateway title, %2$s: Transaction ID.
						__( '%1$s payment was Captured (ID: %2$s)', $this->mpgs_plugin->text_domain() ),
						$this->title,
						$transaction['id'],
					)
				);
				break;
			case 'AUTHORIZED':
				$order->add_order_note(
					sprintf(
						// translators: %1$s: Gateway title, %2$s: Transaction ID.
						__( '%1$s payment was Authorized (ID: %2$s)', $this->mpgs_plugin->text_domain() ),
						$this->title,
						$transaction['id'],
					)
				);
				$order->update_status( 'on-hold', __( 'Payment authorized, waiting for capture.', $this->mpgs_plugin->text_domain() ) );
				break;
			case 'PARTIALLY_CAPTURED':
				$order->add_order_note(
					sprintf(
						// translators: %1$s: Gateway title, %2$s: Transaction ID.
						__( '%1$s payment was Partially Captured (ID: %2$s). Captured Amount: %3$s', $this->mpgs_plugin->text_domain() ),
						$this->title,
						$transaction['id'],
						wc_price( $transaction['amount'], array( 'currency' => $transaction['currency'] ) )
					)
				);
				$order->update_status( 'on-hold', __( 'Payment partially captured, waiting for full capture.', $this->mpgs_plugin->text_domain() ) );
				break;
		}
	}


	/**
	 * Validate if the order was paid agains the API.
	 *
	 * @param WC_Order $order      Order object.
	 * @param array    $order_data Order data.
	 *
	 * @return void
	 * @throws Exception Exception.
	 */
	protected function validate_payment_status( $order, $order_data = array() ) {

		if ( ! $order || ! is_a( $order, 'WC_Order' ) ) {
			throw new Exception( __( 'The order object is not valid.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( empty( $order_data ) ) {
			$order_data = $this->mpgs_api()->retrieve_order( $this->unique_order_id( $order ) );
		}

		if ( ! $order_data['success'] || empty( $order_data['body'] ) || empty( $order_data['body']['result'] ) ) {
			throw new Exception( __( 'Failed to retrieve the order.', $this->mpgs_plugin->text_domain() ) );
		}

		if ( 'SUCCESS' !== $order_data['body']['result'] ) {
			throw new Exception( 'Payment was declined.', $this->mpgs_plugin->text_domain() );
		}

		if ( empty( $order_data['body']['transaction'] ) || ! is_array( $order_data['body']['transaction'] ) ) {
			throw new Exception( __( 'The transaction data is not valid.', $this->mpgs_plugin->text_domain() ) );
		}
	}


	/**
	 * Get approved transaction.
	 *
	 * @param array $transaction_data Transaction data.
	 *
	 * @return array
	 */
	protected function get_approved_transaction( $transaction_data ) {
		if ( empty( $transaction_data ) || ! is_array( $transaction_data ) ) {
			return array();
		}

		foreach ( $transaction_data as $transaction ) {
			if ( ! empty( $transaction['transaction']['type'] ) && in_array( $transaction['transaction']['type'], array( 'PAYMENT', 'CAPTURE' ), true ) && ! empty( $transaction['result'] ) && 'SUCCESS' === $transaction['result'] ) {
				return $transaction['transaction'];
			}
		}

		return array();
	}


	/**
	 * Process capture payment action.
	 *
	 * @param WC_Order $order  Order object.
	 * @param float    $amount Amount to capture.
	 *
	 * @return void
	 */
	public function process_capture_payment( $order, $amount = 0 ) {

		try {
			if ( $this->id !== $order->get_payment_method() ) {
				throw new Exception( __( 'The payment method is invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			if ( $order->get_meta( $this->prefix_hook( 'order_captured' ) ) ) {
				return;
			}

			$unique_order_id = $order->get_meta( $this->prefix_hook( 'order_id' ) );

			if ( ! $unique_order_id || ! $order->get_meta( $this->prefix_hook( 'transaction_id' ) ) ) {
				throw new Exception( __( 'The order data is missing or invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			$transaction_id = $this->unique_transaction_id( $order );

			$payload = array(
				'apiOperation' => 'CAPTURE',
				'transaction'  => array(
					'amount'   => $amount > 0 ? $amount : $order->get_total(),
					'currency' => $order->get_currency(),
				),
			);

			$response = $this->mpgs_api()->capture_payment( $unique_order_id, $transaction_id, $payload );

			if ( ! $response['success'] || empty( $response['body']['result'] ) || 'SUCCESS' !== $response['body']['result'] ) {

				if ( ! empty( $response['error'] ) ) {
					throw new Exception( $response['error'] );
				}

				throw new Exception( __( 'There was an error capturing the payment.', $this->mpgs_plugin->text_domain() ) );
			}

			if ( empty( $response['body']['order'] ) || empty( $response['body']['transaction'] ) ) {
				throw new Exception( __( 'There was an error parsing the capture response.', $this->mpgs_plugin->text_domain() ) );
			}

			$this->process_wc_order( $order, $response['body']['order'], $response['body']['transaction'] );
		} catch ( Exception $e ) {
			$this->mpgs_plugin->logger()->log( $e->getMessage(), 'error' );
			$order->add_order_note(
				sprintf(
					// translators: %1$s: Gateway title, %2$s: Error message.
					__( '%1$s payment capture failed: %2$s', $this->mpgs_plugin->text_domain() ),
					$this->title,
					$e->getMessage()
				)
			);
		}
	}
}
