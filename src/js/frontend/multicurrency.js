(function( $ ) {
	'use strict';

	// Multicurrency form submit
	$( '.mastercard-multicurrency' ).on(
		'change', 'select.mastercard_currency_selector', function() {
			var $supports_html5_storage = true;

			try {
				$supports_html5_storage = ( 'sessionStorage' in window && window.sessionStorage !== null );
				window.sessionStorage.setItem( 'bs', 'test' );
				window.sessionStorage.removeItem( 'bs' );
				window.localStorage.setItem( 'bs', 'test' );
				window.localStorage.removeItem( 'bs' );
			} catch( err ) {
				$supports_html5_storage = false;
			}

			// Clear fragments on session storage to trigger a cart refresh *before* its actually shown on the new page load with the wrong currency.
			if ( $supports_html5_storage && 'undefined' !== typeof( wc_cart_fragments_params ) ) {
				sessionStorage.setItem( wc_cart_fragments_params.fragment_name, '' );
			}
			
			$( this ).closest( 'form' ).submit();
		}
	);

	/**
	 * In case there is cache on the site, and backend hooks are not represented on frontend, we have to handle the currency changes on frontend level.
	 * @type {{cookie_name: *, init: init, get_cookie: (function(*): any), get_shown_currency_price: (function(): *), adjust_frontend: adjust_frontend}}
	 */
	var cookie_handler = {
		cookie_name: woocommerce_mastercard_multicurrency_params.cookie_name,
		init: function() {
			var currency_cookie = this.get_cookie( this.cookie_name );
			var currency_shown  = this.get_shown_currency_price();
			if ( currency_cookie && currency_cookie != currency_shown ) {
				this.adjust_frontend( currency_cookie );
			}
		},
		get_cookie: function(name) {
			var v = document.cookie.match( '(^|;) ?' + name + '=([^;]*)(;|$)' );
			return v ? v[2] : null;
		},
		/**
		 * Get the first price shown, and takes it currency.
		 * @returns {string}
		 */
		get_shown_currency_price: function() {
			var first_price = $( '.currency-show' ).first();
			return $( first_price ).attr( 'currency' );
		},
		/**
		 * Adjust all frontend according to the real cookie value.
		 * @param currency
		 */
		adjust_frontend: function( currency ) {
			$( '.mastercard-multicurrency-html' ).each(
				function(){
					if ( $( this ).attr( 'currency' ) == currency ) {
						$( this ).removeClass( 'currency-hide' ).addClass( 'currency-show' );
					} else {
						$( this ).removeClass( 'currency-show' ).addClass( 'currency-hide' );
					}
				}
			);
			$( ".mastercard_currency_selector" ).val( currency );
		}
	};
	cookie_handler.init();

})( jQuery );
