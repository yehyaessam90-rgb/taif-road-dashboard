/* Junctions media — weekly PowerPoint updates (rendered as slides, every week kept) and daily site photos per junction.
   Published: data/junctions/index.json + data/junctions/weekly/<date>.pptx + data/junctions/daily/<date>/<key>/<n>.jpg (+ _t thumbnails).
   The owner adds weeks / photos from the Import tab (kept in this browser), then publishes them to GitHub in one commit
   (with the owner's own token, stored only in that browser) or downloads them as a zip for manual upload. */
(function () {
  'use strict';
  const A = window.APP, SX = window.SCHEDX;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = A.esc;
  const DAY = 864e5;
  const KEYS = ['J7', 'J5', 'J3', 'J1'], KNAME = { overview: 'Overview', J7: 'Junction 7', J5: 'Junction 5', J3: 'Junction 3', J1: 'Junction 1', general: 'General' };
  const BASE = 'data/junctions/';
  const RENDERER = 'assets/vendor/pptx-renderer/pptx-renderer.browser.es.js';

  // ---------------- dates ----------------
  const pd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const fd = s => { const t = pd(s); return t === null ? '—' : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  const fdw = s => { const t = pd(s); return t === null ? '—' : new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  const iso = d => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
  const mb = n => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB';

  // ---------------- local store (IndexedDB) ----------------
  const DB = 'trd_jmedia';
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('files'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (store, mode, fn) => { try { const d = await idb(); return await new Promise(res => { const t = d.transaction(store, mode), q = fn(t.objectStore(store)); t.oncomplete = () => res(q && q.result); t.onerror = () => res(null); }); } catch (e) { return null; } };
  const kvGet = k => tx('kv', 'readonly', s => s.get(k));
  const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));
  const fileGet = p => tx('files', 'readonly', s => s.get(p));
  const fileSet = (p, b) => tx('files', 'readwrite', s => s.put(b, p));
  const fileDel = p => tx('files', 'readwrite', s => s.delete(p));

  // ---------------- index ----------------
  /* index: { v, rev, weeks: [{ date, file, name, size, slides: [{ n, key, title, plan, act }] }], daily: [{ date, key, photos: [{ file, thumb, size, w, h, cap }] }] }
     local: { ops: [...] } replayed on top of the published index until published */
  let PUB = { v: 1, rev: 0, weeks: [], daily: [] }, OPS = [], IDX = PUB, SEL = null, LOADED = false;
  const clone = o => JSON.parse(JSON.stringify(o));
  function apply(base, ops) {
    const x = clone(base);
    ops.forEach(o => {
      if (o.op === 'addWeek') { x.weeks = x.weeks.filter(w => w.date !== o.week.date); x.weeks.push(o.week); }
      else if (o.op === 'delWeek') x.weeks = x.weeks.filter(w => w.date !== o.date);
      else if (o.op === 'addPhotos') { let g = x.daily.find(d => d.date === o.date && d.key === o.key); if (!g) x.daily.push(g = { date: o.date, key: o.key, photos: [] }); o.photos.forEach(p => { if (!g.photos.some(q => q.file === p.file)) g.photos.push(p); }); }
      else if (o.op === 'delPhoto') x.daily.forEach(g => { g.photos = g.photos.filter(p => p.file !== o.file); });
      else if (o.op === 'movePhoto') {
        let p = null;
        x.daily.forEach(g => { const i = g.photos.findIndex(q => q.file === o.file); if (i >= 0) p = g.photos.splice(i, 1)[0]; });
        if (p) { let g = x.daily.find(d => d.date === o.date && d.key === o.key); if (!g) x.daily.push(g = { date: o.date, key: o.key, photos: [] }); g.photos.push(p); }
      }
    });
    x.daily = x.daily.filter(g => g.photos.length);
    x.weeks.sort((a, b) => b.date.localeCompare(a.date));
    x.daily.sort((a, b) => b.date.localeCompare(a.date) || KEYS.indexOf(a.key) - KEYS.indexOf(b.key));
    return x;
  }
  const pendingFiles = () => {
    const keep = new Set();
    IDX.weeks.forEach(w => keep.add(w.file)); IDX.daily.forEach(g => g.photos.forEach(p => { keep.add(p.file); keep.add(p.thumb); }));
    const out = [];
    OPS.forEach(o => { if (o.op === 'addWeek' && keep.has(o.week.file)) out.push(o.week.file); if (o.op === 'addPhotos') o.photos.forEach(p => { if (keep.has(p.file)) out.push(p.file, p.thumb); }); });
    return [...new Set(out)];
  };
  async function load() {
    try { const r = await fetch(BASE + 'index.json', { cache: 'no-store' }); if (r.ok) PUB = await r.json(); } catch (e) { }
    const st = await kvGet('state');
    OPS = st && st.ops ? st.ops : [];
    // additions already on the site (published from another browser or by hand) are not pending any more
    const onSite = new Set(); PUB.weeks.forEach(w => onSite.add(w.file)); PUB.daily.forEach(g => g.photos.forEach(p => onSite.add(p.file)));
    const n0 = OPS.length;
    OPS = OPS.filter(o => !(o.op === 'addPhotos' && o.photos.every(p => onSite.has(p.file))) && !(o.op === 'addWeek' && PUB.weeks.some(w => w.file === o.week.file && w.size === o.week.size)));
    if (OPS.length !== n0) await kvSet('state', { ops: OPS });
    // a publish made in this browser may not be live on GitHub Pages yet
    const just = await kvGet('published');
    if (just && just.rev > (PUB.rev || 0)) PUB = just;
    IDX = apply(PUB, OPS);
    if (!SEL || !IDX.weeks.some(w => w.date === SEL)) SEL = IDX.weeks[0] ? IDX.weeks[0].date : null;
    LOADED = true;
    if (SX && SX.renderJunctions) SX.renderJunctions(); else decorate();
    renderImport();
  }
  async function saveOps() { await kvSet('state', { ops: OPS }); if (window.PUBLISHER) PUBLISHER.changed(); IDX = apply(PUB, OPS); if (!IDX.weeks.some(w => w.date === SEL)) SEL = IDX.weeks[0] ? IDX.weeks[0].date : null; }

  // file contents: unpublished ones come from this browser
  const URLS = {};
  async function fileUrl(path) {
    if (URLS[path]) return URLS[path];
    const b = await fileGet(path);
    return (URLS[path] = b ? URL.createObjectURL(b) : path);
  }
  async function fileBuf(path) {
    const b = await fileGet(path);
    if (b) return b.arrayBuffer();
    const r = await fetch(path); if (!r.ok) throw new Error('Cannot load ' + path + ' (' + r.status + ')');
    return r.arrayBuffer();
  }

  // ---------------- PowerPoint ----------------
  let LIB = null;
  const lib = () => LIB || (LIB = import(new URL(RENDERER, document.baseURI).href));
  const DECKS = {};   // date → Promise<{ viewer, host }>
  function deck(date) {
    if (DECKS[date]) return DECKS[date];
    const w = IDX.weeks.find(x => x.date === date);
    return (DECKS[date] = (async () => {
      const L = await lib(), buf = await fileBuf(w.file);
      const host = document.createElement('div'); host.className = 'jm-offscreen';
      document.body.appendChild(host);
      const viewer = await L.PptxViewer.open(buf, host, { renderMode: 'slide', zipLimits: L.RECOMMENDED_ZIP_LIMITS, fitMode: 'contain' });
      return { viewer, host, L, buf };
    })().catch(e => { delete DECKS[date]; throw e; }));
  }
  // slide texts → junction of each slide, status date and the planned / actual tiles
  async function parseDeck(buf) {
    const z = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' });
    const get = p => { const i = z.FullPaths.findIndex(x => x.endsWith('/' + p)); return i < 0 ? null : new TextDecoder().decode(z.FileIndex[i].content); };
    const xml = s => new DOMParser().parseFromString(s, 'application/xml');
    const pres = xml(get('ppt/presentation.xml')), rels = xml(get('ppt/_rels/presentation.xml.rels'));
    const tgt = {}; [...rels.getElementsByTagName('Relationship')].forEach(r => { tgt[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const ids = [...pres.getElementsByTagNameNS('*', 'sldId')].map(s => s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    let status = null;
    const slides = ids.map((rid, i) => {
      const d = xml(get('ppt/' + tgt[rid].replace(/^\//, '').replace(/^ppt\//, '')) || '<x/>');
      const shapes = [...d.getElementsByTagNameNS('*', 'sp')].map(sp => {
        const t = [...sp.getElementsByTagNameNS('*', 'p')].map(p => [...p.getElementsByTagNameNS('*', 't')].map(n => n.textContent).join('')).filter(s => s.trim()).join('\n').trim();
        const off = sp.getElementsByTagNameNS('*', 'off')[0];
        return { t, x: off ? +off.getAttribute('x') : 0, y: off ? +off.getAttribute('y') : 0 };
      }).filter(s => s.t);
      const all = shapes.map(s => s.t).join('\n');
      const st = /STATUS\s+(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})/i.exec(all);
      if (st && !status) { const t = Date.parse(`${st[1]} ${st[2]} ${st[3]} UTC`); if (!isNaN(t)) status = new Date(t).toISOString().slice(0, 10); }
      const jm = /Junction[\s\-_]*0?([1357])\b/i.exec(all);
      const key = jm ? 'J' + jm[1] : i === 0 ? 'overview' : '';
      const pct = lbl => {
        // overlapping shapes: the last one drawn is the one visible on the slide
        const L = shapes.filter(s => lbl.test(s.t)).pop(); if (!L) return null;
        const c = shapes.map((s, i) => Object.assign({ i }, s)).filter(s => /^\s*\d{1,3}(\.\d+)?\s*%\s*$/.test(s.t) && s.y < L.y && L.y - s.y < 1500000).sort((a, b) => (Math.abs(a.x - L.x) + (L.y - a.y)) - (Math.abs(b.x - L.x) + (L.y - b.y)) || b.i - a.i)[0];
        return c ? parseFloat(c.t) : null;
      };
      const title = (shapes.find(s => /Junction|Dashboard/i.test(s.t) && s.t.length < 120 && /Junction/i.test(s.t)) || shapes[0] || { t: '' }).t.split('\n')[0];
      return { n: i + 1, key, title, plan: pct(/^(OVERALL\s+JUNCTIONS\s+)?PLAN(NED)?\s*$/i), act: pct(/^(OVERALL\s+JUNCTIONS\s+)?ACTUAL\s*$/i) };
    });
    return { status, slides };
  }

  // the site is public: drop the author / last-editor names (and comment authors) kept inside the file
  function scrubDeck(buf) {
    const z = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' });
    let changed = false;
    z.FullPaths.forEach((p, i) => {
      const e = z.FileIndex[i];
      if (/\/docProps\/core\.xml$/.test(p) && e.content) {
        const x = new TextDecoder().decode(e.content), y = x.replace(/<dc:creator>[^<]*<\/dc:creator>/, '<dc:creator></dc:creator>').replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy></cp:lastModifiedBy>');
        if (y !== x) { e.content = new TextEncoder().encode(y); e.size = e.content.length; changed = true; }
      }
      if (/\/ppt\/commentAuthors\.xml$/.test(p) && e.content) {
        const x = new TextDecoder().decode(e.content), y = x.replace(/ name="[^"]*"/g, ' name="Author"').replace(/ initials="[^"]*"/g, ' initials="A"');
        if (y !== x) { e.content = new TextEncoder().encode(y); e.size = e.content.length; changed = true; }
      }
    });
    return changed ? XLSX.CFB.write(z, { fileType: 'zip', type: 'array', compression: true }) : buf;
  }

  // ---------------- Junctions page ----------------
  const week = () => IDX.weeks.find(w => w.date === SEL);
  const has = () => LOADED && IDX.weeks.length > 0;
  let VIEW = null;   // { date, idx }
  function topHtml() {
    const w = week();
    const prev = w ? IDX.weeks[IDX.weeks.findIndex(x => x.date === w.date) + 1] : null;
    const daysAll = IDX.daily;
    const tile = s => {
      if (!s) return '';
      const p = prev && prev.slides.find(x => x.key === s.key), dA = p && p.act !== null && s.act !== null ? s.act - p.act : null;
      return `<div class="jm-tile click" data-jm-go="${s.n - 1}"><span>${esc(KNAME[s.key] || 'Slide ' + s.n)}</span><b>${s.act !== null ? s.act.toFixed(2) + '%' : '—'}</b><em>planned ${s.plan !== null ? s.plan.toFixed(2) + '%' : '—'}${dA !== null ? ` · <i class="${dA >= 0 ? 'pos' : 'neg'}">${dA >= 0 ? '+' : ''}${dA.toFixed(2)}% vs ${fd(prev.date).slice(0, 6)}</i>` : ''}</em></div>`;
    };
    const order = ['overview', ...KEYS];
    const tiles = w ? order.map(k => tile(w.slides.find(s => s.key === k))).join('') : '';
    return `<div class="card jm-week">
      <div class="card-h"><h3>Weekly update</h3>
        <div class="jm-sel"><label class="muted small">Week</label><select id="jmWeek">${IDX.weeks.map(x => `<option value="${x.date}" ${x.date === SEL ? 'selected' : ''}>Status ${fd(x.date)}${x === IDX.weeks[0] ? ' (latest)' : ''}</option>`).join('')}</select>
        <span class="muted small">${IDX.weeks.length} week${IDX.weeks.length === 1 ? '' : 's'} kept</span></div></div>
      <div class="jm-tiles">${tiles}</div>
      <div class="jm-main">
        <div class="jm-deck-col">
          <div class="jm-bar"><button class="btn" id="jmPrev" title="Previous slide">◀</button><span id="jmPos" class="muted small">Loading presentation…</span><button class="btn" id="jmNext" title="Next slide">▶</button>
            <div class="seg" id="jmJump">${w ? order.map(k => { const s = w.slides.find(x => x.key === k); return s ? `<button data-jm-go="${s.n - 1}">${k === 'overview' ? 'Overview' : k}</button>` : ''; }).join('') : ''}</div>
            <button class="btn ghost" id="jmFull" title="Full screen">⛶</button><a class="btn ghost" id="jmDl" href="#" title="Download the PowerPoint">⬇ .pptx</a></div>
          <div class="jm-deck" id="jmDeck"></div>
        </div>
        <div class="jm-daily-col">
          <div class="jm-dh"><h4>Daily photos</h4><div class="seg" id="jmDK"><button data-k="" class="on">All</button>${KEYS.map(k => `<button data-k="${k}">${k}</button>`).join('')}</div></div>
          <div id="jmDays">${daysList('')}</div>
        </div>
      </div>
      ${IDX.weeks.length > 1 ? historyTable() : ''}
    </div>`;
  }
  function daysList(key) {
    const groups = IDX.daily.filter(g => !key || g.key === key);
    if (!groups.length) return `<p class="muted small">No daily photos${key ? ' for ' + KNAME[key] : ''} yet.</p>`;
    const byDate = {};
    groups.forEach(g => { (byDate[g.date] = byDate[g.date] || []).push(g); });
    return Object.keys(byDate).sort().reverse().slice(0, 30).map(d => {
      const gs = byDate[d], n = gs.reduce((s, g) => s + g.photos.length, 0);
      const th = gs.flatMap(g => g.photos.map(p => p.thumb)).slice(0, 4);
      return `<div class="jm-day click" data-jm-day="${d}" data-jm-key="${key}"><div class="jm-dd"><b>${fd(d)}</b><span class="muted small">${new Date(pd(d)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })} · ${n} photo${n === 1 ? '' : 's'} · ${gs.map(g => g.key).join(', ')}</span></div>
        <div class="jm-th">${th.map(t => `<img data-jm-src="${esc(t)}" alt="" loading="lazy">`).join('')}</div></div>`;
    }).join('');
  }
  function historyTable() {
    const ws = IDX.weeks.slice(0, 12);
    const row = k => `<tr><td><b>${esc(KNAME[k])}</b></td>${ws.map(w => { const s = w.slides.find(x => x.key === k); return `<td class="n ${w.date === SEL ? 'jm-cur' : ''}">${s && s.act !== null ? s.act.toFixed(2) + '%' : '—'}<div class="muted small">${s && s.plan !== null ? 'pl ' + s.plan.toFixed(2) + '%' : ''}</div></td>`; }).join('')}</tr>`;
    return `<details class="jm-hist"><summary><b>Progress by week</b> <span class="muted small">actual · planned, from each weekly presentation</span></summary>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Status</th>${ws.map(w => `<th class="n click ${w.date === SEL ? 'jm-cur' : ''}" data-jm-week="${w.date}">${fd(w.date)}</th>`).join('')}</tr></thead><tbody>${['overview', ...KEYS].map(row).join('')}</tbody></table></div></details>`;
  }
  async function fillImgs(root) {
    for (const im of root.querySelectorAll('img[data-jm-src]')) { im.src = await fileUrl(im.dataset.jmSrc); im.removeAttribute('data-jm-src'); }
  }
  // Called by schedule.js after the Junctions page renders
  function decorate() {
    const top = $('#jmTop');
    if (!top) return;
    if (!has()) { top.innerHTML = LOADED && IDX.daily.length ? `<div class="card jm-week"><div class="card-h"><h3>Daily photos</h3></div><div id="jmDays">${daysList('')}</div></div>` : ''; if (top.innerHTML) fillImgs(top); return; }
    top.innerHTML = topHtml();
    const w = week();
    $('#jmWeek').onchange = e => { SEL = e.target.value; VIEW = null; SX.renderJunctions(); };
    $$('#jmDK button').forEach(b => b.onclick = () => { $$('#jmDK button').forEach(x => x.classList.toggle('on', x === b)); $('#jmDays').innerHTML = daysList(b.dataset.k); fillImgs($('#jmDays')); });
    $('#jmDl').onclick = async e => { e.preventDefault(); const a = document.createElement('a'); a.href = await fileUrl(w.file); a.download = w.name || (w.date + '.pptx'); a.click(); };
    $('#jmFull').onclick = () => { const el = $('.jm-deck-col'); (el.requestFullscreen || el.webkitRequestFullscreen).call(el); };
    fillImgs(top);
    showDeck(w.date, VIEW && VIEW.date === w.date ? VIEW.idx : 0);
    // junction cards: this week's slide of each junction
    $$('.jm-slot').forEach(async el => {
      const k = el.dataset.jmKey, s = w.slides.find(x => x.key === k), cnt = IDX.daily.filter(g => g.key === k).reduce((n, g) => n + g.photos.length, 0);
      const days = IDX.daily.filter(g => g.key === k).length;
      el.innerHTML = `${s ? `<div class="jm-thumb click" data-jm-go="${s.n - 1}" title="Open this slide in the weekly presentation"></div>` : `<div class="jm-thumb empty muted">No slide for ${esc(KNAME[k])} in this week's presentation</div>`}
        <div class="jm-slot-f"><span class="muted small">Weekly update · status ${fd(w.date)}${s && s.act !== null ? ` · actual ${s.act.toFixed(2)}% / planned ${s.plan !== null ? s.plan.toFixed(2) + '%' : '—'}` : ''}</span>
        <button class="btn ghost" data-jm-daily="${k}">📷 Daily photos${cnt ? ` · ${days} day${days === 1 ? '' : 's'}, ${cnt}` : ''}</button></div>`;
      if (!s) return;
      try {
        const D = await deck(w.date), box = el.querySelector('.jm-thumb');
        if (!box || !box.isConnected) return;
        D.viewer.renderThumbnailToContainer(s.n - 1, box, { width: Math.max(240, box.clientWidth || 600) });
      } catch (e) { el.querySelector('.jm-thumb').textContent = 'Could not render the slide: ' + e.message; }
    });
  }
  async function showDeck(date, idx) {
    const host = $('#jmDeck');
    if (!host) return;
    VIEW = { date, idx };
    try {
      const D = await deck(date);
      if (!host.isConnected || !VIEW || VIEW.date !== date) return;
      // the deck's own viewer lives off-screen; move it into the page
      host.innerHTML = ''; host.appendChild(D.host); D.host.className = 'jm-deck-in';
      await D.viewer.goToSlide(idx);
      const n = D.viewer.slideCount;
      const pos = () => { $('#jmPos').textContent = `Slide ${VIEW.idx + 1} / ${n}`; $$('#jmJump button').forEach(b => b.classList.toggle('on', +b.dataset.jmGo === VIEW.idx)); };
      pos();
      $('#jmPrev').onclick = async () => { if (VIEW.idx > 0) { VIEW.idx--; await D.viewer.goToSlide(VIEW.idx); pos(); } };
      $('#jmNext').onclick = async () => { if (VIEW.idx < n - 1) { VIEW.idx++; await D.viewer.goToSlide(VIEW.idx); pos(); } };
      VIEW.pos = pos;
    } catch (e) { host.innerHTML = `<div class="muted">Could not open the presentation: ${esc(e.message)}</div>`; }
  }
  document.addEventListener('click', async e => {
    const g = e.target.closest('[data-jm-go]');
    if (g && $('#jmDeck')) {
      e.stopPropagation();
      const D = await deck(SEL); VIEW.idx = +g.dataset.jmGo; await D.viewer.goToSlide(VIEW.idx); VIEW.pos && VIEW.pos();
      if (!g.closest('.jm-week')) $('#jmDeck').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const wk = e.target.closest('[data-jm-week]');
    if (wk) { SEL = wk.dataset.jmWeek; VIEW = null; SX.renderJunctions(); return; }
    const dk = e.target.closest('[data-jm-daily]');
    if (dk) { e.stopPropagation(); openDaily(dk.dataset.jmDaily); return; }
    const dy = e.target.closest('[data-jm-day]');
    if (dy) { e.stopPropagation(); openDaily(dy.dataset.jmKey || '', dy.dataset.jmDay); return; }
    const pdl = e.target.closest('[data-jm-pdel]');
    if (pdl) { e.stopPropagation(); if (confirm('Delete this photo from the platform?')) { await removePhotos([pdl.dataset.jmPdel]); A.Details.close ? A.Details.close() : document.querySelector('#mClose').click(); } return; }
    const pmv = e.target.closest('[data-jm-pmove]');
    if (pmv) { e.stopPropagation(); const [f, k, d] = pmv.dataset.jmPmove.split('|'); await movePhotos([f], k, d); document.querySelector('#mClose').click(); return; }
    const ph = e.target.closest('[data-jm-photo]');
    if (ph) { e.stopPropagation(); const [k, d, i] = ph.dataset.jmPhoto.split('|'); openPhoto(k, d, +i); }
  }, true);
  document.addEventListener('keydown', e => {
    if (!$('#jmDeck') || !VIEW || !VIEW.pos || document.querySelector('.modal:not(.hidden)') || /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') $('#jmNext').click(); else if (e.key === 'ArrowLeft') $('#jmPrev').click();
  });

  // daily photos of one junction (or all), one group per day
  function photoList(key, date) { return IDX.daily.filter(g => (!key || g.key === key) && (!date || g.date === date)); }
  function openDaily(key, date) {
    A.Details.open(() => {
      const groups = photoList(key, null), byDate = {};
      groups.forEach(g => { (byDate[g.date] = byDate[g.date] || []).push(g); });
      const dates = Object.keys(byDate).sort().reverse();
      const n = groups.reduce((s, g) => s + g.photos.length, 0);
      setTimeout(() => { fillImgs($('#mBody')); if (date) { const el = $('#mBody [data-jm-dsec="' + date + '"]'); if (el) el.scrollIntoView({ block: 'start' }); } }, 0);
      return {
        title: (key ? esc(KNAME[key]) : 'All junctions') + ' — daily photos', sub: `${dates.length} day${dates.length === 1 ? '' : 's'} · ${n} photo${n === 1 ? '' : 's'}${IDX.weeks[0] ? ' · latest weekly update ' + fd(IDX.weeks[0].date) : ''}`,
        body: dates.length ? `<div class="jm-dnav">${dates.map(d => `<a class="chip" href="#" onclick="document.querySelector('[data-jm-dsec=&quot;${d}&quot;]').scrollIntoView({block:'start'});return false">${fd(d).slice(0, 6)}</a>`).join('')}</div>` + dates.map(d => `<section class="jm-dsec" data-jm-dsec="${d}"><h4 class="dsec">${fdw(d)}</h4>${byDate[d].map(g => `${key ? '' : `<div class="muted small jm-gk">${esc(KNAME[g.key] || g.key)}</div>`}<div class="jm-grid">${g.photos.map((p, i) => `<figure class="click" data-jm-photo="${g.key}|${g.date}|${i}"><img data-jm-src="${esc(p.thumb)}" alt="" loading="lazy">${p.cap ? `<figcaption>${esc(p.cap)}</figcaption>` : ''}</figure>`).join('')}</div>`).join('')}</section>`).join('')
          : '<p class="muted">No daily photos yet.</p>'
      };
    });
  }
  function openPhoto(key, date, i) {
    const g = IDX.daily.find(x => x.key === key && x.date === date);
    if (!g) return;
    const p = g.photos[i];
    A.Details.open(() => {
      setTimeout(() => fillImgs($('#mBody')), 0);
      return { title: `${esc(KNAME[key] || key)} · ${fdw(date)}`, sub: `Photo ${i + 1} of ${g.photos.length}${p.cap ? ' · ' + esc(p.cap) : ''}`,
        body: `<img class="wk-full" data-jm-src="${esc(p.file)}" alt=""><div class="row-btns" style="justify-content:center">${i > 0 ? `<button class="btn" data-jm-photo="${key}|${date}|${i - 1}">◀ Previous</button>` : ''}${i < g.photos.length - 1 ? `<button class="btn" data-jm-photo="${key}|${date}|${i + 1}">Next ▶</button>` : ''}</div>
          <div class="row-btns admin-only jm-adm" style="justify-content:center"><button class="btn danger" data-jm-pdel="${esc(p.file)}">🗑 Delete this photo</button><span class="muted small">move to</span>${[...KEYS, 'general'].filter(k => k !== key).map(k => `<button class="btn ghost" data-jm-pmove="${esc(p.file)}|${k}|${date}">${k === 'general' ? 'General' : k}</button>`).join('')}</div>` };
    });
  }

  // ---------------- import (owner) ----------------
  async function resize(file, max, q) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    return { blob, w: c.width, h: c.height };
  }
  let PEND = null;   // parsed weekly deck waiting for confirmation
  // ---- manage (delete / move) ----
  const MF = { date: '', key: '', sel: new Set() };
  const isPending = f => pendingFiles().includes(f);
  function manageHtml() {
    const dates = [...new Set(IDX.daily.map(g => g.date))];
    if (!dates.length) return '<p class="muted small">No photos yet.</p>';
    if (!MF.date || !dates.includes(MF.date)) MF.date = dates[0];
    const groups = IDX.daily.filter(g => g.date === MF.date && (!MF.key || g.key === MF.key));
    const pend = new Set(pendingFiles());
    return `<div class="ev-form">
        <label class="cut-f">Day<select id="jmMDate">${dates.map(d => `<option value="${d}" ${d === MF.date ? 'selected' : ''}>${fd(d)} · ${IDX.daily.filter(g => g.date === d).reduce((n, g) => n + g.photos.length, 0)} photos</option>`).join('')}</select></label>
        <label class="cut-f">Junction<select id="jmMKey"><option value="">All</option>${[...KEYS, 'general'].map(k => `<option value="${k}" ${k === MF.key ? 'selected' : ''}>${KNAME[k]}</option>`).join('')}</select></label>
      </div>
      ${groups.map(g => `<div class="jm-gk">${esc(KNAME[g.key] || g.key)} · ${g.photos.length} photo${g.photos.length === 1 ? '' : 's'} <button class="btn ghost" data-jm-mall="${g.key}">select all</button></div>
        <div class="jm-mgrid">${g.photos.map(p => `<label class="jm-mph ${MF.sel.has(p.file) ? 'on' : ''}"><input type="checkbox" data-jm-msel="${esc(p.file)}" ${MF.sel.has(p.file) ? 'checked' : ''}><img data-jm-src="${esc(p.thumb)}" alt=""><span>${esc(p.name || p.file.split('/').pop())}${pend.has(p.file) ? ' · <b class="neg">not published</b>' : ''}</span></label>`).join('')}</div>`).join('') || '<p class="muted small">No photos for this filter.</p>'}
      <div class="row-btns jm-mact"><b id="jmMCount">${MF.sel.size} selected</b>
        <button class="btn danger" id="jmMDel" ${MF.sel.size ? '' : 'disabled'}>🗑 Delete selected</button>
        <span class="muted small">or move them to</span><select id="jmMToK">${[...KEYS, 'general'].map(k => `<option value="${k}">${KNAME[k]}</option>`).join('')}</select><input type="date" id="jmMToD" value="${MF.date}">
        <button class="btn" id="jmMMove" ${MF.sel.size ? '' : 'disabled'}>↪ Move selected</button></div>`;
  }
  function wireManage() {
    const host = $('#jmManage'); if (!host) return;
    fillImgs(host);
    const re = () => { host.innerHTML = manageHtml(); wireManage(); };
    const d = $('#jmMDate'), k = $('#jmMKey');
    if (d) d.onchange = () => { MF.date = d.value; MF.sel.clear(); re(); };
    if (k) k.onchange = () => { MF.key = k.value; MF.sel.clear(); re(); };
    host.querySelectorAll('[data-jm-msel]').forEach(c => c.onchange = () => { c.checked ? MF.sel.add(c.dataset.jmMsel) : MF.sel.delete(c.dataset.jmMsel); c.closest('label').classList.toggle('on', c.checked); $('#jmMCount').textContent = MF.sel.size + ' selected'; $('#jmMDel').disabled = $('#jmMMove').disabled = !MF.sel.size; });
    host.querySelectorAll('[data-jm-mall]').forEach(b => b.onclick = () => { const g = IDX.daily.find(x => x.date === MF.date && x.key === b.dataset.jmMall); g.photos.forEach(p => MF.sel.add(p.file)); re(); });
    if ($('#jmMDel')) $('#jmMDel').onclick = async () => { if (!confirm(`Delete ${MF.sel.size} photo(s) from the platform?`)) return; const l = [...MF.sel]; MF.sel.clear(); await removePhotos(l); };
    if ($('#jmMMove')) $('#jmMMove').onclick = async () => { const to = $('#jmMToK').value, td = $('#jmMToD').value || MF.date; const l = [...MF.sel]; MF.sel.clear(); MF.key = to; MF.date = td; await movePhotos(l, to, td); };
  }
  const photoOf = f => { for (const g of IDX.daily) { const p = g.photos.find(q => q.file === f); if (p) return p; } return null; };
  async function removePhotos(files) {
    for (const f of files) {
      const p = photoOf(f); if (!p) continue;
      if (isPending(f)) { await fileDel(p.file); await fileDel(p.thumb); }
      OPS.push({ op: 'delPhoto', file: f });
    }
    await saveOps(); refresh();
    $('#jmPubMsg').innerHTML = `✓ ${files.length} photo${files.length === 1 ? '' : 's'} removed. <b>Publish</b> to remove ${files.length === 1 ? 'it' : 'them'} from the site for everyone.`;
  }
  async function movePhotos(files, key, date) {
    files.forEach(f => OPS.push({ op: 'movePhoto', file: f, key, date }));
    await saveOps(); refresh();
    $('#jmPubMsg').innerHTML = `✓ ${files.length} photo${files.length === 1 ? '' : 's'} moved to ${esc(KNAME[key])} · ${fd(date)}. <b>Publish</b> to apply it for everyone.`;
  }
  function renderImport() {
    const host = $('#jmImport');
    if (!host || !LOADED) return;
    const pf = pendingFiles();
    const photos = IDX.daily.reduce((s, g) => s + g.photos.length, 0), pSize = IDX.daily.reduce((s, g) => s + g.photos.reduce((t, p) => t + (p.size || 0), 0), 0), wSize = IDX.weeks.reduce((s, w) => s + (w.size || 0), 0);
    const tok = (() => { try { return localStorage.getItem('trd_gh_token') || ''; } catch (e) { return ''; } })();
    host.innerHTML = `
      <h4 class="dsec">A · Weekly update (PowerPoint)</h4>
      <label class="drop" id="jmDropW"><input type="file" id="jmFileW" accept=".pptx"><span class="drop-ic">▣</span><span><b>Drop the weekly Junctions presentation (.pptx)</b> or click to browse</span><span class="muted small">Every week is kept — the newest is shown first on the Junctions page</span></label>
      <div id="jmPend"></div>
      ${IDX.weeks.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Status date</th><th>File</th><th class="n">Slides</th><th class="n">Size</th><th></th></tr></thead><tbody>${IDX.weeks.map(w => `<tr><td><b>${fd(w.date)}</b>${pf.includes(w.file) ? ' <span class="status warn">not published</span>' : ''}</td><td class="small">${esc(w.name || '')}</td><td class="n">${w.slides.length}</td><td class="n">${mb(w.size || 0)}</td><td><button class="btn ghost" data-jm-delw="${w.date}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      <h4 class="dsec">B · Daily photos</h4>
      <div class="ev-form">
        <label class="cut-f">Day<input type="date" id="jmDay" value="${iso(new Date())}"></label>
        <label class="cut-f">Junction<select id="jmKey">${KEYS.map(k => `<option value="${k}">${KNAME[k]}</option>`).join('')}<option value="general">General</option></select></label>
        <label class="cut-f ev-wide">Caption (optional, for all photos of this drop)<input id="jmCap" placeholder="e.g. Deck slab S5 left lane — concrete pouring"></label>
      </div>
      <label class="drop" id="jmDropP"><input type="file" id="jmFileP" accept="image/*" multiple><span class="drop-ic">📷</span><span><b>Drop the day's photos</b> (several at once) or click to browse</span><span class="muted small">Resized to 1600 px JPEG + thumbnails — one group per day and junction</span></label>
      <div id="jmPMsg" class="muted small xer-status">${photos} photos on ${new Set(IDX.daily.map(g => g.date)).size} days · photos ${mb(pSize)} · presentations ${mb(wSize)}</div>
      <h4 class="dsec">B2 · Manage photos — delete or move to another junction / day</h4>
      <div id="jmManage">${manageHtml()}</div>
      <h4 class="dsec">C · Publish</h4>
      <p class="small">${pf.length ? `<b>${pf.length} file${pf.length === 1 ? '' : 's'} not published yet</b> — visible only in this browser.` : 'Everything is published.'}${OPS.length && !pf.length ? ' (index changes pending)' : ''}</p>
      <div class="ev-form"><label class="cut-f ev-wide">GitHub token (fine-grained, this repository only, Contents: Read and write) — kept only in this browser<input type="password" id="jmTok" value="${esc(tok)}" placeholder="github_pat_…" autocomplete="off"></label></div>
      <div class="row-btns"><button class="btn primary" id="jmPub" ${OPS.length ? '' : 'disabled'}>⇪ Publish to GitHub</button><button class="btn" id="jmZip" ${OPS.length ? '' : 'disabled'}>⬇ Download for manual upload (.zip)</button><button class="btn ghost" id="jmTokSave">Save token</button><button class="btn ghost" id="jmTokDel">Forget token</button><button class="btn danger" id="jmReset" ${OPS.length ? '' : 'disabled'}>↺ Discard unpublished</button></div>
      <div id="jmPubMsg" class="muted small xer-status"></div>`;
    const wire = (d, i, fn) => { const D = $('#' + d), I = $('#' + i); I.onchange = () => I.files.length && fn([...I.files]); ['dragenter', 'dragover'].forEach(ev => D.addEventListener(ev, e => { e.preventDefault(); D.classList.add('over'); })); ['dragleave', 'drop'].forEach(ev => D.addEventListener(ev, e => { e.preventDefault(); D.classList.remove('over'); })); D.addEventListener('drop', e => e.dataTransfer.files.length && fn([...e.dataTransfer.files])); };
    wire('jmDropW', 'jmFileW', fs => onDeck(fs[0]));
    wire('jmDropP', 'jmFileP', onPhotos);
    $$('[data-jm-delw]').forEach(b => b.onclick = async () => { if (!confirm('Remove the week ' + fd(b.dataset.jmDelw) + ' from the Junctions page?')) return; OPS.push({ op: 'delWeek', date: b.dataset.jmDelw }); await saveOps(); refresh(); });
    $('#jmTokSave').onclick = () => { try { localStorage.setItem('trd_gh_token', $('#jmTok').value.trim()); } catch (e) { } $('#jmPubMsg').textContent = 'Token saved in this browser.'; };
    $('#jmTokDel').onclick = () => { try { localStorage.removeItem('trd_gh_token'); } catch (e) { } $('#jmTok').value = ''; $('#jmPubMsg').textContent = 'Token removed from this browser.'; };
    $('#jmPub').onclick = publish;
    $('#jmZip').onclick = zip;
    wireManage();
    $('#jmReset').onclick = async () => { if (!confirm('Discard every week / photo not published yet?')) return; for (const p of pendingFiles()) await fileDel(p); OPS = []; await saveOps(); refresh(); };
    if (PEND) pendView();
  }
  function refresh() { renderImport(); if (SX.renderJunctions) SX.renderJunctions(); }
  async function onDeck(f) {
    if (!/\.pptx$/i.test(f.name)) { $('#jmPend').innerHTML = '<p class="neg small">Choose a .pptx file.</p>'; return; }
    $('#jmPend').innerHTML = '<p class="muted small">Reading the presentation…</p>';
    try {
      const buf = await f.arrayBuffer(), p = await parseDeck(buf);
      PEND = { name: f.name, size: f.size, buf, status: p.status || iso(new Date()), slides: p.slides };
      pendView();
    } catch (e) { $('#jmPend').innerHTML = `<p class="neg small">Could not read ${esc(f.name)}: ${esc(e.message)}</p>`; }
  }
  function pendView() {
    const P = PEND;
    $('#jmPend').innerHTML = `<div class="jm-pend"><div class="ev-form"><label class="cut-f">Status date (week)<input type="date" id="jmWDate" value="${P.status}"></label><span class="muted small" style="align-self:flex-end">${esc(P.name)} · ${P.slides.length} slides · ${mb(P.size)}${IDX.weeks.some(w => w.date === P.status) ? ' · <b>replaces the week already loaded for this date</b>' : ''}</span></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Slide</th><th>Shows</th><th class="n">Planned</th><th class="n">Actual</th></tr></thead><tbody>${P.slides.map((s, i) => `<tr><td>${s.n}</td><td class="small">${esc(s.title)}</td><td><select data-jm-sk="${i}">${['overview', ...KEYS, ''].map(k => `<option value="${k}" ${k === s.key ? 'selected' : ''}>${k ? KNAME[k] : 'Other'}</option>`).join('')}</select></td><td class="n"><input type="number" step="0.01" data-jm-sp="${i}" value="${s.plan ?? ''}" style="width:80px"></td><td class="n"><input type="number" step="0.01" data-jm-sa="${i}" value="${s.act ?? ''}" style="width:80px"></td></tr>`).join('')}</tbody></table></div>
      <div class="row-btns"><button class="btn primary" id="jmAddW">Add this week</button><button class="btn ghost" id="jmCancelW">Cancel</button></div></div>`;
    $$('[data-jm-sk]').forEach(s => s.onchange = () => { P.slides[+s.dataset.jmSk].key = s.value; });
    $$('[data-jm-sp]').forEach(s => s.onchange = () => { P.slides[+s.dataset.jmSp].plan = s.value === '' ? null : +s.value; });
    $$('[data-jm-sa]').forEach(s => s.onchange = () => { P.slides[+s.dataset.jmSa].act = s.value === '' ? null : +s.value; });
    $('#jmWDate').onchange = e => { P.status = e.target.value; };
    $('#jmCancelW').onclick = () => { PEND = null; $('#jmPend').innerHTML = ''; };
    $('#jmAddW').onclick = async () => {
      if (!P.status) return;
      const file = BASE + 'weekly/' + P.status + '.pptx';
      const clean = scrubDeck(P.buf);
      await fileSet(file, new Blob([clean], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
      P.size = clean.byteLength;
      delete URLS[file]; delete DECKS[P.status];
      OPS.push({ op: 'addWeek', week: { date: P.status, file, name: P.name, size: P.size, slides: P.slides, added: new Date().toISOString().slice(0, 10) } });
      SEL = P.status; PEND = null; await saveOps(); refresh();
      $('#jmPubMsg').innerHTML = `✓ Week ${fd(SEL)} added — it shows on the Junctions page in this browser. Publish it to make it visible to everyone.`;
    };
  }
  async function onPhotos(files) {
    const date = $('#jmDay').value, key = $('#jmKey').value, cap = $('#jmCap').value.trim(), msg = $('#jmPMsg');
    if (!date) { msg.textContent = 'Choose the day first.'; return; }
    const imgs = files.filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
    const g = IDX.daily.find(x => x.date === date && x.key === key);
    let n = g ? Math.max(0, ...g.photos.map(p => parseInt(p.file.split('/').pop(), 10) || 0)) : 0;
    const out = [];
    for (const [i, f] of imgs.entries()) {
      msg.textContent = `Processing ${i + 1} / ${imgs.length}: ${f.name}…`;
      try {
        const big = await resize(f, 1600, 0.8), small = await resize(f, 420, 0.72);
        const id = String(++n).padStart(2, '0'), dir = `${BASE}daily/${date}/${key}/`;
        const p = { file: dir + id + '.jpg', thumb: dir + id + '_t.jpg', size: big.blob.size + small.blob.size, w: big.w, h: big.h, cap, name: f.name };
        await fileSet(p.file, big.blob); await fileSet(p.thumb, small.blob);
        out.push(p);
      } catch (e) { msg.textContent = `✗ ${f.name}: ${e.message} (HEIC photos: export as JPEG first)`; }
    }
    if (!out.length) return;
    OPS.push({ op: 'addPhotos', date, key, photos: out });
    await saveOps(); refresh();
    $('#jmPMsg').innerHTML = `✓ ${out.length} photo${out.length === 1 ? '' : 's'} added to ${esc(KNAME[key])} · ${fd(date)} (${mb(out.reduce((s, p) => s + p.size, 0))}). Publish to make them visible to everyone.`;
  }

  // ---------------- publish ----------------
  const repo = () => { const h = location.hostname.match(/^([^.]+)\.github\.io$/i), seg = location.pathname.split('/').filter(Boolean)[0]; return h && seg ? { o: h[1], r: seg } : { o: 'yehyaessam90-rgb', r: 'taif-road-dashboard' }; };
  const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  async function publish(tokArg, msgArg) {
    const ext = typeof tokArg === 'string';
    const msg = msgArg || (t => { const el = $('#jmPubMsg'); if (el) el.innerHTML = t; });
    const tok = ext ? tokArg : $('#jmTok').value.trim();
    if (!tok) return msg('✗ Paste a GitHub token first (see the note below the button), or use <b>Download for manual upload</b>.');
    try { localStorage.setItem('trd_gh_token', tok); } catch (e) { }
    const { o, r } = repo();
    const gh = async (p, opt = {}) => {
      const res = await fetch(`https://api.github.com/repos/${o}/${r}${p}`, Object.assign({}, opt, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) } }));
      if (res.status === 404 && opt.allow404) return null;
      if (!res.ok) { let m = ''; try { m = (await res.json()).message; } catch (e) { } throw new Error(`GitHub ${res.status}${m ? ': ' + m : ''}`); }
      return res.json();
    };
    if ($('#jmPub')) $('#jmPub').disabled = true;
    try {
      msg('Connecting to GitHub…');
      const ref = await gh('/git/ref/heads/main'), head = await gh('/git/commits/' + ref.object.sha);
      // merge on top of the index that is on GitHub right now
      const cur = await gh('/contents/' + BASE + 'index.json?ref=main', { allow404: true });
      let remote = { v: 1, rev: 0, weeks: [], daily: [] };
      if (cur && cur.content) remote = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cur.content.replace(/\n/g, '')), c => c.charCodeAt(0))));
      const merged = apply(remote, OPS); merged.v = 1; merged.rev = Date.now(); merged.updated = new Date().toISOString();
      const files = pendingFiles(), tree = [];
      // files dropped from the index (deleted photos / weeks) are deleted from the repository too
      const keepP = new Set(); merged.weeks.forEach(w => keepP.add(w.file)); merged.daily.forEach(g => g.photos.forEach(p => { keepP.add(p.file); keepP.add(p.thumb); }));
      const gone = []; remote.weeks.forEach(w => { if (!keepP.has(w.file)) gone.push(w.file); }); remote.daily.forEach(g => g.photos.forEach(p => [p.file, p.thumb].forEach(f => { if (!keepP.has(f)) gone.push(f); })));
      if (gone.length) {
        const all = await gh('/git/trees/' + head.tree.sha + '?recursive=1'), exists = new Set(all.tree.map(t => t.path));
        gone.filter(f => exists.has(f)).forEach(f => tree.push({ path: f, mode: '100644', type: 'blob', sha: null }));
      }
      for (const [i, p] of files.entries()) {
        msg(`Uploading ${i + 1} / ${files.length}: ${esc(p.split('/').slice(-3).join('/'))}…`);
        const blob = await fileGet(p); if (!blob) continue;
        const b = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: b64(await blob.arrayBuffer()), encoding: 'base64' }) });
        tree.push({ path: p, mode: '100644', type: 'blob', sha: b.sha });
      }
      const ib = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: b64(new TextEncoder().encode(JSON.stringify(merged, null, 1))), encoding: 'base64' }) });
      tree.push({ path: BASE + 'index.json', mode: '100644', type: 'blob', sha: ib.sha });
      msg('Creating the commit…');
      const t = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
      const nDel = OPS.filter(x => x.op === 'delPhoto').length, nMov = OPS.filter(x => x.op === 'movePhoto').length;
      const added = (nDel ? [nDel + ' photo(s) deleted'] : []).concat(nMov ? [nMov + ' photo(s) moved'] : []).concat(OPS.filter(x => x.op === 'addWeek').map(x => 'week ' + x.week.date).concat(OPS.filter(x => x.op === 'addPhotos').map(x => `${x.photos.length} photo(s) ${x.key} ${x.date}`)));
      const c = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: 'Junctions media: ' + (added.join(', ') || 'index update'), tree: t.sha, parents: [ref.object.sha] }) });
      await gh('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
      await kvSet('published', merged);
      PUB = merged; OPS = []; await saveOps();
      msg(`✓ Published (${files.length} file${files.length === 1 ? '' : 's'}). GitHub Pages updates for everyone in about a minute.`);
      renderImport(); SX.renderJunctions();
      if ($('#jmPubMsg')) $('#jmPubMsg').innerHTML = `✓ Published (${files.length} file${files.length === 1 ? '' : 's'}). GitHub Pages updates for everyone in about a minute.`;
      if (window.PUBLISHER) PUBLISHER.refresh();
      return files.length;
    } catch (e) { if (ext) throw e; msg('✗ ' + esc(e.message) + (/401|403/.test(e.message) ? ' — check the token (repository access to taif-road-dashboard, Contents: Read and write).' : '')); }
    finally { const b = $('#jmPub'); if (b) b.disabled = !OPS.length; }
  }
  async function zip() {
    const merged = apply(PUB, OPS); merged.v = 1; merged.rev = Date.now(); merged.updated = new Date().toISOString();
    const z = XLSX.CFB.utils.cfb_new();
    for (const p of pendingFiles()) { const b = await fileGet(p); if (b) XLSX.CFB.utils.cfb_add(z, p, new Uint8Array(await b.arrayBuffer())); }
    XLSX.CFB.utils.cfb_add(z, BASE + 'index.json', new TextEncoder().encode(JSON.stringify(merged, null, 1)));
    const out = XLSX.CFB.write(z, { fileType: 'zip', type: 'array', compression: false });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out], { type: 'application/zip' })); a.download = 'junctions-update-' + iso(new Date()) + '.zip'; a.click();
    $('#jmPubMsg').innerHTML = '<b>GitHub does not unzip files</b> — uploading the .zip itself changes nothing. Unzip it first, open the repository on GitHub → <b>Add file › Upload files</b> → drag the <code>data</code> folder from the zip → <b>Commit</b>. Then click <b>Discard unpublished</b> here once the site shows the new files.';
  }

  window.JMEDIA = { has, decorate, parseDeck, scrubDeck, load, pending: () => OPS.length, publish: (tok, msg) => publish(tok, msg), get index() { return IDX; } };
  A.whenReady(load);
})();
