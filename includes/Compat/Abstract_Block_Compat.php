<?php
/**
 * Abstract Woo Blocks Compatibility Class.
 *
 * @class       AbstractPaymentGateway
 * @version     1.0.0
 * @package     MPGSCore/Compat/
 */

namespace MPGSCore\Compat;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;
use MPGSCore\MpgsPlugin;
use MPGSCore\Utils;

/**
 * WooCommerce Blocks compatibility Abstract.
 */
abstract class Abstract_Block_Compat extends AbstractPaymentMethodType {

	/**
	 * MPGS Plugin instance.
	 *
	 * @var MpgsPlugin
	 */
	protected $mpgs_plugin;


	/**
	 * The payment gateway classname.
	 *
	 * @var string
	 */
	protected $gateway_id;


	/**
	 * The name of the payment method's assets folder.
	 *
	 * @var string
	 */
	protected $assets_folder;


	/**
	 * Init MPGS method.
	 *
	 * @param MpgsPlugin $mpgs_plugin MPGS Plugin instance.
	 * @param string     $gateway_id  The gateway ID.
	 */
	public function init_mpgs( MpgsPlugin $mpgs_plugin, string $gateway_id ) {
		$this->mpgs_plugin = $mpgs_plugin;
		$this->name        = $gateway_id;
		$this->gateway_id  = $gateway_id;
	}

	/**
	 * Gets called during the server side initialization and sets our settings.
	 *
	 * Overwrite when you need different set of logic.
	 *
	 * @return void
	 */
	public function initialize() {
		$this->settings = $this->mpgs_plugin->get_gateway_settings();
	}


	/**
	 * Returns if the Payment Method is active.
	 *
	 * Overwrite when you need different set of logic.
	 *
	 * @return boolean
	 */
	public function is_active() {
		return $this->name && $this->mpgs_plugin->is_enabled();
	}

	/**
	 * Returns the frontend scripts required by the payment method.
	 *
	 * Return an array of script handles that have been registered already.
	 *
	 * @return array
	 */
	public function get_payment_method_script_handles() {
		return $this->scripts_name_per_type();
	}

	/**
	 * Returns the backend scripts required by the payment method.
	 *
	 * Return an array of script handles that have been registered already.
	 *
	 * @return array
	 */
	public function get_payment_method_script_handles_for_admin() {
		return $this->scripts_name_per_type();
	}

	/**
	 * Returns the frontend accessible data.
	 *
	 * Can be accessed by calling
	 * const settings = wc.wcSettings.getSetting( '{paymentMethodName}_data' );
	 *
	 * @return array
	 */
	public function get_payment_method_data() {

		return array(
			'title'       => $this->settings['title'],
			'description' => $this->settings['description'],
			'textDomain'  => $this->mpgs_plugin->text_domain(),
			'supports'    => $this->get_supported_features(),
		);
	}

	/**
	 * Returns the scripts required by the payment method based on the $type param.
	 *
	 * @param string $type The type of scripts to return. Default is empty.
	 *
	 * @return array Return an array of script handles that have been registered already.
	 */
	protected function scripts_name_per_type( $type = '' ) {
		$scripts = array();

		if ( ! $this->assets_folder ) {
			return $scripts;
		}

		$script_handle = 'wc_' . $this->name . '_block_compat';
		$asset_data    = $this->mpgs_plugin->mpgs_core()->utils()->core_package_path() . '/assets/js/payment-methods/' . $this->assets_folder . '/index.asset.php';
		$script_data   = file_exists( $asset_data ) ? include $asset_data : array(
			'dependencies' => array(),
			'version'      => $this->mpgs_plugin->mpgs_core()->version(),
		);

		wp_register_script( $script_handle, $this->mpgs_plugin->mpgs_core()->utils()->core_package_url() . '/assets/js/payment-methods/' . $this->assets_folder . '/index' . Utils::min_suffix() . '.js', $script_data['dependencies'], $script_data['version'], true );

		wp_localize_script(
			$script_handle,
			'mpgs_data',
			array(
				'prefix' => $this->mpgs_plugin->mpgs_core()->get_prefix(),
			)
		);

		$scripts[] = $script_handle;

		if ( Utils::is_request( 'frontend' ) ) {
			$scripts[] = $this->mpgs_plugin->mpgs_core()->prefix_hook( 'gateway' );
		}

		return $scripts;
	}

	/**
	 * Returns an array of supported features.
	 *
	 * @return string[]
	 */
	public function get_supported_features() {
		$gateways = WC()->payment_gateways->get_available_payment_gateways();
		if ( isset( $gateways[ $this->gateway_id() ] ) ) {
			return $gateways[ $this->gateway_id() ]->supports;
		}
		return array();
	}


	/**
	 * Return the payment method's ID.
	 *
	 * @return string
	 */
	public function gateway_id() {
		if ( ! $this->gateway_id ) {
			$this->gateway_id = $this->mpgs_plugin->get_registered_payment_id( $this->name );
		}
		return $this->gateway_id;
	}


	/**
	 * Should render the payment method block.
	 *
	 * @return bool
	 */
	public function should_render() {
		return $this->is_active() && Utils::is_request( 'frontend' ) && ( is_woocommerce() || is_cart() || is_checkout() || is_add_payment_method_page() || is_checkout_pay_page() );
	}
}
