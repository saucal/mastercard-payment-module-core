<?php
/**
 * Gateway settings definition.
 *
 * @class       Admin
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore\Admin;

use MPGSCore\MpgsPlugin;

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
	 * @var MpgsPlugin
	 */
	private $mpgs_plugin;


	/**
	 * Constructor.
	 *
	 * @param MpgsPlugin $mpgs_plugin Plugin instance.
	 */
	public function __construct( MpgsPlugin $mpgs_plugin ) {
		$this->mpgs_plugin = $mpgs_plugin;
	}

	/**
	 * Get the gateway settings.
	 *
	 * @return array
	 */
	public function get_settings() {

		if ( empty( $this->mpgs_plugin->mpgs_core() ) ) {
			return array();
		}

		$settings = array(
			'enabled'          => array(
				'title'       => __( 'Enable/Disable', $this->mpgs_plugin->text_domain() ),
				'label'       => __( 'Enable', $this->mpgs_plugin->text_domain() ),
				'type'        => 'checkbox',
				'description' => '',
				'default'     => 'no',
			),
			'title'            => array(
				'title'       => __( 'Title', $this->mpgs_plugin->text_domain() ),
				'type'        => 'text',
				'description' => __( 'The payment method title displayed during checkout.', $this->mpgs_plugin->text_domain() ),
				'default'     => $this->mpgs_plugin->mpgs_core()->plugin_title(),
				'desc_tip'    => true,
			),
			'description'      => array(
				'title'       => __( 'Description', $this->mpgs_plugin->text_domain() ),
				'type'        => 'text',
				'description' => esc_html__( 'The description displayed when this payment method is selected.', $this->mpgs_plugin->text_domain() ),
				'default'     => esc_html__( 'Pay with your Credit/Debit Card', $this->mpgs_plugin->text_domain() ),
				'desc_tip'    => true,
			),
			'region'           => array(
				'title'   => __( 'Merchant Region', $this->mpgs_plugin->text_domain() ),
				'type'    => 'select',
				'options' => wp_list_pluck( self::payment_regions(), 'name', 'code' ),
				'default' => 'eu',
			),
			'merchant_details' => array(
				'title'       => __( 'Merchant account details', $this->mpgs_plugin->text_domain() ),
				'description' => $this->merchant_details_message(),
				'type'        => 'title',
			),
			'sandbox'          => array(
				'title'       => __( 'Test Sandbox', $this->mpgs_plugin->text_domain() ),
				'label'       => __( 'Enable test sandbox mode', $this->mpgs_plugin->text_domain() ),
				'type'        => 'checkbox',
				'description' => __( 'Place the payment gateway in test mode using test API credentials (real payments will not be taken).', $this->mpgs_plugin->text_domain() ),
				'default'     => 'no',
				'desc_tip'    => true,
			),
			'merchant_id'      => array(
				'title'       => __( 'Merchant ID', $this->mpgs_plugin->text_domain() ),
				'type'        => 'text',
				'description' => __( 'This is your merchant profile ID.', $this->mpgs_plugin->text_domain() ),
				'default'     => '',
			),
			'password'         => array(
				'title'       => __( 'API Password', $this->mpgs_plugin->text_domain() ),
				'type'        => 'password',
				'description' => __( 'This is your API password.', $this->mpgs_plugin->text_domain() ),
				'default'     => '',
			),
		);

		return $this->maybe_add_advanced_settings( $settings );
	}


	/**
	 * Merchant details message.
	 *
	 * @return string
	 */
	protected function merchant_details_message() {
		$message = __( 'Enter your Mastercard Payment Gateway Services account details.', $this->mpgs_plugin->text_domain() );

		if ( ! empty( $this->mpgs_plugin->merchant_registration_url() ) ) {
			$message .= ' ' . sprintf(
				/* translators: %s: Merchant registration URL */
				__( 'Don\'t have an account? %1$sSign up here%2$s', $this->mpgs_plugin->text_domain() ),
				'<a href="' . esc_url( $this->mpgs_plugin->merchant_registration_url() ) . '" target="_blank">',
				'</a>'
			);
		}

		return $message;
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
			untrailingslashit( $this->mpgs_plugin->gateway_url() ) . '/notification/ui/merchant/apiNotifications'
		);
	}


	/**
	 * Add advanced settings if the credentials are valid.
	 *
	 * @param array $settings Settings.
	 *
	 * @return array
	 */
	private function maybe_add_advanced_settings( $settings ) {

		if ( ! $this->mpgs_plugin->get_validated_credentials() ) {
			return $settings;
		}

		$supported_operations = self::supported_payment_operations();

		if ( empty( $supported_operations ) ) {
			return $settings;
		}

		return array_merge(
			$settings,
			array(
				'webhook'              => array(
					'title' => __( 'Webhook notifications', $this->mpgs_plugin->text_domain() ),
					'type'  => 'title',
				),
				'notification_secret'  => array(
					'title'       => __( 'Notification secret', $this->mpgs_plugin->text_domain() ),
					'type'        => 'text',
					'description' => sprintf(
						__( 'You can obtain or generate your notification secret %1$shere%2$s', $this->mpgs_plugin->text_domain() ),
						'<a href="' . esc_url( $this->webhook_notification_url() ) . '" target="_blank">',
						'</a>'
					),
				),
				'payments'             => array(
					'title' => __( 'Payment configurations', $this->mpgs_plugin->text_domain() ),
					'type'  => 'title',
				),
				'transaction_mode'     => array(
					'title'       => __( 'Payment capture', $this->mpgs_plugin->text_domain() ),
					'type'        => 'select',
					'options'     => $supported_operations,
					'default'     => 'PURCHASE',
					'description' => __( 'Choose "Authorize and Capture" to authorize and capture the payment immediately. Choose "Authorize" to only authorize the payment, and capture it manually later from the WC admin panel.', $this->mpgs_plugin->text_domain() ),
				),
				'checkout_mode'        => array(
					'title'   => __( 'Integration mode', $this->mpgs_plugin->text_domain() ),
					'type'    => 'select',
					'options' => self::checkout_modes(),
					'default' => 'hosted_session',
				),
				'hosted_checkout_mode' => array(
					'title'             => __( 'Hosted Checkout Mode', $this->mpgs_plugin->text_domain() ),
					'type'              => 'select',
					'options'           => array(
						'embedded' => __( 'Embedded', $this->mpgs_plugin->text_domain() ),
						'redirect' => __( 'Redirect to Payment Page', $this->mpgs_plugin->text_domain() ),
					),
					'default'           => 'embedded',
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'checkout_mode',
						'data-show-if'  => 'hosted_checkout',
					),
				),
				'display_logo'         => array(
					'title'             => __( 'Display Plugin\'s Logo', $this->mpgs_plugin->text_domain() ),
					'label'             => __( 'Check this to display the plugin\'s logo in the Hosted Checkout page.', $this->mpgs_plugin->text_domain() ),
					'type'              => 'checkbox',
					'default'           => 'yes',
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'checkout_mode',
						'data-show-if'  => 'hosted_checkout',
					),
				),
				'_3d_secure'           => array(
					'title'             => __( '3D Secure', $this->mpgs_plugin->text_domain() ),
					'type'              => 'checkbox',
					'default'           => 'yes',
					'description'       => __( 'Contact your payment service provider if you need more information.', $this->mpgs_plugin->text_domain() ),
					'desc_tip'          => true,
					'class'             => 'conditional-hide',
					'custom_attributes' => array(
						'data-show-rel' => 'checkout_mode',
						'data-show-if'  => 'hosted_session',
					),
				),
				'saved_cards'          => array(
					'title'       => __( 'Saved Cards', $this->mpgs_plugin->text_domain() ),
					'label'       => __( 'Enable payment via saved tokenized cards', $this->mpgs_plugin->text_domain() ),
					'type'        => 'checkbox',
					'description' => __( 'If enabled, users will be able to pay with a saved card during checkout. Card details are saved in the payment gateway, not on your store.', $this->mpgs_plugin->text_domain() ),
					'default'     => 'yes',
					'desc_tip'    => true,
				),
				'merchant_name'        => array(
					'title'       => __( 'Merchant Name', $this->mpgs_plugin->text_domain() ),
					'type'        => 'text',
					'description' => __( 'The name of your business for display to the payer on the payment interaction (The website title will be used as default).', $this->mpgs_plugin->text_domain() ),
					'default'     => get_bloginfo( 'name', 'display' ),
				),
				'advanced'             => array(
					'title' => __( 'Advanced configurations', $this->mpgs_plugin->text_domain() ),
					'type'  => 'title',
				),
				'debug'                => array(
					'title'       => __( 'Logging', $this->mpgs_plugin->text_domain() ),
					'label'       => __( 'Log debug messages', $this->mpgs_plugin->text_domain() ),
					'type'        => 'checkbox',
					'description' => __( 'Save debug messages to the WooCommerce System Status log.', $this->mpgs_plugin->text_domain() ),
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
	public function payment_regions() {

		if ( ! $this->mpgs_plugin->mpgs_core() ) {
			return array();
		}

		return array(
			'ap' => array(
				'name' => __( 'Asia Pacific and Middle East', $this->mpgs_plugin->text_domain() ),
				'code' => 'ap',
				'url'  => 'https://ap-gateway.mastercard.com',
			),
			'eu' => array(
				'name' => __( 'Europe', $this->mpgs_plugin->text_domain() ),
				'code' => 'eu',
				'url'  => 'https://eu-gateway.mastercard.com',
			),
			'na' => array(
				'name' => __( 'North America', $this->mpgs_plugin->text_domain() ),
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
	public function payment_region_url( $region ) {

		$regions = $this->payment_regions();

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
	public function checkout_modes() {
		return array(
			'hosted_session'  => __( 'Hosted Session', $this->mpgs_plugin->text_domain() ),
			'hosted_checkout' => __( 'Hosted Checkout', $this->mpgs_plugin->text_domain() ),
		);
	}


	/**
	 * Get supported payment operations.
	 *
	 * @return array
	 */
	public function supported_payment_operations() {

		$supported_operations = array();

		if ( empty( $this->mpgs_plugin->get_validated_credentials() ) ) {
			return $supported_operations;
		}

		$payment_operations = $this->mpgs_plugin->get_payment_operations();

		if ( empty( $payment_operations ) || ! is_array( $payment_operations ) ) {
			return $supported_operations;
		}

		foreach ( $payment_operations as $supported_operation ) {
			$operation = reset( $supported_operation );

			if ( 'PURCHASE' === $operation ) {
				$supported_operations['PURCHASE'] = __( 'Authorize and Capture', $this->mpgs_plugin->text_domain() );
			}

			if ( 'AUTHORIZE' === $operation ) {
				$supported_operations['AUTHORIZE'] = __( 'Authorize', $this->mpgs_plugin->text_domain() );
			}
		}

		return $supported_operations;
	}
}
