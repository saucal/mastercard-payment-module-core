/**
 * External dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { getPrefix, addPrefix, getSessionId, getTextDomain } from './_settings';

/**
 * CardElements component.
 */
export const CardElements = () => {
	return (
		<div
			id={ `wc-${ getPrefix() }-cc-form` }
			className={ `wc-credit-card-form wc-payment-form ${ getPrefix() }-payment-form mpgs-payment-form mpgs-payment-form-blocks` }
			data-field-type="card"
		>
			<div className="wc-block-components-text-input is-active">
				<label htmlFor={ `${ getPrefix() }-card-number` }>
					{ __( 'Card number', getTextDomain() ) }
					<span className="required">*</span>
				</label>
				<input
					id={ `${ getPrefix() }-card-number-${ getSessionId() }` }
					readOnly="readonly"
					className="wc-credit-card-form-card wc-credit-card-form-card-number"
					inputMode="numeric"
					autoComplete="cc-number"
					autoCorrect="no"
					autoCapitalize="no"
					spellCheck="no"
					type="text"
					placeholder="&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull;"
				/>
			</div>
			<div className="wc-block-components-text-input is-small is-active">
				<label htmlFor={ `${ getPrefix() }-card-expiry-month` }>
					{ __( 'Expiry (MM)', getTextDomain() ) }
					<span className="required">*</span>
				</label>
				<input
					id={ `${ getPrefix() }-card-expiry-month-${ getSessionId() }` }
					readOnly="readonly"
					className="wc-credit-card-form-card wc-credit-card-form-card-expiry"
					inputMode="numeric"
					autoComplete="cc-exp"
					autoCorrect="no"
					autoCapitalize="no"
					spellCheck="no"
					type="text"
					placeholder="MM"
				/>
			</div>
			<div className="wc-block-components-text-input is-small is-active">
				<label htmlFor={ `${ getPrefix() }-card-expiry-year` }>
					{ __( 'Expiry (MM)', getTextDomain() ) }
					<span className="required">*</span>
				</label>
				<input
					id={ `${ getPrefix() }-card-expiry-year-${ getSessionId() }` }
					readOnly="readonly"
					className="wc-credit-card-form-card wc-credit-card-form-card-expiry"
					inputMode="numeric"
					autoComplete="cc-exp"
					autoCorrect="no"
					autoCapitalize="no"
					spellCheck="no"
					type="text"
					placeholder="YY"
				/>
			</div>
			<div className="wc-block-components-text-input is-active">
				<label htmlFor={ `${ getPrefix() }-card-cvc` }>
					{ __( 'Expiry (MM)', getTextDomain() ) }
					<span className="required">*</span>
				</label>
				<input
					id={ `${ getPrefix() }-card-cvc-${ getSessionId() }` }
					readOnly="readonly"
					className="wc-credit-card-form-card wc-credit-card-form-card-cvc"
					inputMode="numeric"
					autoComplete="off"
					autoCorrect="no"
					autoCapitalize="no"
					spellCheck="no"
					type="text"
					maxLength="4"
					placeholder="CVC"
				/>
			</div>
			<div className="clear"></div>
			<input
				type="hidden"
				id={ addPrefix( 'session_id' ) }
				name={ addPrefix( 'session_id' ) }
				value={ getSessionId() }
			/>
			<input
				type="hidden"
				id={ addPrefix( 'session_attempt' ) }
				name={ addPrefix( 'session_attempt' ) }
				value={ `${ getSessionId() }_${ new Date().getTime() }` }
			/>
			<input
				type="hidden"
				id={ addPrefix( 'session_version' ) }
				name={ addPrefix( 'session_version' ) }
			/>
		</div>
	);
};
