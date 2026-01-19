const Settings = {
	init() {
		const prefix = core_gateway_admin_params?.pluginPrefix;

		jQuery( '.conditional-hide' ).each( function () {
			const $el = jQuery( this );
			const $relElement = jQuery(
				`#woocommerce_${ prefix }_${ $el.data( 'show-rel' ) }`
			);

			if ( $relElement.length ) {
				Settings.maybeShowHide( $el, $relElement );
				$relElement.on( 'change', function () {
					Settings.maybeShowHide( $el, $relElement );
				} );
			}
		} );
	},

	maybeShowHide( $el, $relElement ) {
		const $row = $el.closest( 'tr' );
		if ( $relElement.attr( 'type' ) === 'checkbox' ) {
			const value = $el.data( 'show-if' );
			let expected;
			if ( typeof value !== 'undefined' ) {
				if ( value === 'yes' || value === '1' || value === true ) {
					expected = true;
				} else {
					expected = false;
				}
			} else {
				expected = true;
			}
			if ( $relElement.is( ':checked' ) === expected ) {
				$row.show();
			} else {
				$row.hide();
			}
		} else if ( $relElement.val() === $el.data( 'show-if' ) ) {
			$row.show();
		} else {
			$row.hide();
		}
	},
};

export default Settings;
