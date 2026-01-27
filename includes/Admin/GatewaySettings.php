<?php
/**
 * Gateway settings definition.
 *
 * @class       Admin
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore\Admin;

use GatewayPaymentCore\CorePlugin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * GatewaySettings class
 */
final class GatewaySettings {

	/**
	 * Plugin instance.
	 *
	 * @var CorePlugin
	 */
	private $core_plugin;


	/**
	 * Settings array.
	 *
	 * @var array
	 */
	private $settings = array();


	/**
	 * Constructor.
	 *
	 * @param CorePlugin $core_plugin Plugin instance.
	 */
	public function __construct( CorePlugin $core_plugin ) {
		$this->core_plugin = $core_plugin;
	}

	/**
	 * Get the gateway settings.
	 *
	 * @param bool $force Force to refresh the settings.
	 *
	 * @return array
	 */
	public function get_settings( $force = true ) {

		if ( empty( $this->core_plugin->payment_core() ) ) {
			return array();
		}

		if ( empty( $this->settings ) || $force ) {
			$this->init_settings();
		}

		return $this->settings;
	}


	/**
	 * Get default setting.
	 *
	 * @param string $key Setting key.
	 *
	 * @return mixed
	 */
	public function get_default_setting( $key ) {
		$settings = $this->get_settings();

		if ( empty( $settings[ $key ] ) ) {
			return '';
		}

		return $settings[ $key ]['default'] ?? '';
	}


	/**
	 * Merchant details message.
	 *
	 * @return string
	 */
	public function merchant_details_message() {
		$message = __( 'Enter your Merchant Account details.', $this->core_plugin->payment_core()->text_domain() );

		if ( ! empty( $this->core_plugin->merchant_registration_url() ) ) {
			$message .= ' ' . sprintf(
				/* translators: %s: Merchant registration URL */
				__( 'Don\'t have an account? %1$sSign up here%2$s', $this->core_plugin->payment_core()->text_domain() ),
				'<a href="' . esc_url( $this->core_plugin->merchant_registration_url() ) . '" target="_blank">',
				'</a>'
			);
		}

		return $message;
	}


	/**
	 * Initialize the settings.
	 *
	 * @return void
	 */
	private function init_settings() {
		$regions     = wp_list_pluck( self::payment_regions(), 'url', 'code' );
		$test_region = $this->core_plugin->get_test_region_url();
		if ( ! empty( $test_region ) ) {
			$regions['test'] = $test_region;
		}
		$this->settings = array(
			'enabled'          => array(
				'title'       => __( 'Enable/Disable', $this->core_plugin->text_domain() ),
				'label'       => __( 'Enable', $this->core_plugin->text_domain() ),
				'type'        => 'checkbox',
				'description' => '',
				'default'     => 'no',
			),
			'title'            => array(
				'title'       => __( 'Title', $this->core_plugin->text_domain() ),
				'type'        => 'text',
				'description' => __( 'The payment method title displayed during checkout.', $this->core_plugin->text_domain() ),
				'default'     => $this->core_plugin->payment_core()->plugin_title(),
				'desc_tip'    => true,
			),
			'description'      => array(
				'title'       => __( 'Description', $this->core_plugin->text_domain() ),
				'type'        => 'text',
				'description' => esc_html__( 'The description displayed when this payment method is selected.', $this->core_plugin->text_domain() ),
				'default'     => esc_html__( 'Pay with your Credit/Debit Card', $this->core_plugin->text_domain() ),
				'desc_tip'    => true,
			),
			'merchant_details' => array(
				'title'       => __( 'Merchant Account Details', $this->core_plugin->text_domain() ),
				'description' => $this->merchant_details_message(),
				'type'        => 'title',
			),
			'sandbox'          => array(
				'title'             => __( 'Test Mode', $this->core_plugin->text_domain() ),
				'label'             => __( 'Enable test mode', $this->core_plugin->text_domain() ),
				'type'              => 'checkbox',
				'description'       => sprintf(
					__( 'Set the payment gateway in test mode using test API credentials (real payments will not be taken). You can use %1$stest card numbers%2$s to simulate various transactions.', $this->core_plugin->text_domain() ),
					'<a href="https://test-gateway.mastercard.com/api/documentation/integrationGuidelines/supportedFeatures/testAndGoLive.html" target="_blank">',
					'</a>'
				),
				'default'           => 'no',
				'custom_attributes' => array(
					'data-region-urls' => wp_json_encode( $regions ),
					'data-region-is'   => 'test',
				),
			),
			...( $this->get_region_setting() ),
			'merchant_id'      => array(
				'title'       => __( 'Merchant ID', $this->core_plugin->text_domain() ),
				'type'        => 'text',
				'description' => __( 'This is your merchant profile ID.', $this->core_plugin->text_domain() ),
				'default'     => '',
			),
			'password'         => array(
				'title'       => __( 'Integration Authentication Password', $this->core_plugin->text_domain() ),
				'type'        => 'password',
				'description' => sprintf(
					__( 'You can obtain your integration authentication password from the Merchant Portal (%1$sAdmin -> Integration Settings%2$s).', $this->core_plugin->text_domain() ),
					'<a href="' . esc_url(
						add_query_arg(
							array(
								'_authDomain'      => 'ma',
								'selectedMenuItem' => 'apiConfiguration',
							),
							untrailingslashit( $this->core_plugin->gateway_url() ) . '/ma/apiConfiguration.s'
						)
					) . '" target="_blank">',
					'</a>'
				),
				'default'     => '',
			),
		);

		$this->maybe_add_advanced_settings();
	}

	/**
	 * Get the regions field.
	 */
	private function get_region_setting() {
		$regions = wp_list_pluck( self::payment_regions(), 'name', 'code' );

		if ( empty( $regions ) || count( $regions ) < 2 ) {
			return array();
		}

		return array(
			'region' => array(
				'title'             => __( 'Merchant Region', $this->core_plugin->text_domain() ),
				'type'              => 'select',
				'options'           => $regions,
				'default'           => array_key_first( $regions ),
				'class'             => 'conditional-hide',
				'custom_attributes' => array(
					'data-show-rel' => 'sandbox',
					'data-show-if'  => 'no',
				),
			),
		);
	}

	/**
	 * Webhook notification URL.
	 *
	 * @return string
	 */
	public function webhook_notification_url() {
		return add_query_arg(
			array(
				'_authDomain'      => 'ma',
				'selectedMenuItem' => 'notificationMerchantApiNotifications',
			),
			untrailingslashit( $this->core_plugin->gateway_url() ) . '/notification/ui/merchant/apiNotifications'
		);
	}


	/**
	 * Add advanced settings if the credentials are valid.
	 *
	 * @return array
	 */
	private function maybe_add_advanced_settings() {

		if ( ! $this->core_plugin->get_validated_credentials() ) {
			return $this->settings;
		}

		$supported_operations = self::supported_payment_operations();

		if ( empty( $supported_operations ) ) {
			return $this->settings;
		}

		$this->settings = array_merge(
			$this->settings,
			array(
				'webhook'              => array(
					'title' => __( 'Webhook Notifications', $this->core_plugin->text_domain() ),
					'type'  => 'title',
				),
				'notification_secret'  => array(
					'title'       => __( 'Notification Secret', $this->core_plugin->text_domain() ),
					'type'        => 'text',
					'description' => sprintf(
						__( 'You can obtain or generate your notification secret on the Merchant Portal (%1$sAdmin -> Webhook Notifications%2$s).', $this->core_plugin->text_domain() ),
						'<a href="' . esc_url( $this->webhook_notification_url() ) . '" target="_blank">',
						'</a>'
					),
				),
				'payments'             => array(
					'title' => __( 'Payment configurations', $this->core_plugin->text_domain() ),
					'type'  => 'title',
				),
				'transaction_mode'     => array(
					'title'       => __( 'Payment Capture', $this->core_plugin->text_domain() ),
					'type'        => 'select',
					'options'     => $supported_operations,
					'default'     => 'PURCHASE',
					'description' => __( 'Choose "Authorize and Capture" to capture the payment immediately when the order is placed. Choose "Authorize Only" to authorize the payment and capture it manually later from the WC admin panel. This setting does not affect subscriptions; charges for orders related to subscriptions are always captured.', $this->core_plugin->text_domain() ),
				),
				'checkout_mode'        => array(
					'title'   => __( 'Integration Mode', $this->core_plugin->text_domain() ),
					'type'    => 'select',
					'options' => self::checkout_modes(),
					'default' => 'hosted_session',
				),
				'hosted_checkout_mode' => array(
					'title'             => __( 'Hosted Checkout Mode', $this->core_plugin->text_domain() ),
					'type'              => 'select',
					'options'           => array(
						'embedded' => __( 'Embedded', $this->core_plugin->text_domain() ),
						'redirect' => __( 'Redirect to Payment Page', $this->core_plugin->text_domain() ),
					),
					'default'           => 'embedded',
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'checkout_mode',
						'data-show-if'  => 'hosted_checkout',
					),
				),
				'display_logo'         => array(
					'title'             => __( 'Display Plugin\'s Logo', $this->core_plugin->text_domain() ),
					'label'             => __( 'Check this to display the plugin\'s logo in the Hosted Checkout page.', $this->core_plugin->text_domain() ),
					'type'              => 'checkbox',
					'default'           => 'yes',
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'checkout_mode',
						'data-show-if'  => 'hosted_checkout',
					),
				),
				'_3d_secure'           => array(
					'title'             => __( '3D Secure', $this->core_plugin->text_domain() ),
					'type'              => 'checkbox',
					'default'           => 'yes',
					'description'       => __( 'If enabled, adds an additional layer of security to online purchases by requiring cardholders to authenticate themselves with the card issuer when making payments.', $this->core_plugin->text_domain() ),
					'desc_tip'          => true,
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'checkout_mode',
						'data-show-if'  => 'hosted_session',
					),
				),
				'saved_cards'          => array(
					'title'             => __( 'Saved Cards', $this->core_plugin->text_domain() ),
					'label'             => __( 'Enable payment via saved tokenized cards', $this->core_plugin->text_domain() ),
					'type'              => 'checkbox',
					'description'       => __( 'If enabled, users will be able to pay with a saved card during checkout. Card details are saved in the payment gateway, not on your store.', $this->core_plugin->text_domain() ),
					'default'           => 'yes',
					'desc_tip'          => true,
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'checkout_mode',
						'data-show-if'  => 'hosted_session',
					),
				),
				'merchant_name'        => array(
					'title'       => __( 'Merchant Name', $this->core_plugin->text_domain() ),
					'type'        => 'text',
					'description' => __( 'The name of your business for display to the payer on the payment interaction (The website title will be used as default).', $this->core_plugin->text_domain() ),
					'default'     => get_bloginfo( 'name', 'display' ),
				),
				'advanced'             => array(
					'title' => __( 'Advanced configurations', $this->core_plugin->text_domain() ),
					'type'  => 'title',
				),
				'debug'                => array(
					'title'       => __( 'Logging', $this->core_plugin->text_domain() ),
					'label'       => __( 'Log debug messages', $this->core_plugin->text_domain() ),
					'type'        => 'checkbox',
					'description' => __( 'Save debug messages to the WooCommerce System Status log.', $this->core_plugin->text_domain() ),
					'default'     => 'yes',
					'desc_tip'    => true,
				),
			)
		);

		$this->settings = apply_filters( $this->core_plugin->payment_core()->prefix_hook( 'gateway_settings' ), $this->settings );
	}


	/**
	 * Get the payment regions.
	 *
	 * @return array
	 */
	public function payment_regions() {

		if ( ! $this->core_plugin->payment_core() ) {
			return array();
		}

		return $this->core_plugin->payment_regions();
	}


	/**
	 * Get the checkout modes.
	 *
	 * @return array
	 */
	public function checkout_modes() {
		return array(
			'hosted_session'  => __( 'Hosted Session', $this->core_plugin->text_domain() ),
			'hosted_checkout' => __( 'Hosted Checkout', $this->core_plugin->text_domain() ),
		);
	}


	/**
	 * Get supported payment operations.
	 *
	 * @return array
	 */
	public function supported_payment_operations() {

		$supported_operations = array();

		if ( empty( $this->core_plugin->get_validated_credentials() ) ) {
			return $supported_operations;
		}

		$payment_operations = $this->core_plugin->get_payment_operations();

		if ( empty( $payment_operations ) || ! is_array( $payment_operations ) ) {
			return $supported_operations;
		}

		foreach ( $payment_operations as $supported_operation ) {
			$operation = reset( $supported_operation );

			if ( 'PURCHASE' === $operation ) {
				$supported_operations['PURCHASE'] = __( 'Authorize and Capture', $this->core_plugin->text_domain() );
			}

			if ( 'AUTHORIZE' === $operation ) {
				$supported_operations['AUTHORIZE'] = __( 'Authorize Only', $this->core_plugin->text_domain() );
			}
		}

		return $supported_operations;
	}
}
