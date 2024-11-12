<?php
/**
 * Handle scripts register and enqueue.
 *
 * @class       Assets
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

use MPGSCore\Admin\Assets as Admin;
use MPGSCore\Front\Assets as Front;

/**
 * Main assets class
 */
class Assets {

	/**
	 * Contains an array of script handles registered by WC.
	 *
	 * @var array<string>
	 */
	private $scripts = array();

	/**
	 * Contains an array of script handles registered by WC.
	 *
	 * @var array<string>
	 */
	private $styles = array();

	/**
	 * Contains an array of script handles localized by WC.
	 *
	 * @var array<string>
	 */
	private $wp_localize_scripts = array();


	/**
	 * MPGS Core instance's prefix.
	 *
	 * @var string
	 */
	private $prefix;


	/**
	 * Admin assets controller.
	 *
	 * @var Admin\Assets
	 */
	private $admin_assets_controller;


	/**
	 * Front assets controller.
	 *
	 * @var Front\Assets
	 */
	private $front_assets_controller;


	/**
	 * Hook in methods.
	 *
	 * @param string $prefix Prefix of the MPGS Core instance.
	 */
	public function __construct( $prefix ) {

		if ( empty( $prefix ) ) {
			return;
		}

		$this->prefix = $prefix;

		$this->init_controllers();
	}


	/**
	 * Initialize assets controllers.
	 *
	 * @return void
	 */
	private function init_controllers() {
		if ( Utils::is_request( 'admin' ) ) {
			$this->admin_assets_controller = new Admin( $this->prefix );
		}

		if ( Utils::is_request( 'frontend' ) ) {
			$this->front_assets_controller = new Front( $this->prefix );
		}
	}


	/**
	 * Tryies to localize the minified version if required and exists, otherwise load the unminified version
	 *
	 * @param  string $path Path of the asset to locate.
	 * @return string
	 */
	public function localize_asset( $path ) {

		$assets_path     = Main::instance( $this->prefix )->utils()->core_package_path() . '/assets/';
		$assets_path_url = str_replace( array( 'http:', 'https:' ), '', Main::instance( $this->prefix )->utils()->core_package_url() ) . '/assets/';

		if ( ! ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ) {

			$ext_pos = strrpos( $path, '.' );

			if ( is_numeric( $ext_pos ) ) {

				$clean_path = substr( $path, 0, $ext_pos );
				$ext        = substr( $path, $ext_pos );
				$min_path   = $clean_path . '.min' . $ext;

				if ( file_exists( $assets_path . $min_path ) ) {
					$path = $min_path;
				}
			}
		}

		return $assets_path_url . $path;
	}


	/**
	 * Get styles for the frontend.
	 *
	 * @return array<string,array>
	 */
	public function get_styles() {
		// Allow to change the list of styles.
		return apply_filters( Main::instance( $this->prefix )->prefix_hook( 'enqueue_styles' ), array() );
	}


	/**
	 * Get styles for the frontend.
	 *
	 * @return array<string,array>
	 */
	public function get_scripts() {
		// Allow to change the list of scripts.
		return apply_filters( Main::instance( $this->prefix )->prefix_hook( 'enqueue_scripts' ), array() );
	}


	/**
	 * Register a script for use.
	 *
	 * @uses   wp_register_script()
	 * @param string      $handle    Name of the script. Should be unique.
	 * @param string|bool $path      Full URL of the script, or path of the script relative to the WordPress root directory.
	 *                               If source is set to false, script is an alias of other scripts it depends on.
	 * @param string[]    $deps      Optional. An array of registered script handles this script depends on. Default empty array.
	 * @param bool        $in_footer Optional. Whether to enqueue the script before </body> instead of in the <head>.
	 *                               Default 'false'.
	 *
	 * @return void
	 */
	private function register_script( $handle, $path, $deps = array( 'jquery' ), $in_footer = true ) {
		$this->scripts[] = $handle;
		wp_register_script( $handle, $path, $deps, Main::version(), $in_footer );
	}


	/**
	 * Register and enqueue a script for use.
	 *
	 * @uses   wp_enqueue_script()
	 * @param string      $handle    Name of the script. Should be unique.
	 * @param string|bool $path      Full URL of the script, or path of the script relative to the WordPress root directory.
	 *                               If source is set to false, script is an alias of other scripts it depends on.
	 * @param string[]    $deps      Optional. An array of registered script handles this script depends on. Default empty array.
	 *                               If set to null, no version is added.
	 * @param bool        $in_footer Optional. Whether to enqueue the script before </body> instead of in the <head>.
	 *                               Default 'false'.
	 *
	 * @return void
	 */
	private function enqueue_script( $handle, $path = '', $deps = array( 'jquery' ), $in_footer = true ) {

		if ( ! in_array( $handle, $this->scripts, true ) && $path ) {
			$this->register_script( $handle, $path, $deps, Main::version(), $in_footer );
		}

		wp_enqueue_script( $handle );
	}


	/**
	 * Register a style for use.
	 *
	 * @uses   wp_register_style()
	 * @param string      $handle  Name of the stylesheet. Should be unique.
	 * @param string|bool $path    Full URL of the stylesheet, or path of the stylesheet relative to the WordPress root directory.
	 *                             If source is set to false, stylesheet is an alias of other stylesheets it depends on.
	 * @param string[]    $deps    Optional. An array of registered stylesheet handles this stylesheet depends on. Default empty array.
	 * @param string      $media   Optional. The media for which this stylesheet has been defined.
	 *                             Default 'all'. Accepts media types like 'all', 'print' and 'screen', or media queries like
	 *                             '(orientation: portrait)' and '(max-width: 640px)'.
	 *
	 * @return void
	 */
	private function register_style( $handle, $path, $deps = array(), $media = 'all' ) {
		$this->styles[] = $handle;
		wp_register_style( $handle, $path, $deps, Main::version(), $media );
	}


	/**
	 * Register and enqueue a styles for use.
	 *
	 * @uses   wp_enqueue_style()
	 * @param string      $handle  Name of the stylesheet. Should be unique.
	 * @param string|bool $path    Full URL of the stylesheet, or path of the stylesheet relative to the WordPress root directory.
	 *                             If source is set to false, stylesheet is an alias of other stylesheets it depends on.
	 * @param string[]    $deps    Optional. An array of registered stylesheet handles this stylesheet depends on. Default empty array.
	 * @param string      $media   Optional. The media for which this stylesheet has been defined.
	 *                             Default 'all'. Accepts media types like 'all', 'print' and 'screen', or media queries like
	 *                             '(orientation: portrait)' and '(max-width: 640px)'.
	 *
	 * @return void
	 */
	private function enqueue_style( $handle, $path = '', $deps = array(), $media = 'all' ) {

		if ( ! in_array( $handle, $this->styles, true ) && $path ) {
			$this->register_style( $handle, $path, $deps, Main::version(), $media );
		}

		wp_enqueue_style( $handle );
	}


	/**
	 * Register/queue frontend scripts.
	 *
	 * @return void
	 */
	public function load_scripts() {

		if ( ! $this->prefix || ! did_action( Main::instance( $this->prefix )->prefix_hook( 'init', 'before_' ) ) ) {
			return;
		}

		// JS Scripts.
		$enqueue_scripts = $this->get_scripts();
		if ( $enqueue_scripts ) {

			foreach ( $enqueue_scripts as $handle => $args ) {
				$args = wp_parse_args(
					$args,
					array(
						'src'       => '',
						'deps'      => array( 'jquery' ),
						'version'   => Main::version(),
						'in_footer' => true,
						'enqueue'   => true,
					)
				);

				if ( $args['enqueue'] ) {
					$this->enqueue_script( $handle, $args['src'], $args['deps'], $args['version'], $args['in_footer'] );
				} else {
					$this->register_script( $handle, $args['src'], $args['deps'], $args['version'], $args['in_footer'] );
				}
			}
		}

		// CSS Styles.
		$enqueue_styles = $this->get_styles();
		if ( $enqueue_styles ) {

			foreach ( $enqueue_styles as $handle => $args ) {
				$args = wp_parse_args(
					$args,
					array(
						'src'     => '',
						'deps'    => '',
						'version' => Main::version(),
						'media'   => 'all',
						'enqueue' => true,
					)
				);

				if ( $args['enqueue'] ) {
					$this->enqueue_style( $handle, $args['src'], $args['deps'], $args['version'], $args['media'] );
				} else {
					$this->register_style( $handle, $args['src'], $args['deps'], $args['version'], $args['media'] );
				}
			}
		}
	}


	/**
	 * Localize a WC script once.
	 *
	 * @since  1.0.0 this needs less wp_script_is() calls due to https://core.trac.wordpress.org/ticket/28404 being added in WP 4.0.
	 * @param  string $handle Handle of the script to localize.
	 *
	 * @return void
	 */
	private function localize_script( $handle ) {

		if ( ! in_array( $handle, $this->wp_localize_scripts, true ) && wp_script_is( $handle ) ) {

			$data = $this->get_script_data( $handle );
			if ( $data ) {
				$name                        = str_replace( '-', '_', $handle ) . '_params';
				$this->wp_localize_scripts[] = $handle;
				// Let plugins to filter the script data.
				wp_localize_script( $handle, $name, apply_filters( $name, $data ) );
			}
		}
	}


	/**
	 * Return data for script handles.
	 *
	 * @param  string $handle Handle of the script to add data for.
	 * @return array<string,mixed>|bool
	 */
	private function get_script_data( $handle ) {

		$scripts = $this->get_scripts();
		if ( isset( $scripts[ $handle ] ) && isset( $scripts[ $handle ]['data'] ) ) {

			$data = $scripts[ $handle ]['data'];
			if ( is_callable( $data ) ) {
				$data = call_user_func( $data );
			}

			return $data;
		}

		return false;
	}


	/**
	 * Localize scripts only when enqueued.
	 *
	 * @return void
	 */
	public function localize_printed_scripts() {
		foreach ( $this->scripts as $handle ) {
			$this->localize_script( $handle );
		}
	}
}
