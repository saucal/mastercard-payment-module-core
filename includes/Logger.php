<?php
/**
 * Handle logger actions.
 *
 * @class       Logger
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Logger class
 */
final class Logger {


	/**
	 * Main instance prefix.
	 *
	 * @var string
	 */
	private $prefix = '';


	/**
	 * Is debug mode enabled.
	 *
	 * @var bool
	 */
	private $debug;


	/**
	 * WC Logger instance.
	 *
	 * @var WC_Logger
	 */
	private static $wc_logger;


	/**
	 * Constructor.
	 *
	 * @param string $prefix Main instance prefix.
	 */
	public function __construct( $prefix ) {
		$this->prefix = $prefix;
	}


	/**
	 * Set debug mode.
	 *
	 * @param bool $debug Debug mode.
	 */
	public function set_debug( $debug ) {
		$this->debug = $debug;
	}


	/**
	 * Always log errors, debug only when is on the settings.
	 *
	 * @param string $message Log message.
	 * @param string $level   Log level.
	 * @param string $file    Log file.
	 */
	public function log( $message, $level = 'debug', $file = null ) {

		if ( 'error' !== $level && ! $this->debug ) {
			return;
		}

		if ( ! self::$wc_logger ) {
			self::$wc_logger = wc_get_logger();
		}

		$handler = array( 'source' => ! empty( $file ) ? $file . '-logs' : $this->prefix . '-logs' );

		self::$wc_logger->log( $level, $message, $handler );
	}
}
