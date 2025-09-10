(function($){
  function wcAjaxUrl(endpoint){
    return (window.wc_checkout_params && window.wc_checkout_params.wc_ajax_url)
      ? window.wc_checkout_params.wc_ajax_url.replace('%%endpoint%%', endpoint)
      : '/?wc-ajax=' + endpoint;
  }

  // Intercept Place order: first click probes; second click (with payment_currency set) proceeds
  $(document).on('click', '#place_order', function(e){
    var $form = $('form.checkout');
    var payload = $form.serialize();
    var currencySelect = $('#payment_currency').length

    var $btn = $('#place_order').prop('disabled', true);
    if ($.fn.block) {
      $form.block({ message: null, overlayCSS: { background: '#fff', opacity: 0.6 } });
    }

    $.ajax({
      type: 'POST',
      url: wcAjaxUrl(core_gateway_params.prefix + '_dcc_probe'),
      data: payload,
      dataType: 'json'
    }).done(function(response){
      if(response.data && ! response.data.dcc || currencySelect) {
        $form.submit();
      } else {
        if ($.fn.unblock) { $form.unblock(); }
        $btn.prop('disabled', false);        
            
        var $place = $form.find('#place_order');
        if (!currencySelect) {
          $('<input>', {
            type: 'hidden',
            id: 'payment_currency',
            name: 'payment_currency',
            value: 'USD'
          }).appendTo($form);
        }

        var currencyLabel = window.currencyConversion.currency;
        var currencyAmountFormatted = new Intl.NumberFormat(navigator.language, {
              style: 'currency',
              currency: window.currencyConversion.currency,
              currencyDisplay: 'symbol'
            }).format(window.currencyConversion.amount);

        var html =
          '<div class="dcc-choice" style="margin-top:12px">' +
          '  <label for="payment_currency_select" style="display:block;margin:6px 0">Currency</label>' +
          '  <select id="payment_currency_select" class="select">' +
          '    <option value="USD">USD — Pay in store currency</option>' +
          '    <option value="' + currencyLabel + '">' + currencyLabel + ' — Pay ' + currencyAmountFormatted + '</option>' +
          '  </select>' +
          '  <p style="margin-top:6px;font-size:12px;opacity:.8">Select and click “Place order”.</p>' +
          '</div>';

        if ($place.length) {
          $(html).insertBefore($place);
        } else {
          $form.append(html);
        }

        $(document).off('change.currency').on('change.currency', '#payment_currency_select', function(){
          $('#payment_currency').val(this.value);
        });
      }
    }).fail(function(){
      var $wrapper = $('.woocommerce-notices-wrapper');
      if (!$wrapper.length) { $wrapper = $form; }
      $wrapper.prepend('<ul class="woocommerce-error"><li>Connection error. Please try again.</li></ul>');
      $(document.body).trigger('checkout_error');
    });

    e.preventDefault();
  });
})(jQuery);
