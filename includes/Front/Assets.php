<?php
/**
 * Register frontend assets.
 *
 * @class       FrontAssets
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore\Front;

use MPGSCore\Main;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Frontend assets class
 */
final class Assets {

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

		add_action( 'plugins_loaded', array( $this, 'init_hooks' ) );
	}


	/**
	 * Init hooks.
	 */
	public function init_hooks() {
		add_filter( $this->mpgs_core->prefix_hook( 'enqueue_styles' ), array( $this, 'add_styles' ), 9 );
		add_filter( $this->mpgs_core->prefix_hook( 'enqueue_scripts' ), array( $this, 'add_scripts' ), 9 );
		add_action( 'wp_enqueue_scripts', array( $this->mpgs_core->assets_controller(), 'load_scripts' ) );
		add_action( 'wp_print_scripts', array( $this->mpgs_core->assets_controller(), 'localize_printed_scripts' ), 5 );
		add_action( 'wp_print_footer_scripts', array( $this->mpgs_core->assets_controller(), 'localize_printed_scripts' ), 5 );
	}


	/**
	 * Add styles for the admin.
	 *
	 * @param array $styles Admin styles.
	 * @return array<string,array>
	 */
	public function add_styles( $styles ) {

		$styles[ $this->mpgs_core->get_prefix() ] = array(
			'src' => $this->mpgs_core->assets_controller()->localize_asset( 'css/frontend/mpgs-core.css' ),
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

		$scripts[ $this->mpgs_core->get_prefix() ] = array(
			'src'  => $this->mpgs_core->assets_controller()->localize_asset( 'js/frontend/mpgs-core.js' ),
			'data' => array(
				'ajax_url' => $this->mpgs_core->utils()->ajax_url(),
				'prefix'   => $this->mpgs_core->get_prefix(),
			),
		);

		return $scripts;
	}
}
