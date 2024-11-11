<?php
/**
 * Utility methods
 *
 * @class       Utils
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Utils class
 */
final class Utils {


	/**
	 * Main instance prefix.
	 *
	 * @var string
	 */
	private $prefix = '';


	/**
	 * Constructor.
	 *
	 * @param string $prefix Main instance prefix.
	 */
	public function __construct( $prefix ) {
		$this->prefix = $prefix;
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
		return untrailingslashit( plugins_url( '/', Main::instance( $this->prefix )->plugin_file() ) );
	}


	/**
	 * Get the core package url.
	 *
	 * @return string
	 */
	public function core_package_url() {
		return untrailingslashit( plugins_url( '/', Main::instance( $this->prefix )->core_plugin_file() ) );
	}


	/**
	 * Get the plugin path.
	 *
	 * @return string
	 */
	public function plugin_path() {
		return untrailingslashit( plugin_dir_path( Main::instance( $this->prefix )->plugin_file() ) );
	}


	/**
	 * Get the core package path.
	 *
	 * @return string
	 */
	public function core_package_path() {
		return untrailingslashit( plugin_dir_path( Main::instance( $this->prefix )->core_plugin_file() ) );
	}


	/**
	 * Get the template path.
	 *
	 * @return string
	 */
	public function template_path() {
		// Allow 3rd party plugin filter template path from their plugin.
		return apply_filters( Main::instance( $this->prefix )->prefix_hook( 'template_path' ), 'mpgs-core/' );
	}


	/**
	 * Get Ajax URL.
	 *
	 * @return string
	 */
	public function ajax_url() {
		return admin_url( 'admin-ajax.php', 'relative' );
	}
}
