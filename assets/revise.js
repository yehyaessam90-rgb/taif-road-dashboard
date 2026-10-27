/* Recovery / Revised programme from a P6 update XER.
   1 logic fix (out-of-sequence, SF, leads, open ends …)  2 remaining durations  3 CPM reschedule on the P6 calendars
   4 compress / extend the remaining work to the target finish  5 re-baseline: planned dates = actual / current dates,
   actual cost = earned value, remaining cost = budget − EV, at completion = budget  →  XER + Excel log of every change. */
(function () {
  'use strict';
  const A = window.APP, SX = window.SCHEDX;
  const $ = s => document.querySelector(s);
  const esc = A.esc, fmt = A.fmt;
  const DAY = 864e5, MIN = 6e4;

  // ---------------- dates ----------------
  const pdt = s => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null; };
  const xd = t => t === null || t === undefined || !isFinite(t) ? '' : new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  const fdt = SX.fdt;

  // ---------------- XER read / write ----------------
  function xerModel(text) {
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const tabs = {};
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('%T\t')) { const n = l.slice(3).trim(); cur = tabs[n] ? null : (tabs[n] = { name: n, f: {}, rows: [] }); }
      else if (cur && l.startsWith('%F\t')) l.slice(3).split('\t').forEach((k, j) => { cur.f[k] = j; });
      else if (cur && l.startsWith('%R\t')) cur.rows.push({ i, v: l.slice(3).split('\t') });
    }
    const get = (tb, r, k) => { const j = tabs[tb].f[k]; return j === undefined ? '' : (r.v[j] ?? ''); };
    const set = (tb, r, k, val) => { const j = tabs[tb].f[k]; if (j === undefined) return; r.v[j] = val; r.dirty = true; };
    const write = () => { Object.values(tabs).forEach(t => t.rows.forEach(r => { if (r.dirty) lines[r.i] = '%R\t' + r.v.join('\t'); })); return lines.join(nl); };
    return { tabs, get, set, text: write };
  }
  // XER files are Windows-1252
  const CP = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function enc1252(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); u[i] = c < 256 ? c : (CP[c] ?? 63); } return u; }

  // ---------------- working-time clock of a P6 calendar ----------------
  // W(t) = working minutes before t · S(w) = first working instant after w minutes · F(w) = instant at which w minutes are done
  function clockOf(cal, D0, D1) {
    const iv = D => cal.x[D] || cal.w[((D + 4) % 7 + 7) % 7];
    const n = D1 - D0 + 1, pre = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) pre[k + 1] = pre[k] + iv(D0 + k).reduce((s, p) => s + p[1] - p[0], 0);
    const total = pre[n];
    const W = t => {
      const D = Math.floor(t / DAY);
      if (D < D0) return 0;
      if (D > D1) return total;
      const m = (t - D * DAY) / MIN;
      let s = pre[D - D0];
      for (const p of iv(D)) s += Math.max(0, Math.min(m, p[1]) - p[0]);
      return s;
    };
    const find = (w, strict) => { let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (strict ? pre[mid + 1] > w : pre[mid + 1] >= w) hi = mid; else lo = mid + 1; } return lo; };
    const S = w => {
      if (w < 0) w = 0;
      if (w >= total) return (D1 + 1) * DAY;
      const k = find(w, true);
      let r = w - pre[k];
      for (const p of iv(D0 + k)) { const len = p[1] - p[0]; if (r < len) return (D0 + k) * DAY + (p[0] + r) * MIN; r -= len; }
      return (D0 + k + 1) * DAY;
    };
    const F = w => {
      if (w <= 0) return S(0);
      if (w > total) return (D1 + 1) * DAY;
      const k = find(w, false);
      let r = w - pre[k];
      for (const p of iv(D0 + k)) { const len = p[1] - p[0]; if (r <= len) return (D0 + k) * DAY + (p[0] + r) * MIN; r -= len; }
      return (D0 + k + 1) * DAY;
    };
    return { W, S, F, snapS: t => S(W(t)), snapF: t => F(W(t)) };
  }

  // ---------------- network from the (logic-fixed) XER ----------------
  function network(X) {
    const g = (r, k) => X.get('TASK', r, k);
    const cnt = {};
    X.tabs.TASK.rows.forEach(r => { const p = g(r, 'proj_id'); cnt[p] = (cnt[p] || 0) + 1; });
    const pid = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    const proj = (X.tabs.PROJECT?.rows || []).find(r => X.get('PROJECT', r, 'proj_id') === pid);
    const dd = proj ? (pdt(X.get('PROJECT', proj, 'last_recalc_date')) ?? pdt(X.get('PROJECT', proj, 'next_data_date'))) : null;
    if (dd === null) throw new Error('The XER has no data date (PROJECT.last_recalc_date).');
    const cals = {}, hpd = {}, cname = {};
    (X.tabs.CALENDAR?.rows || []).forEach(r => {
      const id = X.get('CALENDAR', r, 'clndr_id'), p = SX.parseCal(X.get('CALENDAR', r, 'clndr_data'));
      if (p) cals[id] = p;
      hpd[id] = parseFloat(X.get('CALENDAR', r, 'day_hr_cnt')) || 8; cname[id] = X.get('CALENDAR', r, 'clndr_name');
    });
    const defCal = proj ? X.get('PROJECT', proj, 'clndr_id') : '';
    const acts = [], byId = {};
    X.tabs.TASK.rows.forEach(r => {
      if (g(r, 'proj_id') !== pid || g(r, 'task_type') === 'TT_WBS') return;
      let cl = g(r, 'clndr_id');
      if (!cals[cl]) cl = cals[defCal] ? defCal : Object.keys(cals)[0];
      const st = g(r, 'status_code'), od = (parseFloat(g(r, 'target_drtn_hr_cnt')) || 0) * 60, rd = (parseFloat(g(r, 'remain_drtn_hr_cnt')) || 0) * 60;
      let pct;
      if (st === 'TK_Complete') pct = 100;
      else if (st === 'TK_NotStart') pct = 0;
      else if (g(r, 'complete_pct_type') === 'CP_Phys' || !od) pct = parseFloat(g(r, 'phys_complete_pct')) || 0;
      else pct = Math.max(0, Math.min(100, (od - rd) / od * 100));
      const a = {
        row: r, id: g(r, 'task_id'), code: g(r, 'task_code'), name: g(r, 'task_name'), wbs: g(r, 'wbs_id'), type: g(r, 'task_type'), st, cl, hpd: hpd[cl] || 10,
        as: pdt(g(r, 'act_start_date')), af: pdt(g(r, 'act_end_date')), es0: pdt(g(r, 'early_start_date')), ef0: pdt(g(r, 'early_end_date')),
        rs0: pdt(g(r, 'restart_date')), re0: pdt(g(r, 'reend_date')), ts0: pdt(g(r, 'target_start_date')), tf0: pdt(g(r, 'target_end_date')),
        od, rd, pct, cs: g(r, 'cstr_type'), cd: pdt(g(r, 'cstr_date')), cs2: g(r, 'cstr_type2'), cd2: pdt(g(r, 'cstr_date2')), preds: [], succs: []
      };
      if (a.st === 'TK_Complete' && a.af === null) a.af = a.ef0;
      if (a.st !== 'TK_NotStart' && a.as === null) a.as = a.es0 ?? dd;
      acts.push(a); byId[a.id] = a;
    });
    if (!acts.length) throw new Error('No activities in the XER.');
    const rels = [];
    (X.tabs.TASKPRED?.rows || []).forEach(r => {
      const p = byId[X.get('TASKPRED', r, 'pred_task_id')], s = byId[X.get('TASKPRED', r, 'task_id')];
      if (!p || !s) return;
      const rel = { row: r, p, s, type: X.get('TASKPRED', r, 'pred_type').replace('PR_', ''), lag: (parseFloat(X.get('TASKPRED', r, 'lag_hr_cnt')) || 0) * 60 };
      rels.push(rel); p.succs.push(rel); s.preds.push(rel);
    });
    // clocks over the whole range
    let D0 = Math.floor(dd / DAY), D1 = D0;
    acts.forEach(a => [a.as, a.af, a.ts0, a.tf0, a.ef0, a.cd].forEach(t => { if (t !== null) { D0 = Math.min(D0, Math.floor(t / DAY)); D1 = Math.max(D1, Math.floor(t / DAY)); } }));
    D0 -= 40; D1 += 365 * 25;
    const clocks = {};
    Object.keys(cals).forEach(id => { clocks[id] = clockOf(cals[id], D0, D1); });
    acts.forEach(a => { a.c = clocks[a.cl]; });
    if (acts.some(a => !a.c)) throw new Error('Some activities have no readable calendar.');
    // topological order (Kahn); activities inside loops are appended and their loop links reported
    const indeg = new Map(acts.map(a => [a, a.preds.length]));
    const q = acts.filter(a => !a.preds.length), order = [];
    while (q.length) { const a = q.pop(); order.push(a); a.succs.forEach(r => { const k = indeg.get(r.s) - 1; indeg.set(r.s, k); if (!k) q.push(r.s); }); }
    const inLoop = acts.filter(a => indeg.get(a) > 0);
    order.push(...inLoop);
    return { pid, proj, dd, acts, rels, order, inLoop, cname, hpd };
  }

  // ---------------- CPM ----------------
  const isMile = a => a.type === 'TT_Mile' || a.type === 'TT_FinMile';
  function forward(N, dur) {
    const dd = N.dd;
    let finish = -Infinity;
    N.acts.forEach(a => { a.ES = a.EF = a.RS = null; });
    N.rels.forEach(r => { r.drv = false; });
    for (const a of N.order) {
      const c = a.c;
      if (a.st === 'TK_Complete') { a.ES = a.as; a.EF = a.af; a.RS = null; continue; }
      const D = isMile(a) ? 0 : dur(a);
      const ddS = c.snapS(dd);
      const sb = [], fb = [];   // [instant, rel] start / finish bounds
      for (const r of a.preds) {
        const p = r.p;
        if (p.ES === null || p.EF === null) continue;
        const from = r.type === 'FS' || r.type === 'FF' ? p.EF : p.ES;
        const t = r.lag ? p.c.F(p.c.W(from) + r.lag) : from;
        (r.type === 'FS' || r.type === 'SS' ? sb : fb).push([t, r]);
      }
      const startCs = ['CS_MSOA', 'CS_MSO', 'CS_MANDSTART'], finCs = ['CS_MEOA', 'CS_MEO', 'CS_MANDFIN'];
      [[a.cs, a.cd], [a.cs2, a.cd2]].forEach(([cs, cd]) => { if (cd === null) return; if (startCs.includes(cs)) sb.push([cd, null]); else if (finCs.includes(cs)) fb.push([cd, null]); });
      let es, ef, drv = null;
      if (a.st === 'TK_Active') {
        // retained logic: the remaining work waits for unfinished FS predecessors
        let rs = ddS;
        sb.forEach(([t, r]) => { if (r && r.type === 'SS') return; const v = c.snapS(t); if (v > rs) { rs = v; drv = r; } });
        ef = D > 0 ? c.F(c.W(rs) + D) : c.snapF(Math.max(dd, rs));
        fb.forEach(([t, r]) => { const v = c.snapF(t); if (v > ef) { ef = v; drv = r; } });
        a.ES = a.as; a.RS = rs; a.EF = ef;
      } else if (a.type === 'TT_FinMile') {
        ef = c.snapF(dd);
        [...sb, ...fb].forEach(([t, r]) => { const v = c.snapF(t); if (v > ef) { ef = v; drv = r; } });
        a.ES = a.RS = a.EF = ef;
      } else {
        es = ddS;
        sb.forEach(([t, r]) => { const v = c.snapS(t); if (v > es) { es = v; drv = r; } });
        fb.forEach(([t, r]) => { const v = c.S(c.W(t) - D); if (v > es) { es = v; drv = r; } });
        ef = D > 0 ? c.F(c.W(es) + D) : es;
        a.ES = a.RS = es; a.EF = ef;
      }
      if (drv) drv.drv = true;
      if (a.EF > finish) finish = a.EF;
    }
    return finish;
  }
  function backward(N, dur, projLF) {
    for (let i = N.order.length - 1; i >= 0; i--) {
      const a = N.order[i], c = a.c;
      a.LS = a.LF = null; a.TF = null;
      if (a.st === 'TK_Complete') continue;
      const D = isMile(a) ? 0 : dur(a);
      let lf = c.snapF(projLF);
      for (const r of a.succs) {
        const s = r.s;
        if (s.st === 'TK_Complete' || s.LF === null) continue;
        if (r.type === 'SS' && s.st === 'TK_Active') continue;
        const to = r.type === 'FS' || r.type === 'SS' ? s.LS : s.LF;
        const t = r.lag ? c.F(c.W(to) - r.lag) : to;
        const v = r.type === 'FS' || r.type === 'FF' ? c.snapF(t) : c.F(c.W(t) + D);
        if (v < lf) lf = v;
      }
      [[a.cs, a.cd], [a.cs2, a.cd2]].forEach(([cs, cd]) => { if (cd === null) return; if (cs === 'CS_MEOB' || cs === 'CS_MEO' || cs === 'CS_MANDFIN') lf = Math.min(lf, c.snapF(cd)); else if (cs === 'CS_MSOB' || cs === 'CS_MSO' || cs === 'CS_MANDSTART') lf = Math.min(lf, c.F(c.W(cd) + D)); });
      a.LF = lf;
      a.LS = D > 0 ? c.S(c.W(lf) - D) : lf;
      a.TF = c.W(lf) - c.W(a.EF);
    }
  }

  // ---------------- the whole run ----------------
  /* opt: { mode: 'recovery'|'revised', target (ms), rule: 'pct'|'keep', maxComp (0-0.9), maxExt (≥1), suffix } */
  function build(text, fileName, opt) {
    const t0 = performance.now();
    const fix = LOGIC.fixXer(text);
    const X = xerModel(fix.text);
    const N = network(X);
    const log = [];   // [step, category, activity / predecessor, successor, name, field, old, new, reason]
    fix.log.forEach(l => log.push(['1 Logic', LOGIC.KINDS[l[0]] ? LOGIC.KINDS[l[0]].t : l[0], l[1], l[2], '', l[2] ? 'Relationship' : 'Constraint', l[3], l[4], LOGIC.KINDS[l[0]] ? LOGIC.KINDS[l[0]].fix : '']));
    N.inLoop.forEach(a => log.push(['1 Logic', 'Loop', a.code, '', a.name, 'Relationship', '', '', 'Activity is inside a closed loop — review the links (scheduled in file order).']));
    const dayM = a => a.hpd * 60;
    const days = (a, m) => m === null || m === undefined ? '' : +(m / dayM(a)).toFixed(2);
    // 2 · remaining durations
    N.acts.forEach(a => {
      let nrd = a.rd, why = '';
      if (a.st === 'TK_Complete') nrd = 0;
      else if (isMile(a)) nrd = 0;
      else if (opt.rule === 'pct') {
        if (a.st === 'TK_NotStart') { nrd = a.od; why = 'Not started: remaining = original duration'; }
        else if (a.pct >= 100) { nrd = 0; why = 'In progress at 100%: remaining = 0'; }
        else if (a.pct > 0) { const raw = a.od * (1 - a.pct / 100), d = dayM(a); nrd = Math.max(d, Math.round(raw / d) * d); if (a.od < d) nrd = Math.round(raw / 60) * 60; why = `In progress: original ${days(a, a.od)} d × (1 − ${+a.pct.toFixed(1)}%)`; }
        else { why = 'In progress at 0%: P6 remaining kept — update the %'; }
      }
      a.nrd = nrd;
      if (Math.abs(nrd - a.rd) > 0.5) log.push(['2 Remaining duration', a.st.replace('TK_', ''), a.code, '', a.name, 'Remaining duration (d)', days(a, a.rd), days(a, nrd), why]);
      else if (why && a.st === 'TK_Active' && a.pct === 0) log.push(['2 Remaining duration', 'Review', a.code, '', a.name, 'Remaining duration (d)', days(a, a.rd), days(a, nrd), why]);
    });
    // 3 · reschedule as-is (after logic fix and remaining durations)
    const base = a => a.nrd;
    const f0 = forward(N, base);
    const target = opt.target ?? null;
    // float is measured to the project must-finish-by date (P6 option "use project end date for float")
    const mfb = N.proj ? pdt(X.get('PROJECT', N.proj, 'plan_end_date')) : null;
    backward(N, base, target ?? mfb ?? f0);
    // 4 · compression / extension of the remaining work (not-started activities only, whole days)
    let factor = 1, set = new Set(), dir = 0, achieved = f0, met = true;
    if (target !== null && Math.abs(f0 - target) > 60 * MIN) {
      if (f0 > target) { dir = -1; N.acts.forEach(a => { if (a.st === 'TK_NotStart' && !isMile(a) && a.nrd > 0 && a.TF < 0) set.add(a); }); }
      else if (opt.mode === 'revised') { dir = 1; N.acts.forEach(a => { if (a.st === 'TK_NotStart' && !isMile(a) && a.nrd > 0) set.add(a); }); }
      if (dir) {
        const durF = f => a => { if (!set.has(a)) return a.nrd; const d = dayM(a); return a.nrd < d ? Math.max(60, Math.round(a.nrd * f / 60) * 60) : Math.max(d, Math.round(a.nrd * f / d) * d); };
        let lo = dir < 0 ? 1 - opt.maxComp : 1, hi = dir < 0 ? 1 : opt.maxExt;
        if (dir < 0) {
          if (forward(N, durF(lo)) > target) { factor = lo; met = false; }
          else { for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (forward(N, durF(m)) <= target) lo = m; else hi = m; } factor = lo; }
        } else {
          if (forward(N, durF(hi)) <= target) { factor = hi; met = false; }
          else { for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (forward(N, durF(m)) <= target) lo = m; else hi = m; } factor = lo; }
        }
        const fd_ = durF(factor);
        N.acts.forEach(a => { if (set.has(a)) { const v = fd_(a); if (v !== a.nrd) log.push(['4 ' + (dir < 0 ? 'Compression' : 'Extension'), dir < 0 ? (opt.mode === 'recovery' ? 'Recovery' : 'Revised') : 'Revised', a.code, '', a.name, 'Remaining duration (d)', days(a, a.nrd), days(a, v), `${dir < 0 ? 'Negative float to the target finish' : 'Spread to the new finish'} · factor ${factor.toFixed(3)}`]); a.nrd = v; } });
      }
    }
    achieved = forward(N, base);
    if (target !== null && achieved > target + 60 * MIN) met = false;
    backward(N, base, target ?? mfb ?? achieved);
    // 5 · write back — dates, durations, float, planned (re-baselined) dates
    const T = 'TASK', set_ = (r, k, v) => X.set(T, r, k, v);
    N.acts.forEach(a => {
      const r = a.row, c = a.c;
      let ps, pf;
      if (a.st === 'TK_Complete') { ps = a.as; pf = a.af; }
      else if (a.st === 'TK_Active') { ps = a.as; pf = a.EF; }
      else { ps = a.ES; pf = a.EF; }
      a.PS = ps; a.PF = pf;
      const pdur = a.st === 'TK_NotStart' ? (isMile(a) ? 0 : a.nrd) : Math.max(0, c.W(pf) - c.W(ps));
      a.pdur = pdur;
      set_(r, 'target_start_date', xd(ps)); set_(r, 'target_end_date', xd(pf)); set_(r, 'target_drtn_hr_cnt', String(+(pdur / 60).toFixed(2)));
      if (a.st !== 'TK_Complete') {
        set_(r, 'remain_drtn_hr_cnt', String(+(a.nrd / 60).toFixed(2)));
        set_(r, 'early_start_date', xd(a.RS ?? a.ES)); set_(r, 'early_end_date', xd(a.EF));
        set_(r, 'restart_date', xd(a.RS ?? a.ES)); set_(r, 'reend_date', xd(a.EF));
        set_(r, 'late_start_date', xd(a.LS)); set_(r, 'late_end_date', xd(a.LF));
        set_(r, 'rem_late_start_date', xd(a.LS)); set_(r, 'rem_late_end_date', xd(a.LF));
        set_(r, 'total_float_hr_cnt', String(+(a.TF / 60).toFixed(2)));
      } else set_(r, 'remain_drtn_hr_cnt', '0');
    });
    // costs & units of every assignment
    const R = 'TASKRSRC', rg = (r, k) => X.get(R, r, k), rs = (r, k, v) => X.set(R, r, k, v);
    const byTid = {}; N.acts.forEach(a => { byTid[a.id] = a; a.bud = 0; a.ev = 0; a.ac0 = 0; a.ac = 0; a.rc = 0; a.wq = [0, 0, 0, 0]; });
    const asg = [], rname = {};
    (X.tabs.RSRC?.rows || []).forEach(r => { rname[X.get('RSRC', r, 'rsrc_id')] = X.get('RSRC', r, 'rsrc_short_name'); });
    (X.tabs[R]?.rows || []).forEach(r => {
      const a = byTid[rg(r, 'task_id')];
      if (!a) return;
      const p = a.pct / 100, bud = parseFloat(rg(r, 'target_cost')) || 0, tq = parseFloat(rg(r, 'target_qty')) || 0;
      const ac0 = (parseFloat(rg(r, 'act_reg_cost')) || 0) + (parseFloat(rg(r, 'act_ot_cost')) || 0), rc0 = parseFloat(rg(r, 'remain_cost')) || 0;
      const aq0 = (parseFloat(rg(r, 'act_reg_qty')) || 0) + (parseFloat(rg(r, 'act_ot_qty')) || 0), rq0 = parseFloat(rg(r, 'remain_qty')) || 0;
      const ev = bud * p, aq = tq * p, rq = tq - aq;
      rs(r, 'act_reg_cost', ev.toFixed(2)); rs(r, 'act_ot_cost', '0'); rs(r, 'remain_cost', (bud - ev).toFixed(2));
      rs(r, 'act_reg_qty', aq.toFixed(2)); rs(r, 'act_ot_qty', '0'); rs(r, 'remain_qty', rq.toFixed(2));
      rs(r, 'remain_qty_per_hr', a.nrd > 0 ? (rq / (a.nrd / 60)).toFixed(4) : '0');
      rs(r, 'target_start_date', xd(a.PS)); rs(r, 'target_end_date', xd(a.PF));
      if (a.st !== 'TK_Complete') { rs(r, 'restart_date', xd(a.RS ?? a.ES)); rs(r, 'reend_date', xd(a.EF)); rs(r, 'rem_late_start_date', xd(a.LS)); rs(r, 'rem_late_end_date', xd(a.LF)); }
      if (a.st !== 'TK_NotStart' && !rg(r, 'act_start_date')) rs(r, 'act_start_date', xd(a.as));
      if (a.st === 'TK_Complete' && !rg(r, 'act_end_date')) rs(r, 'act_end_date', xd(a.af));
      a.bud += bud; a.ev += ev; a.ac0 += ac0; a.ac += ev; a.rc += bud - ev;
      const k = rg(r, 'rsrc_type') === 'RT_Equip' ? 2 : rg(r, 'rsrc_type') === 'RT_Mat' ? -1 : 0;
      if (k >= 0) { a.wq[k] += aq; a.wq[k + 1] += rq; }
      asg.push([a.code, rname[rg(r, 'rsrc_id')] || rg(r, 'rsrc_id'), rg(r, 'rsrc_type').replace('RT_', ''), +tq.toFixed(2), +aq0.toFixed(2), +aq.toFixed(2), +rq0.toFixed(2), +rq.toFixed(2), +bud.toFixed(2), +ac0.toFixed(2), +ev.toFixed(2), +rc0.toFixed(2), +(bud - ev).toFixed(2), +bud.toFixed(2)]);
    });
    N.acts.forEach(a => {
      if (!X.tabs[R]) return;
      set_(a.row, 'act_work_qty', a.wq[0].toFixed(2)); set_(a.row, 'remain_work_qty', a.wq[1].toFixed(2));
      set_(a.row, 'act_equip_qty', a.wq[2].toFixed(2)); set_(a.row, 'remain_equip_qty', a.wq[3].toFixed(2));
    });
    // project
    const sfx = opt.suffix;
    if (N.proj) {
      const P = 'PROJECT', name = X.get(P, N.proj, 'proj_short_name');
      X.set(P, N.proj, 'proj_short_name', name + sfx);
      X.set(P, N.proj, 'scd_end_date', xd(achieved));
      if (target !== null) X.set(P, N.proj, 'plan_end_date', xd(target));
    }
    const out = { X, N, fix, log, asg, f0, achieved, target, factor, dir, set, met, opt, fileName, sec: (performance.now() - t0) / 1000 };
    return out;
  }

  // ---------------- Excel log ----------------
  function workbook(R) {
    const N = R.N, wb = XLSX.utils.book_new();
    const dayM = a => a.hpd * 60, days = (a, m) => m === null || m === undefined ? '' : +(m / dayM(a)).toFixed(2);
    const xs = t => t === null || t === undefined || !isFinite(t) ? '' : t / DAY + 25569;   // Excel serial (the XER clock is local time)
    const sheet = (name, rows, widths, dateCols) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = widths.map(w => ({ wch: w }));
      if (dateCols) for (let i = 1; i < rows.length; i++) dateCols.forEach(c => { const cell = ws[XLSX.utils.encode_cell({ r: i, c })]; if (cell && cell.t === 'n') cell.z = 'dd-mmm-yy hh:mm'; });
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: rows[0].length - 1 } }) };
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    const byCode = {}; N.acts.forEach(a => { byCode[a.code] = a; });
    const cnt = k => R.log.filter(l => l[0].startsWith(k)).length;
    const bud = N.acts.reduce((s, a) => s + a.bud, 0), ev = N.acts.reduce((s, a) => s + a.ev, 0), ac0 = N.acts.reduce((s, a) => s + a.ac0, 0);
    const rows = [
      ['Item', 'Value'],
      ['Programme type', R.opt.mode === 'recovery' ? 'Recovery programme' : 'Revised programme'],
      ['Source XER', R.fileName], ['New project ID', (N.proj ? R.X.get('PROJECT', N.proj, 'proj_short_name') : '')],
      ['Data date', xd(N.dd)],
      ['Forecast finish before (after logic fix, P6 calendars)', xd(R.f0)],
      ['Target finish', R.target !== null ? xd(R.target) : '—'],
      ['New finish', xd(R.achieved)], ['Target met', R.target === null ? '—' : R.met ? 'Yes' : 'No — see Issues'],
      ['Duration factor on remaining work', R.dir ? `${R.factor.toFixed(3)} (${R.dir < 0 ? 'compression' : 'extension'} of ${R.set.size} not-started activities)` : '1 (no change)'],
      ['Remaining-duration rule', R.opt.rule === 'pct' ? 'In progress: original × (1 − %); not started: original duration' : 'P6 remaining durations kept'],
      ['Activities', N.acts.length], ['Relationships', N.rels.length],
      ['Logic corrections', cnt('1 Logic')], ['Remaining durations changed', cnt('2 ')], ['Durations compressed / extended', cnt('4 ')],
      ['Budget at completion (BAC)', +bud.toFixed(2)], ['Earned value (EV) = new actual cost', +ev.toFixed(2)], ['Actual cost in the XER before', +ac0.toFixed(2)],
      ['Remaining cost = BAC − EV', +(bud - ev).toFixed(2)], ['At completion cost = BAC', +bud.toFixed(2)],
      ['Planned dates', 'Completed: actual start / finish · In progress: actual start / new finish · Not started: new early dates'],
      ['Planned value', 'Planned dates = actual dates up to the data date and actual cost = EV, so PV at the data date = EV when this XER is the baseline (P6: earned value from "at completion values with current dates").'],
      ['In P6', 'Import as a new project, check Schedule options (retained logic, lag calendar = predecessor), press F9 once and assign it as the project baseline.']
    ];
    sheet('Summary', rows, [52, 110]);
    sheet('Changes', [['Step', 'Category', 'Activity / predecessor', 'Successor', 'Name', 'Field', 'Old', 'New', 'Reason']].concat(R.log.map(l => { const a = byCode[l[2]]; return [l[0], l[1], l[2], l[3], l[4] || (a ? a.name : ''), l[5], l[6], l[7], l[8]]; })), [20, 26, 24, 24, 50, 22, 14, 14, 60]);
    const wbsName = {}; (R.X.tabs.PROJWBS?.rows || []).forEach(r => { wbsName[R.X.get('PROJWBS', r, 'wbs_id')] = R.X.get('PROJWBS', r, 'wbs_name'); });
    sheet('Activities', [['Activity ID', 'Name', 'WBS', 'Type', 'Status', 'Calendar', '% complete', 'Original dur (d)', 'Remaining before (d)', 'Remaining new (d)', 'Planned dur new (d)',
      'Start before', 'Finish before', 'Start new', 'Finish new', 'Finish change (cal. days)', 'Planned start new', 'Planned finish new', 'Planned start before', 'Planned finish before', 'Late finish', 'Total float (d)',
      'Budget cost', 'EV', 'Actual cost before', 'Actual cost new (= EV)', 'Remaining cost (BAC − EV)', 'At completion (= BAC)']].concat(N.acts.map(a => {
      const s0 = a.st === 'TK_NotStart' ? (a.rs0 ?? a.es0) : a.as, f0 = a.st === 'TK_Complete' ? a.af : (a.re0 ?? a.ef0);
      return [a.code, a.name, wbsName[a.wbs] || '', a.type.replace('TT_', ''), a.st.replace('TK_', ''), N.cname[a.cl] || a.cl, +a.pct.toFixed(2), days(a, a.od), days(a, a.rd), days(a, a.nrd), days(a, a.pdur),
        xs(s0), xs(f0), xs(a.st === 'TK_NotStart' ? a.ES : a.as), xs(a.EF), f0 !== null && a.EF !== null ? Math.round((a.EF - f0) / DAY) : '', xs(a.PS), xs(a.PF), xs(a.ts0), xs(a.tf0), xs(a.LF), a.TF === null ? '' : days(a, a.TF),
        +a.bud.toFixed(2), +a.ev.toFixed(2), +a.ac0.toFixed(2), +a.ac.toFixed(2), +a.rc.toFixed(2), +a.bud.toFixed(2)];
    })), [24, 50, 30, 8, 10, 26, 9, 10, 10, 10, 10, 15, 15, 15, 15, 10, 15, 15, 15, 15, 15, 10, 14, 14, 14, 14, 14, 14], [11, 12, 13, 14, 16, 17, 18, 19, 20]);
    const fixKey = {}; R.fix.log.forEach(l => { if (l[2]) fixKey[l[1] + '|' + l[2]] = (fixKey[l[1] + '|' + l[2]] ? fixKey[l[1] + '|' + l[2]] + ' ; ' : '') + l[3] + ' → ' + l[4]; });
    sheet('Relationships', [['Predecessor', 'Predecessor name', 'Successor', 'Successor name', 'Type', 'Lag (d)', 'Driving', 'Change (logic fix)', 'Predecessor status', 'Successor status']].concat(N.rels.map(r =>
      [r.p.code, r.p.name, r.s.code, r.s.name, r.type, +(r.lag / (r.p.hpd * 60)).toFixed(2), r.drv ? 'Y' : '', fixKey[r.p.code + '|' + r.s.code] || '', r.p.st.replace('TK_', ''), r.s.st.replace('TK_', '')])), [24, 44, 24, 44, 6, 8, 8, 34, 12, 12]);
    sheet('Assignments', [['Activity ID', 'Resource', 'Type', 'Budget units', 'Actual units before', 'Actual units new', 'Remaining units before', 'Remaining units new', 'Budget cost', 'Actual cost before', 'Actual cost new (= EV)', 'Remaining cost before', 'Remaining cost new', 'At completion']].concat(R.asg), [24, 12, 8, 12, 12, 12, 12, 12, 14, 14, 14, 14, 14, 14]);
    const iss = [['Issue', 'Activity', 'Name', 'Detail']];
    if (R.target !== null && !R.met) iss.push(['Target not met', '', '', `New finish ${xd(R.achieved)} vs target ${xd(R.target)} — limit reached (${R.dir < 0 ? 'max compression ' + Math.round(R.opt.maxComp * 100) + '%' : 'max extension ×' + R.opt.maxExt}); the rest is driven by in-progress work, constraints or completed logic.`]);
    N.inLoop.forEach(a => iss.push(['Loop', a.code, a.name, 'Inside a closed relationship loop']));
    N.acts.filter(a => a.st === 'TK_Active' && a.pct === 0).forEach(a => iss.push(['In progress at 0%', a.code, a.name, 'Started but 0% — EV = 0; update the physical %']));
    N.acts.filter(a => a.TF !== null && a.TF < -1).forEach(a => iss.push(['Negative float', a.code, a.name, `${days(a, a.TF)} d to the target finish`]));
    R.fix.issues.filter(i => !LOGIC.KINDS[i.kind].auto).forEach(i => iss.push([LOGIC.KINDS[i.kind].t, i.r ? i.r.p + ' → ' + i.r.s : i.c, '', LOGIC.KINDS[i.kind].fix]));
    sheet('Issues', iss, [26, 30, 50, 90]);
    return wb;
  }

  // ---------------- UI ----------------
  const RV = { pid: null, mode: 'recovery', rule: 'pct', maxComp: 40, maxExt: 3, file: null, res: null, busy: false, date: '', time: '18:00' };
  function srcOf(pid) {
    if (RV.file && RV.file.pid === pid) return RV.file;
    const r = SX.RAW[pid] && SX.RAW[pid].u;
    return r ? { text: r.text, name: r.name, pid } : null;
  }
  function targetDefault(pid) {
    const S = SX.PS[pid]?.S;
    if (RV.mode === 'recovery') { const f = S?.meta.baseline?.finish || (SX.PS[pid]?.X.bFinish); return f ? new Date(f).toISOString().slice(0, 10) : ''; }
    return RV.date;
  }
  function render() {
    const host = $('#rvBody');
    if (!host) return;
    if (!SX.S) { host.innerHTML = ''; return; }
    if (!RV.pid || !SX.PS[RV.pid]) RV.pid = SX.active;
    const P = SX.PS[RV.pid], src = srcOf(RV.pid), upd = P.S.meta.update?.file || '';
    const bl = P.S.meta.baseline?.finish;
    const tDate = RV.mode === 'recovery' ? (RV.recDate || targetDefault(RV.pid)) : RV.date;
    const R = RV.res && RV.res.pid === RV.pid ? RV.res : null;
    host.innerHTML = `<div class="card rv">
      <div class="card-h"><h3>Recovery / Revised programme</h3><span class="muted small">Owner only · builds a new XER + an Excel log of every change</span></div>
      <div class="rv-grid">
        <label class="cut-f">Programme<select id="rvProg">${SX.PROGRAMS.filter(p => SX.PS[p.id]).map(p => `<option value="${p.id}" ${p.id === RV.pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <div class="cut-f">Type<div class="seg" id="rvMode"><button data-m="recovery" class="${RV.mode === 'recovery' ? 'on' : ''}">Recovery</button><button data-m="revised" class="${RV.mode === 'revised' ? 'on' : ''}">Revised</button></div></div>
        <label class="cut-f">${RV.mode === 'recovery' ? 'Recover to (contract / baseline finish)' : 'New finish date'}<input type="date" id="rvDate" value="${esc(tDate || '')}"></label>
        <label class="cut-f">Hour<input type="time" id="rvTime" value="${esc(RV.time)}"></label>
        <label class="cut-f">Remaining duration<select id="rvRule"><option value="pct" ${RV.rule === 'pct' ? 'selected' : ''}>In progress: original × (1 − %)</option><option value="keep" ${RV.rule === 'keep' ? 'selected' : ''}>Keep P6 remaining</option></select></label>
        <label class="cut-f">Max compression %<input type="number" id="rvMax" min="5" max="80" step="5" value="${RV.maxComp}" style="width:90px"></label>
      </div>
      <p class="muted small">${RV.mode === 'recovery'
        ? `<b>Recovery</b>: the remaining (not-started) activities with negative float are shortened by one common factor until the programme finishes on the contract / baseline finish${bl ? ' (' + SX.fd(bl) + ')' : ''}.`
        : '<b>Revised</b>: the programme is fitted to the new finish date — shortened (negative-float activities) if it is earlier than the forecast, spread evenly over all not-started activities if it is later.'}
        Both: logic fix (out-of-sequence → SS + FF, SF, leads, open ends, mandatory constraints) → remaining durations → CPM on the P6 calendars from the data date → planned dates = actual dates (completed / in progress) and new dates (not started) → actual cost = EV, remaining cost = budget − EV, at completion = budget.</p>
      <label class="drop rv-drop" id="rvDrop"><input type="file" id="rvFile" accept=".xer"><span><b>${src ? '✓ ' + esc(src.name) : 'Drop the update XER of this programme'}</b>${src ? '' : ' or click to browse'}</span><span class="muted small">${src ? 'Click to use another file' : 'Published: ' + esc(upd || '—') + ' — the raw XER is needed to write a new one'}</span></label>
      <div class="row-btns"><button class="btn primary" id="rvRun" ${src && !RV.busy ? '' : 'disabled'}>${RV.busy ? 'Working…' : 'Build ' + (RV.mode === 'recovery' ? 'Recovery' : 'Revised') + ' programme'}</button><span class="muted small" id="rvMsg">${RV.msg || ''}</span></div>
      ${R ? result(R) : ''}
    </div>`;
    wire();
  }
  function result(R) {
    const N = R.N, slip = t => Math.round((t - R.f0) / DAY);
    const cnt = k => R.log.filter(l => l[0].startsWith(k)).length;
    const bud = N.acts.reduce((s, a) => s + a.bud, 0), ev = N.acts.reduce((s, a) => s + a.ev, 0);
    return `<div class="dtiles rv-tiles">
        <div class="dtile"><div class="lbl">Data date</div><div class="v">${fdt(N.dd)}</div></div>
        <div class="dtile"><div class="lbl">Finish before</div><div class="v">${fdt(R.f0)}</div><div class="muted small">after logic fix, P6 calendars</div></div>
        <div class="dtile"><div class="lbl">Target</div><div class="v">${R.target !== null ? fdt(R.target) : '—'}</div></div>
        <div class="dtile"><div class="lbl">New finish</div><div class="v ${R.met ? 'pos' : 'neg'}">${fdt(R.achieved)}</div><div class="muted small">${R.met ? 'target met' : 'target not met — see Issues'} · ${slip(R.achieved) >= 0 ? '+' : ''}${slip(R.achieved)} d</div></div>
        <div class="dtile"><div class="lbl">Duration factor</div><div class="v">${R.dir ? R.factor.toFixed(3) : '1'}</div><div class="muted small">${R.dir ? R.set.size.toLocaleString() + ' activities ' + (R.dir < 0 ? 'compressed' : 'extended') : 'no change needed'}</div></div>
        <div class="dtile"><div class="lbl">Logic corrections</div><div class="v">${cnt('1 Logic').toLocaleString()}</div><div class="muted small">remaining durations changed ${cnt('2 ').toLocaleString()}</div></div>
        <div class="dtile"><div class="lbl">EV = actual cost</div><div class="v">${fmt(ev, 0)}</div><div class="muted small">${(ev / bud * 100).toFixed(2)}% of BAC ${fmt(bud, 0)}</div></div>
      </div>
      <div class="row-btns"><button class="btn primary" id="rvXer">⬇ ${esc(R.outName)}.xer</button><button class="btn" id="rvXls">⬇ Excel log of changes</button><span class="muted small">Built in ${R.sec.toFixed(1)} s · ${N.acts.length.toLocaleString()} activities · ${N.rels.length.toLocaleString()} relationships</span></div>`;
  }
  function wire() {
    const host = $('#rvBody');
    $('#rvProg').onchange = e => { RV.pid = e.target.value; RV.recDate = ''; render(); };
    host.querySelectorAll('#rvMode [data-m]').forEach(b => b.onclick = () => { RV.mode = b.dataset.m; render(); });
    $('#rvDate').onchange = e => { if (RV.mode === 'recovery') RV.recDate = e.target.value; else RV.date = e.target.value; };
    $('#rvTime').onchange = e => { RV.time = e.target.value || '18:00'; };
    $('#rvRule').onchange = e => { RV.rule = e.target.value; };
    $('#rvMax').onchange = e => { RV.maxComp = Math.max(5, Math.min(80, +e.target.value || 40)); };
    const d = $('#rvDrop'), i = $('#rvFile');
    const take = async f => { const text = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsText(f, 'windows-1252'); }); RV.file = { text, name: f.name, pid: RV.pid }; RV.msg = ''; render(); };
    i.onchange = () => i.files[0] && take(i.files[0]);
    ['dragenter', 'dragover'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.remove('over'); }));
    d.addEventListener('drop', e => e.dataTransfer.files[0] && take(e.dataTransfer.files[0]));
    $('#rvRun').onclick = run;
    if ($('#rvXer')) $('#rvXer').onclick = () => { const R = RV.res; const blob = new Blob([enc1252(R.X.text())], { type: 'application/octet-stream' }); const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = R.outName + '.xer'; l.click(); };
    if ($('#rvXls')) $('#rvXls').onclick = () => XLSX.writeFile(workbook(RV.res), RV.res.outName + '_changes.xlsx', { compression: true, bookSST: true });
  }
  async function run() {
    const src = srcOf(RV.pid);
    if (!src) return;
    const dv = $('#rvDate').value, tv = $('#rvTime').value || '18:00';
    if (RV.mode === 'revised' && !dv) { RV.msg = '✗ Enter the new finish date.'; return render(); }
    RV.busy = true; RV.msg = 'Fixing logic and rescheduling…'; render();
    await new Promise(r => setTimeout(r, 40));
    try {
      const target = dv ? pdt(dv + ' ' + tv) : null;
      const suffix = RV.mode === 'recovery' ? '-RCV' : '-REV';
      const R = build(src.text, src.name, { mode: RV.mode, target, rule: RV.rule, maxComp: RV.maxComp / 100, maxExt: RV.maxExt, suffix });
      R.pid = RV.pid;
      R.outName = src.name.replace(/\.xer$/i, '') + (RV.mode === 'recovery' ? '_Recovery' : '_Revised');
      RV.res = R; RV.msg = '';
    } catch (e) { console.error(e); RV.msg = '✗ ' + esc(e.message); }
    RV.busy = false; render();
  }

  window.REVISE = { build, workbook, xerModel, clockOf, enc1252, network, forward, backward };
  SX.onChange(render);
  A.whenReady(() => setTimeout(render, 0));
  document.addEventListener('click', e => { if (e.target.closest('.tab[data-tab=logic]')) setTimeout(render, 0); });
})();
