/**
 * External dependencies
 */
import { __ } from '@wordpress/i18n';
import { decodeEntities } from '@wordpress/html-entities';
const { registerPaymentMethod } = wc.wcBlocksRegistry;

/**
 * Internal dependencies
 */
import { PAYMENT_METHOD_NAME } from './_constants';
import { PaymentCoreComponent, Label, canMakePayment } from '../_utils';
import { getTextDomain, settings } from './_settings';
import { PaymentCoreContent, PaymentCoreEditContent } from './_payment-method';
import { SavedTokenHandler } from './_saved-token-handler';

const label =
	decodeEntities( settings.title ) ||
	__( 'Credit/Debit Card', getTextDomain() );

const supportsTokenization =
	Array.isArray( settings?.supports ) &&
	settings.supports.includes( 'tokenization' );

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
		showSaveOption: supportsTokenization,
		features: settings?.supports ?? [],
	},
};

// Register the CC gateway.
registerPaymentMethod( paymentMethod );
