/* Schedule logic check + automatic correction of illogical relationships.
   The same rules run on a published programme (report only) and on a raw XER (writes a corrected XER). */
(function () {
  'use strict';

  const KINDS = {
    oos_fs: { t: 'Out of sequence (FS)', d: 'Successor already started while its FS predecessor is not finished.', fix: 'Change FS → SS (lag 0) and add FF (lag 0): the successor keeps its finish tied to the predecessor.', auto: true },
    oos_ss: { t: 'Out of sequence (SS)', d: 'Successor already started while its SS predecessor has not started.', fix: 'Change SS → FF (lag 0).', auto: true },
    sf: { t: 'Start-to-Finish link', d: 'SF links are counter-intuitive and not accepted by DCMA / most PMCMs.', fix: 'Change SF → FS (lag 0); if the pair already has another link, delete the SF.', auto: true },
    lead: { t: 'Negative lag (lead)', d: 'Leads hide overlaps and are not allowed.', fix: 'Set lag to 0.', auto: true },
    open_start: { t: 'Open start', d: 'Open activity without any predecessor.', fix: 'Add FS from the Project Start milestone.', auto: true },
    open_finish: { t: 'Open finish', d: 'Open activity without any successor — its delay would not move the project finish.', fix: 'Add FS to the Project Finish milestone.', auto: true },
    dangling_start: { t: 'Dangling start', d: 'Not started; only FF/SF predecessors, so nothing drives its start.', fix: 'Add SS (lag 0) from the same predecessor(s).', auto: true },
    dangling_finish: { t: 'Dangling finish', d: 'Only SS/SF successors, so its finish drives nothing.', fix: 'Add FF (lag 0) to the same successor(s).', auto: true },
    mand: { t: 'Mandatory constraint', d: 'Mandatory (hard) constraints break the logic network.', fix: 'Change Mandatory Start → Start On or After; Mandatory Finish → Finish On or Before.', auto: true },
    long_lag: { t: 'Long lag (≥ 20 working days)', d: 'Long lags usually stand for missing activities (approvals, delivery, curing).', fix: 'Review — replace with a real activity where possible.', auto: false },
    done_succ: { t: 'Completed successor, open predecessor', d: 'The successor finished although its predecessor is still open (progress against logic).', fix: 'Review — confirm the actual dates / progress of the predecessor.', auto: false },
    alap: { t: 'As-Late-As-Possible constraint', d: 'ALAP consumes all free float and makes the activity critical.', fix: 'Review — remove where not needed.', auto: false }
  };

  /* A: code → { st: 'Complete'|'Active'|'NotStart', started: bool, t: 'Task'|'Mile'|'FinMile', cs }
     R: [{ p, s, type: 'FS'|'SS'|'FF'|'SF', lag (days), i }] */
  function analyze(A, R) {
    const preds = {}, succs = {}, pair = {};
    R.forEach(r => { (preds[r.s] = preds[r.s] || []).push(r); (succs[r.p] = succs[r.p] || []).push(r); (pair[r.p + '|' + r.s] = pair[r.p + '|' + r.s] || []).push(r); });
    const open = c => A[c] && A[c].st !== 'Complete';
    const startMs = Object.keys(A).find(c => A[c].t === 'Mile' && /start/i.test(A[c].n || '')) || Object.keys(A).find(c => A[c].t === 'Mile');
    const finishMs = Object.keys(A).find(c => A[c].t === 'FinMile');
    const out = [];
    const add = (kind, o) => out.push({ kind, ...o });
    R.forEach(r => {
      const P = A[r.p], S = A[r.s];
      if (!P || !S) return;
      if (r.type === 'FS' && S.started && P.st !== 'Complete' && S.st !== 'Complete') add('oos_fs', { r, fix: [{ op: 'type', r, to: 'SS', lag: 0 }, ...(pair[r.p + '|' + r.s].some(x => x.type === 'FF') ? [] : [{ op: 'add', p: r.p, s: r.s, type: 'FF' }])] });
      else if (r.type === 'SS' && S.started && !P.started && S.st !== 'Complete') add('oos_ss', { r, fix: [{ op: 'type', r, to: 'FF', lag: 0 }] });
      if (r.type === 'SF') add('sf', { r, fix: pair[r.p + '|' + r.s].length > 1 ? [{ op: 'del', r }] : [{ op: 'type', r, to: 'FS', lag: 0 }] });
      if (r.lag < 0) add('lead', { r, fix: [{ op: 'lag', r, lag: 0 }] });
      if (r.lag >= 20 && open(r.s)) add('long_lag', { r, fix: [] });
      if (S.st === 'Complete' && P.st !== 'Complete' && r.type !== 'SS') add('done_succ', { r, fix: [] });
    });
    Object.keys(A).forEach(c => {
      const a = A[c];
      if (a.st === 'Complete') return;
      const pr = preds[c] || [], su = succs[c] || [];
      if (!pr.length && a.t !== 'Mile' && startMs && c !== startMs) add('open_start', { c, fix: [{ op: 'add', p: startMs, s: c, type: 'FS' }] });
      if (!su.length && a.t !== 'FinMile' && finishMs && c !== finishMs) add('open_finish', { c, fix: [{ op: 'add', p: c, s: finishMs, type: 'FS' }] });
      if (pr.length && !a.started && pr.every(r => r.type === 'FF' || r.type === 'SF')) add('dangling_start', { c, fix: pr.filter(r => r.type === 'FF').map(r => ({ op: 'add', p: r.p, s: c, type: 'SS' })) });
      if (su.length && su.every(r => r.type === 'SS' || r.type === 'SF')) add('dangling_finish', { c, fix: su.filter(r => r.type === 'SS').map(r => ({ op: 'add', p: c, s: r.s, type: 'FF' })) });
      if (/MANDSTART|MANDFIN/.test(a.cs || '')) add('mand', { c, fix: [{ op: 'cstr', c, to: /MANDSTART/.test(a.cs) ? 'CS_MSOA' : 'CS_MEOB' }] });
      if (/ALAP/.test(a.cs || '')) add('alap', { c, fix: [] });
    });
    // never add a link that already exists (same pair & type)
    const have = new Set(R.map(r => r.p + '|' + r.s + '|' + r.type));
    out.forEach(i => { i.fix = i.fix.filter(f => f.op !== 'add' || (!have.has(f.p + '|' + f.s + '|' + f.type) && (have.add(f.p + '|' + f.s + '|' + f.type), true))); });
    return out;
  }

  // from a published programme model
  function fromModel(S) {
    const A = {};
    S.acts.forEach(a => { A[a.c] = { st: a.st, started: !!a.as, t: a.t, cs: a.cs || '', n: a.n }; });
    const R = (S.rels || []).map((r, i) => ({ p: r[0], s: r[1], type: r[2], lag: r[3], i }));
    return { A, R, issues: analyze(A, R) };
  }

  // rewrite a raw XER with the automatic fixes
  function fixXer(text) {
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const sect = {};
    let cur = null;
    lines.forEach((l, i) => {
      if (l.startsWith('%T\t')) { cur = { name: l.slice(3).trim(), start: i, fields: null, rows: [] }; sect[cur.name] = sect[cur.name] || cur; }
      else if (cur && l.startsWith('%F\t')) cur.fields = l.slice(3).split('\t');
      else if (cur && l.startsWith('%R\t') && sect[cur.name] === cur) cur.rows.push(i);
    });
    const T = sect.TASK, P = sect.TASKPRED;
    if (!T || !P) throw new Error('TASK / TASKPRED table missing');
    const fi = (sec, f) => sec.fields.indexOf(f);
    const val = (i) => lines[i].slice(3).split('\t');
    const tf = { id: fi(T, 'task_id'), code: fi(T, 'task_code'), st: fi(T, 'status_code'), as: fi(T, 'act_start_date'), type: fi(T, 'task_type'), cs: fi(T, 'cstr_type'), proj: fi(T, 'proj_id'), name: fi(T, 'task_name'), cal: fi(T, 'clndr_id') };
    const idOf = {}, codeOf = {}, rowOf = {}, projOf = {};
    const A = {};
    T.rows.forEach(i => {
      const v = val(i);
      if (v[tf.type] === 'TT_WBS') return;
      const code = v[tf.code];
      idOf[code] = v[tf.id]; codeOf[v[tf.id]] = code; rowOf[code] = i; projOf[code] = v[tf.proj];
      A[code] = { st: v[tf.st].replace('TK_', ''), started: !!v[tf.as], t: v[tf.type].replace('TT_', ''), cs: (v[tf.cs] || '').replace('CS_', ''), n: v[tf.name] };
    });
    const pf = { id: fi(P, 'task_pred_id'), s: fi(P, 'task_id'), p: fi(P, 'pred_task_id'), type: fi(P, 'pred_type'), lag: fi(P, 'lag_hr_cnt'), proj: fi(P, 'proj_id'), pproj: fi(P, 'pred_proj_id') };
    let maxId = 0;
    const R = [];
    P.rows.forEach(i => {
      const v = val(i);
      maxId = Math.max(maxId, parseInt(v[pf.id], 10) || 0);
      if (!codeOf[v[pf.s]] || !codeOf[v[pf.p]]) return;
      R.push({ p: codeOf[v[pf.p]], s: codeOf[v[pf.s]], type: v[pf.type].replace('PR_', ''), lag: (parseFloat(v[pf.lag]) || 0) / 10, i });
    });
    const issues = analyze(A, R);
    const set = (i, idx, v) => { const a = val(i); a[idx] = v; lines[i] = '%R\t' + a.join('\t'); };
    const del = new Set(), added = [], log = [];
    issues.forEach(is => is.fix.forEach(f => {
      if (f.op === 'type') { set(f.r.i, pf.type, 'PR_' + f.to); set(f.r.i, pf.lag, '0'); log.push([is.kind, f.r.p, f.r.s, f.r.type + ' lag ' + f.r.lag, f.to + ' lag 0']); }
      else if (f.op === 'lag') { set(f.r.i, pf.lag, '0'); log.push([is.kind, f.r.p, f.r.s, f.r.type + ' lag ' + f.r.lag, f.r.type + ' lag 0']); }
      else if (f.op === 'del') { del.add(f.r.i); log.push([is.kind, f.r.p, f.r.s, f.r.type + ' lag ' + f.r.lag, 'deleted']); }
      else if (f.op === 'add') {
        const row = P.fields.map(() => '');
        row[pf.id] = String(++maxId); row[pf.s] = idOf[f.s]; row[pf.p] = idOf[f.p]; row[pf.type] = 'PR_' + f.type; row[pf.lag] = '0';
        if (pf.proj >= 0) row[pf.proj] = projOf[f.s]; if (pf.pproj >= 0) row[pf.pproj] = projOf[f.p];
        added.push('%R\t' + row.join('\t')); log.push([is.kind, f.p, f.s, '—', 'added ' + f.type + ' lag 0']);
      } else if (f.op === 'cstr') { set(rowOf[f.c], tf.cs, f.to); log.push([is.kind, f.c, '', 'CS_' + A[f.c].cs, f.to]); }
    }));
    const lastP = P.rows[P.rows.length - 1];
    const outLines = [];
    lines.forEach((l, i) => { if (!del.has(i)) outLines.push(l); if (i === lastP) outLines.push(...added); });
    return { text: outLines.join(nl), issues, log, A };
  }

  window.LOGIC = { KINDS, analyze, fromModel, fixXer };
})();
