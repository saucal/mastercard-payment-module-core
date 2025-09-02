(function($){
  $(document.body).on('checkout_error', function(){
    var $err = $('.woocommerce-error');
    var txt = $err.text() || '';

    if (!$err.length) return;    
    if (txt.indexOf('[DCC_AVAILABLE]') === -1) return;
    if ($('#currency_payment_currency_select').length) { $err.remove(); return; }

    $err.remove();

    var $form  = $('form.checkout');
    var $place = $form.find('#place_order');
    if (!$('#payment_currency').length) {
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
  });
})(jQuery);
