/* P6 schedule module — baseline + weekly update XER → look-ahead, achieved, Gantt, cost/performance forecast.
   Published copy: data/schedule.json (export it from the Import tab). Local imports live in IndexedDB. */
(function () {
  'use strict';
  const A = window.APP;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const DAY = 864e5;
  const esc = A.esc, fmt = A.fmt, fmtM = A.fmtM, fmtP = A.fmtP;
  const charts = {};

  // ---------------- dates ----------------
  const pd = s => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const ds = t => t === null || t === undefined ? '' : new Date(t).toISOString().slice(0, 10);
  const fd = t => t ? new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }) : '—';
  const mk = t => new Date(t).toISOString().slice(0, 7);
  const monthStart = t => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
  const addMonths = (t, n) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1); };
  const monthLabel = k => new Date(k + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });

  // ---------------- XER → schedule ----------------
  const TABLES = new Set(['PROJECT', 'PROJWBS', 'TASK', 'TASKRSRC', 'TASKPRED', 'CALENDAR']);
  function readFile(text, label) {
    const t = XER.parseXer(text, TABLES);
    const tasks = t.TASK || [];
    if (!tasks.length) throw new Error(label + ': no TASK table found — is this an XER export?');
    const cnt = {};
    tasks.forEach(r => { cnt[r.proj_id] = (cnt[r.proj_id] || 0) + 1; });
    const pid = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    const proj = (t.PROJECT || []).find(p => p.proj_id === pid) || {};
    const hpd = {};
    (t.CALENDAR || []).forEach(c => { hpd[c.clndr_id] = parseFloat(c.day_hr_cnt) || 8; });
    const cost = {};
    (t.TASKRSRC || []).forEach(r => {
      if (r.proj_id && r.proj_id !== pid) return;
      const c = cost[r.task_id] || (cost[r.task_id] = { b: 0, a: 0, r: 0 });
      c.b += parseFloat(r.target_cost) || 0;
      c.a += (parseFloat(r.act_reg_cost) || 0) + (parseFloat(r.act_ot_cost) || 0);
      c.r += parseFloat(r.remain_cost) || 0;
    });
    const wbs = (t.PROJWBS || []).filter(w => w.proj_id === pid).map(w => ({
      id: w.wbs_id, parent: w.parent_wbs_id, short: w.wbs_short_name, name: w.wbs_name, root: w.proj_node_flag === 'Y', seq: parseFloat(w.seq_num) || 0
    }));
    const acts = [];
    for (const r of tasks) {
      if (r.proj_id !== pid || r.task_type === 'TT_WBS') continue;
      const h = hpd[r.clndr_id] || 8;
      const durH = parseFloat(r.target_drtn_hr_cnt) || 0, remH = parseFloat(r.remain_drtn_hr_cnt) || 0;
      let pct;
      if (r.status_code === 'TK_Complete') pct = 100;
      else if (r.status_code === 'TK_NotStart') pct = 0;
      else if (r.complete_pct_type === 'CP_Phys' || !durH) pct = parseFloat(r.phys_complete_pct) || 0;
      else pct = Math.max(0, Math.min(100, (durH - remH) / durH * 100));
      const c = cost[r.task_id] || { b: 0, a: 0, r: 0 };
      acts.push({
        tid: r.task_id, code: r.task_code, name: r.task_name, wbs: r.wbs_id, type: r.task_type, status: r.status_code,
        ts: pd(r.target_start_date), tf: pd(r.target_end_date), es: pd(r.early_start_date), ef: pd(r.early_end_date),
        as: pd(r.act_start_date), af: pd(r.act_end_date), rs: pd(r.restart_date), re: pd(r.reend_date),
        dur: durH / h, rem: remH / h, tfl: r.total_float_hr_cnt === '' || r.total_float_hr_cnt === undefined ? null : (parseFloat(r.total_float_hr_cnt) || 0) / h,
        pct, drv: r.driving_path_flag === 'Y', cb: c.b, ca: c.a, cr: c.r
      });
    }
    const byTid = {};
    acts.forEach(a => { byTid[a.tid] = a.code; });
    const rels = (t.TASKPRED || []).filter(r => byTid[r.task_id] && byTid[r.pred_task_id])
      .map(r => [byTid[r.pred_task_id], byTid[r.task_id], (r.pred_type || '').replace('PR_', ''), Math.round((parseFloat(r.lag_hr_cnt) || 0) / 8)]);
    return {
      proj: {
        name: proj.proj_short_name || '', dataDate: pd(proj.last_recalc_date) || pd(proj.next_data_date),
        start: pd(proj.plan_start_date), finish: pd(proj.scd_end_date) || pd(proj.plan_end_date)
      }, wbs, acts, rels
    };
  }

  // merge baseline (B) + update (U) into the compact published model
  function combine(B, U, files) {
    const cur = U || B, base = B || U;
    const bmap = {};
    base.acts.forEach(a => { bmap[a.code] = a; });
    // WBS paths
    const W = {};
    cur.wbs.forEach(w => { W[w.id] = w; });
    const path = id => { const out = []; let w = W[id], g = 0; while (w && !w.root && g++ < 40) { out.unshift(w); w = W[w.parent]; } return out; };
    const wbsOut = cur.wbs.filter(w => !w.root).map(w => {
      const p = path(w.id);
      return { id: w.id, parent: W[w.parent] && !W[w.parent].root ? w.parent : '', code: p.map(x => x.short).join('.'), name: w.name, depth: p.length - 1, seq: w.seq };
    });
    // order WBS depth-first by seq
    const kids = {};
    wbsOut.forEach(w => { (kids[w.parent] = kids[w.parent] || []).push(w); });
    Object.values(kids).forEach(l => l.sort((a, b) => a.seq - b.seq || a.code.localeCompare(b.code)));
    const ordered = [];
    (function walk(p) { (kids[p] || []).forEach(w => { ordered.push(w); walk(w.id); }); })('');
    const totalB = base.acts.reduce((s, a) => s + a.cb, 0);
    const useCost = totalB > 0;
    const acts = cur.acts.map(a => {
      const b = bmap[a.code];
      const isMs = a.type === 'TT_Mile' || a.type === 'TT_FinMile';
      const bs = b ? (b.ts || b.es) : (a.ts || a.es), bf = b ? (b.tf || b.ef) : (a.tf || a.ef);
      const s = a.as || a.es || a.ts, f = a.af || a.ef || a.tf;
      const w = isMs || a.type === 'TT_LOE' ? 0 : useCost ? (b ? b.cb : a.cb) : (b ? b.dur : a.dur);
      return {
        c: a.code, n: a.name, w: a.wbs, t: a.type.replace('TT_', ''), st: a.status.replace('TK_', ''), bs, bf, s, f, as: a.as, af: a.af,
        d: +a.dur.toFixed(1), rd: +a.rem.toFixed(1), p: +a.pct.toFixed(1), tf: a.tfl === null ? null : +a.tfl.toFixed(1), dr: a.drv ? 1 : 0,
        wt: w, ac: a.ca, rc: a.cr, nb: b ? 0 : 1
      };
    });
    return {
      v: 1, created: new Date().toISOString(),
      meta: {
        baseline: B ? { file: files.b, name: B.proj.name, dataDate: B.proj.dataDate, start: B.proj.start, finish: B.proj.finish } : null,
        update: U ? { file: files.u, name: U.proj.name, dataDate: U.proj.dataDate, start: U.proj.start, finish: U.proj.finish } : null,
        weighting: useCost ? 'cost' : 'duration', bac: acts.reduce((s, a) => s + a.wt, 0)
      },
      wbs: ordered, acts, rels: cur.rels
    };
  }

  // ---------------- state & storage ----------------
  let S = null;          // schedule model
  let X = null;          // derived indexes
  const DB = 'trd_sched', STORE = 'kv';
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function idbGet(k) { try { const d = await idb(); return await new Promise(r => { const q = d.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); } catch (e) { return null; } }
  async function idbSet(k, v) { try { const d = await idb(); await new Promise(r => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, k); tx.oncomplete = r; tx.onerror = r; }); } catch (e) { } }
  async function idbDel(k) { try { const d = await idb(); await new Promise(r => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(k); tx.oncomplete = r; tx.onerror = r; }); } catch (e) { } }
  const pending = { b: null, u: null, fb: '', fu: '' };

  function index() {
    const W = {};
    S.wbs.forEach(w => { W[w.id] = w; });
    const A_ = {};
    S.acts.forEach(a => { A_[a.c] = a; });
    const pred = {}, succ = {};
    (S.rels || []).forEach(r => { (succ[r[0]] = succ[r[0]] || []).push(r); (pred[r[1]] = pred[r[1]] || []).push(r); });
    const dd = (S.meta.update || S.meta.baseline || {}).dataDate || Date.now();
    const cv = (A.M.project.cv || 0) + (A.M.project.co || 0);
    const k = S.meta.bac && cv ? cv / S.meta.bac : 1;  // weight → SAR
    const wbsPath = id => { const out = []; let w = W[id], g = 0; while (w && g++ < 40) { out.unshift(w); w = W[w.parent]; } return out; };
    X = { W, A: A_, pred, succ, dd, k, cv, wbsPath, junctions: null };
    curves();
  }

  // monthly baseline PV and forecast (update) distribution
  function spread(map, w, s, f, from) {
    if (!w || s === null || f === null) return;
    if (from && s < from) s = from;
    if (f < s) f = s;
    const days = (f - s) / DAY + 1, per = w / days;
    let cur = s;
    while (cur <= f) {
      const d = new Date(cur);
      const me = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
      const end = Math.min(me, f);
      const k = mk(cur);
      map[k] = (map[k] || 0) + per * ((end - cur) / DAY + 1);
      cur = end + DAY;
    }
  }
  function curves() {
    const pv = {}, fc = {};
    let ev = 0, pvdd = 0;
    const dd = X.dd;
    S.acts.forEach(a => {
      if (!a.wt) return;
      spread(pv, a.wt, a.bs, a.bf);
      ev += a.wt * a.p / 100;
      if (a.bs !== null && a.bf !== null) pvdd += a.wt * Math.max(0, Math.min(1, (dd - a.bs + DAY) / (a.bf - a.bs + DAY)));
      if (a.p < 100) spread(fc, a.wt * (1 - a.p / 100), a.s ?? dd, a.f ?? dd, dd + DAY);
    });
    X.pv = pv; X.fc = fc; X.ev = ev; X.pvdd = pvdd;
    const bac = S.meta.bac || 1;
    X.planPct = pvdd / bac * 100; X.actPct = ev / bac * 100;
    const ends = S.acts.map(a => a.f).filter(Boolean), bends = S.acts.map(a => a.bf).filter(Boolean);
    X.fFinish = (S.meta.update && S.meta.update.finish) || Math.max(...ends);
    X.bFinish = (S.meta.baseline && S.meta.baseline.finish) || Math.max(...bends);
    X.bStart = Math.min(...S.acts.map(a => a.bs).filter(Boolean));
  }

  // public hooks used by app.js (spending plan & performance)
  window.SCHED = {
    loaded: () => !!S,
    planMonthly: () => S ? Object.keys(X.pv).sort().map(k => ({ month: k + '-01', planned: X.pv[k] * X.k })) : [],
    perfPoint: () => S && S.meta.update ? { date: ds(X.dd), planned: +X.planPct.toFixed(2), actual: +X.actPct.toFixed(2), remarks: 'From P6 update ' + (S.meta.update.file || '') } : null,
    start: () => S ? ds(X.bStart) : '', finish: () => S ? ds(X.bFinish) : '',
    status: () => S ? { prog: prog(ACTIVE) ? prog(ACTIVE).name : '', dataDate: ds(X.dd), planPct: X.planPct, actPct: X.actPct, spi: X.pvdd ? X.ev / X.pvdd : null, fFinish: ds(X.fFinish), bFinish: ds(X.bFinish), update: S.meta.update ? S.meta.update.file : '' } : null
  };

  // ---------------- status helpers ----------------
  const isDone = a => a.st === 'Complete';
  const isActive = a => a.st === 'Active';
  const isMs = a => a.t === 'Mile' || a.t === 'FinMile';
  const finVar = a => (a.f !== null && a.bf !== null) ? Math.round((a.f - a.bf) / DAY) : null;
  const stTag = a => isDone(a) ? '<span class="status good">Completed</span>' : isActive(a) ? '<span class="status warn">In progress</span>' : '<span class="status na">Not started</span>';
  const critical = a => !isDone(a) && a.tf !== null && a.tf <= 0;
  const sar = v => 'SAR ' + fmt(v, 0);

  // ---------------- filters ----------------
  const F = { view: 'lookahead', weeks: 4, ach: 7, achFrom: '', achTo: '', wbs: '', status: '', float: '', q: '', zoom: 'week', group: true, collapsed: new Set() };
  function windowOf() {
    const dd = X.dd;
    if (F.view === 'lookahead') return [dd, dd + F.weeks * 7 * DAY];
    if (F.view === 'achieved') {
      if (F.ach === 'custom') return [pd(F.achFrom) ?? dd - 7 * DAY, pd(F.achTo) ?? dd];
      if (F.ach === 'all') return [X.bStart, dd];
      return [dd - (+F.ach - 1) * DAY, dd];
    }
    return null;
  }
  function wbsSet(id) {
    if (!id) return null;
    const set = new Set([id]);
    let grew = true;
    while (grew) { grew = false; S.wbs.forEach(w => { if (set.has(w.parent) && !set.has(w.id)) { set.add(w.id); grew = true; } }); }
    return set;
  }
  function filtered() {
    const win = windowOf();
    const ws = wbsSet(F.wbs);
    const q = F.q.trim().toLowerCase();
    const dd = X.dd;
    return S.acts.filter(a => {
      if (ws && !ws.has(a.w)) return false;
      if (F.status && a.st !== F.status) return false;
      if (F.float === 'crit' && !critical(a)) return false;
      if (F.float === 'near' && !(a.tf !== null && a.tf <= 10 && !isDone(a))) return false;
      if (F.float === 'neg' && !(a.tf !== null && a.tf < 0 && !isDone(a))) return false;
      if (q && !(a.c + ' ' + a.n + ' ' + (X.W[a.w]?.code || '') + ' ' + (X.W[a.w]?.name || '')).toLowerCase().includes(q)) return false;
      switch (F.view) {
        case 'lookahead': return !isDone(a) && a.s !== null && a.s <= win[1] && (a.f ?? a.s) >= win[0];
        case 'achieved': return (a.as !== null && a.as >= win[0] && a.as <= win[1]) || (a.af !== null && a.af >= win[0] && a.af <= win[1]);
        case 'delayed': return !isDone(a) && ((finVar(a) || 0) > 0 || (a.st === 'NotStart' && a.bs !== null && a.bs < dd));
        case 'critical': return critical(a);
        case 'milestones': return isMs(a);
        default: return true;
      }
    });
  }

  // ---------------- schedule tab ----------------
  function renderSchedule() {
    const host = $('#schedBody');
    if (!S) {
      host.innerHTML = `<div class="card empty"><h3>No P6 schedule loaded</h3><p class="viewer-only">The schedule has not been published yet.</p><p class="admin-only">Go to <b>Import File</b> and drop the baseline <code>.xer</code> and the latest weekly update <code>.xer</code>. Look-ahead, achieved activities, the Gantt chart and the cost/performance forecast are built from them.</p><button class="btn admin-only" onclick="APP.showTab('import')">Open Import</button></div>`;
      $('#schedKpis').innerHTML = '';
      return;
    }
    const all = S.acts, dd = X.dd;
    const done = all.filter(isDone).length, act = all.filter(isActive).length, ns = all.length - done - act;
    const la = all.filter(a => !isDone(a) && a.s !== null && a.s <= dd + 28 * DAY && (a.f ?? a.s) >= dd).length;
    const ach = all.filter(a => (a.as !== null && a.as > dd - 7 * DAY && a.as <= dd) || (a.af !== null && a.af > dd - 7 * DAY && a.af <= dd)).length;
    const crit = all.filter(critical).length;
    const spi = X.pvdd ? X.ev / X.pvdd : null;
    const slip = X.fFinish && X.bFinish ? Math.round((X.fFinish - X.bFinish) / DAY) : null;
    const K = (lbl, val, hint, key, bar) => `<div class="kpi" data-sk="${key}" tabindex="0"><div class="lbl">${lbl}</div><div class="val">${val}</div>${hint ? `<div class="hint">${hint}</div>` : ''}${bar !== undefined ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, bar))}%"></i></div>` : ''}</div>`;
    $('#schedKpis').innerHTML = [
      K('Data date', fd(dd), (S.meta.update ? 'Update: ' + esc(S.meta.update.file || '') : 'Baseline only'), 'dates'),
      K('Planned vs actual', `${fmtP(X.planPct, 1)} / ${fmtP(X.actPct, 1)}`, `Weighted by ${S.meta.weighting} · var ${fmtP(X.actPct - X.planPct, 1)}`, 'perf', X.actPct),
      K('SPI (schedule)', spi ? spi.toFixed(2) : '—', spi ? (spi >= .95 ? '● On track' : spi >= .85 ? '▲ Slight delay' : '■ Behind plan') : '', 'perf'),
      K('Forecast finish', fd(X.fFinish), slip !== null ? `Baseline ${fd(X.bFinish)} · ${slip > 0 ? '+' + slip + ' d late' : slip < 0 ? Math.abs(slip) + ' d early' : 'on baseline'}` : '', 'dates'),
      K('Activities', all.length.toLocaleString(), `✓ ${done} done · ▶ ${act} active · ○ ${ns} not started`, 'all', done / all.length * 100),
      K('Look-ahead 4 wks', la.toLocaleString(), `${ach} achieved last 7 days · ${crit} critical`, 'lookahead')
    ].join('');
    $$('#schedKpis .kpi').forEach(k => k.onclick = () => {
      const key = k.dataset.sk;
      if (key === 'lookahead' || key === 'all') { F.view = key; syncFilters(); drawGantt(); }
      else if (key === 'perf') showTab('forecast');
      else openDates();
    });
    syncFilters();
    drawGantt();
  }

  function syncFilters() {
    const wsel = $('#gWbs');
    if (!wsel.dataset.ready) {
      wsel.innerHTML = '<option value="">All WBS</option>' + S.wbs.map(w => `<option value="${esc(w.id)}">${' '.repeat(w.depth)}${esc(w.code)} — ${esc(w.name)}</option>`).join('');
      wsel.dataset.ready = '1';
    }
    wsel.value = F.wbs;
    $$('#gView button').forEach(b => b.classList.toggle('on', b.dataset.v === F.view));
    $('#gWeeksWrap').style.display = F.view === 'lookahead' ? '' : 'none';
    $('#gAchWrap').style.display = F.view === 'achieved' ? '' : 'none';
    $('#gCustom').style.display = F.view === 'achieved' && F.ach === 'custom' ? '' : 'none';
    $('#gWeeks').value = F.weeks; $('#gAch').value = F.ach; $('#gStatus').value = F.status; $('#gFloat').value = F.float;
    $$('#gZoom button').forEach(b => b.classList.toggle('on', b.dataset.z === F.zoom));
    $('#gGroup').checked = F.group;
  }

  function wireFilters() {
    $$('#gView button').forEach(b => b.onclick = () => { F.view = b.dataset.v; if (F.view === 'lookahead') F.zoom = 'week'; else if (F.view === 'all' || F.view === 'delayed') F.zoom = 'month'; syncFilters(); drawGantt(); });
    $$('#gZoom button').forEach(b => b.onclick = () => { F.zoom = b.dataset.z; syncFilters(); drawGantt(); });
    $('#gWeeks').onchange = e => { F.weeks = +e.target.value; drawGantt(); };
    $('#gAch').onchange = e => { F.ach = e.target.value === 'custom' || e.target.value === 'all' ? e.target.value : +e.target.value; syncFilters(); drawGantt(); };
    $('#gFrom').onchange = e => { F.achFrom = e.target.value; drawGantt(); };
    $('#gTo').onchange = e => { F.achTo = e.target.value; drawGantt(); };
    $('#gWbs').onchange = e => { F.wbs = e.target.value; drawGantt(); };
    $('#gStatus').onchange = e => { F.status = e.target.value; drawGantt(); };
    $('#gFloat').onchange = e => { F.float = e.target.value; drawGantt(); };
    $('#gSearch').oninput = e => { F.q = e.target.value; clearTimeout(wireFilters.t); wireFilters.t = setTimeout(drawGantt, 200); };
    $('#gGroup').onchange = e => { F.group = e.target.checked; drawGantt(); };
    $('#gReset').onclick = () => { Object.assign(F, { view: 'lookahead', weeks: 4, ach: 7, wbs: '', status: '', float: '', q: '', zoom: 'week', group: true }); F.collapsed.clear(); $('#gSearch').value = ''; syncFilters(); drawGantt(); };
    $('#gCsv').onclick = exportCsv;
    $('#gExpand').onclick = () => { F.collapsed.clear(); drawGantt(); };
    $('#gCollapse').onclick = () => { S.wbs.forEach(w => F.collapsed.add(w.id)); drawGantt(); };
  }

  const PX = { week: 16, month: 3.2, quarter: 1.1 };
  let lastRows = [];
  function drawGantt() {
    const list = filtered();
    lastRows = list;
    const win = windowOf();
    const dd = X.dd;
    const sum = list.reduce((s, a) => s + a.wt, 0) * X.k;
    $('#gCount').innerHTML = `<b>${list.length.toLocaleString()}</b> activities${win ? ` · ${fd(win[0])} → ${fd(win[1])}` : ''} · value ${fmtM(sum)} SAR`;
    const box = $('#gantt');
    if (!list.length) { box.innerHTML = '<div class="g-empty">No activities match these filters.</div>'; return; }
    // timeline range
    let t0, t1;
    if (F.view === 'lookahead') { t0 = dd - 7 * DAY; t1 = dd + (F.weeks * 7 + 7) * DAY; }
    else {
      t0 = Math.min(...list.map(a => Math.min(a.s ?? Infinity, a.bs ?? Infinity)).filter(isFinite));
      t1 = Math.max(...list.map(a => Math.max(a.f ?? -Infinity, a.bf ?? -Infinity)).filter(isFinite));
      if (F.view === 'achieved') { t0 = Math.min(t0, win[0]); t1 = Math.max(t1, dd); }
      t0 -= 7 * DAY; t1 += 14 * DAY;
    }
    t0 = new Date(t0); t0 = Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), t0.getUTCDate() - ((t0.getUTCDay() + 6) % 7)); // Monday
    const px = PX[F.zoom];
    const W = Math.ceil((t1 - t0) / DAY * px) + 40;
    const x = t => (t - t0) / DAY * px;

    // header
    let hdTop = '', hdBot = '';
    for (let m = monthStart(t0); m <= t1; m = addMonths(m, 1)) {
      const a = Math.max(0, x(m)), b = Math.min(W, x(addMonths(m, 1)));
      if (b > a) hdTop += `<div class="g-hc" style="left:${a}px;width:${b - a}px">${new Date(m).toLocaleDateString('en-GB', { month: F.zoom === 'quarter' ? 'short' : 'long', year: F.zoom === 'quarter' ? '2-digit' : 'numeric', timeZone: 'UTC' })}</div>`;
    }
    let grid = '';
    if (F.zoom === 'week') {
      for (let d = t0; d <= t1; d += 7 * DAY) { hdBot += `<div class="g-hc sm" style="left:${x(d)}px;width:${7 * px}px">${new Date(d).getUTCDate()}</div>`; grid += `<i style="left:${x(d)}px"></i>`; }
    } else {
      for (let m = monthStart(t0); m <= t1; m = addMonths(m, 1)) grid += `<i style="left:${x(m)}px"></i>`;
    }

    // rows (grouped by WBS)
    const LIMIT = 2500;
    const rows = [];
    const actRow = (a, depth) => {
      const fv = finVar(a);
      const cls = isDone(a) ? 'done' : critical(a) ? 'crit' : isActive(a) ? 'act' : 'ns';
      let bars = '';
      if (a.bs !== null && a.bf !== null) bars += `<div class="g-bl" style="left:${x(a.bs)}px;width:${Math.max(2, x(a.bf + DAY) - x(a.bs))}px"></div>`;
      if (a.s !== null && a.f !== null) {
        if (isMs(a)) bars += `<div class="g-ms ${cls}" style="left:${x(a.s) - 6}px"></div>`;
        else {
          const w = Math.max(3, x(a.f + DAY) - x(a.s));
          bars += `<div class="g-bar ${cls}" style="left:${x(a.s)}px;width:${w}px"><i style="width:${a.p}%"></i></div>`;
          if (w > 40 || F.zoom === 'week') bars += `<span class="g-lbl" style="left:${x(a.f + DAY) + 4}px">${a.p ? Math.round(a.p) + '%' : ''}</span>`;
        }
      }
      return `<div class="g-row click" data-act="${esc(a.c)}"><div class="g-left" style="--d:${depth}">
        <span class="c-id">${esc(a.c)}</span><span class="c-nm" title="${esc(a.n)}">${esc(a.n)}</span>
        <span class="c-dt">${fd(a.s)}</span><span class="c-dt">${fd(a.f)}</span>
        <span class="c-n ${fv > 0 ? 'neg' : fv < 0 ? 'pos' : ''}">${fv === null ? '—' : (fv > 0 ? '+' : '') + fv}</span>
        <span class="c-n">${Math.round(a.p)}%</span><span class="c-n ${a.tf !== null && a.tf < 0 ? 'neg' : ''}">${a.tf === null || isDone(a) ? '—' : Math.round(a.tf)}</span></div>
        <div class="g-tl" style="width:${W}px">${bars}</div></div>`;
    };
    if (F.group) {
      const byW = {};
      list.forEach(a => { (byW[a.w] = byW[a.w] || []).push(a); });
      // include ancestor WBS rows that contain matches
      const need = new Set();
      Object.keys(byW).forEach(id => X.wbsPath(id).forEach(w => need.add(w.id)));
      const hiddenUnder = id => X.wbsPath(id).slice(0, -1).some(w => F.collapsed.has(w.id));
      const agg = {};
      list.forEach(a => X.wbsPath(a.w).forEach(w => {
        const g = agg[w.id] || (agg[w.id] = { s: Infinity, f: -Infinity, n: 0, wt: 0, ev: 0 });
        if (a.s !== null) g.s = Math.min(g.s, a.s); if (a.f !== null) g.f = Math.max(g.f, a.f);
        g.n++; g.wt += a.wt; g.ev += a.wt * a.p / 100;
      }));
      for (const w of S.wbs) {
        if (!need.has(w.id) || hiddenUnder(w.id)) continue;
        const g = agg[w.id];
        const col = F.collapsed.has(w.id);
        rows.push(`<div class="g-row g-wbs d${Math.min(w.depth, 4)}" data-wbs="${esc(w.id)}"><div class="g-left" style="--d:${w.depth}">
          <span class="c-tg">${col ? '▸' : '▾'}</span><span class="c-wbs" title="${esc(w.code + ' ' + w.name)}"><b>${esc(w.code)}</b> ${esc(w.name)}</span>
          <span class="c-n">${g.n}</span><span class="c-n">${g.wt ? Math.round(g.ev / g.wt * 100) + '%' : ''}</span></div>
          <div class="g-tl" style="width:${W}px">${isFinite(g.s) ? `<div class="g-sum" style="left:${x(g.s)}px;width:${Math.max(3, x(g.f + DAY) - x(g.s))}px"></div>` : ''}</div></div>`);
        if (!col) (byW[w.id] || []).sort((a, b) => (a.s ?? 0) - (b.s ?? 0)).forEach(a => { if (rows.length < LIMIT) rows.push(actRow(a, w.depth + 1)); });
        if (rows.length >= LIMIT) break;
      }
      (byW[''] || []).forEach(a => rows.push(actRow(a, 0)));
    } else {
      [...list].sort((a, b) => (a.s ?? 0) - (b.s ?? 0)).slice(0, LIMIT).forEach(a => rows.push(actRow(a, 0)));
    }
    box.innerHTML = `<div class="g-in" style="width:${W + 800}px">
      <div class="g-head"><div class="g-left hd"><span class="c-id">Activity ID</span><span class="c-nm">Activity name</span><span class="c-dt">Start</span><span class="c-dt">Finish</span><span class="c-n" title="Finish variance vs baseline (days)">Var d</span><span class="c-n">%</span><span class="c-n" title="Total float (days)">TF</span></div>
        <div class="g-tl hd" style="width:${W}px"><div class="g-hrow">${hdTop}</div><div class="g-hrow">${hdBot}</div></div></div>
      <div class="g-body"><div class="g-grid" style="width:${W}px">${grid}<b class="g-dd" style="left:${x(dd)}px" title="Data date ${fd(dd)}"></b>${win && F.view === 'lookahead' ? `<b class="g-win" style="left:${x(win[1] + DAY)}px"></b>` : ''}</div>${rows.join('')}</div></div>
      ${rows.length >= LIMIT ? `<div class="g-empty">Showing the first ${LIMIT} rows — narrow the filters (WBS / search) to see the rest.</div>` : ''}`;
    // scroll so the data date is visible
    box.scrollLeft = Math.max(0, x(dd) - 260);
  }

  function exportCsv() {
    const head = ['Activity ID', 'Activity Name', 'WBS Code', 'WBS Name', 'Status', 'BL Start', 'BL Finish', 'Start', 'Finish', 'Actual Start', 'Actual Finish', 'Finish Var (d)', '% Complete', 'Total Float (d)', 'Value (SAR)'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.map(q).join(',')].concat(lastRows.map(a => [a.c, a.n, X.W[a.w]?.code, X.W[a.w]?.name, a.st, ds(a.bs), ds(a.bf), ds(a.s), ds(a.f), ds(a.as), ds(a.af), finVar(a), a.p, a.tf, Math.round(a.wt * X.k)].map(q).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `activities-${F.view}.csv`; l.click();
  }

  // ---------------- details ----------------
  const tiles = arr => `<div class="dtiles">${arr.filter(Boolean).map(([l, v, h]) => `<div class="dtile"><div class="lbl">${l}</div><div class="v">${v}</div>${h ? `<div class="muted small">${h}</div>` : ''}</div>`).join('')}</div>`;
  const tbl = (head, rows) => `<div class="table-wrap"><table class="tbl"><thead><tr>${head.map(h => `<th class="${h[1] ? 'n' : ''}">${h[0]}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="muted">None</td></tr>`}</tbody></table></div>`;
  const wbsCrumb = id => X.wbsPath(id).map(w => `<span class="crumb click" data-wbs-open="${esc(w.id)}">${esc(w.code)} ${esc(w.name)}</span>`).join(' › ');
  const actLine = (a, extra) => `<tr class="click" data-act="${esc(a.c)}"><td><b>${esc(a.c)}</b></td><td class="desc">${esc(a.n)}</td><td>${fd(a.s)}</td><td>${fd(a.f)}</td><td class="n">${Math.round(a.p)}%</td><td>${stTag(a)}</td>${extra || ''}</tr>`;
  const actHead = [['ID'], ['Activity'], ['Start'], ['Finish'], ['%', 1], ['Status']];

  function actDetail(code) {
    const a = X.A[code];
    if (!a) return { title: 'Activity not found', body: '' };
    const fv = finVar(a), sv = a.s !== null && a.bs !== null ? Math.round((a.s - a.bs) / DAY) : null;
    const rel = (list, i) => tbl([['ID'], ['Activity'], ['Type'], ['Lag d', 1], ['Finish'], ['Status']], (list || []).map(r => { const o = X.A[r[i]]; return o ? `<tr class="click" data-act="${esc(o.c)}"><td><b>${esc(o.c)}</b></td><td class="desc">${esc(o.n)}</td><td>${r[2]}</td><td class="n">${r[3]}</td><td>${fd(o.f)}</td><td>${stTag(o)}</td></tr>` : ''; }));
    const monthsOf = {};
    if (a.wt && a.p < 100) spread(monthsOf, a.wt * (1 - a.p / 100) * X.k, a.s ?? X.dd, a.f ?? X.dd, X.dd + DAY);
    return {
      title: `${esc(a.c)} — ${esc(a.n)}`,
      sub: `${wbsCrumb(a.w)}<br>${stTag(a)} ${critical(a) ? '<span class="status bad">Critical</span>' : ''} ${a.nb ? '<span class="status warn">Not in baseline</span>' : ''}`,
      body: tiles([
        ['Baseline start', fd(a.bs)], ['Baseline finish', fd(a.bf)],
        ['Start', fd(a.s), a.as ? 'Actual' : 'Forecast'], ['Finish', fd(a.f), a.af ? 'Actual' : 'Forecast'],
        ['Start variance', sv === null ? '—' : (sv > 0 ? '+' : '') + sv + ' d'], ['Finish variance', fv === null ? '—' : (fv > 0 ? '+' : '') + fv + ' d', fv > 0 ? 'Late vs baseline' : fv < 0 ? 'Early vs baseline' : ''],
        ['Original duration', a.d + ' d'], ['Remaining duration', a.rd + ' d'], ['% complete', fmtP(a.p, 1)],
        ['Total float', a.tf === null ? '—' : Math.round(a.tf) + ' d'], ['Type', esc(a.t)],
        ['Value (weight)', a.wt ? sar(a.wt * X.k) : '—', a.wt ? fmtP(a.wt / S.meta.bac * 100, 3) + ' of project' : (isMs(a) ? 'Milestone' : 'No cost loaded')],
        ['Earned', a.wt ? sar(a.wt * a.p / 100 * X.k) : '—'], ['Remaining value', a.wt ? sar(a.wt * (1 - a.p / 100) * X.k) : '—']
      ]) + (Object.keys(monthsOf).length ? `<h4 class="dsec">Expected value by month (forecast)</h4>` + tbl([['Month'], ['SAR', 1]], Object.keys(monthsOf).sort().map(k => `<tr class="click" data-fmonth="${k}"><td>${monthLabel(k)}</td><td class="n">${fmt(monthsOf[k], 0)}</td></tr>`)) : '') +
        `<h4 class="dsec">Predecessors (${(X.pred[a.c] || []).length})</h4>` + rel(X.pred[a.c], 0) +
        `<h4 class="dsec">Successors (${(X.succ[a.c] || []).length})</h4>` + rel(X.succ[a.c], 1)
    };
  }

  function wbsDetail(id) {
    const w = X.W[id];
    const set = wbsSet(id);
    const list = S.acts.filter(a => set.has(a.w));
    const wt = list.reduce((s, a) => s + a.wt, 0), ev = list.reduce((s, a) => s + a.wt * a.p / 100, 0);
    let pv = 0;
    list.forEach(a => { if (a.wt && a.bs !== null && a.bf !== null) pv += a.wt * Math.max(0, Math.min(1, (X.dd - a.bs + DAY) / (a.bf - a.bs + DAY))); });
    const la = list.filter(a => !isDone(a) && a.s !== null && a.s <= X.dd + 28 * DAY && (a.f ?? a.s) >= X.dd);
    const late = list.filter(a => !isDone(a) && (finVar(a) || 0) > 0).sort((a, b) => finVar(b) - finVar(a));
    return {
      title: `WBS ${esc(w.code)} — ${esc(w.name)}`, sub: wbsCrumb(id),
      body: tiles([['Activities', list.length, `${list.filter(isDone).length} done · ${list.filter(isActive).length} active`], ['Value', sar(wt * X.k), fmtP(wt / S.meta.bac * 100, 2) + ' of project'],
        ['Planned %', fmtP(wt ? pv / wt * 100 : 0, 1)], ['Actual %', fmtP(wt ? ev / wt * 100 : 0, 1)], ['SPI', pv ? (ev / pv).toFixed(2) : '—'],
        ['Start → finish', `${fd(Math.min(...list.map(a => a.s).filter(Boolean)))} → ${fd(Math.max(...list.map(a => a.f).filter(Boolean)))}`]]) +
        `<p><button class="btn" data-wbs-filter="${esc(id)}">Show this WBS in the Gantt →</button></p>` +
        `<h4 class="dsec">Look-ahead 4 weeks (${la.length})</h4>` + tbl(actHead, la.map(a => actLine(a))) +
        `<h4 class="dsec">Late vs baseline (${late.length})</h4>` + tbl([...actHead, ['Var d', 1]], late.slice(0, 200).map(a => actLine(a, `<td class="n neg">+${finVar(a)}</td>`)))
    };
  }

  function openDates() {
    A.Details.open(() => ({
      title: 'Schedule dates', sub: 'Baseline vs latest update',
      body: tiles([['Baseline file', esc(S.meta.baseline?.file || '—')], ['Update file', esc(S.meta.update?.file || '—')], ['Data date', fd(X.dd)],
        ['Baseline start', fd(X.bStart)], ['Baseline finish', fd(X.bFinish)], ['Forecast finish', fd(X.fFinish)],
        ['Finish variance', Math.round((X.fFinish - X.bFinish) / DAY) + ' d'], ['Weighting', S.meta.weighting], ['Activities', S.acts.length.toLocaleString()]]) +
        `<h4 class="dsec">Critical activities (TF ≤ 0, not complete)</h4>` + tbl([...actHead, ['TF', 1]], S.acts.filter(critical).sort((a, b) => a.tf - b.tf).slice(0, 300).map(a => actLine(a, `<td class="n neg">${Math.round(a.tf)}</td>`)))
    }));
  }

  // ---------------- junctions ----------------
  // lane labels as named in P6 (rename here if the site uses West / East)
  const LANE = { Left: 'Left Lane', Right: 'Right Lane', Single: 'Single deck' };
  const JORDER = ['7', '5', '3', '1'];
  function wStats(set) {
    const list = S.acts.filter(a => set.has(a.w));
    let wt = 0, ev = 0, pv = 0, s0 = Infinity, s1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    list.forEach(a => {
      wt += a.wt; ev += a.wt * a.p / 100;
      if (a.wt && a.bs !== null && a.bf !== null) pv += a.wt * Math.max(0, Math.min(1, (X.dd - a.bs + DAY) / (a.bf - a.bs + DAY)));
      if (a.s !== null) s0 = Math.min(s0, a.s); if (a.f !== null) s1 = Math.max(s1, a.f);
      if (a.bs !== null) b0 = Math.min(b0, a.bs); if (a.bf !== null) b1 = Math.max(b1, a.bf);
    });
    return { list, n: list.length, wt, ev, pv, plan: wt ? pv / wt * 100 : 0, act: wt ? ev / wt * 100 : 0, spi: pv ? ev / pv : null,
      start: isFinite(s0) ? s0 : null, finish: isFinite(s1) ? s1 : null, bStart: isFinite(b0) ? b0 : null, bFinish: isFinite(b1) ? b1 : null,
      done: list.filter(isDone).length, active: list.filter(isActive).length };
  }
  const laneOf = id => { const p = X.wbsPath(id).map(w => w.name).join(' / '); return /left lane/i.test(p) ? 'Left' : /righ?t lane/i.test(p) ? 'Right' : 'Single'; };
  function junctions() {
    if (X.junctions) return X.junctions;
    const kidsOf = id => S.wbs.filter(w => w.parent === id);
    const found = {};
    S.wbs.forEach(w => { const m = /^junction[\s-]*([1357])\b/i.exec(w.name); if (m && !found[m[1]] && /\(\s*\d+\+\d+/.test(w.name)) found[m[1]] = w; });
    X.junctions = JORDER.filter(k => found[k]).map(k => {
      const root = found[k];
      const ch = (/(\d+\+\d+)/.exec(root.name) || [])[1] || '';
      const set = wbsSet(root.id);
      // components: walk down single-child levels, then take the children
      let node = root;
      while (kidsOf(node.id).length === 1) node = kidsOf(node.id)[0];
      const comps = kidsOf(node.id).map(c => {
        const lanes = kidsOf(c.id).filter(x => /left|righ?t/i.test(x.name)).map(x => ({ lane: /left/i.test(x.name) ? 'Left' : 'Right', id: x.id, st: wStats(wbsSet(x.id)) }));
        return { id: c.id, name: c.name, st: wStats(wbsSet(c.id)), lanes };
      });
      const pours = S.acts.filter(a => set.has(a.w) && /deck\s*slab/i.test(a.n) && /concrete/i.test(a.n) && !/bit+u?minous|bitminous/i.test(a.n)).map(a => {
        const unit = X.wbsPath(a.w).map(w => w.name).reverse().find(n => /unit/i.test(n)) || '';
        const span = (/\(([^)]+)\)/.exec(unit) || /deck slab-?\s*([A-Z]\d+\s*to\s*[A-Z]\d+)/i.exec(a.n) || [])[1] || unit;
        return { a, lane: laneOf(a.w), unit: unit.replace(/\s*\(.*$/, ''), span: span.replace(/\s*-\s*steel structure/i, '') };
      }).sort((x, y) => x.lane.localeCompare(y.lane) || x.unit.localeCompare(y.unit, undefined, { numeric: true }));
      return { key: 'J' + k, name: 'Junction ' + k, ch, jeddah: /jeddah/i.test(root.name), root, set, st: wStats(set), comps, pours };
    });
    return X.junctions;
  }
  const JF = { j: '', lane: '' };
  const pctCell = (v, pl) => `<div class="pbar"><div class="t"><i style="width:${Math.min(100, v)}%"></i>${pl !== undefined && pl !== null ? `<span class="pl" style="left:${Math.min(100, pl)}%"></span>` : ''}</div><span>${fmtP(v, 1)}</span></div>`;
  const spiTag = v => v === null ? '<span class="status na">—</span>' : `<span class="status ${v >= .95 ? 'good' : v >= .85 ? 'warn' : 'bad'}">${v.toFixed(2)}</span>`;
  function renderJunctions() {
    const host = $('#juncBody');
    if (!host) return;
    if (!S) { host.innerHTML = `<div class="card empty"><h3>No P6 schedule loaded</h3><p class="viewer-only">The schedule has not been published yet.</p><button class="btn admin-only" onclick="APP.showTab('import')">Open Import</button></div>`; return; }
    const J = junctions();
    if (!J.length) { host.innerHTML = '<div class="card empty"><h3>No junction WBS found in the schedule</h3></div>'; return; }
    const dd = X.dd;
    const cards = J.map(j => {
      const st = j.st, slip = st.finish && st.bFinish ? Math.round((st.finish - st.bFinish) / DAY) : null;
      const pours = j.pours, started = pours.filter(p => p.a.as).length, doneP = pours.filter(p => isDone(p.a)).length;
      const next = pours.filter(p => !p.a.as && p.a.s !== null).sort((x, y) => x.a.s - y.a.s)[0];
      const sl = window.JSLIDES.get(j.key)[0];
      const slide = sl ? `<figure class="jslide click" data-slide="${esc(j.key)}"><img src="${sl.src}" alt="${esc(j.name)} presentation slide" loading="lazy"><figcaption>${esc(sl.title || j.name)}${sl.date ? ' · status ' + esc(sl.date) : ''} <span class="muted">· click to enlarge</span></figcaption></figure>` : `<div class="jslide empty muted">No presentation slide for ${j.name} yet</div>`;
      return `<div class="jline"><div class="card jcard click" data-wbs-open="${esc(j.root.id)}">
        <div class="jh"><div><h3>${j.name}</h3><div class="muted small">Ch ${esc(j.ch)}${j.jeddah ? ' · Jeddah Junction' : ''} · ${st.n} activities</div></div>${spiTag(st.spi)}</div>
        <div class="jbig"><b>${fmtP(st.act, 1)}</b><span class="muted">actual · planned ${fmtP(st.plan, 1)}</span></div>
        ${pctCell(st.act, st.plan)}
        <div class="jrows">
          <div><span>Variance</span><b class="${st.act < st.plan ? 'neg' : 'pos'}">${(st.act - st.plan >= 0 ? '+' : '') + (st.act - st.plan).toFixed(1)}%</b></div>
          <div><span>Baseline finish</span><b>${fd(st.bFinish)}</b></div>
          <div><span>Forecast finish</span><b class="${slip > 0 ? 'neg' : ''}">${fd(st.finish)}${slip ? ` (${slip > 0 ? '+' : ''}${slip} d)` : ''}</b></div>
          <div><span>Deck slab pours</span><b>${doneP} done · ${started} started / ${pours.length}</b></div>
          <div><span>Next deck pour</span><b>${next ? fd(next.a.s) + ' · ' + esc(LANE[next.lane]) : started === pours.length ? 'All started' : '—'}</b></div>
        </div></div>${slide}</div>`;
    }).join('');

    const compTables = J.map(j => {
      const hasLanes = j.comps.some(c => c.lanes.length);
      return `<details class="jcomp" ${j.key === 'J7' ? 'open' : ''}><summary><b>${j.name}</b> <span class="muted">· Ch ${esc(j.ch)} · actual ${fmtP(j.st.act, 1)} / planned ${fmtP(j.st.plan, 1)}</span></summary>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Component</th><th class="n">Activities</th><th>Progress (actual · ▏planned)</th><th class="n">Planned</th><th class="n">Actual</th><th class="n">SPI</th>${hasLanes ? `<th>${LANE.Left}</th><th>${LANE.Right}</th>` : ''}<th>Forecast finish</th></tr></thead><tbody>` +
        j.comps.map(c => {
          const ln = k => { const l = c.lanes.find(x => x.lane === k); return l ? `<td class="click" data-wbs-open="${esc(l.id)}">${pctCell(l.st.act, l.st.plan)}</td>` : '<td class="muted">—</td>'; };
          return `<tr class="click" data-wbs-open="${esc(c.id)}"><td><b>${esc(c.name)}</b></td><td class="n">${c.st.n}</td><td>${pctCell(c.st.act, c.st.plan)}</td><td class="n">${fmtP(c.st.plan, 1)}</td><td class="n">${fmtP(c.st.act, 1)}</td><td class="n">${spiTag(c.st.spi)}</td>${hasLanes ? ln('Left') + ln('Right') : ''}<td>${fd(c.st.finish)}</td></tr>`;
        }).join('') + '</tbody></table></div></details>';
    }).join('');

    const ov = window.JSLIDES.get('overview')[0], sm = window.JSLIDES.meta();
    const ovBlock = !ov ? '' : ov.chart
      ? `<div class="card"><div class="card-h"><h3>Junctions presentation — overview</h3><span class="muted">${esc(sm.file || '')}${ov.date ? ' · status ' + esc(ov.date) : ''}</span></div>
          <div class="grid g-1-1 inner"><div>${(ov.kpis || []).length ? `<div class="dtiles">${ov.kpis.map(k => `<div class="dtile"><div class="lbl">${esc(k[0])}</div><div class="v">${esc(k[1])}</div></div>`).join('')}</div>` : ''}<div class="chart-box"><canvas id="chSlideOv"></canvas></div><p class="muted small">Chart redrawn from the presentation data (plan vs actual per junction).</p></div>
          <figure class="jslide wide click" data-slide="overview"><img src="${ov.src}" alt="Junctions overview slide"><figcaption class="muted small">Overview slide — click to enlarge</figcaption></figure></div></div>`
      : `<div class="card"><div class="card-h"><h3>Junctions presentation — overview</h3><span class="muted">${esc(sm.file || '')}${ov.date ? ' · status ' + esc(ov.date) : ''}</span></div><figure class="jslide wide click" data-slide="overview"><img src="${ov.src}" alt="Junctions overview slide"></figure></div>`;
    host.innerHTML = `<div class="prog-bar"></div>` + ovBlock + `<div class="jlist">${cards}</div>
      <div class="grid g-1-1"><div class="card"><div class="card-h"><h3>Planned vs actual by junction</h3><span class="muted">Weighted by cost · data date ${fd(dd)}</span></div><div class="chart-box"><canvas id="chJunc"></canvas></div></div>
      <div class="card"><div class="card-h"><h3>Deck slab concrete — status</h3></div><div class="chart-box"><canvas id="chJPour"></canvas></div></div></div>
      <div class="card"><div class="card-h"><h3>Progress by component</h3><span class="muted">Click any row for its activities</span></div>${compTables}</div>
      <div class="card" id="pourCard"><div class="card-h"><h3>Deck slab concrete pours — planned dates</h3>
        <div class="g-toolbar" style="margin:0"><div class="seg" id="jfJ"><button data-j="">All</button>${J.map(j => `<button data-j="${j.key}">${j.name}</button>`).join('')}</div>
        <div class="seg" id="jfL"><button data-l="">Both lanes</button><button data-l="Left">${LANE.Left}</button><button data-l="Right">${LANE.Right}</button></div></div></div>
        <div id="pourBody"></div>
        <p class="muted small">Pour window = the P6 "Deck Slab … Concrete" activity of each span. Baseline = ${esc(S.meta.baseline?.file || '—')}; forecast / actual = ${esc(S.meta.update?.file || '—')} (data date ${fd(dd)}).</p></div>`;
    drawPours();
    renderProgBars();
    $$('#jfJ button').forEach(b => b.onclick = e => { e.stopPropagation(); JF.j = b.dataset.j; drawPours(); });
    $$('#jfL button').forEach(b => b.onclick = e => { e.stopPropagation(); JF.lane = b.dataset.l; drawPours(); });

    const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const base = A.baseOpts;
    const mk = (id, cfg, pick) => {
      if (charts[id]) charts[id].destroy();
      cfg.options.onClick = (e, els) => { if (els.length) { A.markPicked(); pick(els[0].index, els[0].datasetIndex); } };
      cfg.options.onHover = (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
      charts[id] = new Chart($('#' + id), cfg);
    };
    if (ov && ov.chart && $('#chSlideOv')) {
      if (charts.chSlideOv) charts.chSlideOv.destroy();
      const pal = [col('--s2'), col('--s1')];
      charts.chSlideOv = new Chart($('#chSlideOv'), { type: 'bar', data: { labels: ov.chart.cats, datasets: ov.chart.series.map((se, i) => ({ label: se.name, data: se.values.slice(0, ov.chart.cats.length), backgroundColor: pal[i % 2], borderRadius: 4, maxBarThickness: 34 })) },
        options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, ticks: { color: col('--text-2'), callback: v => v + '%' } } }, plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y}%` } } } }) });
    }
    mk('chJunc', { type: 'bar', data: { labels: J.map(j => j.name), datasets: [
      { label: 'Planned %', data: J.map(j => +j.st.plan.toFixed(2)), backgroundColor: col('--s2'), borderRadius: 4, maxBarThickness: 34 },
      { label: 'Actual %', data: J.map(j => +j.st.act.toFixed(2)), backgroundColor: col('--s1'), borderRadius: 4, maxBarThickness: 34 }] },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, ticks: { color: col('--text-2'), callback: v => v + '%' } } }, plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${fmtP(c.parsed.y, 1)}` } } } })
    }, i => A.Details.open(() => wbsDetail(J[i].root.id)));
    const cat = j => ['Completed', 'In progress', 'Not started — on time', 'Not started — late'].map(k => j.pours.filter(p => (isDone(p.a) ? 'Completed' : p.a.as ? 'In progress' : (p.a.s > p.a.bs + DAY) ? 'Not started — late' : 'Not started — on time') === k).length);
    const cats = ['Completed', 'In progress', 'Not started — on time', 'Not started — late'], cc = [col('--good'), col('--s1'), col('--muted'), col('--bad')];
    mk('chJPour', { type: 'bar', data: { labels: J.map(j => j.name), datasets: cats.map((c, k) => ({ label: c, data: J.map(j => cat(j)[k]), backgroundColor: cc[k], stack: 's', maxBarThickness: 34 })) },
      options: base({ scales: { x: { ...base().scales.x, stacked: true }, y: { ...base().scales.y, stacked: true, ticks: { color: col('--text-2'), precision: 0 } } } })
    }, i => { JF.j = J[i].key; drawPours(); $('#pourCard').scrollIntoView({ behavior: 'smooth' }); });
  }
  document.addEventListener('click', e => {
    const f = e.target.closest('[data-slide]');
    if (!f) return;
    e.stopPropagation();
    const sl = window.JSLIDES.get(f.dataset.slide)[0];
    if (sl) A.Details.open(() => ({ title: esc(sl.title || f.dataset.slide), sub: (window.JSLIDES.meta().file || '') + (sl.date ? ' · status ' + sl.date : ''), body: `<img class="wk-full" src="${sl.src}" alt="">` }));
  }, true);
  function drawPours() {
    const J = junctions().filter(j => !JF.j || j.key === JF.j);
    $$('#jfJ button').forEach(b => b.classList.toggle('on', b.dataset.j === JF.j));
    $$('#jfL button').forEach(b => b.classList.toggle('on', b.dataset.l === JF.lane));
    const all = J.flatMap(j => j.pours.filter(p => !JF.lane || p.lane === JF.lane || p.lane === 'Single'));
    if (!all.length) { $('#pourBody').innerHTML = '<p class="muted">No deck slab pours for this filter.</p>'; return; }
    const t0 = Math.min(...all.flatMap(p => [p.a.bs, p.a.s]).filter(v => v !== null)) - 15 * DAY;
    const t1 = Math.max(...all.flatMap(p => [p.a.bf, p.a.f]).filter(v => v !== null)) + 15 * DAY;
    const x = t => ((t - t0) / (t1 - t0) * 100).toFixed(2) + '%';
    const months = [];
    for (let m = monthStart(t0); m <= t1; m = addMonths(m, 1)) if (m >= t0) months.push(m);
    const stepM = Math.max(1, Math.ceil(months.length / 7));
    const ticks = months.filter((m, i) => i % stepM === 0);
    const head = `<div class="pt-axis">${ticks.map(m => `<span style="left:${x(m)}">${new Date(m).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })}</span>`).join('')}<b class="pt-dd" style="left:${x(X.dd)}"></b></div>`;
    const rows = [];
    J.forEach(j => {
      const lanes = [...new Set(j.pours.map(p => p.lane))].filter(l => !JF.lane || l === JF.lane || l === 'Single');
      lanes.forEach(l => {
        const ps = j.pours.filter(p => p.lane === l);
        if (!ps.length) return;
        rows.push(`<tr class="g-grp"><td colspan="9"><b>${j.name}</b> · ${esc(LANE[l])} <span class="muted">· ${ps.filter(p => isDone(p.a)).length}/${ps.length} complete</span></td></tr>`);
        ps.forEach(p => {
          const a = p.a, fv = finVar(a), lateStart = !a.as && a.s !== null && a.bs !== null ? Math.round((a.s - a.bs) / DAY) : null;
          const cls = isDone(a) ? 'done' : critical(a) ? 'crit' : isActive(a) ? 'act' : 'ns';
          rows.push(`<tr class="click" data-act="${esc(a.c)}"><td><b>${esc(p.span)}</b> <span class="muted small">${esc(p.unit)}</span><div class="muted small">${esc(a.c)}</div></td>
            <td><b>${fd(a.bs)}</b> → ${fd(a.bf)}</td><td>${a.as ? '<b>' + fd(a.as) + '</b> <span class="muted small">actual</span>' : fd(a.s) + (lateStart > 0 ? ` <span class="neg small">+${lateStart}d</span>` : '')}</td><td>${a.af ? '<b>' + fd(a.af) + '</b>' : fd(a.f)}</td>
            <td class="n">${Math.round(a.p)}%</td><td class="n ${fv > 0 ? 'neg' : fv < 0 ? 'pos' : ''}">${fv === null ? '—' : (fv > 0 ? '+' : '') + fv}</td><td class="n">${a.tf === null || isDone(a) ? '—' : Math.round(a.tf)}</td><td>${stTag(a)}</td>
            <td class="pt-cell"><div class="pt">${a.bs !== null ? `<i class="pt-bl" style="left:${x(a.bs)};width:calc(${x(a.bf + DAY)} - ${x(a.bs)})"></i>` : ''}${a.s !== null ? `<i class="pt-cur ${cls}" style="left:${x(a.s)};width:calc(${x(a.f + DAY)} - ${x(a.s)})"><em style="width:${a.p}%"></em></i>` : ''}<b class="pt-dd" style="left:${x(X.dd)}"></b></div></td></tr>`);
        });
      });
    });
    $('#pourBody').innerHTML = `<div class="table-wrap pour-wrap"><table class="tbl"><thead><tr><th>Span / activity</th><th>Planned pour (baseline)</th><th>Start (actual / forecast)</th><th>Finish (forecast)</th><th class="n">%</th><th class="n" title="Finish variance vs baseline, days">Var d</th><th class="n">TF</th><th>Status</th><th class="pt-h">Timeline ${head}</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <div class="g-legend small" style="margin-top:8px"><i class="lg bl"></i>Baseline pour window <i class="lg act"></i>Forecast / actual <i class="lg crit"></i>Critical <i class="lg dd"></i>Data date</div>`;
  }

  // ---------------- forecast tab ----------------
  function monthsAhead(n) {
    const out = [];
    let m = monthStart(X.dd);
    for (let i = 0; i < n; i++) { out.push(mk(m)); m = addMonths(m, 1); }
    return out;
  }
  function activeIn(k) {
    const m0 = Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, 1), m1 = addMonths(m0, 1) - DAY;
    return S.acts.filter(a => !isDone(a) && a.s !== null && a.f !== null && a.s <= m1 && a.f >= m0 && a.f >= X.dd).map(a => {
      const v = {};
      if (a.wt) spread(v, a.wt * (1 - a.p / 100), a.s, a.f, X.dd + DAY);
      return { a, val: (v[k] || 0) * X.k, starts: a.s >= m0 && a.s <= m1 && !a.as, ends: a.f >= m0 && a.f <= m1 };
    });
  }
  function monthDetail(k) {
    const list = activeIn(k).sort((x, y) => y.val - x.val);
    const byW = {};
    list.forEach(r => { (byW[r.a.w] = byW[r.a.w] || []).push(r); });
    const pvm = (X.pv[k] || 0) * X.k, fcm = (X.fc[k] || 0) * X.k;
    const groups = S.wbs.filter(w => byW[w.id]).map(w => {
      const rs = byW[w.id];
      const tot = rs.reduce((s, r) => s + r.val, 0);
      return `<tr class="g-grp"><td colspan="7"><span class="click" data-wbs-open="${esc(w.id)}"><b>${esc(w.code)}</b> ${esc(w.name)}</span> <span class="muted">· ${rs.length} activities · SAR ${fmt(tot, 0)}</span></td></tr>` +
        rs.map(r => actLine(r.a, `<td class="n">${fmt(r.val, 0)}</td>`)).join('');
    });
    return {
      title: `Required work — ${new Date(k + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
      sub: 'Activities forecast to be worked in this month (from the latest update), grouped by WBS',
      body: tiles([['Baseline planned', sar(pvm)], ['Forecast (update)', sar(fcm)], ['Variance', sar(fcm - pvm)],
        ['Activities', list.length], ['To start', list.filter(r => r.starts).length], ['To finish', list.filter(r => r.ends).length],
        ['Critical', list.filter(r => critical(r.a)).length]]) +
        `<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Activity</th><th>Start</th><th>Finish</th><th class="n">%</th><th>Status</th><th class="n">Value this month</th></tr></thead><tbody>${groups.join('') || '<tr><td colspan="7" class="muted">No activities</td></tr>'}</tbody></table></div>`
    };
  }

  function renderForecast() {
    const host = $('#fcBody');
    if (!S) { host.innerHTML = `<div class="card empty"><h3>No P6 schedule loaded</h3><p class="viewer-only">The schedule has not been published yet.</p><p class="admin-only">Import the baseline and update <code>.xer</code> files to forecast cost and performance for the coming months.</p><button class="btn admin-only" onclick="APP.showTab('import')">Open Import</button></div>`; $('#fcKpis').innerHTML = ''; return; }
    host.innerHTML = $('#fcTpl').innerHTML;
    const D = A.derive(A.M);
    const n = +($('#fcN')?.value || F.fcN || 6);
    const ahead = monthsAhead(n + 1).slice(1);  // months after the data-date month
    const cur = mk(X.dd);
    const allK = [...new Set([...Object.keys(X.pv), ...Object.keys(X.fc), ...D.inv.map(r => (r.to || r.from).slice(0, 7))])].sort();
    // cumulative series
    let cp = 0, cf = X.ev * X.k, ca = 0;
    const certBy = {};
    D.inv.forEach(r => { const k = (r.to || r.from).slice(0, 7); certBy[k] = (certBy[k] || 0) + r.work; });
    const sP = [], sF = [], sA = [];
    allK.forEach(k => {
      cp += (X.pv[k] || 0) * X.k; sP.push(cp);
      if (k >= cur) { cf += (X.fc[k] || 0) * X.k; sF.push(cf); } else sF.push(null);
      ca += certBy[k] || 0; sA.push(k <= cur ? ca : null);
    });
    const ci = allK.indexOf(cur);
    if (ci >= 0) sF[ci] = X.ev * X.k + (X.fc[cur] || 0) * X.k;
    const bac = S.meta.bac * X.k;
    const next = ahead[0];
    const nextPv = (X.pv[next] || 0) * X.k, nextFc = (X.fc[next] || 0) * X.k;
    const sumN = ks => ks.reduce((s, k) => s + (X.fc[k] || 0), 0) * X.k, sumP = ks => ks.reduce((s, k) => s + (X.pv[k] || 0), 0) * X.k;
    const K = (l, v, h, key) => `<div class="kpi" data-fk="${key}" tabindex="0"><div class="lbl">${l}</div><div class="val">${v}</div>${h ? `<div class="hint">${h}</div>` : ''}</div>`;
    const slip = Math.round((X.fFinish - X.bFinish) / DAY);
    $('#fcKpis').innerHTML = [
      K('Earned (schedule)', fmtM(X.ev * X.k) + '<small>SAR</small>', `${fmtP(X.actPct, 2)} · planned ${fmtP(X.planPct, 2)}`, 'perf'),
      K('Certified (IPC)', fmtM(D.cumWork) + '<small>SAR</small>', `Billing ÷ earned ${X.ev ? (D.cumWork / (X.ev * X.k)).toFixed(2) : '—'}`, 'bill'),
      K('Next month forecast', fmtM(nextFc) + '<small>SAR</small>', `${monthLabel(next)} · baseline ${fmtM(nextPv)}`, 'm:' + next),
      K(`Next ${n} months forecast`, fmtM(sumN(ahead)) + '<small>SAR</small>', `Baseline ${fmtM(sumP(ahead))} · var ${fmtM(sumN(ahead) - sumP(ahead))}`, 'table'),
      K('Forecast finish', fd(X.fFinish), slip > 0 ? `+${slip} d vs baseline` : slip < 0 ? `${-slip} d early` : 'On baseline', 'dates'),
      K('Remaining value', fmtM(bac - X.ev * X.k) + '<small>SAR</small>', `of ${fmtM(bac)} (BAC)`, 'table')
    ].join('');
    $$('#fcKpis .kpi').forEach(el => el.onclick = () => {
      const k = el.dataset.fk;
      if (k.startsWith('m:')) A.Details.open(() => monthDetail(k.slice(2)));
      else if (k === 'dates') openDates();
      else if (k === 'perf') A.Details.open(() => perfDetail());
      else if (k === 'bill') A.Details.kpi('work');
      else $('#fcTable').scrollIntoView({ behavior: 'smooth' });
    });
    if ($('#fcN')) { $('#fcN').value = n; $('#fcN').onchange = e => { F.fcN = +e.target.value; renderForecast(); }; }

    const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const base = A.baseOpts;
    const draw = (id, cfg, pick) => {
      if (charts[id]) charts[id].destroy();
      cfg.options.onClick = (e, els) => { if (els.length) { A.markPicked(); pick(els[0].index); } };
      cfg.options.onHover = (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
      charts[id] = new Chart($('#' + id), cfg);
    };
    draw('chFcCum', {
      type: 'line', data: {
        labels: allK.map(monthLabel), datasets: [
          { label: 'Baseline planned', data: sP, borderColor: col('--s2'), backgroundColor: col('--s2'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: .3 },
          { label: 'Forecast (update)', data: sF, borderColor: col('--s3'), backgroundColor: col('--s3') + '22', fill: false, borderWidth: 2.5, pointRadius: 0, tension: .3 },
          { label: 'Certified (IPC)', data: sA, borderColor: col('--s1'), backgroundColor: col('--s1'), borderWidth: 2.5, pointRadius: 3, tension: .3 }
        ]
      },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, ticks: { color: col('--text-2'), callback: v => fmtM(v) } } }, plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: SAR ${fmt(c.parsed.y, 0)} (${fmtP(c.parsed.y / bac * 100, 1)})` } } } })
    }, i => A.Details.open(() => monthDetail(allK[i])));
    const ks = [cur, ...ahead];
    draw('chFcMonthly', {
      type: 'bar', data: {
        labels: ks.map(monthLabel), datasets: [
          { label: 'Baseline planned', data: ks.map(k => (X.pv[k] || 0) * X.k), backgroundColor: col('--s2'), borderRadius: 4, maxBarThickness: 28 },
          { label: 'Forecast (update)', data: ks.map(k => (X.fc[k] || 0) * X.k), backgroundColor: col('--s3'), borderRadius: 4, maxBarThickness: 28 }
        ]
      },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, ticks: { color: col('--text-2'), callback: v => fmtM(v) } } }, plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: SAR ${fmt(c.parsed.y, 0)}` } } } })
    }, i => A.Details.open(() => monthDetail(ks[i])));

    // performance % forecast (cumulative)
    let pc = 0, fcc = X.ev;
    const pPct = [], fPct = [];
    ks.forEach(k => { pc = 0; Object.keys(X.pv).forEach(m => { if (m <= k) pc += X.pv[m]; }); pPct.push(pc / S.meta.bac * 100); fcc += X.fc[k] || 0; fPct.push(fcc / S.meta.bac * 100); });
    draw('chFcPerf', {
      type: 'line', data: {
        labels: ks.map(monthLabel), datasets: [
          { label: 'Planned % (baseline)', data: pPct, borderColor: col('--s2'), backgroundColor: col('--s2'), borderDash: [6, 4], borderWidth: 2, pointRadius: 3 },
          { label: 'Forecast % (update)', data: fPct, borderColor: col('--s3'), backgroundColor: col('--s3'), borderWidth: 2.5, pointRadius: 3 }
        ]
      },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, ticks: { color: col('--text-2'), callback: v => v.toFixed(0) + '%' } } }, plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${fmtP(c.parsed.y, 2)}` } } } })
    }, i => A.Details.open(() => monthDetail(ks[i])));

    // month table
    let cP = 0; Object.keys(X.pv).forEach(m => { if (m <= cur) cP += X.pv[m]; });
    let cF = X.ev + (X.fc[cur] || 0);
    $('#fcTable').innerHTML = `<thead><tr><th>Month</th><th class="n">Baseline planned</th><th class="n">Forecast</th><th class="n">Variance</th><th class="n">Planned cum %</th><th class="n">Forecast cum %</th><th class="n">Activities</th><th class="n">To start</th><th class="n">To finish</th><th class="n">Critical</th></tr></thead><tbody>` +
      ahead.map(k => {
        cP += X.pv[k] || 0; cF += X.fc[k] || 0;
        const L = activeIn(k);
        const p = (X.pv[k] || 0) * X.k, f = (X.fc[k] || 0) * X.k;
        return `<tr class="click" data-fmonth="${k}"><td><b>${monthLabel(k)}</b></td><td class="n">${fmt(p, 0)}</td><td class="n">${fmt(f, 0)}</td><td class="n ${f < p ? 'neg' : 'pos'}">${fmt(f - p, 0)}</td><td class="n">${fmtP(cP / S.meta.bac * 100, 2)}</td><td class="n">${fmtP(cF / S.meta.bac * 100, 2)}</td><td class="n">${L.length}</td><td class="n">${L.filter(r => r.starts).length}</td><td class="n">${L.filter(r => r.ends).length}</td><td class="n">${L.filter(r => critical(r.a)).length}</td></tr>`;
      }).join('') + '</tbody>';

    // next month required activities by WBS (top)
    const L = activeIn(next).sort((a, b) => b.val - a.val);
    const byW = {};
    L.forEach(r => { const top = X.wbsPath(r.a.w)[Math.min(1, X.wbsPath(r.a.w).length - 1)] || { id: '', code: '', name: 'No WBS' }; const g = byW[top.id] || (byW[top.id] = { w: top, n: 0, v: 0 }); g.n++; g.v += r.val; });
    $('#fcNextTitle').textContent = `Required work next month — ${monthLabel(next)} (${L.length} activities)`;
    $('#fcNext').innerHTML = `<thead><tr><th>WBS</th><th class="n">Activities</th><th class="n">Forecast value</th><th class="n">Share</th></tr></thead><tbody>` +
      Object.values(byW).sort((a, b) => b.v - a.v).map(g => `<tr class="click" data-wbs-open="${esc(g.w.id)}"><td><b>${esc(g.w.code)}</b> ${esc(g.w.name)}</td><td class="n">${g.n}</td><td class="n">${fmt(g.v, 0)}</td><td class="n">${fmtP(nextFc ? g.v / nextFc * 100 : 0, 1)}</td></tr>`).join('') + '</tbody>';
    $('#fcNextAll').onclick = () => A.Details.open(() => monthDetail(next));
  }

  function perfDetail() {
    const top = S.wbs.filter(w => w.depth <= 1);
    const rows = top.map(w => {
      const set = wbsSet(w.id), list = S.acts.filter(a => set.has(a.w));
      const wt = list.reduce((s, a) => s + a.wt, 0), ev = list.reduce((s, a) => s + a.wt * a.p / 100, 0);
      let pv = 0; list.forEach(a => { if (a.wt && a.bs !== null && a.bf !== null) pv += a.wt * Math.max(0, Math.min(1, (X.dd - a.bs + DAY) / (a.bf - a.bs + DAY))); });
      return { w, wt, ev, pv };
    }).filter(r => r.wt);
    return {
      title: 'Performance vs cost', sub: 'Earned value from the P6 update (weighted by ' + S.meta.weighting + '), scaled to the contract value',
      body: tiles([['BAC', sar(S.meta.bac * X.k)], ['PV at data date', sar(X.pvdd * X.k), fmtP(X.planPct, 2)], ['EV at data date', sar(X.ev * X.k), fmtP(X.actPct, 2)],
        ['SPI', X.pvdd ? (X.ev / X.pvdd).toFixed(2) : '—'], ['Schedule variance', sar((X.ev - X.pvdd) * X.k)], ['Certified (IPC)', sar(A.derive(A.M).cumWork)]]) +
        `<h4 class="dsec">By WBS</h4>` + tbl([['WBS'], ['Value', 1], ['Planned %', 1], ['Actual %', 1], ['SPI', 1]], rows.map(r => `<tr class="click" data-wbs-open="${esc(r.w.id)}"><td>${' '.repeat(r.w.depth)}<b>${esc(r.w.code)}</b> ${esc(r.w.name)}</td><td class="n">${fmt(r.wt * X.k, 0)}</td><td class="n">${fmtP(r.pv / r.wt * 100, 1)}</td><td class="n">${fmtP(r.ev / r.wt * 100, 1)}</td><td class="n">${r.pv ? (r.ev / r.pv).toFixed(2) : '—'}</td></tr>`))
    };
  }

  // ---------------- clicks ----------------
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a) { A.Details.open(() => actDetail(a.dataset.act)); return; }
    const w = e.target.closest('.g-wbs[data-wbs]');
    if (w) { const id = w.dataset.wbs; if (e.target.closest('.c-tg')) { F.collapsed.has(id) ? F.collapsed.delete(id) : F.collapsed.add(id); drawGantt(); } else A.Details.open(() => wbsDetail(id)); return; }
    const wo = e.target.closest('[data-wbs-open]');
    if (wo) { A.Details.open(() => wbsDetail(wo.dataset.wbsOpen)); return; }
    const wf = e.target.closest('[data-wbs-filter]');
    if (wf) { A.Details.close(); F.wbs = wf.dataset.wbsFilter; F.view = 'all'; F.zoom = 'month'; showTab('schedule'); syncFilters(); drawGantt(); return; }
    const fm = e.target.closest('[data-fmonth]');
    if (fm) { A.Details.open(() => monthDetail(fm.dataset.fmonth)); }
  });

  function showTab(n) { A.showTab(n); }

  // ---------------- programmes ----------------
  // each programme = a baseline + its latest update; published as its own JSON file
  const PROGRAMS = [
    { id: 'dbl', name: 'Detailed Baseline Rev.04', short: 'Detailed Baseline', file: 'data/schedule-dbl.json', out: 'schedule-dbl.json' },
    { id: 'tp', name: 'Target Plan', short: 'Target Plan', file: 'data/schedule.json', out: 'schedule.json' }
  ];
  const PS = {};          // id → { S, X, src }
  let ACTIVE = (() => { try { return localStorage.getItem('trd_prog') || 'dbl'; } catch (e) { return 'dbl'; } })();
  const prog = id => PROGRAMS.find(p => p.id === id);
  function activate(id) {
    if (!PS[id]) id = PROGRAMS.map(p => p.id).find(k => PS[k]) || id;
    ACTIVE = id;
    try { localStorage.setItem('trd_prog', id); } catch (e) { }
    S = PS[id] ? PS[id].S : null; X = PS[id] ? PS[id].X : null;
    F.wbs = ''; const g = $('#gWbs'); if (g) g.dataset.ready = '';
  }
  // run fn with another programme temporarily active (used by the comparison page)
  function withProg(id, fn) {
    const s0 = S, x0 = X;
    S = PS[id].S; X = PS[id].X;
    try { return fn(); } finally { S = s0; X = x0; }
  }
  function renderProgBars() {
    const html = `<span class="muted small">Programme</span><div class="seg">${PROGRAMS.map(p => `<button data-prog="${p.id}" class="${p.id === ACTIVE ? 'on' : ''}" ${PS[p.id] ? '' : 'disabled title="Not published yet"'}>${esc(p.short)}</button>`).join('')}</div>` +
      (S ? `<span class="muted small">Baseline <b>${esc(S.meta.baseline?.file || '—')}</b> · update <b>${esc(S.meta.update?.file || '—')}</b> · cut-off <b>${fd(X.dd)}</b></span>` : '');
    $$('.prog-bar').forEach(el => { el.innerHTML = html; });
  }
  function renderAll() { renderProgBars(); A.render(); renderSchedule(); renderForecast(); renderJunctions(); renderCompare(); }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-prog]');
    if (!b || b.disabled) return;
    activate(b.dataset.prog);
    renderAll();
  });

  // ---------------- comparison of the two programmes ----------------
  const CF = { show: 'diff', thr: 7, q: '', l1: '' };
  function progSummary(id) {
    return withProg(id, () => {
      const all = S.acts;
      const inc = all.filter(a => !isDone(a));
      const fvs = inc.map(finVar).filter(v => v !== null);
      return {
        id, p: prog(id), dd: X.dd, bStart: X.bStart, bFinish: X.bFinish, fFinish: X.fFinish, slip: Math.round((X.fFinish - X.bFinish) / DAY),
        planPct: X.planPct, actPct: X.actPct, spi: X.pvdd ? X.ev / X.pvdd : null, n: all.length,
        done: all.filter(isDone).length, active: all.filter(isActive).length, ns: all.filter(a => a.st === 'NotStart').length,
        crit: all.filter(critical).length, neg: inc.filter(a => a.tf !== null && a.tf < 0).length,
        late: inc.filter(a => (finVar(a) || 0) > 0).length,
        buckets: [[-Infinity, 0], [1, 30], [31, 90], [91, 180], [181, Infinity]].map(([lo, hi]) => fvs.filter(v => v >= lo && v <= hi).length),
        bac: S.meta.bac * X.k, ev: X.ev * X.k, pv: X.pvdd * X.k, files: S.meta
      };
    });
  }
  const pathKey = (id, depth) => X.wbsPath(id).slice(0, depth + 1).map(w => norm(w.name)).join(' / ');
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  function wbsCompare(depth) {
    const res = {};
    PROGRAMS.forEach(p => withProg(p.id, () => {
      S.wbs.filter(w => w.depth <= depth).forEach(w => {
        const k = pathKey(w.id, w.depth);
        const st = wStats(wbsSet(w.id));
        if (!st.wt && !st.n) return;
        (res[k] = res[k] || { name: w.name, depth: w.depth, code: w.code, ids: {} })[p.id] = st;
        res[k].ids[p.id] = w.id;
      });
    }));
    return Object.values(res);
  }
  function actPairs() {
    const A_ = PS.dbl.S.acts, B_ = PS.tp.S.acts;
    const mb = {}; B_.forEach(a => { mb[a.c] = a; });
    const ma = {}; A_.forEach(a => { ma[a.c] = a; });
    const pairs = A_.filter(a => mb[a.c]).map(a => ({ c: a.c, a, b: mb[a.c] }));
    return { pairs, onlyA: A_.filter(a => !mb[a.c]), onlyB: B_.filter(b => !ma[b.c]) };
  }
  const dd_ = (x, y) => x !== null && y !== null ? Math.round((y - x) / DAY) : null;
  const dTag = v => v === null ? '—' : `<span class="${v > 0 ? 'neg' : v < 0 ? 'pos' : ''}">${v > 0 ? '+' : ''}${v}</span>`;

  function renderCompare() {
    const host = $('#cmpBody');
    if (!host) return;
    if (!PS.dbl || !PS.tp) {
      host.innerHTML = `<div class="card empty"><h3>Both programmes are needed for the comparison</h3><p>Published: ${PROGRAMS.map(p => `${esc(p.name)} ${PS[p.id] ? '✓' : '✗'}`).join(' · ')}</p><button class="btn admin-only" onclick="APP.showTab('import')">Open Import</button></div>`;
      return;
    }
    const sa = progSummary('dbl'), sb = progSummary('tp');
    const row = (lbl, fa, fb, diff) => `<tr><td>${lbl}</td><td class="n">${fa}</td><td class="n">${fb}</td><td class="n">${diff ?? ''}</td></tr>`;
    const pp = v => fmtP(v, 2);
    const head = `<div class="cmp-head">${[sa, sb].map(x => `<div class="card cmp-card click" data-prog="${x.id}"><div class="cmp-t">${esc(x.p.name)}</div>
        <div class="muted small">BL ${esc(x.files.baseline?.file || '—')}<br>Update ${esc(x.files.update?.file || '—')} · cut-off ${fd(x.dd)}</div>
        <div class="cmp-big"><div><span>Planned</span><b>${pp(x.planPct)}</b></div><div><span>Actual</span><b>${pp(x.actPct)}</b></div><div><span>SPI</span><b>${x.spi ? x.spi.toFixed(2) : '—'}</b></div><div><span>Forecast finish</span><b class="${x.slip > 0 ? 'neg' : ''}">${fd(x.fFinish)}</b><em class="muted small">${x.slip > 0 ? '+' : ''}${x.slip} d vs ${fd(x.bFinish)}</em></div></div>
        <div class="muted small">Click to make it the active programme on all schedule pages</div></div>`).join('')}</div>`;
    const sumTable = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Measure</th><th class="n">${esc(sa.p.short)}</th><th class="n">${esc(sb.p.short)}</th><th class="n">Target − Detailed</th></tr></thead><tbody>` +
      row('Cut-off (data date)', fd(sa.dd), fd(sb.dd), dd_(sa.dd, sb.dd) + ' d') +
      row('Baseline start', fd(sa.bStart), fd(sb.bStart), dTag(dd_(sa.bStart, sb.bStart)) + ' d') +
      row('Baseline finish', fd(sa.bFinish), fd(sb.bFinish), dTag(dd_(sa.bFinish, sb.bFinish)) + ' d') +
      row('Forecast finish (update)', `<b>${fd(sa.fFinish)}</b>`, `<b>${fd(sb.fFinish)}</b>`, dTag(dd_(sa.fFinish, sb.fFinish)) + ' d') +
      row('Delay vs own baseline', dTag(sa.slip) + ' d', dTag(sb.slip) + ' d', dTag(sb.slip - sa.slip) + ' d') +
      row('Planned % at cut-off', pp(sa.planPct), pp(sb.planPct), (sb.planPct - sa.planPct >= 0 ? '+' : '') + (sb.planPct - sa.planPct).toFixed(2) + '%') +
      row('Actual % at cut-off', pp(sa.actPct), pp(sb.actPct), (sb.actPct - sa.actPct >= 0 ? '+' : '') + (sb.actPct - sa.actPct).toFixed(2) + '%') +
      row('Variance (actual − planned)', pp(sa.actPct - sa.planPct), pp(sb.actPct - sb.planPct), '') +
      row('SPI', sa.spi ? sa.spi.toFixed(2) : '—', sb.spi ? sb.spi.toFixed(2) : '—', '') +
      row('Planned value at cut-off (SAR)', fmt(sa.pv, 0), fmt(sb.pv, 0), fmt(sb.pv - sa.pv, 0)) +
      row('Earned value at cut-off (SAR)', fmt(sa.ev, 0), fmt(sb.ev, 0), fmt(sb.ev - sa.ev, 0)) +
      row('Activities', sa.n.toLocaleString(), sb.n.toLocaleString(), (sb.n - sa.n).toLocaleString()) +
      row('Completed / in progress / not started', `${sa.done} / ${sa.active} / ${sa.ns}`, `${sb.done} / ${sb.active} / ${sb.ns}`, '') +
      row('Late vs baseline (not complete)', sa.late.toLocaleString(), sb.late.toLocaleString(), (sb.late - sa.late).toLocaleString()) +
      row('Critical (TF ≤ 0)', sa.crit.toLocaleString(), sb.crit.toLocaleString(), (sb.crit - sa.crit).toLocaleString()) +
      row('Negative float', sa.neg.toLocaleString(), sb.neg.toLocaleString(), (sb.neg - sa.neg).toLocaleString()) +
      '</tbody></table></div>';

    // junctions
    const ja = withProg('dbl', () => junctions()), jb = withProg('tp', () => junctions());
    const jRows = ja.map(j => { const k = jb.find(x => x.key === j.key); if (!k) return ''; return `<tr><td><b>${j.name}</b> <span class="muted small">Ch ${esc(j.ch)}</span></td>
      <td class="n">${fmtP(j.st.plan, 1)}</td><td class="n">${fmtP(k.st.plan, 1)}</td><td class="n">${fmtP(j.st.act, 1)}</td><td class="n">${fmtP(k.st.act, 1)}</td>
      <td>${fd(j.st.bFinish)}</td><td>${fd(k.st.bFinish)}</td><td><b>${fd(j.st.finish)}</b></td><td><b>${fd(k.st.finish)}</b></td><td class="n">${dTag(dd_(j.st.finish, k.st.finish))}</td></tr>`; }).join('');

    // WBS level 1–2
    const W2 = wbsCompare(1).filter(r => r.dbl && r.tp);
    const wRows = W2.map(r => `<tr class="${r.depth === 0 ? 'g-grp' : ''}"><td>${' '.repeat(r.depth)}<b>${esc(r.code)}</b> ${esc(r.name)}</td>
      <td class="n">${fmtP(r.dbl.plan, 1)}</td><td class="n">${fmtP(r.tp.plan, 1)}</td><td class="n">${fmtP(r.dbl.act, 1)}</td><td class="n">${fmtP(r.tp.act, 1)}</td>
      <td>${fd(r.dbl.bFinish)}</td><td>${fd(r.tp.bFinish)}</td><td>${fd(r.dbl.finish)}</td><td>${fd(r.tp.finish)}</td><td class="n">${dTag(dd_(r.dbl.finish, r.tp.finish))}</td></tr>`).join('');

    // next 12 months
    const months = []; let m = monthStart(Math.max(sa.dd, sb.dd));
    for (let i = 0; i < 12; i++) { months.push(mk(m)); m = addMonths(m, 1); }
    const mv = (id, key, k) => withProg(id, () => (X[key][k] || 0) * X.k);
    const mRows = months.map(k => `<tr><td><b>${monthLabel(k)}</b></td><td class="n">${fmt(mv('dbl', 'pv', k), 0)}</td><td class="n">${fmt(mv('dbl', 'fc', k), 0)}</td><td class="n">${fmt(mv('tp', 'pv', k), 0)}</td><td class="n">${fmt(mv('tp', 'fc', k), 0)}</td><td class="n">${dTag(Math.round((mv('tp', 'fc', k) - mv('dbl', 'fc', k)) / 1e3)) } K</td></tr>`).join('');

    const ap = actPairs();
    host.innerHTML = head + `<div class="grid g-1-1"><div class="card"><div class="card-h"><h3>Programme summary</h3><span class="muted">Positive difference = Target Plan later</span></div>${sumTable}</div>
      <div class="card"><div class="card-h"><h3>Cumulative progress — both programmes</h3></div><div class="chart-box tall"><canvas id="chCmpCurve"></canvas></div></div></div>
      <div class="grid g-1-1"><div class="card"><div class="card-h"><h3>Delay distribution (finish vs own baseline, open activities)</h3></div><div class="chart-box"><canvas id="chCmpDelay"></canvas></div></div>
      <div class="card"><div class="card-h"><h3>Monthly value — baseline & forecast, both programmes</h3></div><div class="chart-box"><canvas id="chCmpMonthly"></canvas></div></div></div>
      <div class="card"><div class="card-h"><h3>Junctions — both programmes</h3><span class="muted">Planned / actual % at each cut-off · finish dates · forecast difference (days)</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Junction</th><th class="n">Planned DBL</th><th class="n">Planned TP</th><th class="n">Actual DBL</th><th class="n">Actual TP</th><th>BL finish DBL</th><th>BL finish TP</th><th>Forecast DBL</th><th>Forecast TP</th><th class="n">Δ forecast</th></tr></thead><tbody>${jRows}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>WBS levels 1–2 — both programmes</h3><span class="muted">DBL = Detailed Baseline · TP = Target Plan</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>WBS</th><th class="n">Planned DBL</th><th class="n">Planned TP</th><th class="n">Actual DBL</th><th class="n">Actual TP</th><th>BL finish DBL</th><th>BL finish TP</th><th>Forecast DBL</th><th>Forecast TP</th><th class="n">Δ forecast</th></tr></thead><tbody>${wRows}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Forecast — next 12 months (SAR excl. VAT)</h3></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Month</th><th class="n">DBL planned</th><th class="n">DBL forecast</th><th class="n">TP planned</th><th class="n">TP forecast</th><th class="n">Δ forecast (TP − DBL)</th></tr></thead><tbody>${mRows}</tbody></table></div></div>
      <div class="card" id="cmpActs"><div class="card-h"><h3>Activities — side by side</h3><span class="muted">${ap.pairs.length.toLocaleString()} common IDs · ${ap.onlyA.length} only in Detailed · ${ap.onlyB.length} only in Target</span></div>
        <div class="g-toolbar">
          <div class="seg" id="cfShow"><button data-v="diff">Forecast differs</button><button data-v="late">Late in both</button><button data-v="onlyA">Only in Detailed</button><button data-v="onlyB">Only in Target</button><button data-v="all">All common</button></div>
          <label class="chk">Difference ≥ <input type="number" id="cfThr" min="0" value="${CF.thr}" style="width:64px"> days</label>
          <select id="cfL1"><option value="">All WBS</option>${PS.dbl.S.wbs.filter(w => w.depth === 0).map(w => `<option value="${esc(norm(w.name))}">${esc(w.code)} — ${esc(w.name)}</option>`).join('')}</select>
          <input type="search" id="cfQ" placeholder="Search ID or activity…" value="${esc(CF.q)}">
          <button class="btn ghost" id="cfCsv">⬇ CSV</button>
        </div>
        <div id="cmpActBody"></div></div>`;
    drawCmpActs(ap);
    $$('#cfShow button').forEach(b => b.onclick = () => { CF.show = b.dataset.v; drawCmpActs(ap); });
    $('#cfThr').oninput = e => { CF.thr = +e.target.value || 0; drawCmpActs(ap); };
    $('#cfL1').onchange = e => { CF.l1 = e.target.value; drawCmpActs(ap); };
    $('#cfQ').oninput = e => { CF.q = e.target.value; clearTimeout(renderCompare.t); renderCompare.t = setTimeout(() => drawCmpActs(ap), 200); };
    $('#cfCsv').onclick = () => cmpCsv();

    // charts
    const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const base = A.baseOpts;
    const mkc = (id, cfg) => { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($('#' + id), cfg); };
    const keys = [...new Set([...Object.keys(PS.dbl.X.pv), ...Object.keys(PS.tp.X.pv), ...Object.keys(PS.dbl.X.fc), ...Object.keys(PS.tp.X.fc)])].sort();
    const cum = (id, key, startEv) => withProg(id, () => { let c = startEv ? X.ev : 0; const ddk = mk(X.dd); return keys.map(k => { if (startEv && k < ddk) return null; c += X[key][k] || 0; return +(c / S.meta.bac * 100).toFixed(2); }); });
    mkc('chCmpCurve', { type: 'line', data: { labels: keys.map(monthLabel), datasets: [
      { label: 'Detailed — baseline', data: cum('dbl', 'pv'), borderColor: col('--s2'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: .3 },
      { label: 'Detailed — forecast', data: cum('dbl', 'fc', true), borderColor: col('--s2'), borderWidth: 2.5, pointRadius: 0, tension: .3 },
      { label: 'Target — baseline', data: cum('tp', 'pv'), borderColor: col('--s1'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: .3 },
      { label: 'Target — forecast', data: cum('tp', 'fc', true), borderColor: col('--s1'), borderWidth: 2.5, pointRadius: 0, tension: .3 }] },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, max: 100, ticks: { color: col('--text-2'), callback: v => v + '%' } } }, plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${fmtP(c.parsed.y, 2)}` } } } }) });
    mkc('chCmpDelay', { type: 'bar', data: { labels: ['On time / early', '1–30 d', '31–90 d', '91–180 d', '> 180 d'], datasets: [
      { label: sa.p.short, data: sa.buckets, backgroundColor: col('--s2'), borderRadius: 4, maxBarThickness: 30 },
      { label: sb.p.short, data: sb.buckets, backgroundColor: col('--s1'), borderRadius: 4, maxBarThickness: 30 }] },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, ticks: { color: col('--text-2'), precision: 0 } } } }) });
    mkc('chCmpMonthly', { type: 'bar', data: { labels: months.map(monthLabel), datasets: [
      { label: 'Detailed planned', data: months.map(k => mv('dbl', 'pv', k)), backgroundColor: col('--s2') + '88', borderRadius: 3, maxBarThickness: 14 },
      { label: 'Detailed forecast', data: months.map(k => mv('dbl', 'fc', k)), backgroundColor: col('--s2'), borderRadius: 3, maxBarThickness: 14 },
      { label: 'Target planned', data: months.map(k => mv('tp', 'pv', k)), backgroundColor: col('--s1') + '88', borderRadius: 3, maxBarThickness: 14 },
      { label: 'Target forecast', data: months.map(k => mv('tp', 'fc', k)), backgroundColor: col('--s1'), borderRadius: 3, maxBarThickness: 14 }] },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, ticks: { color: col('--text-2'), callback: v => fmtM(v) } } }, plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: SAR ${fmt(c.parsed.y, 0)}` } } } }) });
  }
  let cmpRows = [];
  function drawCmpActs(ap) {
    $$('#cfShow button').forEach(b => b.classList.toggle('on', b.dataset.v === CF.show));
    const q = norm(CF.q);
    const l1 = (id, pid) => withProg(pid, () => norm((X.wbsPath(id)[0] || {}).name));
    const okL1 = (a, pid) => !CF.l1 || l1(a.w, pid) === CF.l1;
    const okQ = a => !q || norm(a.c + ' ' + a.n).includes(q);
    let html = '';
    if (CF.show === 'onlyA' || CF.show === 'onlyB') {
      const pid = CF.show === 'onlyA' ? 'dbl' : 'tp';
      const list = (CF.show === 'onlyA' ? ap.onlyA : ap.onlyB).filter(a => okQ(a) && okL1(a, pid));
      cmpRows = list.map(a => ({ c: a.c, n: a.n, only: pid, a }));
      html = tbl([['ID'], ['Activity'], ['WBS'], ['BL start'], ['BL finish'], ['Forecast finish'], ['%', 1], ['Status']], list.slice(0, 600).map(a => `<tr class="click" data-cmp="${esc(a.c)}"><td><b>${esc(a.c)}</b></td><td class="desc">${esc(a.n)}</td><td class="small">${esc(withProg(pid, () => (X.W[a.w] || {}).name || ''))}</td><td>${fd(a.bs)}</td><td>${fd(a.bf)}</td><td>${fd(a.f)}</td><td class="n">${Math.round(a.p)}%</td><td>${stTag(a)}</td></tr>`));
    } else {
      let list = ap.pairs.filter(r => okQ(r.a) && okL1(r.a, 'dbl'));
      list.forEach(r => { r.dBL = dd_(r.a.bf, r.b.bf); r.dF = dd_(r.a.f, r.b.f); r.vA = finVar(r.a); r.vB = finVar(r.b); });
      if (CF.show === 'diff') list = list.filter(r => r.dF !== null && Math.abs(r.dF) >= CF.thr).sort((x, y) => Math.abs(y.dF) - Math.abs(x.dF));
      else if (CF.show === 'late') list = list.filter(r => !isDone(r.a) && (r.vA || 0) >= Math.max(1, CF.thr) && (r.vB || 0) >= Math.max(1, CF.thr)).sort((x, y) => (y.vA + y.vB) - (x.vA + x.vB));
      cmpRows = list;
      html = `<p class="muted small">${list.length.toLocaleString()} activities${list.length > 600 ? ' — showing the first 600' : ''}</p>` + tbl([['ID'], ['Activity'], ['BL finish DBL'], ['BL finish TP'], ['Δ BL', 1], ['Forecast DBL'], ['Forecast TP'], ['Δ forecast', 1], ['Late DBL', 1], ['Late TP', 1], ['%', 1], ['Status']],
        list.slice(0, 600).map(r => `<tr class="click" data-cmp="${esc(r.c)}"><td><b>${esc(r.c)}</b></td><td class="desc">${esc(r.b.n)}</td><td>${fd(r.a.bf)}</td><td>${fd(r.b.bf)}</td><td class="n">${dTag(r.dBL)}</td><td>${fd(r.a.f)}</td><td>${fd(r.b.f)}</td><td class="n">${dTag(r.dF)}</td><td class="n">${dTag(r.vA)}</td><td class="n">${dTag(r.vB)}</td><td class="n">${Math.round(r.b.p)}%</td><td>${stTag(r.b)}</td></tr>`));
    }
    $('#cmpActBody').innerHTML = html;
  }
  function cmpCsv() {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Activity ID', 'Activity', 'BL finish DBL', 'BL finish TP', 'Forecast DBL', 'Forecast TP', 'Delta forecast (d)', 'Late DBL (d)', 'Late TP (d)', '% complete'];
    const lines = [head.map(q).join(',')].concat(cmpRows.map(r => r.only ? [r.c, r.n, r.only === 'dbl' ? ds(r.a.bf) : '', r.only === 'tp' ? ds(r.a.bf) : '', r.only === 'dbl' ? ds(r.a.f) : '', r.only === 'tp' ? ds(r.a.f) : '', '', '', '', r.a.p] : [r.c, r.b.n, ds(r.a.bf), ds(r.b.bf), ds(r.a.f), ds(r.b.f), r.dF, r.vA, r.vB, r.b.p]).map(r => r.map(q).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'programme-comparison-' + CF.show + '.csv'; l.click();
  }
  function cmpDetail(code) {
    const get = id => PS[id] ? withProg(id, () => { const a = X.A[code]; return a ? { a, path: X.wbsPath(a.w).map(w => w.code + ' ' + w.name).join(' › '), fv: finVar(a), crit: critical(a) } : null; }) : null;
    const x = get('dbl'), y = get('tp');
    const r = (l, f) => `<tr><td>${l}</td><td>${x ? f(x) : '<span class="muted">not in programme</span>'}</td><td>${y ? f(y) : '<span class="muted">not in programme</span>'}</td></tr>`;
    const nm = (x || y).a.n;
    return {
      title: `${esc(code)} — ${esc(nm)}`, sub: 'Detailed Baseline Rev.04 vs Target Plan',
      body: `<div class="table-wrap"><table class="tbl"><thead><tr><th>Field</th><th>Detailed Baseline</th><th>Target Plan</th></tr></thead><tbody>` +
        r('WBS', o => esc(o.path)) + r('Baseline start', o => fd(o.a.bs)) + r('Baseline finish', o => fd(o.a.bf)) +
        r('Start (actual / forecast)', o => fd(o.a.s) + (o.a.as ? ' <span class="muted small">actual</span>' : '')) + r('Finish (forecast)', o => '<b>' + fd(o.a.f) + '</b>') +
        r('Finish variance vs own baseline', o => dTag(o.fv) + ' d') + r('% complete', o => fmtP(o.a.p, 1)) + r('Status', o => stTag(o.a)) +
        r('Original / remaining duration', o => `${o.a.d} d / ${o.a.rd} d`) + r('Total float', o => o.a.tf === null ? '—' : Math.round(o.a.tf) + ' d' + (o.crit ? ' <span class="status bad">Critical</span>' : '')) +
        r('Value', o => o.a.wt ? 'SAR ' + fmt(o.a.wt * withProg(o === x ? 'dbl' : 'tp', () => X.k), 0) : '—') +
        `</tbody></table></div>` + (x && y ? `<p class="muted">Forecast finish difference: <b>${dTag(dd_(x.a.f, y.a.f))} d</b> (Target − Detailed) · baseline finish difference: <b>${dTag(dd_(x.a.bf, y.a.bf))} d</b></p>` : '') +
        `<p class="row-btns">${x ? `<button class="btn" data-cmpopen="dbl|${esc(code)}">Full details in Detailed Baseline →</button>` : ''}${y ? `<button class="btn" data-cmpopen="tp|${esc(code)}">Full details in Target Plan →</button>` : ''}</p>`
    };
  }
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-cmp]');
    if (c) { A.Details.open(() => cmpDetail(c.dataset.cmp)); return; }
    const o = e.target.closest('[data-cmpopen]');
    if (o) { const [pid, code] = o.dataset.cmpopen.split('|'); A.Details.open(() => withProg(pid, () => actDetail(code))); }
  });

  // ---------------- junction slides (presentation) ----------------
  let SLIDES = null;
  window.JSLIDES = { get: key => SLIDES ? SLIDES.slides.filter(s => s.key === key) : [], meta: () => SLIDES };
  async function loadSlides() {
    let s = null;
    try { s = await idbGet('slides'); } catch (e) { }
    if (!s) { try { const r = await fetch('data/slides.json', { cache: 'no-store' }); if (r.ok) s = await r.json(); } catch (e) { } }
    SLIDES = s;
  }
  async function onSlides(files) {
    const st = $('#slStatus');
    const imgs = [...files].filter(f => /\.(jpe?g|png)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!imgs.length) { st.innerHTML = '✗ Export the presentation as images first (PowerPoint: File › Export › JPEG) and drop the slide images here.'; return; }
    st.innerHTML = `Reading ${imgs.length} images…`;
    const order = ['overview', 'J7', 'J5', 'J3', 'J1'];
    const slides = [];
    for (const [i, f] of imgs.entries()) {
      const bmp = await createImageBitmap(f);
      const sc = Math.min(1, 1870 / bmp.width);
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const m = /junction[\s_-]*0?([1357])|\bj[\s_-]*0?([1357])\b/i.exec(f.name);
      slides.push({ n: i + 1, key: m ? 'J' + (m[1] || m[2]) : (order[i] || 'overview'), title: f.name.replace(/\.[^.]+$/, ''), date: $('#slDate').value || '', src: c.toDataURL('image/jpeg', .82) });
    }
    SLIDES = { v: 1, file: imgs.map(f => f.name).join(', '), exported: new Date().toISOString().slice(0, 10), slides };
    await idbSet('slides', SLIDES);
    st.innerHTML = `✓ ${slides.length} slides loaded: ` + slides.map((s, i) => `<label class="chk">${esc(s.title)} → <select data-sli="${i}">${['overview', 'J7', 'J5', 'J3', 'J1'].map(k => `<option ${k === s.key ? 'selected' : ''}>${k}</option>`).join('')}</select></label>`).join(' ') +
      '<br>Check the junction for each slide, then <b>Download slides.json</b> and upload it to <code>data/</code>.';
    $$('[data-sli]').forEach(sel => sel.onchange = async () => { SLIDES.slides[+sel.dataset.sli].key = sel.value; await idbSet('slides', SLIDES); renderJunctions(); });
    renderJunctions();
  }

  // ---------------- import / export ----------------
  function setStatus(t) { $('#xerStatus').innerHTML = t; }
  function readText(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsText(file, 'windows-1252'); }); }
  const pend = {};   // programme id → { b, u, fb, fu }
  async function onXer(kind, file) {
    const pid = $('#xerProg').value, P = prog(pid);
    const pe = pend[pid] || (pend[pid] = { b: null, u: null, fb: '', fu: '' });
    setStatus(`Reading <b>${esc(file.name)}</b> (${(file.size / 1048576).toFixed(1)} MB) into <b>${esc(P.name)}</b>…`);
    await new Promise(r => setTimeout(r, 30));
    try {
      const parsed = readFile(await readText(file), file.name);
      pe[kind] = parsed; pe['f' + kind] = file.name;
      const old = PS[pid] && PS[pid].S;
      // re-use the other half (baseline or update) from the programme already loaded, by re-reading is not possible → keep what was imported this session
      const msg = [`✓ ${esc(P.name)} — ${kind === 'b' ? 'baseline' : 'update'} "${esc(file.name)}": ${parsed.acts.length.toLocaleString()} activities, ${parsed.wbs.length} WBS nodes · data date ${fd(parsed.proj.dataDate)}`];
      if (!(pe.b && pe.u) && old) msg.push(`• Drop the ${pe.b ? 'update' : 'baseline'} of this programme too — both files are needed to rebuild it.`);
      if (pe.b && pe.u || !old) {
        S = combine(pe.b, pe.u, { b: pe.fb, u: pe.fu });
        index();
        PS[pid] = { S, X, src: 'local import' };
        await idbSet('schedule:' + pid, S);
        activate(pid);
        msg.push(`✓ ${esc(P.name)} ready: ${S.acts.length.toLocaleString()} activities. To publish: <b>Download</b> → upload <code>${P.out}</code> to <code>data/</code>.`);
        renderAll();
      }
      setStatus(msg.join('<br>'));
    } catch (e) { setStatus('✗ ' + esc(e.message)); }
  }
  function wireImport() {
    [['b', 'dropXerB', 'fileXerB'], ['u', 'dropXerU', 'fileXerU']].forEach(([k, d, i]) => {
      const drop = $('#' + d), inp = $('#' + i);
      inp.onchange = () => inp.files[0] && onXer(k, inp.files[0]);
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', e => e.dataTransfer.files[0] && onXer(k, e.dataTransfer.files[0]));
    });
    $('#xerProg').innerHTML = PROGRAMS.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    $('#schedExport').onclick = () => {
      const pid = $('#xerProg').value, P = prog(pid);
      if (!PS[pid]) return setStatus('Nothing to export for ' + esc(P.name) + ' yet.');
      const blob = new Blob([JSON.stringify(PS[pid].S)], { type: 'application/json' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = P.out; l.click();
    };
    $('#schedClear').onclick = async () => { for (const p of PROGRAMS) await idbDel('schedule:' + p.id); await idbDel('schedule'); setStatus('Local schedules cleared — reloading the published ones…'); await boot(true); };
    const sd = $('#dropSl'), si = $('#fileSl');
    if (sd) {
      si.onchange = () => si.files.length && onSlides(si.files);
      ['dragenter', 'dragover'].forEach(ev => sd.addEventListener(ev, e => { e.preventDefault(); sd.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => sd.addEventListener(ev, e => { e.preventDefault(); sd.classList.remove('over'); }));
      sd.addEventListener('drop', e => e.dataTransfer.files.length && onSlides(e.dataTransfer.files));
      $('#slExport').onclick = () => { if (!SLIDES) return; const blob = new Blob([JSON.stringify(SLIDES)], { type: 'application/json' }); const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'slides.json'; l.click(); };
      $('#slClear').onclick = async () => { await idbDel('slides'); await loadSlides(); renderJunctions(); $('#slStatus').textContent = 'Local slides cleared — showing the published ones.'; };
    }
  }

  async function boot(skipLocal) {
    setStatus('Loading schedules…');
    const sb = $('#schedBody'); if (sb && !S) sb.innerHTML = '<div class="card empty"><h3>Loading P6 schedules…</h3><p class="muted">About 6 MB per programme — a few seconds on the first visit.</p></div>';
    await Promise.all(PROGRAMS.map(async p => {
      let s = null, src = '';
      if (!skipLocal) { s = await idbGet('schedule:' + p.id); if (!s && p.id === 'tp') s = await idbGet('schedule'); if (s) src = 'local import'; }
      if (!s) { try { const r = await fetch(p.file, { cache: 'no-store' }); if (r.ok) { s = await r.json(); src = 'published ' + p.file; } } catch (e) { } }
      if (s) { S = s; index(); PS[p.id] = { S, X, src }; } else delete PS[p.id];
    }));
    await loadSlides();
    activate(ACTIVE);
    setStatus(PROGRAMS.map(p => PS[p.id] ? `✓ <b>${esc(p.name)}</b> — ${esc(PS[p.id].src)} · baseline ${esc(PS[p.id].S.meta.baseline?.file || '—')} · update ${esc(PS[p.id].S.meta.update?.file || '—')} · cut-off ${fd(PS[p.id].X.dd)}` : `✗ <b>${esc(p.name)}</b> not published`).join('<br>'));
    renderAll();
  }

  wireFilters();
  wireImport();
  A.onTab = n => { if (n === 'schedule') { renderSchedule(); } if (n === 'forecast') renderForecast(); if (n === 'junctions') renderJunctions(); if (n === 'compare') renderCompare(); };
  A.whenReady(() => boot());
})();
