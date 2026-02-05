/**
 * External dependencies
 */
import { __ } from '@wordpress/i18n';
import { decodeEntities } from '@wordpress/html-entities';
const { registerPaymentMethod } = wc.wcBlocksRegistry;
import { registerPlugin } from '@wordpress/plugins';
import { useEffect } from '@wordpress/element';
import { useDispatch } from '@wordpress/data';

/**
 * Internal dependencies
 */
import { PAYMENT_METHOD_NAME } from './_constants';
import { PaymentCoreComponent, Label, canMakePayment } from '../_utils';
import {
	getTextDomain,
	settings,
	getPaymentErrorMessage,
	getPrefix,
} from './_settings';
import { PaymentCoreContent, PaymentCoreEditContent } from './_payment-method';
import { SavedTokenHandler } from './_saved-token-handler';

const label =
	decodeEntities( settings.title ) ||
	__( 'Credit/Debit Card', getTextDomain() );

const supportsTokenization =
	Array.isArray( settings?.supports ) &&
	settings.supports.includes( 'tokenization' );

const displaySaveCardCheckbox =
	settings?.displaySaveCardCheckbox ?? supportsTokenization;

const paymentMethod = {
	name: PAYMENT_METHOD_NAME,
	label: <Label label={ label } />,
	content: <PaymentCoreComponent RenderedComponent={ PaymentCoreContent } />,
	edit: <PaymentCoreComponent RenderedComponent={ PaymentCoreEditContent } />,
	canMakePayment: ( props ) => {
		return canMakePayment( props, settings );
	},
	savedTokenComponent: (
		<PaymentCoreComponent
			RenderedComponent={ SavedTokenHandler }
			settings={ settings }
		/>
	),
	ariaLabel: __( 'CC Payment method', getTextDomain() ),
	supports: {
		showSavedCards: supportsTokenization,
		showSaveOption: displaySaveCardCheckbox,
		features: settings?.supports ?? [],
	},
};

// Register the CC gateway.
registerPaymentMethod( paymentMethod );

const message = getPaymentErrorMessage();

console.log( message );

const PaymentAreaNotice = () => {
	const { createNotice } = useDispatch( 'core/notices' );

	useEffect( () => {
		createNotice( 'error', message, {
			context: 'wc/checkout/payments',
			isDismissible: true,
			id: getPrefix() + '-payment-notice',
		} );

		// Cleanup: remove notice on unmount
		return () => {
			const { removeNotice } = wp.data.dispatch( 'core/notices' );
			removeNotice(
				getPrefix() + '-payment-notice',
				'wc/checkout/payments'
			);
		};
	}, [ createNotice ] );

	return null; // This component only triggers the notice, renders nothing
};

if ( message ) {
	registerPlugin( getPrefix() + '-payment-notice', {
		render: PaymentAreaNotice,
		scope: 'woocommerce-checkout',
	} );
}
