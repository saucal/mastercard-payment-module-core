/**
 * External dependencies
 */
const { useEffect } = window.wp.element;

/**
 * Internal dependencies
 */
import { addPrefix, getPrefix } from './_settings';
import { hostedSessionHandler } from './_hosted-session-handler';

export const SavedTokenHandler = ( {
	token,
	emitResponse: {
		responseTypes: {
			SUCCESS: emitResponseSuccess,
			ERROR: emitResponseError,
		},
	},
	eventRegistration: { onPaymentSetup, onCheckoutSuccess, onCheckoutFail },
} ) => {
	useEffect( () => {
		return hostedSessionHandler(
			onPaymentSetup,
			onCheckoutSuccess,
			onCheckoutFail,
			emitResponseSuccess,
			emitResponseError
		);
	}, [
		onPaymentSetup,
		onCheckoutSuccess,
		onCheckoutFail,
		emitResponseSuccess,
		emitResponseError,
		token,
	] );

	return (
		<>
			<input
				type="hidden"
				id={ addPrefix( 'dcc_request_id' ) }
				name={ addPrefix( 'dcc_request_id' ) }
			/>
			<div
				id={ `${ getPrefix() }_currency_conversion` }
				className="payment-core-currency-conversion"
			/>
		</>
	);
};
