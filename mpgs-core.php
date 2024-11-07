<?php
/**
 * MPGS Core module.
 *
 * @link    https://saucal.com/
 * @since   1.0.0
 * @package MPGSCore
 */

namespace MPGSCore;

// If this file is called directly, abort.
if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

// Define constants.
if ( ! defined( 'MPGS_CORE_VERSION' ) ) {
	define( 'MPGS_CORE_VERSION', '1.0.0' );
}

if ( ! defined( 'MPGS_CORE_FILE' ) ) {
	define( 'MPGS_CORE_FILE', __FILE__ );
}
