<?php
/**
 * Class to interact with the API.
 *
 * @class       API
 * @version     1.0.0
 * @package     GatewayPaymentCore/Classes/
 */

namespace GatewayPaymentCore;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * API class
 */
final class API {

	const API_VERSION = '100';

	const PARTNER_SOLUTION_OPERATIONS = array(
		'INITIATE_CHECKOUT',
		'CAPTURE',
		'REFUND',
		'VOID',
		'UPDATE_SESSION',
		'PAY',
		'AUTHORIZE',
		'VERIFY',
		'INITIATE_AUTHENTICATION',
	);


	/**
	 * Core Plugin instance.
	 *
	 * @var CorePlugin
	 */
	private $core_plugin;


	/**
	 * Constructor.
	 *
	 * @param CorePlugin $core_plugin Core Plugin instance.
	 */
	public function __construct( CorePlugin $core_plugin ) {
		$this->core_plugin = $core_plugin;
	}


	/**
	 * Get Merchant ID from settings.
	 *
	 * @return string
	 */
	private function get_merchant_id() {
		return $this->core_plugin->merchant_id();
	}


	/**
	 * Get Password from settings.
	 *
	 * @return string
	 */
	private function get_password() {
		return $this->core_plugin->password();
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

		/**
		 * Filters the API request headers.
		 *
		 * @since 1.0.0
		 */
		return apply_filters(
			'PAYMENTS_CORE_HOOK_PREFIX_request_headers',
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
	 * Get API domain depending on mode.
	 *
	 * @return string
	 */
	public function get_domain() {
		return trailingslashit(
			sprintf(
				'%1$s/api/rest/version/%2$s/merchant/%3$s',
				untrailingslashit( $this->core_plugin->gateway_url() ),
				self::API_VERSION,
				$this->get_merchant_id()
			)
		);
	}


	/**
	 * Request to the API.
	 *
	 * @param string $endpoint API endpoint.
	 * @param string $method   Method.
	 * @param array  $payload  Payload.
	 *
	 * @return array
	 */
	protected function request( $endpoint, $method = 'GET', $payload = array() ) {
		$payload = $this->maybe_add_partner_solution_id( $payload );

		$url  = $this->get_domain() . $endpoint;
		$args = array(
			'method'  => $method,
			'headers' => $this->get_headers( 'application/json', $endpoint, $payload ),
			/**
			 * Filters the API request body.
			 *
			 * @since 1.0.0
			 */
			'body'    => apply_filters( 'PAYMENTS_CORE_HOOK_PREFIX_request_body', $this->maybe_json_encode( $payload ) ),
			'timeout' => 60,
		);

		// Logging request.
		$this->core_plugin->logger()->log_request( $url, $args );

		$response = wp_safe_remote_request( $url, $args );

		// Logging responses.
		$this->core_plugin->logger()->log_response( $response );

		if ( is_wp_error( $response ) ) {
			return array(
				'success' => false,
				'error'   => $response->get_error_message(),
			);
		}

		$response = $this->process_response( $response );

		if ( ! $response['success'] ) {
			$this->core_plugin->logger()->log( 'Request failed: ' . $response['error'], 'error' );
		}

		return $response;
	}


	/**
	 * Add the partner solution ID.
	 *
	 * @param mixed $payload Payload.
	 *
	 * @return mixed
	 */
	private function maybe_add_partner_solution_id( $payload ) {
		if ( ! is_array( $payload ) || isset( $payload['partnerSolutionId'] ) ) {
			return $payload;
		}

		if ( empty( $payload['apiOperation'] ) || ! in_array( $payload['apiOperation'], self::PARTNER_SOLUTION_OPERATIONS, true ) ) {
			return $payload;
		}

		$partner_solution_id = $this->core_plugin->partner_solution_id();

		if ( ! empty( $partner_solution_id ) ) {
			$payload['partnerSolutionId'] = $partner_solution_id;
		}

		return $payload;
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
		if ( ! is_string( $data ) || empty( $data ) ) {
			return null;
		}

		$body = json_decode( $data, true, 512, \JSON_INVALID_UTF8_IGNORE );
		if ( json_last_error() !== JSON_ERROR_NONE ) {
			return null;
		}

		return $body;
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
				'error'   => __( 'Empty response code.', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
			);
		}

		$body = $this->maybe_json_decode( wp_remote_retrieve_body( $response ) );

		if ( 200 > $response['response']['code'] || 300 < $response['response']['code'] ) {
			return array(
				'success' => false,
				'error'   => sprintf(
					// Translators: %1$s: Response code, %2$s: Response message.
					__( 'Request failed with status code %1$s and message: %2$s', '__PAYMENTS_CORE_TEXT_DOMAIN__' ),
					$body['error']['cause'] ?? $response['response']['code'],
					$body['error']['explanation'] ?? '',
				),
			);
		}

		return array(
			'success'       => true,
			'body'          => $body,
			'http_response' => $response,
		);
	}


	/**
	 * Payment options inquiry.
	 *
	 * @param array $payload Payload.
	 */
	public function payment_options_inquiry( $payload = array() ) {
		return $this->request( 'paymentOptionsInquiry', 'POST', $payload );
	}


	/**
	 * Create session.
	 *
	 * @param array $payload Payload.
	 */
	public function create_session( $payload = array() ) {
		return $this->request( 'session', 'POST', $payload );
	}


	/**
	 * Update session.
	 *
	 * @param string $session_id Session ID.
	 * @param array  $payload    Payload.
	 */
	public function update_session( $session_id, $payload = array() ) {
		return $this->request( 'session/' . $session_id, 'PUT', $payload );
	}


	/**
	 * Retrieve session.
	 *
	 * @param string $session_id Session ID.
	 *
	 * @return array
	 */
	public function retrieve_session( $session_id ) {
		return $this->request( 'session/' . $session_id, 'GET' );
	}


	/**
	 * Create payment transaction.
	 *
	 * @param string $order_id       Order ID.
	 * @param string $transaction_id Transaction ID.
	 * @param array  $payload        Payload.
	 *
	 * @return array
	 */
	public function create_transaction( $order_id, $transaction_id, $payload = array() ) {
		return $this->request( 'order/' . $order_id . '/transaction/' . $transaction_id, 'PUT', $payload );
	}


	/**
	 * Retrieve transaction.
	 *
	 * @param string $order_id       Order ID.
	 * @param string $transaction_id Transaction ID.
	 */
	public function retrieve_transaction( $order_id, $transaction_id ) {
		return $this->request( 'order/' . $order_id . '/transaction/' . $transaction_id, 'GET' );
	}


	/**
	 * Retrieve order.
	 *
	 * @param string $order_id Order ID.
	 */
	public function retrieve_order( $order_id ) {
		return $this->request( 'order/' . $order_id, 'GET' );
	}


	/**
	 * Create payment token.
	 *
	 * @param array $payload Payload.
	 */
	public function create_token( $payload = array() ) {
		return $this->request( 'token', 'POST', $payload );
	}


	/**
	 * Initialize authentication.
	 *
	 * @param string $order_id       Order ID.
	 * @param string $transaction_id Transaction ID.
	 * @param array  $payload        Payload.
	 */
	public function init_authentication( $order_id, $transaction_id, $payload = array() ) {
		return $this->request( 'order/' . $order_id . '/transaction/' . $transaction_id, 'PUT', $payload );
	}


	/**
	 * Authenticate payer.
	 *
	 * @param string $order_id       Order ID.
	 * @param string $transaction_id Transaction ID.
	 * @param array  $payload        Payload.
	 */
	public function authenticate_payer( $order_id, $transaction_id, $payload = array() ) {
		return $this->request( 'order/' . $order_id . '/transaction/' . $transaction_id, 'PUT', $payload );
	}


	/**
	 * Capture payment.
	 *
	 * @param string $order_id       Order ID.
	 * @param string $transaction_id Transaction ID.
	 * @param array  $payload        Payload.
	 */
	public function capture_payment( $order_id, $transaction_id, $payload = array() ) {
		return $this->request( 'order/' . $order_id . '/transaction/' . $transaction_id, 'PUT', $payload );
	}
}
