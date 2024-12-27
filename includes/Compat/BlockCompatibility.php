<?php
/**
 * Woo Blocks Compatibility Class.
 *
 * @class       AbstractPaymentGateway
 * @version     1.0.0
 * @package     MPGSCore/Compat/
 */

namespace MPGSCore\Compat;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

use Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry;
use MPGSCore\MpgsPlugin;

/**
 * WooCommerce Blocks Compatibility Class.
 */
class BlockCompatibility {


	const BLOCK_COMPAT_MAP = array(
		'WC_MPGS_Payment_Gateway_Block_Compat_CC',
	);


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
		$compats = apply_filters( $this->mpgs_plugin->mpgs_core()->prefix_hook( 'block_compatibility_classes' ), $this->mpgs_plugin->regisreted_block_gateways() );
		if ( ! empty( $compats ) ) {
			require_once __DIR__ . '/Abstract_Block_Compat.php';
		}
		foreach ( $compats as $id => $filename ) {
			$path = __DIR__ . '/' . $filename . '.php';
			if ( file_exists( $path ) ) {
				require_once $path;
				$class = __NAMESPACE__ . '\\' . $filename;
				if ( class_exists( $class ) ) {
					$registry->register( new $class( $this->mpgs_plugin, $id ) );
				}
			}
		}
	}
}
