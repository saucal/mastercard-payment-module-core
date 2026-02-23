<?php
/**
 * Woo Blocks Compatibility Class.
 *
 * @class       AbstractPaymentGateway
 * @version     1.0.0
 * @package     GatewayPaymentCore/Compat/
 */

namespace GatewayPaymentCore\Compat;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

use Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry;
use GatewayPaymentCore\CorePlugin;

/**
 * WooCommerce Blocks Compatibility Class.
 */
class BlockCompatibility {


	const BLOCK_COMPAT_MAP = array(
		WC_Payment_Gateway_Block_Compat_CC::class,
	);


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

		// Add compatibility with WooCommerce Blocks.
		add_action( 'woocommerce_blocks_loaded', array( $this, 'load_block_compatibility' ) );
	}


	/**
	 * Loads the WooCommerce Block Compatibility Classes,
	 * when the WooCommerce Blocks Plugin is active.
	 *
	 * @return void
	 */
	public function load_block_compatibility() {
		if ( ! class_exists( 'Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType' ) ) {
			return;
		}

		add_action( 'woocommerce_blocks_payment_method_type_registration', array( $this, 'init' ) );
	}


	/**
	 * Registers the compatible classes to the PaymentMethodRegistry.
	 *
	 * Hooked on woocommerce_blocks_payment_method_type_registration
	 *
	 * @param PaymentMethodRegistry $registry WooCommerce Block's registry instance.
	 * @return void
	 */
	public function init( PaymentMethodRegistry $registry ) {
		/**
		 * Filters the list of block compatibility classes to register.
		 *
		 * @since 1.0.0
		 */
		$compats = apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_block_compatibility_classes', $this->core_plugin->regisreted_block_gateways() );
		foreach ( $compats as $id => $class ) {
			if ( class_exists( $class ) ) {
				$compat_class = new $class();
				$compat_class->init_core( $this->core_plugin, $id );
				$registry->register( $compat_class );
			}
		}
	}
}
