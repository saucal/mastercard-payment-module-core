function debounce( func, wait, immediate ) {
	let timeout;
	return function () {
		const context = this,
			args = arguments;
		const later = function () {
			timeout = null;
			if ( ! immediate ) func.apply( context, args );
		};
		const callNow = immediate && ! timeout;
		clearTimeout( timeout );
		timeout = setTimeout( later, wait );
		if ( callNow ) func.apply( context, args );
	};
}

function getWcAjaxUrl( method, prefix = core_gateway_params.prefix ) {
	return core_gateway_params.wcAjaxUrl
		.toString()
		.replace( '%%endpoint%%', `${ prefix }_${ method }` );
}

function supportedLogos() {
	return [
		'amex',
		'diners',
		'discover',
		'jcb',
		'laser',
		'maestro',
		'mastercard',
		'paypal',
		'unknown',
		'visa',
	];
}

function getCardLogo( brand ) {
	return supportedLogos().includes( String( brand ).toLowerCase() )
		? String( brand ).toLowerCase()
		: 'unknown';
}

export { debounce, getWcAjaxUrl, supportedLogos, getCardLogo };
