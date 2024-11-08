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

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * GatewaySettings class
 */
final class GatewaySettings {

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

		$mpgs_core_instance = Main::instance( $prefix );

		if ( ! $mpgs_core_instance ) {
			return array();
		}

		return array(
			'enabled'     => array(
				'title'       => __( 'Enable/Disable', $mpgs_core_instance->text_domain() ),
				'label'       => __( 'Enable', $mpgs_core_instance->text_domain() ),
				'type'        => 'checkbox',
				'description' => '',
				'default'     => 'no',
			),
			'title'       => array(
				'title'       => __( 'Title', $mpgs_core_instance->text_domain() ),
				'type'        => 'text',
				'description' => __( 'This controls the title which the user sees during checkout.', $mpgs_core_instance->text_domain() ),
				'default'     => $mpgs_core_instance->plugin_title(),
			),
			'description' => array(
				'title'       => __( 'Description', $mpgs_core_instance->text_domain() ),
				'type'        => 'text',
				'description' => esc_html__( 'The description displayed when this payment method is selected.', $mpgs_core_instance->text_domain() ),
				'default'     => esc_html__( 'Pay with your Credit/Debit Card', $mpgs_core_instance->text_domain() ),
			),
		);
	}
}
