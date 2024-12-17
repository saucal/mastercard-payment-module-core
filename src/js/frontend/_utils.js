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

function getWcAjaxUrl( method, prefix = mpgs_gateway_params.prefix ) {
	return mpgs_gateway_params.wcAjaxUrl
		.toString()
		.replace( '%%endpoint%%', `${ prefix }_${ method }` );
}

export { debounce, getWcAjaxUrl };
