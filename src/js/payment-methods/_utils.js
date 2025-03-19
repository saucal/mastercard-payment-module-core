/**
 * External dependencies
 */
import { decodeEntities } from '@wordpress/html-entities';

/**
 * Returns the backend provided settings based on the name param.
 *
 * @param {string} name The settings to access.
 * @return {Object}|{null}
 */
export const getBlocksConfiguration = ( name ) => {
	const serverData = wc.wcSettings.getSetting( name, null );

	if ( ! serverData ) {
		throw new Error( 'Initialization data is not available' );
	}

	return serverData;
};

/**
 * Label component
 *
 * @param {string} label The text label.
 * @param {Object} props Props from payment API.
 * @return React Component
 */
export const Label = ( { label, ...props } ) => {
	const { PaymentMethodLabel } = props.components;
	return <PaymentMethodLabel text={ label } />;
};

/**
 * Returns a React Component.
 *
 * @param {Object} param0 RenderedComponent and props
 * @return {RenderedComponent}
 */
export const PaymentCoreComponent = ( { RenderedComponent, ...props } ) => {
	return <RenderedComponent { ...props } />;
};

/**
 * Returns the payment method's description.
 *
 * @return {string}
 */
export const Content = ( { description, ...props } ) => {
	return decodeEntities( description );
};

/**
 * Manages the FE's availability of the Gateway.
 *
 * @param {Object} props    All the props being fed to the canMakePayment callback of the Gateways.
 * @param {Object} settings The gateways settings.
 * @return {bool}
 */
export const canMakePayment = ( { cartTotals }, { allowedCurrencies } ) => {
	return allowedCurrencies && allowedCurrencies.length > 0
		? allowedCurrencies.includes( cartTotals.currency_code )
		: true;
};

/**
 * Handle errors.
 */
export const onError = ( tagId, errorCode, errorDescription ) => {
	return {
		errorCode,
		tagId,
		message: errorDescription,
	};
};
