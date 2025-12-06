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
	selectedTokenId: false,
	dirtyFields: {},

	init() {
		if ( ! core_gateway_params || ! core_gateway_params.pluginPrefix ) {
			return;
		}
		hostedSessions.pluginPrefix = core_gateway_params.pluginPrefix;
		hostedSessions.$eventProxy = jQuery( '<div>' ); // hacky jQuery event proxy, not attached to DOM, so it won't bubble up to document

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
			if ( core_gateway_params.threeDsEnabled ) {
				hostedSessions.$wcForm.on(
					'checkout_place_order_success',
					hostedSessions.process3DsAuthentication
				);
			}
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

		if ( ! hostedSessions.isPaymentMethodSelected() ) {
			return;
		}

		const savedToken = hostedSessions.isSavedToken();
		hostedSessions.selectedTokenId = savedToken;
		if ( !! savedToken ) {
			hostedSessions.dcc.maybeTriggerCurrencyConversion();
			return;
		}

		hostedSessions.dcc.setQuoteArea( '' );
		hostedSessions.dcc.setQuoteId( '' );
		hostedSessions.blockFieldset();
		try {
			PaymentSession.configure(
				{
					session: hostedSessions.sessionId,
					fields: hostedSessions.fields(),
					frameEmbeddingMitigation: [ 'javascript' ],
					callbacks: {
						initialized: () => {
							hostedSessions
								.validateForm()
								.then( ( fieldResults ) => {
									hostedSessions
										.validateCardFields( fieldResults )
										.then( () => {
											hostedSessions.unblockFieldset();
										} );
								} );
						},
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
			return;
		}

		PaymentSession.onChange(
			[
				'card.number',
				'card.securityCode',
				'card.expiryYear',
				'card.expiryMonth',
			],
			function ( fieldSelector, role ) {
				const timeoutBlock = setTimeout( function () {
					// Only block if validation takes too long
					hostedSessions.blockFieldset();
				}, 100 );

				hostedSessions.dirtyFields[ role ] = true;

				hostedSessions.validateForm().then( ( fieldResults ) => {
					clearTimeout( timeoutBlock ); // If we didn't block yet, cancel it
					hostedSessions.validateCardFields( fieldResults );
				} );
			}
		);

		PaymentSession.onValidityChange(
			[
				'card.number',
				'card.securityCode',
				'card.expiryMonth',
				'card.expiryYear',
			],
			function ( selector, result ) {
				hostedSessions.maybeResetPaymentSession( result?.errorReason );
				hostedSessions.processValidatedField( selector, result );
			}
		);

		PaymentSession.onCardTypeChange( ( selector, result ) => {
			hostedSessions.dirtyFields.number = true;
			hostedSessions.processCardTypeChange( selector, result );
		} );

		PaymentSession.onCardBINChange( () => {
			hostedSessions.dirtyFields.number = true;
			hostedSessions.validateForm().then( ( fieldResults ) => {
				hostedSessions.validateCardFields( fieldResults );
			} );
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

	fieldIsDirty( role ) {
		const roles = typeof role === 'string' ? [ role ] : role;
		for ( const r of roles ) {
			if ( hostedSessions.dirtyFields[ r ] ) {
				return true;
			}
		}
		return false;
	},

	validateForm() {
		return new Promise( ( resolve ) => {
			PaymentSession.validate( 'card', function ( results ) {
				for ( const role in results.card ) {
					if (
						results.card[ role ].errorReason &&
						results.card[ role ].errorReason ===
							'AWAITING_SERVER_RESPONSE'
					) {
						return hostedSessions.validateForm().then( resolve );
					}
				}

				return resolve( results );
			} );
		} );
	},

	validateCardFields( fieldResults, allowEmpty = true, doDCC = true ) {
		return new Promise( ( resolve ) => {
			const roles = [
				'number',
				'securityCode',
				'expiryMonth',
				'expiryYear',
			];
			let valid = true;
			for ( const role of roles ) {
				const fieldSelector = fieldResults.card[ role ]?.selector;
				hostedSessions.maybeResetPaymentSession(
					fieldResults?.card[ role ]?.errorReason
				);

				if (
					! hostedSessions.processValidatedField(
						fieldSelector,
						fieldResults.card[ role ],
						allowEmpty
					)
				) {
					valid = false;
				}
			}

			if ( doDCC && fieldResults.card?.isValid ) {
				hostedSessions.dcc
					.maybeTriggerCurrencyConversion()
					.then( () => {
						resolve( fieldResults.card?.isValid );
					} );
			} else {
				resolve( fieldResults.card?.isValid );
			}
		} );
	},

	processValidatedField( fieldSelector, result, allowEmpty = true ) {
		hostedSessions.unblockFieldset();

		const $field = jQuery( fieldSelector ).closest(
			hostedSessions.isWooBlocks()
				? '.wc-block-components-text-input'
				: '.form-row'
		);

		$field.removeClass(
			'woocommerce-invalid woocommerce-validated has-error'
		);

		if ( allowEmpty && result?.errorReason === 'EMPTY' ) {
			// Empty is an error technically, but we're allowing it in this case
			return true;
		} else if ( ! result.isValid ) {
			$field.addClass( 'woocommerce-invalid has-error' );
			return false;
		}
		$field.addClass( 'woocommerce-validated' );
		return true;
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

		if ( core_gateway_params.threeDsEnabled ) {
			jQuery( `#${ hostedSessions.pluginPrefix }_3ds_data` ).val(
				hostedSessions.get3DSData()
			);
		}

		event.preventDefault();

		hostedSessions.$wcForm.addClass( 'is-processing' );
		hostedSessions.triggerPay();

		return false;
	},

	queue: [],

	queuePromise( cb ) {
		const i = new Date().getTime();
		hostedSessions.queue.push( i );
		return new Promise( ( resolve, reject ) => {
			const check = function () {
				if ( hostedSessions.queue[ 0 ] !== i ) {
					setTimeout( check, 100 );
					return;
				}

				hostedSessions.queue.shift();
				const promise = cb();
				promise.then( resolve ).finally( resolve );
			};
			check();
		} );
	},

	lastSessionUpdateResponse: {},

	updateSession() {
		return hostedSessions.queuePromise( function () {
			return new Promise( ( resolve, reject ) => {
				if ( ! hostedSessions.isSavedToken() ) {
					try {
						hostedSessions.lastSessionUpdateResponse = {};
						PaymentSession.updateSessionFromForm(
							'card',
							undefined,
							hostedSessions.paymentScope()
						);
					} catch ( error ) {
						reject( error );
						return;
					}
				} else {
					hostedSessions.updateSessionFromToken(
						hostedSessions.isSavedToken()
					);
				}

				hostedSessions.$eventProxy.one(
					'payment_response',
					function ( e, response ) {
						hostedSessions.dirtyFields = {};
						if (
							hostedSessions.maybeResetPaymentSession(
								response?.status
							)
						) {
							reject( response );
						}
						hostedSessions.lastSessionUpdateResponse = response;
						resolve( response );
					}
				);
			} );
		} );
	},

	updateSessionFromToken( tokenId ) {
		return new Promise( ( resolve, reject ) => {
			const data = {};
			data[ `${ hostedSessions.pluginPrefix }_session_id` ] =
				hostedSessions.getSessionId();
			data[ `${ hostedSessions.pluginPrefix }_token_id` ] = tokenId;

			jQuery
				.ajax( {
					url: getWcAjaxUrl(
						'update_hosted_session_from_token',
						hostedSessions.pluginPrefix
					),
					method: 'POST',
					data,
				} )
				.done( function ( res ) {
					hostedSessions.$eventProxy.trigger( 'payment_response', [
						res.data.response,
					] );
				} )
				.fail( function ( res ) {
					hostedSessions.submitError(
						res?.data?.message ||
							__(
								'There was an error with the payment authentication. Please try again.',
								core_gateway_params.textDomain
							)
					);
				} );
		} );
	},

	triggerPay() {
		let promise;
		if ( !! hostedSessions.isSavedToken() ) {
			promise = Promise.resolve();
		} else {
			promise = new Promise( ( resolve, reject ) => {
				hostedSessions.validateForm().then( ( results ) => {
					if (
						! hostedSessions.validateCardFields(
							results,
							false,
							false
						)
					) {
						reject();
						return;
					}
					resolve();
				} );
			} );
		}

		promise
			.catch( () => {} )
			.then( function () {
				hostedSessions.blockForm();
				return hostedSessions.updateSession();
			} )
			.catch( function ( error ) {
				hostedSessions.submitError(
					`${ core_gateway_params.hostedSessionErrors.default }: ${ error }`
				);
			} )
			.then( hostedSessions.triggerPayAfterResponse );
	},

	triggerPayAfterResponse( response ) {
		let error = false;
		const errors = [];

		if ( ! response.status ) {
			error = `${ core_gateway_params.hostedSessionErrors.default }: ${ response }`;
		} else if ( response.status !== 'ok' ) {
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
			errors.push( error );
		}

		const dccErrors = hostedSessions.dcc.validateCurrencyConversionData();
		if ( dccErrors.length ) {
			errors.push( ...dccErrors );
		}

		if ( errors.length ) {
			hostedSessions.submitError( errors );
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
			! hostedSessions.isCheckout()
		) {
			const isChangePayment = hostedSessions.isChangePayment();
			let orderId = 'add_payment_method';
			if ( isChangePayment ) {
				orderId = jQuery(
					'input[name="woocommerce_change_payment"]'
				).val();
			}
			hostedSessions.execute3DsAuthentication( orderId, isChangePayment );
			return;
		}

		hostedSessions.submitForm();
	},

	handlePaymentResponse( response ) {
		hostedSessions.$eventProxy.trigger( 'payment_response', [ response ] );
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
		if (
			! jQuery( `#payment_method_${ hostedSessions.pluginPrefix }` ).is(
				':checked'
			)
		) {
			return false;
		}

		const paymentToken = jQuery(
			`input[name="wc-${ hostedSessions.pluginPrefix }-payment-token"]`
		).filter( ':checked' );

		if ( ! paymentToken.length ) {
			return false;
		}

		const tokenId = paymentToken.val();

		if ( tokenId.length === 0 ) {
			return false;
		}

		if ( tokenId === 'new' ) {
			return false;
		}

		return tokenId;
	},

	isChangePayment() {
		return jQuery( 'input[name="woocommerce_change_payment"]' ).length > 0;
	},

	isAddPaymentMethod() {
		return jQuery( 'form#add_payment_method' ).length > 0;
	},

	isCheckout() {
		return (
			jQuery( 'form.woocommerce-checkout, form.wc-block-checkout__form' )
				.length > 0
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

	maybeResetPaymentSession( reason ) {
		if ( typeof reason === 'undefined' || reason === null ) {
			return false;
		}

		const invalidSessionCodes = [
			'SESSION_AUTHENTICATION_LIMIT_EXCEEDED',
			'SYSTEM_ERROR',
			'NOT_AUTHORIZED',
			'TIMEOUT',
		];

		if ( invalidSessionCodes.includes( reason.toUpperCase() ) ) {
			hostedSessions.resetPaymentSession();
			return true;
		}
		return false;
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
		const errors =
			typeof error_message === 'string'
				? [ error_message ]
				: error_message;

		for ( const message of errors ) {
			hostedSessions.$wcForm.prepend(
				'<div class="woocommerce-NoticeGroup woocommerce-NoticeGroup-checkout"><div class="woocommerce-error">' +
					message +
					'</div></div>'
			);
		}

		hostedSessions.unblockFieldset();
		hostedSessions.unblockForm();
		hostedSessions.$wcForm
			.find( '.input-text, select, input:checkbox' )
			.trigger( 'validate' )
			.trigger( 'blur' );
		hostedSessions.scrollToNotices();

		for ( const message of errors ) {
			jQuery( document.body ).trigger( 'checkout_error', [ message ] );
			if ( hostedSessions.isWooBlocks() ) {
				hostedSessions.$wcForm.trigger( 'checkout_error', [ message ] );
			}
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
			typeof jQuery( hostedSessions.$wcForm ).block === 'function'
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
			typeof jQuery( hostedSessions.$ccFieldset ).block === 'function' &&
			jQuery( hostedSessions.$ccFieldset ).is( ':visible' )
		) {
			hostedSessions.$ccFieldset.block( {
				message: null,
				overlayCSS: {
					background: '#fff',
					opacity: 0.6,
				},
			} );
		} else {
			const $paymentWrapper = jQuery(
				'#payment, .wc-block-checkout__payment-method'
			);
			if (
				$paymentWrapper.length &&
				typeof jQuery( $paymentWrapper ).block === 'function'
			) {
				$paymentWrapper.block( {
					message: null,
					overlayCSS: {
						background: '#fff',
						opacity: 0.6,
					},
				} );
			}
		}
	},

	unblockFieldset() {
		if (
			hostedSessions.$ccFieldset &&
			typeof jQuery( hostedSessions.$ccFieldset ).unblock === 'function'
		) {
			jQuery( hostedSessions.$ccFieldset ).unblock();
		}

		const $paymentWrapper = jQuery(
			'#payment, .wc-block-checkout__payment-method'
		);
		if (
			$paymentWrapper.length &&
			typeof jQuery( $paymentWrapper ).unblock === 'function'
		) {
			$paymentWrapper.unblock();
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

	dcc: {
		checked: false,
		requesting: false,
		currentNumber: null,
		currentQuote: false,
		currentQuoteKey: false,

		setQuoteId( requestId ) {
			return hostedSessions.dcc.getQuoteIdField().val( requestId );
		},

		getQuoteIdField() {
			return jQuery( `#${ hostedSessions.pluginPrefix }_dcc_request_id` );
		},

		setQuoteArea( html ) {
			const $dccWrapper = hostedSessions.dcc.getQuoteArea();
			if ( $dccWrapper.length ) {
				if ( $dccWrapper.data( 'offer-text' ) !== html ) {
					$dccWrapper.data( 'offer-text', html );
					$dccWrapper.html( html );
				}
			}
		},

		getQuoteArea( clean = false ) {
			const $dccWrapper = jQuery(
				`#${ hostedSessions.pluginPrefix }_currency_conversion`
			);

			if ( $dccWrapper.length && clean ) {
				hostedSessions.dcc.setQuoteArea( '' );
			}
			return $dccWrapper;
		},

		maybeTriggerCurrencyConversion() {
			if ( ! core_gateway_params.dccEnabled ) {
				return Promise.resolve();
			}

			if ( hostedSessions.isChangePayment() ) {
				// There's no point in showing DCC offers when changing payment methods
				return Promise.resolve();
			}

			if ( hostedSessions.dcc.requesting ) {
				return Promise.resolve();
			}

			const $dccWrapper = hostedSessions.dcc.getQuoteArea();

			if ( ! $dccWrapper.length ) {
				return Promise.resolve();
			}

			const $dccRequestId = hostedSessions.dcc.getQuoteIdField();

			if ( ! $dccRequestId.length ) {
				return Promise.resolve();
			}

			hostedSessions.dcc.requesting = true;

			hostedSessions.blockFieldset();

			let quotePromise;

			if ( !! hostedSessions.selectedTokenId ) {
				quotePromise =
					hostedSessions.dcc.requestCurrencyConversionQuoteSavedToken(
						hostedSessions.selectedTokenId
					);
			} else {
				quotePromise =
					hostedSessions.dcc.requestCurrencyConversionQuote();
			}

			return quotePromise
				.then( function ( res ) {
					// Quote handled in the promise.
					if ( res.offerText.length === 0 ) {
						res.offerText =
							'<input type="hidden" name="dccOfferState" value="Unavailable" />';
					}
					hostedSessions.dcc.setQuoteArea( res.offerText );
					hostedSessions.dcc.setQuoteId( res.requestId );
				} )
				.catch( () => {
					hostedSessions.dcc.setQuoteArea( '' );
					hostedSessions.dcc.setQuoteId( '' );
				} )
				.finally( function () {
					hostedSessions.unblockFieldset();
					hostedSessions.dcc.requesting = false;
				} );
		},

		getCachedQuote( key ) {
			if (
				key === hostedSessions.dcc.currentQuoteKey &&
				hostedSessions.dcc.currentQuote !== false
			) {
				return hostedSessions.dcc.currentQuote;
			}
			return false;
		},

		cacheQuote( key, quote ) {
			if ( typeof quote === 'undefined' ) {
				return hostedSessions.dcc.getCachedQuote( key );
			}

			hostedSessions.dcc.currentQuoteKey = key;
			hostedSessions.dcc.currentQuote = quote;

			return hostedSessions.dcc.currentQuote;
		},

		clearCachedQuote() {
			hostedSessions.dcc.currentQuoteKey = false;
			hostedSessions.dcc.currentQuote = false;
		},

		requestCurrencyConversionQuote() {
			return new Promise( function ( resolve, reject ) {
				let promise;
				if (
					hostedSessions.fieldIsDirty( [
						'number',
						'expiryMonth',
						'expiryYear',
					] )
				) {
					promise = hostedSessions.updateSession();
				} else {
					promise = Promise.resolve(
						hostedSessions.lastSessionUpdateResponse
					);
				}
				promise
					.then( function ( response ) {
						if ( ! response?.status || response.status !== 'ok' ) {
							return reject();
						}

						if (
							! response?.session?.id ||
							! response?.session?.version
						) {
							return reject();
						}

						if (
							! response?.sourceOfFunds?.provided?.card?.number
						) {
							return reject();
						}

						const currentNumber =
							response.sourceOfFunds.provided.card.number;

						const cached =
							hostedSessions.dcc.getCachedQuote( currentNumber );
						if ( cached ) {
							return resolve( cached );
						}

						hostedSessions.dcc.clearCachedQuote();

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
									! res?.paymentTypes?.card
										?.currencyConversion?.requestId
								) {
									return reject();
								}

								const conversionQuote =
									res.paymentTypes.card?.currencyConversion;

								return resolve(
									hostedSessions.dcc.cacheQuote(
										currentNumber,
										{
											requestId:
												conversionQuote.requestId,
											offerText:
												conversionQuote.offerText || '',
										}
									)
								);
							} );
					} )
					.catch( reject );
			} );
		},

		getCurrencyConversionDataRaw() {
			const dccData = {};

			if ( ! core_gateway_params.dccEnabled ) {
				return dccData;
			}

			const $dccRequestId = hostedSessions.dcc.getQuoteIdField();
			if ( ! $dccRequestId.length || $dccRequestId.val().length === 0 ) {
				return dccData;
			}

			dccData.dccRequestId = $dccRequestId.val();

			const $dccOfferState = jQuery( 'input[name="dccOfferState"]' );
			if (
				$dccOfferState.length === 1 &&
				$dccOfferState.is( '[type="hidden"]' )
			) {
				dccData.dccOfferState = $dccOfferState.val();
			} else if ( $dccOfferState.length > 1 ) {
				if ( $dccOfferState.filter( ':checked' ).length ) {
					dccData.dccOfferState = $dccOfferState
						.filter( ':checked' )
						.val();
				} else {
					dccData.dccOfferState = false;
				}
			} else {
				dccData.dccOfferState = false;
			}

			return dccData;
		},

		getCurrencyConversionData() {
			const dccData = {};

			if ( ! core_gateway_params.dccEnabled ) {
				return dccData;
			}

			const rawData = hostedSessions.dcc.getCurrencyConversionDataRaw();
			if ( ! rawData.dccRequestId ) {
				return dccData;
			}

			dccData[ `${ hostedSessions.pluginPrefix }_dcc_request_id` ] =
				rawData.dccRequestId;
			if ( rawData.dccOfferState !== false ) {
				dccData.dccOfferState = dccData.dccOfferState;
			}

			return dccData;
		},

		validateCurrencyConversionData() {
			const errors = [];

			if ( ! core_gateway_params.dccEnabled ) {
				return errors;
			}

			const data = hostedSessions.dcc.getCurrencyConversionDataRaw();

			if ( ! data?.dccRequestId ) {
				return errors;
			}

			if ( data?.dccOfferState === false ) {
				errors.push(
					__(
						'Please select whether you want to accept or reject the currency conversion offer.',
						core_gateway_params.textDomain
					)
				);
			}

			return errors;
		},

		requestCurrencyConversionQuoteSavedToken( tokenId ) {
			return new Promise( function ( resolve, reject ) {
				if ( ! tokenId ) {
					return;
				}

				const cached = hostedSessions.dcc.getCachedQuote( tokenId );
				if ( cached ) {
					return resolve( cached );
				}

				hostedSessions.dcc.clearCachedQuote();

				jQuery
					.ajax( {
						url: getWcAjaxUrl(
							'dcc_quote',
							hostedSessions.pluginPrefix
						),
						method: 'POST',
						data: {
							token_id: tokenId,
							nonce: core_gateway_params.dccNonce,
						},
					} )
					.done( function ( res ) {
						if (
							! res?.success ||
							! res?.data?.requestId ||
							! res?.data?.offerText
						) {
							return reject();
						}

						return resolve(
							hostedSessions.dcc.cacheQuote( tokenId, {
								requestId: res.data.requestId,
								offerText: res.data.offerText,
							} )
						);
					} );
			} );
		},
	},
};

export default hostedSessions;
