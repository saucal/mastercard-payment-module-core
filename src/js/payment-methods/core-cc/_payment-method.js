/**
 * External dependencies
 */
const { useEffect } = window.wp.element;
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { CardElements } from './_elements';
import {
	settings,
	isHostedSession,
	isHostedCheckout,
	isRedirectToPaymentPage,
} from './_settings';
import { Content } from '../_utils';
import { hostedSessionHandler } from './_hosted-session-handler';
import { hostedCheckoutHandler } from './_hosted-checkout-handler';

/**
 * Returns a react component and also sets an observer for the onPaymentSetup event.
 *
 * @param {Object} props
 * @return React component
 */
const PaymentCoreCC = ( {
	activePaymentMethod,
	eventRegistration,
	emitResponse,
} ) => {
	const { onPaymentSetup, onCheckoutSuccess, onCheckoutFail } =
		eventRegistration;

	useEffect(
		() => {
			if ( isHostedSession() ) {
				return hostedSessionHandler(
					onPaymentSetup,
					onCheckoutSuccess,
					onCheckoutFail,
					emitResponse.responseTypes.SUCCESS,
					emitResponse.responseTypes.ERROR
				);
			}

			if ( isHostedCheckout() && isRedirectToPaymentPage() ) {
				return hostedCheckoutHandler( emitResponse, onCheckoutSuccess );
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[
			activePaymentMethod,
			onPaymentSetup,
			onCheckoutSuccess,
			onCheckoutFail,
			emitResponse.responseTypes.SUCCESS,
			emitResponse.responseTypes.ERROR,
		]
	);

	return <>{ isHostedSession() && <CardElements /> }</>;
};

/**
 * Returns the Components that will be used by the plugin.
 *
 * @param {Object} props
 * @return React Component
 */
export const PaymentCoreContent = ( props ) => {
	return (
		<React.Fragment>
			<Content description={ settings?.description } />
			<PaymentCoreCC { ...props } />
		</React.Fragment>
	);
};

/**
 * Returns the Components that will be used by the plugin in edit mode.
 *
 * @return React Component
 */
export const PaymentCoreEditContent = () => {
	return (
		<React.Fragment>
			<Content description={ settings?.description } />
		</React.Fragment>
	);
};
