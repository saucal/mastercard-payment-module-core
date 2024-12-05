/**
 * Internal dependencies
 */
import hostedCheckout from './_hostedCheckout';
import hostedSessions from './_hostedSessions';

( function () {
	'use strict';

	if (
		! mpgs_gateway_params ||
		! mpgs_gateway_params.prefix ||
		! mpgs_gateway_params.checkoutMode
	) {
		return false;
	}

	switch ( mpgs_gateway_params.checkoutMode ) {
		case 'hosted_checkout':
			hostedCheckout.init();
			break;
		case 'hosted_session':
			hostedSessions.init();
			break;
	}
} )( jQuery );
