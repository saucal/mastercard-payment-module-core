<?php
/**
 * Utility methods
 *
 * @class       Utils
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore;

use Automattic\WooCommerce\Utilities\OrderUtil;
use GatewayPaymentCore\Constants\Countries;
use WC_Order;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Utils class
 */
final class Utils {


	/**
	 * Main instance.
	 *
	 * @var Main
	 */
	private $payment_core;


	/**
	 * Constructor.
	 *
	 * @param Main $payment_core Main instance.
	 */
	public function __construct( Main $payment_core ) {
		$this->payment_core = $payment_core;
	}


	/**
	 * What type of request is this?
	 *
	 * @param  string $type admin, ajax, cron or frontend.
	 * @return bool
	 */
	public static function is_request( $type ) {

		switch ( $type ) {
			case 'admin':
				return is_admin();
			case 'ajax':
				return \wp_doing_ajax();
			case 'cron':
				return \wp_doing_cron();
			case 'frontend':
				return ( ! is_admin() || \wp_doing_ajax() ) && ! \wp_doing_cron();
			default:
				return false;
		}
	}


	/**
	 * Get the plugin url.
	 *
	 * @return string
	 */
	public function plugin_url() {
		return untrailingslashit( plugins_url( '/', $this->payment_core->plugin_file() ) );
	}


	/**
	 * Get the core package url.
	 *
	 * @return string
	 */
	public function core_package_url() {
		return untrailingslashit( plugins_url( '/', $this->payment_core->core_plugin_file() ) );
	}


	/**
	 * Get the plugin path.
	 *
	 * @return string
	 */
	public function plugin_path() {
		return untrailingslashit( plugin_dir_path( $this->payment_core->plugin_file() ) );
	}


	/**
	 * Get the core package path.
	 *
	 * @return string
	 */
	public function core_package_path() {
		return untrailingslashit( plugin_dir_path( $this->payment_core->core_plugin_file() ) );
	}


	/**
	 * Get the template path.
	 *
	 * @return string
	 */
	public function template_path() {
		/**
		 * Filters the template path for third-party plugin overrides.
		 *
		 * @since 1.0.0
		 */
		return apply_filters( $this->payment_core->prefix_hook( 'template_path' ), 'payment-core/' );
	}


	/**
	 * Get Ajax URL.
	 *
	 * @return string
	 */
	public function ajax_url() {
		return admin_url( 'admin-ajax.php', 'relative' );
	}


	/**
	 * Gets the order by Success Indicator.
	 *
	 * @param string $success_indicator The success indicator.
	 *
	 * @return WC_Order|bool Either an order or false when not found.
	 */
	public function get_order_by_success_indicator( $success_indicator ) {
		global $wpdb;

		$order_meta_key = $this->payment_core->prefix_hook( 'success_indicator' );

		if ( self::is_hpos_enabled() ) {
			$orders   = wc_get_orders(
				array(
					'limit'      => 1,
					'meta_query' => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
						array(
							'key'   => $order_meta_key,
							'value' => $success_indicator,
						),
					),
				)
			);
			$order_id = current( $orders ) ? current( $orders )->get_id() : false;
		} else {
			$order_id = $wpdb->get_var( $wpdb->prepare( "SELECT DISTINCT ID FROM $wpdb->posts as posts LEFT JOIN $wpdb->postmeta as meta ON posts.ID = meta.post_id WHERE meta.meta_value = %s AND meta.meta_key = %s", $success_indicator, $order_meta_key ) );
		}

		if ( ! empty( $order_id ) ) {
			$order = wc_get_order( $order_id );
		}

		if ( ! empty( $order ) && $order->get_status() !== 'trash' ) {
			return $order;
		}

		return false;
	}


	/**
	 * Check if HPOS feature is enabled.
	 *
	 * @return bool
	 */
	public function is_hpos_enabled() {
		return class_exists( 'Automattic\WooCommerce\Utilities\OrderUtil' ) && OrderUtil::custom_orders_table_usage_is_enabled();
	}


	/**
	 * Get the current order to be paid.
	 *
	 * @return WC_Order|false
	 */
	public static function get_current_order() {

		static $order;

		if ( ! is_null( $order ) && is_a( $order, WC_Order::class ) ) {
			return $order;
		}

		$order_id = get_query_var( 'order-pay' );

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
	 * Get current total on the cart, either from the cart or from the current order.
	 *
	 * @param \WC_Order|null $order The order.
	 *
	 * @return float
	 */
	public static function get_current_total_amount( $order = null ) {
		if ( null === $order ) {
			$order = self::get_current_order();
		}

		if ( $order ) {
			return (float) $order->get_total();
		}

		return (float) ! empty( WC()->cart ) ? WC()->cart->get_total( false ) : 0;
	}


	/**
	 * Get current currency on the cart, either from the cart or from the current order.
	 *
	 * @param \WC_Order|null $order The order.
	 *
	 * @return string
	 */
	public static function get_current_currency( $order = null ) {
		if ( null === $order ) {
			$order = self::get_current_order();
		}

		if ( $order ) {
			return $order->get_currency();
		}

		return get_woocommerce_currency();
	}


	/**
	 * Retrieves the billing information from an order to be used in the request.
	 *
	 * @param WC_Order $order The order.
	 *
	 * @return array
	 */
	public static function get_formatted_info_billing( $order ) {

		if ( ! $order || ! is_a( $order, WC_Order::class ) ) {
			return array();
		}

		return self::filter_empty_values(
			array(
				'address' => array(
					'street'        => self::truncate( $order->get_billing_address_1(), 100 ),
					'street2'       => self::truncate( $order->get_billing_address_2(), 100 ),
					'city'          => self::truncate( $order->get_billing_city(), 100 ),
					'postcodeZip'   => self::truncate( $order->get_billing_postcode(), 10 ),
					'country'       => Countries::country_code_iso3( $order->get_billing_country() ),
					'stateProvince' => self::truncate( $order->get_billing_state(), 20 ),
				),
			)
		);
	}


	/**
	 * Retrieves the shipping information from an order to be used in the request.
	 *
	 * @param WC_Order $order The order.
	 *
	 * @return array
	 */
	public static function get_formatted_info_shipping( $order ) {

		if ( ! $order || ! is_a( $order, WC_Order::class ) ) {
			return array();
		}

		if ( ! $order->has_shipping_address() ) {
			return array();
		}

		return self::filter_empty_values(
			array(
				'address' => array(
					'street'        => self::truncate( $order->get_shipping_address_1(), 100 ),
					'street2'       => self::truncate( $order->get_shipping_address_2(), 100 ),
					'city'          => self::truncate( $order->get_shipping_city(), 100 ),
					'postcodeZip'   => self::truncate( $order->get_shipping_postcode(), 10 ),
					'country'       => Countries::country_code_iso3( $order->get_shipping_country() ),
					'stateProvince' => self::truncate( $order->get_shipping_state(), 20 ),
				),
				'contact' => array(
					'firstName' => self::truncate( $order->get_shipping_first_name(), 50 ),
					'lastName'  => self::truncate( $order->get_shipping_last_name(), 50 ),
				),

			)
		);
	}

	/**
	 * Get the customer information from an order to be used in the request.
	 *
	 * @param WC_Order $order The order.
	 *
	 * @return array
	 */
	public static function get_formatted_info_customer( $order ) {

		if ( ! $order || ! is_a( $order, WC_Order::class ) ) {
			return array();
		}

		if ( empty( $order->get_billing_email() ) ) {
			return array();
		}

		return self::filter_empty_values(
			array(
				'email'     => $order->get_billing_email(),
				'firstName' => self::truncate( $order->get_billing_first_name(), 50 ),
				'lastName'  => self::truncate( $order->get_billing_last_name(), 50 ),
			)
		);
	}


	/**
	 * Truncate a string to a certain length.
	 *
	 * @param string $string_data The string to truncate.
	 * @param int    $length      The length to truncate the string to.
	 *
	 * @return string
	 */
	public static function truncate( $string_data, $length = 0 ): string {
		if ( ! is_string( $string_data ) ) {
			return '';
		}

		if ( $length <= 0 ) {
			return $string_data;
		}

		return substr( $string_data, 0, $length );
	}


	/**
	 * Filter empty values from an array.
	 *
	 * @param array $value The array to filter.
	 *
	 * @return array
	 */
	public static function filter_empty_values( $value ) {

		if ( ! is_array( $value ) ) {
			return $value;
		}

		foreach ( $value as $key => $item ) {
			if ( is_array( $item ) ) {
				$value[ $key ] = self::filter_empty_values( $item );
			}
		}

		return array_filter(
			$value,
			function ( $item ) {
				return ! empty( $item );
			}
		);
	}


	/**
	 * Get hosted session ID key.
	 *
	 * @param string $cart_hash The cart hash.
	 *
	 * @return string
	 */
	public function hosted_session_id_key( $cart_hash = '' ) {
		return $this->payment_core->prefix_hook( 'session_id_' . ( $cart_hash ? $cart_hash : $this->unique_cart_hash() ) );
	}


	/**
	 * Get hosted session attempt key.
	 *
	 * @param string $cart_hash The cart hash.
	 *
	 * @return string
	 */
	public function hosted_session_attempt_key( $cart_hash = '' ) {
		return $this->payment_core->prefix_hook( 'session_attempt_' . ( $cart_hash ? $cart_hash : $this->unique_cart_hash() ) );
	}


	/**
	 * Get hosted session currency key.
	 *
	 * @param string $cart_hash The cart hash.
	 *
	 * @return string
	 */
	public function hosted_session_config_key( $cart_hash = '' ) {
		return $this->payment_core->prefix_hook( 'session_config_' . ( $cart_hash ? $cart_hash : $this->unique_cart_hash() ) );
	}


	/**
	 * Get hosted session duration key.
	 *
	 * @param string $cart_hash The cart hash.
	 *
	 * @return string
	 */
	public function hosted_session_duration_key( $cart_hash = '' ) {
		return $this->payment_core->prefix_hook( 'session_duration_' . ( $cart_hash ? $cart_hash : $this->unique_cart_hash() ) );
	}


	/**
	 * Get unique cart hash.
	 *
	 * @return string
	 */
	public function unique_cart_hash() {
		return md5( get_site_url() . '-' . WC()->cart->get_cart_hash() );
	}


	/**
	 * Get a list of the possible errors that can occur while updating a Hosted Session form.
	 *
	 * @return array
	 */
	public function hosted_session_errors() {
		/**
		 * Filters the list of possible hosted session form errors.
		 *
		 * @since 1.0.0
		 */
		return apply_filters(
			$this->payment_core->prefix_hook( 'hosted_session_errors' ),
			array(
				'fields_in_error'       => array(
					'cardNumber'   => __( 'Card number invalid or missing', $this->payment_core->text_domain() ),
					'number'       => __( 'Card number invalid or missing', $this->payment_core->text_domain() ),
					'expiryMonth'  => __( 'Expiry month invalid or missing', $this->payment_core->text_domain() ),
					'expiryYear'   => __( 'Expiry year invalid or missing', $this->payment_core->text_domain() ),
					'securityCode' => __( 'Security code is invalid or missing', $this->payment_core->text_domain() ),
					'default'      => __( 'There was an error updating the payment details. Please try again.', $this->payment_core->text_domain() ),
				),
				'payment_type_required' => __( 'Payment type is required', $this->payment_core->text_domain() ),
				'request_timeout'       => __( 'Session update failed with request timeout', $this->payment_core->text_domain() ),
				'system_error'          => __( 'Session update failed with system error', $this->payment_core->text_domain() ),
				'default'               => __( 'There was an error updating the payment details. Please try again.', $this->payment_core->text_domain() ),
				'session_expired'       => __( 'The Payment Session expired. Please try again.', $this->payment_core->text_domain() ),
			)
		);
	}


	/**
	 * Returns the edit order's screen id.
	 *
	 * Takes into consideration if HPOS is enabled or not.
	 *
	 * @return string
	 */
	public static function get_edit_order_screen_id() {

		if ( function_exists( 'wc_get_page_screen_id' ) ) {
			return wc_get_page_screen_id( 'shop_order' );
		}

		if ( ! function_exists( 'wc_get_container' ) || ! class_exists( 'Automattic\WooCommerce\Internal\DataStores\Orders\CustomOrdersTableController' ) ) {
			return 'shop_order';
		}

		return wc_get_container()->get( \Automattic\WooCommerce\Internal\DataStores\Orders\CustomOrdersTableController::class )->custom_orders_table_usage_is_enabled()
		? wc_get_page_screen_id( 'shop-order' )
		: 'shop_order';
	}


	/**
	 * Is .min suffix required?
	 *
	 * @return string
	 */
	public static function min_suffix() {
		return defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ? '' : '.min';
	}

	/**
	 * Insert data around a key in an array.
	 *
	 * @param array  $target    The target array.
	 * @param string $key       The key to insert around.
	 * @param array  $new_data  The new data to insert.
	 * @param int    $operation The operation offset.
	 *
	 * @return array
	 */
	public static function insert_around_key( $target, $key, $new_data, $operation = 1 ) {
		// Find the index of the key to insert after.
		$keys  = array_keys( $target );
		$index = array_search( $key, $keys, true );

		// If the key is found, proceed with insertion.
		if ( false !== $index ) {
			$first_part  = array_slice( $target, 0, $index + $operation, true ); // +1 to include the 'after_key' element.
			$second_part = array_slice( $target, $index + $operation, null, true );

			$target = $first_part + $new_data + $second_part;
		} else {
			// If the key is not found, append.
			foreach ( $new_data as $new_key => $new_value ) {
				$target[ $new_key ] = $new_value;
			}
		}

		return $target;
	}
}
