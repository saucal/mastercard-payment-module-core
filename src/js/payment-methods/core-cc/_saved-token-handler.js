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
	eventRegistration: {
		onPaymentSetup,
		onCheckoutSuccess,
		onCheckoutFail,
		onCheckoutValidation,
	},
} ) => {
	useEffect( () => {
		return hostedSessionHandler(
			onPaymentSetup,
			onCheckoutSuccess,
			onCheckoutFail,
			onCheckoutValidation,
			emitResponseSuccess,
			emitResponseError
		);
	}, [
		onPaymentSetup,
		onCheckoutSuccess,
		onCheckoutFail,
		onCheckoutValidation,
		emitResponseSuccess,
		emitResponseError,
		token,
	] );

	return <></>;
};
