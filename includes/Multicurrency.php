<?php
/**
 * Class to interact with the Multicurrency.
 *
 * @class       Multicurrency
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore;

use GatewayPaymentCore\API;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Multicurrency class.
 */
final class Multicurrency {

	/**
	 * Cookie name used for currency selection.
	 *
	 * @var string
	 */
	const COOKIE_CURRENCY_NAME = 'wc_mastercard_currency';

	/**
	 * Transient name used to store exchange rates.
	 *
	 * @var string
	 */
	const CURRENCY_RATES_TRANSIENT = 'wc_mastercard_currency_rates';

	/**
	 * Plugin core instance.
	 *
	 * @var CorePlugin
	 */
	private $core_plugin;

	/**
	 * Selected currency by user or session.
	 *
	 * @var string
	 */
	protected $currency_selected;

	/**
	 * Original store currency.
	 *
	 * @var string
	 */
	public $original_currency;

	/**
	 * Currency config.
	 *
	 * @var string
	 */
	protected $currency_config;

	/**
	 * API instance.
	 *
	 * @var API
	 */
	protected $api;

	/**
	 * Constructor.
	 *
	 * @param CorePlugin $core_plugin Core plugin instance.
	 */
	public function __construct( CorePlugin $core_plugin ) {
		$this->core_plugin = $core_plugin;
		$this->original_currency = 'USD';

		if ( $this->is_multicurrency_enabled() ) {
			add_action(
				'wc_ajax_mastercard_set_multicurrency',
				array( $this, 'change_user_currency' )
			);
		}

		// Shortcode
		add_shortcode( 'mastercard_multicurrency', array( $this, 'add_multicurrency_shortcode' ) );

		add_filter( $this->core_plugin->payment_core()->prefix_hook( 'enqueue_scripts' ), array( $this, 'add_multicurrency_js' ) );
	}

	/**
	 * Checks if multicurrency feature is enabled.
	 *
	 * @return bool True if enabled, false otherwise.
	 */
	public function is_multicurrency_enabled() {
		return 'yes' === $this->core_plugin->get_gateway_setting( 'multicurrency' );
	}

	/**
	 * Handles user currency change via AJAX.
	 *
	 * @return void
	 */
	public function change_user_currency() {
		if (
			! isset( $_REQUEST['action'] ) || // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			'mastercard_multicurrency_action' !== $_REQUEST['action'] ||
			! $this->verify_nonce()
		) {
			return;
		}

		$this->set_currency_user_selected(
			$_REQUEST['mastercard_currency_selector'], // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			true
		);
		WC()->cart->calculate_totals();

		$referer = '';
		if ( ! empty( $_SERVER['HTTP_REFERER'] ) ) {
			$referer = wp_unslash( $_SERVER['HTTP_REFERER'] );
		}

		wp_safe_redirect( ! empty( $referer ) ? $referer : home_url() );
		exit;
	}

	/**
	 * Retrieves the list of currencies selected in the plugin settings.
	 *
	 * @return array List of selected currency codes.
	 */
	private function get_currencies_setting_selected() {
		$currencies = $this->core_plugin->get_gateway_setting( 'multicurrency_active_currencies' );		

		return $currencies ? $currencies : array();
	}

	/**
	 * Sets the selected currency for the user.
	 *
	 * @param string $selected Selected currency code.
	 * @param bool   $save     Whether to persist the selection.
	 *
	 * @return void
	 */
	private function set_currency_user_selected( $selected, $save = false ) {
		$this->currency_selected = $selected;
		$available               = $this->get_currencies_setting_selected();
		array_push( $available, $this->original_currency );

		if ( false === array_search( $this->currency_selected, $available, true ) ) {
			$this->currency_selected = $this->original_currency;
			$save                    = true;
		}

		if ( $save ) {
			$this->set_cookie( self::COOKIE_CURRENCY_NAME, $this->currency_selected );
			$this->save_to_user( $this->currency_selected );
		}

		$this->currency_config = null;
	}

	/**
	 * Saves the selected currency to the user's metadata (if logged in).
	 *
	 * @param string $currency Currency code to save.
	 *
	 * @return void
	 */
	public function save_to_user( $currency ) {
		if ( is_user_logged_in() ) {
			update_user_meta(
				get_current_user_id(),
				'_mastercard_wc_currency_' . get_current_blog_id(),
				$currency
			);
		}
	}

	/**
	 * Sets a cookie with the given name and value.
	 *
	 * @param string $name     Cookie name.
	 * @param string $value    Cookie value.
	 * @param int    $duration Expiration timestamp. Default is 0 (session).
	 * @param string $path     Cookie path. Default is '/'.
	 *
	 * @return bool True on success, false on failure.
	 */
	public function set_cookie( $name, $value, $duration = 0, $path = '/' ) {
		$_COOKIE[ $name ] = $value;
		return setcookie( $name, $value, $duration, $path );
	}


	/**
	 * Multicurrency Selector Shortcode. Avalaible only when multicurrency is ready.
	 *
	 * @return string
	 */
	public function add_multicurrency_shortcode() {
		if ( $this->is_multicurrency_enabled() ) {
			$this->render_multicurrency_selector();
		}
		return '';
	}

	/**
	 * Render the multicurrency selector.
	 * 
	 * @return void
	 */
	public function render_multicurrency_selector() {
		$this->core_plugin->payment_core()->template()->get(
			'multicurrency-selector.php',
			array(
				'multicurrency'     => $this,
				'options'           => $this->get_currencies_setting_selected(),
				'original_currency' => $this->original_currency,
				'currency_selected' => $this->get_currency_user_selected(),
				'allowed'           => 'all',
			)
		);
	}

	/**
	 * Outputs the nonce field for currency change form.
	 *
	 * @return void
	 */
	public function nonce_field() {
		add_filter( 'nonce_user_logged_out', '__return_zero' );
		wp_nonce_field( 'mastercard-multicurrency-nonce' );
		remove_filter( 'nonce_user_logged_out', '__return_zero' );
	}


	public function verify_nonce() {
		add_filter( 'nonce_user_logged_out', '__return_zero' );
		$ret = wp_verify_nonce( $_REQUEST['_wpnonce'], 'mastercard-multicurrency-nonce' );
		remove_filter( 'nonce_user_logged_out', '__return_zero' );
		return $ret;
	}

	/**
	 * Returns mock currency settings.
	 *
	 * @return string
	 */
	private function get_currency_settings() {
		if ( isset( $this->$currency_config ) ) {
			return $this->$currency_config;
		}

		$currency_code = self::get_currency_user_selected();

		$locale_info     = include WC()->plugin_path() . '/i18n/locale-info.php';
		$currency_config = array();
		$default_data    = array(
			'currency_code' => $currency_code,
			'currency_pos'  => 'left',
			'decimal_sep'   => '.',
			'num_decimals'  => 2,
			'thousand_sep'  => ',',
		);

		foreach ( array( 'CLP', 'JPY', 'ISK', 'KRW', 'VND', 'XOF' ) as $no_dec_curr ) {
			$currency_config[ $no_dec_curr ]                 = $default_data;
			$currency_config[ $no_dec_curr ]['num_decimals'] = 0;
		}

		foreach ( $locale_info as $country => $data ) {
			$currency_config[ $data['currency_code'] ] = array_intersect_key(
				wp_parse_args(
					$data,
					$default_data
				),
				$default_data
			);
		}

		$currency_config = isset( $currency_config[ $currency_code ] ) ? $currency_config[ $currency_code ] : $default_data;

		$this->$currency_config = $currency_config;

		return $currency_config;
	}

	/**
	 * Gets the saved currency from user metadata if available.
	 *
	 * @return string|false
	 */
	private function get_user_saved_currency() {
		$currency = false;

		if ( is_null( $currency ) && is_user_logged_in() ) {
			$currency = get_user_meta( get_current_user_id(), '_mastercard_wc_currency_' . get_current_blog_id(), true );
		}

		return ! empty( $currency ) ? $currency : false;
	}

	/**
	 * Gets the currently selected currency for the user.
	 *
	 * @return string
	 */
	public function get_currency_user_selected() {
		if ( isset( $this->currency_selected ) ) {
			return $this->currency_selected;
		} elseif ( $this->get_user_saved_currency() ) {
			$save = isset( $_COOKIE[ self::COOKIE_CURRENCY_NAME ] ) && ( $this->get_user_saved_currency() !== $_COOKIE[ self::COOKIE_CURRENCY_NAME ] );
			$this->set_currency_user_selected( $this->get_user_saved_currency(), $save );
		} elseif ( isset( $_COOKIE[ self::COOKIE_CURRENCY_NAME ] ) ) {
			$this->set_currency_user_selected( $_COOKIE[ self::COOKIE_CURRENCY_NAME ] );
		} else {
			$this->set_currency_user_selected( $this->original_currency );
		}

		return $this->currency_selected;
	}


	/**
	 * Enqueue multicurrency js only if it is active.
	 * @param $args
	 *
	 * @return array
	 */
	public function add_multicurrency_js( $args ) {
		if ( $this->is_multicurrency_enabled() ) {
			$args[ $this->core_plugin->payment_core()->prefix_hook( 'multicurrency' ) ] = array(
				'src'  => $this->core_plugin->assets_controller()->localize_asset( 'js/frontend/multicurrency.js' ),
				'data' => array(
					'ajax_url'    => 'adsf',
					'cookie_name' => '123',
				),
			);
		}
		return $args;
	}
}
