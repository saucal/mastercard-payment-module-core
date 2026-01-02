/**
 * External dependencies
 */
import { __ } from '@wordpress/i18n';
import { select } from '@wordpress/data';

/**
 * Internal dependencies
 */
import hostedSessions from '../../frontend/_hostedSessions';
import { addPrefix, getTextDomain, getSessionId } from './_settings';

export const hostedSessionHandler = (
	onPaymentSetup,
	onCheckoutSuccess,
	onCheckoutFail,
	onCheckoutValidation,
	emitResponseSuccess,
	emitResponseError
) => {
	hostedSessions.setSessionId( getSessionId() );
	hostedSessions.init();

	const paymentMethodData =
		select( 'wc/store/payment' ).getPaymentMethodData();

	// TODO: Implement validation per field, using onCheckoutValidation

	const unsuscribePaymentSetup = onPaymentSetup( () => {
		return new Promise( ( resolve ) => {
			const { validationStore } = window.wc?.wcBlocksData ?? {};
			if ( validationStore ) {
				const store = select( validationStore );
				const hasValidationErrors = store.hasValidationErrors();
				// Return if there is a validation error on the checkout fields.
				if ( hasValidationErrors ) {
					return;
				}
			}

			// Validation is done before @ onCheckoutValidation, so we can safely move fowrard
			hostedSessions
				.validatePay()
				.then( hostedSessions.triggerPay )
				.then( ( data ) => {
					resolve( {
						type: emitResponseSuccess,
						meta: {
							paymentMethodData: {
								...paymentMethodData,
								...data,
							},
						},
					} );
				} )
				.catch( ( errorMessage ) => {
					errorMessage = hostedSessions.stringifyErrors(
						errorMessage,
						'.\n'
					);
					resolve( {
						type: emitResponseError,
						message:
							errorMessage ||
							__(
								'There was an error processing the payment. Please try again.',
								getTextDomain()
							),
					} );
				} )
				.then( () => {
					// TODO: Unblock in hostedSessions?
					hostedSessions.unblockFieldset();
					hostedSessions.unblockForm();
				} );
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

			return new Promise( ( resolve ) => {
				hostedSessions
					.process3DsAuthenticationAsync(
						processingResponse.paymentDetails
					)
					.then( () => {
						resolve();
					} )
					.catch( () => {
						resolve( {
							type: emitResponseError,
							message: __(
								'There was an error redirecting to the payment page. Please try again.',
								getTextDomain()
							),
						} );
					} );
			} );
		}
	);

	const unsuscribeCheckoutFail = onCheckoutFail(
		async ( { processingResponse } ) => {
			if ( ! processingResponse?.paymentDetails?.errorMessage ) {
				return true;
			}

			return {
				type: emitResponseError,
				message: processingResponse.paymentDetails.errorMessage,
				messageContext: 'wc/checkout/payments',
			};
		}
	);

	return () => {
		unsuscribePaymentSetup();
		unsuscribeCheckoutSuccess();
		unsuscribeCheckoutFail();
	};
};
