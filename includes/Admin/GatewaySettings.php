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
		return $this->core_plugin->merchant_registration_message();
	}


	/**
	 * Initialize the settings.
	 *
	 * @return void
	 */
	private function init_settings() {
		$regions = wp_list_pluck( self::payment_regions(), 'urls', 'code' );
		// TODO: Maybe better support links to the actual regions being tested? This works on initial load, but changing regions defaults to the first URL of the region.
		foreach ( $regions as $code => $urls ) {
			$regions[ $code ] = \array_first( $urls );
		}
		$this->settings = array_merge(
			array(
				'enabled'          => array(
					'title'       => __( 'Enable/Disable', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'label'       => __( 'Enable', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'        => 'checkbox',
					'description' => '',
					'default'     => 'no',
				),
				'title'            => array(
					'title'       => __( 'Title', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'        => 'text',
					'description' => __( 'The payment method title displayed during checkout.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'default'     => $this->core_plugin->payment_core()->plugin_title(),
					'desc_tip'    => true,
				),
				'description'      => array(
					'title'       => __( 'Description', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'        => 'text',
					'description' => esc_html__( 'The description displayed when this payment method is selected.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'default'     => esc_html__( 'Pay with your Credit/Debit Card', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'desc_tip'    => true,
				),
				'merchant_details' => array(
					'title'       => __( 'Merchant Account Details', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'description' => $this->merchant_details_message(),
					'type'        => 'title',
				),
				'sandbox'          => array(
					'title'             => __( 'Test Mode', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'label'             => __( 'Enable test mode', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'              => 'checkbox',
					'description'       => sprintf(
						/* translators: %1$s: opening link tag, %2$s: closing link tag */
						__( 'Set the payment gateway in test mode using test API credentials (real payments will not be taken). You can use %1$stest card numbers%2$s to simulate various transactions.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
						'<a href="https://test-gateway.mastercard.com/api/documentation/integrationGuidelines/supportedFeatures/testAndGoLive.html" target="_blank">',
						'</a>'
					),
					'default'           => 'no',
					'custom_attributes' => array(
						'data-region-urls' => wp_json_encode( $regions ),
						'data-region-is'   => 'test',
					),
				),
			),
			$this->get_region_setting(),
			array(
				'merchant_id'              => array(
					'title'             => __( 'Merchant ID', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'              => 'text',
					'description'       => sprintf(
						/* translators: %1$s: opening link tag, %2$s: closing link tag */
						__( 'This is the Merchant ID you use to log into the %1$sMerchant Portal%2$s.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
						'<a href="' . esc_url(
							untrailingslashit( $this->settings_gateway_url() ) . '/ma/login.s'
						) . '" target="_blank">',
						'</a>'
					),
					'default'           => '',
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'sandbox',
						'data-show-if'  => 'no',
					),
				),
				'password'                 => array(
					'title'             => __( 'Integration Authentication Password', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'              => 'password',
					'description'       => sprintf(
						/* translators: %1$s: opening link tag, %2$s: closing link tag */
						__( 'You can obtain your integration authentication password from the Merchant Portal (%1$sAdmin -> Integration Settings%2$s).', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
						'<a href="' . esc_url(
							add_query_arg(
								array(
									'_authDomain'      => 'ma',
									'selectedMenuItem' => 'apiConfiguration',
								),
								untrailingslashit( $this->settings_gateway_url() ) . '/ma/apiConfiguration.s'
							)
						) . '" target="_blank">',
						'</a>'
					),
					'default'           => '',
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'sandbox',
						'data-show-if'  => 'no',
					),
				),
				'test_merchant_id'         => array(
					'title'             => __( 'Test Merchant ID', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'              => 'text',
					'description'       => sprintf(
						/* translators: %1$s: opening link tag, %2$s: closing link tag */
						__( 'This is the Merchant ID you use to log into the %1$sMerchant Portal%2$s.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
						'<a href="' . esc_url(
							untrailingslashit( $this->settings_gateway_url() ) . '/ma/login.s'
						) . '" target="_blank">',
						'</a>'
					),
					'default'           => '',
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'sandbox',
						'data-show-if'  => 'yes',
					),
				),
				'test_password'            => array(
					'title'             => __( 'Test Integration Authentication Password', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'              => 'password',
					'description'       => sprintf(
						/* translators: %1$s: opening link tag, %2$s: closing link tag */
						__( 'You can obtain your integration authentication password from the Merchant Portal (%1$sAdmin -> Integration Settings%2$s).', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
						'<a href="' . esc_url(
							add_query_arg(
								array(
									'_authDomain'      => 'ma',
									'selectedMenuItem' => 'apiConfiguration',
								),
								untrailingslashit( $this->settings_gateway_url() ) . '/ma/apiConfiguration.s'
							)
						) . '" target="_blank">',
						'</a>'
					),
					'default'           => '',
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'sandbox',
						'data-show-if'  => 'yes',
					),
				),
				'webhook'                  => array(
					'title' => __( 'Webhook Notifications', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'  => 'title',
				),
				'notification_secret'      => array(
					'title'             => __( 'Notification Secret', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'              => 'text',
					'description'       => sprintf(
						/* translators: %1$s: opening link tag, %2$s: closing link tag */
						__( 'You can obtain or generate your notification secret on the Merchant Portal (%1$sAdmin -> Webhook Notifications%2$s).', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
						'<a href="' . esc_url( $this->webhook_notification_url() ) . '" target="_blank">',
						'</a>'
					),
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'sandbox',
						'data-show-if'  => 'no',
					),
				),
				'test_notification_secret' => array(
					'title'             => __( 'Test Notification Secret', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'              => 'text',
					'description'       => sprintf(
						/* translators: %1$s: opening link tag, %2$s: closing link tag */
						__( 'You can obtain or generate your notification secret on the Merchant Portal (%1$sAdmin -> Webhook Notifications%2$s).', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
						'<a href="' . esc_url( $this->webhook_notification_url() ) . '" target="_blank">',
						'</a>'
					),
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'sandbox',
						'data-show-if'  => 'yes',
					),
				),
			)
		);

		$this->maybe_add_advanced_settings();
	}

	/**
	 * Get the regions field.
	 */
	private function get_region_setting() {
		$regions = wp_list_pluck( self::payment_regions(), 'name', 'code' );

		if ( isset( $regions['test'] ) ) {
			unset( $regions['test'] );
		}

		if ( empty( $regions ) || count( $regions ) < 2 ) {
			return array();
		}

		return array(
			'region' => array(
				'title'             => __( 'Merchant Region', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
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
	 * Gateway URL for the settings descriptions.
	 *
	 * @return string
	 */
	private function settings_gateway_url() {
		$gateway_url = $this->core_plugin->gateway_url();

		if ( ! empty( $gateway_url ) ) {
			return $gateway_url;
		}

		$regions  = $this->core_plugin->payment_regions_available();
		$settings = $this->core_plugin->get_gateway_settings();
		$region   = $settings['region'] ?? '';

		if ( empty( $region ) || ! isset( $regions[ $region ] ) ) {
			$region = array_key_first( $regions );
		}

		return \array_first( $regions[ $region ]['urls'] );
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
			untrailingslashit( $this->settings_gateway_url() ) . '/notification/ui/merchant/apiNotifications'
		);
	}


	/**
	 * Add advanced settings if the credentials are valid.
	 */
	private function maybe_add_advanced_settings() {

		if ( ! $this->core_plugin->get_validated_credentials() ) {
			return;
		}

		$supported_operations = self::supported_payment_operations();

		if ( empty( $supported_operations ) ) {
			return;
		}

		// Supported operations options and explanations.
		$supported_operations_options = wp_list_pluck( $supported_operations, 'label' );

		$supported_operations_explain = wp_list_pluck( $supported_operations, 'explain' );

		// TODO: Move to the Subscription addon class.
		$supported_operations_explain['subscriptions'] = '' . __( 'This setting does not affect subscriptions; charges for orders related to subscriptions are always captured.', '__PAYMENTS_CORE_TEXT_DOMAIN__' );

		// Checkout modes options and explanations.
		$checkout_modes         = self::checkout_modes();
		$checkout_modes_options = wp_list_pluck( $checkout_modes, 'label' );
		$checkout_modes_explain = wp_list_pluck( $checkout_modes, 'explain' );

		// Hosted Checkout Modes and explanations.
		$hosted_checkout_modes         = array(
			'embedded' => array(
				'label'   => __( 'Embedded', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				'explain' => __( '"Embedded" displays the payment form inside an iframe on your checkout page.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
			),
			'redirect' => array(
				'label'   => __( 'Redirect', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				'explain' => __( '"Redirect" sends customers to a secure external page to complete payment, and then back to your store.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
			),
		);
		$hosted_checkout_modes_options = wp_list_pluck( $hosted_checkout_modes, 'label' );
		$hosted_checkout_modes_explain = wp_list_pluck( $hosted_checkout_modes, 'explain' );

		$this->settings = array_merge(
			$this->settings,
			array(
				'payments'             => array(
					'title' => __( 'Payment configurations', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'  => 'title',
				),
				'merchant_name'        => array(
					'title'       => __( 'Merchant Name', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'        => 'text',
					'description' => __( 'The name of your business for display to the payer on the payment interaction.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'desc_tip'    => true,
					'default'     => get_bloginfo( 'name', 'display' ),
					'placeholder' => get_bloginfo( 'name', 'display' ),
				),
				'transaction_mode'     => array(
					'title'       => __( 'Payment Capture', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'        => 'select',
					'options'     => $supported_operations_options,
					'default'     => \array_key_first( $supported_operations_options ),
					'description' => implode( '<br/><br/>', $supported_operations_explain ),
					'desc_tip'    => true,
				),
				'checkout_mode'        => array(
					'title'       => __( 'Integration Mode', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'        => 'select',
					'options'     => $checkout_modes_options,
					'default'     => \array_key_first( $checkout_modes_options ),
					'description' => implode( '<br/><br/>', $checkout_modes_explain ),
					'desc_tip'    => true,
				),
				'hosted_checkout_mode' => array(
					'title'             => __( 'Hosted Checkout Mode', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'              => 'select',
					'options'           => $hosted_checkout_modes_options,
					'default'           => \array_key_first( $hosted_checkout_modes_options ),
					'description'       => implode( '<br/><br/>', $hosted_checkout_modes_explain ),
					'desc_tip'          => true,
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'checkout_mode',
						'data-show-if'  => 'hosted_checkout',
					),
				),
				'display_logo'         => array(
					'title'             => __( 'Display Plugin\'s Logo', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'label'             => __( 'Check this to display the plugin\'s logo in the Hosted Checkout page.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'              => 'checkbox',
					'default'           => 'yes',
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'checkout_mode',
						'data-show-if'  => 'hosted_checkout',
					),
				),
				'features'             => array(
					'title' => __( 'Features', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'  => 'title',
				),
				'_3d_secure'           => array(
					'title'             => __( '3-D Secure', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'label'             => __( 'Enable 3-D Secure (3DS)', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'              => 'checkbox',
					'default'           => 'yes',
					'description'       => __( 'If enabled, adds an additional layer of security to online purchases by requiring cardholders to authenticate themselves with the card issuer when making payments.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'desc_tip'          => true,
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'checkout_mode',
						'data-show-if'  => 'hosted_session',
					),
				),
				'saved_cards'          => array(
					'title'             => __( 'Saved Cards', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'label'             => __( 'Enable payment via saved tokenized cards', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'              => 'checkbox',
					'description'       => __( 'If enabled, users will be able to pay with a saved card during checkout. Card details are saved in the payment gateway, not on your store.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'default'           => 'yes',
					'desc_tip'          => true,
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'checkout_mode',
						'data-show-if'  => 'hosted_session',
					),
				),
				'advanced'             => array(
					'title' => __( 'Advanced configurations', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'  => 'title',
				),
				'debug'                => array(
					'title'       => __( 'Logging', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'label'       => __( 'Log debug messages', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'type'        => 'checkbox',
					'description' => __( 'Save debug messages to the WooCommerce System Status log.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					'default'     => 'yes',
					'desc_tip'    => true,
				),
			)
		);

		/**
		 * Filters the gateway settings before they are displayed.
		 *
		 * @since 1.0.0
		 */
		$this->settings = apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_gateway_settings', $this->settings );
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
			'hosted_session'  => array(
				'label'   => __( 'Hosted Session', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				'explain' => __( '"Hosted Session" allows you to manage the layout and styling of your payment page while minimizing PCI compliance costs.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
			),
			'hosted_checkout' => array(
				'label'   => __( 'Hosted Checkout', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
				'explain' => __( '"Hosted Checkout" allows you to gather payment details through a hosted interface.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
			),
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

		$supported_operations['PURCHASE'] = array(
			'label'   => __( 'Authorize and Capture', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
			'explain' => __( '"Authorize and Capture" captures the payment immediately when the order is placed.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
		);

		$supported_operations['AUTHORIZE'] = array(
			'label'   => __( 'Authorize Only', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
			'explain' => __( '"Authorize Only" authorizes the payment and allows you to capture it manually later from the WC admin panel.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
		);

		foreach ( $payment_operations as $supported_operation ) {
			$operation = reset( $supported_operation );

			if ( 'PURCHASE' === $operation ) {
				$supported_operations['PURCHASE']['found'] = true;
			}

			if ( 'AUTHORIZE' === $operation ) {
				$supported_operations['AUTHORIZE']['found'] = true;
			}
		}

		// Remove unsupported operations.
		foreach ( $supported_operations as $key => $supported_operation ) {
			if ( empty( $supported_operation['found'] ) ) {
				unset( $supported_operations[ $key ] );
			} else {
				unset( $supported_operations[ $key ]['found'] );
			}
		}

		return $supported_operations;
	}
}
