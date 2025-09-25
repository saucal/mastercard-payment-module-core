<?php
/**
 * Register frontend assets.
 *
 * @class       FrontAssets
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore\Front;

use GatewayPaymentCore\CorePlugin;
use GatewayPaymentCore\Utils;
use WC_AJAX;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Frontend assets class
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
		add_action( 'wp_enqueue_scripts', array( $this->core_plugin->assets_controller(), 'load_scripts' ) );
		add_action( 'wp_print_scripts', array( $this->core_plugin->assets_controller(), 'localize_printed_scripts' ), 5 );
		add_action( 'wp_print_footer_scripts', array( $this->core_plugin->assets_controller(), 'localize_printed_scripts' ), 5 );
	}


	/**
	 * Add styles for the admin.
	 *
	 * @param array $styles Admin styles.
	 * @return array<string,array>
	 */
	public function add_styles( $styles ) {

		$styles[ $this->core_plugin->payment_core()->prefix_hook( 'gateway' ) ] = array(
			'src' => $this->core_plugin->assets_controller()->localize_asset( 'css/frontend/payment-core.css' ),
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

		$scripts[ $this->core_plugin->payment_core()->prefix_hook( 'gateway' ) ] = array(
			'src'  => $this->core_plugin->assets_controller()->localize_asset( 'js/frontend/payment-core.js' ),
			'deps' => array( 'jquery', 'wp-i18n' ),
			'data' => array(
				'wcAjaxUrl'           => WC_AJAX::get_endpoint( '%%endpoint%%' ),
				'pluginPrefix'        => $this->core_plugin->payment_core()->get_prefix(),
				'textDomain'          => $this->core_plugin->text_domain(),
				'merchantId'          => $this->core_plugin->merchant_id(),
				'checkoutMode'        => $this->core_plugin->get_checkout_mode(),
				'orderCancelUrl'      => ! empty( Utils::get_current_order() ) ? Utils::get_current_order()->get_cancel_order_url() : '',
				'hostedSessionErrors' => $this->core_plugin->payment_core()->utils()->hosted_session_errors(),
				'threeDsEnabled'      => $this->core_plugin->is_3ds_enabled(),
				'dccEnabled'          => $this->core_plugin->is_currency_conversion_enabled(),
				'dccRequestEndpoint'  => $this->core_plugin->api()->get_domain() . 'paymentOptionsInquiry',
			),
		);

		return $scripts;
	}
}
