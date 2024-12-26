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
		<fieldset
			id={ `wc-${ getPrefix() }-cc-form` }
			className={ `wc-credit-card-form wc-payment-form ${ getPrefix() }-payment-form mpgs-payment-form` }
			data-field-type="card"
		>
			<div className="form-row form-row-wide">
				<label htmlFor={ `${ getPrefix() }-card-number` }>
					{ __( 'Card number', getTextDomain() ) }
					<span className="required">*</span>
				</label>
				<input
					id={ `${ getPrefix() }-card-number-${ getSessionId() }` }
					readOnly="readonly"
					className="input-text wc-credit-card-form-card-number"
					inputMode="numeric"
					autoComplete="cc-number"
					autoCorrect="no"
					autoCapitalize="no"
					spellCheck="no"
					type="tel"
					placeholder="&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull;"
				/>
			</div>
			<div className="form-row form-row-first">
				<label htmlFor={ `${ getPrefix() }-card-expiry-month` }>
					{ __( 'Expiry (MM)', getTextDomain() ) }
					<span className="required">*</span>
				</label>
				<input
					id={ `${ getPrefix() }-card-expiry-month-${ getSessionId() }` }
					readOnly="readonly"
					className="input-text wc-credit-card-form-card-expiry"
					inputMode="numeric"
					autoComplete="cc-exp"
					autoCorrect="no"
					autoCapitalize="no"
					spellCheck="no"
					type="tel"
					placeholder="MM"
				/>
			</div>
			<div className="form-row form-row-last">
				<label htmlFor={ `${ getPrefix() }-card-expiry-year` }>
					{ __( 'Expiry (MM)', getTextDomain() ) }
					<span className="required">*</span>
				</label>
				<input
					id={ `${ getPrefix() }-card-expiry-year-${ getSessionId() }` }
					readOnly="readonly"
					className="input-text wc-credit-card-form-card-expiry"
					inputMode="numeric"
					autoComplete="cc-exp"
					autoCorrect="no"
					autoCapitalize="no"
					spellCheck="no"
					type="tel"
					placeholder="YY"
				/>
			</div>
			<div className="form-row form-row-wide">
				<label htmlFor={ `${ getPrefix() }-card-cvc` }>
					{ __( 'Expiry (MM)', getTextDomain() ) }
					<span className="required">*</span>
				</label>
				<input
					id={ `${ getPrefix() }-card-cvc-${ getSessionId() }` }
					readOnly="readonly"
					className="input-text wc-credit-card-form-card-cvc"
					inputMode="numeric"
					autoComplete="off"
					autoCorrect="no"
					autoCapitalize="no"
					spellCheck="no"
					type="tel"
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
		</fieldset>
	);
};
