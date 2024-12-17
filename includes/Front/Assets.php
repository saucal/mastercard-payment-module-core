<?php
/**
 * Register frontend assets.
 *
 * @class       FrontAssets
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore\Front;

use MPGSCore\MpgsPlugin;
use MPGSCore\Utils;
use WC_AJAX;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Frontend assets class
 */
final class Assets {

	/**
	 * MPGS Plugin instance.
	 *
	 * @var MpgsPlugin
	 */
	private $mpgs_plugin;


	/**
	 * Constructor.
	 *
	 * @param MpgsPlugin $mpgs_plugin MPGS Plugin instance.
	 */
	public function __construct( MpgsPlugin $mpgs_plugin ) {
		$this->mpgs_plugin = $mpgs_plugin;

		add_action( 'plugins_loaded', array( $this, 'init_hooks' ) );
	}


	/**
	 * Init hooks.
	 */
	public function init_hooks() {
		add_filter( $this->mpgs_plugin->mpgs_core()->prefix_hook( 'enqueue_styles' ), array( $this, 'add_styles' ), 9 );
		add_filter( $this->mpgs_plugin->mpgs_core()->prefix_hook( 'enqueue_scripts' ), array( $this, 'add_scripts' ), 9 );
		add_action( 'wp_enqueue_scripts', array( $this->mpgs_plugin->assets_controller(), 'load_scripts' ) );
		add_action( 'wp_print_scripts', array( $this->mpgs_plugin->assets_controller(), 'localize_printed_scripts' ), 5 );
		add_action( 'wp_print_footer_scripts', array( $this->mpgs_plugin->assets_controller(), 'localize_printed_scripts' ), 5 );
	}


	/**
	 * Add styles for the admin.
	 *
	 * @param array $styles Admin styles.
	 * @return array<string,array>
	 */
	public function add_styles( $styles ) {

		$styles[ $this->mpgs_plugin->mpgs_core()->prefix_hook( 'gateway' ) ] = array(
			'src' => $this->mpgs_plugin->assets_controller()->localize_asset( 'css/frontend/mpgs-core.css' ),
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

		$scripts[ $this->mpgs_plugin->mpgs_core()->prefix_hook( 'gateway' ) ] = array(
			'src'  => $this->mpgs_plugin->assets_controller()->localize_asset( 'js/frontend/mpgs-core.js' ),
			'data' => array(
				'wcAjaxUrl'      => WC_AJAX::get_endpoint( '%%endpoint%%' ),
				'ajaxUrl'        => $this->mpgs_plugin->mpgs_core()->utils()->ajax_url(),
				'prefix'         => $this->mpgs_plugin->mpgs_core()->get_prefix(),
				'checkoutMode'   => $this->mpgs_plugin->get_checkout_mode(),
				'orderCancelUrl' => ! empty( Utils::get_current_order() ) ? Utils::get_current_order()->get_cancel_order_url() : '',
			),
		);

		return $scripts;
	}
}
