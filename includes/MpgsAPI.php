<?php
/**
 * Class to interact with the MPGS API.
 *
 * @class       MpgsAPI
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore;

use MPGSCore\Admin\GatewaySettings;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Mpgs API class
 */
final class MpgsAPI {

	const API_VERSION = '100';


	/**
	 * MPGS Plugin instance.
	 *
	 * @var MpgsPlugin
	 */
	private $mpgs_plugin;


	/**
	 * Constructor.
	 *
	 * @param MpgsPlugin $mpgs_plugin MPGS Plugin instance.
	 */
	public function __construct( MpgsPlugin $mpgs_plugin ) {
		$this->mpgs_plugin = $mpgs_plugin;
	}


	/**
	 * Get Merchant ID from settings.
	 *
	 * @return string
	 */
	private function get_merchant_id() {
		$merchant_id = $this->mpgs_plugin->get_gateway_setting( 'merchant_id' );

		if ( $this->is_sandbox() && ! defined( 'MGPS_MID_FORCE_TEST' ) ) {
			$merchant_id = 'TEST' . $merchant_id;
		}

		return $merchant_id;
	}


	/**
	 * Get Password from settings.
	 *
	 * @return string
	 */
	private function get_password() {
		return $this->mpgs_plugin->get_gateway_setting( 'password' );
	}


	/**
	 * Authorization: Basic {Base64 encoding of 'merchant_id:password'}.
	 *
	 * @return string
	 */
	private function get_authorization() {
		return base64_encode( 'merchant.' . $this->get_merchant_id() . ':' . $this->get_password() ); //phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
	}


	/**
	 * Generate Headers for API requests.
	 *
	 * @param string $content_type Content type.
	 * @param string $endpoint     API endpoint.
	 * @param array  $payload      Payload.
	 *
	 * @return array
	 */
	protected function get_headers( $content_type = 'application/json', $endpoint = null, $payload = array() ) {

		return apply_filters(
			$this->mpgs_plugin->mpgs_core()->prefix_hook( 'request_headers' ),
			array(
				'Authorization' => 'Basic ' . $this->get_authorization(),
				'Content-Type'  => $content_type,
				'Accept'        => $content_type,
			),
			$endpoint,
			$payload
		);
	}


	/**
	 * Get if it is sandbox from settings.
	 *
	 * @return bool
	 */
	private function is_sandbox() {
		return $this->mpgs_plugin->is_sandbox();
	}


	/**
	 * Get API domain depending on mode.
	 *
	 * @return string
	 */
	private function get_domain() {
		$api_domain = $this->mpgs_plugin->gateway_settings()->payment_region_url( $this->mpgs_plugin->get_gateway_setting( 'region' ) );

		if ( defined( 'MPGS_GATEWAY_URL' ) && ! empty( \MPGS_GATEWAY_URL ) ) {
			$api_domain = \MPGS_GATEWAY_URL;
		}

		return trailingslashit(
			sprintf(
				'%1$s/api/rest/version/%2$s/merchant/%3$s',
				untrailingslashit( $api_domain ),
				self::API_VERSION,
				$this->get_merchant_id()
			)
		);
	}


	/**
	 * Request to MPGS API.
	 *
	 * @param string $endpoint API endpoint.
	 * @param string $method   Method.
	 * @param null   $payload  Payload.
	 *
	 * @return array
	 */
	protected function request( $endpoint, $method = 'GET', $payload = array() ) {
		$url  = $this->get_domain() . $endpoint;
		$args = array(
			'method'  => $method,
			'headers' => $this->get_headers( 'application/json', $endpoint, $payload ),
			'body'    => apply_filters( $this->mpgs_plugin->mpgs_core()->prefix_hook( 'request_body' ), $this->maybe_json_encode( $payload ) ),
		);

		// Logging request.
		$this->mpgs_plugin->logger()->log_request( $url, $args );

		$response = wp_safe_remote_request( $url, $args );

		// Logging responses.
		$this->mpgs_plugin->logger()->log_response( $response );

		if ( is_wp_error( $response ) ) {
			return array(
				'success' => false,
				'error'   => $response->get_error_message(),
			);
		}

		$response = $this->process_response( $response );

		if ( ! $response['success'] ) {
			$this->mpgs_plugin->logger()->log( 'Request failed: ' . $response['error'], 'error' );
		}

		return $response;
	}


	/**
	 * Maybe JSON encode data.
	 *
	 * @param mixed $data Data to encode.
	 *
	 * @return string
	 */
	private static function maybe_json_encode( $data ) {
		return ( is_array( $data ) && ! empty( $data ) ) ? wp_json_encode( $data ) : $data;
	}


	/**
	 * Maybe JSON decode data.
	 *
	 * @param string $data Data to decode.
	 *
	 * @return mixed
	 */
	private static function maybe_json_decode( $data ) {
		return ( is_string( $data ) && ! empty( $data ) ) ? json_decode( $data, true ) : $data;
	}


	/**
	 * Process request response.
	 *
	 * @param array $response Response.
	 *
	 * @return array
	 */
	private function process_response( $response ) {
		if ( empty( $response['response']['code'] ) ) {
			return array(
				'success' => false,
				'error'   => __( 'Empty response code.', 'mpgs-core' ),
			);
		}

		if ( 200 > $response['response']['code'] || 300 < $response['response']['code'] ) {
			return array(
				'success' => false,
				'error'   => sprintf(
					// Translators: %1$s: Response code, %2$s: Response message.
					__( 'Request failed with status code %1$s and message: %2$s', $this->mpgs_plugin->text_domain() ),
					$response['response']['code'],
					$response['response']['message'] ?? '',
				),
			);
		}

		return array(
			'success'       => true,
			'body'          => $this->maybe_json_decode( wp_remote_retrieve_body( $response ) ),
			'http_response' => $response,
		);
	}


	/**
	 * Payment options inquiry.
	 */
	public function payment_options_inquiry() {
		return $this->request( 'paymentOptionsInquiry', 'POST' );
	}


	/**
	 * Create session.
	 *
	 * @param array $payload Payload.
	 */
	public function create_session( $payload ) {
		return $this->request( 'session', 'POST', $payload );
	}
}
