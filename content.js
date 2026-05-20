(function () {
  'use strict';

  var OVERHEAD_LABEL = 'Overhead Fee';
  var TABLE_SEL      = '[class*="txp-capability-itemsTable"]';
  var DIALOG_SEL     = '[role="dialog"]';
  var INVOICE_RE     = /\/app\/invoice/i;

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

  // Set any input/textarea via native setter + fire input+change+blur
  // This updates both DOM value and React internal state
  function setVal(el, val) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA') textareaSetter.call(el, val);
    else inputSetter.call(el, val);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  // Set the Rate field and trigger QBO's amount auto-calculation.
  // Confirmed working sequence (from live event capture):
  //   1. focus the element  (browser tracks the pre-focus value)
  //   2. nativeSetter → 'input' event  (updates React state)
  //   3. 'change' event  (THIS is what QBO listens to for amount recalculation)
  //   4. blur()  (cleans up focus state)
  // No React onBlur/onChange prop calls needed — they cause side-effects.
  function setRate(el, val, cb) {
    if (!el) { if (cb) cb(); return; }
    el.focus();
    setTimeout(function () {
      inputSetter.call(el, val);
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      if (cb) setTimeout(cb, 150);
    }, 60);
  }

  function isRowEmpty(row) {
    var p = getProduct(row), d = getDesc(row);
    return !(p && p.value.trim()) && !(d && d.value.trim());
  }
  function isOverheadRow(row) {
    var d = getDesc(row);
    return d ? d.value.trim() === OVERHEAD_LABEL : false;
  }
  function overheadExists(rows) {
    return rows.some(isOverheadRow);
  }
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

    var base   = calcBase(rows);
    var fee    = parseFloat((base * overheadPercent / 100).toFixed(2));
    var target = getLastEmptyRow(rows);
    if (!target) { alert('No empty row. Please add a new line first.'); return; }

    removeButton(); // hide immediately on click

    // 1. Qty = 1
    var qty = getQty(target);
    if (qty && qty.value !== '1') setVal(qty, '1');

    // 2. Description = "Overhead Fee"
    var desc = getDesc(target);
    if (desc) setVal(desc, OVERHEAD_LABEL);

    // 3. Rate + auto-fill Amount (using confirmed native event sequence)
    setRate(getRate(target), fee.toFixed(2), function () {
      target.classList.add('qb-overhead-row-marked');
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
    if (overheadExists(rows)) return; // no button while overhead row exists
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