<?php
/**
 * Core plugin abstract class.
 *
 * @package  GatewayPaymentCore
 * @version  1.0.0
 */

namespace GatewayPaymentCore;

// If this file is called directly, abort.
if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

use GatewayPaymentCore\Admin\CapturePaymentMetaBox;
use GatewayPaymentCore\Admin\GatewaySettings;
use GatewayPaymentCore\Admin\Notices;
use GatewayPaymentCore\Compat\BlockCompatibility;
use GatewayPaymentCore\Gateways\WC_Abstract_Payment_Gateway;
use WC_Order;

/**
 * Abstract class for child plugins.
 */
abstract class CorePlugin {

	/**
	 * Core instance.
	 *
	 * @var Main
	 */
	protected $payment_core;


	/**
	 * Plugin ID.
	 *
	 * @var string
	 */
	protected $plugin_id;



	/**
	 * Plugin file.
	 *
	 * @var string
	 */
	protected $plugin_file;


	/**
	 * Core plugin file.
	 *
	 * @var string
	 */
	protected $core_plugin_file;


	/**
	 * Plugin title.
	 *
	 * @var string
	 */
	protected $plugin_title;


	/**
	 * Merchant Registration URL.
	 *
	 * @var string
	 */
	protected $merchant_registration_url = '';


	/**
	 * Partner Solution ID.
	 *
	 * @var string
	 */
	protected $partner_solution_id = '';


	/**
	 * Registered payment gateways.
	 *
	 * @var array
	 */
	protected $registered_gateways;


	/**
	 * Registered payment gateways instances.
	 *
	 * @var array
	 */
	protected $registered_gateway_instances;


	/**
	 * Gateway settings instance.
	 *
	 * @var Admin\GatewaySettings
	 */
	private $gateway_settings;


	/**
	 * Capture payment meta box instance.
	 *
	 * @var Admin\CapturePaymentMetaBox
	 */
	private $capture_payment_meta;


	/**
	 * Blocks compatibility instance.
	 *
	 * @var BlockCompatibility
	 */
	private $block_compatibility;


	/**
	 * Notices class instance.
	 *
	 * @var Admin\Notices
	 */
	private $notices;


	/**
	 * Assets class instance.
	 *
	 * @var \GatewayPaymentCore\Assets
	 */
	private $assets_controller;


	/**
	 * Logger class instance.
	 *
	 * @var Logger
	 */
	private $logger;


	/**
	 * API class instance.
	 *
	 * @var API
	 */
	private $api;


	/**
	 * Gateway settings.
	 *
	 * @var array
	 */
	private $settings = array();


	/**
	 * Constructor
	 */
	public function __construct() {
		$this->init();

		// Validate that the plugin is correctly setup.
		if ( ! $this->is_valid() ) {
			return;
		}

		$this->core_plugin_file = dirname( $this->plugin_file() ) . '/packages/payment-core/payment-core.php';

		if ( ! file_exists( $this->core_plugin_file ) ) {
			return;
		}

		$this->notices           = new Notices( $this );
		$this->logger            = new Logger( $this );
		$this->assets_controller = new Assets( $this );

		if ( ! $this->load_payment_core() || empty( $this->plugin_id() ) ) {
			return;
		}

		$this->init_core_instance();

		$this->gateway_settings = new GatewaySettings( $this );

		if ( $this->is_merchant_connected() ) {
			$this->capture_payment_meta = new CapturePaymentMetaBox( $this );
			$this->block_compatibility  = new BlockCompatibility( $this );
		}

		register_activation_hook( $this->plugin_file(), array( $this, 'install' ) );

		// Activation hook.
		add_action( 'admin_init', array( $this, 'maybe_redirect_to_settings' ) );

		// Load the plugin.
		add_action( 'plugins_loaded', array( $this, 'load' ) );

		// Declare compatibility with WooCommerce Blocks and HPOS.
		add_action(
			'before_woocommerce_init',
			function () {
				if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
					\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', $this->plugin_file(), true );
					\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', $this->plugin_file(), true );
				}
			}
		);
	}


	/**
	 * Initialize the plugin.
	 *
	 * @return void
	 */
	abstract public function init();


	/**
	 * Get the plugin's title.
	 *
	 * @return string
	 */
	abstract public function get_plugin_title();


	/**
	 * Is valid instance?
	 *
	 * @return bool
	 */
	private function is_valid() {
		return ! empty( $this->plugin_id() ) && ! empty( $this->text_domain() ) && ! empty( $this->plugin_file() );
	}


	/**
	 * Get the Core instance.
	 *
	 * @return Main
	 */
	public function payment_core() {
		return $this->payment_core;
	}


	/**
	 * Get the plugin ID.
	 *
	 * @return string
	 */
	public function plugin_id() {
		return $this->plugin_id;
	}


	/**
	 * Get the translation domain.
	 *
	 * @return string
	 */
	public function text_domain() {
		return '__PAYMENTS_CORE_TEXT_DOMAIN__';
	}


	/**
	 * Get the plugin file.
	 *
	 * @return string
	 */
	public function plugin_file() {
		return $this->plugin_file;
	}


	/**
	 * Get the core plugin file.
	 *
	 * @return string
	 */
	public function core_plugin_file() {
		return $this->core_plugin_file;
	}


	/**
	 * Get the plugin title.
	 *
	 * @return string
	 */
	public function plugin_title() {
		return $this->get_plugin_title();
	}


	/**
	 * Get the merchant registration URL.
	 *
	 * @return string
	 */
	public function merchant_registration_message() {
		$message = __( 'Enter your Merchant Account details.', '__PAYMENTS_CORE_TEXT_DOMAIN__' );

		if ( ! empty( $this->merchant_registration_url ) ) {
			$message .= ' ' . sprintf(
				/* translators: %s: Merchant registration URL */
				__( 'Don\'t have an account? %1$sSign up here%2$s', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				'<a href="' . esc_url( $this->merchant_registration_url ) . '" target="_blank">',
				'</a>'
			);
		}

		return $message;
	}


	/**
	 * Register the payment gateways.
	 *
	 * @return WC_Abstract_Payment_Gateway[]
	 */
	public function registered_gateways() {
		return $this->registered_gateways;
	}


	/**
	 * Get the mapped Woo Blocks compatibility payment methods.
	 *
	 * @return array
	 */
	public function regisreted_block_gateways() {
		$mapped_gateways = array();

		foreach ( $this->registered_gateways() as $gateway_id => $gateway ) {
			if ( empty( $this->registered_gateway_instances[ $gateway_id ] ) ) {
				$instance = new $gateway( $this );
				$this->registered_gateway_instances[ $gateway_id ] = $instance;
			}
			$mapped_gateways[ $gateway_id ] = $this->registered_gateway_instances[ $gateway_id ]->block_compat_class();
		}

		return $mapped_gateways;
	}


	/**
	 * Install hooks.
	 *
	 * @return void
	 */
	public function install() {
		/**
		 * Fires when the plugin is installed.
		 *
		 * @since 1.0.0
		 */
		do_action( 'PAYMENTS_CORE_HOOK_PREFIX_installed' );
	}


	/**
	 * Load the GatewayPaymentCore package.
	 *
	 * @return bool
	 */
	private function load_payment_core() {
		if ( ! file_exists( dirname( $this->plugin_file() ) . '/packages/payment-core/payment-core.php' ) ) {
			add_action( 'admin_notices', array( $this->notices(), 'missing_payment_core_notice' ) );
			return false;
		}

		return include_once dirname( $this->plugin_file() ) . '/packages/payment-core/payment-core.php';
	}


	/**
	 * Initialize the Core instance.
	 */
	private function init_core_instance() {
		$this->payment_core = Main::instance( $this->plugin_id() );

		// Add filters for the core class.
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_plugin_file', array( $this, 'plugin_file' ) );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_core_plugin_file', array( $this, 'core_plugin_file' ) );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_plugin_title', array( $this, 'plugin_title' ) );
		// Register the payment gateways.
		add_filter( 'payment_core_payment_gateways', array( $this, 'add_gateways' ) );
	}


	/**
	 * Maybe redirect to the settings page on first activation.
	 *
	 * @return void
	 */
	public function maybe_redirect_to_settings() {
		$already_redirected = get_option( 'woocommerce_PAYMENTS_CORE_HOOK_PREFIX_installed' );

		if ( $already_redirected ) {
			return;
		}

		update_option( 'woocommerce_PAYMENTS_CORE_HOOK_PREFIX_installed', true );

		// Redirect to the settings page.
		wp_safe_redirect( $this->settings_url() );
		exit();
	}


	/**
	 * Include plugins files and hook into actions and filters.
	 *
	 * @since  1.0.0
	 */
	public function load() {
		add_filter( 'plugin_action_links_' . plugin_basename( $this->plugin_file() ), array( $this, 'plugin_action_links' ) );
	}


	/**
	 * Add plugin action links.
	 *
	 * @param  array $links Plugin action links.
	 */
	public function plugin_action_links( $links ) {
		$plugin_links = array(
			sprintf(
				'<a href="%s">%s</a>',
				$this->settings_url(),
				__( 'Settings', '__PAYMENTS_CORE_TEXT_DOMAIN__' )
			),
		);

		return array_merge( $plugin_links, $links );
	}


	/**
	 * Get the settings page URL.
	 *
	 * @return string
	 */
	public function settings_url() {
		return ! empty( $this->plugin_id() ) ? add_query_arg(
			array(
				'page'    => 'wc-settings',
				'tab'     => 'checkout',
				'section' => $this->plugin_id(),
			),
			admin_url( 'admin.php' )
		) : '';
	}


	/**
	 * Add payment gateways.
	 *
	 * @param  array $methods Payment gateways.
	 *
	 * @return array
	 */
	public function add_gateways( $methods ) {
		if ( empty( $this->registered_gateways ) || ! is_array( $this->registered_gateways ) ) {
			return $methods;
		}

		foreach ( $this->registered_gateways as $gateway_id => $gateway ) {
			if ( ! class_exists( $gateway ) || ! is_subclass_of( $gateway, 'GatewayPaymentCore\Gateways\WC_Abstract_Payment_Gateway' ) ) {
				continue;
			}

			if ( ! empty( $this->registered_gateway_instances[ $gateway_id ] ) ) {
				continue;
			}

			$gateway_instance                                  = new $gateway( $this );
			$this->registered_gateway_instances[ $gateway_id ] = $gateway_instance;
		}

		return array_merge( $methods, $this->registered_gateway_instances );
	}


	/**
	 * Get registered payment gateways instances.
	 *
	 * @return WC_Abstract_Payment_Gateway[]
	 */
	public function registered_gateway_instances() {
		return $this->registered_gateway_instances ?? array();
	}


	/**
	 * Get registered payment gateways instance.
	 *
	 * @param string $gateway_id Gateway ID.
	 *
	 * @return WC_Abstract_Payment_Gateway|null
	 */
	public function registered_gateway_instance( $gateway_id ) {
		return $this->registered_gateway_instances[ $gateway_id ] ?? null;
	}


	/**
	 * Get the gateway ID from the classname.
	 *
	 * @param string $gateway_class Gateway class.
	 *
	 * @return string
	 */
	public function get_registered_payment_id( $gateway_class ) {
		foreach ( $this->registered_gateway_instances() as $gateway_instance ) {
			if ( is_a( $gateway_instance, 'GatewayPaymentCore\Gateways\\' . $gateway_class ) ) {
				return $gateway_instance->id;
			}
		}

		return '';
	}


	/**
	 * Get the block compatibility instance.
	 *
	 * @return BlockCompatibility
	 */
	public function block_compatibility() {
		return $this->block_compatibility;
	}


	/**
	 * Get the notices instance.
	 *
	 * @return Notices
	 */
	public function notices() {
		return $this->notices;
	}


	/**
	 * Get the assets controller instance.
	 *
	 * @return Assets
	 */
	public function assets_controller() {
		return $this->assets_controller;
	}


	/**
	 * Get the logger instance.
	 *
	 * @return Logger
	 */
	public function logger() {
		return $this->logger;
	}

	/**
	 * Get the API instance.
	 *
	 * @return API
	 */
	public function api() {
		if ( ! $this->api ) {
			$this->api = new API( $this );
		}

		return $this->api;
	}


	/**
	 * Get the Gateway settings instance.
	 *
	 * @return Admin\GatewaySettings
	 */
	public function gateway_settings() {
		return $this->gateway_settings;
	}


	/**
	 * Get the Capture Payment Meta Box instance.
	 *
	 * @return Admin\CapturePaymentMetaBox
	 */
	public function capture_payment_meta() {
		return $this->capture_payment_meta;
	}


	/**
	 * Get the gateway settings.
	 *
	 * @return array
	 */
	public function get_gateway_settings() {
		if ( ! empty( $this->settings ) ) {
			return $this->settings;
		}

		$this->settings = get_option( 'woocommerce_' . $this->plugin_id() . '_settings', array() );

		return $this->settings;
	}


	/**
	 * Get gateway specific setting.
	 *
	 * @param string $key Setting key.
	 *
	 * @return mixed
	 */
	public function get_gateway_setting( $key ) {
		$settings = $this->get_gateway_settings();

		return isset( $settings[ $key ] ) ? $settings[ $key ] : $this->gateway_settings()->get_default_setting( $key );
	}


	/**
	 * Update gateway settings.
	 *
	 * @param string $key   Setting key.
	 * @param mixed  $value Setting value.
	 *
	 * @return void
	 */
	public function update_gateway_setting( $key, $value ) {
		if ( empty( $key ) ) {
			return;
		}

		if ( empty( $this->settings ) ) {
			$this->get_gateway_settings();
		}

		$this->settings[ $key ] = $value;
	}


	/**
	 * Get the partner solution ID.
	 *
	 * @return string
	 */
	public function partner_solution_id() {
		return $this->partner_solution_id;
	}


	/**
	 * Get the merchant ID.
	 *
	 * @param bool $force Force refresh of the value.
	 *
	 * @return string
	 */
	public function merchant_id( $force = false ) {
		static $merchant_id;

		if ( ! empty( $merchant_id ) && ! $force ) {
			return $merchant_id;
		}

		$prefix = $this->is_sandbox( false ) ? 'test_' : '';

		$merchant_id = $this->get_gateway_setting( $prefix . 'merchant_id' );

		return $merchant_id;
	}


	/**
	 * Get the merchant password.
	 *
	 * @param bool $force Force refresh of the value.
	 *
	 * @return string
	 */
	public function password( $force = false ) {
		static $password;

		if ( ! empty( $password ) && ! $force ) {
			return $password;
		}

		$prefix = $this->is_sandbox( false ) ? 'test_' : '';

		$password = $this->get_gateway_setting( $prefix . 'password' );

		return $password;
	}


	/**
	 * Get the webhook notification secret.
	 *
	 * @param bool $force Force refresh of the value.
	 *
	 * @return string
	 */
	public function notification_secret( $force = false ) {
		static $notification_secret;

		if ( ! empty( $notification_secret ) && ! $force ) {
			return $notification_secret;
		}

		$prefix = $this->is_sandbox( false ) ? 'test_' : '';

		$notification_secret = $this->get_gateway_setting( $prefix . 'notification_secret' );

		return $notification_secret;
	}


	/**
	 * Get validated credentials.
	 *
	 * @return array
	 */
	public function get_validated_credentials() {
		return get_option( 'woocommerce_' . $this->plugin_id() . '_validated_credentials', false );
	}


	/**
	 * Update validated credentials.
	 *
	 * @param bool $validated_credentials Validated credentials.
	 */
	public function update_validated_credentials( $validated_credentials ) {
		update_option( 'woocommerce_' . $this->plugin_id() . '_validated_credentials', $validated_credentials );
	}


	/**
	 * Get validated domain.
	 *
	 * @return array
	 */
	public function get_validated_domain() {
		return get_option( 'woocommerce_' . $this->plugin_id() . '_validated_domain', false );
	}


	/**
	 * Update validated domain.
	 *
	 * @param bool $validated_domain Validated domain.
	 */
	public function update_validated_domain( $validated_domain ) {
		update_option( 'woocommerce_' . $this->plugin_id() . '_validated_domain', $validated_domain );
	}


	/**
	 * Get validated payment operations.
	 *
	 * @return array
	 */
	public function get_payment_operations() {
		return get_option( 'woocommerce_' . $this->plugin_id() . '_payment_operations', array() );
	}


	/**
	 * Save validated payment operations.
	 *
	 * @param array $options Payment operations.
	 */
	public function update_payment_operations( $options ) {
		update_option( 'woocommerce_' . $this->plugin_id() . '_payment_operations', $options );
	}


	/**
	 * Get validated transaction sources.
	 *
	 * @return array
	 */
	public function get_transaction_sources() {
		return get_option( 'woocommerce_' . $this->plugin_id() . '_transaction_sources', array() );
	}


	/**
	 * Save validated transaction sources.
	 *
	 * @param array $options Transaction sources.
	 */
	public function update_transaction_sources( $options ) {
		update_option( 'woocommerce_' . $this->plugin_id() . '_transaction_sources', $options );
	}


	/**
	 * Is the gateway enabled.
	 *
	 * @return bool
	 */
	public function is_enabled() {
		return ! empty( $this->get_gateway_setting( 'enabled' ) ) && 'yes' === $this->get_gateway_setting( 'enabled' ) ? true : false;
	}


	/**
	 * Is the merchant connected.
	 *
	 * @return bool
	 */
	public function is_merchant_connected() {
		return $this->is_enabled() && $this->get_validated_credentials();
	}


	/**
	 * Is sandbox mode enabled.
	 *
	 * @param bool $strict Whether to strictly check credentials.
	 *
	 * @return bool
	 */
	public function is_sandbox( $strict = true ) {
		return ( $strict && $this->is_enabled() && ! $this->get_validated_credentials() ) || ( 'yes' === $this->get_gateway_setting( 'sandbox' ) );
	}


	/**
	 * Is debug mode enabled.
	 *
	 * @return bool
	 */
	public function is_debug() {
		return 'yes' === $this->get_gateway_setting( 'debug' );
	}


	/**
	 * Is 3DS enabled.
	 *
	 * @return bool
	 */
	public function is_3ds_enabled() {
		return 'yes' === $this->get_gateway_setting( '_3d_secure' );
	}


	/**
	 * Is currency conversion enabled.
	 *
	 * @return bool
	 */
	public function is_currency_conversion_enabled() {
		// TODO: Make this function less relevate, or somehow pointed to the DCC addon.
		return 'yes' === $this->get_gateway_setting( 'currency_conversion' );
	}

	/**
	 * Get the payment regions available.
	 *
	 * @return array
	 */
	public function payment_regions_available() {
		return array(
			'eu'  => array(
				'name' => __( 'Europe', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				'code' => 'eu',
				'urls' => array(
					'https://eu-gateway.mastercard.com',
					'https://eu.gateway.mastercard.com',
				),
			),
			'ap'  => array(
				'name' => __( 'Asia Pacific and Middle East', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				'code' => 'ap',
				'urls' => array(
					'https://ap-gateway.mastercard.com',
					'https://ap.gateway.mastercard.com',
				),
			),
			'na'  => array(
				'name' => __( 'North America', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				'code' => 'na',
				'urls' => array(
					'https://na-gateway.mastercard.com',
					'https://na.gateway.mastercard.com',
				),
			),
			'ksa' => array(
				'name' => __( 'Kingdom of Saudi Arabia', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				'code' => 'ksa',
				'urls' => array(
					'https://ksa-gateway.mastercard.com',
					'https://ksa.gateway.mastercard.com',
				),
			),
			'in'  => array(
				'name' => __( 'India', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				'code' => 'in',
				'urls' => array(
					'https://in-gateway.mastercard.com',
					'https://in.gateway.mastercard.com',
				),
			),
		);
	}

	/**
	 * Get the payment regions including the test region.
	 *
	 * @return array
	 */
	public function payment_regions() {
		$list = $this->payment_regions_available();
		$list = array_merge( $list, $this->get_test_region() );
		return $list;
	}

	/**
	 * Get the test region.
	 *
	 * @return array
	 */
	public function get_test_region() {
		return array(
			'test' => array(
				'name' => __( 'Test Region', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				'code' => 'test',
				'urls' => array(
					'https://test-gateway.mastercard.com',
					'https://test.gateway.mastercard.com',
				),
			),
		);
	}

	/**
	 * Get payment region URL.
	 *
	 * @return string
	 */
	public function payment_region_url() {
		$url = $this->get_validated_domain();

		if ( empty( $url ) ) {
			return '';
		}

		return $url;
	}

	/**
	 * Get the gateway URL.
	 *
	 * @return string
	 */
	public function gateway_url() {
		$gateway_url = $this->payment_region_url();

		if ( defined( 'PAYMENT_CORE_GATEWAY_URL' ) && ! empty( \PAYMENT_CORE_GATEWAY_URL ) ) {
			$gateway_url = \PAYMENT_CORE_GATEWAY_URL;
		}

		return $gateway_url;
	}


	/**
	 * Get checkout mode.
	 *
	 * @return string
	 */
	public function get_checkout_mode() {
		$chosen_method = $this->get_gateway_setting( 'checkout_mode' );

		if ( ! in_array( $chosen_method, array_keys( $this->gateway_settings()->checkout_modes() ), true ) ) {
			$chosen_method = 'hosted_session';
		}

		return $chosen_method;
	}


	/**
	 * Check if the order was paid with a plugin's payment method.
	 *
	 * @param WC_Order $order The order.
	 *
	 * @return bool
	 */
	public function is_gateway_order( $order ) {
		return $order instanceof WC_Order && $this->registered_gateway_instance( $order->get_payment_method() );
	}


	/**
	 * Get the gateway instance of the order.
	 *
	 * @param WC_Order $order The order.
	 *
	 * @return WC_Abstract_Payment_Gateway|bool
	 */
	public function get_order_gateway_instance( $order ) {
		if ( ! $this->is_gateway_order( $order ) ) {
			return false;
		}

		return $this->registered_gateway_instance( $order->get_payment_method() );
	}


	/**
	 * Get the authorized amount pending of capture.
	 *
	 * @param WC_Order $order The order.
	 *
	 * @return float
	 */
	public function get_capturable_amount( $order ) {
		if ( ! $this->is_gateway_order( $order ) ) {
			return 0;
		}

		try {
			return $this->registered_gateway_instance( $order->get_payment_method() )->get_authorized_amount( $order );
		} catch ( \Exception $e ) {
			return 0;
		}
	}


	/**
	 * Check if the admin is viewing the settings page.
	 *
	 * @return bool
	 */
	public function is_settings_page() {
		// phpcs:disable WordPress.Security.NonceVerification
		return isset( $_GET['page'] ) && 'wc-settings' === $_GET['page'] && isset( $_GET['tab'] ) && 'checkout' === $_GET['tab'] && isset( $_GET['section'] ) && $this->plugin_id === $_GET['section'];
	}
}
