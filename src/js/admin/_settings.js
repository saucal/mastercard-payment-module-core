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

		jQuery( 'input[type="checkbox"][data-region-urls]' ).each( function () {
			const $el = jQuery( this );

			const $regionsElement = jQuery( `#woocommerce_${ prefix }_region` );

			function refreshRegions() {
				const regionUrls = $el.data( 'region-urls' );
				const regionIs = $el.data( 'region-is' );

				let targetRegion;
				if ( $el.is( ':checked' ) ) {
					targetRegion = regionIs;
				} else if ( $regionsElement.length ) {
					targetRegion = $regionsElement.val();
				} else {
					targetRegion = Object.keys( regionUrls ).filter(
						( key ) => key !== regionIs
					)[ 0 ];
				}

				const otherRegions = Object.keys( regionUrls ).filter(
					( key ) => key !== targetRegion
				);

				const targetContainer = $el.closest( 'form' );
				for ( let i = 0; i < otherRegions.length; i++ ) {
					const region = otherRegions[ i ];
					const oldDomain = regionUrls[ region ];
					const links = targetContainer.find(
						`a[href^="${ regionUrls[ region ] }"]`
					);

					links.prop( 'href', function () {
						return this.href.replace(
							oldDomain,
							regionUrls[ targetRegion ]
						);
					} );
				}
			}

			$el.on( 'change', refreshRegions );
			$regionsElement.on( 'change', refreshRegions );
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
