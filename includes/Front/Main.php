<?php
/**
 * Handle front hooks.
 *
 * @class       Front
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore\Front;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Front main class
 */
final class Main {

	/**
	 * Initialize hooks.
	 *
	 * @param string $prefix Prefix of the MPGS Core instance.
	 *
	 * @return void
	 */
	public static function hooks( $prefix = '' ) {

		if ( empty( $prefix ) ) {
			return;
		}

		Assets::hooks( $prefix );
	}
}
