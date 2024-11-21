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
	 * WC Logger instance.
	 *
	 * @var WC_Logger
	 */
	private static $wc_logger;


	/**
	 * Always log errors, debug only when is on the settings.
	 *
	 * @param string $message Log message.
	 * @param string $level   Log level.
	 * @param string $file    Log file.
	 */
	public static function log( $message, $level = 'debug', $file = null ) {

		if ( 'error' !== $level && ! MpgsPlugin::is_sandbox() ) {
			return;
		}

		if ( ! self::$wc_logger ) {
			self::$wc_logger = wc_get_logger();
		}

		$handler = array( 'source' => ! empty( $file ) ? $file . '-logs' : MpgsPlugin::plugin_id() . '-logs' );

		self::$wc_logger->log( $level, $message, $handler );
	}


	/**
	 * Log request.
	 *
	 * @param string $url  Request URL.
	 * @param array  $args Request arguments.
	 * @param string $level Log level.
	 */
	public static function log_request( $url, $args, $level = 'debug' ) {
		unset( $args['headers'] );
		$method = isset( $args['method'] ) ? $args['method'] : 'POST';
		$data   = ! empty( $args['body'] ) ? self::maybe_mask_in_json( $args['body'] ) : '--- EMPTY STRING ---';
		self::log( $method . ' Request: ' . $url . "\n\n" . $data . "\n", $level );
	}


	/**
	 * Log response.
	 *
	 * @param WP_Error|array $response Response.
	 * @param string         $level    Log level.
	 */
	public static function log_response( $response, $level = 'debug' ) {
		$data = '--- EMPTY STRING ---';

		if ( is_wp_error( $response ) ) {
			$level = 'error';
			$data  = $response->get_error_code() . ': ' . $response->get_error_message();
		}

		if ( is_array( $response ) && isset( $response['http_response'] ) && is_a( $response['http_response'], 'WP_HTTP_Requests_Response' ) ) {
			$data   = $response['http_response']->get_response_object()->raw;
			$orig   = $response['http_response']->get_data();
			$masked = self::maybe_mask_in_json( $orig );
			$data   = str_replace( $orig, $masked, $data );
		}

		self::log( 'Response: ' . "\n\n" . $data . "\n", $level );
	}


	/**
	 * Maybe mask data in JSON.
	 *
	 * @param string $data Data to mask.
	 *
	 * @return string
	 */
	private static function maybe_mask_in_json( $data ) {
		// TODO: Mask sensitive data in JSON.
		return $data;
	}
}
