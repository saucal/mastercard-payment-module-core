/**
 * Internal dependencies
 */
import hostedCheckout from '../../frontend/_hostedCheckout';
import { getTextDomain } from './_settings';

export const hostedCheckoutHandler = ( emitResponse, onCheckoutSuccess ) => {
	const unsuscribeCheckoutSuccess = onCheckoutSuccess(
		( { processingResponse } ) => {
			hostedCheckout.init();
			const sessionId = processingResponse?.paymentDetails?.sessionId;
			if ( ! sessionId ) {
				return new Promise( ( resolve ) => {
					resolve( {
						type: emitResponse.responseTypes.ERROR,
						meta: {
							error: {
								message: __(
									'There was an error obtaining the payment session. Please try again.',
									getTextDomain()
								),
							},
						},
					} );
				} );
			}
			if (
				! hostedCheckout.processRedirectToPaymentPage(
					new Event( 'Redirect' ),
					processingResponse.paymentDetails
				)
			) {
				return new Promise( ( resolve ) => {
					resolve( {
						type: emitResponse.responseTypes.ERROR,
						meta: {
							error: {
								message: __(
									'There was an error redirecting to the payment page. Please try again.',
									getTextDomain()
								),
							},
						},
					} );
				} );
			}
		}
	);

	return () => {
		unsuscribeCheckoutSuccess();
	};
};
