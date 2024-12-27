<?php
/**
 * Mpgs Plugin abstract class.
 *
 * @package  MPGSCore
 * @version  1.0.0
 */

namespace MPGSCore;

use MPGSCore\Admin\CapturePaymentMetaBox;
use MPGSCore\Admin\GatewaySettings;
use MPGSCore\Admin\Notices;
use MPGSCore\Compat\BlockCompatibility;
use MPGSCore\Gateways\WC_Abstract_MPGS_Payment_Gateway;
use WC_Order;

/**
 * Abstract class for child MPGS plugins.
 */
abstract class MpgsPlugin {

	/**
	 * MPGS Core instance.
	 *
	 * @var Main
	 */
	protected $mpgs_core;


	/**
	 * Plugin ID.
	 *
	 * @var string
	 */
	protected $plugin_id;


	/**
	 * Text domain.
	 *
	 * @var string
	 */
	protected $text_domain;


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
	 * @var Compat\Block_Compatibility
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
	 * @var MpgsCore\Assets
	 */
	private $assets_controller;


	/**
	 * Logger class instance.
	 *
	 * @var Logger
	 */
	private $logger;


	/**
	 * Constructor
	 */
	public function __construct() {
		$this->init();

		// Validate that the plugin is correctly setup.
		if ( ! $this->is_valid() ) {
			return;
		}

		$this->notices           = new Notices( $this );
		$this->logger            = new Logger( $this );
		$this->assets_controller = new Assets( $this );

		if ( ! $this->load_mpgs_core() || empty( $this->plugin_id() ) ) {
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
	}


	/**
	 * Initialize the plugin.
	 *
	 * @return void
	 */
	abstract public function init();


	/**
	 * Is valid instance?
	 *
	 * @return bool
	 */
	private function is_valid() {
		return ! empty( $this->plugin_id() ) && ! empty( $this->text_domain() ) && ! empty( $this->plugin_file() ) && ! empty( $this->core_plugin_file() ) && ! empty( $this->plugin_title() );
	}


	/**
	 * Get the MPGS Core instance.
	 *
	 * @return Main
	 */
	public function mpgs_core() {
		return $this->mpgs_core;
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
		return $this->text_domain;
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
		return $this->plugin_title;
	}


	/**
	 * Register the payment gateways.
	 *
	 * @return WC_Abstract_MPGS_Payment_Gateway[]
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

		foreach ( $this->registered_gateways() as $gateway ) {
			$instance                         = new $gateway( $this );
			$mapped_gateways[ $instance->id ] = $instance->block_compat_class();
		}

		return $mapped_gateways;
	}


	/**
	 * Install hooks.
	 *
	 * @return void
	 */
	public function install() {
		do_action( $this->mpgs_core()->prefix_hook( 'installed' ) );
	}


	/**
	 * Load the MPGSCore package.
	 *
	 * @return bool
	 */
	private function load_mpgs_core() {
		if ( ! file_exists( dirname( $this->plugin_file() ) . '/packages/mpgs-core/mpgs-core.php' ) ) {
			add_action( 'admin_notices', array( $this->notices(), 'missing_mpgs_core_notice' ) );
			return false;
		}

		return include_once dirname( $this->plugin_file() ) . '/packages/mpgs-core/mpgs-core.php';
	}


	/**
	 * Initialize the MPGS Core instance.
	 */
	private function init_core_instance() {
		$this->mpgs_core = Main::instance( $this->plugin_id() );

		// Add filters for the core class.
		add_filter( $this->mpgs_core()->prefix_hook( 'plugin_file' ), array( $this, 'plugin_file' ) );
		add_filter( $this->mpgs_core()->prefix_hook( 'core_plugin_file' ), array( $this, 'core_plugin_file' ) );
		add_filter( $this->mpgs_core()->prefix_hook( 'plugin_title' ), array( $this, 'plugin_title' ) );
		add_filter( $this->mpgs_core()->prefix_hook( 'text_domain' ), array( $this, 'text_domain' ) );

		// Register the payment gateways.
		add_filter( 'mpgs_core_payment_gateways', array( $this, 'add_gateways' ) );
	}


	/**
	 * Maybe redirect to the settings page on first activation.
	 *
	 * @return void
	 */
	public function maybe_redirect_to_settings() {
		$already_redirected = get_option( $this->mpgs_core()->prefix_hook( 'installed', 'woocommerce_' ) );

		if ( $already_redirected ) {
			return;
		}

		update_option( $this->mpgs_core()->prefix_hook( 'installed', 'woocommerce_' ), true );

		// Redirect to the settings page.
		exit( wp_safe_redirect( $this->settings_url() ) );
	}


	/**
	 * Include plugins files and hook into actions and filters.
	 *
	 * @since  1.0.0
	 */
	public function load() {

		// Load Localisation files.
		$this->load_plugin_textdomain();

		add_filter( 'plugin_action_links_' . plugin_basename( $this->plugin_file() ), array( $this, 'plugin_action_links' ) );

		// Gateway AJAX actions.
		add_action( 'wc_ajax_' . $this->mpgs_core->prefix_hook( 'reset_hosted_session' ), array( $this, 'maybe_clean_hosted_cached_session' ) );
	}


	/**
	 * Load Localisation files.
	 */
	public function load_plugin_textdomain() {

		// Add plugin's locale.
		$locale = apply_filters( 'plugin_locale', get_locale(), $this->text_domain() );

		load_textdomain(
			$this->text_domain(),
			sprintf(
				'%1$s/%2$s/%2$s-%3$s.mo',
				WP_LANG_DIR,
				$this->text_domain(),
				$locale,
			)
		);

		load_plugin_textdomain( $this->text_domain(), false, plugin_basename( __DIR__ ) . '/i18n/languages' );
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
				__( 'Settings', $this->text_domain() )
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

		foreach ( $this->registered_gateways as $gateway ) {
			if ( ! class_exists( $gateway ) || ! is_subclass_of( $gateway, 'MPGSCore\Gateways\WC_Abstract_MPGS_Payment_Gateway' ) ) {
				continue;
			}

			$gateway_instance = new $gateway( $this );
			$this->registered_gateway_instances[ $gateway_instance->id ] = $gateway_instance;
		}

		return array_merge( $methods, $this->registered_gateway_instances );
	}


	/**
	 * Get registered payment gateways instances.
	 *
	 * @return WC_Abstract_MPGS_Payment_Gateway[]
	 */
	public function registered_gateway_instances() {
		return $this->registered_gateway_instances ?? array();
	}


	/**
	 * Get registered payment gateways instance.
	 *
	 * @param string $gateway_id Gateway ID.
	 *
	 * @return WC_Abstract_MPGS_Payment_Gateway|null
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
			if ( is_a( $gateway_instance, 'MPGSCore\Gateways\\' . $gateway_class ) ) {
				return $gateway_instance->id;
			}
		}
	}


	/**
	 * Get the block compatibility instance.
	 *
	 * @return Compat\BlockCompatibility
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
		static $settings = array();

		if ( ! empty( $settings ) ) {
			return $settings;
		}

		$settings = get_option( 'woocommerce_' . $this->plugin_id() . '_settings', array() );

		return $settings;
	}


	/**
	 * Get gateway specific setting.
	 *
	 * @param  string $key Setting key.
	 *
	 * @return mixed
	 */
	public function get_gateway_setting( $key ) {
		$settings = $this->get_gateway_settings();

		return isset( $settings[ $key ] ) ? $settings[ $key ] : '';
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
	 * @return bool
	 */
	public function is_sandbox() {
		return ( $this->is_enabled() && ! $this->get_validated_credentials() ) || ( 'yes' === $this->get_gateway_setting( 'sandbox' ) );
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
	 * Get the gateway URL.
	 *
	 * @return string
	 */
	public function gateway_url() {
		$gateway_url = $this->gateway_settings()->payment_region_url( $this->get_gateway_setting( 'region' ) );

		if ( defined( 'MPGS_GATEWAY_URL' ) && ! empty( \MPGS_GATEWAY_URL ) ) {
			$gateway_url = \MPGS_GATEWAY_URL;
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
	 * Maybe clean hosted cached session.
	 *
	 * @return void
	 */
	public function maybe_clean_hosted_cached_session() {
		foreach ( WC()->payment_gateways->get_available_payment_gateways() as $gateway ) {
			if ( ! is_a( $gateway, 'MPGSCore\Gateways\WC_Abstract_MPGS_Payment_Gateway_CC' ) ) {
				continue;
			}
			$gateway->maybe_clean_hosted_cached_session();
		}
	}


	/**
	 * Check if the order was paid with a plugin's payment method.
	 *
	 * @param WC_Order $order The order.
	 *
	 * @return bool
	 */
	public function is_mpgs_order( $order ) {
		return $order instanceof WC_Order && $this->registered_gateway_instance( $order->get_payment_method() );
	}


	/**
	 * Get the gateway instance of the order.
	 *
	 * @param WC_Order $order The order.
	 *
	 * @return WC_Abstract_MPGS_Payment_Gateway|bool
	 */
	public function get_order_gateway_instance( $order ) {
		if ( ! $this->is_mpgs_order( $order ) ) {
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
		if ( ! $this->is_mpgs_order( $order ) ) {
			return 0;
		}

		try {
			return $this->registered_gateway_instance( $order->get_payment_method() )->get_authorized_amount( $order );
		} catch ( \Exception $e ) {
			return 0;
		}
	}
}
