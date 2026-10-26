/* Forecast-to-date (any future date), resource feasibility against the site manpower / equipment sheet,
   and the schedule logic check. Works on the active P6 programme (see schedule.js). */
(function () {
  'use strict';
  const A = window.APP, SX = window.SCHEDX;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = A.esc, fmt = A.fmt, fmtM = A.fmtM, fmtP = A.fmtP;
  const DAY = 864e5, HPD = 10, DPW = 6;          // 6 days x 10 h site calendar
  const charts = {};
  const clamp = v => Math.max(0, Math.min(1, v));
  const pdate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const fd = SX.fd, ds = SX.ds;

  // P6 resource → site sheet rows (one pool can hold several P6 codes / several sheet rows)
  const POOLS = [
    { id: 'Labor', k: 'L', p6: ['LBR'], site: /^labou?r$/i },
    { id: 'Mason', k: 'L', p6: ['MAS'], site: /mason/i },
    { id: 'Carpenter', k: 'L', p6: ['CAR'], site: /carpenter/i },
    { id: 'Steel fixer', k: 'L', p6: ['STF'], site: /steel fixer|binder/i },
    { id: 'Electrician', k: 'L', p6: ['ELCN'], site: /^electrician/i },
    { id: 'Pipe fitter / plumber', k: 'L', p6: ['PPF'], site: /plumber|pipe ?fitter/i },
    { id: 'Scaffolder', k: 'L', p6: ['SAF'], site: /scaffold/i },
    { id: 'HVAC technician', k: 'L', p6: ['HVAC'], site: /hvac/i },
    { id: 'Excavator / rock breaker', k: 'E', p6: ['EXT', 'RBR'], site: /excavator\/hammer|^excavator$|breaker/i },
    { id: 'Dump truck', k: 'E', p6: ['DOT', 'DPT'], site: /dump truck/i },
    { id: 'Compactor', k: 'E', p6: ['CMP', 'CMR'], site: /^compactor|plate compactor/i },
    { id: 'Boom truck (HIAB)', k: 'E', p6: ['BOT'], site: /boom truck|haib|hiab/i },
    { id: 'Mobile crane 50 t', k: 'E', p6: ['50C', '50T'], site: /crane 50/i },
    { id: 'Mobile crane 120 t', k: 'E', p6: ['120T'], site: /crane 120/i },
    { id: 'Flatbed trailer', k: 'E', p6: ['FBT'], site: /flat ?bed/i },
    { id: 'Manlift', k: 'E', p6: ['MAN'], site: /man ?lift/i },
    { id: 'Mini excavator', k: 'E', p6: ['MEX'], site: /mini excavator/i },
    { id: 'Loader', k: 'E', p6: ['WHL', 'WLO', 'LDR'], site: /wheel loader|^loader$/i },
    { id: 'Roller', k: 'E', p6: ['DRR', 'HRR', 'RLR', 'PTR'], site: /roller/i },
    { id: 'Backhoe loader', k: 'E', p6: ['BCL', 'CHL'], site: /backhoe/i },
    { id: 'Water truck', k: 'E', p6: ['WAT'], site: /water truck/i },
    { id: 'Grader', k: 'E', p6: ['GDR'], site: /grader/i },
    { id: 'Spray tanker (prime / tack)', k: 'E', p6: ['SPT'], site: /spray/i },
    { id: 'Concrete pump', k: 'E', p6: ['COP'], site: /concrete pump/i },
    { id: 'Paver', k: 'E', p6: ['PAV'], site: /^paver/i },
    { id: 'Dozer', k: 'E', p6: ['DOZ'], site: /dozer/i },
    { id: 'Asphalt feeder', k: 'E', p6: ['APF'], site: /feeder/i },
    { id: 'Piling rig', k: 'E', p6: ['RIG'], site: /\brig\b|piling/i },
    { id: 'Crusher', k: 'E', p6: ['MBC'], site: /crusher/i }
  ];
  const poolOf = {};
  POOLS.forEach(p => p.p6.forEach(c => { poolOf[c] = p.id; }));

  // ---------------- site resources (sheet) ----------------
  let SITE = null;
  const DB = 'trd_site', STORE = 'kv';
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function idbGet(k) { try { const d = await idb(); return await new Promise(r => { const q = d.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); } catch (e) { return null; } }
  async function idbSet(k, v) { try { const d = await idb(); await new Promise(r => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, k); tx.oncomplete = r; tx.onerror = r; }); } catch (e) { } }
  async function idbDel(k) { try { const d = await idb(); await new Promise(r => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(k); tx.oncomplete = r; tx.onerror = r; }); } catch (e) { } }

  function readSiteSheet(wb, name) {
    const groups = [];
    let days = [];
    wb.SheetNames.forEach(sn => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
      let g = null, dayCols = [];
      rows.forEach(r => {
        const label = String(r[0] || '').trim();
        const isHead = r.slice(1).filter(v => /^\d{1,2}[./-]\d{1,2}/.test(String(v).trim())).length >= 3;
        if (isHead) {
          dayCols = r.map((v, i) => /^\d{1,2}[./-]\d{1,2}/.test(String(v).trim()) ? i : -1).filter(i => i > 0);
          days = dayCols.map(i => String(r[i]).trim());
          g = { name: label, k: /equip/i.test(label) || /equip/i.test(sn) ? 'E' : /indirect/i.test(label) ? 'I' : 'L', rows: [] };
          groups.push(g);
          return;
        }
        if (!g || !label) return;
        const vals = dayCols.map(i => parseFloat(r[i]) || 0);
        if (/^total|^average/i.test(label)) { if (/^total (manpower|equipment)$/i.test(label)) g.work = vals.map(v => v > 0); return; }
        g.rows.push({ n: label, v: vals });
      });
    });
    groups.forEach(g => {
      const work = g.work || g.rows.reduce((w, r) => w.map((x, i) => x || r.v[i] > 0), days.map(() => false));
      const n = work.filter(Boolean).length || 1;
      g.rows.forEach(r => { r.avg = +(r.v.filter((_, i) => work[i]).reduce((a, b) => a + b, 0) / n).toFixed(1); r.peak = Math.max(...r.v); delete r.v; });
      g.days = n; delete g.work;
    });
    return { v: 1, file: name, days, imported: new Date().toISOString(), groups };
  }
  function siteCount(pool) {
    if (!SITE) return null;
    const rows = SITE.groups.filter(g => g.k !== 'I' && (g.k === 'E') === (pool.k === 'E')).flatMap(g => g.rows).filter(r => pool.site.test(r.n.trim()));
    return rows.length ? { n: rows.reduce((a, r) => a + r.avg, 0), rows: rows.map(r => r.n) } : null;
  }

  // ---------------- forecast to date ----------------
  const ST = { to: null, from: null, status: '', l1: '', q: '', pool: null };
  function compute(from, to) {
    const S = SX.S, X = SX.X;
    const dd = X.dd;
    const wk0 = dd, nW = Math.max(1, Math.ceil((to - dd + DAY) / (7 * DAY)));
    const wStart = i => wk0 + i * 7 * DAY;
    // resource demand per pool per week (hours), from P6 remaining assignments
    const req = {}, actPools = {};
    (S.res || []).forEach(([c, rs, q, perHr, st, fi]) => {
      const pool = poolOf[rs] || ('P6:' + rs);
      (actPools[c] = actPools[c] || new Set()).add(pool);
      if (fi < dd || st > to) return;
      const s0 = Math.max(st, dd), span = (fi - st) / DAY + 1, perDay = q / span;
      for (let i = Math.floor((s0 - wk0) / (7 * DAY)); i < nW; i++) {
        const a = Math.max(s0, wStart(i)), b = Math.min(fi, wStart(i) + 6 * DAY, to);
        if (b < a) { if (wStart(i) > fi) break; continue; }
        const r = req[pool] || (req[pool] = new Array(nW).fill(0));
        r[i] += perDay * ((b - a) / DAY + 1);
      }
    });
    // pool coverage per week
    const pools = Object.keys(req).map(id => {
      const def = POOLS.find(p => p.id === id) || { id, k: /^P6:/.test(id) ? (S.rdict[id.slice(3)] || [])[1] || 'E' : 'E', p6: [id.slice(3)] };
      const site = siteCount(def.site ? def : { ...def, site: /$^/ });
      const avail = site ? site.n * HPD * DPW : null;
      const r = req[id];
      const ratio = r.map(h => h <= 0 ? 1 : avail === null ? 1 : Math.min(1, avail / h));
      const reqHead = r.map(h => h / (HPD * DPW));
      const used = reqHead.filter(v => v > 0);
      return { id, def, site, avail, req: r, ratio, reqHead, avgReq: used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0, peakReq: Math.max(0, ...reqHead), missing: !site };
    }).sort((a, b) => (a.def.k > b.def.k ? 1 : a.def.k < b.def.k ? -1 : b.peakReq - a.peakReq));
    const ratioOf = {};
    pools.forEach(p => { ratioOf[p.id] = p.ratio; });
    // per activity
    const fcAt = (a, T) => {
      if (SX.isDone(a)) return 100;
      const s0 = Math.max(dd, a.s ?? dd), f0 = Math.max(s0, a.f ?? s0);
      return T < s0 ? a.p : a.p + (100 - a.p) * clamp((T - s0 + DAY) / (f0 - s0 + DAY));
    };
    const plAt = (a, T) => a.bs === null || a.bf === null ? (SX.isDone(a) ? 100 : 0) : 100 * SX.X.pf(a, T + DAY);   // through the end of day T
    const rows = [];
    let wt = 0, pl = 0, fc = 0, ach = 0, now = 0;
    S.acts.forEach(a => {
      const pT = plAt(a, to), fT = fcAt(a, to);
      let factor = 1, pls = actPools[a.c] ? [...actPools[a.c]] : [];
      if (!SX.isDone(a) && fT > a.p && pls.length) {
        let tot = 0, got = 0;
        for (let i = 0; i < nW; i++) {
          const w = fcAt(a, Math.min(to, wStart(i) + 6 * DAY)) - fcAt(a, wStart(i) - DAY);
          if (w <= 0) continue;
          tot += w; got += w * Math.min(...pls.map(p => (ratioOf[p] || [])[i] ?? 1));
        }
        factor = tot ? got / tot : 1;
      }
      const aT = SX.isDone(a) ? 100 : a.p + (fT - a.p) * factor;
      wt += a.wt; pl += a.wt * pT / 100; fc += a.wt * fT / 100; ach += a.wt * aT / 100; now += a.wt * a.p / 100;
      const s0 = Math.max(dd, a.s ?? dd), f0 = a.f ?? s0;
      if (!SX.isDone(a) && s0 <= to && f0 >= from) rows.push({ a, pT, fT, aT, factor, pools: pls, val: a.wt * (fT - a.p) / 100 * X.k, achVal: a.wt * (aT - a.p) / 100 * X.k, toStart: !a.as && s0 <= to, toFinish: f0 <= to });
    });
    rows.forEach(r => { r.flag = !r.pools.length ? 'nores' : r.factor >= .9 ? 'ok' : r.factor >= .6 ? 'risk' : 'over'; });
    return { dd, from, to, nW, wStart, pools, rows, overall: { plan: pl / wt * 100, fc: fc / wt * 100, ach: ach / wt * 100, now: now / wt * 100 }, k: X.k };
  }

  const FLAG = { ok: ['good', 'Achievable'], risk: ['warn', 'At risk'], over: ['bad', 'Overstated'], nores: ['na', 'No resources loaded'] };
  const flagTag = f => `<span class="status ${FLAG[f][0]}">${FLAG[f][1]}</span>`;
  const K = (l, v, h, extra = '') => `<div class="kpi"><div class="lbl">${l}</div><div class="val">${v}</div>${h ? `<div class="hint">${h}</div>` : ''}${extra}</div>`;
  let LAST = null;

  function renderOutlook() {
    const host = $('#olBody');
    if (!host) return;
    if (!SX.S) { host.innerHTML = '<div class="card empty"><h3>No P6 programme loaded</h3></div>'; return; }
    const dd = SX.X.dd;
    if (!ST.from || ST.from < dd) ST.from = dd;
    if (!ST.to || ST.to <= dd) ST.to = dd + 30 * DAY;
    const quick = [['+1 week', 7], ['+2 weeks', 14], ['+1 month', 30], ['+3 months', 91], ['+6 months', 182], ['+1 year', 365]];
    $('#olCtl').innerHTML = `<div class="prog-bar"></div>
      <div class="ol-ctl">
        <label>From <input type="date" id="olFrom" value="${ds(ST.from)}" min="${ds(dd)}"></label>
        <label>Until <input type="date" id="olTo" value="${ds(ST.to)}" min="${ds(dd + DAY)}"></label>
        <div class="seg">${quick.map(([l, d]) => `<button data-q="${d}" class="${Math.round((ST.to - dd) / DAY) === d ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="muted small">Cut-off ${fd(dd)} · site resources: ${SITE ? `<b>${esc(SITE.file)}</b> (avg of ${SITE.groups[0]?.days || '—'} working days)` : '<b>not loaded</b>'}</span>
      </div>`;
    SX.renderProgBars();
    $('#olFrom').onchange = e => { ST.from = pdate(e.target.value) || dd; renderOutlook(); };
    $('#olTo').onchange = e => { const v = pdate(e.target.value); if (v && v > dd) { ST.to = v; renderOutlook(); } };
    $$('#olCtl [data-q]').forEach(b => b.onclick = () => { ST.to = dd + (+b.dataset.q) * DAY; ST.from = dd; renderOutlook(); });

    const R = LAST = compute(ST.from, ST.to);
    const o = R.overall, rows = R.rows;
    const cnt = f => rows.filter(r => r.flag === f).length;
    const valFc = rows.reduce((s, r) => s + r.val, 0), valAch = rows.reduce((s, r) => s + r.achVal, 0);
    $('#olKpis').innerHTML = [
      K('Progress now', fmtP(o.now, 2), 'Actual at cut-off ' + fd(dd)),
      K(`Planned by ${fd(ST.to)}`, fmtP(o.plan, 2), 'Baseline'),
      K(`Forecast by ${fd(ST.to)}`, fmtP(o.fc, 2), `P6 update dates · +${(o.fc - o.now).toFixed(2)}%`),
      K('Achievable with site resources', fmtP(o.ach, 2), `+${(o.ach - o.now).toFixed(2)}% · ${o.fc > o.now ? Math.round((o.ach - o.now) / (o.fc - o.now) * 100) : 100}% of the forecast gain`, `<span class="status ${o.ach >= o.fc * .995 ? 'good' : (o.ach - o.now) >= .8 * (o.fc - o.now) ? 'warn' : 'bad'}">${o.ach >= o.fc * .995 ? 'Covered' : 'Resource-limited'}</span>`),
      K('Activities in the period', rows.length.toLocaleString(), `${rows.filter(r => r.toStart).length} to start · ${rows.filter(r => r.toFinish).length} to finish`),
      K('Value of forecast work', fmtM(valFc) + '<small>SAR</small>', `Achievable ${fmtM(valAch)} · gap ${fmtM(valFc - valAch)}`),
      K('Overstated / at risk', `${cnt('over')} / ${cnt('risk')}`, `${cnt('ok')} achievable · ${cnt('nores')} without resources`)
    ].join('');

    // resources table
    const L = R.pools.filter(p => p.def.k === 'L'), E = R.pools.filter(p => p.def.k !== 'L');
    const prow = p => {
      const cov = p.site && p.avgReq ? p.site.n / p.avgReq : null, covPk = p.site && p.peakReq ? p.site.n / p.peakReq : null;
      const st = p.missing ? `<span class="status bad">Not on site sheet</span>` : covPk >= 1 ? '<span class="status good">Enough</span>' : cov >= 1 ? '<span class="status warn">Short at peak</span>' : '<span class="status bad">Short</span>';
      return `<tr class="click" data-pool="${esc(p.id)}"><td><b>${esc(p.id)}</b><div class="muted small">P6: ${esc(p.def.p6.join(', '))}${p.site ? ' · site: ' + esc(p.site.rows.join(', ')) : ''}</div></td>
        <td class="n">${p.site ? fmt(p.site.n, 0) : '—'}</td><td class="n">${fmt(p.avgReq, 0)}</td><td class="n"><b>${fmt(p.peakReq, 0)}</b></td>
        <td class="n">${p.missing ? `<b class="neg">${fmt(Math.ceil(p.peakReq), 0)}</b>` : cov !== null ? fmtP(cov * 100, 0) : '—'}</td><td class="n">${p.missing ? '—' : fmt(Math.max(0, Math.ceil(p.peakReq - p.site.n)), 0)}</td><td>${st}</td></tr>`;
    };
    const head = `<thead><tr><th>Resource</th><th class="n">On site (avg/day)</th><th class="n">Required avg/day</th><th class="n" title="Average per day in the busiest week of the period">Required — busiest week /day</th><th class="n">Coverage (avg) / need</th><th class="n">Extra needed (busiest week)</th><th>Status</th></tr></thead>`;
    const missing = R.pools.filter(p => p.missing && p.peakReq > 0);

    // WBS summary
    const byL1 = {};
    rows.forEach(r => { const top = (SX.X.wbsPath(r.a.w)[0] || { name: '—', code: '' }); const g = byL1[top.name] || (byL1[top.name] = { w: top, n: 0, fc: 0, ach: 0, over: 0 }); g.n++; g.fc += r.val; g.ach += r.achVal; if (r.flag === 'over') g.over++; });

    host.innerHTML = `
      <div class="grid g-1-1">
        <div class="card"><div class="card-h"><h3>Progress until ${fd(ST.to)}</h3><span class="muted">Planned (baseline) · forecast (update) · achievable (site resources)</span></div><div class="chart-box"><canvas id="olCurve"></canvas></div></div>
        <div class="card"><div class="card-h"><h3>Activities by expected outcome</h3><span class="muted">${fd(ST.from)} → ${fd(ST.to)}</span></div><div class="chart-box"><canvas id="olFlags"></canvas></div></div>
      </div>
      <div class="card"><div class="card-h"><h3>Manpower — required by the programme vs on site</h3><span class="muted">Required = P6 resource loading of the remaining work, ${fd(dd)} → ${fd(ST.to)} · 6 days × 10 h</span></div>
        <div class="table-wrap"><table class="tbl">${head}<tbody>${L.map(prow).join('')}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Equipment — required by the programme vs on site</h3></div>
        <div class="table-wrap"><table class="tbl">${head}<tbody>${E.map(prow).join('')}</tbody></table></div>
        ${missing.length ? `<div class="dnote"><b>Not found on the site sheet — estimated requirement for the period:</b> ${missing.map(p => `${esc(p.id)} <b>${Math.ceil(p.avgReq)}</b> avg / <b>${Math.ceil(p.peakReq)}</b> peak`).join(' · ')}. These are treated as available in the achievable %, so check whether they are subcontracted or hired.</div>` : ''}</div>
      <div class="card" id="olPoolCard"><div class="card-h"><h3 id="olPoolTitle">Weekly demand vs site</h3><span class="muted">Click a resource row above</span></div><div class="chart-box"><canvas id="olPool"></canvas></div></div>
      <div class="card"><div class="card-h"><h3>By WBS (level 1)</h3><span class="muted">Value of work forecast in the period vs achievable with site resources</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>WBS</th><th class="n">Activities</th><th class="n">Forecast value</th><th class="n">Achievable value</th><th class="n">Achievable</th><th class="n">Overstated</th></tr></thead><tbody>${Object.values(byL1).sort((a, b) => b.fc - a.fc).map(g => `<tr><td><b>${esc(g.w.code)}</b> ${esc(g.w.name)}</td><td class="n">${g.n}</td><td class="n">${fmt(g.fc, 0)}</td><td class="n">${fmt(g.ach, 0)}</td><td class="n">${g.fc ? fmtP(g.ach / g.fc * 100, 0) : '—'}</td><td class="n ${g.over ? 'neg' : ''}">${g.over}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Activities expected ${fd(ST.from)} → ${fd(ST.to)}</h3>
        <div class="g-toolbar" style="margin:0">
          <select id="olStatus"><option value="">All outcomes</option><option value="over">Overstated</option><option value="risk">At risk</option><option value="ok">Achievable</option><option value="nores">No resources loaded</option><option value="start">To start</option><option value="finish">To finish</option></select>
          <select id="olL1"><option value="">All WBS</option>${Object.values(byL1).map(g => `<option ${ST.l1 === g.w.name ? 'selected' : ''}>${esc(g.w.name)}</option>`).join('')}</select>
          <input type="search" id="olQ" placeholder="Search ID or activity…" value="${esc(ST.q)}">
          <button class="btn ghost" id="olCsv">⬇ CSV</button></div></div>
        <div id="olActs"></div>
        <p class="muted small">Forecast % = progress expected from the P6 update dates (linear over the remaining duration). Achievable % = forecast reduced by the weekly coverage of the resources each activity needs (site average ÷ P6 demand). Overstated &lt; 60 % of the forecast gain achievable · at risk 60–90 %.</p></div>`;
    $('#olStatus').value = ST.status;
    $('#olStatus').onchange = e => { ST.status = e.target.value; drawActs(); };
    $('#olL1').onchange = e => { ST.l1 = e.target.value; drawActs(); };
    $('#olQ').oninput = e => { ST.q = e.target.value; clearTimeout(renderOutlook.t); renderOutlook.t = setTimeout(drawActs, 200); };
    $('#olCsv').onclick = csv;
    drawActs();
    drawCharts(R);
    $$('[data-pool]').forEach(tr => tr.onclick = () => { ST.pool = tr.dataset.pool; drawPool(); $('#olPoolCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    if (!ST.pool || !R.pools.some(p => p.id === ST.pool)) ST.pool = (R.pools[0] || {}).id;
    drawPool();
  }

  function filteredRows() {
    const q = ST.q.trim().toLowerCase();
    return LAST.rows.filter(r => (!ST.status || (ST.status === 'start' ? r.toStart : ST.status === 'finish' ? r.toFinish : r.flag === ST.status)) &&
      (!ST.l1 || (SX.X.wbsPath(r.a.w)[0] || {}).name === ST.l1) && (!q || (r.a.c + ' ' + r.a.n).toLowerCase().includes(q)))
      .sort((x, y) => y.val - x.val);
  }
  function drawActs() {
    const rows = filteredRows();
    const show = rows.slice(0, 800);
    const crew = r => r.pools.slice(0, 3).map(p => esc(p.replace(/^P6:/, ''))).join(', ');
    $('#olActs').innerHTML = `<p class="muted small">${rows.length.toLocaleString()} activities${rows.length > show.length ? ' — showing the 800 with the most value' : ''}</p>` +
      SX.tbl([['ID'], ['Activity'], ['Start'], ['Finish'], ['Now', 1], ['Planned @date', 1], ['Forecast @date', 1], ['Achievable @date', 1], ['Value in period', 1], ['Resources'], ['Outcome']],
        show.map(r => `<tr class="click" data-act="${esc(r.a.c)}"><td><b>${esc(r.a.c)}</b></td><td class="desc">${esc(r.a.n)}</td><td>${fd(r.a.s)}</td><td>${fd(r.a.f)}</td>
          <td class="n">${Math.round(r.a.p)}%</td><td class="n">${Math.round(r.pT)}%</td><td class="n"><b>${Math.round(r.fT)}%</b></td><td class="n ${r.flag === 'over' ? 'neg' : ''}">${Math.round(r.aT)}%</td>
          <td class="n">${fmt(r.val, 0)}</td><td class="small">${crew(r) || '—'}</td><td>${flagTag(r.flag)}</td></tr>`));
  }
  function csv() {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Activity ID', 'Activity', 'WBS', 'Start', 'Finish', 'Now %', 'Planned % @date', 'Forecast % @date', 'Achievable % @date', 'Value in period (SAR)', 'Achievable value (SAR)', 'Resources', 'Outcome'];
    const lines = [head.map(q).join(',')].concat(filteredRows().map(r => [r.a.c, r.a.n, (SX.X.W[r.a.w] || {}).name, ds(r.a.s), ds(r.a.f), r.a.p, r.pT.toFixed(1), r.fT.toFixed(1), r.aT.toFixed(1), Math.round(r.val), Math.round(r.achVal), r.pools.join(' | '), FLAG[r.flag][1]].map(q).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `forecast-to-${ds(ST.to)}.csv`; l.click();
  }
  const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function mk(id, cfg) { if (charts[id]) charts[id].destroy(); const el = document.getElementById(id); if (el) charts[id] = new Chart(el, cfg); }
  function drawCharts(R) {
    const base = A.baseOpts;
    // weekly curve of overall planned / forecast / achievable
    const pts = [];
    const steps = Math.min(12, R.nW);
    for (let i = 0; i <= steps; i++) pts.push(Math.min(R.to, R.dd + Math.round((R.to - R.dd) / DAY * i / steps) * DAY));
    const series = pts.map(T => compute(R.dd, T).overall);
    mk('olCurve', { type: 'line', data: { labels: pts.map(fd), datasets: [
      { label: 'Planned (baseline)', data: series.map(o => +o.plan.toFixed(2)), borderColor: col('--s2'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: .3 },
      { label: 'Forecast (update)', data: series.map(o => +o.fc.toFixed(2)), borderColor: col('--s3'), borderWidth: 2.5, pointRadius: 0, tension: .3 },
      { label: 'Achievable (site resources)', data: series.map(o => +o.ach.toFixed(2)), borderColor: col('--s1'), borderWidth: 2.5, pointRadius: 0, tension: .3 }] },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, beginAtZero: false, ticks: { color: col('--text-2'), callback: v => v + '%' } } }, plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${fmtP(c.parsed.y, 2)}` } } } }) });
    const f = ['ok', 'risk', 'over', 'nores'];
    mk('olFlags', { type: 'bar', data: { labels: f.map(k => FLAG[k][1]), datasets: [{ label: 'Activities', data: f.map(k => R.rows.filter(r => r.flag === k).length), backgroundColor: [col('--good'), col('--warn'), col('--bad'), col('--muted')], borderRadius: 4, maxBarThickness: 46 }] },
      options: base({ plugins: { ...base().plugins, legend: { display: false } }, onClick: (e, els) => { if (els.length) { ST.status = f[els[0].index]; $('#olStatus').value = ST.status; drawActs(); } } }) });
  }
  function drawPool() {
    const R = LAST, p = R && R.pools.find(x => x.id === ST.pool);
    if (!p) return;
    $('#olPoolTitle').textContent = `Weekly demand vs site — ${p.id}`;
    const base = A.baseOpts;
    mk('olPool', { type: 'bar', data: { labels: p.reqHead.map((_, i) => 'Wk of ' + fd(R.wStart(i))), datasets: [
      { label: 'Required by P6 (avg/day)', data: p.reqHead.map(v => +v.toFixed(1)), backgroundColor: col('--s2'), borderRadius: 4, maxBarThickness: 28 },
      ...(p.site ? [{ label: 'On site (avg/day)', type: 'line', data: p.reqHead.map(() => p.site.n), borderColor: col('--s1'), borderWidth: 2.5, pointRadius: 0 }] : [])] },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, ticks: { color: col('--text-2'), precision: 0 } } } }) });
  }

  // ---------------- logic check ----------------
  const LG = { kind: '' };
  function renderLogic() {
    const host = $('#lgBody');
    if (!host) return;
    if (!SX.S) { host.innerHTML = '<div class="card empty"><h3>No P6 programme loaded</h3></div>'; return; }
    const P = SX.prog(SX.active), S = SX.S;
    const res = LOGIC.fromModel(S);
    const by = {};
    res.issues.forEach(i => { (by[i.kind] = by[i.kind] || []).push(i); });
    const kinds = Object.keys(LOGIC.KINDS).filter(k => by[k]);
    const raw = SX.RAW[SX.active] && SX.RAW[SX.active].u;
    const fixes = res.issues.reduce((s, i) => s + i.fix.length, 0);
    const name = c => { const a = SX.X.A[c]; return a ? esc(a.n) : ''; };
    if (!LG.kind || !by[LG.kind]) LG.kind = kinds[0] || '';
    const list = by[LG.kind] || [];
    const fixTxt = f => f.op === 'type' ? `${f.r.type} → <b>${f.to}</b> lag 0` : f.op === 'add' ? `add <b>${f.type}</b> ${esc(f.p)} → ${esc(f.s)}` : f.op === 'del' ? '<b>delete</b> link' : f.op === 'lag' ? 'lag → <b>0</b>' : f.op === 'cstr' ? `constraint → <b>${f.to.replace('CS_', '')}</b>` : '';
    host.innerHTML = `<div class="prog-bar"></div>
      <div class="card"><div class="card-h"><h3>Logic check — ${esc(P.name)}</h3><span class="muted">${esc(S.meta.update?.file || S.meta.baseline?.file || '')} · ${(S.rels || []).length.toLocaleString()} relationships · ${S.acts.length.toLocaleString()} activities</span></div>
        <div class="lg-grid">${kinds.map(k => `<div class="lg-k click ${k === LG.kind ? 'on' : ''}" data-lgk="${k}"><span class="status ${LOGIC.KINDS[k].auto ? 'warn' : 'na'}">${LOGIC.KINDS[k].auto ? 'Auto-fix' : 'Review'}</span><b>${by[k].length.toLocaleString()}</b><div>${esc(LOGIC.KINDS[k].t)}</div></div>`).join('') || '<p class="muted">No logic issues found.</p>'}</div>
        <div class="row-btns">
          <button class="btn" id="lgCsv">⬇ Change list (CSV)</button>
          ${raw ? `<button class="btn admin-only" id="lgXer">⬇ Corrected XER (${esc(raw.name)})</button>` : ''}
          ${SX.active === 'tp' ? `<a class="btn" href="downloads/TP_update_261016_logic-fixed.zip" download>⬇ Corrected XER — Target Plan update 16-Oct-26 (zip)</a>` : ''}
        </div>
        <p class="muted small">${fixes.toLocaleString()} automatic changes proposed. The corrected XER keeps all activities, durations and progress; only relationships (and the mandatory constraint) change. Import it into P6 and reschedule (F9) to get the new dates, then publish the new XER here.</p></div>
      ${LG.kind ? `<div class="card"><div class="card-h"><h3>${esc(LOGIC.KINDS[LG.kind].t)} — ${list.length.toLocaleString()}</h3><span class="muted">${esc(LOGIC.KINDS[LG.kind].d)}</span></div>
        <div class="dnote"><b>Correction:</b> ${esc(LOGIC.KINDS[LG.kind].fix)}</div>
        ${SX.tbl([['Predecessor / activity'], ['Successor'], ['Link'], ['Status'], ['Correction']], list.slice(0, 600).map(i => {
          const p = i.r ? i.r.p : i.c, s = i.r ? i.r.s : '';
          const st = c => { const a = SX.X.A[c]; return a ? SX.stTag(a) : ''; };
          return `<tr><td class="click" data-act="${esc(p)}"><b>${esc(p)}</b><div class="small muted">${name(p)}</div>${st(p)}</td><td class="${s ? 'click' : ''}" ${s ? `data-act="${esc(s)}"` : ''}>${s ? `<b>${esc(s)}</b><div class="small muted">${name(s)}</div>${st(s)}` : '—'}</td><td>${i.r ? `${i.r.type}${i.r.lag ? ' ' + (i.r.lag > 0 ? '+' : '') + i.r.lag + 'd' : ''}` : esc(SX.X.A[i.c]?.cs || '')}</td><td></td><td>${i.fix.map(fixTxt).join('<br>') || '<span class="muted">review</span>'}</td></tr>`;
        }))}${list.length > 600 ? '<p class="muted small">First 600 shown — download the CSV for all.</p>' : ''}</div>` : ''}`;
    SX.renderProgBars();
    $$('[data-lgk]').forEach(el => el.onclick = () => { LG.kind = el.dataset.lgk; renderLogic(); });
    $('#lgCsv').onclick = () => {
      const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['Issue', 'Predecessor / activity', 'Predecessor name', 'Successor', 'Successor name', 'Link', 'Correction'].map(q).join(',')].concat(res.issues.map(i => [LOGIC.KINDS[i.kind].t, i.r ? i.r.p : i.c, SX.X.A[i.r ? i.r.p : i.c]?.n, i.r ? i.r.s : '', i.r ? SX.X.A[i.r.s]?.n : '', i.r ? i.r.type + ' lag ' + i.r.lag : '', i.fix.map(f => fixTxt(f).replace(/<[^>]+>/g, '')).join(' ; ') || 'review'].map(q).join(',')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `logic-check-${SX.active}.csv`; l.click();
    };
    if ($('#lgXer')) $('#lgXer').onclick = () => {
      const r = LOGIC.fixXer(raw.text);
      const blob = new Blob([r.text], { type: 'application/octet-stream' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = raw.name.replace(/\.xer$/i, '') + '_logic-fixed.xer'; l.click();
    };
  }

  // ---------------- import of the site sheet ----------------
  async function onSite(file) {
    const st = $('#siteStatus');
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const s = readSiteSheet(wb, file.name);
      if (!s.groups.length) throw new Error('no manpower / equipment table found (first column = name, then one column per day)');
      SITE = s; await idbSet('site', s);
      st.innerHTML = `✓ ${esc(file.name)}: ${s.groups.map(g => `${esc(g.name)} ${g.rows.length} rows`).join(' · ')} · days ${esc(s.days.join(', '))}<br>To publish: <b>Download site-resources.json</b> → upload to <code>data/</code>.`;
      renderOutlook();
    } catch (e) { st.innerHTML = '✗ ' + esc(e.message); }
  }
  function wire() {
    const d = $('#dropSite'), i = $('#fileSite');
    if (d) {
      i.onchange = () => i.files[0] && onSite(i.files[0]);
      ['dragenter', 'dragover'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.remove('over'); }));
      d.addEventListener('drop', e => e.dataTransfer.files[0] && onSite(e.dataTransfer.files[0]));
      $('#siteExport').onclick = () => { if (!SITE) return; const blob = new Blob([JSON.stringify(SITE)], { type: 'application/json' }); const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'site-resources.json'; l.click(); };
      $('#siteClear').onclick = async () => { await idbDel('site'); await boot(true); $('#siteStatus').textContent = 'Local sheet cleared — using the published one.'; };
    }
  }
  async function boot(skipLocal) {
    SITE = skipLocal ? null : await idbGet('site');
    if (!SITE) { try { const r = await fetch('data/site-resources.json', { cache: 'no-store' }); if (r.ok) SITE = await r.json(); } catch (e) { } }
    const st = $('#siteStatus'); if (st && SITE) st.innerHTML = `Loaded: <b>${esc(SITE.file)}</b> · ${SITE.groups.map(g => `${esc(g.name)} ${g.rows.length}`).join(' · ')}`;
    render();
  }
  function render() { const t = document.querySelector('.tab.active'); if (!t) return; if (t.dataset.tab === 'outlook') renderOutlook(); if (t.dataset.tab === 'logic') renderLogic(); }

  wire();
  SX.onChange(render);
  const prev = A.onTab;
  A.onTab = n => { if (prev) prev(n); if (n === 'outlook') renderOutlook(); if (n === 'logic') renderLogic(); };
  A.whenReady(() => boot());
})();
