<?php
/**
 * Handle admin notices.
 *
 * @class       Notices
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore\Admin;

use MPGSCore\MpgsPlugin;

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
	 * @var MpgsPlugin
	 */
	private $mpgs_plugin;


	/**
	 * List of errors to be rendered.
	 *
	 * @var array
	 */
	private $errors = array();


	/**
	 * Constructor.
	 *
	 * @param MpgsPlugin $mpgs_plugin Child plugin instance.
	 */
	public function __construct( MpgsPlugin $mpgs_plugin ) {
		$this->mpgs_plugin = $mpgs_plugin;

		add_action( 'admin_notices', array( $this, 'maybe_add_not_connected_notice' ), 1 );
		add_action( 'admin_notices', array( $this, 'maybe_no_supported_operation_notice' ), 1 );
		add_action( 'admin_notices', array( $this, 'maybe_render_errors' ), 50 );
	}


	/**
	 * Add an error notice.
	 *
	 * @param string $message The message to be rendered.
	 */
	public function add_error( $message ) {
		$this->errors[] = $message;
	}


	/**
	 * Display an admin notice if the gateway is not connected.
	 */
	public function maybe_add_not_connected_notice() {
		if ( ! $this->mpgs_plugin->is_enabled() || $this->mpgs_plugin->is_merchant_connected() ) {
			return;
		}

		$message = sprintf(
				// Translators: %1$s is the plugin title, %2$s is the settings URL, %3$s is the closing anchor tag.
			__( 'The %1$s credentials are either empty or not valid.', $this->mpgs_plugin->mpgs_core()->text_domain() ),
			$this->mpgs_plugin->plugin_title(),
		);

		if ( ! $this->mpgs_plugin->is_settings_page() ) {
			$message .= ' ' . sprintf(
				// Translators: %1$s is the plugin title, %2$s is the settings URL, %3$s is the closing anchor tag.
				__( 'Verify your connection %1$shere%2$s', $this->mpgs_plugin->mpgs_core()->text_domain() ),
				'<a href="' . $this->mpgs_plugin->settings_url() . '">',
				'</a>',
			);
		}

		$this->add_error(
			$message,
		);
	}


	/**
	 * Display an admin notice if the gateway is connected but there is no supported payment operation for the merchant.
	 */
	public function maybe_no_supported_operation_notice() {
		if ( ! $this->mpgs_plugin->is_merchant_connected() || ! empty( $this->mpgs_plugin->get_payment_operations() ) ) {
			return;
		}

		$this->add_error(
			__( 'There is no supported payment operation for your merchant account. Contact your adquirer to verify this issue.', $this->mpgs_plugin->mpgs_core()->text_domain() ),
		);
	}


	/**
	 * Render all errors.
	 */
	public function maybe_render_errors() {
		if ( empty( $this->errors ) ) {
			return;
		}

		foreach ( $this->errors as $error ) {
			self::render_error_notice( $error );
		}
	}


	/**
	 * Render error notice.
	 *
	 * @param string $message The message to be rendered.
	 *
	 * @return void
	 */
	public static function render_error_notice( $message ) {
		?>
		<div class="notice notice-error">
			<p><?php echo wp_kses_post( $message ); ?></p>
		</div>
		<?php
	}
}
