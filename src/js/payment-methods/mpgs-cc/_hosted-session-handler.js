/**
 * Internal dependencies
 */
import hostedSessions from '../../frontend/_hostedSessions';
import { addPrefix, getTextDomain } from './_settings';

export const hostedSessionHandler = (
	onPaymentSetup,
	onCheckoutSuccess,
	onCheckoutFail,
	emitResponseSuccess,
	emitResponseError
) => {
	hostedSessions.init();
	const unsuscribePaymentSetup = onPaymentSetup( () => {
		return new Promise( ( resolve ) => {
			hostedSessions.triggerPay();
			jQuery( document.body ).on(
				'submit_payment',
				hostedSessions.$wcForm,
				() => {
					const data = {};

					const sessionId = hostedSessions.getSessionId();
					const sessionVersion = hostedSessions.getSessionVersion();

					if ( ! sessionId || ! sessionVersion ) {
						resolve( {
							type: emitResponseError,
							meta: {
								error: {
									message: __(
										'There was an error obtaining the payment session. Please try again.',
										getTextDomain()
									),
								},
							},
						} );
					}

					data[ addPrefix( 'session_id' ) ] = sessionId;
					data[ addPrefix( 'session_version' ) ] = sessionVersion;
					data[ addPrefix( '3ds_data' ) ] =
						hostedSessions.get3DSData();

					resolve( {
						type: emitResponseSuccess,
						meta: {
							paymentMethodData: data,
						},
					} );
				}
			);
			jQuery( document.body ).on(
				'checkout_error',
				hostedSessions.$wcForm,
				( event, errorMessage ) => {
					resolve( {
						type: emitResponseError,
						meta: {
							error: {
								message:
									errorMessage ||
									__(
										'There was an error obtaining the payment session. Please try again.',
										getTextDomain()
									),
							},
						},
					} );
				}
			);
		} );
	} );

	const unsuscribeCheckoutSuccess = onCheckoutSuccess(
		( { processingResponse } ) => {
			if (
				! processingResponse?.paymentDetails ||
				! processingResponse.paymentDetails[ addPrefix( '3ds' ) ]
			) {
				return;
			}

			if (
				! hostedSessions.process3DsAuthentication(
					new Event( 'Redirect' ),
					processingResponse.paymentDetails
				)
			) {
				return new Promise( ( resolve ) => {
					resolve( {
						type: emitResponseError,
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

	const unsuscribeCheckoutFail = onCheckoutFail(
		async ( { processingResponse } ) => {
			if ( ! processingResponse?.paymentDetails?.errorMessage ) {
				return true;
			}

			processingResponse.message =
				processingResponse.paymentDetails.errorMessage;

			return true;
		}
	);

	return () => {
		unsuscribePaymentSetup();
		unsuscribeCheckoutSuccess();
		unsuscribeCheckoutFail();
	};
};
