<?php
/**
 * Main class.
 *
 * @package  GatewayPaymentCore
 * @version  1.0.0
 */

namespace GatewayPaymentCore;

use GatewayPaymentCore\Admin\Notices;

/**
 * Base Plugin class holding generic functionality
 */
final class Main {

	/**
	 * Set the minimum required versions for the plugin.
	 */
	const PLUGIN_REQUIREMENTS = array(
		'php_version' => '7.3',
		'wp_version'  => '5.6',
		'wc_version'  => '5.3',
	);

	/**
	 * Plugin instance.
	 *
	 * @var Main
	 */
	private static $instance;


	/**
	 * Instance's prefix.
	 *
	 * @var string
	 */
	private $prefix = '';


	/**
	 * Template class instance.
	 *
	 * @var Template[]
	 */
	private $template;


	/**
	 * Utils class instance.
	 *
	 * @var Utils[]
	 */
	private $utils;


	/**
	 * Core instance.
	 *
	 * @param string $prefix Prefix for the instance.
	 *
	 * @return Main|null
	 */
	public static function instance( $prefix = '' ) {

		if ( empty( $prefix ) ) {
			return;
		}

		if ( empty( self::$instance[ $prefix ] ) ) {
			self::$instance[ $prefix ] = new self( $prefix );
		}
		return self::$instance[ $prefix ];
	}


	/**
	 * Constructor.
	 *
	 * @param string $prefix Prefix for the instance.
	 */
	public function __construct( $prefix ) {

		if ( empty( $prefix ) ) {
			return;
		}

		$this->prefix = $prefix;

		$this->init_classes();

		add_action( 'plugins_loaded', array( $this, 'load' ) );
	}


	/**
	 * Cloning is forbidden.
	 *
	 * @since 1.0.0
	 */
	public function __clone() {
		_doing_it_wrong( __FUNCTION__, esc_html__( 'Cheatin&#8217; huh?', $this->text_domain() ), '1.0.0' );
	}


	/**
	 * Unserializing instances of this class is forbidden.
	 *
	 * @since 1.0.0
	 */
	public function __wakeup() {
		_doing_it_wrong( __FUNCTION__, esc_html__( 'Cheatin&#8217; huh?', $this->text_domain() ), '1.0.0' );
	}


	/**
	 * Get the instance prefix.
	 *
	 * @return string
	 */
	public function get_prefix() {
		return $this->prefix;
	}


	/**
	 * Include plugins files and hook into actions and filters.
	 *
	 * @since  1.0.0
	 */
	public function load() {

		if ( ! $this->check_plugin_requirements() ) {
			return;
		}

		add_action( 'woocommerce_init', array( $this, 'woocommerce_init' ), 1 );

		add_action( 'init', array( $this, 'init' ) );

		// Init action.
		do_action( $this->prefix_hook( 'loaded' ) );
	}


	/**
	 * WooCommerce init.
	 *
	 * @return void
	 */
	public function woocommerce_init() {
		// Init hooks.
		Gateway::init();
	}


	/**
	 * Method called by init hook
	 *
	 * @return void
	 */
	public function init() {
		// After init action.
		do_action( $this->prefix_hook( 'init' ) );
	}


	/**
	 * Init child classes of this instance.
	 *
	 * @return void
	 */
	public function init_classes() {

		if ( ! $this->prefix ) {
			return;
		}

		$this->template[ $this->prefix ] = new Template( $this );
		$this->utils[ $this->prefix ]    = new Utils( $this );
	}


	/**
	 * Checks all plugin requirements. If run in admin context also adds a notice.
	 *
	 * @return boolean
	 */
	private function check_plugin_requirements() {

		$errors = array();
		global $wp_version;

		if ( ! version_compare( PHP_VERSION, self::PLUGIN_REQUIREMENTS['php_version'], '>=' ) ) {
			/* Translators: 1: The Plugin's Name 2: The minimum PHP version */
			$errors[] = sprintf( esc_html__( '%1$s requires a minimum PHP version of %2$s.', $this->text_domain() ), $this->plugin_title(), self::PLUGIN_REQUIREMENTS['php_version'] );
		}

		if ( ! version_compare( $wp_version, self::PLUGIN_REQUIREMENTS['wp_version'], '>=' ) ) {
			/* Translators: 1: The Plugin's Name 2: The minimum WP version */
			$errors[] = sprintf( esc_html__( '%1$s requires a minimum WordPress version of %2$s.', $this->text_domain() ), $this->plugin_title(), self::PLUGIN_REQUIREMENTS['wp_version'] );
		}

		if ( isset( self::PLUGIN_REQUIREMENTS['wc_version'] ) && ( ! defined( 'WC_VERSION' ) || ! version_compare( WC_VERSION, self::PLUGIN_REQUIREMENTS['wc_version'], '>=' ) ) ) {
			/* Translators: 1: The Plugin's Name 2: The minimum WC version */
			$errors[] = sprintf( esc_html__( '%1$s requires a minimum WooCommerce version of %2$s.', $this->text_domain() ), $this->plugin_title(), self::PLUGIN_REQUIREMENTS['wc_version'] );
		}

		if ( empty( $errors ) ) {
			return true;
		}

		if ( Utils::is_request( 'admin' ) ) {

			add_action(
				'admin_notices',
				function () use ( $errors ) {
					foreach ( $errors as $error ) {
						Notices::render_admin_notice( $error );
					}
				}
			);

			return false;
		}

		return false;
	}


	/**
	 * Get the plugin file.
	 *
	 * @return string
	 */
	public function plugin_file() {
		return apply_filters( $this->prefix_hook( 'plugin_file' ), __FILE__ );
	}


	/**
	 * Core plugin file.
	 *
	 * @return string
	 */
	public function core_plugin_file() {
		return apply_filters( $this->prefix_hook( 'core_plugin_file' ), __DIR__ . '../payment-core.php' );
	}


	/**
	 * Get the plugin version.
	 *
	 * @return string
	 */
	public static function version() {
		return apply_filters( 'payment_core_version', CORE_VERSION );
	}


	/**
	 * Plugin's title.
	 *
	 * @return string
	 */
	public function plugin_title() {
		return apply_filters( $this->prefix_hook( 'plugin_title' ), 'Payment Core' );
	}


	/**
	 * Get the translation domain.
	 *
	 * @return string
	 */
	public function text_domain() {
		return apply_filters( $this->prefix_hook( '_text_domain' ), 'payment-core' );
	}


	/**
	 * Get prefixed hook name.
	 *
	 * @param string $hook      The name of the hook.
	 * @param string $prefix    Prefix for the hook.
	 * @param string $separator Separator for the hook.
	 */
	public function prefix_hook( $hook, $prefix = '', $separator = '_' ) {
		return $prefix . $this->prefix . $separator . $hook;
	}


	/**
	 * Get the template instance.
	 *
	 * @return Template
	 */
	public function template() {
		if ( ! $this->template[ $this->prefix ] ) {
			$this->template[ $this->prefix ] = new Template( $this );
		}

		return $this->template[ $this->prefix ];
	}


	/**
	 * Get the utils instance.
	 *
	 * @return Utils
	 */
	public function utils() {
		if ( ! $this->utils[ $this->prefix ] ) {
			$this->utils[ $this->prefix ] = new Utils( $this );
		}

		return $this->utils[ $this->prefix ];
	}
}
