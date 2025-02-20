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
	activePaymentMethod,
	token,
	emitResponse,
	eventRegistration: { onPaymentSetup },
} ) => {
	useEffect( () => {
		return onPaymentSetup( () => {
			return new Promise( ( resolve ) => {
				const data = {};
				data[ addPrefix( 'session_id' ) ] = getSessionId();
				data[ `wc-${ getPrefix() }-payment-token` ] = token;
				data[ addPrefix( '3ds_data' ) ] = hostedSessions.get3DSData();

				resolve( {
					type: emitResponse.responseTypes.SUCCESS,
					meta: {
						paymentMethodData: data,
					},
				} );
			} );
		} );
	}, [
		activePaymentMethod,
		emitResponse.responseTypes.SUCCESS,
		onPaymentSetup,
		token,
	] );

	return <></>;
};
