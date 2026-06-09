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
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_enqueue_styles', array( $this, 'add_styles' ), 9 );
		add_filter( 'PAYMENTS_CORE_HOOK_PREFIX_enqueue_scripts', array( $this, 'add_scripts' ), 9 );
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

		$styles['PAYMENTS_CORE_HOOK_PREFIX_gateway'] = array(
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

		$data = array(
			'wcAjaxUrl'           => WC_AJAX::get_endpoint( '%%endpoint%%' ),
			'pluginPrefix'        => $this->core_plugin->payment_core()->get_prefix(),
			'ajaxNonce'           => wp_create_nonce( 'PAYMENTS_CORE_HOOK_PREFIX_ajax_nonce' ),
			'textDomain'          => '__PAYMENTS_CORE_TEXT_DOMAIN__',
			'merchantId'          => $this->core_plugin->merchant_id(),
			'checkoutMode'        => $this->core_plugin->get_checkout_mode(),
			'orderCancelUrl'      => ! empty( Utils::get_current_order() ) ? Utils::get_current_order()->get_cancel_order_url() : '',
			'hostedSessionErrors' => $this->core_plugin->payment_core()->utils()->hosted_session_errors(),
			'threeDsEnabled'      => $this->core_plugin->is_3ds_enabled(),
		);

		$scripts['PAYMENTS_CORE_HOOK_PREFIX_gateway'] = array(
			'src'  => $this->core_plugin->assets_controller()->localize_asset( 'js/frontend/payment-core.js' ),
			'deps' => array( 'jquery', 'wp-i18n' ),
			/**
			 * Filters the localized data for the frontend script.
			 *
			 * @since 1.0.0
			 */
			'data' => apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_localize_frontend_script', $data ),
		);

		return $scripts;
	}
}
