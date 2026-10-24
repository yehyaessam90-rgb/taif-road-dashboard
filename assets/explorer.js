/* Site-progress Overview, P6 Explorer and Resources.
   One drill-down filter (WBS level by level + activity keywords) is shared by Explorer and Resources. */
(function () {
  'use strict';
  const A = window.APP, SX = window.SCHEDX;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = A.esc, fmt = A.fmt, fmtM = A.fmtM, fmtP = A.fmtP;
  const DAY = SX.DAY, HPD = 10, WD = 6 / 7;      // 10 h/day, 6 working days a week
  const fd = SX.fd, ds = SX.ds;
  const charts = {};
  const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const mkChart = (id, cfg, pick) => {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id);
    if (!el) return;
    if (pick) {
      cfg.options.onClick = (e, els) => { if (els.length) { A.markPicked(); pick(els[0].index, els[0].datasetIndex); } };
      cfg.options.onHover = (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
    }
    charts[id] = new Chart(el, cfg);
  };
  const spiTag = v => v === null || v === undefined || isNaN(v) ? '<span class="status na">—</span>' : `<span class="status ${v >= .95 ? 'good' : v >= .85 ? 'warn' : 'bad'}">${v.toFixed(2)}</span>`;
  const pbar = (v, pl) => `<div class="pbar"><div class="t"><i style="width:${Math.min(100, v)}%"></i>${pl !== undefined && pl !== null ? `<span class="pl" style="left:${Math.min(100, pl)}%"></span>` : ''}</div><span>${fmtP(v, 1)}</span></div>`;

  // ---------------- cached indexes per programme ----------------
  const CACHE = new WeakMap();
  function ix() {
    const S = SX.S;
    if (!S) return null;
    let c = CACHE.get(S);
    if (c) return c;
    const kids = {};
    S.wbs.forEach(w => { (kids[w.parent] = kids[w.parent] || []).push(w); });
    const raByAct = {};
    (S.ra || []).forEach((r, i) => { (raByAct[r[0]] = raByAct[r[0]] || []).push(i); });
    const actIdx = {};
    S.acts.forEach((a, i) => { actIdx[a.c] = i; });
    const lane = {};
    S.acts.forEach(a => { if (lane[a.w] === undefined) { const p = SX.X.wbsPath(a.w).map(w => w.name).join(' / '); lane[a.w] = /left lane/i.test(p) ? 'Left' : /righ?t lane/i.test(p) ? 'Right' : ''; } });
    c = { kids, raByAct, actIdx, lane };
    CACHE.set(S, c);
    return c;
  }

  // ---------------- shared filter ----------------
  const XF = { prog: null, path: [], kw: '', st: '', lane: '', crit: false };
  try { Object.assign(XF, JSON.parse(localStorage.getItem('trd_xf') || '{}')); } catch (e) { }
  const save = () => { try { localStorage.setItem('trd_xf', JSON.stringify(XF)); } catch (e) { } };
  const CHIPS = ['Concrete', 'Rebar', 'Formwork', 'Excavation', 'Backfill', 'Piling', 'Precast', 'Waterproofing', 'Asphalt', 'Deck', 'Pier', 'Abutment', 'Duct', 'Manhole'];
  // a keyword also matches its related activity names (typed or picked from the chips)
  const SYN = { formwork: ['formwork', 'form work', 'scaffold'], rebar: ['rebar', 'reinforcement'] };
  const expand = t => SYN[t] || [t];
  function kwTest() {
    const terms = XF.kw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const inc = terms.filter(t => !t.startsWith('-')).flatMap(expand), exc = terms.filter(t => t.startsWith('-')).map(t => t.slice(1)).filter(Boolean).flatMap(expand);
    if (!inc.length && !exc.length) return null;
    return a => { const s = (a.c + ' ' + a.n).toLowerCase(); return (!inc.length || inc.some(t => s.includes(t))) && !exc.some(t => s.includes(t)); };
  }
  function selection(extraWbs) {
    const S = SX.S, c = ix();
    const root = extraWbs || XF.path[XF.path.length - 1];
    const set = root ? SX.wbsSet(root) : null;
    const kt = kwTest();
    return S.acts.filter(a => (!set || set.has(a.w)) && (!kt || kt(a)) &&
      (!XF.st || a.st === XF.st) && (!XF.lane || c.lane[a.w] === XF.lane) && (!XF.crit || SX.critical(a)));
  }
  function filterBar(el) {
    const S = SX.S, c = ix();
    if (XF.prog !== SX.active) { XF.prog = SX.active; XF.path = []; save(); }
    XF.path = XF.path.filter(id => SX.X.W[id]);
    const levels = [];
    let parent = '';
    for (let i = 0; i <= XF.path.length; i++) {
      const opts = (c.kids[parent] || []);
      if (!opts.length) break;
      levels.push({ sel: XF.path[i] || '', opts });
      if (!XF.path[i]) break;
      parent = XF.path[i];
    }
    el.innerHTML = `<div class="prog-bar"></div><div class="xf card">
      <div class="xf-row"><span class="xf-l">WBS</span><div class="xf-path">${levels.map((l, i) => `<select data-lv="${i}"><option value="">${i ? 'All under ' + esc(SX.X.W[XF.path[i - 1]].name) : 'Whole project'}</option>${l.opts.map(w => `<option value="${esc(w.id)}" ${w.id === l.sel ? 'selected' : ''}>${esc(w.code)} — ${esc(w.name)}</option>`).join('')}</select>`).join('<span class="xf-arrow">›</span>')}</div></div>
      <div class="xf-row"><span class="xf-l">Activities</span><input type="search" class="xf-kw" placeholder="Name contains… (comma = or, -word = exclude) e.g. concrete, -bituminous" value="${esc(XF.kw)}">
        <select class="xf-st"><option value="">All status</option><option value="NotStart">Not started</option><option value="Active">In progress</option><option value="Complete">Completed</option></select>
        <select class="xf-lane"><option value="">Both lanes</option><option value="Left">Left Lane</option><option value="Right">Right Lane</option></select>
        <label class="chk"><input type="checkbox" class="xf-crit" ${XF.crit ? 'checked' : ''}> Critical only</label>
        <button class="btn ghost xf-reset">Reset</button></div>
      <div class="xf-row"><span class="xf-l"></span><div class="xf-chips">${CHIPS.map(k => `<button class="chip ${XF.kw.toLowerCase().split(',').map(t => t.trim()).includes(k.toLowerCase()) ? 'on' : ''}" data-chip="${k}" ${SYN[k.toLowerCase()] ? `title="Includes: ${SYN[k.toLowerCase()].join(', ')}"` : ''}>${k}${SYN[k.toLowerCase()] ? ' <span class=\'chip-plus\'>+' + SYN[k.toLowerCase()].slice(-1)[0].replace(/^./, ch => ch.toUpperCase()) + '</span>' : ''}</button>`).join('')}</div></div>
    </div>`;
    el.querySelector('.xf-st').value = XF.st; el.querySelector('.xf-lane').value = XF.lane;
    const go = () => { save(); refresh(); };
    el.querySelectorAll('[data-lv]').forEach(s => s.onchange = () => { const i = +s.dataset.lv; XF.path = XF.path.slice(0, i); if (s.value) XF.path.push(s.value); go(); });
    el.querySelector('.xf-kw').oninput = e => { XF.kw = e.target.value; clearTimeout(filterBar.t); filterBar.t = setTimeout(go, 300); };
    el.querySelector('.xf-st').onchange = e => { XF.st = e.target.value; go(); };
    el.querySelector('.xf-lane').onchange = e => { XF.lane = e.target.value; go(); };
    el.querySelector('.xf-crit').onchange = e => { XF.crit = e.target.checked; go(); };
    el.querySelector('.xf-reset').onclick = () => { Object.assign(XF, { path: [], kw: '', st: '', lane: '', crit: false }); go(); };
    el.querySelectorAll('[data-chip]').forEach(b => b.onclick = () => {
      const k = b.dataset.chip.toLowerCase(), terms = XF.kw.split(',').map(t => t.trim()).filter(Boolean);
      const has = terms.some(t => t.toLowerCase() === k);
      XF.kw = (has ? terms.filter(t => t.toLowerCase() !== k) : [...terms, b.dataset.chip]).join(', ');
      go();
    });
    SX.renderProgBars();
  }
  const filterLabel = () => {
    const p = XF.path.map(id => SX.X.W[id]).filter(Boolean).map(w => w.name).join(' › ') || 'Whole project';
    return p + (XF.kw ? ` · “${XF.kw}”` : '') + (XF.st ? ' · ' + XF.st : '') + (XF.lane ? ' · ' + XF.lane + ' Lane' : '') + (XF.crit ? ' · critical' : '');
  };

  // ---------------- statistics for a list of activities ----------------
  function stats(list) {
    const X = SX.X, dd = X.dd;
    let wt = 0, ev = 0, pv = 0, b0 = Infinity, b1 = -Infinity, s0 = Infinity, s1 = -Infinity, crit = 0, late = 0;
    list.forEach(a => {
      wt += a.wt; ev += a.wt * a.p / 100;
      if (a.wt && a.bs !== null && a.bf !== null) pv += a.wt * Math.max(0, Math.min(1, (dd - a.bs + DAY) / (a.bf - a.bs + DAY)));
      if (a.bs !== null) b0 = Math.min(b0, a.bs); if (a.bf !== null) b1 = Math.max(b1, a.bf);
      if (a.s !== null) s0 = Math.min(s0, a.s); if (a.f !== null) s1 = Math.max(s1, a.f);
      if (SX.critical(a)) crit++;
      if (!SX.isDone(a) && (SX.finVar(a) || 0) > 0) late++;
    });
    // weight-less selections (milestones only, no cost) fall back to activity counts
    const byCount = !wt && list.length;
    const plan = byCount ? list.filter(a => a.bf !== null && a.bf <= dd).length / list.length * 100 : wt ? pv / wt * 100 : 0;
    const act = byCount ? list.reduce((s, a) => s + a.p, 0) / list.length : wt ? ev / wt * 100 : 0;
    return { n: list.length, done: list.filter(SX.isDone).length, active: list.filter(SX.isActive).length, wt, ev, pv, plan, act, spi: plan ? act / plan : null,
      bStart: isFinite(b0) ? b0 : null, bFinish: isFinite(b1) ? b1 : null, start: isFinite(s0) ? s0 : null, finish: isFinite(s1) ? s1 : null, crit, late, value: wt * X.k, byCount };
  }
  function curve(list) {
    const X = SX.X, pv = {}, fc = {};
    let ev = 0, wt = 0;
    list.forEach(a => {
      if (!a.wt) return;
      wt += a.wt; ev += a.wt * a.p / 100;
      SX.spread(pv, a.wt, a.bs, a.bf);
      if (a.p < 100) SX.spread(fc, a.wt * (1 - a.p / 100), a.s ?? X.dd, a.f ?? X.dd, X.dd + DAY);
    });
    const keys = [...new Set([...Object.keys(pv), ...Object.keys(fc)])].sort();
    const cur = SX.mk(X.dd);
    let cp = 0, cf = ev;
    const P = [], F = [];
    keys.forEach(k => { cp += pv[k] || 0; P.push(wt ? +(cp / wt * 100).toFixed(2) : null); if (k >= cur) { cf += fc[k] || 0; F.push(wt ? +(cf / wt * 100).toFixed(2) : null); } else F.push(null); });
    return { keys, P, F, now: wt ? ev / wt * 100 : 0 };
  }
  function drawCurve(id, list, title) {
    const c = curve(list);
    if (!c.keys.length) return;
    const base = A.baseOpts;
    mkChart(id, { type: 'line', data: { labels: c.keys.map(SX.monthLabel), datasets: [
      { label: 'Planned (baseline)', data: c.P, borderColor: col('--s2'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: .3 },
      { label: 'Forecast (update)', data: c.F, borderColor: col('--s3'), borderWidth: 2.5, pointRadius: 0, tension: .3 },
      { label: 'Actual at cut-off', data: c.keys.map(k => k === SX.mk(SX.X.dd) ? +c.now.toFixed(2) : null), borderColor: col('--s1'), backgroundColor: col('--s1'), pointRadius: 6, showLine: false }] },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, max: 100, ticks: { color: col('--text-2'), callback: v => v + '%' } } }, plugins: { ...base().plugins, title: title ? { display: true, text: title, color: col('--text-2'), align: 'start' } : undefined, tooltip: { ...base().plugins.tooltip, callbacks: { label: x => `${x.dataset.label}: ${fmtP(x.parsed.y, 2)}` } } } }) });
  }
  const K = (l, v, h, extra = '') => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div>${h ? `<div class="hint">${h}</div>` : ''}${extra}</div>`;

  // ---------------- OVERVIEW (site progress) ----------------
  function renderOverview() {
    const host = $('#ovBody');
    if (!host) return;
    if (!SX.S) { host.innerHTML = '<div class="card empty"><h3>Loading P6 programme…</h3></div>'; return; }
    const S = SX.S, X = SX.X, dd = X.dd, c = ix();
    const l1 = (c.kids[''] || []).map(w => ({ w, st: stats(S.acts.filter(a => SX.wbsSet(w.id).has(a.w))) })).filter(r => r.st.n);
    const J = SX.junctions();
    const wk = window.WEEKLY && window.WEEKLY.latest();
    const la = S.acts.filter(a => !SX.isDone(a) && a.s !== null && a.s <= dd + 28 * DAY && (a.f ?? a.s) >= dd);
    host.innerHTML = `
      <div class="grid g-2-1">
        <div class="card"><div class="card-h"><h3>Physical progress — ${esc(SX.prog(SX.active).name)}</h3><span class="muted">P6 cost-weighted % · weekly-report actuals as dots</span></div><div class="chart-box tall"><canvas id="ovCurve"></canvas></div></div>
        <div class="card">
          <div class="card-h"><h3>Latest weekly report</h3>${wk ? `<button class="btn ghost" data-go="weekly">Open ›</button>` : ''}</div>
          ${wk ? `<div class="muted small" style="margin-bottom:10px">${esc(wk.label)} · progress dated ${fd(Date.parse(wk.dated))}</div>
          <div class="dtiles ov-tiles">
            <div class="dtile"><div class="lbl">Planned (report)</div><div class="v">${fmtP(wk.planned)}</div></div>
            <div class="dtile"><div class="lbl">Actual (report)</div><div class="v">${fmtP(wk.actual)}</div><div class="muted small">var ${wk.varWeek !== null && wk.varWeek !== undefined ? wk.varWeek.toFixed(2) + '%' : '—'}</div></div>
            <div class="dtile"><div class="lbl">This week</div><div class="v">${fmtP(wk.wkAct)}</div><div class="muted small">planned ${fmtP(wk.wkPlan)}</div></div>
            <div class="dtile"><div class="lbl">Report forecast finish</div><div class="v">${wk.forecastFinish ? fd(Date.parse(wk.forecastFinish)) : '—'}</div></div>
            <div class="dtile"><div class="lbl">Manpower / day</div><div class="v">${wk.manpower ? Math.round(wk.manpower).toLocaleString() : '—'}</div><div class="muted small">equipment ${wk.equipment ? Math.round(wk.equipment) : '—'}</div></div>
            <div class="dtile"><div class="lbl">Open RFIs · risks</div><div class="v">${wk.rfiOpen ?? '—'} · ${wk.risks}</div></div>
          </div>` : '<p class="muted">No weekly report published yet.</p>'}
        </div>
      </div>
      <div class="grid g-1-1">
        <div class="card"><div class="card-h"><h3>Progress by WBS</h3><span class="muted">Click a row to open it in the P6 Explorer</span></div>
          ${SX.tbl([['WBS'], ['Planned'], ['Actual'], ['SPI', 1], ['Forecast finish']], l1.map(r => `<tr class="click" data-xopen="${esc(r.w.id)}"><td><b>${esc(r.w.code)}</b> ${esc(r.w.name)}</td><td>${pbar(r.st.plan)}</td><td>${pbar(r.st.act, r.st.plan)}</td><td class="n">${spiTag(r.st.spi)}</td><td>${fd(r.st.finish)}</td></tr>`))}</div>
        <div class="card"><div class="card-h"><h3>Junctions</h3><button class="btn ghost" data-go="junctions">Open ›</button></div>
          ${SX.tbl([['Junction'], ['Actual · ▏planned'], ['SPI', 1], ['Forecast finish']], J.map(j => `<tr class="click" data-go="junctions"><td><b>${j.name}</b> <span class="muted small">Ch ${esc(j.ch)}</span></td><td>${pbar(j.st.act, j.st.plan)}</td><td class="n">${spiTag(j.st.spi)}</td><td>${fd(j.st.finish)}</td></tr>`))}
          <div class="ov-la click" data-go="schedule"><b>${la.length.toLocaleString()}</b> activities in the next 4 weeks · ${la.filter(a => !a.as).length} to start · ${la.filter(a => a.f !== null && a.f <= dd + 28 * DAY).length} to finish · ${la.filter(SX.critical).length} critical <span class="muted">› Schedule</span></div>
        </div>
      </div>`;
    // curve with weekly-report points
    const cv = curve(S.acts);
    const pts = (window.WEEKLY ? window.WEEKLY.perfPoints() : []);
    const wkAct = cv.keys.map(k => { const p = pts.filter(x => x.date.slice(0, 7) === k).pop(); return p ? p.actual : null; });
    const base = A.baseOpts;
    mkChart('ovCurve', { type: 'line', data: { labels: cv.keys.map(SX.monthLabel), datasets: [
      { label: 'Planned (baseline)', data: cv.P, borderColor: col('--s2'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: .3 },
      { label: 'Forecast (P6 update)', data: cv.F, borderColor: col('--s3'), borderWidth: 2.5, pointRadius: 0, tension: .3 },
      { label: 'Actual at P6 cut-off', data: cv.keys.map(k => k === SX.mk(dd) ? +cv.now.toFixed(2) : null), borderColor: col('--s1'), backgroundColor: col('--s1'), pointRadius: 6, showLine: false },
      { label: 'Actual (weekly report)', data: wkAct, borderColor: col('--s4'), backgroundColor: col('--s4'), pointRadius: 5, pointStyle: 'rectRot', showLine: false }] },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, max: 100, ticks: { color: col('--text-2'), callback: v => v + '%' } } }, plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: x => `${x.dataset.label}: ${fmtP(x.parsed.y, 2)}` } } } }) });
  }

  // ---------------- P6 EXPLORER ----------------
  const EX = { sort: 'value', dir: -1 };
  let exRows = [];
  function renderExplorer() {
    const bar = $('.xf-bar[data-xf="explorer"]'), host = $('#exBody');
    if (!host) return;
    if (!SX.S) { host.innerHTML = '<div class="card empty"><h3>Loading P6 programme…</h3></div>'; return; }
    filterBar(bar);
    const list = selection(), st = stats(list), X = SX.X, c = ix();
    const slip = st.finish && st.bFinish ? Math.round((st.finish - st.bFinish) / DAY) : null;
    const last = XF.path[XF.path.length - 1];
    const children = (c.kids[last || ''] || []);
    const kt = kwTest();
    const childRows = children.map(w => { const set = SX.wbsSet(w.id); return { w, st: stats(list.filter(a => set.has(a.w))) }; }).filter(r => r.st.n);
    host.innerHTML = `<div class="xf-sum muted">${esc(filterLabel())} — data date ${fd(X.dd)}</div>
      <div class="kpis">
        ${K('Activities', st.n.toLocaleString(), `✓ ${st.done} done · ▶ ${st.active} active · ○ ${st.n - st.done - st.active} not started`)}
        ${K('Planned at cut-off', fmtP(st.plan, 2), st.byCount ? 'By activity count (no cost loaded)' : 'Cost-weighted', '')}
        ${K('Actual', fmtP(st.act, 2), `Variance ${(st.act - st.plan >= 0 ? '+' : '') + (st.act - st.plan).toFixed(2)}%`, `<div class="bar"><i style="width:${Math.min(100, st.act)}%"></i></div>`)}
        ${K('SPI', st.spi ? st.spi.toFixed(2) : '—', '', spiTag(st.spi))}
        ${K('Baseline', fd(st.bStart) + ' → ' + fd(st.bFinish), '')}
        ${K('Forecast finish', fd(st.finish), slip !== null ? (slip > 0 ? `+${slip} d late` : slip < 0 ? `${-slip} d early` : 'on baseline') : '')}
        ${K('Value (P6 budget)', fmtM(st.value) + '<small>SAR</small>', `${fmtP(st.wt / (SX.S.meta.bac || 1) * 100, 2)} of the project`)}
        ${K('Late · critical', `${st.late.toLocaleString()} · ${st.crit.toLocaleString()}`, 'Open late vs baseline · TF ≤ 0')}
      </div>
      <div class="grid g-2-1">
        <div class="card"><div class="card-h"><h3>Progress curve — selection</h3></div><div class="chart-box"><canvas id="exCurve"></canvas></div></div>
        <div class="card"><div class="card-h"><h3>Status</h3></div><div class="chart-box"><canvas id="exStatus"></canvas></div></div>
      </div>
      ${childRows.length ? `<div class="card"><div class="card-h"><h3>Breakdown — ${last ? esc(X.W[last].name) : 'project'}</h3><span class="muted">Click to drill down</span></div>
        ${SX.tbl([['WBS'], ['Activities', 1], ['Planned'], ['Actual · ▏planned'], ['SPI', 1], ['BL finish'], ['Forecast finish'], ['Value (SAR)', 1]], childRows.map(r => `<tr class="click" data-xdrill="${esc(r.w.id)}"><td><b>${esc(r.w.code)}</b> ${esc(r.w.name)}</td><td class="n">${r.st.n}</td><td>${fmtP(r.st.plan, 1)}</td><td>${pbar(r.st.act, r.st.plan)}</td><td class="n">${spiTag(r.st.spi)}</td><td>${fd(r.st.bFinish)}</td><td class="${r.st.finish > r.st.bFinish ? 'neg' : ''}">${fd(r.st.finish)}</td><td class="n">${fmt(r.st.value, 0)}</td></tr>`))}</div>` : ''}
      <div class="card"><div class="card-h"><h3>Activities (${list.length.toLocaleString()})</h3><div><button class="btn ghost" id="exCsv">⬇ CSV</button></div></div><div id="exTable"></div></div>`;
    exRows = list;
    drawExTable();
    $('#exCsv').onclick = exCsv;
    drawCurve('exCurve', list);
    const base = A.baseOpts;
    const ns = st.n - st.done - st.active;
    mkChart('exStatus', { type: 'doughnut', data: { labels: ['Completed', 'In progress', 'Not started'], datasets: [{ data: [st.done, st.active, ns], backgroundColor: [col('--good'), col('--s1'), col('--grid')], borderColor: col('--surface'), borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: col('--text-2'), boxWidth: 12 } } },
        onClick: (e, els) => { if (els.length) { XF.st = ['Complete', 'Active', 'NotStart'][els[0].index]; save(); refresh(); } } } });
  }
  const COLS = [['c', 'ID'], ['n', 'Activity'], ['wbs', 'WBS'], ['st', 'Status'], ['bs', 'BL start'], ['bf', 'BL finish'], ['s', 'Start'], ['f', 'Finish'], ['d', 'Orig dur', 1], ['rd', 'Rem dur', 1], ['p', '%', 1], ['tf', 'TF', 1], ['fv', 'Var d', 1], ['value', 'Value (SAR)', 1], ['res', 'Resources', 1]];
  function exVal(a, k) {
    const X = SX.X, c = ix();
    switch (k) { case 'wbs': return (X.W[a.w] || {}).name || ''; case 'fv': return SX.finVar(a); case 'value': return a.wt * X.k; case 'res': return (c.raByAct[c.actIdx[a.c]] || []).length; default: return a[k]; }
  }
  function drawExTable() {
    const k = EX.sort, d = EX.dir;
    const rows = [...exRows].sort((x, y) => {
      const a = exVal(x, k), b = exVal(y, k);
      if (a === null || a === undefined || a === '') return 1;
      if (b === null || b === undefined || b === '') return -1;
      return (typeof a === 'string' ? a.localeCompare(String(b), undefined, { numeric: true }) : a - b) * d;
    });
    const show = rows.slice(0, 1000);
    $('#exTable').innerHTML = `${rows.length > show.length ? `<p class="muted small">Showing 1,000 of ${rows.length.toLocaleString()} — refine the filter or download the CSV.</p>` : ''}<div class="table-wrap tall"><table class="tbl"><thead><tr>${COLS.map(([key, l, n]) => `<th class="${n ? 'n' : ''}" data-sort="${key}">${l}${EX.sort === key ? (EX.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>` +
      show.map(a => { const fv = SX.finVar(a); return `<tr class="click" data-act="${esc(a.c)}"><td><b>${esc(a.c)}</b></td><td class="desc">${esc(a.n)}</td><td class="small">${esc(exVal(a, 'wbs'))}</td><td>${SX.stTag(a)}</td><td>${fd(a.bs)}</td><td>${fd(a.bf)}</td><td>${fd(a.s)}${a.as ? '<span class="muted small"> A</span>' : ''}</td><td>${fd(a.f)}${a.af ? '<span class="muted small"> A</span>' : ''}</td><td class="n">${a.d}</td><td class="n">${a.rd}</td><td class="n"><b>${Math.round(a.p)}%</b></td><td class="n ${a.tf !== null && a.tf <= 0 && !SX.isDone(a) ? 'neg' : ''}">${a.tf === null || SX.isDone(a) ? '—' : Math.round(a.tf)}</td><td class="n ${fv > 0 ? 'neg' : ''}">${fv === null ? '—' : (fv > 0 ? '+' : '') + fv}</td><td class="n">${fmt(a.wt * SX.X.k, 0)}</td><td class="n">${exVal(a, 'res')}</td></tr>`; }).join('') + '</tbody></table></div>';
    $$('#exTable th[data-sort]').forEach(th => th.onclick = () => { const s = th.dataset.sort; EX.dir = EX.sort === s ? -EX.dir : (['c', 'n', 'wbs', 'st', 'bs', 'bf', 's', 'f'].includes(s) ? 1 : -1); EX.sort = s; drawExTable(); });
  }
  const csvDl = (name, head, rows) => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const blob = new Blob(['﻿' + [head.map(q).join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n')], { type: 'text/csv' });
    const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = name; l.click();
  };
  function exCsv() {
    const X = SX.X;
    csvDl('p6-explorer.csv', ['Activity ID', 'Activity', 'WBS code', 'WBS', 'Status', 'BL start', 'BL finish', 'Start', 'Finish', 'Actual start', 'Actual finish', 'Orig dur (d)', 'Rem dur (d)', '% complete', 'Total float (d)', 'Finish var (d)', 'Value (SAR)', 'Resources'],
      exRows.map(a => [a.c, a.n, (X.W[a.w] || {}).code, (X.W[a.w] || {}).name, a.st, ds(a.bs), ds(a.bf), ds(a.s), ds(a.f), ds(a.as), ds(a.af), a.d, a.rd, a.p, a.tf, SX.finVar(a), Math.round(a.wt * X.k), exVal(a, 'res')]));
  }

  // ---------------- RESOURCES ----------------
  const RS = { kind: 'L', q: '', sort: 'tq', dir: -1 };
  let rsAgg = [];
  const KIND = { L: 'Labour', E: 'Equipment', M: 'Material' };
  function aggregate(list) {
    const S = SX.S, c = ix(), dd = SX.X.dd / DAY;
    const by = {};
    list.forEach(a => (c.raByAct[c.actIdx[a.c]] || []).forEach(i => {
      const r = S.ra[i], rs = S.rl[r[1]];
      if (!rs) return;
      const g = by[r[1]] || (by[r[1]] = { ri: r[1], code: rs[0], name: rs[1], k: rs[2], u: rs[3] || '', tq: 0, aq: 0, rq: 0, cost: 0, acts: new Set(), s: Infinity, f: -Infinity, rows: [] });
      g.tq += r[2]; g.aq += r[3]; g.rq += r[4]; g.cost += r[6]; g.acts.add(r[0]); g.rows.push(i);
      if (r[7] !== null) g.s = Math.min(g.s, r[7]); if (r[8] !== null) g.f = Math.max(g.f, r[8]);
    }));
    return Object.values(by).map(g => {
      // remaining spread by month → busiest month crew (labour / equipment hours ÷ 10 h ÷ working days)
      const m = monthly(g.rows);
      const peak = Math.max(0, ...Object.entries(m).map(([k, h]) => h / (HPD * daysIn(k) * WD)));
      const remDays = g.f > dd ? (g.f - Math.max(dd, g.s)) + 1 : 0;
      return { ...g, n: g.acts.size, avgCrew: g.k !== 'M' && remDays > 0 ? g.rq / (HPD * remDays * WD) : null, peakCrew: g.k !== 'M' ? peak : null, months: m };
    });
  }
  const daysIn = k => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).getUTCDate();
  function monthly(rows) {
    const S = SX.S, dd = SX.X.dd, out = {};
    rows.forEach(i => { const r = S.ra[i]; if (r[4] > 0 && r[7] !== null && r[8] !== null) SX.spread(out, r[4], r[7] * DAY, r[8] * DAY, dd); });
    return out;
  }
  function renderResources() {
    const bar = $('.xf-bar[data-xf="resources"]'), host = $('#rsBody');
    if (!host) return;
    if (!SX.S) { host.innerHTML = '<div class="card empty"><h3>Loading P6 programme…</h3></div>'; return; }
    filterBar(bar);
    if (!SX.S.ra) { host.innerHTML = '<div class="card empty"><h3>This programme file has no resource data</h3><p>Re-import the XER (Import tab) to add it.</p></div>'; return; }
    const list = selection();
    rsAgg = aggregate(list);
    const sum = k => rsAgg.filter(g => g.k === k);
    const hrs = (k, f) => sum(k).reduce((s, g) => s + g[f], 0);
    host.innerHTML = `<div class="xf-sum muted">${esc(filterLabel())} — ${list.length.toLocaleString()} activities · resources assigned in P6</div>
      <div class="kpis">
        ${K('Labour', `${sum('L').length} trades`, `${fmt(hrs('L', 'tq'), 0)} h budget · ${fmt(hrs('L', 'rq'), 0)} h remaining`)}
        ${K('Labour spent', fmtP(hrs('L', 'tq') ? (hrs('L', 'tq') - hrs('L', 'rq')) / hrs('L', 'tq') * 100 : 0, 1), 'Budget hours not remaining')}
        ${K('Equipment', `${sum('E').length} types`, `${fmt(hrs('E', 'tq'), 0)} h budget · ${fmt(hrs('E', 'rq'), 0)} h remaining`)}
        ${K('Materials', `${sum('M').length} items`, 'Quantities in the P6 units')}
        ${K('Resource cost (P6)', fmtM(rsAgg.reduce((s, g) => s + g.cost, 0)) + '<small>SAR</small>', 'Budget cost on the assignments')}
      </div>
      <div class="card"><div class="card-h"><h3>Remaining demand by month</h3><div class="seg" id="rsChartKind"><button data-k="L">Labour (crew/day)</button><button data-k="E">Equipment (units/day)</button></div></div><div class="chart-box tall"><canvas id="rsMonthly"></canvas></div></div>
      <div class="card"><div class="card-h"><h3>Resources on the selected activities</h3>
        <div class="g-toolbar" style="margin:0"><div class="seg" id="rsKind"><button data-k="">All</button><button data-k="L">Labour</button><button data-k="E">Equipment</button><button data-k="M">Material</button></div>
        <input type="search" id="rsQ" placeholder="Search resource…" value="${esc(RS.q)}"><button class="btn ghost" id="rsCsv">⬇ CSV</button></div></div>
        <div id="rsTable"></div>
        <p class="muted small">Crew/day = remaining hours ÷ 10 h ÷ working days (6-day week). Busiest month uses the remaining hours spread over each assignment's remaining dates.</p></div>`;
    $$('#rsKind button').forEach(b => { b.classList.toggle('on', b.dataset.k === RS.kind); b.onclick = () => { RS.kind = b.dataset.k; renderRsTable(); $$('#rsKind button').forEach(x => x.classList.toggle('on', x === b)); }; });
    $('#rsQ').oninput = e => { RS.q = e.target.value; renderRsTable(); };
    $('#rsCsv').onclick = () => csvDl('p6-resources.csv', ['Type', 'Code', 'Resource', 'Unit', 'Activities', 'Budget qty', 'Actual qty', 'Remaining qty', 'Budget cost (SAR)', 'Avg crew/day (remaining)', 'Busiest month crew/day', 'First start', 'Last finish'],
      rsRows().map(g => [KIND[g.k], g.code, g.name, g.u, g.n, g.tq.toFixed(1), g.aq.toFixed(1), g.rq.toFixed(1), Math.round(g.cost), g.avgCrew === null ? '' : g.avgCrew.toFixed(1), g.peakCrew === null ? '' : g.peakCrew.toFixed(1), ds(g.s * DAY), ds(g.f * DAY)]));
    renderRsTable();
    const kindChart = RS.chartKind || 'L';
    $$('#rsChartKind button').forEach(b => { b.classList.toggle('on', b.dataset.k === kindChart); b.onclick = () => { RS.chartKind = b.dataset.k; drawRsChart(); $$('#rsChartKind button').forEach(x => x.classList.toggle('on', x === b)); }; });
    drawRsChart();
  }
  function rsRows() {
    const q = RS.q.trim().toLowerCase();
    return rsAgg.filter(g => (!RS.kind || g.k === RS.kind) && (!q || (g.code + ' ' + g.name).toLowerCase().includes(q)));
  }
  function renderRsTable() {
    const k = RS.sort, d = RS.dir;
    const rows = rsRows().sort((x, y) => ((x[k] ?? -1) > (y[k] ?? -1) ? 1 : (x[k] ?? -1) < (y[k] ?? -1) ? -1 : 0) * d);
    const cols = [['k', 'Type'], ['code', 'Code'], ['name', 'Resource'], ['u', 'Unit'], ['n', 'Activities', 1], ['tq', 'Budget', 1], ['aq', 'Actual', 1], ['rq', 'Remaining', 1], ['spent', 'Spent', 1], ['avgCrew', 'Avg crew/day', 1], ['peakCrew', 'Busiest month /day', 1], ['s', 'First start'], ['f', 'Last finish'], ['cost', 'Cost (SAR)', 1]];
    $('#rsTable').innerHTML = `<div class="table-wrap tall"><table class="tbl"><thead><tr>${cols.map(([key, l, n]) => `<th class="${n ? 'n' : ''}" data-rsort="${key}">${l}${RS.sort === key ? (RS.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>` +
      (rows.map(g => `<tr class="click" data-rsrc="${g.ri}"><td>${KIND[g.k]}</td><td><b>${esc(g.code)}</b></td><td>${esc(g.name)}</td><td>${esc(g.u)}</td><td class="n">${g.n}</td><td class="n">${fmt(g.tq, 0)}</td><td class="n">${fmt(g.aq, 0)}</td><td class="n"><b>${fmt(g.rq, 0)}</b></td><td class="n">${g.tq ? fmtP((g.tq - g.rq) / g.tq * 100, 0) : '—'}</td><td class="n">${g.avgCrew === null ? '—' : fmt(g.avgCrew, 1)}</td><td class="n">${g.peakCrew === null ? '—' : fmt(g.peakCrew, 1)}</td><td>${fd(g.s * DAY)}</td><td>${fd(g.f * DAY)}</td><td class="n">${g.cost ? fmt(g.cost, 0) : '—'}</td></tr>`).join('') || `<tr><td colspan="${cols.length}" class="muted">No resources on these activities</td></tr>`) + '</tbody></table></div>';
    $$('#rsTable th[data-rsort]').forEach(th => th.onclick = () => { const s = th.dataset.rsort; RS.dir = RS.sort === s ? -RS.dir : -1; RS.sort = s; renderRsTable(); });
  }
  function drawRsChart() {
    const kind = RS.chartKind || 'L';
    const groups = rsAgg.filter(g => g.k === kind).sort((a, b) => b.rq - a.rq);
    const top = groups.slice(0, 6), rest = groups.slice(6);
    const keys = [...new Set(groups.flatMap(g => Object.keys(g.months)))].sort().slice(0, 36);
    const perDay = (m, k) => (m[k] || 0) / (HPD * daysIn(k) * WD);
    const pal = ['--s1', '--s2', '--s3', '--s4', '--s1', '--s2'].map(col);
    const ds_ = top.map((g, i) => ({ label: g.name, data: keys.map(k => +perDay(g.months, k).toFixed(1)), backgroundColor: pal[i] + (i >= 4 ? '99' : ''), stack: 's', maxBarThickness: 28 }));
    if (rest.length) ds_.push({ label: `Other (${rest.length})`, data: keys.map(k => +rest.reduce((s, g) => s + perDay(g.months, k), 0).toFixed(1)), backgroundColor: col('--muted'), stack: 's', maxBarThickness: 28 });
    const base = A.baseOpts;
    mkChart('rsMonthly', { type: 'bar', data: { labels: keys.map(SX.monthLabel), datasets: ds_ },
      options: base({ scales: { x: { ...base().scales.x, stacked: true }, y: { ...base().scales.y, stacked: true } }, plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: x => `${x.dataset.label}: ${fmt(x.parsed.y, 1)} /day` } } } }) });
  }
  function rsDetail(ri) {
    const g = rsAgg.find(x => x.ri === ri), S = SX.S, X = SX.X;
    if (!g) return { title: 'Resource', body: '' };
    const rows = g.rows.map(i => S.ra[i]).sort((a, b) => b[4] - a[4] || b[2] - a[2]);
    return {
      title: `${esc(g.code)} — ${esc(g.name)}`, sub: `${KIND[g.k]} · ${esc(filterLabel())}`,
      body: `<div class="dtiles">${[['Activities', g.n], ['Budget', fmt(g.tq, 0) + ' ' + esc(g.u)], ['Actual', fmt(g.aq, 0)], ['Remaining', fmt(g.rq, 0)], ['Avg crew/day (remaining)', g.avgCrew === null ? '—' : fmt(g.avgCrew, 1)], ['Busiest month /day', g.peakCrew === null ? '—' : fmt(g.peakCrew, 1)], ['First start → last finish', fd(g.s * DAY) + ' → ' + fd(g.f * DAY)], ['Budget cost', g.cost ? 'SAR ' + fmt(g.cost, 0) : '—']].map(([l, v]) => `<div class="dtile"><div class="lbl">${l}</div><div class="v">${v}</div></div>`).join('')}</div>` +
        SX.tbl([['Activity'], ['WBS'], ['Status'], ['Budget', 1], ['Actual', 1], ['Remaining', 1], ['Units/h', 1], ['Start'], ['Finish']], rows.slice(0, 800).map(r => { const a = S.acts[r[0]]; return `<tr class="click" data-act="${esc(a.c)}"><td><b>${esc(a.c)}</b><div class="small muted">${esc(a.n)}</div></td><td class="small">${esc((X.W[a.w] || {}).name || '')}</td><td>${SX.stTag(a)}</td><td class="n">${fmt(r[2], 0)}</td><td class="n">${fmt(r[3], 0)}</td><td class="n"><b>${fmt(r[4], 0)}</b></td><td class="n">${r[5] || '—'}</td><td>${fd(r[7] * DAY)}</td><td>${fd(r[8] * DAY)}</td></tr>`; }))
    };
  }

  // ---------------- wiring ----------------
  document.addEventListener('click', e => {
    const d = e.target.closest('[data-xdrill]');
    if (d) { XF.path.push(d.dataset.xdrill); save(); refresh(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const o = e.target.closest('[data-xopen]');
    if (o) { open(o.dataset.xopen); return; }
    const g = e.target.closest('[data-go]');
    if (g) { A.showTab(g.dataset.go); return; }
    const r = e.target.closest('[data-rsrc]');
    if (r) A.Details.open(() => rsDetail(+r.dataset.rsrc));
  });
  function open(wbsId) {
    const X = SX.X;
    if (!X || !X.W[wbsId]) return;
    XF.prog = SX.active;
    XF.path = X.wbsPath(wbsId).map(w => w.id);
    Object.assign(XF, { kw: '', st: '', lane: '', crit: false });
    save();
    A.showTab('explorer');
  }
  function refresh() {
    const t = document.querySelector('.tab.active');
    const n = t ? t.dataset.tab : '';
    if (n === 'overview') renderOverview();
    if (n === 'explorer') renderExplorer();
    if (n === 'resources') renderResources();
  }
  window.XPL = { refresh, open };
  SX.onChange(refresh);
  const prev = A.onTab;
  A.onTab = n => { if (prev) prev(n); if (n === 'overview' || n === 'explorer' || n === 'resources') refresh(); };
})();
