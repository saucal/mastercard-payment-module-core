/**
 * External dependencies.
 */
const { useEffect } = window.wp.element;

/**
 * Internal dependencies.
 */

export const SavedTokenHandler = ( {
	activePaymentMethod,
	token,
	eventRegistration: { onPaymentSetup },
} ) => {
	useEffect( () => {
		return onPaymentSetup( () => {
			console.log( 'on payment setup' );
		} );
	}, [ activePaymentMethod, onPaymentSetup, token ] );

	return <></>;
};
