const hostedCheckout = {
	pluginPrefix: null,
	isEmbedded: false,

	init() {
		if ( ! core_gateway_params || ! core_gateway_params.pluginPrefix ) {
			return;
		}
		hostedCheckout.pluginPrefix = core_gateway_params.pluginPrefix;

		const $hostedCheckoutContainer = jQuery(
			`#${ this.pluginPrefix }-hosted-checkout-container`
		);

		if ( ! $hostedCheckoutContainer ) {
			return;
		}

		if ( ! window.Checkout ) {
			this.reInit();
			return;
		}

		this.cleanSessions();

		// These functions will be referenced by the hosted checkout page, and are signaled via data-attributes on the script tag that loads the hosted checkout JS.
		window[ `${ core_gateway_params.pluginPrefix }ErrorCallback` ] =
			function ( error ) {
				document.dispatchEvent(
					new CustomEvent(
						`${ core_gateway_params.pluginPrefix }_error_callback`,
						{
							detail: error,
						}
					)
				);
			};

		window[ `${ core_gateway_params.pluginPrefix }CancelCallback` ] =
			function () {
				document.dispatchEvent(
					new CustomEvent(
						`${ core_gateway_params.pluginPrefix }_cancel_callback`
					)
				);
			};

		this.isEmbedded =
			$hostedCheckoutContainer.hasClass( 'embedded-checkout' );

		const sessionId = $hostedCheckoutContainer.data( 'session-id' );

		if ( sessionId ) {
			Checkout.configure( {
				session: {
					id: sessionId,
				},
			} );

			if ( this.isEmbedded ) {
				this.initEmbeddedCheckout();
			} else {
				this.initRedirectCheckoutPayForOrder();
			}
		} else if ( ! sessionId && ! this.isEmbedded ) {
			this.initRedirectCheckout();
		}

		this.initErrorCallbacks();
	},

	reInit() {
		setTimeout( () => {
			hostedCheckout.init();
		}, 200 );
	},

	cleanSessions() {
		if ( typeof sessionStorage !== 'undefined' ) {
			sessionStorage.removeItem( 'HostedCheckout_embedContainer' );
			sessionStorage.removeItem( 'HostedCheckout_merchantState' );
			sessionStorage.removeItem( 'HostedCheckout_sessionId' );
		}
	},

	initErrorCallbacks() {
		jQuery( document ).on(
			`${ core_gateway_params.pluginPrefix }_error_callback`,
			this.handleError
		);
		jQuery( document ).on(
			`${ core_gateway_params.pluginPrefix }_cancel_callback`,
			this.handleCancel
		);
	},

	initEmbeddedCheckout() {
		this.showEmbeddedPage();

		jQuery( document.body ).on( 'updated_checkout', () => {
			this.showEmbeddedPage();
		} );

		hostedCheckout.maybeHideOrDisplayPlaceOrder();
	},

	showEmbeddedPage() {
		if ( ! this.isEmbedded ) {
			return;
		}
		Checkout.showEmbeddedPage(
			`#${ this.pluginPrefix }-hosted-checkout-container`
		);
	},

	maybeHideOrDisplayPlaceOrder() {
		const $placeOrderButton = jQuery( '#place_order' );

		if ( $placeOrderButton.length === 0 ) {
			return;
		}

		if (
			jQuery( '#payment_method_' + this.pluginPrefix ).is( ':checked' )
		) {
			$placeOrderButton.hide();
			$placeOrderButton.closest( '.form-row' ).hide();
		}

		jQuery( document.body ).on(
			'change',
			'input[name="payment_method"]',
			() => {
				if (
					jQuery( '#payment_method_' + this.pluginPrefix ).is(
						':checked'
					)
				) {
					$placeOrderButton.hide();
					$placeOrderButton.closest( '.form-row' ).hide();
					hostedCheckout.showEmbeddedPage();
				} else {
					$placeOrderButton.show();
					$placeOrderButton.closest( '.form-row' ).show();
				}
			}
		);
	},

	initRedirectCheckout() {
		jQuery( 'form.checkout' ).on(
			'checkout_place_order_success',
			hostedCheckout.processRedirectToPaymentPage
		);
	},

	async processRedirectToPaymentPage( event, result ) {
		if (
			typeof result.pluginId !== 'undefined' &&
			hostedCheckout.pluginPrefix === result.pluginId &&
			typeof result.sessionId !== 'undefined'
		) {
			await Checkout.configure( {
				session: {
					id: result.sessionId,
				},
			} );
			await hostedCheckout.redirectToPaymentPage( event );
			return true;
		}
		return true;
	},

	initRedirectCheckoutPayForOrder() {
		jQuery( 'form#add_payment_method' ).on(
			'submit',
			hostedCheckout.redirectToPaymentPage
		);
		jQuery( 'form#order_review' ).on(
			'submit',
			hostedCheckout.redirectToPaymentPage
		);
	},

	redirectToPaymentPage( event ) {
		event.preventDefault();
		Checkout.showPaymentPage();
	},

	handleError( error ) {
		const $errorWrapper = jQuery( '.woocommerce-notices-wrapper' );
		if ( $errorWrapper.length > 0 ) {
			$errorWrapper.html( error.responseText );
		}
	},

	handleCancel( error ) {
		console.error( error );
		if ( ! core_gateway_params.orderCancelUrl ) {
			return;
		}

		window.location.href = core_gateway_params.orderCancelUrl;
	},
};

export default hostedCheckout;
