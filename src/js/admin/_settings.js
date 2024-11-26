const Settings = {
    init: function () {
        const prefix = mpgs_admin_params?.prefix;
        
        jQuery('.conditional-hide').each( function () {
            const $el = jQuery( this );
            const $relElement = jQuery( `#woocommerce_${prefix}_${$el.data( 'show-rel' )}` );

            if ( $relElement.length ) {
                Settings.maybeShowHide( $el, $relElement );
                $relElement.on( 'change', function () {
                    Settings.maybeShowHide( $el, $relElement );
                });
            }
        });
    },

    maybeShowHide: function ( $el, $relElement ) {
        const $row = $el.closest( 'tr' );
        if ( $relElement.attr('type') === 'checkbox' ) {
            if ( $relElement.is( ':checked' ) ) {
                $row.show();
            } else {
                $row.hide();
            }
        } else {
            if ( $relElement.val() === $el.data( 'show-if' ) ) {
                $row.show();
            } else {
                $row.hide();
            }
        }
    }
}

export default Settings;