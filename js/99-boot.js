/* ══════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', function() {
  loadLocalModules();
  loadFromLocalStorage();
  if (isRestricted()) {
    // A restricted account (e.g. Delta) only ever asks for its own list.
    fetchModulesFromServer().then(function(){ renderAll(); });
  } else {
    fetchOrdersFromServer();
    // Operation comes back inside the ?modules=1 answer — no extra request.
    fetchModulesFromServer().then(function(){ OpsSync.start(); });
  }

  updateSortButtons(); updateArchiveSortButtons();
  updateProductFilterButtons(); updateFilterButtons();
  setStockCat('all'); setStockLoc('all'); setInvoiceFilter('all'); setDeltaView('active');
  setLeadFilter('all'); setCustFilter('all'); setOpsFilter('all');
  renderPageActions('invoice');
  if (isRestricted()) go(homePage());

  // Every table that appears gets its phone labels stamped on.
  labelTableCells(document);
  if (window.MutationObserver) {
    new MutationObserver(function(){ labelTableCells(document); })
      .observe(document.querySelector('.main'), {childList: true, subtree: true});
  }

  // Close modals by clicking the backdrop
  ['confirm-modal','del-modal','tl-modal','edit-modal','price-modal','stock-modal','lead-modal','invoice-modal','import-modal','cust-modal','ops-modal','moto-modal','invmail-modal','setup-modal','install-modal']
    .forEach(function(id) {
      var m = $(id);
      if (m) m.addEventListener('click', function(e){ if (e.target === this) this.classList.remove('open'); });
    });

  // Esc closes whatever is on top
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    if ($('pdf-over').classList.contains('open')) { closePdfViewer(); return; }
    if ($('invpdf-over') && $('invpdf-over').classList.contains('open')) { closeInvoicePdf(); return; }
    var open = document.querySelectorAll('.modal-wrap.open');
    if (open.length) open[open.length-1].classList.remove('open');
  });
});

/* Auto-refresh — but never over the top of unsent work. */
function maybeRefresh() {
  if (document.visibilityState !== 'visible') return;
  if (hasPendingSync()) return;
  if (Date.now() - lastSyncTime < 30000) return;
  if (isRestricted()) { lastSyncTime = Date.now(); fetchModulesFromServer(); return; }
  fetchOrdersFromServer();
}
window.addEventListener('focus', maybeRefresh);
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden') flushPendingSyncs(); else maybeRefresh();
});
setInterval(maybeRefresh, 60000);