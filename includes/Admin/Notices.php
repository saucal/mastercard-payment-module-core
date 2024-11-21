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
	 * Initialize hooks.
	 *
	 * @return void
	 */
	public static function hooks() {
		add_action( 'admin_init', array( __CLASS__, 'maybe_add_not_connected_notice' ) );
		add_action( 'admin_init', array( __CLASS__, 'maybe_no_supported_operation_notice' ) );
	}


	/**
	 * Display an admin notice if the MPGSCore package is missing.
	 */
	public static function missing_mpgs_core_notice() {
		self::render_error_notice( __( 'The plugin package is corrupt or incomplete: MPGS Core package is missing.', MpgsPlugin::text_domain() ) );
	}


	/**
	 * Display an admin notice if the gateway is not connected.
	 */
	public static function maybe_add_not_connected_notice() {
		if ( ! MpgsPlugin::is_enabled() || MpgsPlugin::is_merchant_connected() ) {
			return;
		}

		self::render_error_notice(
			sprintf(
				// Translators: %1$s is the plugin title, %2$s is the settings URL, %3$s is the closing anchor tag.
				__( 'The %1$s credentials are either empty or not valid. Verify your connection %2$shere%3$s', MpgsPlugin::text_domain() ),
				MpgsPlugin::plugin_title(),
				'<a href="' . MpgsPlugin::settings_url() . '">',
				'</a>',
			)
		);
	}


	/**
	 * Display an admin notice if the gateway is connected but there is no supported payment operation for the merchant.
	 */
	public static function maybe_no_supported_operation_notice() {
		if ( ! MpgsPlugin::is_merchant_connected() || ! empty( MpgsPlugin::get_payment_operations() ) ) {
			return;
		}

		self::render_error_notice(
			__( 'There is no supported payment operation for your merchant account. Contact your adquirer to verify this issue.', MpgsPlugin::text_domain() ),
		);
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
