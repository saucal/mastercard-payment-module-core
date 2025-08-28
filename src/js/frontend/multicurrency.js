/* Show currency selector; keep native Place order button intact */
(function($){
  $(document.body).on('checkout_error', function(){
    var $err = $('.woocommerce-error');
    if (!$err.length) return;

    // Only handle our sentinel error
    var txt = $err.text() || '';
    if (txt.indexOf('[ACME_DCC_AVAILABLE]') === -1) return;

    // Avoid duplicate UI
    if ($('#currency_payment_currency_select').length) { $err.remove(); return; }

    // Remove Woo error (we'll render our own notice)
    $err.remove();

    var $form  = $('form.checkout');
    var $place = $form.find('#place_order'); // classic checkout
    if (!$('#payment_currency').length) {
      // Hidden field that will be read on server
      $('<input>', {
        type: 'hidden',
        id: 'payment_currency',
        name: 'payment_currency',
        value: 'USD' // default
      }).appendTo($form);
    }

    // Build EUR label with conversion
    var eurLabel = 'EUR';
    if (window.acmeConversion && window.acmeConversion.amount) {
      // Example: "EUR — Pay 14.65 EUR"
      eurLabel = 'EUR — Pay ' + window.acmeConversion.amount + ' ' + window.acmeConversion.currency;
    }

    var html =
      '<div class="dcc-choice" style="margin-top:12px">' +
      '  <label for="payment_currency_select" style="display:block;margin:6px 0">Currency</label>' +
      '  <select id="payment_currency_select" class="select">' +
      '    <option value="USD">USD — Pay in store currency</option>' +
      '    <option value="EUR">' + eurLabel + '</option>' +
      '  </select>' +
      '  <p style="margin-top:6px;font-size:12px;opacity:.8">Select and click “Place order”.</p>' +
      '</div>';

    // Insert just above the native Place order button (fallback: append to form)
    if ($place.length) {
      $(html).insertBefore($place);
    } else {
      $form.append(html);
    }

    // Sync selection to hidden input
    $(document).off('change.currency').on('change.currency', '#payment_currency_select', function(){
      $('#payment_currency').val(this.value);
    });
  });
})(jQuery);
