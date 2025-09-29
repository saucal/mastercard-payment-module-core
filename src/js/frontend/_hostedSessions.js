/**
 * External dependencies
 */
import { __ } from '@wordpress/i18n';

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
	dccChecked: false,
	dccRequesting: false,
	dccCurrentNumber: null,

	init() {
		if ( ! core_gateway_params || ! core_gateway_params.pluginPrefix ) {
			return;
		}
		hostedSessions.pluginPrefix = core_gateway_params.pluginPrefix;

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
		const threeDsForm = jQuery(
			`#${ hostedSessions.pluginPrefix }_3ds_form`
		);

		if ( threeDsForm.length ) {
			const data = threeDsForm.data( '3ds-data' );

			if ( Object.keys( data ).length && data.action ) {
				hostedSessions.process3DsAuthenticationRedirect(
					data.action,
					data
				);
				return;
			}
		}

		hostedSessions.sessionId = jQuery(
			`#${ core_gateway_params.pluginPrefix }_session_id`
		).val();

		if ( ! hostedSessions.sessionId ) {
			return;
		}

		hostedSessions.sessionIdAttempt = jQuery(
			`#${ core_gateway_params.pluginPrefix }_session_attempt`
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
				`${ core_gateway_params.hostedSessionErrors.default }: ${ error }`
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

		PaymentSession.onCardBINChange( () => {
			hostedSessions.dccChecked = false;
			hostedSessions.maybeTriggerCurrencyConversion();
		} );

		jQuery( document.body ).on( 'updated_checkout', () => {
			hostedSessions.dccChecked = false;
		} );
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
			fieldResults.card[ role ],
			role
		);

		if ( fieldResults.card?.isValid ) {
			hostedSessions.maybeTriggerCurrencyConversion();
		}
	},

	processValidatedField( fieldSelector, result, role = null ) {
		hostedSessions.unblockFieldset();

		if ( ! result.isValid ) {
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
			return;
		}

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
				`${ core_gateway_params.hostedSessionErrors.default }: ${ error }`
			);
			hostedSessions.unblockForm();
		}
	},

	handlePaymentResponse( response ) {
		if ( ! hostedSessions.dccChecked && hostedSessions.dccRequesting ) {
			hostedSessions.requestCurrencyConversionQuote( response );
			return;
		}

		let error = false;

		if ( ! response.status ) {
			error = `${ core_gateway_params.hostedSessionErrors.default }: ${ response }`;
		}

		if ( response.status !== 'ok' ) {
			error = hostedSessions.getSessionError( response );
		} else if (
			! response.session ||
			! response.session.id ||
			! response.session.version
		) {
			error = core_gateway_params.hostedSessionErrors.default;
		} else if (
			response?.sourceOfFunds?.provided?.card &&
			! response.sourceOfFunds.provided.card.securityCode
		) {
			error =
				core_gateway_params.hostedSessionErrors.fields_in_error
					.securityCode;
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

		if (
			core_gateway_params.threeDsEnabled &&
			jQuery( 'input[name="woocommerce_change_payment"]' ).length > 0
		) {
			hostedSessions.execute3DsAuthentication(
				jQuery( 'input[name="woocommerce_change_payment"]' ).val(),
				true
			);
			return;
		}

		hostedSessions.submitForm();
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
			! core_gateway_params.hostedSessionErrors[ response.status ]
		) {
			return core_gateway_params.hostedSessionErrors.default;
		}

		if (
			typeof core_gateway_params.hostedSessionErrors[
				response.status
			] === 'object'
		) {
			if (
				response.errors &&
				core_gateway_params.hostedSessionErrors[ response.status ][
					Object.keys( response.errors ).shift()
				]
			) {
				return core_gateway_params.hostedSessionErrors[
					response.status
				][ Object.keys( response.errors ).shift() ];
			}
			return core_gateway_params.hostedSessionErrors.default;
		}

		return (
			core_gateway_params.hostedSessionErrors[ response.status ] +
			( response.errors.message ? `: ${ response.errors.message }` : '' )
		);
	},

	maybeResetPaymentSession( fieldResults ) {
		const invalidSessionCodes = [
			'SESSION_AUTHENTICATION_LIMIT_EXCEEDED',
			'SYSTEM_ERROR',
			'NOT_AUTHORIZED',
			'TIMEOUT',
		];

		if ( invalidSessionCodes.includes( fieldResults?.errorReason ) ) {
			hostedSessions.resetPaymentSession();
		}
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
				.done( function ( res ) {
					hostedSessions.sessionId = res;
					jQuery(
						`#${ core_gateway_params.pluginPrefix }_session_id`
					).val( res );
					hostedSessions.submitError(
						core_gateway_params.hostedSessionErrors.session_expired
					);
					hostedSessions.initHostedSession();
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

	submitForm() {
		if ( hostedSessions.isWooBlocks() ) {
			hostedSessions.$wcForm.trigger( 'submit_payment' );
		} else {
			hostedSessions.$wcForm.trigger( 'submit' );
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
		return core_gateway_params.threeDsEnabled
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

	execute3DsAuthentication( orderId = null, isChangePayment = false ) {
		const data = {
			order_id: orderId || '',
		};

		if ( isChangePayment ) {
			data.change_payment_method = true;
		}

		data[ `${ hostedSessions.pluginPrefix }_3ds_data` ] =
			hostedSessions.get3DSData();
		data[ `${ core_gateway_params.pluginPrefix }_session_id` ] =
			hostedSessions.getSessionId();
		data[ `${ core_gateway_params.pluginPrefix }_session_version` ] =
			hostedSessions.getSessionVersion();

		jQuery
			.ajax( {
				url: getWcAjaxUrl(
					'authenticate_payer',
					hostedSessions.pluginPrefix
				),
				method: 'POST',
				data,
			} )
			.done( function ( res ) {
				if ( ! res?.success ) {
					hostedSessions.submitError(
						res?.data?.message ||
							__(
								'There was an error with the payment authentication. Please try again.',
								core_gateway_params.textDomain
							)
					);
					return;
				}

				hostedSessions.process3DsAuthentication(
					null,
					res?.data || {}
				);

				if (
					! hostedSessions.$wcForm.hasClass( 'is-processing-3ds' )
				) {
					hostedSessions.submitForm();
				}
			} )
			.fail( function ( res ) {
				hostedSessions.submitError(
					res?.data?.message ||
						__(
							'There was an error with the payment authentication. Please try again.',
							core_gateway_params.textDomain
						)
				);
			} )
			.always( function () {
				hostedSessions.unblockForm();
			} );
	},

	maybeTriggerCurrencyConversion() {
		if ( hostedSessions.dccChecked || hostedSessions.dccRequesting ) {
			return;
		}

		const $dccWrapper = jQuery(
			`#${ hostedSessions.pluginPrefix }_currency_conversion`
		);
		if ( ! $dccWrapper.length ) {
			return;
		}

		hostedSessions.blockFieldset();
		$dccWrapper.html( '' );
		hostedSessions.dccRequesting = true;

		PaymentSession.updateSessionFromForm(
			'card',
			undefined,
			hostedSessions.paymentScope()
		);
	},

	requestCurrencyConversionQuote( response ) {
		if ( ! response?.status || response.status !== 'ok' ) {
			hostedSessions.completeCurrencyConversionRequest();
			return;
		}

		if ( ! response?.session?.id || ! response?.session?.version ) {
			hostedSessions.completeCurrencyConversionRequest();
			return;
		}

		if ( ! response?.sourceOfFunds?.provided?.card?.number ) {
			hostedSessions.completeCurrencyConversionRequest();
			return;
		}

		const currentNumber = response.sourceOfFunds.provided.card.number;
		if ( hostedSessions.dccCurrentNumber === currentNumber ) {
			hostedSessions.completeCurrencyConversionRequest();
			return;
		}
		hostedSessions.dccCurrentNumber = currentNumber;

		hostedSessions.dccRequesting = true;

		jQuery
			.ajax( {
				url: core_gateway_params.dccRequestEndpoint,
				method: 'POST',
				headers: {
					Authorization: `Basic ${ btoa(
						`merchant.${ core_gateway_params.merchantId }:${ response.session.id }`
					) }`,
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				data: JSON.stringify( {
					apiOperation: 'PAYMENT_OPTIONS_INQUIRY',
					session: {
						id: response.session.id,
						version: response.session.version,
					},
				} ),
			} )
			.done( function ( res ) {
				if (
					! res?.paymentTypes?.card?.currencyConversion?.requestId
				) {
					hostedSessions.completeCurrencyConversionRequest();
					return;
				}

				const conversionQuote =
					res.paymentTypes.card?.currencyConversion;

				jQuery(
					`#${ hostedSessions.pluginPrefix }_currency_conversion`
				).html( conversionQuote.offerText );

				jQuery(
					`#${ hostedSessions.pluginPrefix }_dcc_request_id`
				).val( conversionQuote.requestId );

				hostedSessions.dccChecked = true;
			} )
			.always( function () {
				hostedSessions.completeCurrencyConversionRequest();
			} );
	},

	completeCurrencyConversionRequest() {
		hostedSessions.dccRequesting = false;
		hostedSessions.unblockFieldset();
	},
};

export default hostedSessions;
