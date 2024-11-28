<?php
/**
 * Mpgs Plugin abstract class.
 *
 * @package  MPGSCore
 * @version  1.0.0
 */

namespace MPGSCore;

use MPGSCore\Admin\GatewaySettings;
use MPGSCore\Admin\Notices;

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
	 * Gateway settings instance.
	 *
	 * @var Admin\GatewaySettings
	 */
	private $gateway_settings;


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
	 * @return array
	 */
	public function registered_gateways() {
		return $this->registered_gateways;
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

		return array_merge( $methods, $this->registered_gateways );
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
}
