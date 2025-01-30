/**
 * Internal dependencies
 */
import { debounce, getWcAjaxUrl, supportedLogos, getCardLogo } from './_utils';

const hostedSessions = {
	pluginPrefix: null,
	sessionId: null,
	sessionIdAttempt: null,
	$ccFieldset: null,
	$wcForm: null,

	init() {
		if ( ! mpgs_gateway_params || ! mpgs_gateway_params.prefix ) {
			return;
		}
		hostedSessions.pluginPrefix = mpgs_gateway_params.prefix;

		if ( ! window.PaymentSession ) {
			hostedSessions.reInit();
			return;
		}

		hostedSessions.initWcForm();
		hostedSessions.initElements();
		jQuery( document.body ).on(
			'updated_checkout',
			hostedSessions.initElements
		);

		if ( hostedSessions.sessionId ) {
			hostedSessions.unblockForm();
		}
	},

	reInit() {
		setTimeout( () => {
			hostedSessions.init();
		}, 200 );
	},

	initElements() {
		hostedSessions.sessionId = jQuery(
			`#${ mpgs_gateway_params.prefix }_session_id`
		).val();

		if ( ! hostedSessions.sessionId ) {
			return;
		}

		hostedSessions.sessionIdAttempt = jQuery(
			`#${ mpgs_gateway_params.prefix }_session_attempt`
		).val();

		if ( ! hostedSessions.sessionIdAttempt ) {
			hostedSessions.sessionIdAttempt = new Date().getTime();
		}

		hostedSessions.$ccFieldset = jQuery(
			`.${ hostedSessions.pluginPrefix }-payment-form`
		);

		if ( ! hostedSessions.$ccFieldset ) {
			return;
		}

		hostedSessions.initHostedSession();
	},

	initWcForm() {
		jQuery( document.body ).on(
			'checkout_error',
			hostedSessions.unblockForm
		);
		jQuery( document.body ).on(
			'update_checkout',
			hostedSessions.unblockForm
		);

		const $checkout_form = jQuery(
			'form.woocommerce-checkout, form.wc-block-checkout__form'
		);

		if ( $checkout_form.length ) {
			hostedSessions.$wcForm = $checkout_form;
			hostedSessions.$wcForm.on(
				'checkout_place_order',
				hostedSessions.submitPay
			);
			return;
		}

		const $order_review_form = jQuery( 'form#order_review' );
		if ( $order_review_form.length ) {
			hostedSessions.$wcForm = $order_review_form;
			hostedSessions.$wcForm.on( 'submit', hostedSessions.submitPay );
			return;
		}

		const $payment_form = jQuery( 'form#add_payment_method' );
		if ( $payment_form.length ) {
			hostedSessions.$wcForm = $payment_form;
			hostedSessions.$wcForm.on( 'submit', hostedSessions.submitPay );
		}
	},

	initHostedSession() {
		if ( ! hostedSessions.isWooBlocks() ) {
			jQuery( document.body ).off(
				'change',
				`input[name="payment_method"], input[name="radio-control-wc-payment-method-options"], input[name="wc-${ hostedSessions.pluginPrefix }-payment-token"]`,
				hostedSessions.initHostedSession
			);
			jQuery( document.body ).on(
				'change',
				`input[name="payment_method"], input[name="radio-control-wc-payment-method-options"], input[name="wc-${ hostedSessions.pluginPrefix }-payment-token"]`,
				hostedSessions.initHostedSession
			);
		}

		if (
			! hostedSessions.isPaymentMethodSelected() ||
			hostedSessions.isSavedToken()
		) {
			return;
		}

		hostedSessions.blockFieldset();
		try {
			PaymentSession.configure(
				{
					session: hostedSessions.sessionId,
					fields: hostedSessions.fields(),
					frameEmbeddingMitigation: [ 'javascript' ],
					callbacks: {
						initialized: hostedSessions.unblockFieldset,
						formSessionUpdate: hostedSessions.handlePaymentResponse,
					},
					interaction: {
						displayControl: {
							formatCard: 'EMBOSSED',
							invalidFieldCharacters: 'REJECT',
						},
					},
				},
				hostedSessions.paymentScope()
			);
		} catch ( error ) {
			hostedSessions.submitError(
				`${ mpgs_gateway_params.hostedSessionErrors.default }: ${ error }`
			);
		}

		PaymentSession.onBlur(
			[
				'card.number',
				'card.securityCode',
				'card.expiryYear',
				'card.expiryMonth',
			],
			function ( fieldSelector, role ) {
				hostedSessions.blockFieldset();
				PaymentSession.validate( 'card', function ( fieldResults ) {
					hostedSessions.validateCardField(
						fieldResults,
						fieldSelector,
						role
					);
				} );

				PaymentSession.onValidityChange(
					[
						'card.number',
						'card.securityCode',
						'card.expiryMonth',
						'card.expiryYear',
					],
					function ( selector, result ) {
						hostedSessions.maybeResetPaymentSession( result );
						hostedSessions.processValidatedField(
							selector,
							result
						);
					}
				);
			}
		);

		PaymentSession.onCardTypeChange( hostedSessions.processCardTypeChange );
	},

	fields() {
		return {
			card: {
				number: `#${ hostedSessions.pluginPrefix }-card-number-${ hostedSessions.sessionId }`,
				securityCode: `#${ hostedSessions.pluginPrefix }-card-cvc-${ hostedSessions.sessionId }`,
				expiryMonth: `#${ hostedSessions.pluginPrefix }-card-expiry-month-${ hostedSessions.sessionId }`,
				expiryYear: `#${ hostedSessions.pluginPrefix }-card-expiry-year-${ hostedSessions.sessionId }`,
			},
		};
	},

	validateCardField( fieldResults, fieldSelector, role ) {
		hostedSessions.maybeResetPaymentSession( fieldResults.card[ role ] );

		if (
			fieldResults.card[ role ].errorReason &&
			fieldResults.card[ role ].errorReason === 'AWAITING_SERVER_RESPONSE'
		) {
			PaymentSession.validate( 'card', function ( results ) {
				hostedSessions.validateCardField(
					results,
					fieldSelector,
					role
				);
			} );

			return;
		}

		hostedSessions.processValidatedField(
			fieldSelector,
			fieldResults.card[ role ]
		);
	},

	processValidatedField( fieldSelector, result ) {
		hostedSessions.unblockFieldset();

		if ( result.isValid ) {
			jQuery( fieldSelector )
				.closest(
					hostedSessions.isWooBlocks()
						? '.wc-block-components-text-input'
						: '.form-row'
				)
				.removeClass(
					'woocommerce-invalid woocommerce-validated has-error'
				)
				.addClass( 'woocommerce-validated' );
		} else {
			jQuery( fieldSelector )
				.closest(
					hostedSessions.isWooBlocks()
						? '.wc-block-components-text-input'
						: '.form-row'
				)
				.removeClass(
					'woocommerce-invalid woocommerce-validated has-error'
				)
				.addClass( 'woocommerce-invalid has-error' );
		}
	},

	submitPay( event ) {
		if (
			hostedSessions.$wcForm.hasClass( 'is-processing' ) ||
			hostedSessions.$wcForm.hasClass( 'is-processing-3ds' ) ||
			! hostedSessions.isPaymentMethodSelected() ||
			! hostedSessions.selectedField()
		) {
			return;
		}

		jQuery( `#${ hostedSessions.pluginPrefix }_3ds_data` ).val(
			hostedSessions.get3DSData()
		);

		// Handle 3DS redirect if needed.
		hostedSessions.$wcForm.on(
			'checkout_place_order_success',
			hostedSessions.process3DsAuthentication
		);

		if ( hostedSessions.isSavedToken() ) {
			return;
		}

		event.preventDefault();

		hostedSessions.$wcForm.addClass( 'is-processing' );
		hostedSessions.blockForm();
		hostedSessions.triggerPay();

		return false;
	},

	triggerPay() {
		try {
			PaymentSession.updateSessionFromForm(
				'card',
				undefined,
				hostedSessions.paymentScope()
			);
		} catch ( error ) {
			hostedSessions.submitError(
				`${ mpgs_gateway_params.hostedSessionErrors.default }: ${ error }`
			);
			hostedSessions.unblockForm();
		}
	},

	handlePaymentResponse( response ) {
		let error = false;

		if ( ! response.status ) {
			error = `${ mpgs_gateway_params.hostedSessionErrors.default }: ${ response }`;
		}

		if ( response.status !== 'ok' ) {
			error = hostedSessions.getSessionError( response );
		} else if (
			! response.session ||
			! response.session.id ||
			! response.session.version
		) {
			error = mpgs_gateway_params.hostedSessionErrors.default;
		}

		if ( error ) {
			hostedSessions.submitError( error );
			hostedSessions.unblockForm();
			return;
		}

		jQuery( `#${ hostedSessions.pluginPrefix }_session_id` ).val(
			response.session.id
		);
		jQuery( `#${ hostedSessions.pluginPrefix }_session_version` ).val(
			response.session.version
		);

		if ( hostedSessions.isWooBlocks() ) {
			hostedSessions.$wcForm.trigger( 'submit_payment' );
		} else {
			hostedSessions.$wcForm.trigger( 'submit' );
		}
	},

	isPaymentMethodSelected() {
		return (
			hostedSessions.$ccFieldset &&
			( jQuery( `#payment_method_${ hostedSessions.pluginPrefix }` ).is(
				':checked'
			) ||
				jQuery(
					`input[name="radio-control-wc-payment-method-options"][value="${ hostedSessions.pluginPrefix }"]`
				).is( ':checked' ) )
		);
	},

	selectedField() {
		return hostedSessions.$ccFieldset
			? hostedSessions.$ccFieldset.data( 'field-type' )
			: null;
	},

	isSavedToken() {
		return (
			jQuery( `#payment_method_${ hostedSessions.pluginPrefix }` ).is(
				':checked'
			) &&
			jQuery(
				`input[name="wc-${ hostedSessions.pluginPrefix }-payment-token"]`
			).is( ':checked' ) &&
			jQuery(
				`input[name="wc-${ hostedSessions.pluginPrefix }-payment-token"]:checked`
			).val() !== 'new'
		);
	},

	paymentScope() {
		return `new-${ hostedSessions.sessionId }-${ hostedSessions.sessionIdAttempt }`;
	},

	getSessionError( response ) {
		if (
			! response.status ||
			! mpgs_gateway_params.hostedSessionErrors[ response.status ]
		) {
			return mpgs_gateway_params.hostedSessionErrors.default;
		}

		if (
			typeof mpgs_gateway_params.hostedSessionErrors[
				response.status
			] === 'object'
		) {
			if (
				response.errors &&
				mpgs_gateway_params.hostedSessionErrors[ response.status ][
					Object.keys( response.errors ).shift()
				]
			) {
				return mpgs_gateway_params.hostedSessionErrors[
					response.status
				][ Object.keys( response.errors ).shift() ];
			}
			return mpgs_gateway_params.hostedSessionErrors.default;
		}

		return (
			mpgs_gateway_params.hostedSessionErrors[ response.status ] +
			( response.errors.message ? `: ${ response.errors.message }` : '' )
		);
	},

	maybeResetPaymentSession( fieldResults ) {
		if (
			! fieldResults ||
			! fieldResults.errorReason ||
			fieldResults.errorReason !== 'SESSION_AUTHENTICATION_LIMIT_EXCEEDED'
		) {
			return;
		}

		hostedSessions.resetPaymentSession();
	},

	resetPaymentSession() {
		hostedSessions.blockFieldset();
		debounce( function () {
			if (
				! hostedSessions.isPaymentMethodSelected() ||
				! hostedSessions.selectedField()
			) {
				hostedSessions.unblockFieldset();
				return;
			}

			jQuery
				.ajax( {
					url: getWcAjaxUrl(
						'reset_hosted_session',
						hostedSessions.pluginPrefix
					),
					method: 'POST',
				} )
				.done( function () {
					hostedSessions.sessionId = '';
					hostedSessions.submitError(
						mpgs_gateway_params.hostedSessionErrors.session_expired
					);
				} )
				.always( function () {
					hostedSessions.unblockFieldset();
					jQuery( document.body ).trigger( 'update_checkout' );
				} );
		}, 100 )();
	},

	submitError( error_message ) {
		jQuery(
			'.woocommerce-NoticeGroup-checkout, .woocommerce-error, .woocommerce-message, .is-error, .is-success'
		).remove();
		hostedSessions.$wcForm.prepend(
			'<div class="woocommerce-NoticeGroup woocommerce-NoticeGroup-checkout"><div class="woocommerce-error">' +
				error_message +
				'</div></div>'
		);
		hostedSessions.unblockFieldset();
		hostedSessions.unblockForm();
		hostedSessions.$wcForm
			.find( '.input-text, select, input:checkbox' )
			.trigger( 'validate' )
			.trigger( 'blur' );
		hostedSessions.scrollToNotices();
		jQuery( document.body ).trigger( 'checkout_error', [ error_message ] );
		if ( hostedSessions.isWooBlocks() ) {
			hostedSessions.$wcForm.trigger( 'checkout_error', [
				error_message,
			] );
		}
	},

	scrollToNotices() {
		let scrollElement = jQuery(
			'.woocommerce-NoticeGroup-updateOrderReview, .woocommerce-NoticeGroup-checkout'
		);

		if ( ! scrollElement.length ) {
			scrollElement = jQuery( 'form.checkout' );
		}
		jQuery.scroll_to_notices( scrollElement );
	},

	blockForm() {
		if (
			hostedSessions.$wcForm &&
			jQuery( hostedSessions.$wcForm ).block === 'function'
		) {
			hostedSessions.$wcForm.block( {
				message: null,
				overlayCSS: {
					background: '#fff',
					opacity: 0.6,
				},
			} );
		}
	},

	unblockForm() {
		if ( hostedSessions.$wcForm ) {
			hostedSessions.$wcForm.removeClass( 'is-processing' );
			if ( typeof hostedSessions.$wcForm.unblock === 'function' ) {
				hostedSessions.$wcForm.unblock();
			} else if (
				jQuery( hostedSessions.$wcForm ).unblock === 'function'
			) {
				jQuery( hostedSessions.$wcForm ).unblock();
			}
		}
	},

	blockFieldset() {
		if (
			hostedSessions.$ccFieldset &&
			typeof jQuery( hostedSessions.$ccFieldset ).block === 'function'
		) {
			hostedSessions.$ccFieldset.block( {
				message: null,
				overlayCSS: {
					background: '#fff',
					opacity: 0.6,
				},
			} );
		}
	},

	unblockFieldset() {
		if (
			hostedSessions.$ccFieldset &&
			typeof jQuery( hostedSessions.$ccFieldset ).unblock === 'function'
		) {
			jQuery( hostedSessions.$ccFieldset ).unblock();
		}
	},

	processCardTypeChange( selector, result ) {
		const $cardField = jQuery( selector );
		$cardField.removeClass( supportedLogos().join( ' ' ) );
		if ( result.status !== 'SUPPORTED' ) {
			return;
		}

		const cardLogo = getCardLogo( result.brand );
		if ( cardLogo !== 'unknown' ) {
			$cardField.addClass( cardLogo );
		}
	},

	isWooBlocks() {
		return (
			hostedSessions.$wcForm &&
			hostedSessions.$wcForm.hasClass( 'wc-block-checkout__form' )
		);
	},

	getSessionId() {
		return jQuery( `#${ hostedSessions.pluginPrefix }_session_id` ).val();
	},

	getSessionVersion() {
		return jQuery(
			`#${ hostedSessions.pluginPrefix }_session_version`
		).val();
	},

	get3DSData() {
		return mpgs_gateway_params.threeDsEnabled
			? JSON.stringify( {
					colorDepth: window.screen.colorDepth,
					javaScriptEnabled: true,
					language: window.navigator.language,
					screenHeight: window.screen.height,
					screenWidth: window.screen.width,
					timeZone: new Date().getTimezoneOffset(),
			  } )
			: '';
	},

	process3DsAuthentication( e, result ) {
		if ( ! result[ `${ hostedSessions.pluginPrefix }_3ds` ] ) {
			return true;
		}

		const data = JSON.parse(
			result[ `${ hostedSessions.pluginPrefix }_3ds` ]
		);

		if ( ! Object.keys( data ).length ) {
			return true;
		}

		hostedSessions.process3DsAuthenticationRedirect( data.action, data );

		return true;
	},

	process3DsAuthenticationRedirect( action, data ) {
		hostedSessions.$wcForm.addClass( 'is-processing-3ds' );

		const $threeDsForm = jQuery( '<form />', {
			id: `${ hostedSessions.pluginPrefix }-3ds-form`,
			name: `${ hostedSessions.pluginPrefix }-3ds-form`,
			method: 'post',
			action,
		} );

		jQuery( document.body ).append( $threeDsForm );

		Object.keys( data ).forEach( ( key ) => {
			if ( key !== 'action' ) {
				$threeDsForm.append(
					jQuery( '<input />', {
						type: 'hidden',
						name: key,
						value: data[ key ],
					} )
				);
			}
		} );

		$threeDsForm.trigger( 'submit' );

		return true;
	},
};

export default hostedSessions;
