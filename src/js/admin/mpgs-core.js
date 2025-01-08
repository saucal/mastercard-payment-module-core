/**
 * External dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import Settings from './_settings';

( function ( $ ) {
	'use strict';

	Settings.init();

	const prefix = mpgs_gateway_admin_params?.prefix;

	if ( ! prefix ) {
		$( '.mpgs-void-form' ).hide();
		return;
	}

	$( `#${ prefix }_void_transaction_button` ).on( 'click', function ( e ) {
		e.preventDefault();

		if (
			! confirm(
				__(
					'Are you sure that you want to cancel the Payment Authorization?',
					mpgs_gateway_admin_params?.textDomain
				)
			)
		) {
			return;
		}

		const $button = $( this );
		$( `input[name="${ prefix }_void_transaction"]` ).val( '1' );
		$( `input[name="${ prefix }_capture_payment"]` ).val( '0' );

		$button.closest( 'form' ).submit();
	} );
} )( jQuery );
