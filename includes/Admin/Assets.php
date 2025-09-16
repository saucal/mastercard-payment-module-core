<?php
/**
 * Register admin assets.
 *
 * @class       AdminAssets
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore\Admin;

use GatewayPaymentCore\CorePlugin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin assets class
 */
final class Assets {

	/**
	 * Core Plugin instance.
	 *
	 * @var CorePlugin
	 */
	private $core_plugin;


	/**
	 * Constructor.
	 *
	 * @param CorePlugin $core_plugin Core Plugin instance.
	 */
	public function __construct( CorePlugin $core_plugin ) {
		$this->core_plugin = $core_plugin;

		add_action( 'plugins_loaded', array( $this, 'init_hooks' ) );
	}


	/**
	 * Init hooks.
	 */
	public function init_hooks() {
		add_filter( $this->core_plugin->payment_core()->prefix_hook( 'enqueue_styles' ), array( $this, 'add_styles' ), 9 );
		add_filter( $this->core_plugin->payment_core()->prefix_hook( 'enqueue_scripts' ), array( $this, 'add_scripts' ), 9 );
		add_action( 'admin_enqueue_scripts', array( $this->core_plugin->assets_controller(), 'load_scripts' ) );
		add_action( 'admin_print_scripts', array( $this->core_plugin->assets_controller(), 'localize_printed_scripts' ), 5 );
		add_action( 'admin_print_footer_scripts', array( $this->core_plugin->assets_controller(), 'localize_printed_scripts' ), 5 );
	}


	/**
	 * Add styles for the admin.
	 *
	 * @param array $styles Admin styles.
	 * @return array<string,array>
	 */
	public function add_styles( $styles ) {

		$styles[ $this->core_plugin->payment_core()->prefix_hook( 'gateway-admin' ) ] = array(
			'src' => $this->core_plugin->assets_controller()->localize_asset( 'css/admin/payment-core.css' ),
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

		$scripts[ $this->core_plugin->payment_core()->prefix_hook( 'gateway-admin' ) ] = array(
			'src'  => $this->core_plugin->assets_controller()->localize_asset( 'js/admin/payment-core.js' ),
			'data' => array(
				'ajaxUrl'      => $this->core_plugin->payment_core()->utils()->ajax_url(),
				'pluginPrefix' => $this->core_plugin->payment_core()->get_prefix(),
				'textDomain'   => $this->core_plugin->text_domain(),
			),
		);

		return $scripts;
	}
}
