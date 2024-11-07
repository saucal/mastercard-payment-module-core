<?php
/**
 * Main class.
 *
 * @package  MPGSCore
 * @version  1.0.0
 */

namespace MPGSCore;

use MPGSCore\Admin\Main as Admin;
use MPGSCore\Front\Main as Front;


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
	 * MPGS Core instance.
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

		$this->prefix = $prefix;

		register_activation_hook( $this->plugin_file(), array( Install::class, 'install' ) );

		add_action( 'plugins_loaded', array( __CLASS__, 'load' ) );

		add_action( 'init', array( __CLASS__, 'init' ) );

		// Perform other actions when plugin is loaded.
		do_action( 'mpgs_core_loaded' );
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
	public static function load() {

		if ( ! self::check_plugin_requirements() ) {
			return;
		}

		if ( Utils::is_request( 'admin' ) ) {
			Admin::hooks();
		}

		if ( Utils::is_request( 'frontend' ) ) {
			Front::hooks();
		}

		// Init action.
		do_action( 'mpgs_core_loaded' );
	}


	/**
	 * Method called by init hook
	 *
	 * @return void
	 */
	public static function init() {

		// Before init action.
		do_action( 'before_mpgs_core_init' );

		// Add needed hooks here.

		// After init action.
		do_action( 'mpgs_core_init' );
	}


	/**
	 * Checks all plugin requirements. If run in admin context also adds a notice.
	 *
	 * @return boolean
	 */
	private static function check_plugin_requirements() {

		$errors = array();
		global $wp_version;

		if ( ! version_compare( PHP_VERSION, self::PLUGIN_REQUIREMENTS['php_version'], '>=' ) ) {
			/* Translators: The minimum PHP version */
			$errors[] = sprintf( esc_html__( 'MPGS Core requires a minimum PHP version of %s.', $this->text_domain() ), self::PLUGIN_REQUIREMENTS['php_version'] );
		}

		if ( ! version_compare( $wp_version, self::PLUGIN_REQUIREMENTS['wp_version'], '>=' ) ) {
			/* Translators: The minimum WP version */
			$errors[] = sprintf( esc_html__( 'MPGS Core requires a minimum WordPress version of %s.', $this->text_domain() ), self::PLUGIN_REQUIREMENTS['wp_version'] );
		}

		if ( isset( self::PLUGIN_REQUIREMENTS['wc_version'] ) && ( ! defined( 'WC_VERSION' ) || ! version_compare( WC_VERSION, self::PLUGIN_REQUIREMENTS['wc_version'], '>=' ) ) ) {
			/* Translators: The minimum WC version */
			$errors[] = sprintf( esc_html__( 'MPGS Core requires a minimum WooCommerce version of %s.', $this->text_domain() ), self::PLUGIN_REQUIREMENTS['wc_version'] );
		}

		if ( empty( $errors ) ) {
			return true;
		}

		if ( Utils::is_request( 'admin' ) ) {

			add_action(
				'admin_notices',
				function () use ( $errors ) {
					?>
					<div class="notice notice-error">
						<?php
						foreach ( $errors as $error ) {
							echo '<p>' . esc_html( $error ) . '</p>';
						}
						?>
					</div>
					<?php
				}
			);

			return;
		}

		return false;
	}


	/**
	 * Get the plugin file.
	 *
	 * @return string
	 */
	public function plugin_file() {
		return apply_filters( $this->prefix_hook( 'plugin_file' ), MPGS_CORE_FILE );
	}


	/**
	 * Get the plugin version.
	 *
	 * @return string
	 */
	public static function version() {
		return apply_filters( 'mpgs_core_version', MPGS_CORE_VERSION );
	}


	/**
	 * Get the translation domain.
	 *
	 * @return string
	 */
	public function text_domain() {
		return apply_filters( $this->prefix_hook( '_text_domain' ), 'mpgs-core' );
	}


	/**
	 * Get prefixed hook name.
	 *
	 * @param string $hook The name of the hook.
	 */
	public function prefix_hook( $hook ) {
		return $this->prefix . '_' . $hook;
	}
}
