(function($){
  function wcAjaxUrl(endpoint){
    return (window.wc_checkout_params && window.wc_checkout_params.wc_ajax_url)
      ? window.wc_checkout_params.wc_ajax_url.replace('%%endpoint%%', endpoint)
      : '/?wc-ajax=' + endpoint;
  }

  // Intercept Place order: first click probes; second click (with payment_currency set) proceeds
  $(document).on('click', '#place_order', function(e){
    const $form = $('form.checkout');
    const payload = $form.serialize();
    const hasCurrencySelect = $('#payment_currency').length;

    const $btn = $('#place_order').prop('disabled', true);
    if ($.fn.block) {
      $form.block({ message: null, overlayCSS: { background: '#fff', opacity: 0.6 } });
    }

    $.ajax({
      type: 'POST',
      url: wcAjaxUrl(core_gateway_params.prefix + '_dcc_probe'),
      data: payload,
      dataType: 'json'
    }).done(function(response){
      if(response.data && ! response.data.dcc || hasCurrencySelect) {
        $form.submit();
        return;
      }
      
      if ($.fn.unblock) { $form.unblock(); }
      $btn.prop('disabled', false);        

      var currencyLabel = window.currencyConversion.currency;
      var currencyAmountFormatted = new Intl.NumberFormat(navigator.language, {
            style: 'currency',
            currency: window.currencyConversion.currency,
            currencyDisplay: 'symbol'
          }).format(window.currencyConversion.amount);

      var html =
        '<div>' +
        '  <label for="payment_currency">Currency</label>' +
        '  <select id="payment_currency" name="payment_currency">' +
        '    <option value="USD">' + window.core_dcc_params.optionStore + '</option>' +
        '    <option value="' + currencyLabel + '">' + currencyLabel + ' — ' + window.core_dcc_params.actionText + ' ' + currencyAmountFormatted + '</option>' +
        '  </select>' +
        '  <small>' + window.core_dcc_params.helpText + '</small>' +
        '</div>';

      $(html).insertBefore($btn);
      $($btn).text(window.core_dcc_params.actionText);
    }).fail(function(){
      const $wrapper = $('.woocommerce-notices-wrapper').length ? $('.woocommerce-notices-wrapper') : $form;
      $wrapper.prepend('<ul class="woocommerce-error"><li>Connection error. Please try again.</li></ul>');
      $(document.body).trigger('checkout_error');
    });

    e.preventDefault();
  });
})(jQuery);
