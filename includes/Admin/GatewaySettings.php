<?php
/**
 * Gateway settings definition.
 *
 * @class       Admin
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore\Admin;

use MPGSCore\Main;
use MPGSCore\MpgsPlugin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * GatewaySettings class
 */
final class GatewaySettings {

	/**
	 * MPGS Core instance.
	 *
	 * @var Main
	 */
	private static $mpgs_core_instance;

	/**
	 * Get the gateway settings.
	 *
	 * @param string $prefix Prefix of the MPGS Core instance.
	 *
	 * @return array
	 */
	public static function get_settings( $prefix = '' ) {

		if ( empty( $prefix ) ) {
			return array();
		}

		self::$mpgs_core_instance = Main::instance( $prefix );

		if ( ! self::$mpgs_core_instance ) {
			return array();
		}

		$setting_fields = array(
			'enabled'          => array(
				'title'       => __( 'Enable/Disable', self::$mpgs_core_instance->text_domain() ),
				'label'       => __( 'Enable', self::$mpgs_core_instance->text_domain() ),
				'type'        => 'checkbox',
				'description' => '',
				'default'     => 'no',
			),
			'title'            => array(
				'title'       => __( 'Title', self::$mpgs_core_instance->text_domain() ),
				'type'        => 'text',
				'description' => __( 'The payment method title displayed during checkout.', self::$mpgs_core_instance->text_domain() ),
				'default'     => self::$mpgs_core_instance->plugin_title(),
				'desc_tip'    => true,
			),
			'description'      => array(
				'title'       => __( 'Description', self::$mpgs_core_instance->text_domain() ),
				'type'        => 'text',
				'description' => esc_html__( 'The description displayed when this payment method is selected.', self::$mpgs_core_instance->text_domain() ),
				'default'     => esc_html__( 'Pay with your Credit/Debit Card', self::$mpgs_core_instance->text_domain() ),
				'desc_tip'    => true,
			),
			'region'           => array(
				'title'   => __( 'Merchant Region', self::$mpgs_core_instance->text_domain() ),
				'type'    => 'select',
				'options' => wp_list_pluck( self::payment_regions(), 'name', 'code' ),
				'default' => 'eu',
			),
			'merchant_details' => array(
				'title' => __( 'Merchant account details', self::$mpgs_core_instance->text_domain() ),
				'type'  => 'title',
			),
			'sandbox'          => array(
				'title'       => __( 'Test Sandbox', self::$mpgs_core_instance->text_domain() ),
				'label'       => __( 'Enable test sandbox mode', self::$mpgs_core_instance->text_domain() ),
				'type'        => 'checkbox',
				'description' => __( 'Place the payment gateway in test mode using test API credentials (real payments will not be taken).', self::$mpgs_core_instance->text_domain() ),
				'default'     => 'no',
				'desc_tip'    => true,
			),
			'merchant_id'      => array(
				'title'       => __( 'Merchant ID', self::$mpgs_core_instance->text_domain() ),
				'type'        => 'text',
				'description' => __( 'This is your merchant profile ID.', self::$mpgs_core_instance->text_domain() ),
				'default'     => '',
			),
			'password'         => array(
				'title'       => __( 'API Password', self::$mpgs_core_instance->text_domain() ),
				'type'        => 'password',
				'description' => __( 'This is your API password.', self::$mpgs_core_instance->text_domain() ),
				'default'     => '',
			),
		);

		return self::maybe_add_advanced_settings( $setting_fields );
	}


	/**
	 * Add advanced settings if the credentials are valid.
	 *
	 * @param array $settings Settings.
	 *
	 * @return array
	 */
	private static function maybe_add_advanced_settings( $settings ) {

		if ( ! MpgsPlugin::get_validated_credentials() ) {
			return $settings;
		}

		$supported_operations = self::supported_payment_operations();

		if ( empty( $supported_operations ) ) {
			return $settings;
		}

		return array_merge(
			$settings,
			array(
				'advanced'             => array(
					'title' => __( 'Advanced configurations', self::$mpgs_core_instance->text_domain() ),
					'type'  => 'title',
				),
				'transaction_mode'     => array(
					'title'       => __( 'Payment capture', self::$mpgs_core_instance->text_domain() ),
					'type'        => 'select',
					'options'     => $supported_operations,
					'default'     => 'purchase',
					'description' => __( 'Choose "Authorize and Capture" to authorize and capture the payment immediately. Choose "Authorize" to only authorize the payment, and capture it manually later from the WC admin panel.', self::$mpgs_core_instance->text_domain() ),
				),
				'checkout_mode'        => array(
					'title'   => __( 'Integration mode', self::$mpgs_core_instance->text_domain() ),
					'type'    => 'select',
					'options' => self::checkout_modes(),
					'default' => 'hosted_session',
				),
				'hosted_checkout_mode' => array(
					'title'   => __( 'Hosted Checkout Mode', self::$mpgs_core_instance->text_domain() ),
					'type'    => 'select',
					'options' => array(
						'embedded' => __( 'Embedded', self::$mpgs_core_instance->text_domain() ),
						'redirect' => __( 'Redirect to Payment Page', self::$mpgs_core_instance->text_domain() ),
					),
					'default' => 'embedded',
				),
				'_3d_secure'           => array(
					'title'       => __( '3D Secure', self::$mpgs_core_instance->text_domain() ),
					'type'        => 'checkbox',
					'default'     => 'yes',
					'description' => __( 'Contact your payment service provider if you need more information.', self::$mpgs_core_instance->text_domain() ),
					'desc_tip'    => true,
				),
				'saved_cards'          => array(
					'title'       => __( 'Saved Cards', self::$mpgs_core_instance->text_domain() ),
					'label'       => __( 'Enable payment via saved tokenized cards', self::$mpgs_core_instance->text_domain() ),
					'type'        => 'checkbox',
					'description' => __( 'If enabled, users will be able to pay with a saved card during checkout. Card details are saved in the payment gateway, not on your store.', self::$mpgs_core_instance->text_domain() ),
					'default'     => 'yes',
					'desc_tip'    => true,
				),
				'debug'                => array(
					'title'       => __( 'Logging', self::$mpgs_core_instance->text_domain() ),
					'label'       => __( 'Log debug messages', self::$mpgs_core_instance->text_domain() ),
					'type'        => 'checkbox',
					'description' => __( 'Save debug messages to the WooCommerce System Status log.', self::$mpgs_core_instance->text_domain() ),
					'default'     => 'yes',
					'desc_tip'    => true,
				),
			)
		);
	}


	/**
	 * Get the payment regions.
	 *
	 * @return array
	 */
	public static function payment_regions() {

		if ( ! self::$mpgs_core_instance ) {
			return array();
		}

		return array(
			'ap' => array(
				'name' => __( 'Asia Pacific and Middle East', self::$mpgs_core_instance->text_domain() ),
				'code' => 'ap',
				'url'  => 'https://ap-gateway.mastercard.com',
			),
			'eu' => array(
				'name' => __( 'Europe', self::$mpgs_core_instance->text_domain() ),
				'code' => 'eu',
				'url'  => 'https://eu-gateway.mastercard.com',
			),
			'na' => array(
				'name' => __( 'North America', self::$mpgs_core_instance->text_domain() ),
				'code' => 'na',
				'url'  => 'https://na-gateway.mastercard.com',
			),
		);
	}


	/**
	 * Get payment region URL.
	 *
	 * @param string $region Region code.
	 *
	 * @return string
	 */
	public static function payment_region_url( $region ) {

		$regions = self::payment_regions();

		if ( ! isset( $regions[ $region ] ) ) {
			return '';
		}

		return $regions[ $region ]['url'];
	}


	/**
	 * Get the checkout modes.
	 *
	 * @return array
	 */
	public static function checkout_modes() {
		return array(
			'hosted_session'  => __( 'Hosted Session', self::$mpgs_core_instance->text_domain() ),
			'hosted_checkout' => __( 'Hosted Checkout', self::$mpgs_core_instance->text_domain() ),
		);
	}


	/**
	 * Get supported payment operations.
	 *
	 * @return array
	 */
	public static function supported_payment_operations() {

		$supported_operations = array();

		if ( empty( MpgsPlugin::get_validated_credentials() ) ) {
			return $supported_operations;
		}

		$payment_operations = MpgsPlugin::get_payment_operations();

		if ( empty( $payment_operations ) || ! is_array( $payment_operations ) ) {
			return $supported_operations;
		}

		foreach ( $payment_operations as $supported_operation ) {
			$operation = reset( $supported_operation );

			if ( 'PURCHASE' === $operation ) {
				$supported_operations['purchase'] = __( 'Authorize and Capture', self::$mpgs_core_instance->text_domain() );
			}

			if ( 'AUTHORIZE' === $operation ) {
				$supported_operations['authorize'] = __( 'Authorize', self::$mpgs_core_instance->text_domain() );
			}
		}

		return $supported_operations;
	}
}
