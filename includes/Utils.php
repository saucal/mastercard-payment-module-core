<?php
/**
 * Utility methods
 *
 * @class       Utils
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore;

use Automattic\WooCommerce\Utilities\OrderUtil;
use MPGSCore\Constants\Countries;

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
	private $mpgs_core;


	/**
	 * Constructor.
	 *
	 * @param Main $mpgs_core Main instance.
	 */
	public function __construct( Main $mpgs_core ) {
		$this->mpgs_core = $mpgs_core;
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
				return defined( 'DOING_AJAX' ) && DOING_AJAX;
			case 'cron':
				return defined( 'DOING_CRON' ) && DOING_CRON;
			case 'frontend':
				return ( ! is_admin() || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) && ( ! defined( 'DOING_CRON' ) || ! DOING_CRON );
		}
	}


	/**
	 * Get the plugin url.
	 *
	 * @return string
	 */
	public function plugin_url() {
		return untrailingslashit( plugins_url( '/', $this->mpgs_core->plugin_file() ) );
	}


	/**
	 * Get the core package url.
	 *
	 * @return string
	 */
	public function core_package_url() {
		return untrailingslashit( plugins_url( '/', $this->mpgs_core->core_plugin_file() ) );
	}


	/**
	 * Get the plugin path.
	 *
	 * @return string
	 */
	public function plugin_path() {
		return untrailingslashit( plugin_dir_path( $this->mpgs_core->plugin_file() ) );
	}


	/**
	 * Get the core package path.
	 *
	 * @return string
	 */
	public function core_package_path() {
		return untrailingslashit( plugin_dir_path( $this->mpgs_core->core_plugin_file() ) );
	}


	/**
	 * Get the template path.
	 *
	 * @return string
	 */
	public function template_path() {
		// Allow 3rd party plugin filter template path from their plugin.
		return apply_filters( $this->mpgs_core->prefix_hook( 'template_path' ), 'mpgs-core/' );
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
	 * Gets the order by MPGS Success Indicator.
	 *
	 * @param string $success_indicator The success indicator.
	 *
	 * @return WC_Order|bool Either an order or false when not found.
	 */
	public function get_order_by_success_indicator( $success_indicator ) {
		global $wpdb;

		$order_meta_key = $this->mpgs_core->prefix_hook( 'success_indicator' );

		if ( self::is_hpos_enabled() ) {
			$orders   = wc_get_orders(
				array(
					'limit'      => 1,
					'meta_query' => array(
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

		if ( ! is_null( $order ) && is_a( $order, 'WC_Order' ) ) {
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
	 * Retrieves the billing information from an order to be used in the request.
	 *
	 * @param WC_Order $order The order.
	 *
	 * @return array
	 */
	public static function get_formatted_info_billing( $order ) {

		if ( ! $order || ! is_a( $order, 'WC_Order' ) ) {
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

		if ( ! $order || ! is_a( $order, 'WC_Order' ) ) {
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

		if ( ! $order || ! is_a( $order, 'WC_Order' ) ) {
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
	 * @return string
	 */
	public function hosted_session_id_key() {
		return $this->mpgs_core->prefix_hook( 'session_id_' . WC()->cart->get_cart_hash() );
	}


	/**
	 * Get hosted session duration key.
	 *
	 * @return string
	 */
	public function hosted_session_duration_key() {
		return $this->mpgs_core->prefix_hook( 'session_duration_' . WC()->cart->get_cart_hash() );
	}


	/**
	 * Get hosted session data hash key.
	 *
	 * @return string
	 */
	public function hosted_session_data_hash_key() {
		return $this->mpgs_core->prefix_hook( 'session_data_hash_' . WC()->cart->get_cart_hash() );
	}
}
