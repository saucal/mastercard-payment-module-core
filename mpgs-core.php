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
const VERSION     = '1.0.0';
const PLUGIN_FILE = __FILE__;

Main::bootstrap();
