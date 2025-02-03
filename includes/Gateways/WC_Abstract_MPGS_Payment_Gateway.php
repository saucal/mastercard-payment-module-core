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
use WP_Error;
use MPGSCore\MpgsAPI;
use MPGSCore\MpgsPlugin;
use MPGSCore\PaymentToken;
use MPGSCore\Utils;
use WC_HTTPS;
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
	 * Block compatibility class.
	 *
	 * @var string
	 */
	protected $block_compat_class;


	/**
	 * Debounce key.
	 *
	 * @var string
	 */
	protected $debounce_key;


	/**
	 * Transaction debounce key.
	 *
	 * @var string
	 */
	protected $debounce_key_transaction;


	/**
	 * Transaction ID of the currently processed refund.
	 *
	 * @var string
	 */
	protected $refund_transaction_id;


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
	 * @param string $hook      Hook name.
	 * @param string $prefix    Prefix.
	 * @param string $separator Separator.
	 *
	 * @return string
	 */
	public function prefix_hook( $hook, $prefix = '', $separator = '_' ) {
		return $this->mpgs_plugin->mpgs_core()->prefix_hook( $hook, $prefix, $separator );
	}


	/**
	 * Get the block compatibility class.
	 *
	 * @return string
	 */
	public function block_compat_class() {
		return $this->block_compat_class;
	}


	/**
	 * Add payment method data for Woo Blocks compatibility.
	 *
	 * @param array $data Payment method data.
	 *
	 * @return array
	 */
	public function add_payment_method_data( $data ) {
		return $data;
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
	 * Return the gateway's icon.
	 *
	 * @return string
	 */
	public function get_icon() {
		$icon = $this->icon ? '<img src="' . esc_url( WC_HTTPS::force_https_url( $this->icon ) ) . '" class="mpgs-icon ' . $this->id . '-icon" alt="' . esc_attr( $this->get_title() ) . '" />' : '';

		return apply_filters( 'woocommerce_gateway_icon', $icon, $this->id );
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
			'description'     => ! empty( $this->mpgs_plugin->get_gateway_setting( 'merchant_name' ) ) ? $this->mpgs_plugin->get_gateway_setting( 'merchant_name' ) : get_bloginfo( 'name', 'display' ),
			'notificationUrl' => add_query_arg(
				array(
					'wc-api'   => $this->prefix_hook( 'wc-webhook' ),
					'order-id' => $order->get_id(),
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
	 * Hashed signature for specific transaction.
	 *
	 * @param WC_Order $order          Order.
	 * @param string   $transaction_id Transaction ID.
	 *
	 * @return string
	 */
	protected function hashed_signature( $order, $transaction_id ) {
		$unique_order_id = $this->unique_order_id( $order );

		return hash( 'sha256', $unique_order_id . $transaction_id );
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
	 * Retrieve order from the API.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return array
	 */
	public function retrieve_order( $order ) {
		static $orders = array();

		if ( isset( $orders[ $order->get_id() ] ) ) {
			return $orders[ $order->get_id() ];
		}

		$orders[ $order->get_id() ] = $this->mpgs_api()->retrieve_order( $this->unique_order_id( $order ) );

		return $orders[ $order->get_id() ];
	}


	/**
	 * Get the authorized amount.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return float
	 */
	public function get_authorized_amount( $order ) {
		$order_data = $this->retrieve_order( $order );

		$this->validate_payment_status( $order, $order_data );

		$authorized_amount = $order_data['body']['totalAuthorizedAmount'] ?? 0;
		$captured_amount   = $order_data['body']['totalCapturedAmount'] ?? 0;

		return $authorized_amount - $captured_amount > 0 ? $authorized_amount - $captured_amount : 0;
	}


	/**
	 * Get the captured amount.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return float
	 */
	public function get_captured_amount( $order ) {
		$order_data = $this->retrieve_order( $order );

		$this->validate_payment_status( $order, $order_data );

		return $order_data['body']['totalCapturedAmount'] ?? 0;
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

			// Prevent error log if the order is not created yet.
			$this->mpgs_plugin->logger()->force_disable();

			$order_data = $this->retrieve_order( $order );

			$this->mpgs_plugin->logger()->restore_force_disable();

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

		if ( $this->is_transaction_processed( $order, $transaction['id'] ) ) {
			return;
		}

		$order->update_meta_data( $this->prefix_hook( 'order_captured' ), 'CAPTURED' === $order_data['status'] );
		$order->update_meta_data( $this->prefix_hook( 'order_id' ), $order_data['id'] );

		$order->set_payment_method( $this->id );
		$order->set_payment_method_title( $this->title );

		// Add this transaction to the processed transactions.
		$this->flag_transaction_as_processed( $order, $transaction['id'] );

		switch ( $order_data['status'] ) {
			case 'CAPTURED':
				$order->update_meta_data( $this->prefix_hook( 'authorize_transaction' ), null );
				$order->payment_complete( $order_data['id'] );
				$order->add_order_note(
					sprintf(
						// translators: %1$s: Gateway title, %2$s: Order ID.
						__( '%1$s payment was Captured (Order ID: %2$s)', $this->mpgs_plugin->text_domain() ),
						$this->title,
						$order_data['id'],
					)
				);
				break;
			case 'AUTHORIZED':
				$order->add_order_note(
					sprintf(
						// translators: %1$s: Gateway title, %2$s: Order ID.
						__( '%1$s payment was Authorized (Order ID: %2$s)', $this->mpgs_plugin->text_domain() ),
						$this->title,
						$order_data['id'],
					)
				);
				$order->update_meta_data( $this->prefix_hook( 'authorize_transaction' ), $transaction['id'] );
				$order->update_status( 'on-hold', __( 'Payment authorized, waiting for capture.', $this->mpgs_plugin->text_domain() ) );
				break;
			case 'PARTIALLY_CAPTURED':
				$order->add_order_note(
					sprintf(
						// translators: %1$s: Gateway title, %2$s: Captured amount.
						__( '%1$s payment was Partially Captured. Captured Amount: %2$s', $this->mpgs_plugin->text_domain() ),
						$this->title,
						wc_price( $transaction['amount'], array( 'currency' => $transaction['currency'] ) )
					)
				);
				$order->update_meta_data( $this->prefix_hook( 'authorize_transaction' ), null );
				$order->update_status( 'on-hold', __( 'Payment partially captured, waiting for full capture.', $this->mpgs_plugin->text_domain() ) );
				break;
			case 'CANCELLED':
				if ( 'cancelled' !== $order->get_status() ) {
					$order->update_meta_data( $this->prefix_hook( 'authorize_transaction' ), null );
					$order->update_status( 'cancelled', __( 'Authorization was cancelled successfully.', $this->mpgs_plugin->text_domain() ) );
				}
				break;
			case 'DECLINED':
				$this->handle_failed_payment( new WP_Error( 'payment_declined', $this->get_mapped_error_code( $order_data['error']['cause'] ?? 'error' ) ), $order );
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
			$order_data = $this->retrieve_order( $order );
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
			if ( empty( $transaction['result'] ) || 'SUCCESS' !== $transaction['result'] ) {
				continue;
			}

			if ( empty( $transaction['transaction']['type'] ) ) {
				continue;
			}

			if ( in_array( $transaction['transaction']['type'], array( 'PAYMENT', 'CAPTURE', 'AUTHORIZATION' ), true ) ) {
				return $transaction['transaction'];
			}
		}

		return array();
	}


	/**
	 * Check if certain transaction was already processed.
	 *
	 * @param WC_Order $order          Order object.
	 * @param string   $transaction_id Transaction ID.
	 *
	 * @return bool
	 */
	protected function is_transaction_processed( $order, $transaction_id ) {
		$processed_transactions = $order->get_meta( $this->prefix_hook( 'processed_transactions' ) );

		if ( ! $processed_transactions ) {
			return false;
		}

		return in_array( $transaction_id, $processed_transactions, true );
	}


	/**
	 * Flag transaction as processed.
	 *
	 * @param WC_Order $order          Order object.
	 * @param string   $transaction_id Transaction ID.
	 *
	 * @return void
	 */
	protected function flag_transaction_as_processed( $order, $transaction_id ) {
		$processed_transactions = $order->get_meta( $this->prefix_hook( 'processed_transactions' ) );

		if ( ! $processed_transactions ) {
			$processed_transactions = array();
		}

		$processed_transactions[] = $transaction_id;

		$order->update_meta_data( $this->prefix_hook( 'processed_transactions' ), $processed_transactions );
		$order->save();
	}


	/**
	 * Process capture payment action.
	 *
	 * @param WC_Order $order       Order object.
	 * @param float    $amount      Amount to capture.
	 * @param float    $auth_amount Authorized amount.
	 *
	 * @return void
	 */
	public function process_capture_payment( $order, $amount = 0, $auth_amount = 0 ) {

		try {
			if ( $this->id !== $order->get_payment_method() ) {
				throw new Exception( __( 'The payment method is invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			if ( $order->get_meta( $this->prefix_hook( 'order_captured' ) ) ) {
				return;
			}

			$unique_order_id = $order->get_meta( $this->prefix_hook( 'order_id' ) );

			if ( ! $unique_order_id ) {
				throw new Exception( __( 'The order data is missing or invalid.', $this->mpgs_plugin->text_domain() ) );
			}

			$transaction_id = $this->unique_transaction_id( $order );

			$amount_to_capture = $amount > 0 ? $amount : $order->get_total();

			$payload = array(
				'apiOperation' => 'CAPTURE',
				'transaction'  => array(
					'amount'                         => $amount_to_capture,
					'currency'                       => $order->get_currency(),
					'authorizationAdjustmentActions' => 'NO_ACTION',
				),
			);

			if ( $auth_amount && $amount_to_capture > $auth_amount ) {
				$payload['transaction']['authorizationAdjustmentActions'] = 'INCREMENT';
			}

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


	/**
	 * Process refund.
	 *
	 * Create a Refund transaction
	 *
	 * @param  int        $order_id Order ID.
	 * @param  float|null $amount Refund amount.
	 * @param  string     $reason Refund reason.
	 *
	 * @return bool       True or false based on success.
	 *
	 * @throws Exception Exception.
	 */
	public function process_refund( $order_id, $amount = null, $reason = '' ) {
		try {
			$order           = wc_get_order( $order_id );
			$captured_amount = $this->get_captured_amount( $order );

			if ( ! $order || ! $amount || ! $captured_amount ) {
				return false;
			}

			if ( $amount > $captured_amount ) {
				$error = __( 'The amount to be refunded is greater than the captured amount.', $this->mpgs_plugin->text_domain() );
				throw new Exception( $error );
			}

			$currency       = $order->get_currency();
			$transaction_id = $this->unique_transaction_id( $order );

			if ( ! $transaction_id ) {
				return false;
			}

			$refund_data = array(
				'apiOperation' => 'REFUND',
				'transaction'  => array(
					'amount'   => $amount,
					'currency' => $currency,
				),
			);

			$response = $this->mpgs_api()->create_transaction( $this->unique_order_id( $order ), $transaction_id, $refund_data );

			if ( ! $response['success'] || empty( $response['body']['result'] ) || ! empty( $response['error'] ) ) {
				$error = __( 'There was an error processing the payment refund. Please try again.', $this->mpgs_plugin->text_domain() );
				throw new Exception( $error );
			}

			$note = sprintf(
				// translators: %1$s: Currency of refund, %2$s: Refund amount, %2$s: Refund reason.
				__( 'Refund of %1$s processed. %2$s', $this->mpgs_plugin->text_domain() ),
				wc_price( $amount, array( 'currency' => $currency ) ),
				$reason ? __( 'Reason: ', $this->mpgs_plugin->text_domain() ) . $reason : '',
			);
			$order->add_order_note( $note );

			$this->flag_transaction_as_processed( $order, $transaction_id );

			// Add the transaction ID to the refund meta.
			$this->refund_transaction_id = $transaction_id;
			add_action( 'woocommerce_order_refunded', array( $this, 'add_refund_meta' ), 10, 2 );

			do_action( $this->prefix_hook( 'process_refund_success' ), $order, $currency, $amount, $reason );

			return true;
		} catch ( Exception $e ) {
			$error_message = $e->getMessage();

			$this->mpgs_plugin->logger()->log( $error_message, 'error' );

			return new WP_Error(
				'failed-refund',
				sprintf(
				// translators: %1$s: Currency of refund, %2$s: Refund amount, %2$s: Refund reason.
					__( 'There was an error processing the refund. Reason: %1$s', $this->mpgs_plugin->text_domain() ),
					$error_message
				)
			);
		}
	}


	/**
	 * Add refund meta.
	 *
	 * @param int $order_id Order ID.
	 * @param int $refund_id Refund ID.
	 *
	 * @return void
	 */
	public function add_refund_meta( $order_id, $refund_id ) {
		if ( ! $this->refund_transaction_id ) {
			return;
		}

		$refund = wc_get_order( $refund_id );

		if ( ! $refund ) {
			return;
		}

		$refund->update_meta_data( $this->prefix_hook( 'transaction_id' ), $this->refund_transaction_id );
		$refund->save();
	}


	/**
	 * Create a refund for an order when receiving a webhook notification.
	 *
	 * @param WC_Order $order       Order object.
	 * @param array    $transaction Transaction data.
	 *
	 * @return void
	 */
	protected function refund( $order, $transaction ) {
		if ( ! $order ) {
			return;
		}

		if ( empty( $transaction['id'] ) ) {
			return;
		}

		$amount = $transaction['amount'] ?? 0;
		$reason = $transaction['reason'] ?? '';

		$order_note = sprintf(
			// translators: %1$s: Refund reason, %2$s: Refund amount.
			__( 'Refund Webhook notification received. Refund amount: %2$s.', $this->mpgs_plugin->text_domain() ),
			$reason,
			wc_price( $amount, array( 'currency' => $order->get_currency() ) )
		);

		if ( ! empty( $reason ) ) {
			$order_note .= ' ' . sprintf(
				// translators: %s: Refund reason.
				__( 'Reason: %s', $this->mpgs_plugin->text_domain() ),
				$reason
			);
		}

		$order->add_order_note( $order_note );

		if ( 'refunded' === $order->get_status() ) {
			return;
		}

		$refund = wc_create_refund(
			array(
				'amount'   => $amount,
				'reason'   => $reason,
				'order_id' => $order->get_id(),
			)
		);

		if ( is_wp_error( $refund ) ) {
			/* translators: %1$s reason */
			throw new Exception( sprintf( __( 'Create refund failed: %1$s.', $this->mpgs_plugin->text_domain() ), $refund->get_error_message() ) );
		}

		$refund->update_meta_data( $this->prefix_hook( 'transaction_id' ), $transaction['id'] );
		$refund->save();

		$this->flag_transaction_as_processed( $order, $transaction['id'] );
	}


	/**
	 * Cancel a refund for an order when receiving a webhook notification.
	 *
	 * @param WC_Order $order       Order object.
	 * @param array    $transaction Transaction data.
	 *
	 * @return void
	 */
	protected function void_refund( $order, $transaction ) {
		if ( ! $order ) {
			return;
		}

		if ( empty( $transaction['id'] ) || empty( $transaction['targetTransactionId'] ) ) {
			return;
		}

		$voided_refund = null;

		foreach ( $order->get_refunds() as $refund ) {
			if ( $transaction['targetTransactionId'] === $refund->get_meta( $this->prefix_hook( 'transaction_id' ) ) ) {
				$voided_refund = $refund;
				break;
			}
		}

		if ( ! $voided_refund ) {
			throw new Exception(
				sprintf(
					__( 'Refund with Transaction ID (%s) not found.', $this->mpgs_plugin->text_domain() ),
					$transaction['id']
				)
			);
		}

		$voided_refund->delete( true );

		$order->add_order_note( sprintf( __( 'Refund was cancelled. Transaction ID: %s', $this->mpgs_plugin->text_domain() ), $transaction['id'] ) );

		$this->flag_transaction_as_processed( $order, $transaction['id'] );
	}


	/**
	 * Process void payment action.
	 *
	 * @param WC_Order $order Order object.
	 *
	 * @return void
	 */
	public function process_void_payment( $order ) {

		if ( ! $order || ! is_a( $order, 'WC_Order' ) ) {
			return;
		}

		if ( $this->id !== $order->get_payment_method() ) {
			return;
		}

		try {
			$order_data = $this->retrieve_order( $order );

			$this->validate_payment_status( $order, $order_data );

			if ( 'AUTHORIZED' !== $order_data['body']['status'] ) {
				throw new Exception( __( 'The order cannot be voided anymore.', $this->mpgs_plugin->text_domain() ) );
			}

			$transaction_id = $order->get_meta( $this->prefix_hook( 'authorize_transaction' ) );
			if ( empty( $transaction_id ) ) {
				throw new Exception( __( 'The Authorize transaction ID is missing. Try to void the authorization from the Merchant Portal.', $this->mpgs_plugin->text_domain() ) );
			}

			$void_data = array(
				'apiOperation' => 'VOID',
				'transaction'  => array(
					'targetTransactionId' => $transaction_id,
				),
			);

			$response = $this->mpgs_api()->create_transaction( $this->unique_order_id( $order ), $this->unique_transaction_id( $order ), $void_data );

			if ( ! $response['success'] || empty( $response['body']['result'] ) || 'SUCCESS' !== $response['body']['result'] ) {
				throw new Exception( __( 'Void Payment failed. Please try again.', $this->mpgs_plugin->text_domain() ) );
			}

			$this->process_wc_order( $order, $response['body']['order'], $response['body']['transaction'] );
		} catch ( Exception $e ) {
			$order->add_order_note(
				sprintf(
					/* translators: %s: error message */
					__( 'Void Payment failed: %s', $this->mpgs_plugin->text_domain() ),
					$e->getMessage()
				)
			);
		}
	}


	/**
	 * Void an Authorize transaction when receiving a webhook notification.
	 *
	 * @param WC_Order $order       Order object.
	 * @param array    $transaction Transaction data.
	 *
	 * @return void
	 */
	protected function void_payment( $order, $transaction ) {
		if ( ! $order || 'cancelled' === $order->get_status() ) {
			return;
		}

		if ( empty( $transaction['id'] ) ) {
			return;
		}

		$order->add_order_note( __( 'Void Authorization Webhook notification received.', $this->mpgs_plugin->text_domain() ) );

		$order->update_status( 'cancelled', __( 'Authorization was cancelled successfully.', $this->mpgs_plugin->text_domain() ) );

		$this->flag_transaction_as_processed( $order, $transaction['id'] );
	}


	/**
	 * Process chargeback payment action.
	 *
	 * @param WC_Order $order       Order object.
	 * @param array    $transaction Transaction data.
	 *
	 * @return void
	 */
	public function process_chargeback( $order, $transaction ) {
		if ( empty( $transaction['dispute'] ) ) {
			return;
		}

		if ( empty( $transaction['dispute']['event'] ) || 'CHARGEBACK_DEBITED' !== $transaction['dispute']['event'] ) {
			return;
		}

		$message = sprintf(
			__( '%s payment was charged back.', $this->mpgs_plugin->text_domain() ),
			$this->title,
		);

		if ( ! empty( $transaction['dispute']['amount'] ) && ! empty( $transaction['dispute']['currency'] ) ) {
			$message .= ' ' . sprintf(
				__( 'Chargeback Amount: %s', $this->mpgs_plugin->text_domain() ),
				wc_price( $transaction['dispute']['amount'], array( 'currency' => $transaction['dispute']['currency'] ) )
			);
		}

		if ( ! empty( $transaction['dispute']['reason'] ) ) {
			$message .= ' ' . sprintf(
				__( 'Reason: %s', $this->mpgs_plugin->text_domain() ),
				$transaction['dispute']['reason']
			);
		}

		$order->update_status(
			'on-hold',
			$message
		);
	}


	/**
	 * Process the return callback.
	 *
	 * @return void
	 * @throws Exception Exception.
	 */
	public function process_notification_api_callback() {
		$order = $this->validate_source();

		if ( ! $order ) {
			return;
		}

		try {
			$raw_body = file_get_contents( 'php://input' );
			$this->debounce_webhook_request( $raw_body );

			$body = json_decode( $raw_body, true );

			if ( empty( $body ) ) {
				throw new Exception( __( 'The request body is empty.', $this->mpgs_plugin->text_domain() ) );
			}

			$this->mpgs_plugin->logger()->log( __( 'Webhook Notification: ', $this->mpgs_plugin->text_domain() ) . $raw_body, 'info', $this->prefix_hook( 'webhooks', '', '-' ) );

			$this->handle_webhook_request( $body, $order );

			status_header( 200 );
			$this->webhook_cleanup();
		} catch ( Exception $e ) {
			$this->mpgs_plugin->logger()->log( $e->getMessage(), 'error' );
			status_header( is_numeric( $e->getCode() ) ? $e->getCode() : 400 );
			die();
		}
	}


	/**
	 * Linking transaction id order to BlueSnap.
	 *
	 * @param WC_Order $order
	 *
	 * @return string
	 */
	public function get_transaction_url( $order ) {
		if ( ! $order ) {
			return parent::get_transaction_url( $order );
		}

		$order_id = $order->get_meta( $this->prefix_hook( 'order_id' ) );

		if ( ! $order_id ) {
			$order_id = $this->unique_order_id( $order );
		}

		if ( ! $order_id ) {
			return parent::get_transaction_url( $order );
		}

		$this->view_transaction_url = $this->merchant_portal_order_id( $order_id );

		return parent::get_transaction_url( $order );
	}


	/**
	 * Build the URL to point to an order in the merchant's portal.
	 *
	 * @param string $order_id    The order ID.
	 * @param bool   $return_html Wether to return an HTML link or not.
	 *
	 * @return string
	 */
	public function merchant_portal_order_id( $order_id, $return_html = false ) {
		$order_url = add_query_arg(
			array(
				'_authDomain' => 'ma',
				'merchantId'  => $this->mpgs_plugin->merchant_id(),
				'orderId'     => $order_id,
			),
			untrailingslashit( $this->mpgs_plugin->gateway_url() ) . '/historyV2/detail'
		);

		if ( ! $return_html ) {
			return $order_url;
		}

		return sprintf( '<a href="%s" target="_blank">%s</a>', esc_url( $order_url ), $order_id );
	}


	/**
	 * Validate incoming request against IP and User-Agent.
	 *
	 * @return WC_Order|false
	 */
	private function validate_source() {
		if ( ( 'POST' !== $_SERVER['REQUEST_METHOD'] ) ) {
			return false;
		}

		if ( empty( $_SERVER['HTTP_X_NOTIFICATION_SECRET'] ) ) {
			return false;
		}

		$notification_secret = $this->get_option( 'notification_secret' );

		if ( empty( $notification_secret ) || $notification_secret !== wc_clean( wp_unslash( $_SERVER['HTTP_X_NOTIFICATION_SECRET'] ) ) ) {
			return false;
		}

		if ( ! isset( $_GET['order-id'] ) ) {
			return false;
		}

		$order_id = absint( wp_unslash( $_GET['order-id'] ) );

		if ( ! $order_id ) {
			return false;
		}

		$order = wc_get_order( $order_id );

		if ( ! $order ) {
			return false;
		}

		return $order;
	}


	/**
	 * Handle the Webhook request.
	 *
	 * @param array    $body  Request body.
	 * @param WC_Order $order Order object.
	 *
	 * @return void
	 */
	protected function handle_webhook_request( $body, $order ) {
		if ( ! $order ) {
			return;
		}

		if ( empty( $body['result'] ) || 'SUCCESS' !== $body['result'] ) {
			return;
		}

		$order_data  = $body['order'] ?? array();
		$transaction = $body['transaction'] ?? array();

		if ( empty( $order_data ) || empty( $transaction ) ) {
			return;
		}

		$this->debounce_webhook_transaction( $transaction );

		if ( empty( $transaction['id'] ) || empty( $transaction['type'] ) ) {
			return;
		}

		if ( $this->is_transaction_processed( $order, $transaction['id'] ) ) {
			return;
		}

		switch ( $transaction['type'] ) {
			case 'CAPTURE':
			case 'PAYMENT':
			case 'AUTHORIZATION':
			case 'VOID_PAYMENT':
			case 'VOID_CAPTURE':
				$this->process_wc_order( $order, $order_data, $transaction );
				break;
			case 'VOID_AUTHORIZATION':
				$this->void_payment( $order, $transaction );
				break;
			case 'REFUND':
				$this->refund( $order, $transaction );
				break;
			case 'VOID_REFUND':
				$this->void_refund( $order, $transaction );
				break;
			case 'CHARGEBACK':
				$this->process_chargeback( $order, $transaction );
				break;
		}
	}


	/**
	 * Do not allow the same Webhook request to be processed concurrently.
	 *
	 * @param string $raw_body Raw body of the Webhook request.
	 *
	 * @return void
	 * @throws Exception
	 */
	protected function debounce_webhook_request( $raw_body ) {

		$this->debounce_key = $this->prefix_hook( 'webhook_debounce_' . md5( $raw_body ) );

		if ( false !== get_transient( $this->debounce_key ) ) {
			throw new Exception( __( 'Notification Webhook repeated too soon or previous request exited abnormally.', $this->mpgs_plugin->text_domain() ) );
		}

		set_transient( $this->debounce_key, time(), MINUTE_IN_SECONDS );
	}


	/**
	 * Do not allow the same Transaction to be processed concurrently.
	 *
	 * @param array $transaction Transaction data.
	 *
	 * @return void
	 * @throws Exception
	 */
	protected function debounce_webhook_transaction( $transaction ) {

		if ( empty( $transaction['id'] ) ) {
			return;
		}

		$this->debounce_key_transaction = $this->prefix_hook( 'webhook_debounce_transaction_' . $transaction['id'] );

		if ( false !== get_transient( $this->debounce_key_transaction ) ) {
			throw new Exception( __( 'Notification Webhook repeated too soon or previous request exited abnormally.', $this->mpgs_plugin->text_domain() ) );
		}

		set_transient( $this->debounce_key_transaction, time(), MINUTE_IN_SECONDS );
	}



	/**
	 * Cleanup debounce transient after Webhook was processed.
	 *
	 * @return void
	 */
	protected function webhook_cleanup() {
		if ( $this->debounce_key ) {
			delete_transient( $this->debounce_key );
		}

		if ( $this->debounce_key_transaction ) {
			delete_transient( $this->debounce_key_transaction );
		}
	}
}
