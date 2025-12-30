/**
 * External dependencies
 */
const { useEffect } = window.wp.element;

/**
 * Internal dependencies
 */
import { addPrefix, getPrefix, getSessionId } from './_settings';
import hostedSessions from '../../frontend/_hostedSessions';

export const SavedTokenHandler = ( {
	token,
	emitResponse,
	eventRegistration: { onPaymentSetup },
} ) => {
	useEffect( () => {
		hostedSessions.pluginPrefix = getPrefix();
		hostedSessions.dcc.requestCurrencyConversionQuoteSavedToken( token );

		return onPaymentSetup( () => {
			return new Promise( ( resolve ) => {
				const data = {};
				data[ addPrefix( 'session_id' ) ] = getSessionId();
				data[ `wc-${ getPrefix() }-payment-token` ] = token;
				data[ addPrefix( '3ds_data' ) ] = hostedSessions.get3DSData();

				resolve( {
					type: emitResponse.responseTypes.SUCCESS,
					meta: {
						paymentMethodData: {
							...data,
							...hostedSessions.dcc.getCurrencyConversionData(),
						},
					},
				} );
			} );
		} );
	}, [
		emitResponse.responseTypes.SUCCESS,
		onPaymentSetup,
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
