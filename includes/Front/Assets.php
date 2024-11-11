<?php
/**
 * Register frontend assets.
 *
 * @class       FrontAssets
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore\Front;

use MPGSCore\Assets as AssetsMain;
use MPGSCore\Main;
use MPGSCore\Utils;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Frontend assets class
 */
final class Assets {

	/**
	 * MPGS Core instance's prefix.
	 *
	 * @var string
	 */
	private static $prefix;


	/**
	 * Hook in methods.
	 *
	 * @param string $prefix Prefix of the MPGS Core instance.
	 */
	public function __construct( $prefix = '' ) {

		if ( empty( $prefix ) ) {
			return;
		}

		$this->prefix = $prefix;

		add_action( 'plugins_loaded', array( $this, 'init_hooks' ) );
	}


	/**
	 * Init hooks.
	 */
	public function init_hooks() {
		add_filter( Main::instance( $this->prefix )->prefix_hook( 'enqueue_styles' ), array( $this, 'add_styles' ), 9 );
		add_filter( Main::instance( $this->prefix )->prefix_hook( 'enqueue_scripts' ), array( $this, 'add_scripts' ), 9 );
		add_action( 'wp_enqueue_scripts', array( Main::instance( $this->prefix )->assets_controller(), 'load_scripts' ) );
		add_action( 'wp_print_scripts', array( Main::instance( $this->prefix )->assets_controller(), 'localize_printed_scripts' ), 5 );
		add_action( 'wp_print_footer_scripts', array( Main::instance( $this->prefix )->assets_controller(), 'localize_printed_scripts' ), 5 );
	}


	/**
	 * Add styles for the admin.
	 *
	 * @param array $styles Admin styles.
	 * @return array<string,array>
	 */
	public function add_styles( $styles ) {

		$styles[ $this->prefix ] = array(
			'src' => Main::instance( $this->prefix )->assets_controller()->localize_asset( 'css/frontend/mpgs-core.css' ),
		);

		return $styles;
	}


	/**
	 * Add scripts for the admin.
	 *
	 * @param  array $scripts Admin scripts.
	 * @return array<string,array>
	 */
	public function add_scripts( $scripts ) {

		$scripts[ $this->prefix ] = array(
			'src'  => Main::instance( $this->prefix )->assets_controller()->localize_asset( 'js/frontend/mpgs-core.js' ),
			'data' => array(
				'ajax_url' => Main::instance( $this->prefix )->utils()->ajax_url(),
				'prefix'   => $this->prefix,
			),
		);

		return $scripts;
	}
}
