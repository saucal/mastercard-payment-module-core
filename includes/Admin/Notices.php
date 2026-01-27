<?php
/**
 * Handle admin notices.
 *
 * @class       Notices
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore\Admin;

use GatewayPaymentCore\CorePlugin;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin Notices class
 */
final class Notices {

	/**
	 * Main instance.
	 *
	 * @var CorePlugin
	 */
	private $core_plugin;


	/**
	 * List of messages to be rendered.
	 *
	 * @var array
	 */
	private $messages = array();


	/**
	 * Constructor.
	 *
	 * @param CorePlugin $core_plugin Child plugin instance.
	 */
	public function __construct( CorePlugin $core_plugin ) {
		$this->core_plugin = $core_plugin;

		add_action( 'admin_notices', array( $this, 'maybe_add_not_connected_notice' ), 1 );
		add_action( 'admin_notices', array( $this, 'maybe_no_supported_operation_notice' ), 1 );
		add_action( 'admin_notices', array( $this, 'maybe_no_webhook_secret_notice' ), 5 );
		add_action( 'admin_notices', array( $this, 'maybe_render_messages' ), 50 );
	}


	/**
	 * Add a message notice.
	 *
	 * @param string $message The message to be rendered.
	 * @param string $type    The type of the message.
	 */
	public function add_message( $message, $type = 'error' ) {
		$this->messages[] = array(
			'message' => $message,
			'type'    => $type,
		);
	}


	/**
	 * Display an admin notice if the gateway is not connected.
	 */
	public function maybe_add_not_connected_notice() {
		if ( ! $this->core_plugin->is_enabled() || $this->core_plugin->is_merchant_connected() ) {
			return;
		}

		if ( did_action( 'woocommerce_update_options_payment_gateways_' . $this->core_plugin->plugin_id() ) ) {
			return;
		}

		$message = sprintf(
				// Translators: %1$s is the plugin title, %2$s is the settings URL, %3$s is the closing anchor tag.
			__( '%1$s - The credentials are either empty or not valid.', $this->core_plugin->text_domain() ),
			'<strong>' . $this->core_plugin->plugin_title() . '</strong>',
		);

		if ( ! $this->core_plugin->is_settings_page() ) {
			$message .= ' ' . sprintf(
				// Translators: %1$s is the plugin title, %2$s is the settings URL, %3$s is the closing anchor tag.
				__( 'Verify your connection %1$shere%2$s', $this->core_plugin->text_domain() ),
				'<a href="' . $this->core_plugin->settings_url() . '">',
				'</a>',
			);
		}

		$this->add_message(
			$message,
		);
	}


	/**
	 * Display an admin notice if the gateway is connected but there is no supported payment operation for the merchant.
	 */
	public function maybe_no_supported_operation_notice() {
		if ( ! $this->core_plugin->is_merchant_connected() || ! empty( $this->core_plugin->get_payment_operations() ) ) {
			return;
		}

		$this->add_message(
			sprintf(
				// Translators: %1$s is the plugin title, %2$s is the settings URL, %3$s is the closing anchor tag.
				__( '%1$s - There is no supported payment operation for your merchant account. Contact your acquirer to verify this issue.', $this->core_plugin->text_domain() ),
				'<strong>' . $this->core_plugin->plugin_title() . '</strong>'
			)
		);
	}


	/**
	 * Display an admin notice if the webhook secret is not set.
	 */
	public function maybe_no_webhook_secret_notice() {
		if ( ! $this->core_plugin->is_merchant_connected() || ! empty( $this->core_plugin->get_gateway_setting( 'notification_secret' ) ) ) {
			return;
		}

		$message = sprintf(
				// Translators: %1$s is the plugin title, %2$s is the settings URL, %3$s is the closing anchor tag.
			__( '%1$s - The Notification Secret is not set. Webhook notifications are required for stores to process asyncronous operations such as captures, refunds, and order status updates.', $this->core_plugin->text_domain() ),
			'<strong>' . $this->core_plugin->plugin_title() . '</strong>'
		);

		if ( ! $this->core_plugin->is_settings_page() ) {
			$message .= ' ' . sprintf(
				// Translators: %1$s is the plugin title, %2$s is the settings URL, %3$s is the closing anchor tag.
				__( 'Set the Notification Secret %1$son the settings page%2$s.', $this->core_plugin->text_domain() ),
				'<a href="' . $this->core_plugin->settings_url() . '#woocommerce_' . $this->core_plugin->plugin_id() . '_webhook">',
				'</a>',
			);
		} else {
			$message .= ' ' . sprintf(
				// Translators: %1$s is the plugin title, %2$s is the settings URL, %3$s is the closing anchor tag.
				__( 'Please add your notification secret %1$shere%2$s.', $this->core_plugin->text_domain() ),
				'<a href="#woocommerce_' . $this->core_plugin->plugin_id() . '_webhook">',
				'</a>',
			);
		}

		$this->add_message(
			$message,
			'warning',
		);
	}


	/**
	 * Render all messages.
	 */
	public function maybe_render_messages() {
		if ( empty( $this->messages ) ) {
			return;
		}

		foreach ( $this->messages as $message ) {
			self::render_admin_notice( $message['message'], $message['type'] );
		}
	}


	/**
	 * Render error notice.
	 *
	 * @param string $message The message to be rendered.
	 * @param string $type    The type of the message.
	 *
	 * @return void
	 */
	public static function render_admin_notice( $message, $type = 'error' ) {
		?>
		<div class="notice notice-<?php echo esc_attr( $type ); ?>">
			<p><?php echo wp_kses_post( $message ); ?></p>
		</div>
		<?php
	}
}
