/* Events — Notices of Change Order (NCO) and other owner events, with their letter chain.
   Published copy: data/events.json. Owner edits from the Import tab are kept in this browser until published. */
(function () {
  'use strict';
  const A = window.APP;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = A.esc, fmt = A.fmt;
  const DAY = 864e5, KEY = 'trd_events';
  let EV = null, SRC = '';

  // ---------------- data ----------------
  const pd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const fd = s => { const t = typeof s === 'number' ? s : pd(s); return t === null ? '—' : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  const today = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  const daysOpen = e => { const s = pd(e.start); return s === null ? null : Math.round(((pd(e.end) ?? today()) - s) / DAY); };
  const dirOf = l => l.from === 'RCRC' ? 'in' : l.from === 'Contractor' ? 'out' : 'oth';
  const sortLetters = e => e.letters.sort((a, b) => (pd(a.date) ?? pd(a.received) ?? 0) - (pd(b.date) ?? pd(b.received) ?? 0));
  const lastLetter = e => { const l = e.letters.filter(x => x.date || x.received); return l[l.length - 1]; };
  const STATE = { open: ['Open', 'bad'], pending: ['In progress', 'warn'], closed: ['Closed', 'good'] };

  async function load() {
    let local = null;
    try { const v = localStorage.getItem(KEY); if (v) local = JSON.parse(v); } catch (e) { }
    if (local) { EV = local; SRC = 'local edits (not published)'; }
    else {
      try { const r = await fetch('data/events.json', { cache: 'no-store' }); if (r.ok) { EV = await r.json(); SRC = 'published data/events.json'; } } catch (e) { }
    }
    if (!EV) EV = { v: 1, events: [] };
    EV.events.forEach(sortLetters);
    render(); renderImport();
  }
  function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(EV)); } catch (e) { } SRC = 'local edits (not published)'; }

  // P6 activities that the event touches (name pattern of the event)
  function related(e) {
    const SX = window.SCHEDX;
    if (!SX || !SX.S || !e.keywords) return null;
    let re; try { re = new RegExp(e.keywords, 'i'); } catch (x) { return null; }
    const list = SX.S.acts.filter(a => re.test(a.n));
    return { list, started: list.filter(a => a.st !== 'NotStart').length, done: list.filter(a => a.st === 'Complete').length,
      first: Math.min(...list.map(a => a.s ?? Infinity)), crit: list.filter(SX.critical).length };
  }

  // ---------------- page ----------------
  function render() {
    const host = $('#evBody');
    if (!host || !EV) return;
    const E = EV.events.slice().sort((a, b) => a.no - b.no);
    if (!E.length) { host.innerHTML = '<div class="card empty"><h3>No events yet</h3><p class="muted">Add the first one from the Import tab.</p></div>'; return; }
    const open = E.filter(e => e.state !== 'closed');
    const cost = E.reduce((s, e) => s + (typeof e.cost === 'number' ? e.cost : 0), 0);
    const priced = E.filter(e => typeof e.cost === 'number').length;
    const byBall = k => open.filter(e => (e.ball || '').startsWith(k)).length;
    const letters = E.reduce((s, e) => s + e.letters.length, 0);
    host.innerHTML = `
      <div class="kpis ev-kpis">
        <div class="kpi"><div class="lbl">Events</div><div class="val">${E.length}</div><div class="sub">${open.length} open · ${E.length - open.length} closed</div></div>
        <div class="kpi"><div class="lbl">Awaiting RCRC</div><div class="val">${byBall('RCRC')}</div><div class="sub">decision / formal Change Order</div></div>
        <div class="kpi"><div class="lbl">Awaiting Contractor</div><div class="val">${byBall('Contractor')}</div><div class="sub">impact assessment / BOQ</div></div>
        <div class="kpi"><div class="lbl">Cost impact submitted</div><div class="val ${cost < 0 ? 'neg' : ''}">${cost ? (cost > 0 ? '+' : '−') + fmt(Math.abs(cost) / 1e6, 2) + ' M' : '0'}</div><div class="sub">SAR excl. VAT · ${priced} of ${E.length} events priced</div></div>
        <div class="kpi"><div class="lbl">Letters on file</div><div class="val">${letters}</div><div class="sub">${SRC}</div></div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Timeline</h3><span class="muted small">Bar = event open (start → end or today) · ● RCRC letter · ◆ Contractor letter · ■ other · click a mark for the letter</span></div>
        ${timeline(E)}
      </div>
      <div class="ev-grid">${E.map(card).join('')}</div>
      <div class="card">
        <div class="card-h"><h3>Letter register</h3><span class="muted small">All references, newest first</span><button class="btn ghost" id="evCsv">⬇ CSV</button></div>
        ${register(E)}
      </div>`;
    $('#evCsv').onclick = csv;
  }

  function card(e) {
    const st = STATE[e.state] || STATE.open, d = daysOpen(e), last = lastLetter(e), R = related(e);
    return `<div class="card ev-card click" data-ev="${esc(e.id)}">
      <div class="ev-h"><span class="ev-no">${esc(e.id)}</span><span class="status ${st[1]}">${st[0]}</span><span class="tag">${esc(e.type || '')}</span></div>
      <h3 class="ev-t">${esc(e.title)}</h3>
      <div class="ev-dates">
        <div><span>Start (issued)</span><b>${fd(e.start)}</b>${e.received ? `<em>received ${fd(e.received)}</em>` : ''}</div>
        <div><span>End</span><b>${e.end ? fd(e.end) : '—'}</b><em>${e.end ? 'closed' : d !== null ? 'open ' + d + ' days' : ''}</em></div>
        <div><span>Ball in court</span><b>${esc(e.ball || '—')}</b><em>${last ? 'last letter ' + fd(last.date || last.received) : ''}</em></div>
      </div>
      <p class="ev-s">${esc(e.status || '')}</p>
      <div class="ev-imp"><span><b>Time</b> ${esc(e.time || '—')}</span><span><b>Cost</b> ${typeof e.cost === 'number' ? (e.cost === 0 ? 'neutral' : (e.cost < 0 ? '−' : '+') + 'SAR ' + fmt(Math.abs(e.cost), 0)) : esc(e.costNote || '—')}</span></div>
      <div class="ev-f muted small">${e.letters.length} letter${e.letters.length === 1 ? '' : 's'}${R ? ` · ${R.list.length} related P6 activities (${R.started} started)` : ''} <span class="ev-more">Details ›</span></div>
    </div>`;
  }

  function timeline(E) {
    const all = [];
    E.forEach(e => { [e.start, e.received, e.end].forEach(s => { const t = pd(s); if (t !== null) all.push(t); }); e.letters.forEach(l => { const t = pd(l.date) ?? pd(l.received); if (t !== null) all.push(t); }); });
    const now = today();
    let t0 = Math.min(...all), t1 = Math.max(now, ...all);
    t0 = Date.UTC(new Date(t0).getUTCFullYear(), new Date(t0).getUTCMonth(), 1);
    t1 = Date.UTC(new Date(t1).getUTCFullYear(), new Date(t1).getUTCMonth() + 1, 1);
    const x = t => ((t - t0) / (t1 - t0) * 100).toFixed(3) + '%';
    const months = []; for (let m = t0; m < t1; m = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + 1, 1)) months.push(m);
    const head = `<div class="tl-axis">${months.map(m => `<span style="left:${x(m)}">${new Date(m).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })}</span>`).join('')}<b class="tl-now" style="left:${x(now)}" title="Today ${fd(now)}"></b></div>`;
    const rows = E.map(e => {
      const s = pd(e.start), f = pd(e.end) ?? now, st = STATE[e.state] || STATE.open;
      const marks = e.letters.map((l, i) => { const t = pd(l.date) ?? pd(l.received); if (t === null) return ''; return `<i class="tl-m ${dirOf(l)}" style="left:${x(t)}" data-evl="${esc(e.id)}|${i}" title="${esc(l.ref)} · ${fd(l.date || l.received)} · ${esc(l.from)} → ${esc(l.to || '')}\n${esc(l.subject)}"></i>`; }).join('');
      return `<div class="tl-row"><div class="tl-l click" data-ev="${esc(e.id)}"><b>${esc(e.id)}</b> <span class="muted small">${esc(e.title)}</span></div>
        <div class="tl-track">${months.map(m => `<i class="tl-g" style="left:${x(m)}"></i>`).join('')}${s !== null ? `<i class="tl-bar ${st[1]}" style="left:${x(s)};width:calc(${x(f)} - ${x(s)})"></i>` : ''}${marks}<b class="tl-now" style="left:${x(now)}"></b></div></div>`;
    }).join('');
    return `<div class="tl"><div class="tl-row tl-hrow"><div class="tl-l"></div><div class="tl-track tl-htrack">${head}</div></div>${rows}</div>`;
  }

  function register(E) {
    const rows = [];
    E.forEach(e => e.letters.forEach((l, i) => rows.push({ e, l, i, t: pd(l.date) ?? pd(l.received) ?? 0 })));
    rows.sort((a, b) => b.t - a.t);
    return `<div class="table-wrap"><table class="tbl ev-reg"><thead><tr><th>Reference No.</th><th>Date</th><th>Received</th><th>From → To</th><th>Event</th><th>Type</th><th>Subject</th></tr></thead><tbody>${rows.map(({ e, l, i }) =>
      `<tr class="click" data-evl="${esc(e.id)}|${i}"><td class="mono"><b>${esc(l.ref)}</b></td><td>${fd(l.date)}</td><td>${l.received ? fd(l.received) : '—'}</td><td><span class="dir ${dirOf(l)}">${esc(l.from)}</span> → ${esc(l.to || '')}</td><td>${esc(e.id)}</td><td>${esc(l.kind || '')}</td><td>${esc(l.subject)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------------- details ----------------
  function detail(id) {
    const e = EV.events.find(x => x.id === id);
    const st = STATE[e.state] || STATE.open, d = daysOpen(e), R = related(e), SX = window.SCHEDX;
    const tiles = [['Start (issued)', fd(e.start), e.received ? 'received ' + fd(e.received) : ''], ['End', e.end ? fd(e.end) : '—', e.end ? 'closed' : d !== null ? 'open ' + d + ' days' : ''],
      ['Status', `<span class="status ${st[1]}">${st[0]}</span>`, esc(e.status || '')], ['Ball in court', esc(e.ball || '—'), ''],
      ['Time impact', esc(e.time || '—'), ''], ['Cost impact', typeof e.cost === 'number' ? (e.cost === 0 ? 'Neutral' : (e.cost < 0 ? '−' : '+') + 'SAR ' + fmt(Math.abs(e.cost), 0)) : '—', esc(e.costNote || '')]];
    const letters = e.letters.map((l, i) => `<div class="ev-l ${dirOf(l)} click" data-evl="${esc(e.id)}|${i}">
        <div class="ev-ld"><b>${fd(l.date)}</b>${l.received ? `<span class="muted small">received ${fd(l.received)}</span>` : ''}</div>
        <div class="ev-lb"><div><span class="dir ${dirOf(l)}">${esc(l.from)} → ${esc(l.to || '')}</span> <span class="tag">${esc(l.kind || '')}</span> <span class="mono small">${esc(l.ref)}</span></div>
          <div class="ev-ls">${esc(l.subject)}</div><div class="muted small">${esc(l.action || '')}</div></div></div>`).join('');
    let acts = '';
    if (R && R.list.length) {
      const list = R.list.slice().sort((a, b) => (a.s ?? 0) - (b.s ?? 0));
      acts = `<h4 class="dsec">Related P6 activities — ${esc(SX.prog(SX.active).name)} <span class="muted small">(${R.list.length} by name pattern <code>${esc(e.keywords)}</code> · ${R.started} started · ${R.done} complete · ${R.crit} critical)</span></h4>
        ${SX.tbl([['Activity'], ['Status'], ['BL start'], ['Start'], ['Finish'], ['%', 1], ['Float', 1]], list.slice(0, 150).map(a => `<tr class="click" data-act="${esc(a.c)}"><td><b>${esc(a.c)}</b><div class="small muted">${esc(a.n)}</div></td><td>${SX.stTag(a)}</td><td>${SX.fd(a.bs)}</td><td>${SX.fd(a.s)}</td><td>${SX.fd(a.f)}</td><td class="n">${a.p}%</td><td class="n">${a.tf ?? '—'}</td></tr>`))}
        ${list.length > 150 ? '<p class="muted small">First 150 shown.</p>' : ''}`;
    }
    return {
      title: `${esc(e.id)} — ${esc(e.title)}`, sub: `${esc(e.type || '')} · issued by ${esc(e.issuedBy || 'RCRC')} · ${esc(e.clause || '')}`,
      body: `<div class="dtiles">${tiles.map(([l, v, h]) => `<div class="dtile"><div class="lbl">${l}</div><div class="v">${v}</div>${h ? `<div class="muted small">${h}</div>` : ''}</div>`).join('')}</div>
        <h4 class="dsec">Scope</h4><p>${esc(e.scope || '—')}</p>
        <h4 class="dsec">What happened</h4><p>${esc(e.summary || '—')}</p>
        <div class="dnote"><b>Next action:</b> ${esc(e.next || '—')}</div>
        <h4 class="dsec">Letters (${e.letters.length})</h4><div class="ev-ls-list">${letters}</div>${acts}`
    };
  }
  function letterDetail(id, i) {
    const e = EV.events.find(x => x.id === id), l = e.letters[i];
    return { title: esc(l.ref), sub: `${esc(e.id)} · ${esc(e.title)}`,
      body: `<div class="dtiles"><div class="dtile"><div class="lbl">Date</div><div class="v">${fd(l.date)}</div></div><div class="dtile"><div class="lbl">Received</div><div class="v">${l.received ? fd(l.received) : '—'}</div></div>
        <div class="dtile"><div class="lbl">From → To</div><div class="v">${esc(l.from)} → ${esc(l.to || '')}</div></div><div class="dtile"><div class="lbl">Type</div><div class="v">${esc(l.kind || '—')}</div></div></div>
        <h4 class="dsec">Subject</h4><p>${esc(l.subject)}</p><h4 class="dsec">What the letter does</h4><p>${esc(l.action || '—')}</p>
        <button class="btn" data-ev="${esc(e.id)}">Open ${esc(e.id)} ›</button>` };
  }
  document.addEventListener('click', ev => {
    const l = ev.target.closest('[data-evl]');
    if (l) { const [id, i] = l.dataset.evl.split('|'); A.Details.open(() => letterDetail(id, +i)); return; }
    const c = ev.target.closest('[data-ev]');
    if (c && EV) { A.Details.open(() => detail(c.dataset.ev)); }
  });

  function csv() {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Event', 'Event title', 'Event status', 'Event start', 'Event end', 'Reference No.', 'Date', 'Received', 'From', 'To', 'Type', 'Subject', 'What the letter does'].map(q).join(',')];
    EV.events.forEach(e => e.letters.forEach(l => lines.push([e.id, e.title, (STATE[e.state] || STATE.open)[0], e.start, e.end || '', l.ref, l.date || '', l.received || '', l.from, l.to || '', l.kind || '', l.subject, l.action || ''].map(q).join(','))));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'events-letters.csv'; a.click();
  }

  // ---------------- import (owner) ----------------
  const FORM = { file: null };
  // read reference / date / subject / references from a letter file (docx text or the file name)
  async function readLetter(f) {
    const out = { name: f.name };
    const ref = /RP-?0?1-RCRC-[A-Z]{3}-[A-Z]{3}-TR-01-CMT-LET-\d{5}/i.exec(f.name);
    let text = '';
    if (/\.docx$/i.test(f.name)) {
      try {
        const cfb = XLSX.CFB.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
        const i = cfb.FullPaths.findIndex(x => x.endsWith('/word/document.xml'));
        const xml = new TextDecoder().decode(cfb.FileIndex[i].content);
        text = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(p => (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')).join('\n');
      } catch (e) { }
    }
    const r2 = /RP-?0?1-RCRC-[A-Z]{3}-[A-Z]{3}-TR-01-CMT-LET-\d{5}/i.exec(text);
    out.ref = (r2 || ref || [''])[0].toUpperCase().replace(/^RP-01/, 'RP01');
    if (/-RCR-ICR-/.test(out.ref)) { out.from = 'RCRC'; out.to = 'Contractor'; } else if (/-ICR-RCR-/.test(out.ref)) { out.from = 'Contractor'; out.to = 'RCRC'; }
    const dm = /(\d{2})\/(\d{2})\/(20\d{2})\s*G/.exec(text);
    if (dm) out.date = `${dm[3]}-${dm[2]}-${dm[1]}`;
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    const si = lines.findIndex(s => /^Subject\s*:?$/i.test(s));
    if (si > 0) { const prev = lines.slice(Math.max(0, si - 3), si).filter(s => /[A-Za-z]/.test(s) && !/[؀-ۿ]/.test(s)); if (prev.length) out.subject = prev[prev.length - 1]; }
    const nm = /NCO\s*(?:No\.?|#)?\s*\(?(\d+)\)?/i.exec((out.subject || '') + ' ' + f.name + ' ' + text.slice(0, 3000));
    if (nm) out.nco = +nm[1];
    const recv = /received on (\d{2})\/(\d{2})\/(20\d{2})/i.exec(text);
    if (recv) out.refReceived = `${recv[3]}-${recv[2]}-${recv[1]}`;
    return out;
  }
  function renderImport() {
    const host = $('#evImport');
    if (!host || !EV) return;
    const opts = EV.events.slice().sort((a, b) => a.no - b.no).map(e => `<option value="${esc(e.id)}">${esc(e.id)} — ${esc(e.title)}</option>`).join('');
    host.innerHTML = `
      <label class="drop" id="evDrop"><input type="file" id="evFile" accept=".pdf,.docx,.doc"><span class="drop-ic">✉</span><span><b>Drop a letter here</b> (PDF / Word) or click to browse</span><span class="muted small">Reference, direction, date and subject are filled from the file where possible — check them before adding</span></label>
      <div class="ev-form">
        <label class="cut-f">Event<select id="evSel">${opts}<option value="__new">➕ New event…</option></select></label>
        <label class="cut-f">Reference No.<input id="evRef" placeholder="RP01-RCRC-RCR-ICR-TR-01-CMT-LET-00000"></label>
        <label class="cut-f">Letter date<input type="date" id="evDate"></label>
        <label class="cut-f">Received<input type="date" id="evRecv"></label>
        <label class="cut-f">From<select id="evFrom"><option>RCRC</option><option>Contractor</option><option>WSP</option><option>Amanah</option><option>Other</option></select></label>
        <label class="cut-f">To<select id="evTo"><option>Contractor</option><option>RCRC</option><option>WSP</option><option>Amanah</option><option>Other</option></select></label>
        <label class="cut-f">Type<select id="evKind">${['NCO', 'Response', 'Request', 'Reminder', 'Clarification', 'Clarification request', 'Instruction', 'Approval', 'Change Order', 'Rejection', 'Reference'].map(k => `<option>${k}</option>`).join('')}</select></label>
        <label class="cut-f ev-wide">Subject<input id="evSubj"></label>
        <label class="cut-f ev-wide">What the letter does<textarea id="evAct" rows="2"></textarea></label>
      </div>
      <div class="ev-form ev-new hidden" id="evNew">
        <label class="cut-f">Event ID<input id="enId" placeholder="NCO-07"></label>
        <label class="cut-f ev-wide">Title<input id="enTitle"></label>
        <label class="cut-f">Type<select id="enType"><option>Modification</option><option>Omission</option><option>Addition</option><option>Modification / Addition</option><option>Instruction</option><option>Other</option></select></label>
        <label class="cut-f">Clause<input id="enClause" placeholder="SCC Cl. 6.2"></label>
        <label class="cut-f ev-wide">Scope<textarea id="enScope" rows="2"></textarea></label>
        <label class="cut-f ev-wide">Related P6 activities (name pattern)<input id="enKw" placeholder="e.g. irrigat|pump room"></label>
      </div>
      <div class="ev-form">
        <label class="cut-f">Event status<select id="evState"><option value="">(unchanged)</option><option value="open">Open</option><option value="pending">In progress</option><option value="closed">Closed</option></select></label>
        <label class="cut-f">Ball in court<select id="evBall"><option value="">(unchanged)</option><option>RCRC</option><option>Contractor</option><option>RCRC / Amanah</option><option>WSP</option></select></label>
        <label class="cut-f">End date (closes the event)<input type="date" id="evEnd"></label>
        <label class="cut-f ev-wide">Status note<input id="evStatus" placeholder="e.g. Change Order issued — BOQ reduced"></label>
        <label class="cut-f">Time impact<input id="evTime" placeholder="(unchanged)"></label>
        <label class="cut-f">Cost impact SAR (− = reduction)<input type="number" id="evCost" placeholder="(unchanged)"></label>
      </div>
      <div class="row-btns"><button class="btn primary" id="evAdd">Add letter / update event</button><button class="btn" id="evExport">⬇ Download events.json</button><button class="btn danger" id="evClear">↺ Clear local edits</button></div>
      <div id="evStatusMsg" class="muted small xer-status">${esc(SRC)} · ${EV.events.length} events · ${EV.events.reduce((s, e) => s + e.letters.length, 0)} letters</div>`;
    const sel = $('#evSel');
    sel.onchange = () => $('#evNew').classList.toggle('hidden', sel.value !== '__new');
    const d = $('#evDrop'), i = $('#evFile');
    const take = async f => {
      const r = await readLetter(f);
      if (r.ref) $('#evRef').value = r.ref;
      if (r.from) { $('#evFrom').value = r.from; $('#evTo').value = r.to; $('#evKind').value = r.from === 'RCRC' ? (r.nco && !EV.events.some(e => e.no === r.nco) ? 'NCO' : 'Instruction') : 'Response'; }
      if (r.date) $('#evDate').value = r.date;
      if (r.subject) $('#evSubj').value = r.subject;
      if (r.nco) { const e = EV.events.find(x => x.no === r.nco); sel.value = e ? e.id : '__new'; if (!e) { $('#enId').value = 'NCO-' + String(r.nco).padStart(2, '0'); $('#enTitle').value = (r.subject || '').replace(/^NCO\s*#?\s*\d+\s*[-–]\s*/i, ''); } sel.onchange(); }
      $('#evStatusMsg').innerHTML = `Read <b>${esc(f.name)}</b>${r.ref ? ' · ref ' + esc(r.ref) : ''}${r.nco ? ' · NCO #' + r.nco : ''}${r.refReceived ? ' · it says the referenced letter was received on ' + fd(r.refReceived) : ''}. ${/\.pdf$/i.test(f.name) ? 'Scanned PDFs have no text: type the date, subject and summary.' : ''}`;
    };
    i.onchange = () => i.files[0] && take(i.files[0]);
    ['dragenter', 'dragover'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.remove('over'); }));
    d.addEventListener('drop', e => e.dataTransfer.files[0] && take(e.dataTransfer.files[0]));
    $('#evAdd').onclick = add;
    $('#evExport').onclick = () => { const out = Object.assign({}, EV, { updated: new Date().toISOString().slice(0, 10) }); const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'events.json'; a.click(); };
    $('#evClear').onclick = async () => { try { localStorage.removeItem(KEY); } catch (e) { } EV = null; await load(); $('#evStatusMsg').textContent = 'Local edits cleared — showing the published events.'; };
  }
  function add() {
    const v = id => ($('#' + id).value || '').trim();
    const msg = t => { $('#evStatusMsg').innerHTML = t; };
    let e;
    if (v('evSel') === '__new') {
      const id = v('enId').toUpperCase(), title = v('enTitle');
      if (!id || !title) return msg('✗ New event: give an ID (e.g. NCO-07) and a title.');
      if (EV.events.some(x => x.id === id)) return msg('✗ ' + esc(id) + ' already exists — pick it in the list.');
      const no = parseInt(id.replace(/\D/g, ''), 10) || EV.events.length + 1;
      e = { id, no, title, type: v('enType'), issuedBy: v('evFrom') || 'RCRC', clause: v('enClause'), start: v('evDate') || null, received: v('evRecv') || null, effective: null, end: null,
        status: 'Notice received — Contractor assessment required', state: 'open', ball: 'Contractor', scope: v('enScope'), summary: v('evAct'), time: 'To be assessed', cost: null, costNote: 'To be assessed', next: 'Contractor to submit the time and cost implications.', keywords: v('enKw'), letters: [] };
      EV.events.push(e);
    } else e = EV.events.find(x => x.id === v('evSel'));
    if (v('evRef')) {
      if (e.letters.some(l => l.ref === v('evRef'))) return msg('✗ ' + esc(v('evRef')) + ' is already in ' + esc(e.id) + '.');
      if (!v('evDate') && !v('evRecv')) return msg('✗ Enter the letter date (or the received date).');
      e.letters.push({ ref: v('evRef'), date: v('evDate') || null, received: v('evRecv') || undefined, from: v('evFrom'), to: v('evTo'), kind: v('evKind'), subject: v('evSubj') || '(no subject)', action: v('evAct') });
      sortLetters(e);
    }
    if (v('evState')) e.state = v('evState');
    if (v('evBall')) e.ball = v('evBall');
    if (v('evEnd')) { e.end = v('evEnd'); e.state = 'closed'; e.ball = '—'; }
    if (v('evStatus')) e.status = v('evStatus');
    if (v('evTime')) e.time = v('evTime');
    if (v('evCost') !== '') e.cost = +v('evCost');
    saveLocal(); render(); renderImport();
    $('#evSel').value = e.id;
    msg(`✓ ${esc(e.id)} updated (${e.letters.length} letters). To publish: <b>Download events.json</b> → upload it to <code>data/</code>.`);
  }

  window.EVENTS = { get data() { return EV; }, render, readLetter };
  const prev = A.onTab;
  A.onTab = n => { if (prev) prev(n); if (n === 'events') render(); };
  if (window.SCHEDX) window.SCHEDX.onChange(render);
  A.whenReady(load);
})();
