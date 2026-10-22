/* Print the current page (or the open details window) on A4 / A3, portrait / landscape. */
(function () {
  'use strict';
  const A = window.APP;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  // printable width in CSS px (96 dpi) with 10 mm margins
  const MM = 96 / 25.4;
  const PAPER = { A4: [210, 297], A3: [297, 420] };
  const LS = 'trd_print';
  let opt = { paper: 'A4', orient: 'landscape', fit: true, color: true };
  try { Object.assign(opt, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { }

  const dlg = document.createElement('div');
  dlg.className = 'modal hidden';
  dlg.id = 'printDlg';
  dlg.innerHTML = `<div class="modal-back"></div><div class="modal-card print-card" role="dialog" aria-modal="true">
    <div class="modal-h"><div><h2>Print</h2><div class="muted" id="prWhat"></div></div><button class="btn ghost" id="prClose" title="Close">✕</button></div>
    <div class="modal-b">
      <div class="pr-row"><span>Paper</span><div class="seg" id="prPaper"><button data-v="A4">A4</button><button data-v="A3">A3</button></div></div>
      <div class="pr-row"><span>Orientation</span><div class="seg" id="prOrient"><button data-v="portrait">Portrait</button><button data-v="landscape">Landscape</button></div></div>
      <div class="pr-row"><span>Options</span><div class="pr-opts">
        <label class="chk"><input type="checkbox" id="prFit"> Shrink wide tables / Gantt to the page width</label>
        <label class="chk"><input type="checkbox" id="prColor"> Print background colours</label></div></div>
      <div class="pr-prev" id="prPrev"><div class="pr-sheet"><i></i><span></span></div></div>
      <p class="muted small">Your browser's print window opens next — choose a printer or <b>Save as PDF</b>. Keep its margins on <b>Default</b> and scale on <b>100%</b>.</p>
      <div class="row-btns"><button class="btn primary" id="prGo">🖨 Print</button><button class="btn ghost" id="prCancel">Cancel</button></div>
    </div></div>`;
  document.body.appendChild(dlg);

  const pageStyle = document.createElement('style');
  pageStyle.id = 'printPage';
  document.head.appendChild(pageStyle);

  function sync() {
    $$('#prPaper button').forEach(b => b.classList.toggle('on', b.dataset.v === opt.paper));
    $$('#prOrient button').forEach(b => b.classList.toggle('on', b.dataset.v === opt.orient));
    $('#prFit').checked = opt.fit; $('#prColor').checked = opt.color;
    const [w, h] = PAPER[opt.paper], land = opt.orient === 'landscape';
    const sh = $('#prPrev .pr-sheet');
    const W = land ? h : w, H = land ? w : h, k = 130 / Math.max(W, H);
    sh.style.width = W * k + 'px'; sh.style.height = H * k + 'px';
    sh.querySelector('span').textContent = `${opt.paper} ${land ? 'landscape' : 'portrait'} · ${W} × ${H} mm`;
    try { localStorage.setItem(LS, JSON.stringify(opt)); } catch (e) { }
  }
  const modalOpen = () => { const m = $$('.modal').find(x => x !== dlg && !x.classList.contains('hidden')); return m || null; };
  function open() {
    const tab = $('.tab.active');
    const m = modalOpen();
    $('#prWhat').textContent = m ? 'Details window: ' + (m.querySelector('#mTitle')?.textContent || '') : 'Page: ' + (tab ? tab.textContent.trim() : '');
    sync();
    dlg.classList.remove('hidden');
  }
  const close = () => dlg.classList.add('hidden');
  dlg.querySelector('.modal-back').onclick = close; $('#prClose').onclick = close; $('#prCancel').onclick = close;
  $$('#prPaper button').forEach(b => b.onclick = () => { opt.paper = b.dataset.v; sync(); });
  $$('#prOrient button').forEach(b => b.onclick = () => { opt.orient = b.dataset.v; sync(); });
  $('#prFit').onchange = e => { opt.fit = e.target.checked; sync(); };
  $('#prColor').onchange = e => { opt.color = e.target.checked; sync(); };

  // header shown only on paper
  const head = document.createElement('div');
  head.id = 'printHead';
  document.body.insertBefore(head, document.body.firstChild);

  let restore = null;
  function prepare() {
    const [w, h] = PAPER[opt.paper], land = opt.orient === 'landscape';
    const pw = Math.floor(((land ? h : w) - 20) * MM);
    pageStyle.textContent = `@page { size: ${opt.paper} ${opt.orient}; margin: 10mm; }`;
    const m = modalOpen();
    const tab = $('.tab.active');
    const root = document.documentElement;
    const wasTheme = root.dataset.theme;
    const dark = wasTheme ? wasTheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    // paper is white: redraw charts in light colours
    if (dark) { root.dataset.theme = 'light'; A.render(); if (tab) A.showTab(tab.dataset.tab); }
    const pills = $$('.topbar .pill').filter(p => !p.classList.contains('hidden')).map(p => p.textContent.trim()).join(' · ');
    head.innerHTML = `<div><b>${A.esc($('#projName').textContent)}</b> — ${A.esc(m ? (m.querySelector('#mTitle')?.textContent || '') : (tab ? tab.textContent.trim() : ''))}</div>
      <div>${A.esc(pills)} · printed ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${opt.paper} ${opt.orient}</div>`;
    document.body.classList.add('printing', 'pr-' + opt.orient, 'pr-' + opt.paper);
    if (m) document.body.classList.add('pr-modal');
    if (!opt.color) document.body.classList.add('pr-nocolor');
    // lay the page out at paper width so charts and grids reflow, then shrink anything still wider
    const target = m ? m.querySelector('.modal-card') : $('main');
    target.style.width = pw + 'px';
    target.style.maxWidth = pw + 'px';
    target.style.boxSizing = 'border-box';
    void target.offsetWidth;   // apply the paper layout now
    const charts = Object.values(Chart.instances || {});
    charts.forEach(c => { try { c.resize(); } catch (e) { } });
    // shrink only the elements that are wider than the paper (tables, Gantt)
    const zoomed = [];
    if (opt.fit) {
      [...target.querySelectorAll('.table-wrap, .gantt')].filter(e => e.offsetParent !== null).forEach(e => {
        const inner = e.firstElementChild;
        const w = Math.max(e.scrollWidth, inner ? inner.scrollWidth : 0), avail = e.clientWidth || pw;
        if (w > avail + 2) { const z = Math.max(.35, avail / w); e.style.zoom = z; e.style.width = Math.ceil(avail / z) + 'px'; zoomed.push(e); }
      });
    }
    restore = () => {
      zoomed.forEach(e => { e.style.zoom = ''; e.style.width = ''; });
      document.body.classList.remove('printing', 'pr-portrait', 'pr-landscape', 'pr-A4', 'pr-A3', 'pr-modal', 'pr-nocolor');
      target.style.width = ''; target.style.maxWidth = ''; target.style.boxSizing = '';
      if (dark) { if (wasTheme) root.dataset.theme = wasTheme; else delete root.dataset.theme; A.render(); if (tab) A.showTab(tab.dataset.tab); }
      Object.values(Chart.instances || {}).forEach(c => { try { c.resize(); } catch (e) { } });
      restore = null;
    };
  }
  $('#prGo').onclick = () => {
    close();
    prepare();
    // let the layout settle before the print snapshot
    setTimeout(() => { window.print(); }, 350);
  };
  window.addEventListener('afterprint', () => { if (restore) setTimeout(restore, 50); });
  // printing from the browser menu (Ctrl+P is caught above) still gets the layout with the last-used paper
  window.addEventListener('beforeprint', () => { if (!restore) prepare(); });

  const btn = document.createElement('button');
  btn.className = 'btn'; btn.id = 'printBtn'; btn.title = 'Print this page (A4 / A3)';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span>Print</span>';
  btn.onclick = open;
  const fs = $('#fsBtn');
  fs.parentNode.insertBefore(btn, fs);
  // a print button inside every details window too
  const mh = $('.modal-card .modal-h #mClose');
  if (mh) { const b2 = document.createElement('button'); b2.className = 'btn ghost'; b2.title = 'Print this window'; b2.innerHTML = '🖨'; b2.onclick = open; mh.parentNode.insertBefore(b2, mh); }
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && !document.body.classList.contains('printing')) { e.preventDefault(); open(); } });
})();
