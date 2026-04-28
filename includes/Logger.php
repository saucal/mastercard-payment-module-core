<?php
/**
 * Handle logger actions.
 *
 * @class       Logger
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore;

use WC_Logger;
use WP_Error;
use WP_HTTP_Requests_Response;

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
	private $wc_logger;


	/**
	 * Core Plugin instance.
	 *
	 * @var CorePlugin
	 */
	private $core_plugin;


	/**
	 * Force disabled logger.
	 *
	 * @var bool
	 */
	private $force_disabled = false;


	/**
	 * Context file override. While non-null, every log() call routes its
	 * output to this file regardless of its $file argument. Used during
	 * webhook processing so the retrieve_order GET (and any nested API
	 * calls) land in the webhook log instead of the main api log.
	 *
	 * @var string|null
	 */
	private $context_file = null;


	/**
	 * Constructor.
	 *
	 * @param CorePlugin $core_plugin Core Plugin instance.
	 */
	public function __construct( CorePlugin $core_plugin ) {
		$this->core_plugin = $core_plugin;
	}


	/**
	 * Push a context file override. Pair with pop_context().
	 *
	 * @param string $file File handler name (without `-logs` suffix).
	 */
	public function push_context( $file ) {
		$this->context_file = $file;
	}


	/**
	 * Clear the context file override.
	 */
	public function pop_context() {
		$this->context_file = null;
	}


	/**
	 * Always log errors, debug only when is on the settings.
	 *
	 * @param string $message Log message.
	 * @param string $level   Log level.
	 * @param string $file    Log file.
	 */
	public function log( $message, $level = 'debug', $file = null ) {

		if ( $this->force_disabled || ( 'error' !== $level && ! $this->core_plugin->is_debug() ) ) {
			return;
		}

		if ( ! $this->wc_logger ) {
			$this->wc_logger = wc_get_logger();
		}

		$effective_file = ! empty( $this->context_file ) ? $this->context_file : $file;
		$handler        = array( 'source' => ! empty( $effective_file ) ? $effective_file . '-logs' : $this->core_plugin->plugin_id() . '-logs' );

		$this->wc_logger->log( $level, $message, $handler );
	}


	/**
	 * Log request.
	 *
	 * @param string $url  Request URL.
	 * @param array  $args Request arguments.
	 * @param string $level Log level.
	 */
	public function log_request( $url, $args, $level = 'debug' ) {
		unset( $args['headers'] );
		$method = isset( $args['method'] ) ? $args['method'] : 'POST';
		$data   = ! empty( $args['body'] ) ? self::maybe_mask_in_json( $args['body'] ) : '--- EMPTY STRING ---';
		$this->log( $method . ' Request: ' . $url . "\n\n" . $data . "\n", $level );
	}


	/**
	 * Log response.
	 *
	 * @param WP_Error|array $response Response.
	 * @param string         $level    Log level.
	 */
	public function log_response( $response, $level = 'debug' ) {
		$data = '--- EMPTY STRING ---';

		if ( is_wp_error( $response ) ) {
			$level = 'error';
			$data  = $response->get_error_code() . ': ' . $response->get_error_message();
		}

		if ( is_array( $response ) && isset( $response['http_response'] ) && is_a( $response['http_response'], WP_HTTP_Requests_Response::class ) ) {
			$data   = $response['http_response']->get_response_object()->raw;
			$orig   = $response['http_response']->get_data();
			$masked = self::maybe_mask_in_json( $orig );
			$data   = str_replace( $orig, $masked, $data );
		}

		$this->log( 'Response: ' . "\n\n" . $data . "\n", $level );
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


	/**
	 * Force disable logger.
	 */
	public function force_disable() {
		$this->force_disabled = true;
	}


	/**
	 * Restore force disable logger.
	 */
	public function restore_force_disable() {
		$this->force_disabled = false;
	}
}
