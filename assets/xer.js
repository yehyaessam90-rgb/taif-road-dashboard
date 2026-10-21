/* Primavera P6 XER reader → monthly baseline plan.
   Parsed entirely in the browser; only the tables needed are kept in memory. */
(function () {
  const KEEP = new Set(['PROJECT', 'TASK', 'TASKRSRC']);

  function parseXer(text, keep) {
    keep = keep || KEEP;
    const tables = {};
    let name = null, fields = null, rows = null;
    let i = 0;
    const n = text.length;
    while (i < n) {
      let j = text.indexOf('\n', i);
      if (j === -1) j = n;
      let line = text.slice(i, j);
      i = j + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.startsWith('%T\t')) {
        name = line.slice(3).trim();
        fields = null;
        rows = keep.has(name) ? (tables[name] = []) : null;
      } else if (line.startsWith('%F\t')) {
        fields = line.slice(3).split('\t');
      } else if (line.startsWith('%R\t') && rows && fields) {
        const v = line.slice(3).split('\t');
        const o = {};
        for (let k = 0; k < fields.length; k++) o[fields[k]] = v[k] ?? '';
        rows.push(o);
      }
    }
    return tables;
  }

  function d(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }
  const ym = dt => dt.toISOString().slice(0, 7);

  function buildBaseline(text, contractValue) {
    const t = parseXer(text);
    const projects = t.PROJECT || [];
    const tasks = t.TASK || [];
    if (!tasks.length) throw new Error('No TASK table found in the XER file.');

    // pick the project that owns the most activities
    const count = {};
    tasks.forEach(r => { count[r.proj_id] = (count[r.proj_id] || 0) + 1; });
    const projId = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    const proj = projects.find(p => p.proj_id === projId) || {};

    const cost = {};
    (t.TASKRSRC || []).forEach(r => {
      if (r.proj_id && r.proj_id !== projId) return;
      cost[r.task_id] = (cost[r.task_id] || 0) + (parseFloat(r.target_cost) || 0);
    });

    const acts = [];
    for (const r of tasks) {
      if (r.proj_id !== projId) continue;
      if (r.task_type === 'TT_WBS' || r.task_type === 'TT_LOE') continue;
      const s = d(r.target_start_date) || d(r.early_start_date);
      const e = d(r.target_end_date) || d(r.early_end_date);
      if (!s || !e) continue;
      acts.push({
        s, e: e < s ? s : e,
        c: cost[r.task_id] || 0,
        h: parseFloat(r.target_drtn_hr_cnt) || 0,
        pct: parseFloat(r.phys_complete_pct) || 0,
        status: r.status_code
      });
    }
    const totalCost = acts.reduce((a, x) => a + x.c, 0);
    const useCost = totalCost > 0;
    acts.forEach(a => { a.w = useCost ? a.c : a.h; });
    const totalW = acts.reduce((a, x) => a + x.w, 0);
    if (!totalW) throw new Error('Activities have no cost and no duration — cannot build a plan.');

    const monthly = {};
    let minS = null, maxE = null;
    for (const a of acts) {
      if (!a.w) continue;
      if (!minS || a.s < minS) minS = a.s;
      if (!maxE || a.e > maxE) maxE = a.e;
      const days = Math.max(1, Math.round((a.e - a.s) / 864e5) + 1);
      const perDay = a.w / days;
      // walk month by month instead of day by day
      let cur = new Date(a.s);
      while (cur <= a.e) {
        const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
        const segEnd = monthEnd < a.e ? monthEnd : a.e;
        const segDays = Math.round((segEnd - cur) / 864e5) + 1;
        const k = ym(cur);
        monthly[k] = (monthly[k] || 0) + perDay * segDays;
        cur = new Date(Date.UTC(segEnd.getUTCFullYear(), segEnd.getUTCMonth(), segEnd.getUTCDate() + 1));
      }
    }
    const scale = contractValue ? contractValue / totalW : (useCost ? 1 : 1 / totalW);
    const months = Object.keys(monthly).sort();
    let cum = 0;
    const plan = months.map(m => {
      const v = monthly[m] * scale;
      cum += v;
      return { month: m + '-01', planned: v };
    });

    const earnedPct = acts.reduce((a, x) => a + x.w * x.pct / 100, 0) / totalW * 100;
    return {
      plan,
      project: {
        name: proj.proj_short_name || '',
        start: (proj.plan_start_date || '').slice(0, 10) || (minS && minS.toISOString().slice(0, 10)),
        finish: (proj.scd_end_date || proj.plan_end_date || '').slice(0, 10) || (maxE && maxE.toISOString().slice(0, 10)),
        dataDate: (proj.last_recalc_date || '').slice(0, 10)
      },
      stats: {
        activities: acts.length, costLoaded: useCost, totalCost,
        earnedPct, firstMonth: months[0], lastMonth: months[months.length - 1]
      }
    };
  }

  window.XER = { parseXer, buildBaseline };
})();
