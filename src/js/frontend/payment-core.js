/**
 * Internal dependencies
 */
import hostedCheckout from './_hostedCheckout';
import hostedSessions from './_hostedSessions';

( function () {
	'use strict';

	if (
		! core_gateway_params ||
		! core_gateway_params.prefix ||
		! core_gateway_params.checkoutMode
	) {
		return false;
	}

	switch ( core_gateway_params.checkoutMode ) {
		case 'hosted_checkout':
			hostedCheckout.init();
			break;
		case 'hosted_session':
			hostedSessions.init();
			break;
	}
} )( jQuery );
