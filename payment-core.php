<?php
/**
 * Core module.
 *
 * @link    https://saucal.com/
 * @since   1.0.0
 * @package GatewayPaymentCore
 */

namespace GatewayPaymentCore;

// If this file is called directly, abort.
if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

// Define constants.
if ( ! defined( 'MC_CORE_VERSION' ) ) {
	define( 'MC_CORE_VERSION', '1.0.0' ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedConstantFound
}
