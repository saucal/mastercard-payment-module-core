<?php
/**
 * Render capture payment meta box.
 *
 * @class       CapturePaymentMetaBox
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore\Admin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

use GatewayPaymentCore\Gateways\WC_Abstract_Payment_Gateway;
use GatewayPaymentCore\CorePlugin;
use GatewayPaymentCore\Utils;
use WC_Order;
use WP_Post;

/**
 * Capture Payment Meta Box class
 */
class CapturePaymentMetaBox {

	/**
	 * Plugin instance.
	 *
	 * @var CorePlugin
	 */
	private $core_plugin;


	/**
	 * Instance of WC_Order to be used in metaboxes.
	 *
	 * @var WC_Order
	 */
	private $order;


	/**
	 * Gateway instance.
	 *
	 * @var WC_Abstract_Payment_Gateway
	 */
	private $gateway;


	/**
	 * Constructor.
	 *
	 * @param CorePlugin $core_plugin Plugin instance.
	 */
	public function __construct( CorePlugin $core_plugin ) {
		$this->core_plugin = $core_plugin;

		add_action( 'add_meta_boxes', array( $this, 'add_meta_boxes' ), 10, 2 );

		add_action( 'woocommerce_process_shop_order_meta', array( $this, 'maybe_process_actions' ), 100 );
	}


	/**
	 * Add meta boxes.
	 *
	 * @param string           $post_type The post type.
	 * @param WC_Order|WP_Post $post      The current post/order object.
	 * @return void
	 */
	public function add_meta_boxes( $post_type, $post ) {
		$order = $post instanceof WC_Order ? $post : wc_get_order( $post->ID );
		if ( ! ( $order instanceof WC_Order ) ) {
			return;
		}

		if ( ! apply_filters( $this->core_plugin->payment_core()->prefix_hook( 'add_meta_boxes' ), true, $order, $post_type ) ) {
			return;
		}

		if ( ! $this->core_plugin->is_gateway_order( $order ) ) {
			return;
		}
		$this->order = $order;

		$order_gateway = $this->core_plugin->get_order_gateway_instance( $order );
		if ( ! $order_gateway instanceof WC_Abstract_Payment_Gateway || $order->get_meta( $this->core_plugin->payment_core()->prefix_hook( 'order_captured' ) ) ) {
			return;
		}

		if ( $this->core_plugin->get_capturable_amount( $order ) <= 0 && ! $order->get_meta( $this->core_plugin->payment_core()->prefix_hook( 'authorize_transaction' ) ) ) {
			return;
		}

		$this->gateway = $order_gateway;

		add_meta_box( $this->core_plugin->payment_core()->prefix_hook( 'order-payment-actions' ), __( 'Payment Actions', $this->core_plugin->text_domain() ), array( $this, 'output' ), Utils::get_edit_order_screen_id(), 'side', 'high' );
	}


	/**
	 * Output the metabox.
	 */
	public function output() {
		if ( ! $this->order ) {
			return;
		}

		$this->core_plugin->payment_core()->template()->get(
			'admin/payment-actions.php',
			array(
				'gateway'                => $this->gateway,
				'order'                  => $this->order,
				'authorized_transaction' => $this->order->get_meta( $this->core_plugin->payment_core()->prefix_hook( 'authorize_transaction' ) ),
				'auth_amount'            => $this->core_plugin->get_capturable_amount( $this->order ),
			)
		);
	}


	/**
	 * Maybe capture payment.
	 *
	 * @param int $post_id Post ID.
	 */
	public function maybe_process_actions( $post_id ) {
		if ( ! $post_id ) {
			return;
		}

		$order = wc_get_order( $post_id );
		if ( ! $order instanceof WC_Order || ! $this->core_plugin->is_gateway_order( $order ) ) {
			return;
		}

		$gateway = $this->core_plugin->get_order_gateway_instance( $order );
		if ( ! $gateway instanceof WC_Abstract_Payment_Gateway ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification
		$void_transaction = isset( $_POST[ $gateway->prefix_hook( 'void_transaction' ) ] ) ? wc_clean( wp_unslash( $_POST[ $gateway->prefix_hook( 'void_transaction' ) ] ) ) : 0;
		if ( $void_transaction ) {
			// Void transaction takes precedence over capture.
			$gateway->process_void_payment( $order );
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification
		$capture_amount = isset( $_POST[ $gateway->prefix_hook( 'capture_amount' ) ] ) ? wc_format_decimal( wc_clean( wp_unslash( $_POST[ $gateway->prefix_hook( 'capture_amount' ) ] ) ) ) : 0;
		if ( $capture_amount <= 0 ) {
			return;
		}

		$auth_amount = $this->core_plugin->get_capturable_amount( $order );
		if ( $auth_amount <= 0 ) {
			return;
		}

		$gateway->process_capture_payment( $order, $capture_amount, $auth_amount );
	}
}
