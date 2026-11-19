// Navigazione indipendente da fotocamera, esposimetro e altri script.
'use strict';
(() => {
  const names = ['meter', 'tools', 'guide'];
  function showPage(page) {
    if (!names.includes(page)) return;
    for (const name of names) {
      const panel = document.getElementById('view-' + name);
      const tab = document.getElementById('tab-' + name);
      if (!panel || !tab) continue;
      panel.hidden = (name !== page);
      tab.classList.toggle('selected', name === page);
      tab.setAttribute('aria-pressed', String(name === page));
    }
    // Evita opzioni scroll non supportate da alcune versioni Safari.
    window.scrollTo(0, 0);
    // La fotocamera resta attiva tra Live e Impostazioni.
    // Non viene fermata passando alla Guida: si può tornare a Live.
  }
  for (const name of names) {
    const tab = document.getElementById('tab-' + name);
    if (tab) tab.addEventListener('click', () => showPage(name));
  }
  window.nikonShowPage = showPage;
  showPage('meter');
})();
