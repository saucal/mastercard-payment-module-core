/**
 * External dependencies
 */
const { useEffect } = window.wp.element;
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { CardElements } from './_elements';
import { getTextDomain, settings, addPrefix } from './_settings';
import { Content } from '../_utils';
import hostedSessions from '../../frontend/_hostedSessions';

/**
 * Returns a react component and also sets an observer for the onPaymentSetup event.
 *
 * @param {Object} props
 * @return React component
 */
const MpgsCC = ( {
	activePaymentMethod,
	eventRegistration,
	billing,
	emitResponse,
} ) => {
	const { onPaymentSetup } = eventRegistration;

	useEffect( () => {
		hostedSessions.init();
		return onPaymentSetup( () => {
			return new Promise( ( resolve ) => {
				hostedSessions.triggerPay();
				jQuery( document.body ).on(
					'submit_payment',
					hostedSessions.$wcForm,
					() => {
						const data = {};

						const sessionId = hostedSessions.getSessionId();
						const sessionVersion =
							hostedSessions.getSessionVersion();

						if ( ! sessionId || ! sessionVersion ) {
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
						}

						data[ addPrefix( 'session_id' ) ] =
							hostedSessions.getSessionId();
						data[ addPrefix( 'session_version' ) ] =
							hostedSessions.getSessionVersion();

						resolve( {
							type: emitResponse.responseTypes.SUCCESS,
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
							type: emitResponse.responseTypes.ERROR,
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
	}, [
		activePaymentMethod,
		onPaymentSetup,
		billing.billingDatam,
		emitResponse.responseTypes.SUCCESS,
		emitResponse.responseTypes.ERROR,
	] );

	return (
		<>
			<CardElements />
		</>
	);
};

/**
 * Returns the Components that will be used by Bluesnap.
 *
 * @param {Object} props
 * @return React Component
 */
export const MpgsContent = ( props ) => {
	return (
		<React.Fragment>
			<Content description={ settings?.description } />
			<MpgsCC { ...props } />
		</React.Fragment>
	);
};
