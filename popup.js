(function(){
  'use strict';
  var dot=document.getElementById('statusDot'),statusText=document.getElementById('statusText'),
      statusDetail=document.getElementById('statusDetail'),percentInput=document.getElementById('percentInput'),
      saveBtn=document.getElementById('saveBtn'),INVOICE_RE=/qbo\.intuit\.com\/app\/invoice/i;
  chrome.storage.sync.get({overheadPercent:20},function(d){percentInput.value=d.overheadPercent;});
  function checkStatus(){
    chrome.tabs.query({active:true,currentWindow:true},function(tabs){
      if(!tabs||!tabs[0]){setStatus(false,'No tab','');return;}
      var url=tabs[0].url||'';
      if(INVOICE_RE.test(url)) setStatus(true,'Ready','Invoice page detected');
      else if(url.indexOf('qbo.intuit.com')!==-1) setStatus(false,'Not active','Open an invoice to use');
      else setStatus(false,'Not active','Navigate to QuickBooks');
    });
  }
  function setStatus(a,t,d){
    dot.className='status-dot '+(a?'active':'inactive');
    statusText.className='status-text '+(a?'active':'inactive');
    statusText.textContent=t; statusDetail.textContent=d;
  }
  saveBtn.addEventListener('click',function(){
    var val=parseFloat(percentInput.value);
    if(isNaN(val)||val<=0){percentInput.focus();return;}
    var pct=Math.round(val*10)/10; percentInput.value=pct;
    chrome.storage.sync.set({overheadPercent:pct},function(){
      chrome.tabs.query({active:true,currentWindow:true},function(tabs){
        if(tabs&&tabs[0]) chrome.tabs.sendMessage(tabs[0].id,{type:'OVERHEAD_PERCENT_CHANGED',percent:pct},function(){});
      });
      saveBtn.textContent='Saved!'; saveBtn.classList.add('saved');
      setTimeout(function(){saveBtn.textContent='Save';saveBtn.classList.remove('saved');},1500);
    });
  });
  percentInput.addEventListener('keydown',function(e){if(e.key==='Enter')saveBtn.click();});
  checkStatus(); window.addEventListener('focus',checkStatus);
})();