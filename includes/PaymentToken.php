<?php
/**
 * Define the logic for the payment tokens.
 *
 * @class       PaymentToken
 * @version     1.0.0
 * @package     MPGSCore/Classes/
 */

namespace MPGSCore;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

use MPGSCore\Gateways\WC_Abstract_MPGS_Payment_Gateway;
use WC_Payment_Token_CC;
use Exception;

/**
 * Class PaymentToken
 */
class PaymentToken {

	/**
	 * MPGS Plugin instance.
	 *
	 * @var WC_Abstract_MPGS_Payment_Gateway
	 */
	private $gateway;

	/**
	 * Constructor.
	 *
	 * @param WC_Abstract_MPGS_Payment_Gateway $gateway Gateway instance.
	 */
	public function __construct( $gateway ) {
		$this->gateway = $gateway;
	}


	/**
	 * This function processes the saved cards for a given session and user ID.
	 *
	 * @param string $session_id The session ID.
	 * @param int    $user_id    The user ID.
	 *
	 * @return bool
	 */
	public function process_saved_cards( $session_id, $user_id ) {
		try {

			if ( ! $this->gateway ) {
				throw new Exception( 'The gateway object is invalid', $this->gateway->mpgs_plugin()->text_domain() );
			}

			$response = $this->gateway->mpgs_api()->create_token(
				array(
					'session'       => array(
						'id' => $session_id,
					),
					'sourceOfFunds' => array(
						'type' => 'CARD',
					),
				)
			);

			if ( empty( $response['body']['token'] ) || empty( $response['body']['sourceOfFunds']['provided']['card'] ) ) {
				throw new Exception( 'Token not present in reponse' );
			}

			$token = new WC_Payment_Token_CC();
			$token->set_token( $response['body']['token'] );
			$token->set_gateway_id( $this->gateway->id );
			$token->set_card_type( $response['body']['sourceOfFunds']['provided']['card']['brand'] );

			$last4 = substr(
				$response['body']['sourceOfFunds']['provided']['card']['number'],
				- 4
			);
			$token->set_last4( $last4 );

            $m = array(); // phpcs:ignore
			preg_match( '/^(\d{2})(\d{2})$/', $response['body']['sourceOfFunds']['provided']['card']['expiry'], $m );

			$token->set_expiry_month( $m[1] );
			$token->set_expiry_year( '20' . $m[2] );
			$token->set_user_id( $user_id );
			$token->save();

			return true;
		} catch ( Exception $e ) {
			$this->gateway->mpgs_plugin()->logger()->log( 'Error processing saved cards: ' . $e->getMessage(), 'error' );
			return false;
		}
	}


	/**
	 * Get payment token from the ID.
	 *
	 * @param int $token_id The token ID.
	 *
	 * @return WC_Payment_Token_CC|null
	 */
	public function get_payment_token( $token_id ) {
		$tokens = $this->gateway->get_tokens();

		return isset( $tokens[ $token_id ] ) ? $tokens[ $token_id ] : null;
	}
}
