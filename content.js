(function () {

  'use strict';

  var TABLE_SEL  = '[class*="txp-capability-itemsTable"]';
  var DIALOG_SEL = '[role="dialog"]';
  var INVOICE_RE = /\/app\/invoice/i;

  var overheadPercent  = 20;
  var mutationObserver = null;
  var debounceTimer    = null;

  var inputSetter    = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,  'value').set;
  var textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;

  function isInvoicePage() { return INVOICE_RE.test(window.location.pathname); }
  function getDialog()     { return document.querySelector(DIALOG_SEL); }
  function getTable(d)     { return d ? d.querySelector(TABLE_SEL) : null; }
  function getDataRows(t)  { return t ? [].slice.call(t.querySelectorAll('tr'), 1) : []; }
  function getDesc(row)    { return row.querySelector('[data-testid="Description_field"],[aria-label*="Description" i]'); }
  function getProduct(row) { return row.querySelector('[aria-label*="Product or service" i]'); }
  function getRate(row)    { return row.querySelector('[aria-label*="Rate" i]'); }
  function getAmount(row)  { return row.querySelector('[aria-label*="Amount" i]'); }
  function getQty(row)     { return row.querySelector('[aria-label*="Quantity" i]'); }

  function parseDollar(s) {
    var v = parseFloat((s || '').replace(/[^0-9.-]/g, ''));
    return isNaN(v) ? 0 : v;
  }

  // Set a textarea/input value and fire events so QBO registers the change.
  // Works for description (textarea) and quantity.
  function setVal(el, val) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA') textareaSetter.call(el, val);
    else inputSetter.call(el, val);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  // Walk up the React fiber tree from `el` and return the Nth ancestor that
  // has an `onChange` prop (counting the element's own onChange as #1).
  function findNthOnChangeProp(el, n) {
    var fk = Object.keys(el).find(function(k) {
      return k.indexOf('__reactFiber') === 0 || k.indexOf('__reactInternalInstance') === 0;
    });
    if (!fk) return null;
    var f = el[fk];
    var depth = 0, count = 0;
    while (f && depth < 40) {
      if (f.memoizedProps && typeof f.memoizedProps.onChange === 'function') {
        count++;
        if (count === n) return f.memoizedProps.onChange;
      }
      f = f.return;
      depth++;
    }
    return null;
  }

  // Set the Rate field by calling QBO's internal commit handler (the 4th onChange
  // ancestor in the fiber tree). This is the only approach that updates QBO's
  // internal line-item state and triggers amount = qty × rate recalculation.
  // The native-event / inputSetter approaches change the DOM but QBO re-renders
  // the field back to 0 because the controlled-component state never updated.
  function setRate(rateEl, val, cb) {
    if (!rateEl) { if (cb) cb(); return; }
    var commitOnChange = findNthOnChangeProp(rateEl, 4);
    if (commitOnChange) {
      commitOnChange(String(val));
      if (cb) setTimeout(cb, 200);
    } else {
      // Fallback: try direct input focus+type if fiber approach fails
      rateEl.focus();
      setTimeout(function () {
        inputSetter.call(rateEl, String(val));
        rateEl.dispatchEvent(new Event('input',  { bubbles: true }));
        rateEl.dispatchEvent(new Event('change', { bubbles: true }));
        rateEl.blur();
        if (cb) setTimeout(cb, 200);
      }, 60);
    }
  }

  // Select the product/service by opening the dropdown like a real user and
  // clicking the matching <li> item. This is the only reliable way to commit
  // the selection — React fiber methods (doSelectItem, widget.onChange) cause
  // re-render races that clear the field.
  //
  // Flow:
  //   1. focus() + click() the input → dropdown opens
  //   2. poll for the <li> item containing `name`
  //   3. .click() the <li> → QBO commits the selection, fills default desc/rate
  //   4. wait 500ms for async fill-in, then call cb to override desc+rate
  function setProduct(productInput, name, cb) {
    if (!productInput) { if (cb) cb(); return; }

    // Open the dropdown
    productInput.focus();
    productInput.click();

    var attempts = 0;
    function pollForItem() {
      var items = document.querySelectorAll('[class*="Menu-menu-item-wrapper"]');
      for (var i = 0; i < items.length; i++) {
        if (items[i].textContent.trim().toLowerCase().indexOf(name.toLowerCase()) !== -1) {
          items[i].click();
          // Wait for QBO to commit the selection and async-fill desc/rate,
          // then let the callback override those values.
          if (cb) setTimeout(cb, 500);
          return;
        }
      }
      if (++attempts < 25) {
        setTimeout(pollForItem, 80);
      } else {
        // Dropdown never appeared or item not found; run cb anyway
        if (cb) cb();
      }
    }
    setTimeout(pollForItem, 80);
  }

  function isRowEmpty(row) {
    var p = getProduct(row), d = getDesc(row);
    return !(p && p.value.trim()) && !(d && d.value.trim());
  }

  function isOverheadRow(row) {
    var d = getDesc(row);
    return d ? /% Overhead Fee$/.test(d.value.trim()) : false;
  }

  function overheadExists(rows) { return rows.some(isOverheadRow); }

  function calcBase(rows) {
    return rows.reduce(function (sum, row) {
      if (isOverheadRow(row)) return sum;
      var a = getAmount(row);
      return sum + (a ? parseDollar(a.value) : 0);
    }, 0);
  }

  function getLastEmptyRow(rows) {
    for (var i = rows.length - 1; i >= 0; i--) {
      if (isRowEmpty(rows[i])) return rows[i];
    }
    return null;
  }

  // ── Button ────────────────────────────────────────────────────────────────────

  function btnHTML() {
    return '<svg viewBox="0 0 16 16" fill="currentColor" style="width:13px;height:13px;flex-shrink:0">'
      + '<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 3.5v2.75h2.75v1.5H8.75v2.75h-1.5V8.75H4.5v-1.5h2.75V4.5h1.5z"/>'
      + '<\/svg> Add Overhead (' + overheadPercent + '%)';
  }

  function injectButton(row) {
    if (!row || row.querySelector('#qb-overhead-btn')) return;
    var cells = row.querySelectorAll('td');
    if (!cells.length) return;
    var cell = cells[cells.length - 1];
    cell.classList.add('qb-overhead-btn-cell');
    var btn = document.createElement('button');
    btn.id        = 'qb-overhead-btn';
    btn.type      = 'button';
    btn.title     = 'Add Overhead Fee (' + overheadPercent + '% of invoice total)';
    btn.innerHTML = btnHTML();
    btn.addEventListener('click', handleClick);
    cell.appendChild(btn);
  }

  function removeButton() {
    var b = document.getElementById('qb-overhead-btn');
    if (b) b.remove();
  }

  // ── Handle Click ──────────────────────────────────────────────────────────────

  function handleClick(e) {
    e.stopPropagation();
    e.preventDefault();

    var dialog = getDialog();
    var table  = getTable(dialog);
    if (!table) return;

    var rows = getDataRows(table);
    if (overheadExists(rows)) { removeButton(); return; }

    var base = calcBase(rows);
    var fee  = parseFloat((base * overheadPercent / 100).toFixed(2));

    var target = e.currentTarget.closest('tr');
    if (!target) { alert('Could not find the row. Please try again.'); return; }

    removeButton();

    // 1. Qty = 1
    var qty = getQty(target);
    if (qty && qty.value !== '1') setVal(qty, '1');

    // 2. Select "Overhead and Fee" from the dropdown via real DOM interaction.
    //    After the <li> click, QBO commits the product and async-fills desc/rate (price=0).
    //    Our callback fires 500ms later to override those values.
    var productInput = getProduct(target);
    setProduct(productInput, 'Overhead and Fee', function () {

      // Re-query the row elements — QBO may have re-rendered the row after product selection
      var rateEl = getRate(target);
      var descEl = getDesc(target);

      // 3. Description
      if (descEl) setVal(descEl, overheadPercent + '% Overhead Fee');

      // 4. Rate — must use the fiber-based commit handler so QBO recalculates amount
      setRate(rateEl, fee.toFixed(2), function () {
        target.classList.add('qb-overhead-row-marked');
      });
    });
  }

  // ── Refresh Button Placement ──────────────────────────────────────────────────

  function refresh() {
    removeButton();
    if (!isInvoicePage()) return;
    var dialog = getDialog();
    var table  = getTable(dialog);
    if (!table) return;
    var rows = getDataRows(table);
    if (overheadExists(rows)) return;
    var target = getLastEmptyRow(rows);
    if (target) injectButton(target);
  }

  // ── Observer ──────────────────────────────────────────────────────────────────

  function startObserver() {
    if (mutationObserver) mutationObserver.disconnect();
    mutationObserver = new MutationObserver(function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refresh, 350);
    });
    var root = getDialog() || document.body;
    mutationObserver.observe(root, { childList: true, subtree: true });
  }

  // ── SPA navigation ────────────────────────────────────────────────────────────

  var lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(init, 1200); }
  }, 800);

  // ── Popup messages ────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === 'OVERHEAD_PERCENT_CHANGED') {
      overheadPercent = msg.percent;
      var btn = document.getElementById('qb-overhead-btn');
      if (btn) {
        btn.title     = 'Add Overhead Fee (' + overheadPercent + '% of invoice total)';
        btn.innerHTML = btnHTML();
        btn.addEventListener('click', handleClick);
      }
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────────

  function init() {
    if (!isInvoicePage()) return;
    chrome.storage.sync.get({ overheadPercent: 20 }, function (data) {
      overheadPercent = data.overheadPercent || 20;
      refresh();
      startObserver();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 1500); });
  } else {
    setTimeout(init, 1500);
  }

})();