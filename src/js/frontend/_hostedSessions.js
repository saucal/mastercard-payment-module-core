/**
 * Internal dependencies
 */
import { debounce, getWcAjaxUrl, supportedLogos, getCardLogo } from './_utils';

const hostedSessions = {
	pluginPrefix: mpgs_gateway_params.prefix,
	sessionId: null,
	sessionIdAttempt: null,
	$ccFieldset: null,
	$wcForm: null,

	init() {
		if ( ! window.PaymentSession ) {
			this.reInit();
			return;
		}

		this.initElements();
		jQuery( document.body ).on( 'updated_checkout', this.initElements );

		if ( hostedSessions.sessionId ) {
			hostedSessions.initWcForm();
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
		}
	},

	initHostedSession() {
		PaymentSession.configure(
			{
				session: hostedSessions.sessionId,
				fields: hostedSessions.fields(),
				frameEmbeddingMitigation: [ 'javascript' ],
				callbacks: {
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
				.closest( '.form-row' )
				.removeClass( 'woocommerce-invalid woocommerce-validated' )
				.addClass( 'woocommerce-validated' );
		} else {
			jQuery( fieldSelector )
				.closest( '.form-row' )
				.removeClass( 'woocommerce-invalid woocommerce-validated' )
				.addClass( 'woocommerce-invalid' );
		}
	},

	submitPay( event ) {
		if (
			hostedSessions.$wcForm.hasClass( 'is-processing' ) ||
			! hostedSessions.isPaymentMethodSelected() ||
			! hostedSessions.selectedField()
		) {
			return;
		}

		event.preventDefault();

		hostedSessions.$wcForm.addClass( 'is-processing' );
		hostedSessions.blockForm();

		try {
			PaymentSession.updateSessionFromForm(
				'card',
				undefined,
				hostedSessions.paymentScope()
			);
		} catch ( error ) {
			hostedSessions.submitError(
				`There was an error updating the session: ${ error }`
			);
			hostedSessions.unblockForm();
		}

		return false;
	},

	handlePaymentResponse( response ) {
		let error = false;

		if ( ! response.status ) {
			error = `There was an error updating the session: ${ response }`;
		}

		if ( response.status !== 'ok' ) {
			error = hostedSessions.getSessionError( response );
		}

		if (
			! response.session ||
			! response.session.id ||
			! response.session.version
		) {
			error = 'There was an error updating the session.';
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

		hostedSessions.$wcForm.trigger( 'submit' );
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

	selectedToken() {
		// TODO: To be implemented along with the saved card functionality.
		return 'new';
	},

	isSavedToken() {
		// TODO: To be implemented along with the saved card functionality.
		return hostedSessions.isPaymentMethodSelected();
	},

	paymentScope() {
		return `${ hostedSessions.selectedToken() }-${
			hostedSessions.sessionId
		}-${ hostedSessions.sessionIdAttempt }`;
	},

	getSessionError( response ) {
		// TODO: Refactor errors.
		if ( response.status === 'fields_in_error' ) {
			if ( response.errors.cardNumber ) {
				return 'Card number invalid or missing.';
			}
			if ( response.errors.expiryYear ) {
				return 'Expiry year invalid or missing.';
			}
			if ( response.errors.expiryMonth ) {
				return 'Expiry month invalid or missing.';
			}
			if ( response.errors.securityCode ) {
				return 'Security code invalid.';
			}

			return 'Session update failed with field errors.';
		} else if ( response.status === 'payment_type_required' ) {
			return "Payment type is required. Valid values are 'card', 'ach' or 'giftCard'.";
		} else if ( response.status === 'giftCard_type_required' ) {
			return 'Gift card payment type requires an expected local brand parameter.';
		} else if ( response.status === 'request_timeout' ) {
			return (
				'Session update failed with request timeout: ' +
				response.errors.message
			);
		} else if ( response.status === 'system_error' ) {
			return (
				'Session update failed with system error: ' +
				response.errors.message
			);
		}
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
						'The Payment Session expired. Please try again.'
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
			if ( jQuery( hostedSessions.$wcForm ).unblock === 'function' ) {
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
};

export default hostedSessions;
