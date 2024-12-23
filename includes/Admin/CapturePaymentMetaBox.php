<?php
/**
 * Render capture payment meta box.
 *
 * @class       CapturePaymentMetaBox
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore\Admin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

use MPGSCore\Gateways\WC_Abstract_MPGS_Payment_Gateway;
use MPGSCore\MpgsPlugin;
use MPGSCore\Utils;

/**
 * Capture Payment Meta Box class
 */
class CapturePaymentMetaBox {

	/**
	 * Plugin instance.
	 *
	 * @var MpgsPlugin
	 */
	private $mpgs_plugin;


	/**
	 * Instance of WC_Order to be used in metaboxes.
	 *
	 * @var \WC_Order
	 */
	private $order;


	/**
	 * Gateway instance.
	 *
	 * @var WC_Abstract_MPGS_Payment_Gateway
	 */
	private $gateway;


	/**
	 * Constructor.
	 *
	 * @param MpgsPlugin $mpgs_plugin Plugin instance.
	 */
	public function __construct( MpgsPlugin $mpgs_plugin ) {
		$this->mpgs_plugin = $mpgs_plugin;

		add_action( 'add_meta_boxes', array( $this, 'add_meta_boxes' ), 10, 2 );

		add_action( 'woocommerce_process_shop_order_meta', array( $this, 'maybe_capture_payment' ), 100 );
	}


	/**
	 * Add meta boxes.
	 *
	 * @param string           $post_type The post type.
	 * @param WC_Order|WP_Post $post      The current post/order object.
	 * @return void
	 */
	public function add_meta_boxes( $post_type, $post ) {
		$order = $post instanceof \WC_Order ? $post : wc_get_order( $post->ID );
		if ( ! ( $order instanceof \WC_Order ) ) {
			return;
		}

		if ( ! $this->mpgs_plugin->is_mpgs_order( $order ) ) {
			return;
		}
		$this->order = $order;

		$order_gateway = $this->mpgs_plugin->get_order_gateway_instance( $order );
		if ( ! $order_gateway instanceof WC_Abstract_MPGS_Payment_Gateway || $this->mpgs_plugin->get_capturable_amount( $order ) <= 0 ) {
			return;
		}
		$this->gateway = $order_gateway;

		add_meta_box( $this->mpgs_plugin->mpgs_core()->prefix_hook( 'order-capture' ), __( 'Capture Payment', $this->mpgs_plugin->text_domain() ), array( $this, 'output' ), Utils::get_edit_order_screen_id(), 'side', 'high' );
	}


	/**
	 * Output the metabox.
	 */
	public function output() {
		if ( ! $this->order ) {
			return;
		}

		$authorized_amount = $this->mpgs_plugin->get_capturable_amount( $this->order );

		$this->mpgs_plugin->mpgs_core()->template()->get(
			'admin/partial-capture.php',
			array(
				'gateway'     => $this->gateway,
				'order'       => $this->order,
				'auth_amount' => $authorized_amount,
			)
		);
	}


	/**
	 * Maybe capture payment.
	 *
	 * @param int $post_id Post ID.
	 */
	public function maybe_capture_payment( $post_id ) {
		if ( ! $post_id ) {
			return;
		}

		$order = wc_get_order( $post_id );
		if ( ! $order instanceof \WC_Order || ! $this->mpgs_plugin->is_mpgs_order( $order ) ) {
			return;
		}

		$gateway = $this->mpgs_plugin->get_order_gateway_instance( $order );
		if ( ! $gateway instanceof WC_Abstract_MPGS_Payment_Gateway ) {
			return;
		}

		$auth_amount = $this->mpgs_plugin->get_capturable_amount( $order );
		if ( $auth_amount <= 0 ) {
			return;
		}

		$capture_amount = isset( $_POST[ $gateway->prefix_hook( 'capture_amount' ) ] ) ? wc_format_decimal( $_POST[ $gateway->prefix_hook( 'capture_amount' ) ] ) : 0;
		if ( $capture_amount <= 0 ) {
			return;
		}

		$gateway->process_capture_payment( $order, $capture_amount, $auth_amount );
	}
}
