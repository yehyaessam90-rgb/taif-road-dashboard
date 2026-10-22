/* Taif Road Sec-C — Project Controls Dashboard
   Data flow: localStorage (imported) → data/project-data.xlsx (published) → data/default-data.js (embedded fallback) */
(function () {
  'use strict';
  const LS_KEY = 'trd_model_v1';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const charts = {};
  const PICK = {};       // chart id → click handler (index, datasetIndex)
  let LAST = null;
  let PICKED_AT = 0;     // set when a chart element handled the click, so the card-level click is skipped       // last derived state, used by the details panel
  let M = null;          // current model
  let SOURCE = '';       // human label of the data source

  // ---------- schema: sheet → field → accepted header aliases ----------
  const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9%]/g, '');
  const SCHEMA = {
    Invoices: {
      ipc: ['ipcno', 'ipc', 'invoiceno', 'no'],
      from: ['periodfrom', 'from'],
      to: ['periodto', 'to'],
      work: ['workdoneexclvat', 'workdone', 'amountofworkdone', 'valueofwork'],
      recovery: ['advancerecoveryexclvat', 'advancerecovery', 'advancepaymentrecovery'],
      vat: ['vat', 'vat15'],
      retention: ['retentioninclvat', 'retention'],
      net: ['netcertifiedinclvat', 'netcertified', 'netinvoiceamount'],
      status: ['status'],
      paid: ['paidamount', 'paid'],
      paidDate: ['paiddate'],
      remarks: ['remarks', 'comments']
    },
    Sections: {
      code: ['section', 'sectionno', 'code'],
      desc: ['description'],
      contract: ['contractamount', 'contractamountsar'],
      prev: ['previousamount', 'previous'],
      curr: ['currentamount', 'current'],
      cum: ['cumulativeamount', 'uptodateamount', 'todateamount', 'cumulative'],
      plannedPct: ['planned%todate', 'plannedpct', 'planned%', 'plannedtodate']
    },
    BOQ_Items: {
      bill: ['bill', 'billno'],
      item: ['itemno', 'item'],
      desc: ['description'],
      unit: ['unit'],
      cqty: ['contractqty', 'contractquantity'],
      rate: ['unitrate', 'rate'],
      camt: ['contractamount'],
      pqty: ['previousqty', 'previousquantity'],
      qqty: ['currentqty', 'currentquantity'],
      tqty: ['todateqty', 'uptodatequantity', 'cumulativeqty'],
      pamt: ['previousamount'],
      qamt: ['currentamount'],
      tamt: ['todateamount', 'uptodateamount', 'cumulativeamount']
    },
    Baseline_Plan: {
      month: ['month', 'period', 'date'],
      planned: ['plannedvalueexclvat', 'plannedvalue', 'plannedmonthlyvalue', 'planned'],
      plannedPct: ['plannedcum%', 'plannedcumpct']
    },
    Performance: {
      date: ['datadate', 'date', 'month'],
      planned: ['planned%', 'plannedpct', 'plannedprogress'],
      actual: ['actual%', 'actualpct', 'actualprogress'],
      remarks: ['remarks']
    }
  };
  const PROJECT_KEYS = {
    name: ['projectname'], contractNo: ['contractno'], client: ['client'], consultant: ['consultant'],
    contractor: ['contractor'], cv: ['contractvalueexclvat', 'contractvalue'], cvVat: ['contractvalueinclvat'],
    co: ['approvedchangeordersexclvat', 'changeorders', 'approvedchangeorders'],
    advance: ['advancepaymentinclvat', 'advancepayment'], vat: ['vat%', 'vat'],
    advPct: ['advancerecovery%', 'advancerecovery'], retPct: ['retention%', 'retention'],
    start: ['commencementdate', 'startdate', 'start'], finish: ['plannedcompletiondate', 'completiondate', 'finish'],
    dataDate: ['datadate']
  };

  // ---------- helpers ----------
  const num = v => {
    if (v === null || v === undefined || v === '' || v === '-') return 0;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[,\sSAR]/g, '').replace(/^\((.*)\)$/, '-$1');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };
  const pct = v => { const n = num(v); return n > 0 && n <= 1 && String(v).indexOf('%') === -1 && typeof v === 'number' ? n * 100 : n; };
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function toDate(v) {
    if (!v && v !== 0) return null;
    if (v instanceof Date) return isNaN(v) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5));
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(s);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1)));
    m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{2,4})$/.exec(s);
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(Date.UTC(y, MONTHS[m[2].toLowerCase()], +m[1])); }
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    const d = new Date(s);
    return isNaN(d) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  const iso = d => d ? d.toISOString().slice(0, 10) : '';
  const ymKey = d => d.toISOString().slice(0, 7);
  const fmtDate = d => { d = d instanceof Date ? d : toDate(d); return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'; };
  const fmtMon = k => { const d = toDate(k); return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }); };
  const fmt = (v, dp = 2) => (v || v === 0) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—';
  const fmtM = v => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + ' M' : (v / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' K');
  const fmtP = (v, dp = 2) => (v === null || v === undefined || isNaN(v)) ? '—' : v.toFixed(dp) + '%';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // ---------- workbook ⇄ model ----------
  function readSheet(wb, name) {
    const sn = wb.SheetNames.find(s => norm(s) === norm(name));
    if (!sn) return null;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
    // header row = first row containing ≥2 recognised headers
    const spec = SCHEMA[name];
    let hi = -1, map = {};
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const m = {};
      rows[r].forEach((h, c) => {
        const k = norm(h);
        for (const f in spec) if (m[f] === undefined && spec[f].includes(k)) m[f] = c;
      });
      if (Object.keys(m).length >= 2) { hi = r; map = m; break; }
    }
    if (hi < 0) return [];
    return rows.slice(hi + 1).map(r => {
      const o = {};
      for (const f in map) o[f] = r[map[f]];
      return o;
    }).filter(o => Object.values(o).some(v => v !== '' && v !== null && v !== undefined));
  }

  function wbToModel(wb) {
    const log = [];
    const project = {};
    const psn = wb.SheetNames.find(s => norm(s) === 'project');
    if (psn) {
      XLSX.utils.sheet_to_json(wb.Sheets[psn], { header: 1, raw: true, defval: '' }).forEach(r => {
        const k = norm(r[0]);
        for (const f in PROJECT_KEYS) if (PROJECT_KEYS[f].includes(k)) project[f] = r[1];
      });
      log.push('✓ Project: ' + Object.keys(project).length + ' fields');
    } else log.push('• Project sheet not found — keeping previous project info');

    const inv = readSheet(wb, 'Invoices');
    const sec = readSheet(wb, 'Sections');
    const items = readSheet(wb, 'BOQ_Items');
    const base = readSheet(wb, 'Baseline_Plan');
    const perf = readSheet(wb, 'Performance');
    [['Invoices', inv], ['Sections', sec], ['BOQ_Items', items], ['Baseline_Plan', base], ['Performance', perf]]
      .forEach(([n, a]) => log.push(a === null ? `• ${n} sheet not found — keeping previous data` : `✓ ${n}: ${a.length} rows`));

    const m = {
      project: Object.keys(project).length ? normProject(project) : null,
      invoices: inv && inv.filter(r => num(r.work) || num(r.recovery) || r.from).map(r => ({
        ipc: String(r.ipc).trim(), from: iso(toDate(r.from)), to: iso(toDate(r.to)),
        work: num(r.work), recovery: Math.abs(num(r.recovery)), vat: r.vat === '' ? null : num(r.vat),
        retention: num(r.retention), net: r.net === '' ? null : num(r.net),
        status: String(r.status || '').trim(), paid: num(r.paid), paidDate: iso(toDate(r.paidDate)), remarks: r.remarks || ''
      })),
      sections: sec && sec.filter(r => String(r.code || '').trim()).map(r => ({
        code: String(r.code).trim(), desc: String(r.desc || '').trim(), contract: num(r.contract),
        prev: num(r.prev), curr: num(r.curr), cum: r.cum === '' ? num(r.prev) + num(r.curr) : num(r.cum),
        plannedPct: r.plannedPct === '' || r.plannedPct === undefined ? null : pct(r.plannedPct)
      })),
      items: items && items.filter(r => r.item).map(r => {
        const rate = num(r.rate), cqty = num(r.cqty);
        const pqty = num(r.pqty), qqty = num(r.qqty);
        const tqty = r.tqty === '' || r.tqty === undefined ? pqty + qqty : num(r.tqty);
        return {
          bill: String(r.bill).trim(), item: String(r.item).trim(), desc: String(r.desc || '').trim(), unit: r.unit || '',
          cqty, rate, camt: num(r.camt) || cqty * rate, pqty, qqty, tqty,
          tamt: num(r.tamt) || tqty * rate, qamt: num(r.qamt) || qqty * rate
        };
      }),
      baseline: base && base.filter(r => toDate(r.month) && r.planned !== '' && r.planned !== undefined).map(r => ({ month: iso(toDate(r.month)), planned: num(r.planned) })),
      performance: perf && perf.filter(r => toDate(r.date) && (r.planned !== '' || r.actual !== '')).map(r => ({
        date: iso(toDate(r.date)), planned: r.planned === '' ? null : pct(r.planned), actual: r.actual === '' ? null : pct(r.actual), remarks: r.remarks || ''
      }))
    };
    return { model: m, log };
  }

  function normProject(p) {
    return {
      name: p.name || '', contractNo: String(p.contractNo || ''), client: p.client || '', consultant: p.consultant || '',
      contractor: p.contractor || '', cv: num(p.cv), cvVat: num(p.cvVat), co: num(p.co), advance: num(p.advance),
      vat: p.vat === undefined || p.vat === '' ? 15 : pct(p.vat), advPct: p.advPct === undefined || p.advPct === '' ? 10 : pct(p.advPct),
      retPct: pct(p.retPct), start: iso(toDate(p.start)), finish: iso(toDate(p.finish)), dataDate: iso(toDate(p.dataDate))
    };
  }

  function mergeModel(base, upd) {
    const out = JSON.parse(JSON.stringify(base || {}));
    for (const k of ['project', 'invoices', 'sections', 'items', 'baseline', 'performance']) if (upd[k]) out[k] = upd[k];
    return out;
  }

  function modelToWb(m) {
    const wb = XLSX.utils.book_new();
    const p = m.project;
    const projRows = [['Field', 'Value'],
      ['Project Name', p.name], ['Contract No', p.contractNo], ['Client', p.client], ['Consultant', p.consultant],
      ['Contractor', p.contractor], ['Contract Value (excl VAT)', p.cv], ['Contract Value (incl VAT)', p.cvVat],
      ['Approved Change Orders (excl VAT)', p.co], ['Advance Payment (incl VAT)', p.advance], ['VAT %', p.vat],
      ['Advance Recovery %', p.advPct], ['Retention %', p.retPct], ['Commencement Date', p.start],
      ['Planned Completion Date', p.finish], ['Data Date', p.dataDate]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(projRows), 'Project');
    const add = (name, head, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), name);
    add('Invoices', ['IPC No', 'Period From', 'Period To', 'Work Done (excl VAT)', 'Advance Recovery (excl VAT)', 'VAT', 'Retention (incl VAT)', 'Net Certified (incl VAT)', 'Status', 'Paid Amount', 'Paid Date', 'Remarks'],
      m.invoices.map(r => [r.ipc, r.from, r.to, r.work, r.recovery, r.vat, r.retention, r.net, r.status, r.paid, r.paidDate, r.remarks]));
    add('Sections', ['Section', 'Description', 'Contract Amount', 'Previous Amount', 'Current Amount', 'Cumulative Amount', 'Planned % To Date'],
      m.sections.map(r => [r.code, r.desc, r.contract, r.prev, r.curr, r.cum, r.plannedPct]));
    add('BOQ_Items', ['Bill', 'Item No', 'Description', 'Unit', 'Contract Qty', 'Unit Rate', 'Contract Amount', 'Previous Qty', 'Current Qty', 'To-Date Qty', 'Current Amount', 'To-Date Amount'],
      m.items.map(r => [r.bill, r.item, r.desc, r.unit, r.cqty, r.rate, r.camt, r.pqty, r.qqty, r.tqty, r.qamt, r.tamt]));
    add('Baseline_Plan', ['Month', 'Planned Value (excl VAT)'], m.baseline.map(r => [r.month, r.planned]));
    add('Performance', ['Data Date', 'Planned %', 'Actual %', 'Remarks'], m.performance.map(r => [r.date, r.planned, r.actual, r.remarks]));
    return wb;
  }

  // ---------- derived numbers ----------
  function derive(m) {
    const p = m.project;
    const vatR = (p.vat || 15) / 100;
    const cv = (p.cv || 0) + (p.co || 0);
    const inv = [...m.invoices].sort((a, b) => (a.to || '').localeCompare(b.to || ''));
    let cumWork = 0, cumRec = 0, cumNet = 0;
    inv.forEach(r => {
      r.after = r.work - r.recovery;
      r.vatV = r.vat === null || r.vat === undefined ? r.after * vatR : r.vat;
      r.gross = r.after + r.vatV;
      r.netV = r.net === null || r.net === undefined ? r.gross - r.retention : r.net;
      cumWork += r.work; cumRec += r.recovery; cumNet += r.netV;
      r.cumWork = cumWork; r.cumRec = cumRec; r.cumNet = cumNet;
      r.advBal = (p.advance || 0) - cumRec * (1 + vatR);
    });
    const last = inv[inv.length - 1];
    const dataDate = toDate(p.dataDate) || (last && toDate(last.to)) || new Date();
    const start = toDate(p.start) || (inv[0] && toDate(inv[0].from));
    const finish = toDate(p.finish) || (window.SCHED && window.SCHED.loaded() ? toDate(window.SCHED.finish()) : null);

    // baseline (monthly → cumulative)
    const SC = window.SCHED && window.SCHED.loaded() ? window.SCHED : null;
    const base = [...(m.baseline.length ? m.baseline : SC ? SC.planMonthly() : [])].sort((a, b) => a.month.localeCompare(b.month));
    let c = 0;
    const planCum = {};
    base.forEach(b => { c += b.planned; planCum[b.month.slice(0, 7)] = c; });
    const planTotal = c;
    const planAt = d => {
      if (!base.length) return null;
      const k = ymKey(d);
      let v = 0;
      for (const b of base) { if (b.month.slice(0, 7) <= k) v = planCum[b.month.slice(0, 7)]; }
      // pro-rate the current month linearly by day
      const cur = base.find(b => b.month.slice(0, 7) === k);
      if (cur) {
        const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        v -= cur.planned * (1 - d.getUTCDate() / dim);
      }
      return v;
    };
    const pvNow = planAt(dataDate);
    const sp = SC && SC.perfPoint();
    const wp = window.WEEKLY ? window.WEEKLY.perfPoints() : [];
    const perf = [...m.performance, ...wp, ...(sp && !m.performance.some(x => x.date.slice(0, 7) === sp.date.slice(0, 7)) ? [sp] : [])].sort((a, b) => a.date.localeCompare(b.date));
    const lastPerf = perf[perf.length - 1];

    const timePct = start && finish ? Math.max(0, Math.min(100, (dataDate - start) / (finish - start) * 100)) : null;
    const cumCertVat = inv.reduce((a, r) => a + r.gross, 0);
    const paidTot = inv.reduce((a, r) => a + (r.paid || 0), 0);
    return {
      vatR, cv, inv, last, dataDate, start, finish, cumWork, cumRec, cumNet, cumCertVat, paidTot,
      finPct: cv ? cumWork / cv * 100 : 0, pvNow, planPct: pvNow !== null && cv ? pvNow / cv * 100 : null,
      spi: pvNow ? cumWork / pvNow : null, planTotal, base, planCum, planAt, perf, lastPerf, timePct,
      advBal: (p.advance || 0) - cumRec * (1 + vatR)
    };
  }

  // ---------- rendering ----------
  function kpi(lbl, val, hint, barPct, extra = '') {
    return `<div class="kpi" tabindex="0" title="Click for full details"><div class="lbl">${lbl}</div><div class="val">${val}</div>${hint ? `<div class="hint">${hint}</div>` : ''}${barPct !== undefined && barPct !== null ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, barPct))}%"></i></div>` : ''}${extra}</div>`;
  }
  function spiBadge(v) {
    if (v === null || v === undefined || isNaN(v)) return '<span class="status na">○ No baseline</span>';
    if (v >= 0.95) return `<span class="status good">● On track</span>`;
    if (v >= 0.85) return `<span class="status warn">▲ Slight delay</span>`;
    return `<span class="status bad">■ Behind plan</span>`;
  }

  function baseOpts(extra = {}) {
    const grid = css('--grid'), txt = css('--text-2');
    return Object.assign({
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { color: txt, boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'rectRounded' } },
        tooltip: { backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'), borderColor: css('--border'), borderWidth: 1, padding: 10, boxPadding: 4 }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: txt, maxRotation: 0, autoSkipPadding: 12 }, border: { color: grid } },
        y: { grid: { color: grid }, ticks: { color: txt }, border: { display: false }, beginAtZero: true }
      }
    }, extra);
  }
  function draw(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id);
    if (!el) return;
    const pick = PICK[id];
    if (pick) {
      cfg.options = cfg.options || {};
      cfg.options.onClick = (e, els) => { if (els.length) { PICKED_AT = Date.now(); pick(els[0].index, els[0].datasetIndex); } };
      cfg.options.onHover = (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
    }
    charts[id] = new Chart(el, cfg);
  }
  const moneyTick = v => fmtM(v);
  const pctTick = v => v + '%';

  // timeline of months from start to max(plan end, data date)
  function monthAxis(D) {
    const first = D.start || toDate(D.inv[0]?.from) || D.dataDate;
    let lastK = ymKey(D.dataDate);
    if (D.base.length) lastK = [lastK, D.base[D.base.length - 1].month.slice(0, 7)].sort().pop();
    if (D.finish) lastK = [lastK, ymKey(D.finish)].sort().pop();
    const out = [];
    let d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    while (ymKey(d) <= lastK && out.length < 240) { out.push(ymKey(d)); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); }
    return out;
  }
  // actual cumulative by month (IPC assigned to the month of its period end)
  function actualByMonth(D, months) {
    const byM = {};
    D.inv.forEach(r => { const k = (r.to || r.from).slice(0, 7); byM[k] = (byM[k] || 0) + r.work; });
    const dk = ymKey(D.dataDate);
    let c = 0;
    return months.map(k => { c += byM[k] || 0; return k <= dk ? c : null; });
  }

  function render() {
    const m = M, p = m.project, D = derive(m);
    $('#projName').textContent = p.name || 'Project Dashboard';
    $('#projSub').textContent = `Contract ${p.contractNo || '—'} · ${p.contractor || ''} · Project Controls Dashboard`;
    $('#dataDatePill').textContent = 'Data date ' + fmtDate(D.dataDate);
    $('#sourcePill').textContent = SOURCE;
    $('#footTxt').textContent = `Contract ${p.contractNo} · ${p.contractor} · Consultant ${p.consultant} · Client ${p.client}`;

    const months = monthAxis(D);
    const act = actualByMonth(D, months);
    const plan = months.map(k => D.base.length ? (D.planCum[k] ?? (k < D.base[0].month.slice(0, 7) ? 0 : null)) : null);
    // carry plan forward for months after its last entry
    for (let i = 1; i < plan.length; i++) if (plan[i] === null && plan[i - 1] !== null && D.base.length) plan[i] = plan[i - 1];
    const hasPlan = D.base.length > 0;
    const S1 = css('--s1'), S2 = css('--s2'), S3 = css('--s3'), S4 = css('--s4');
    LAST = { D, months, act, plan, hasPlan };
    PICK.chScurve = i => Details.month(months[i]);
    PICK.chDonut = () => Details.kpi('cv');
    PICK.chMonthly = i => Details.ipc(D.inv[i].ipc);
    PICK.chTopSections = i => Details.section(top[i].code);
    PICK.chPerf = i => Details.month(months[i]);
    PICK.chSpi = i => Details.month(months[spiIdx[i]]);
    PICK.chSpendCum = i => Details.month(months[i]);
    PICK.chSpendMonthly = i => Details.month(months[winStart + i]);
    PICK.chAdvance = i => Details.ipc(D.inv[i].ipc);
    PICK.chInvStack = i => Details.ipc(D.inv[i].ipc);

    // ===== OVERVIEW =====
    const finSub = D.planPct !== null ? `Planned ${fmtP(D.planPct)} · Var ${fmtP(D.finPct - D.planPct)}` : 'Baseline not loaded';
    tagNext('#kpis', ['cv','work','fin','spi','time','lastipc']);
    $('#kpis').innerHTML = [
      kpi('Contract value', fmtM(D.cv) + '<small>SAR</small>', `Excl. VAT · incl. VAT ${fmtM(p.cvVat || D.cv * (1 + D.vatR))}`),
      kpi('Work done to date', fmtM(D.cumWork) + '<small>SAR</small>', `${D.inv.length} IPCs · last IPC-${String(D.last?.ipc || '').padStart(2, '0')}`),
      kpi('Financial progress', fmtP(D.finPct), finSub, D.finPct),
      kpi('Schedule performance (SPI)', D.spi !== null ? D.spi.toFixed(2) : '—', '', null, spiBadge(D.spi)),
      kpi('Time elapsed', D.timePct !== null ? fmtP(D.timePct, 1) : '—', D.finish ? `${fmtDate(D.start)} → ${fmtDate(D.finish)}` : 'Set completion date in Project sheet', D.timePct),
      kpi('Last IPC value', fmtM(D.last?.work || 0) + '<small>SAR</small>', D.last ? `${fmtDate(D.last.from)} – ${fmtDate(D.last.to)}` : '')
    ].join('');
    $('#scurveNote').textContent = hasPlan ? 'Planned vs actual, % of contract' : 'Load baseline (Import tab) to show planned curve';

    const pctOf = a => a.map(v => v === null ? null : v / D.cv * 100);
    const physAct = months.map(k => { const r = D.perf.filter(x => x.date.slice(0, 7) === k && x.actual !== null).pop(); return r ? r.actual : null; });
    const physPlan = months.map(k => { const r = D.perf.filter(x => x.date.slice(0, 7) === k && x.planned !== null).pop(); return r ? r.planned : null; });
    Object.assign(LAST, { physAct, physPlan });
    const dsS = [];
    if (hasPlan) dsS.push({ label: 'Planned (baseline)', data: pctOf(plan), borderColor: S2, backgroundColor: S2, borderWidth: 2, pointRadius: 0, tension: .3, borderDash: [6, 4] });
    dsS.push({ label: 'Actual (certified)', data: pctOf(act), borderColor: S1, backgroundColor: S1 + '22', fill: true, borderWidth: 2.5, pointRadius: 3, tension: .3 });
    if (physAct.some(v => v !== null)) dsS.push({ label: 'Actual physical %', data: physAct, borderColor: S3, backgroundColor: S3, borderWidth: 2, pointRadius: 3, spanGaps: true });
    draw('chScurve', {
      type: 'line', data: { labels: months.map(fmtMon), datasets: dsS },
      options: baseOpts({
        scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, ticks: { color: css('--text-2'), callback: pctTick }, suggestedMax: hasPlan ? 100 : undefined } },
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${fmtP(c.parsed.y)}` } } }
      })
    });

    draw('chDonut', {
      type: 'doughnut',
      data: { labels: ['Certified to date', 'Remaining'], datasets: [{ data: [D.cumWork, Math.max(0, D.cv - D.cumWork)], backgroundColor: [S1, css('--grid')], borderColor: css('--surface'), borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, cutout: '74%', plugins: { legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.label}: SAR ${fmt(c.parsed)}` } } } }
    });
    $('#donutCenter').innerHTML = `<div><b>${fmtP(D.finPct)}</b><span class="muted">of contract</span></div>`;
    $('#contractList').innerHTML = [
      ['Certified (excl. VAT)', 'SAR ' + fmtM(D.cumWork)],
      ['Remaining (excl. VAT)', 'SAR ' + fmtM(D.cv - D.cumWork)],
      ['Net certified incl. VAT', 'SAR ' + fmtM(D.cumNet)],
      ['Advance balance (incl. VAT)', 'SAR ' + fmtM(D.advBal)]
    ].map(([a, b], i) => `<li class="click" data-kpi="${['work', 'remain', 'net', 'advance'][i]}"><span>${a}</span><b>${b}</b></li>`).join('');

    draw('chMonthly', {
      type: 'bar',
      data: { labels: D.inv.map(r => 'IPC-' + String(r.ipc).padStart(2, '0')), datasets: [{ label: 'Work done', data: D.inv.map(r => r.work), backgroundColor: S1, borderRadius: 4, maxBarThickness: 46 }] },
      options: baseOpts({
        plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => 'SAR ' + fmt(c.parsed.y), afterLabel: c => { const r = D.inv[c.dataIndex]; return `${fmtDate(r.from)} – ${fmtDate(r.to)}`; } } } },
        scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, ticks: { color: css('--text-2'), callback: moneyTick } } }
      })
    });

    const top = [...m.sections].filter(s => s.cum > 0).sort((a, b) => b.cum - a.cum).slice(0, 8);
    draw('chTopSections', {
      type: 'bar',
      data: { labels: top.map(s => `${s.code.replace('Section ', 'S')} ${s.desc}`.slice(0, 34)), datasets: [{ label: 'Cumulative certified', data: top.map(s => s.cum), backgroundColor: S1, borderRadius: 4, maxBarThickness: 22 }] },
      options: baseOpts({
        indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false },
        plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => { const s = top[c.dataIndex]; return [`SAR ${fmt(s.cum)}`, `${fmtP(s.cum / s.contract * 100)} of section value`]; } } } },
        scales: { y: { grid: { display: false }, ticks: { color: css('--text-2') } }, x: { grid: { color: css('--grid') }, ticks: { color: css('--text-2'), callback: moneyTick }, beginAtZero: true } }
      })
    });

    // ===== PERFORMANCE =====
    const physPct = D.lastPerf?.actual ?? null, physPlanPct = D.lastPerf?.planned ?? null;
    const physSpi = physPct !== null && physPlanPct ? physPct / physPlanPct : null;
    tagNext('#perfKpis', ['plan','fin','var','spi','phys','physspi']);
    $('#perfKpis').innerHTML = [
      kpi('Planned % (financial)', fmtP(D.planPct), hasPlan ? 'From baseline at data date' : 'Baseline not loaded', D.planPct),
      kpi('Earned % (financial)', fmtP(D.finPct), 'Certified work ÷ contract', D.finPct),
      kpi('Variance', D.planPct !== null ? fmtP(D.finPct - D.planPct) : '—', D.pvNow !== null ? `SAR ${fmtM(D.cumWork - D.pvNow)} (EV − PV)` : ''),
      kpi('SPI (financial)', D.spi !== null ? D.spi.toFixed(2) : '—', '', null, spiBadge(D.spi)),
      kpi('Physical progress', physPct !== null ? fmtP(physPct) : '—', D.lastPerf ? `Planned ${fmtP(physPlanPct)} · ${fmtDate(D.lastPerf.date)}` : 'Fill the Performance sheet', physPct),
      kpi('SPI (physical)', physSpi ? physSpi.toFixed(2) : '—', '', null, spiBadge(physSpi))
    ].join('');

    const dsP = [];
    if (physPlan.some(v => v !== null)) dsP.push({ label: 'Planned physical %', data: physPlan, borderColor: S2, backgroundColor: S2, borderDash: [6, 4], borderWidth: 2, pointRadius: 2, spanGaps: true });
    if (physAct.some(v => v !== null)) dsP.push({ label: 'Actual physical %', data: physAct, borderColor: S3, backgroundColor: S3, borderWidth: 2, pointRadius: 3, spanGaps: true });
    if (hasPlan) dsP.push({ label: 'Planned financial %', data: pctOf(plan), borderColor: S4, backgroundColor: S4, borderWidth: 2, pointRadius: 0, borderDash: [2, 3] });
    dsP.push({ label: 'Earned financial %', data: pctOf(act), borderColor: S1, backgroundColor: S1, borderWidth: 2.5, pointRadius: 3 });
    const dk = ymKey(D.dataDate);
    const cut = Math.max(months.indexOf(dk) + 4, 8);
    draw('chPerf', {
      type: 'line', data: { labels: months.slice(0, cut).map(fmtMon), datasets: dsP.map(d => ({ ...d, data: d.data.slice(0, cut), tension: .3 })) },
      options: baseOpts({
        scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, ticks: { color: css('--text-2'), callback: pctTick } } },
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${fmtP(c.parsed.y)}` } } }
      })
    });

    const spiSeries = months.map((k, i) => (act[i] !== null && plan[i]) ? act[i] / plan[i] : null);
    const spiIdx = months.map((k, i) => i).filter(i => spiSeries[i] !== null);
    draw('chSpi', {
      type: 'line',
      data: {
        labels: spiIdx.map(i => fmtMon(months[i])),
        datasets: [
          { label: 'SPI', data: spiIdx.map(i => spiSeries[i]), borderColor: S1, backgroundColor: S1, borderWidth: 2.5, pointRadius: 4, tension: .25 },
          { label: 'Target 1.00', data: spiIdx.map(() => 1), borderColor: css('--muted'), borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0 }
        ]
      },
      options: baseOpts({
        scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, beginAtZero: true, suggestedMax: 1.2 } },
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}` } } }
      })
    });
    $$('#chSpi ~ .spi-empty').forEach(el => el.remove());
    if (!spiIdx.length) $('#chSpi').parentElement.insertAdjacentHTML('beforeend', '<div class="donut-center muted spi-empty">Load the baseline to compute SPI</div>');

    renderSections(m, D);

    // ===== SPENDING =====
    const remainingPlan = hasPlan ? D.planTotal - (D.pvNow || 0) : null;
    tagNext('#spendKpis', ['pv','work','var','net','paid','remain']);
    $('#spendKpis').innerHTML = [
      kpi('Planned spend to date', D.pvNow !== null ? fmtM(D.pvNow) + '<small>SAR</small>' : '—', hasPlan ? `Baseline total ${fmtM(D.planTotal)}` : 'Baseline not loaded'),
      kpi('Actual (certified) to date', fmtM(D.cumWork) + '<small>SAR</small>', 'Excl. VAT'),
      kpi('Spending variance', D.pvNow !== null ? fmtM(D.cumWork - D.pvNow) + '<small>SAR</small>' : '—', D.pvNow ? `${fmtP((D.cumWork / D.pvNow - 1) * 100)} vs plan` : ''),
      kpi('Net certified incl. VAT', fmtM(D.cumNet) + '<small>SAR</small>', 'After advance recovery & retention'),
      kpi('Paid by client', D.paidTot ? fmtM(D.paidTot) + '<small>SAR</small>' : '—', D.paidTot ? `${fmtP(D.paidTot / D.cumNet * 100)} of net certified` : 'Fill "Paid Amount" in Invoices'),
      kpi('Remaining to plan', remainingPlan !== null ? fmtM(remainingPlan) + '<small>SAR</small>' : fmtM(D.cv - D.cumWork) + '<small>SAR</small>', remainingPlan !== null ? 'Planned value after data date' : 'Contract value not yet certified')
    ].join('');
    $('#spendNote').textContent = hasPlan ? 'IPC values placed in the month their period ends' : 'Baseline not loaded — showing actuals only';

    draw('chSpendCum', {
      type: 'line',
      data: {
        labels: months.map(fmtMon), datasets: [
          ...(hasPlan ? [{ label: 'Planned cumulative', data: plan, borderColor: S2, backgroundColor: S2 + '18', fill: true, borderWidth: 2, pointRadius: 0, tension: .3 }] : []),
          { label: 'Actual cumulative', data: act, borderColor: S1, backgroundColor: S1, borderWidth: 2.5, pointRadius: 3, tension: .3 }
        ]
      },
      options: baseOpts({
        scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, ticks: { color: css('--text-2'), callback: moneyTick } } },
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: SAR ${fmt(c.parsed.y, 0)}` } } }
      })
    });

    const monthlyAct = months.map((k, i) => act[i] === null ? null : act[i] - (i ? (act[i - 1] || 0) : 0));
    const monthlyPlan = months.map(k => { const b = D.base.find(x => x.month.slice(0, 7) === k); return b ? b.planned : (hasPlan ? 0 : null); });
    const winEnd = Math.min(months.length, Math.max(months.indexOf(dk) + 7, 12));
    const winStart = Math.max(0, winEnd - 24);
    draw('chSpendMonthly', {
      type: 'bar',
      data: {
        labels: months.slice(winStart, winEnd).map(fmtMon), datasets: [
          ...(hasPlan ? [{ label: 'Planned', data: monthlyPlan.slice(winStart, winEnd), backgroundColor: S2, borderRadius: 4, maxBarThickness: 26 }] : []),
          { label: 'Actual', data: monthlyAct.slice(winStart, winEnd), backgroundColor: S1, borderRadius: 4, maxBarThickness: 26 }
        ]
      },
      options: baseOpts({
        scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, ticks: { color: css('--text-2'), callback: moneyTick } } },
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: SAR ${fmt(c.parsed.y, 0)}` } } }
      })
    });

    draw('chAdvance', {
      type: 'bar',
      data: {
        labels: D.inv.map(r => 'IPC-' + String(r.ipc).padStart(2, '0')), datasets: [
          { label: 'Cumulative advance recovered (incl. VAT)', data: D.inv.map(r => r.cumRec * (1 + D.vatR)), backgroundColor: S4, borderRadius: 4, maxBarThickness: 40 }
        ]
      },
      options: baseOpts({
        scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, ticks: { color: css('--text-2'), callback: moneyTick } } },
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `Recovered to date: SAR ${fmt(c.parsed.y)}`, afterLabel: c => `This IPC: SAR ${fmt(D.inv[c.dataIndex].recovery * (1 + D.vatR))}\nBalance outstanding: SAR ${fmt(D.inv[c.dataIndex].advBal)}` } } }
      })
    });

    // ===== QUANTITIES =====
    renderItems(m);

    // ===== INVOICES =====
    tagNext('#invKpis', ['advance','gross','net','retention','lastipc']);
    $('#invKpis').innerHTML = [
      kpi('Advance paid (incl. VAT)', fmtM(p.advance) + '<small>SAR</small>', `Recovered ${fmtM(D.cumRec * (1 + D.vatR))} · ${fmtP(D.cumRec * (1 + D.vatR) / p.advance * 100)}`, D.cumRec * (1 + D.vatR) / p.advance * 100),
      kpi('Gross certified incl. VAT', fmtM(D.cumCertVat) + '<small>SAR</small>', `VAT ${fmtM(D.inv.reduce((a, r) => a + r.vatV, 0))}`),
      kpi('Net certified incl. VAT', fmtM(D.cumNet) + '<small>SAR</small>', 'Cumulative net amount due'),
      kpi('Retention held', fmtM(D.inv.reduce((a, r) => a + r.retention, 0)) + '<small>SAR</small>', `Rate ${fmtP(p.retPct || 0, 0)}`),
      kpi('Last net amount due', fmtM(D.last?.netV || 0) + '<small>SAR</small>', D.last ? `IPC-${String(D.last.ipc).padStart(2, '0')} · ${D.last.status || 'Submitted'}` : '')
    ].join('');
    const invHead = ['IPC', 'From', 'To', 'Work done', 'Adv. recovery', 'After recovery', 'VAT', 'Gross incl. VAT', 'Retention', 'Net certified', 'Cum. work done', 'Status', 'Paid'];
    const t = D.inv;
    const sum = k => t.reduce((a, r) => a + (r[k] || 0), 0);
    $('#tblInvoices').innerHTML = `<thead><tr>${invHead.map((h, i) => `<th class="${i > 2 && i < 11 || i === 12 ? 'n' : ''}">${h}</th>`).join('')}</tr></thead><tbody>` +
      t.map(r => `<tr class="click" data-ipc="${esc(r.ipc)}"><td><b>IPC-${String(r.ipc).padStart(2, '0')}</b></td><td>${fmtDate(r.from)}</td><td>${fmtDate(r.to)}</td><td class="n">${fmt(r.work)}</td><td class="n">(${fmt(r.recovery)})</td><td class="n">${fmt(r.after)}</td><td class="n">${fmt(r.vatV)}</td><td class="n">${fmt(r.gross)}</td><td class="n">${fmt(r.retention)}</td><td class="n"><b>${fmt(r.netV)}</b></td><td class="n">${fmt(r.cumWork)}</td><td>${statusTag(r.status)}</td><td class="n">${r.paid ? fmt(r.paid) : '—'}</td></tr>`).join('') +
      `</tbody><tfoot><tr><td colspan="3">Total</td><td class="n">${fmt(sum('work'))}</td><td class="n">(${fmt(sum('recovery'))})</td><td class="n">${fmt(sum('after'))}</td><td class="n">${fmt(sum('vatV'))}</td><td class="n">${fmt(sum('gross'))}</td><td class="n">${fmt(sum('retention'))}</td><td class="n">${fmt(sum('netV'))}</td><td></td><td></td><td class="n">${D.paidTot ? fmt(D.paidTot) : '—'}</td></tr></tfoot>`;
    draw('chInvStack', {
      type: 'bar',
      data: {
        labels: t.map(r => 'IPC-' + String(r.ipc).padStart(2, '0')), datasets: [
          { label: 'Work after advance recovery', data: t.map(r => r.after), backgroundColor: S1, borderRadius: 0, maxBarThickness: 46, stack: 's' },
          { label: 'VAT', data: t.map(r => r.vatV), backgroundColor: S3, borderRadius: 4, maxBarThickness: 46, stack: 's' }
        ]
      },
      options: baseOpts({
        scales: { x: { ...baseOpts().scales.x, stacked: true }, y: { ...baseOpts().scales.y, stacked: true, ticks: { color: css('--text-2'), callback: moneyTick } } },
        plugins: { ...baseOpts().plugins, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: SAR ${fmt(c.parsed.y)}`, footer: items => 'Gross: SAR ' + fmt(t[items[0].dataIndex].gross) } } }
      })
    });

    // banner for missing baseline
    const banner = $('#banner');
    const msgs = [];
    if (SOURCE.startsWith('Imported')) msgs.push(`Showing <b>your imported file</b> (stored only in this browser). <button class="btn" id="bReset">Back to published data</button>`);
    if (!hasPlan) msgs.push('Baseline plan not loaded — planned curves, SPI and the spending plan appear after you import the P6 baseline (.xer) or fill <b>Baseline_Plan</b> in the Excel file. <button class="btn" id="bImport">Open Import</button>');
    banner.innerHTML = msgs.join('<br>');
    banner.classList.toggle('hidden', !msgs.length);
    $('#bReset') && ($('#bReset').onclick = resetData);
    $('#bImport') && ($('#bImport').onclick = () => showTab('import'));
  }

  function statusTag(s) {
    const k = (s || 'Submitted').toLowerCase();
    const cls = k.includes('paid') ? 'good' : k.includes('cert') || k.includes('approv') ? 'good' : k.includes('reject') ? 'bad' : 'warn';
    return `<span class="status ${cls}">${esc(s || 'Submitted')}</span>`;
  }

  function renderSections(m, D) {
    const rows = m.sections;
    const tot = rows.reduce((a, s) => a + s.contract, 0);
    const pbar = (v, pl) => `<div class="pbar"><div class="t"><i style="width:${Math.min(100, v)}%"></i>${pl !== null && pl !== undefined ? `<span class="pl" style="left:${Math.min(100, pl)}%" title="Planned ${fmtP(pl)}"></span>` : ''}</div><span>${fmtP(v, 1)}</span></div>`;
    $('#tblSections').innerHTML = `<thead><tr><th>Section</th><th>Description</th><th class="n">Contract amount</th><th class="n">Weight</th><th class="n">Previous</th><th class="n">This period</th><th class="n">Cumulative</th><th>Progress</th><th class="n">Planned %</th></tr></thead><tbody>` +
      rows.map(s => {
        const pr = s.contract ? s.cum / s.contract * 100 : 0;
        return `<tr class="click" data-sec="${esc(s.code)}"><td><b>${esc(s.code)}</b></td><td>${esc(s.desc)}</td><td class="n">${s.contract ? fmt(s.contract) : '—'}</td><td class="n">${tot && s.contract ? fmtP(s.contract / tot * 100, 1) : '—'}</td><td class="n">${s.prev ? fmt(s.prev) : '—'}</td><td class="n">${s.curr ? fmt(s.curr) : '—'}</td><td class="n">${s.cum ? fmt(s.cum) : '—'}</td><td>${s.contract ? pbar(pr, s.plannedPct) : ''}</td><td class="n">${s.plannedPct !== null ? fmtP(s.plannedPct, 1) : '—'}</td></tr>`;
      }).join('') +
      `</tbody><tfoot><tr><td colspan="2">Grand total</td><td class="n">${fmt(tot)}</td><td class="n">100%</td><td class="n">${fmt(rows.reduce((a, s) => a + s.prev, 0))}</td><td class="n">${fmt(rows.reduce((a, s) => a + s.curr, 0))}</td><td class="n">${fmt(rows.reduce((a, s) => a + s.cum, 0))}</td><td>${pbar(tot ? rows.reduce((a, s) => a + s.cum, 0) / tot * 100 : 0, D.planPct)}</td><td class="n">${fmtP(D.planPct, 1)}</td></tr></tfoot>`;
  }

  let itemSort = { k: null, dir: 1 };
  function renderItems(m) {
    const bills = [...new Set(m.items.map(i => i.bill))];
    const sel = $('#fBill');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All bills</option>' + bills.map(b => `<option ${b === cur ? 'selected' : ''}>${esc(b)}</option>`).join('');
    const withProg = m.items.filter(i => i.tqty > 0);
    const tamt = m.items.reduce((a, i) => a + i.tamt, 0), camt = m.items.reduce((a, i) => a + i.camt, 0);
    tagNext('#qtyKpis', ['items', 'active', 'value', 'complete']);
    $('#qtyKpis').innerHTML = [
      kpi('BOQ items listed', m.items.length.toLocaleString(), `${bills.length} bills`),
      kpi('Items with progress', withProg.length.toLocaleString(), `${m.items.filter(i => i.qqty > 0).length} progressed this period`),
      kpi('Items listed — value done', fmtM(tamt) + '<small>SAR</small>', `of ${fmtM(camt)} listed contract value`, camt ? tamt / camt * 100 : 0),
      kpi('Items complete (≥100%)', m.items.filter(i => i.cqty && i.tqty >= i.cqty).length.toLocaleString(), 'Watch for over-runs vs BOQ qty')
    ].join('');
    drawItemsTable(m);
  }
  function drawItemsTable(m) {
    const b = $('#fBill').value, pg = $('#fProg').value, q = $('#fSearch').value.trim().toLowerCase();
    let rows = m.items.filter(i => (!b || i.bill === b) &&
      (!pg || (pg === 'active' ? i.tqty > 0 : pg === 'period' ? i.qqty > 0 : i.tqty <= 0)) &&
      (!q || (i.item + ' ' + i.desc).toLowerCase().includes(q)));
    if (itemSort.k) rows = [...rows].sort((a, c) => {
      const x = itemSort.k === 'pct' ? (a.cqty ? a.tqty / a.cqty : 0) : a[itemSort.k], y = itemSort.k === 'pct' ? (c.cqty ? c.tqty / c.cqty : 0) : c[itemSort.k];
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * itemSort.dir;
    });
    const cols = [['bill', 'Bill'], ['item', 'Item'], ['desc', 'Description'], ['unit', 'Unit'], ['cqty', 'BOQ qty', 1], ['rate', 'Rate', 1], ['camt', 'Contract amt', 1], ['pqty', 'Prev. qty', 1], ['qqty', 'This period', 1], ['tqty', 'To-date qty', 1], ['tamt', 'To-date amt', 1], ['pct', 'Qty progress']];
    const shown = rows.slice(0, 1500);
    $('#tblItems').innerHTML = `<thead><tr>${cols.map(c => `<th data-k="${c[0]}" class="${c[2] ? 'n' : ''}">${c[1]}${itemSort.k === c[0] ? (itemSort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>` +
      shown.map(i => {
        const pr = i.cqty ? i.tqty / i.cqty * 100 : 0;
        return `<tr class="click" data-item="${esc(i.bill + '|' + i.item)}"><td>${esc(i.bill)}</td><td><b>${esc(i.item)}</b></td><td class="desc">${esc(i.desc)}</td><td>${esc(i.unit)}</td><td class="n">${fmt(i.cqty)}</td><td class="n">${fmt(i.rate)}</td><td class="n">${fmt(i.camt)}</td><td class="n">${i.pqty ? fmt(i.pqty) : '—'}</td><td class="n">${i.qqty ? '<b>' + fmt(i.qqty) + '</b>' : '—'}</td><td class="n">${i.tqty ? fmt(i.tqty) : '—'}</td><td class="n">${i.tamt ? fmt(i.tamt) : '—'}</td><td><div class="pbar"><div class="t"><i style="width:${Math.min(100, pr)}%;${pr > 100 ? 'background:var(--bad)' : ''}"></i></div><span>${fmtP(pr, 0)}</span></div></td></tr>`;
      }).join('') +
      `</tbody><tfoot><tr><td colspan="6">${rows.length} items</td><td class="n">${fmt(rows.reduce((a, i) => a + i.camt, 0))}</td><td colspan="3"></td><td class="n">${fmt(rows.reduce((a, i) => a + i.tamt, 0))}</td><td></td></tr></tfoot>`;
    $('#itemsFoot').textContent = rows.length > shown.length ? `Showing first ${shown.length} of ${rows.length} — refine the filter.` : '';
    $$('#tblItems th').forEach(th => th.onclick = () => { const k = th.dataset.k; itemSort = { k, dir: itemSort.k === k ? -itemSort.dir : 1 }; drawItemsTable(M); });
  }

  // kpi containers get their detail keys applied after the next paint of innerHTML
  const KPI_KEYS = {};
  function tagNext(sel, keys) { KPI_KEYS[sel] = keys; queueMicrotask(() => $$(sel + ' .kpi').forEach((el, i) => { el.dataset.k = keys[i] || ''; el.dataset.grp = sel; })); }

  // ================= DETAILS PANEL =================
  const Details = (() => {
    const host = document.createElement('div');
    host.className = 'modal hidden';
    host.innerHTML = `<div class="modal-back"></div><div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-h"><button class="btn ghost" id="mBack" title="Back">←</button><div><h2 id="mTitle"></h2><div class="muted" id="mSub"></div></div><button class="btn ghost" id="mClose" title="Close (Esc)">✕</button></div>
      <div class="modal-b" id="mBody"></div></div>`;
    document.body.appendChild(host);
    const stack = [];
    let mchart = null;
    function show(fn) {
      const v = fn();
      $('#mTitle').innerHTML = v.title; $('#mSub').innerHTML = v.sub || '';
      $('#mBody').innerHTML = (v.chart ? '<div class="chart-box mchart"><canvas id="mChart"></canvas></div>' : '') + v.body; $('#mBody').scrollTop = 0;
      $('#mBack').style.visibility = stack.length > 1 ? 'visible' : 'hidden';
      host.classList.remove('hidden'); document.body.style.overflow = 'hidden';
      if (mchart) { mchart.destroy(); mchart = null; }
      if (v.chart) { const el = $('#mChart'); if (el) mchart = new Chart(el, v.chart); }
    }
    function open(fn) { stack.push(fn); show(fn); }
    function close() { stack.length = 0; host.classList.add('hidden'); document.body.style.overflow = ''; if (mchart) { mchart.destroy(); mchart = null; } }
    host.querySelector('.modal-back').onclick = close;
    host.querySelector('#mClose').onclick = close;
    host.querySelector('#mBack').onclick = () => { stack.pop(); if (stack.length) show(stack[stack.length - 1]); else close(); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !host.classList.contains('hidden')) close(); });

    const tiles = arr => `<div class="dtiles">${arr.filter(Boolean).map(([l, v, h]) => `<div class="dtile"><div class="lbl">${l}</div><div class="v">${v}</div>${h ? `<div class="muted small">${h}</div>` : ''}</div>`).join('')}</div>`;
    const sec = (t, h) => `<h4 class="dsec">${t}</h4>${h}`;
    const table = (head, rows, foot) => `<div class="table-wrap"><table class="tbl">${'<thead><tr>' + head.map(h => `<th class="${h[1] ? 'n' : ''}">${h[0]}</th>`).join('') + '</tr></thead>'}<tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="muted">No data</td></tr>`}</tbody>${foot ? `<tfoot><tr>${foot}</tr></tfoot>` : ''}</table></div>`;
    const sar = v => 'SAR ' + fmt(v);
    const ipcName = n => 'IPC-' + String(n).padStart(2, '0');
    const note = t => `<div class="dnote">${t}</div>`;
    const billOf = code => String(code).replace(/^section\s*/i, '').replace(/^0+(?=\d)/, '').toUpperCase();
    const sectionOfBill = bill => M.sections.find(s => billOf(s.code) === String(bill).toUpperCase());
    const itemStatus = i => !i.tqty ? ['na', 'Not started'] : i.cqty && i.tqty > i.cqty ? ['bad', 'Over-run vs BOQ'] : i.cqty && i.tqty >= i.cqty ? ['good', 'Complete'] : ['warn', 'In progress'];
    const itemRow = i => { const pr = i.cqty ? i.tqty / i.cqty * 100 : 0; return `<tr class="click" data-item="${esc(i.bill + '|' + i.item)}"><td><b>${esc(i.item)}</b></td><td class="desc">${esc(i.desc)}</td><td>${esc(i.unit)}</td><td class="n">${fmt(i.cqty)}</td><td class="n">${i.qqty ? '<b>' + fmt(i.qqty) + '</b>' : '—'}</td><td class="n">${fmt(i.tqty)}</td><td class="n">${fmt(i.tamt)}</td><td class="n">${fmtP(pr, 1)}</td></tr>`; };
    const itemHead = [['Item'], ['Description'], ['Unit'], ['BOQ qty', 1], ['This period', 1], ['To-date qty', 1], ['To-date amt', 1], ['Progress', 1]];
    const ipcRow = r => `<tr class="click" data-ipc="${esc(r.ipc)}"><td><b>${ipcName(r.ipc)}</b></td><td>${fmtDate(r.from)} – ${fmtDate(r.to)}</td><td class="n">${fmt(r.work)}</td><td class="n">${fmt(r.cumWork)}</td><td class="n">${fmtP(r.cumWork / LAST.D.cv * 100, 2)}</td><td class="n">${fmt(r.netV)}</td><td>${esc(r.status || 'Submitted')}</td></tr>`;
    const ipcHead = [['IPC'], ['Period'], ['Work done', 1], ['Cumulative', 1], ['Cum %', 1], ['Net incl. VAT', 1], ['Status']];
    const lineOpts = (money) => baseOpts({ scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, ticks: { color: css('--text-2'), callback: money ? (v => fmtM(v)) : (v => v + '%') } } } });

    function monthRows(onlyToDate) {
      const { D, months, act, plan } = LAST;
      const dk = ymKey(D.dataDate);
      return months.map((k, i) => {
        if (onlyToDate && k > dk) return null;
        const b = D.base.find(x => x.month.slice(0, 7) === k);
        const a = act[i] === null ? null : act[i] - (i ? (act[i - 1] || 0) : 0);
        return { k, i, pm: b ? b.planned : null, am: a, pc: plan[i], ac: act[i] };
      }).filter(Boolean);
    }
    function monthTable(onlyToDate = true) {
      const rows = monthRows(onlyToDate);
      return table([['Month'], ['Planned (month)', 1], ['Actual (month)', 1], ['Planned cum.', 1], ['Actual cum.', 1], ['Variance', 1], ['SPI', 1]],
        rows.map(r => `<tr class="click" data-month="${r.k}"><td><b>${fmtMon(r.k)}</b></td><td class="n">${r.pm !== null ? fmt(r.pm, 0) : '—'}</td><td class="n">${r.am !== null ? fmt(r.am, 0) : '—'}</td><td class="n">${r.pc !== null ? fmt(r.pc, 0) : '—'}</td><td class="n">${r.ac !== null ? fmt(r.ac, 0) : '—'}</td><td class="n">${r.pc !== null && r.ac !== null ? fmt(r.ac - r.pc, 0) : '—'}</td><td class="n">${r.pc && r.ac !== null ? (r.ac / r.pc).toFixed(2) : '—'}</td></tr>`));
    }
    const noBase = () => LAST.hasPlan ? '' : note('Baseline not loaded yet — planned values, variance and SPI appear after importing the P6 baseline (.xer) or filling <b>Baseline_Plan</b>.');

    // ---- IPC ----
    function ipc(n) {
      const D = LAST.D, idx = D.inv.findIndex(r => String(r.ipc) === String(n)), r = D.inv[idx];
      if (!r) return { title: 'IPC not found', body: '' };
      const prev = D.inv[idx - 1];
      const days = Math.round((toDate(r.to) - toDate(r.from)) / 864e5) + 1;
      const isLast = idx === D.inv.length - 1;
      const secs = isLast ? M.sections.filter(s => s.curr) : [];
      const items = isLast ? M.items.filter(i => i.qqty > 0).sort((a, b) => b.qamt - a.qamt) : [];
      const chg = prev ? (r.work / prev.work - 1) * 100 : null;
      return {
        title: `${ipcName(r.ipc)} — Interim Payment Certificate`,
        sub: `${fmtDate(r.from)} → ${fmtDate(r.to)} · ${days} days · ${statusTag(r.status)}`,
        body: tiles([
          ['Work done (excl. VAT)', sar(r.work), chg !== null ? `${chg >= 0 ? '▲' : '▼'} ${fmtP(Math.abs(chg), 1)} vs ${ipcName(prev.ipc)}` : 'First IPC'],
          ['Advance recovery', '(' + fmt(r.recovery) + ')', fmtP(r.work ? r.recovery / r.work * 100 : 0, 1) + ' of work done'],
          ['After recovery', sar(r.after)],
          ['VAT', sar(r.vatV), fmtP((LAST.D.vatR) * 100, 0)],
          ['Gross incl. VAT', sar(r.gross)],
          ['Retention', sar(r.retention)],
          ['Net certified (incl. VAT)', `<b>${sar(r.netV)}</b>`],
          ['Paid', r.paid ? sar(r.paid) : '—', r.paidDate ? fmtDate(r.paidDate) : 'Not recorded'],
          ['Cumulative work done', sar(r.cumWork), fmtP(r.cumWork / D.cv * 100) + ' of contract'],
          ['Share of total certified', fmtP(r.work / D.cumWork * 100, 1)],
          ['Advance balance after IPC', sar(r.advBal), 'incl. VAT'],
          ['Average per day', sar(r.work / days)]
        ]) + (r.remarks ? note(esc(r.remarks)) : '') +
          (isLast ? sec(`Sections progressed in this IPC (${secs.length})`, table([['Section'], ['Description'], ['This period', 1], ['Cumulative', 1], ['Progress', 1]],
            secs.sort((a, b) => b.curr - a.curr).map(s => `<tr class="click" data-sec="${esc(s.code)}"><td><b>${esc(s.code)}</b></td><td>${esc(s.desc)}</td><td class="n">${fmt(s.curr)}</td><td class="n">${fmt(s.cum)}</td><td class="n">${fmtP(s.cum / s.contract * 100, 1)}</td></tr>`))) +
            sec(`BOQ items progressed in this IPC (${items.length})`, table([['Bill'], ...itemHead], items.map(i => itemRow(i).replace('<td><b>', `<td>${esc(i.bill)}</td><td><b>`))))
            : note('Section and item breakdown is available for the latest IPC (the data file holds previous / current / to-date values).')) +
          sec('All IPCs', table(ipcHead, D.inv.map(ipcRow))),
        chart: {
          type: 'bar', data: { labels: D.inv.map(x => ipcName(x.ipc)), datasets: [{ label: 'Work done', data: D.inv.map(x => x.work), backgroundColor: D.inv.map(x => x === r ? css('--s2') : css('--s1')), borderRadius: 4, maxBarThickness: 40 }] },
          options: baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false } }, scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, ticks: { color: css('--text-2'), callback: v => fmtM(v) } } } })
        }
      };
    }

    // ---- month ----
    function month(k) {
      const { D } = LAST;
      const r = monthRows(false).find(x => x.k === k) || {};
      const ipcs = D.inv.filter(x => (x.to || x.from).slice(0, 7) === k);
      const pf = D.perf.filter(x => x.date.slice(0, 7) === k).pop();
      return {
        title: `Month — ${toDate(k).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
        sub: k > ymKey(D.dataDate) ? 'Future month (after data date) — planned values only' : 'Planned vs actual for this month',
        body: noBase() + tiles([
          ['Planned this month', r.pm !== null && r.pm !== undefined ? sar(r.pm) : '—'],
          ['Actual this month', r.am !== null && r.am !== undefined ? sar(r.am) : '—', 'IPCs whose period ends this month'],
          ['Planned cumulative', r.pc !== null && r.pc !== undefined ? sar(r.pc) : '—', r.pc ? fmtP(r.pc / D.cv * 100) + ' of contract' : ''],
          ['Actual cumulative', r.ac !== null && r.ac !== undefined ? sar(r.ac) : '—', r.ac !== null && r.ac !== undefined ? fmtP(r.ac / D.cv * 100) + ' of contract' : ''],
          ['Cumulative variance', r.pc !== null && r.ac !== null && r.pc !== undefined && r.ac !== undefined ? sar(r.ac - r.pc) : '—'],
          ['SPI (cumulative)', r.pc && r.ac !== null && r.ac !== undefined ? (r.ac / r.pc).toFixed(2) : '—', '', ],
          pf ? ['Physical progress', `${fmtP(pf.actual)} / plan ${fmtP(pf.planned)}`, pf.remarks || ''] : null
        ]) + sec('IPCs in this month', table(ipcHead, ipcs.map(ipcRow))) + sec('Month-by-month (to data date)', monthTable(true))
      };
    }

    // ---- section ----
    function section(code) {
      const s = M.sections.find(x => x.code === code);
      if (!s) return { title: 'Section not found', body: '' };
      const tot = M.sections.reduce((a, x) => a + x.contract, 0);
      const bill = billOf(code);
      const items = M.items.filter(i => String(i.bill).toUpperCase() === bill);
      const act = items.filter(i => i.tqty > 0).sort((a, b) => b.tamt - a.tamt);
      const pr = s.contract ? s.cum / s.contract * 100 : 0;
      return {
        title: `${esc(s.code)} — ${esc(s.desc)}`,
        sub: `Weight ${fmtP(tot ? s.contract / tot * 100 : 0, 2)} of contract · ${items.length ? items.length + ' BOQ items' : 'BOQ items not listed in the data file for this section'}`,
        body: tiles([
          ['Contract amount', sar(s.contract)],
          ['Previous', sar(s.prev)],
          ['This period', sar(s.curr)],
          ['Cumulative', sar(s.cum)],
          ['Progress', fmtP(pr), s.plannedPct !== null ? `Planned ${fmtP(s.plannedPct)} · Var ${fmtP(pr - s.plannedPct)}` : 'Planned % not provided'],
          ['Remaining value', sar(s.contract - s.cum)],
          ['Share of certified work', fmtP(LAST.D.cumWork ? s.cum / LAST.D.cumWork * 100 : 0, 1)],
          items.length ? ['Items with progress', `${act.length} / ${items.length}`, `${items.filter(i => i.qqty > 0).length} this period`] : null
        ]) +
          (items.length ? sec('Items with progress', table(itemHead, act.map(itemRow))) + sec(`Items not started (${items.length - act.length})`, table(itemHead, items.filter(i => !(i.tqty > 0)).map(itemRow))) : ''),
        chart: s.contract ? {
          type: 'bar', data: { labels: ['Previous', 'This period', 'Remaining'], datasets: [{ data: [s.prev, s.curr, s.contract - s.cum], backgroundColor: [css('--s1'), css('--s3'), css('--grid')], borderRadius: 4, maxBarThickness: 60 }] },
          options: baseOpts({ indexAxis: 'y', plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => sar(c.parsed.x) } } }, scales: { y: { grid: { display: false }, ticks: { color: css('--text-2') } }, x: { grid: { color: css('--grid') }, ticks: { color: css('--text-2'), callback: v => fmtM(v) }, beginAtZero: true } } })
        } : null
      };
    }

    // ---- BOQ item ----
    function item(key) {
      const [bill, no] = key.split('|');
      const i = M.items.find(x => x.bill === bill && x.item === no);
      if (!i) return { title: 'Item not found', body: '' };
      const s = sectionOfBill(bill);
      const billItems = M.items.filter(x => x.bill === bill);
      const billAmt = billItems.reduce((a, x) => a + x.camt, 0);
      const pr = i.cqty ? i.tqty / i.cqty * 100 : 0;
      const [cls, st] = itemStatus(i);
      return {
        title: `Item ${esc(i.item)}`,
        sub: `${esc(i.desc)}<br>Bill ${esc(i.bill)}${s ? ' · ' + esc(s.desc) : ''} · <span class="status ${cls}">${st}</span>`,
        body: tiles([
          ['Unit', esc(i.unit) || '—'],
          ['Unit rate', sar(i.rate)],
          ['BOQ quantity', fmt(i.cqty)],
          ['Contract amount', sar(i.camt), `${fmtP(billAmt ? i.camt / billAmt * 100 : 0, 2)} of bill · ${fmtP(i.camt / LAST.D.cv * 100, 3)} of contract`],
          ['Previous qty', fmt(i.pqty)],
          ['This period qty', fmt(i.qqty), sar(i.qamt)],
          ['To-date qty', fmt(i.tqty), sar(i.tamt)],
          ['Quantity progress', fmtP(pr, 1)],
          ['Remaining qty', fmt(i.cqty - i.tqty), i.tqty > i.cqty ? 'Over-run — check variation' : ''],
          ['Remaining amount', sar(i.camt - i.tamt)]
        ]) + (s ? `<p><button class="btn" data-sec="${esc(s.code)}">Open ${esc(s.code)} — ${esc(s.desc)} →</button></p>` : ''),
        chart: {
          type: 'bar', data: { labels: ['Previous', 'This period', 'Remaining'], datasets: [{ data: [i.pqty, i.qqty, Math.max(0, i.cqty - i.tqty)], backgroundColor: [css('--s1'), css('--s3'), css('--grid')], borderRadius: 4, maxBarThickness: 60 }] },
          options: baseOpts({ indexAxis: 'y', plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: c => fmt(c.parsed.x) + ' ' + i.unit } } }, scales: { y: { grid: { display: false }, ticks: { color: css('--text-2') } }, x: { grid: { color: css('--grid') }, ticks: { color: css('--text-2') }, beginAtZero: true } } })
        }
      };
    }

    // ---- KPI cards ----
    function kpi(k) {
      const D = LAST.D, p = M.project;
      const secTable = () => table([['Section'], ['Description'], ['Contract', 1], ['Weight', 1], ['Cumulative', 1], ['Progress', 1]],
        M.sections.map(s => `<tr class="click" data-sec="${esc(s.code)}"><td><b>${esc(s.code)}</b></td><td>${esc(s.desc)}</td><td class="n">${fmt(s.contract)}</td><td class="n">${fmtP(s.contract / D.cv * 100, 2)}</td><td class="n">${s.cum ? fmt(s.cum) : '—'}</td><td class="n">${s.contract ? fmtP(s.cum / s.contract * 100, 1) : '—'}</td></tr>`));
      const invTable = () => table(ipcHead, D.inv.map(ipcRow));
      const itemList = (title, list) => ({ title, sub: `${list.length} items — click any item for details`, body: table([['Bill'], ...itemHead], list.map(i => itemRow(i).replace('<td><b>', `<td>${esc(i.bill)}</td><td><b>`))) });
      const timeBody = () => {
        const el = D.start ? Math.round((D.dataDate - D.start) / 864e5) : null, total = D.start && D.finish ? Math.round((D.finish - D.start) / 864e5) : null;
        return tiles([['Commencement', fmtDate(D.start)], ['Planned completion', D.finish ? fmtDate(D.finish) : 'Not set'], ['Data date', fmtDate(D.dataDate)],
          ['Days elapsed', el !== null ? el.toLocaleString() : '—'], ['Days remaining', total !== null ? (total - el).toLocaleString() : '—'], ['Total duration', total !== null ? total.toLocaleString() + ' days' : '—'],
          ['Time elapsed', fmtP(D.timePct, 1)], ['Financial progress', fmtP(D.finPct)], ['Progress ÷ time', D.timePct ? (D.finPct / D.timePct).toFixed(2) : '—', '1.00 = progress keeping pace with time']]) +
          (D.finish ? '' : note('Set <b>Planned Completion Date</b> in the Project sheet (or import the .xer) to compute time elapsed.'));
      };
      const perfBody = () => noBase() + tiles([['Planned % (financial)', fmtP(D.planPct)], ['Earned % (financial)', fmtP(D.finPct)], ['Variance', D.planPct !== null ? fmtP(D.finPct - D.planPct) : '—'],
        ['PV (planned value)', D.pvNow !== null ? sar(D.pvNow) : '—'], ['EV (earned = certified)', sar(D.cumWork)], ['SPI = EV ÷ PV', D.spi !== null ? D.spi.toFixed(3) : '—']]) +
        sec('Monthly planned vs actual', monthTable(true)) +
        sec('Physical progress (Performance sheet)', table([['Data date'], ['Planned %', 1], ['Actual %', 1], ['Variance', 1], ['SPI', 1], ['Remarks']],
          D.perf.map(r => `<tr><td>${fmtDate(r.date)}</td><td class="n">${fmtP(r.planned)}</td><td class="n">${fmtP(r.actual)}</td><td class="n">${r.planned !== null && r.actual !== null ? fmtP(r.actual - r.planned) : '—'}</td><td class="n">${r.planned ? (r.actual / r.planned).toFixed(2) : '—'}</td><td>${esc(r.remarks)}</td></tr>`)));
      const V = {
        cv: () => ({ title: 'Contract value', sub: `Contract ${esc(p.contractNo)} · ${esc(p.client)}`, body: tiles([['Original (excl. VAT)', sar(p.cv)], ['Change orders', sar(p.co || 0)], ['Revised (excl. VAT)', sar(D.cv)], ['Incl. VAT', sar(p.cvVat || D.cv * (1 + D.vatR))], ['Certified to date', sar(D.cumWork), fmtP(D.finPct)], ['Remaining', sar(D.cv - D.cumWork)], ['Advance payment', sar(p.advance), 'incl. VAT'], ['Contractor', esc(p.contractor)], ['Consultant', esc(p.consultant)]]) + sec('Breakdown by section', secTable()) }),
        work: () => ({ title: 'Work done to date', sub: `${D.inv.length} IPCs · cumulative certified value (excl. VAT)`, body: tiles([['Cumulative work done', sar(D.cumWork)], ['Average per IPC', sar(D.cumWork / D.inv.length)], ['Largest IPC', (() => { const m = D.inv.reduce((a, r) => r.work > a.work ? r : a, D.inv[0]); return ipcName(m.ipc) + ' · ' + fmtM(m.work); })()]]) + sec('IPCs', invTable()) + sec('By section', secTable()) }),
        fin: () => ({ title: 'Financial progress', sub: 'Certified work ÷ revised contract value', body: tiles([['Certified (EV)', sar(D.cumWork)], ['Contract value', sar(D.cv)], ['Progress', fmtP(D.finPct)], ['Planned', fmtP(D.planPct)], ['Variance', D.planPct !== null ? fmtP(D.finPct - D.planPct) : '—']]) + noBase() + sec('By section', secTable()) }),
        spi: () => ({ title: 'Schedule Performance Index (SPI)', sub: 'SPI = Earned value ÷ Planned value (cumulative). ≥ 0.95 on track · 0.85–0.95 slight delay · < 0.85 behind plan', body: perfBody() }),
        time: () => ({ title: 'Time elapsed', sub: 'Contract time vs progress', body: timeBody() }),
        lastipc: () => ipc(D.last.ipc),
        plan: () => ({ title: 'Planned progress (financial)', sub: 'From the baseline at the data date', body: perfBody() }),
        var: () => ({ title: 'Variance — planned vs actual', sub: 'Cumulative, SAR excl. VAT', body: perfBody() }),
        phys: () => ({ title: 'Physical progress', sub: 'From the Performance sheet (P6 updates)', body: perfBody() }),
        physspi: () => ({ title: 'SPI (physical)', sub: 'Actual % ÷ Planned % from P6 updates', body: perfBody() }),
        pv: () => ({ title: 'Spending plan — planned to date', sub: 'Baseline planned value', body: noBase() + tiles([['Planned to date', D.pvNow !== null ? sar(D.pvNow) : '—'], ['Actual to date', sar(D.cumWork)], ['Baseline total', D.planTotal ? sar(D.planTotal) : '—']]) + sec('All months (incl. future)', monthTable(false)) }),
        net: () => ({ title: 'Net certified incl. VAT', sub: 'Work − advance recovery + VAT − retention', body: tiles([['Work done', sar(D.cumWork)], ['Advance recovered', '(' + fmt(D.cumRec) + ')'], ['VAT', sar(D.inv.reduce((a, r) => a + r.vatV, 0))], ['Retention', sar(D.inv.reduce((a, r) => a + r.retention, 0))], ['Net certified', `<b>${sar(D.cumNet)}</b>`]]) + sec('IPCs', invTable()) }),
        paid: () => ({ title: 'Payments received', sub: 'From "Paid Amount" in the Invoices sheet', body: tiles([['Net certified', sar(D.cumNet)], ['Paid', sar(D.paidTot)], ['Outstanding', sar(D.cumNet - D.paidTot)]]) + table([['IPC'], ['Net certified', 1], ['Paid', 1], ['Paid date'], ['Outstanding', 1]], D.inv.map(r => `<tr class="click" data-ipc="${esc(r.ipc)}"><td><b>${ipcName(r.ipc)}</b></td><td class="n">${fmt(r.netV)}</td><td class="n">${r.paid ? fmt(r.paid) : '—'}</td><td>${r.paidDate ? fmtDate(r.paidDate) : '—'}</td><td class="n">${fmt(r.netV - (r.paid || 0))}</td></tr>`)) }),
        remain: () => ({ title: 'Remaining work', sub: 'Contract value not yet certified', body: tiles([['Remaining (contract)', sar(D.cv - D.cumWork)], ['Remaining to plan', D.pvNow !== null ? sar(D.planTotal - D.pvNow) : '—']]) + sec('By section', secTable()) }),
        advance: () => ({ title: 'Advance payment', sub: `Recovered at ${fmtP(p.advPct || 10, 0)} of each IPC (+VAT)`, body: tiles([['Advance paid', sar(p.advance)], ['Recovered to date', sar(D.cumRec * (1 + D.vatR))], ['Balance', sar(D.advBal)], ['Recovered %', fmtP(D.cumRec * (1 + D.vatR) / p.advance * 100)]]) + table([['IPC'], ['Recovery excl. VAT', 1], ['Recovery incl. VAT', 1], ['Cumulative', 1], ['Balance', 1]], D.inv.map(r => `<tr class="click" data-ipc="${esc(r.ipc)}"><td><b>${ipcName(r.ipc)}</b></td><td class="n">${fmt(r.recovery)}</td><td class="n">${fmt(r.recovery * (1 + D.vatR))}</td><td class="n">${fmt(r.cumRec * (1 + D.vatR))}</td><td class="n">${fmt(r.advBal)}</td></tr>`)) }),
        gross: () => V.net(), retention: () => V.net(),
        scurve: () => ({ title: 'Cumulative progress — S-curve', sub: 'Planned vs actual by month (click a month for details)', body: noBase() + tiles([['Planned to date', D.pvNow !== null ? sar(D.pvNow) : '—', fmtP(D.planPct)], ['Actual to date', sar(D.cumWork), fmtP(D.finPct)], ['SPI', D.spi !== null ? D.spi.toFixed(3) : '—']]) + sec('All months', monthTable(false)) }),
        sections: () => ({ title: 'All sections', sub: `${M.sections.length} sections — click a section for its BOQ items`, body: tiles([['Contract total', sar(M.sections.reduce((a, s) => a + s.contract, 0))], ['Certified to date', sar(M.sections.reduce((a, s) => a + s.cum, 0))], ['This period', sar(M.sections.reduce((a, s) => a + s.curr, 0))], ['Sections started', `${M.sections.filter(s => s.cum > 0).length} / ${M.sections.filter(s => s.contract > 0).length}`]]) + secTable() }),
        items: () => itemList('All BOQ items', M.items),
        active: () => itemList('Items with progress', M.items.filter(i => i.tqty > 0).sort((a, b) => b.tamt - a.tamt)),
        value: () => itemList('Items by value done', M.items.filter(i => i.tamt > 0).sort((a, b) => b.tamt - a.tamt)),
        complete: () => itemList('Items complete or over-run', M.items.filter(i => i.cqty && i.tqty >= i.cqty))
      };
      return (V[k] || V.cv)();
    }
    return {
      open, close,
      ipc: n => open(() => ipc(n)), month: k => open(() => month(k)), section: c => open(() => section(c)),
      item: k => open(() => item(k)), kpi: (k, grp) => {
        // same key in different tabs can mean different things
        if (k === 'work' && grp === '#spendKpis') k = 'pv';
        if (k === 'var' && grp === '#spendKpis') k = 'pv';
        if (k === 'spi' && grp === '#perfKpis') k = 'spi';
        if (k === 'net' && grp === '#invKpis') k = 'net';
        open(() => kpi(k));
      }
    };
  })();

  document.addEventListener('click', e => {
    if (e.target.closest('#sourcePill')) { showTab('import'); return; }
    if (e.target.closest('th, input, select, label, a, .modal-h')) return;
    const t = e.target.closest('[data-ipc],[data-sec],[data-item],[data-month],[data-kpi],.kpi[data-k]');
    if (!t) {
      // anywhere else on a card (title, empty chart area) → that card's full details
      const c = e.target.closest('.card[data-card]');
      if (c && Date.now() - PICKED_AT > 300 && !e.target.closest('.modal')) Details.kpi(c.dataset.card);
      return;
    }
    if (t.dataset.ipc) Details.ipc(t.dataset.ipc);
    else if (t.dataset.sec) Details.section(t.dataset.sec);
    else if (t.dataset.item) Details.item(t.dataset.item);
    else if (t.dataset.month) Details.month(t.dataset.month);
    else if (t.dataset.kpi) Details.kpi(t.dataset.kpi);
    else if (t.dataset.k) Details.kpi(t.dataset.k, t.dataset.grp);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList?.contains('kpi')) e.target.click(); });

  // ---------- tabs / fullscreen / theme ----------
  function showTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    Object.values(charts).forEach(c => c.resize());
    try { localStorage.setItem('trd_tab', name); } catch (e) { }
    if (window.APP && APP.onTab) APP.onTab(name);
  }
  $$('.tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));
  $('#fsBtn').onclick = () => {
    if (!document.fullscreenElement) (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen).call(document.documentElement);
    else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  };
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    document.body.classList.toggle('fs', on);
    $('#fsBtn span').textContent = on ? 'Exit full screen' : 'Full screen';
    setTimeout(() => Object.values(charts).forEach(c => c.resize()), 120);
  });
  $('#themeBtn').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('trd_theme', document.documentElement.dataset.theme); } catch (e) { }
    render();
  };
  ['fBill', 'fProg', 'fSearch'].forEach(id => $('#' + id).addEventListener('input', () => drawItemsTable(M)));

  // ---------- import ----------
  const logEl = $('#importLog');
  function log(lines) { logEl.textContent = `[${new Date().toLocaleString()}]\n` + lines.join('\n'); }
  function save(meta) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ model: M, meta })); }
    catch (e) { log(['⚠ Could not store in this browser (' + e.message + '). Data is loaded for this session only.']); }
  }
  function wireDrop(dropId, inputId, handler) {
    const drop = $('#' + dropId), input = $('#' + inputId);
    input.onchange = () => input.files[0] && handler(input.files[0]);
    ['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', ev => ev.dataTransfer.files[0] && handler(ev.dataTransfer.files[0]));
  }
  wireDrop('dropXlsx', 'fileXlsx', async file => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const { model, log: l } = wbToModel(wb);
      M = mergeModel(M, model);
      SOURCE = 'Imported: ' + file.name;
      save({ file: file.name, at: new Date().toISOString() });
      log([`Imported "${file.name}"`, ...l, '', '✓ Dashboard updated.']);
      render();
    } catch (e) { log(['✗ Import failed: ' + e.message]); }
  });
  $('#exportBtn').onclick = () => XLSX.writeFile(modelToWb(M), 'project-data.xlsx');
  $('#resetBtn').onclick = resetData;
  function resetData() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { }
    log(['Local import cleared — showing published data.']);
    boot(true);
  }

  // ---------- public API (used by schedule.js) ----------
  const ready = [];
  window.APP = {
    get M() { return M; }, render: () => M && render(), derive, Details, showTab, esc, fmt, fmtM, fmtP, baseOpts,
    markPicked: () => { PICKED_AT = Date.now(); }, onTab: null,
    whenReady: fn => { if (M) fn(); else ready.push(fn); }
  };

  // ---------- boot ----------
  async function boot(skipLocal) {
    let model = window.DEFAULT_DATA ? JSON.parse(JSON.stringify(window.DEFAULT_DATA)) : null;
    SOURCE = 'Published data';
    try {
      const r = await fetch('data/project-data.xlsx', { cache: 'no-store' });
      if (r.ok) {
        const wb = XLSX.read(await r.arrayBuffer(), { cellDates: true });
        model = mergeModel(model, wbToModel(wb).model);
        SOURCE = 'Published: project-data.xlsx';
      }
    } catch (e) { /* offline / file:// — embedded copy is used */ }
    if (!skipLocal) {
      try {
        const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
        if (s && s.model) { model = s.model; SOURCE = 'Imported: ' + (s.meta?.file || 'file'); }
      } catch (e) { }
    }
    M = model;
    render();
    ready.splice(0).forEach(fn => fn());
  }
  try { const th = localStorage.getItem('trd_theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) { }
  try { const tb = localStorage.getItem('trd_tab'); if (tb && $('#tab-' + tb)) showTab(tb); } catch (e) { }
  boot();
})();
