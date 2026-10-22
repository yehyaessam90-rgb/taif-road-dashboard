/* Contractor weekly report (.docx) → structured week record → "Weekly Report" tab.
   Parsed in the browser. Published copy: data/weekly.json (all weeks; photos kept for the latest weeks only). */
(function () {
  'use strict';
  const A = window.APP;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = A.esc, fmt = A.fmt, fmtP = A.fmtP;
  const charts = {};
  const PHOTO_WEEKS = 2;   // weeks that keep photos in the published file

  // ---------------- docx reading ----------------
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const norm = s => clean(s).toLowerCase();

  function unzip(buf) {
    const c = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' });
    const get = p => { const i = c.FullPaths.findIndex(x => x.endsWith('/' + p)); return i < 0 ? null : c.FileIndex[i].content; };
    return { get };
  }
  const kids = (el, name) => [...el.childNodes].filter(n => n.nodeType === 1 && n.localName === name);
  const attr = (el, name) => el ? (el.getAttributeNS(W_NS, name) ?? el.getAttribute('w:' + name)) : null;
  function textOf(el) {
    let s = '';
    el.querySelectorAll('*').forEach(n => {
      if (n.localName === 't') s += n.textContent;
      else if (n.localName === 'tab') s += ' ';
      else if (n.localName === 'br' || n.localName === 'cr') s += '\n';
    });
    return s;
  }
  // a cell's text keeping paragraph breaks
  const cellText = tc => kids(tc, 'p').map(p => clean(textOf(p))).filter(Boolean).join('\n') || clean(textOf(tc));

  function readBlocks(doc, rels) {
    const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
    const out = [];
    const walk = parent => {
      for (const el of [...parent.childNodes]) {
        if (el.nodeType !== 1) continue;
        if (el.localName === 'p') {
          const ppr = kids(el, 'pPr')[0];
          const st = ppr && kids(ppr, 'pStyle')[0];
          const style = st ? attr(st, 'val') || '' : '';
          const list = !!(ppr && kids(ppr, 'numPr').length);
          const imgs = [];
          el.querySelectorAll('*').forEach(n => { if (n.localName === 'blip') { const id = n.getAttributeNS(R_NS, 'embed') || n.getAttribute('r:embed'); if (id && rels[id]) imgs.push(rels[id]); } });
          out.push({ k: 'p', t: clean(textOf(el)), style, list, imgs });
        } else if (el.localName === 'tbl') {
          const imgs = [];
          el.querySelectorAll('*').forEach(n => { if (n.localName === 'blip') { const id = n.getAttributeNS(R_NS, 'embed') || n.getAttribute('r:embed'); if (id && rels[id]) imgs.push(rels[id]); } });
          out.push({ k: 'tbl', rows: readTable(el), imgs });
        } else if (el.localName === 'sdt') {
          const c = kids(el, 'sdtContent')[0];
          if (c) walk(c);
        }
      }
    };
    walk(body);
    return out;
  }
  // expand to a grid: gridSpan repeats the value, vMerge continues the value from above
  function readTable(tbl) {
    const rows = [];
    for (const tr of kids(tbl, 'tr')) {
      const row = [];
      for (const tc of kids(tr, 'tc')) {
        const pr = kids(tc, 'tcPr')[0];
        const gs = pr && kids(pr, 'gridSpan')[0];
        const vm = pr && kids(pr, 'vMerge')[0];
        const span = gs ? parseInt(attr(gs, 'val'), 10) || 1 : 1;
        let v = cellText(tc);
        if (vm && attr(vm, 'val') !== 'restart' && rows.length) v = rows[rows.length - 1][row.length] ?? v;
        for (let i = 0; i < span; i++) row.push(v);
      }
      rows.push(row);
    }
    return rows;
  }

  // ---------------- extraction ----------------
  const num = s => { const m = String(s ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  const pct = s => { const v = num(s); return v === null ? null : v; };
  const dedupe = r => r.filter((v, i) => i === 0 || v !== r[i - 1]);
  const isHeading = b => b.k === 'p' && b.t && (/^heading/i.test(b.style) || /^(berschrift|titre|titolo)/i.test(b.style));
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parseDate(s) {
    s = clean(s);
    let m = /(\d{1,2})[-\s./]([A-Za-z]{3})[A-Za-z]*\.?[-\s./,]*(\d{2,4})/.exec(s);
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return iso(y, MONTHS[m[2].toLowerCase()], +m[1]); }
    m = /([A-Za-z]{3})[A-Za-z]*\s*[-.]?\s*(\d{1,2})[-,\s]+(\d{4})/.exec(s);
    if (m && MONTHS[m[1].toLowerCase()] !== undefined) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
    if (m) return iso(+m[3], +m[2] - 1, +m[1]);
    return null;
  }
  const iso = (y, mo, d) => new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10);
  const fd = s => s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

  function findTable(T, test) { return T.find(t => test(t.rows.map(r => r.map(norm)))); }
  const hasCell = (rows, re, maxRows = 3) => rows.slice(0, maxRows).some(r => r.some(c => re.test(c)));
  const colIndex = (hdr, re) => hdr.findIndex(c => re.test(norm(c)));

  // the published file is public: never carry phone numbers or named contact persons
  const scrub = c => /(\+?966|\b05)\d[\d\s-]{7,}/.test(c) || /^(eng\.?|engr\.?|mr\.?|mrs\.?|ms\.?|dr\.?)\s+[a-z]/i.test(c) ? '—' : c;
  function genericTable(t, drop) {
    const R = t.rows.map(r => r.map(clean));
    if (!R.length) return { title: t.title, head: [], rows: [] };
    const h0 = R[0];
    // a second header row refines merged headers (no numbers, overlaps the first row)
    const h1 = R[1] && R[1].length === h0.length && R[1].filter((c, i) => c === h0[i]).length >= h0.length / 3 && !R[1].some(c => /^\d+(\.\d+)?$/.test(c)) ? R[1] : null;
    const starts = [];
    h0.forEach((c, i) => { if (i === 0 || c !== h0[i - 1] || (h1 && h1[i] !== h1[i - 1])) starts.push(i); });
    const label = i => h1 && h1[i] && h1[i] !== h0[i] ? `${h0[i]} – ${h1[i]}` : h0[i];
    const cols = starts.filter(i => !(drop && drop.test(norm(label(i)))));
    const head = cols.map(label);
    const hdrKey = r => cols.map(i => r[i]).join('|');
    const skip = new Set([hdrKey(h0), h1 ? hdrKey(h1) : null]);
    const rows = [];
    R.slice(h1 ? 2 : 1).forEach(r => {
      if (skip.has(hdrKey(r))) return;
      const v = cols.map(i => scrub(r[i] ?? ''));
      const distinct = [...new Set(v.filter(x => x && x !== '-' && x !== '_'))];
      if (!distinct.length) return;
      // a merged caption row (one or two distinct values spread over many columns) becomes a group header
      if ((distinct.length === 1 && v.filter(Boolean).length > 1) || (distinct.length === 2 && v.length > 5 && v.filter(x => x === distinct[1]).length > v.length / 2)) rows.push({ group: distinct.join(' — ') });
      else rows.push(v);
    });
    return { title: t.title, head, rows };
  }

  function extract(blocks, fileName) {
    // attach nearest heading to each table, collect text sections
    const T = [];
    let heading = '';
    const sections = [];
    let cur = null;
    blocks.forEach((b, i) => {
      if (isHeading(b)) { heading = b.t; cur = { h: b.t, items: [], imgs: [] }; sections.push(cur); return; }
      if (b.k === 'tbl') { T.push({ title: heading, rows: b.rows, idx: i }); if (cur) { cur.items.push({ tbl: T.length - 1 }); cur.imgs.push(...b.imgs.map(src => ({ src, cap: '' }))); } return; }
      if (cur) { if (b.t) cur.items.push({ t: b.t, list: b.list }); if (b.imgs.length) cur.imgs.push(...b.imgs.map(src => ({ src, cap: '' }))); }
    });
    const sec = re => sections.filter(s => re.test(norm(s.h)));
    const W = { file: fileName, imported: new Date().toISOString() };

    // report number & period from the file name, fall back to the document
    const fn = fileName.replace(/[_]+/g, ' ');
    const no = /no\.?\s*(\d+)/i.exec(fn);
    W.no = no ? +no[1] : null;
    const per = /([A-Za-z]{3})\s*(\d{1,2})\s*to\s*([A-Za-z]{3})\s*(\d{1,2})\s*(\d{4})/i.exec(fn);
    if (per) { W.from = iso(+per[5], MONTHS[per[1].toLowerCase()], +per[2]); W.to = iso(+per[5], MONTHS[per[3].toLowerCase()], +per[4]); }

    const tMeta = findTable(T, r => hasCell(r, /cut ?off/));
    if (tMeta) {
      const h = tMeta.rows[0].map(norm), v = tMeta.rows[1] || [];
      const g = re => clean(v[h.findIndex(x => re.test(x))] || '');
      W.meta = { rev: g(/^rev/), cutoff: parseDate(g(/cut ?off/)), desc: g(/description/), prepared: g(/prepared/), checked: g(/checked/), approved: g(/approved/) };
      const wk = /wk\s*(\d+)/i.exec(W.meta.desc);
      if (wk) W.wk = +wk[1];
      if (!W.to && W.meta.cutoff) W.to = W.meta.cutoff;
    }
    if (W.no === null) W.no = W.wk || null;
    if (!W.from && W.to) W.from = new Date(Date.parse(W.to) - 6 * 864e5).toISOString().slice(0, 10);

    const tInfo = findTable(T, r => r[0] && r[0][0] === 'item' && r[0][1] === 'description' && r.some(x => /contractor/.test(x[0])));
    if (tInfo) W.project = tInfo.rows.slice(1).map(r => [clean(r[0]), clean(r[r.length - 1])]).filter(r => r[0]);

    // executive summary text
    const ex = sec(/executive summary/)[0];
    if (ex) {
      W.exec = [];
      let g = null;
      ex.items.forEach(it => {
        if (it.tbl !== undefined) return;
        const t = it.t;
        if (!it.list && t.length < 70 && !/[.:]$/.test(t) && !/^reporting period/i.test(t)) { g = { h: t, lines: [] }; W.exec.push(g); }
        else { if (!g) { g = { h: 'Summary', lines: [] }; W.exec.push(g); } g.lines.push({ t, list: it.list }); }
      });
      const all = ex.items.map(i => i.t || '').join('\n');
      const rf = re => { const m = re.exec(all); return m ? +m[1] : null; };
      W.rfi = { total: rf(/total rfis? raised:?\s*(\d+)/i), closed: rf(/closed rfis?:?\s*(\d+)/i), open: rf(/open rfis?:?\s*(\d+)/i) };
      const rp = /reporting period:?\s*(.+)/i.exec(all);
      if (rp) W.reportingPeriod = clean(rp[1]);
    }

    // HSE indicators
    const tH = findTable(T, r => hasCell(r, /oh&s weekly|leading and lagging/));
    if (tH) {
      W.hse = [];
      let grp = '', ci = null;
      tH.rows.forEach(r => {
        const c = r.map(clean);
        const iw = c.findIndex(x => /^this week$/i.test(x));
        if (iw >= 0) {
          // column positions from the header row (first grid column of each span)
          ci = { no: 0, lbl: c.findIndex((x, i) => i > 0 && x && x !== c[0]), wk: iw, ytd: c.findIndex(x => /year to date/i.test(x)), ptd: c.findIndex(x => /project to date/i.test(x)) };
          grp = c[ci.lbl]; return;
        }
        if (!ci || !c[ci.lbl] || c[ci.lbl] === c[ci.wk]) return;
        W.hse.push({ no: c[0] === c[ci.lbl] ? '' : c[0], label: c[ci.lbl], wk: c[ci.wk], ytd: c[ci.ytd], ptd: c[ci.ptd], grp });
      });
    }
    const tN = findTable(T, r => r.some(x => /safety ncr|safety sor/.test(x[1] || '')));
    if (tN) W.ncrSor = tN.rows.slice(1).map(r => ({ label: clean(r[1]), total: num(r[2]), closed: num(r[3]), open: num(r[4]) })).filter(r => r.label);

    // overall progress
    const tP = findTable(T, r => hasCell(r, /progress planned/));
    if (tP) {
      const d0 = tP.rows[0][0];
      W.progressDated = parseDate(d0);
      W.progress = tP.rows.filter(r => /[a-z]/i.test(r[0]) && !/description|dated/i.test(r[0])).map(r => {
        const v = dedupe(r.map(clean));
        const vals = r.slice(1).map(clean);
        // columns: Wt, prevPlan, wkPlan, cumPlan, prevAct, wkAct, cumAct, var (after removing span duplicates by grid)
        const g = gridVals(tP.rows, r);
        return { name: clean(r[0]).replace(/\s*%$/, ''), wt: g[0], prevPlan: pct(g[1]), wkPlan: pct(g[2]), cumPlan: pct(g[3]), prevAct: pct(g[4]), wkAct: pct(g[5]), cumAct: pct(g[6]), var: pct(g[7]), raw: v };
      });
    }
    const tS = findTable(T, r => r[0] && r[0][0] === 'planned %' && r[0].includes('actual %'));
    if (tS) { const v = tS.rows[1]; W.summary = { planned: pct(v[0]), actual: pct(v[1]), varWeek: pct(v[2]), varLast: pct(v[3]) }; }
    const tF = findTable(T, r => r[0] && /planned finish/.test(r[0][0]));
    if (tF) { const v = tF.rows[1]; W.finish = { planned: parseDate(v[0]), forecast: parseDate(v[1]), varWeek: clean(v[2]), varLast: clean(v[3]) }; }
    const tD = findTable(T, r => r[0] && /contract duration/.test(r[0][0]));
    if (tD) { const v = tD.rows[1]; W.duration = { contract: num(v[0]), elapsed: num(v[1]), remaining: num(v[2]), forecastRemaining: num(v[3]), elapsedPct: pct(v[4]) }; }
    const tM = findTable(T, r => r[0] && r[0].some(x => /^milestone/.test(x)));
    if (tM) W.milestones = tM.rows.slice(1).map(r => ({ no: clean(r[0]), name: clean(r[1]), pStart: clean(r[2]), pFinish: clean(r[3]), fFinish: clean(r[4]), var: clean(r[5]) })).filter(r => r.name);
    const tQ = findTable(T, r => r[0] && r[0].some(x => /major quantities/.test(x)));
    if (tQ) W.quantities = tQ.rows.slice(1).map(r => {
      const unit = (/(m³|m3|m²|m2|m|ton|nos?|kg|lm)\s*$/i.exec(clean(r[2])) || [])[1] || '';
      return { name: clean(r[1]), boq: num(r[2]), plan: num(r[3]), actual: num(r[4]), unit };
    }).filter(r => r.name);

    // works completed / planned
    const sc = sec(/major works completed/)[0];
    if (sc) { W.completedTitle = sc.h; W.completed = sc.items.filter(i => i.t).map(i => i.t); }
    const tN2 = findTable(T, r => r[0] && r[0].some(x => /activity description/.test(x)) && r[0].some(x => /location|chainage/.test(x)));
    if (tN2) {
      const sp = sec(/planned for next week/)[0];
      W.plannedTitle = sp ? sp.h : 'Major works planned for next week';
      W.planned = tN2.rows.slice(1).map(r => ({ no: clean(r[0]), act: clean(r[1]), loc: clean(r[2]), rem: clean(r[3]) })).filter(r => r.act);
    }
    const tL = findTable(T, r => r[0] && r[0].some(x => /lost/.test(x)));
    if (tL) W.losses = tL.rows.slice(1).map(r => ({ name: clean(r[1]), lost: num(r[2]), rem: clean(r[3]), total: /total/i.test(r[0] + r[1]) })).filter(r => r.name || r.total);

    // manpower & equipment
    const histo = re => {
      const t = findTable(T, r => r[0] && re.test(r[0][0]));
      if (!t) return null;
      const hdr = t.rows[0];
      const dayCols = [];
      hdr.forEach((h, i) => { if (/^\d{1,2}[./-]\d{1,2}/.test(clean(h)) && (i === 0 || hdr[i - 1] !== h)) dayCols.push(i); });
      const totCol = hdr.length - 1;
      const res = { days: dayCols.map(i => clean(hdr[i])), rows: [], totals: {} };
      t.rows.slice(1).forEach(r => {
        const name = clean(r[0]);
        if (!name) return;
        const vals = dayCols.map(i => num(r[i]) ?? 0);
        if (/^total|^average/i.test(name)) res.totals[norm(name)] = { days: vals, total: num(r[totCol]) };
        else res.rows.push({ name, days: vals, total: num(r[totCol]) });
      });
      return res;
    };
    const ind = histo(/^indirect manpower/), dir = histo(/^direct manpower/), eq = histo(/^equipment$/);
    if (ind || dir) {
      const days = (dir || ind).days;
      const sum = h => h ? days.map((_, i) => h.rows.reduce((s, r) => s + (r.days[i] || 0), 0)) : days.map(() => 0);
      const tot = (dir && dir.totals['total manpower']) || (ind && ind.totals['total manpower']);
      const mh = (dir && dir.totals['total manhour']) || (ind && ind.totals['total manhour']);
      const avg = (dir && dir.totals['average manpower']) || (ind && ind.totals['average manpower']);
      W.manpower = { days, indirect: ind ? ind.rows : [], direct: dir ? dir.rows : [], indirectDaily: sum(ind), directDaily: sum(dir),
        totalDaily: tot ? tot.days : null, manhours: mh ? mh.total : null, avg: avg ? avg.days[0] : null };
      const work = days.map((_, i) => i).filter(i => W.manpower.directDaily[i] > 0 && W.manpower.indirectDaily[i] > 0);
      const comb = work.map(i => Math.round(W.manpower.directDaily[i] + W.manpower.indirectDaily[i]));
      W.manpower.combinedAvg = comb.length ? comb.reduce((a, b) => a + b, 0) / comb.length : null;
      W.manpower.combinedPeak = comb.length ? Math.max(...comb) : null;
      const avgOf = a => { const d = work.map(i => a[i]); return d.length ? d.reduce((x, y) => x + y, 0) / d.length : null; };
      W.manpower.directAvg = avgOf(W.manpower.directDaily);
      W.manpower.indirectAvg = avgOf(W.manpower.indirectDaily);
      W.manpower.totalManhours = [...W.manpower.direct, ...W.manpower.indirect].reduce((a, r) => a + (r.total || 0), 0);
    }
    if (eq) {
      const tot = eq.totals['total equipment'], hrs = eq.totals['total equipment-hour'] || eq.totals['total equipment hour'], avg = eq.totals['average equipment'];
      W.equipment = { days: eq.days, rows: eq.rows, totalDaily: tot ? tot.days : null, hours: hrs ? hrs.total : null, avg: avg ? avg.days[0] : null };
    }

    // engineering / permits / procurement / quality / issues / risks
    const tSD = findTable(T, r => r[0] && r[0].some(x => /drawing \/ package title|drawing title/.test(x)));
    if (tSD) W.shopDrawings = genericTable(tSD);
    const tDel = findTable(T, r => r[0] && r[0].some(x => /project deliverables/.test(x)));
    if (tDel) {
      const g = genericTable(tDel);
      const ni = g.head.findIndex(x => /deliverable/i.test(x));
      W.deliverables = { head: g.head.slice(ni + 1), rows: g.rows.filter(r => !r.group).map(r => ({ name: r[ni] || r[0], total: /total/i.test(r.join(' ')), vals: r.slice(ni + 1).map(num) })) };
      W.deliverables.rows.forEach(r => { if (r.total) r.name = 'Total'; });
    }
    W.permits = T.filter(t => hasCell(t.rows.map(r => r.map(norm)), /required license|permit, noc/)).map(t => genericTable(t, /contact/));
    const tPq = findTable(T, r => r[0] && r[0].some(x => /submission type/.test(x)));
    if (tPq) W.procurement = genericTable(tPq);
    const tQa = findTable(T, r => r[0] && r[0].some(x => /done for the week/.test(x)));
    if (tQa) W.qaActivities = tQa.rows.slice(1).map(r => ({ name: clean(r[1]), wk: num(r[2]), cum: num(r[3]), det: clean(r[4]) })).filter(r => r.name);
    const tNc = findTable(T, r => r[0] && r[0].some(x => /mechanism type/.test(x)));
    if (tNc) W.qaNcr = tNc.rows.slice(1).map(r => ({ name: clean(r[0]), wk: num(r[1]), total: num(r[2]), open: num(r[3]), closed: num(r[4]), det: clean(r[5]) })).filter(r => r.name && (r.total !== null || r.wk !== null));
    const tW = findTable(T, r => r[0] && /discipline wise/.test(r[0][0]));
    if (tW) W.wir = tW.rows.filter(r => clean(r[0]) && !/discipline wise/i.test(r[0])).map(r => { const g = gridVals(tW.rows, r, 1); return { name: clean(r[0]), wk: g.slice(0, 4).map(num), cum: g.slice(4, 8).map(num), cdPct: clean(g[8]), reason: clean(g[9] || '') }; });
    const tT = findTable(T, r => r[0] && /type of tests/.test(r[0][0]));
    if (tT) W.tests = tT.rows.filter(r => clean(r[0]) && !/type of tests/i.test(r[0])).map(r => { const g = gridVals(tT.rows, r, 1); return { name: clean(r[0]), wk: g.slice(0, 3).map(num), cum: g.slice(3, 6).map(num), failPct: clean(g[6]), reason: clean(g[7] || '') }; });
    const tI = findTable(T, r => r[0] && r[0].some(x => /action required/.test(x)));
    if (tI) {
      W.issues = [];
      let cat = '';
      tI.rows.slice(1).forEach(r => {
        const g = gridVals(tI.rows, r, 0).map(clean);
        const distinct = [...new Set(g.filter(x => x && x !== '-'))];
        if (!distinct.length) return;
        if (distinct.length === 1) { cat = distinct[0]; return; }
        W.issues.push({ cat, desc: g[0], action: g[1], by: g[2], rem: g[3] });
      });
    }
    const tR = findTable(T, r => r[0] && /key risk/.test(r[0][0]));
    if (tR) W.risks = tR.rows.slice(1).map(r => ({ risk: clean(r[0]), impact: clean(r[1]), mitigation: (r[2] || '').split(/\n|\s\*\s?|^\*/).map(clean).filter(Boolean), owner: clean(r[3]), status: clean(r[4]) })).filter(r => r.risk);

    // images
    const ph = sec(/photograph/);
    W.photoRefs = ph.flatMap(s => s.imgs.map(i => i.src));
    const sci = sec(/s-curve|s curve/);
    W.scurveRefs = sci.flatMap(s => s.imgs.map(i => i.src));

    // everything as raw tables too (nothing lost if the template changes)
    W.tables = T.map(t => genericTable(t, /contact/)).filter(t => t.rows.length);
    return W;
  }
  // values of a row by distinct header grid columns (skips span duplicates using the first header row)
  function gridVals(rows, r, from = 1) {
    const out = [];
    for (let i = from; i < r.length; i++) {
      const dupRow = r[i] === r[i - 1];
      const dupHdr = rows.slice(0, 3).every(h => h[i] === h[i - 1]);
      if (i > from && dupRow && dupHdr) continue;
      out.push(r[i]);
    }
    return out;
  }

  async function imagesFor(z, rels, refs, max, size) {
    const out = [];
    for (const ref of refs.slice(0, max)) {
      const bytes = z.get('word/' + ref.replace(/^\.?\//, '').replace(/^word\//, ''));
      if (!bytes) continue;
      const type = /\.png$/i.test(ref) ? 'image/png' : /\.(jpe?g)$/i.test(ref) ? 'image/jpeg' : /\.gif$/i.test(ref) ? 'image/gif' : null;
      if (!type) continue;
      try {
        const bmp = await createImageBitmap(new Blob([bytes], { type }));
        const s = Math.min(1, size / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(bmp, 0, 0, c.width, c.height);
        out.push(c.toDataURL('image/jpeg', 0.62));
      } catch (e) { /* unsupported image */ }
    }
    return out;
  }

  async function parseDocx(file) {
    const buf = await file.arrayBuffer();
    const z = unzip(buf);
    const docXml = z.get('word/document.xml');
    if (!docXml) throw new Error('Not a Word .docx file (word/document.xml missing).');
    const relXml = z.get('word/_rels/document.xml.rels');
    const dec = new TextDecoder('utf-8');
    const rels = {};
    if (relXml) {
      const rd = new DOMParser().parseFromString(dec.decode(relXml), 'application/xml');
      [...rd.getElementsByTagName('Relationship')].forEach(r => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
    }
    const doc = new DOMParser().parseFromString(dec.decode(docXml), 'application/xml');
    const blocks = readBlocks(doc, rels);
    const W = extract(blocks, file.name);
    W.photos = (await imagesFor(z, rels, W.photoRefs, 40, 1100)).map(src => ({ src }));
    W.scurve = await imagesFor(z, rels, W.scurveRefs, 2, 1400);
    delete W.photoRefs; delete W.scurveRefs;
    return W;
  }

  // ---------------- storage ----------------
  const DB = 'trd_weekly', STORE = 'kv';
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function idbGet(k) { try { const d = await idb(); return await new Promise(r => { const q = d.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); } catch (e) { return null; } }
  async function idbSet(k, v) { try { const d = await idb(); await new Promise(r => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(v, k); tx.oncomplete = r; tx.onerror = r; }); } catch (e) { } }
  async function idbDel(k) { try { const d = await idb(); await new Promise(r => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(k); tx.oncomplete = r; tx.onerror = r; }); } catch (e) { } }

  let WEEKS = [];     // sorted by report date ascending
  let SEL = null;     // selected week key
  const key = w => String(w.no ?? w.to ?? w.file);
  const sortWeeks = () => WEEKS.sort((a, b) => (a.to || '').localeCompare(b.to || '') || (a.no || 0) - (b.no || 0));
  function upsert(w) {
    const k = key(w);
    const i = WEEKS.findIndex(x => key(x) === k);
    if (i >= 0) WEEKS[i] = w; else WEEKS.push(w);
    sortWeeks();
  }
  function forPublish() {
    const keepPhotos = new Set(WEEKS.slice(-PHOTO_WEEKS).map(key));
    return { v: 1, exported: new Date().toISOString(), weeks: WEEKS.map(w => keepPhotos.has(key(w)) ? w : { ...w, photos: [], photosDropped: (w.photos || []).length }) };
  }

  // hook for app.js: physical progress points from the reports
  window.WEEKLY = {
    perfPoints: () => {
      const pts = [];
      WEEKS.forEach(w => {
        const d = w.progressDated || w.to;
        if (d && w.summary && w.summary.planned !== null) pts.push({ date: d, planned: w.summary.planned, actual: w.summary.actual, remarks: 'Weekly report No.' + (w.no ?? '') });
      });
      return pts;
    }
  };

  // ---------------- rendering ----------------
  const card = (title, body, extra = '', attrs = '') => `<div class="card" ${attrs}><div class="card-h"><h3>${title}</h3>${extra}</div>${body}</div>`;
  const K = (lbl, val, hint, k, bar, extra = '') => `<div class="kpi" data-wk="${k}" tabindex="0"><div class="lbl">${lbl}</div><div class="val">${val}</div>${hint ? `<div class="hint">${hint}</div>` : ''}${bar !== undefined && bar !== null ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, bar))}%"></i></div>` : ''}${extra}</div>`;
  const tbl = (head, rows, cls = '') => `<div class="table-wrap"><table class="tbl ${cls}"><thead><tr>${head.map(h => `<th class="${h[1] ? 'n' : ''}">${h[0]}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="muted">None reported</td></tr>`}</tbody></table></div>`;
  const gTable = (g, clickable) => g ? tbl(g.head.map(h => [esc(h)]), g.rows.map((r, i) => r.group ? `<tr class="g-grp"><td colspan="${g.head.length}"><b>${esc(r.group)}</b></td></tr>` : `<tr ${clickable ? `class="click" data-wrow="${clickable}|${i}"` : ''}>${r.map(c => `<td>${esc(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`)) : '';
  const varCls = v => v === null || v === undefined ? '' : v < 0 ? 'neg' : 'pos';
  const sgn = v => v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  const status = s => { const k = norm(s); const c = /close|done|approved|complete/.test(k) ? 'good' : /open|pending|follow/.test(k) ? 'warn' : /reject|overdue|critical/.test(k) ? 'bad' : 'na'; return s ? `<span class="status ${c}">${esc(s)}</span>` : ''; };

  function weekLabel(w) { return `No.${w.no ?? '—'}${w.wk ? ' (Wk' + w.wk + ')' : ''} · ${fd(w.from)} – ${fd(w.to)}`; }

  function render() {
    const host = $('#wkBody');
    if (!host) return;
    const sel = $('#wkSel');
    if (!WEEKS.length) {
      sel.innerHTML = '';
      $('#wkKpis').innerHTML = '';
      host.innerHTML = `<div class="card empty"><h3>No weekly report published yet</h3><p class="admin-only">Go to <b>Import File</b> and drop the contractor’s weekly report (<code>.docx</code>). Every week adds a new report; trends build up automatically.</p><button class="btn admin-only" onclick="APP.showTab('import')">Open Import</button></div>`;
      return;
    }
    if (!SEL || !WEEKS.some(w => key(w) === SEL)) SEL = key(WEEKS[WEEKS.length - 1]);
    sel.innerHTML = [...WEEKS].reverse().map(w => `<option value="${esc(key(w))}" ${key(w) === SEL ? 'selected' : ''}>${esc(weekLabel(w))}</option>`).join('');
    const w = WEEKS.find(x => key(x) === SEL);
    const idx = WEEKS.indexOf(w), prev = WEEKS[idx - 1];
    $('#wkMeta').innerHTML = w.meta ? `Cut-off ${fd(w.meta.cutoff)} · ${esc(w.meta.desc || '')} · Prepared ${esc(w.meta.prepared)} · Checked ${esc(w.meta.checked)} · Approved ${esc(w.meta.approved)}` : esc(w.file);

    const s = w.summary || {}, f = w.finish || {}, d = w.duration || {}, mp = w.manpower || {}, eq = w.equipment || {};
    const hse = lbl => (w.hse || []).find(h => new RegExp(lbl, 'i').test(h.label));
    const safe = hse('safe man'), lti = hse('lost time'), nm = hse('near miss');
    const slip = f.planned && f.forecast ? Math.round((Date.parse(f.forecast) - Date.parse(f.planned)) / 864e5) : null;
    const dTot = mp.totalDaily ? mp.totalDaily.filter(Boolean) : [];
    $('#wkKpis').innerHTML = [
      K('Actual progress', fmtP(s.actual), `Planned ${fmtP(s.planned)} · var ${sgn(s.varWeek)} (last week ${sgn(s.varLast)})`, 'progress', s.actual),
      K('Weekly progress', `${fmtP((w.progress || [])[0]?.wkAct)}`, `Planned this week ${fmtP((w.progress || [])[0]?.wkPlan)}`, 'progress'),
      K('Forecast finish', fd(f.forecast), f.planned ? `Planned ${fd(f.planned)}${slip !== null ? ' · ' + (slip > 0 ? '+' : '') + slip + ' d' : ''}` : '', 'dates'),
      K('Time elapsed', fmtP(d.elapsedPct, 1), d.contract ? `${d.elapsed} of ${d.contract} days · ${d.remaining} left` : '', 'dates', d.elapsedPct),
      K('Manpower (avg/day)', mp.combinedAvg ? Math.round(mp.combinedAvg).toLocaleString() : mp.avg ? Math.round(mp.avg).toLocaleString() : '—', mp.combinedAvg ? `Direct ${Math.round(mp.directAvg || 0).toLocaleString()} · indirect ${Math.round(mp.indirectAvg || 0).toLocaleString()} · peak ${mp.combinedPeak.toLocaleString()}` : '', 'manpower'),
      K('Equipment (avg)', eq.avg ? Math.round(eq.avg).toLocaleString() : '—', eq.hours ? fmt(eq.hours, 0) + ' equipment-hours' : '', 'equipment'),
      K('Safety', safe ? fmt(num(safe.ptd), 0) : '—', `Safe man-hours to date · LTI ${lti ? lti.ptd : '—'} · near miss ${nm ? nm.wk : '—'} this week`, 'hse'),
      K('Open items', `${w.rfi?.open ?? '—'} RFIs`, `NCR open ${(w.qaNcr || []).reduce((a, r) => a + (r.open || 0), 0) + (w.ncrSor || []).filter(r => /ncr/i.test(r.label)).reduce((a, r) => a + (r.open || 0), 0)} · risks ${(w.risks || []).length}`, 'open')
    ].join('');

    const prog = w.progress || [];
    const progRows = prog.map((r, i) => `<tr class="click" data-wprog="${i}"><td><b>${esc(r.name)}</b></td><td class="n">${fmtP(r.prevPlan)}</td><td class="n">${fmtP(r.wkPlan)}</td><td class="n"><b>${fmtP(r.cumPlan)}</b></td><td class="n">${fmtP(r.prevAct)}</td><td class="n">${fmtP(r.wkAct)}</td><td class="n"><b>${fmtP(r.cumAct)}</b></td><td class="n ${varCls(r.var)}">${sgn(r.var)}</td>
      <td><div class="pbar"><div class="t"><i style="width:${Math.min(100, r.cumAct || 0)}%"></i>${r.cumPlan !== null ? `<span class="pl" style="left:${Math.min(100, r.cumPlan)}%"></span>` : ''}</div></div></td></tr>`);
    const q = w.quantities || [];
    const qRows = q.map((r, i) => {
      const a = r.boq ? r.actual / r.boq * 100 : 0, p = r.boq ? r.plan / r.boq * 100 : 0;
      return `<div class="qrow click" data-wq="${i}"><div class="qh"><b>${esc(r.name)}</b><span class="muted">${fmt(r.actual, 0)} / ${fmt(r.boq, 0)} ${esc(r.unit)}</span></div>
        <div class="pbar"><div class="t"><i style="width:${Math.min(100, a)}%"></i><span class="pl" style="left:${Math.min(100, p)}%" title="Planned ${fmtP(p, 1)}"></span></div><span>${fmtP(a, 1)}</span></div>
        <div class="muted small">Planned to date ${fmt(r.plan, 0)} ${esc(r.unit)} (${fmtP(p, 1)}) · ${r.actual >= r.plan ? '<span class="pos">ahead</span>' : `<span class="neg">behind by ${fmt(r.plan - r.actual, 0)} ${esc(r.unit)}</span>`}</div></div>`;
    });
    const loss = (w.losses || []).filter(r => !r.total);
    const lossTot = (w.losses || []).find(r => r.total);

    host.innerHTML =
      `<div class="grid g-2-1">` +
      card(`Overall progress${w.progressDated ? ' — dated ' + fd(w.progressDated) : ''}`, tbl([['Area'], ['Prev. planned', 1], ['Week planned', 1], ['Cum. planned', 1], ['Prev. actual', 1], ['Week actual', 1], ['Cum. actual', 1], ['Var', 1], ['Progress']], progRows), '<span class="muted">Click a row</span>') +
      card('Planned vs actual', '<div class="chart-box"><canvas id="wkProg"></canvas></div>') + `</div>` +
      (w.scurve && w.scurve.length ? card('Overall progress S-curve (from the report)', `<div class="wk-img click" data-wimg="scurve|0"><img src="${w.scurve[0]}" alt="S-curve"></div>`) : '') +
      `<div class="grid g-1-1">` +
      card('Major quantities', qRows.join('') || '<p class="muted">None reported</p>', '<span class="muted">Bar = actual · marker = planned</span>') +
      card('Losses due to external constraints', tbl([['Activity'], ['Lost %', 1], ['Remarks']], loss.map((r, i) => `<tr class="click" data-wloss="${i}"><td>${esc(r.name)}</td><td class="n neg">${fmt(r.lost, 2)}</td><td>${esc(r.rem)}</td></tr>`)) + (lossTot ? `<p class="muted">Total lost: <b class="neg">${fmt(lossTot.lost, 2)}%</b></p>` : '') +
        `<div class="chart-box sm"><canvas id="wkLoss"></canvas></div>`) + `</div>` +
      `<div class="grid g-1-1">` +
      card(esc(w.completedTitle || 'Major works completed this week'), `<ol class="wk-list">${(w.completed || []).map((t, i) => `<li class="click" data-wdone="${i}">${esc(t)}</li>`).join('') || '<li class="muted">None reported</li>'}</ol>`) +
      card(esc(w.plannedTitle || 'Major works planned for next week'), tbl([['#'], ['Activity'], ['Location / chainage']], (w.planned || []).map((r, i) => `<tr class="click" data-wplan="${i}"><td>${esc(r.no)}</td><td>${esc(r.act)}</td><td>${esc(r.loc)}</td></tr>`))) + `</div>` +
      card('Manpower & equipment', `<div class="grid g-1-1 inner"><div><div class="chart-box"><canvas id="wkMp"></canvas></div></div><div><div class="chart-box"><canvas id="wkTrades"></canvas></div></div></div><div class="chart-box"><canvas id="wkEq"></canvas></div>`, '<span class="muted">Click a bar for details</span>') +
      `<div class="grid g-1-1">` +
      card('Health, safety & environment', hseBlock(w)) +
      card('Quality', qualityBlock(w)) + `</div>` +
      card('Engineering', engBlock(w)) +
      (w.permits && w.permits.length ? card('Authority approvals, NOCs & permits', w.permits.map((g, i) => gTable(g, 'permit' + i)).join('<div style="height:10px"></div>'), '<span class="muted">Contact details are not published</span>') : '') +
      (w.procurement ? card('Procurement — pre-qualifications', gTable(w.procurement, 'proc')) : '') +
      `<div class="grid g-1-1">` +
      card('Critical issues', (w.issues && !w.issues.length ? '<p class="muted">No critical issues reported this week.</p>' : '') + tbl([['Area'], ['Description'], ['Action required'], ['By']], (w.issues || []).map((r, i) => `<tr class="click" data-wissue="${i}"><td>${esc(r.cat)}</td><td>${esc(r.desc)}</td><td>${esc(r.action)}</td><td>${esc(r.by)}</td></tr>`))) +
      card('Key risks', tbl([['Risk'], ['Impact'], ['Owner'], ['Status']], (w.risks || []).map((r, i) => `<tr class="click" data-wrisk="${i}"><td><b>${esc(r.risk)}</b></td><td>${esc(r.impact)}</td><td>${esc(r.owner)}</td><td>${status(r.status)}</td></tr>`))) + `</div>` +
      (w.photos && w.photos.length ? card(`Progress photographs (${w.photos.length})`, `<div class="wk-photos">${w.photos.map((p, i) => `<div class="wk-ph click" data-wimg="photos|${i}"><img loading="lazy" src="${p.src}" alt="Site photo ${i + 1}"></div>`).join('')}</div>`) : w.photosDropped ? card('Progress photographs', `<p class="muted">${w.photosDropped} photos were in this report; the published file keeps photos for the latest ${PHOTO_WEEKS} weeks only.</p>`) : '') +
      card('Trends across weekly reports', `<div class="grid g-1-1 inner"><div class="chart-box"><canvas id="wkTrend"></canvas></div><div class="chart-box"><canvas id="wkTrendMp"></canvas></div></div>${WEEKS.length < 2 ? '<p class="muted small">Planned/actual include last week’s figures from this report. Manpower and equipment trends grow as you import each week.</p>' : ''}`) +
      card('Executive summary', execBlock(w), '<button class="btn ghost" id="wkExecToggle">Show / hide</button>', 'id="wkExecCard"') +
      card(`All tables in the report (${(w.tables || []).length})`, `<div id="wkAll" class="hidden">${(w.tables || []).map((t, i) => `<details class="wk-raw"><summary>${esc(t.title || 'Table ' + (i + 1))} <span class="muted">· ${t.rows.length} rows</span></summary>${gTable(t)}</details>`).join('')}</div>`, '<button class="btn ghost" id="wkAllToggle">Show / hide</button>');

    $('#wkAllToggle').onclick = () => $('#wkAll').classList.toggle('hidden');
    $('#wkExecToggle').onclick = () => $('#wkExec').classList.toggle('hidden');
    drawCharts(w);
  }

  function hseBlock(w) {
    const rows = (w.hse || []).map((h, i) => `<tr class="click" data-whse="${i}"><td class="muted">${esc(h.no)}</td><td>${esc(h.label)}</td><td class="n">${esc(h.wk)}</td><td class="n">${esc(h.ytd)}</td><td class="n">${esc(h.ptd)}</td></tr>`);
    const ns = (w.ncrSor || []).map(r => `<div class="dtile"><div class="lbl">${esc(r.label)}</div><div class="v">${r.open} open</div><div class="muted small">${r.closed} closed of ${r.total}</div></div>`).join('');
    return (ns ? `<div class="dtiles">${ns}</div>` : '') + tbl([['#'], ['Indicator'], ['Week', 1], ['YTD', 1], ['Project', 1]], rows);
  }
  function qualityBlock(w) {
    const wir = (w.wir || []).map((r, i) => `<tr class="click" data-wwir="${i}"><td><b>${esc(r.name)}</b></td><td class="n">${r.wk[0] ?? '—'}</td><td class="n">${r.cum[0] ?? '—'}</td><td class="n">${r.cum[1] ?? '—'}</td><td class="n">${r.cum[2] ?? '—'}</td><td class="n ${num(r.cdPct) > 20 ? 'neg' : ''}">${esc(r.cdPct)}</td></tr>`);
    const tests = (w.tests || []).filter(t => t.wk.some(v => v) || t.cum.some(v => v)).map(t => `<tr><td>${esc(t.name)}</td><td class="n">${t.wk[0] ?? '—'}</td><td class="n">${t.cum[0] ?? '—'}</td><td class="n">${t.cum[2] ?? '—'}</td><td>${esc(t.reason)}</td></tr>`);
    const ncr = (w.qaNcr || []).map(r => `<div class="dtile"><div class="lbl">NCR — ${esc(r.name)}</div><div class="v">${r.open ?? 0} open</div><div class="muted small">${r.closed ?? 0} closed of ${r.total ?? 0}${r.wk ? ' · ' + r.wk + ' this week' : ''}</div></div>`).join('');
    const act = (w.qaActivities || []).map(r => `<div class="dtile"><div class="lbl">${esc(r.name)}</div><div class="v">${r.wk ?? 0}</div><div class="muted small">${r.cum ?? '—'} to date</div></div>`).join('');
    return `<div class="dtiles">${ncr}${act}</div><h4 class="dsec">Work inspection requests (WIR)</h4>` + tbl([['Discipline'], ['Week', 1], ['Total', 1], ['A & B', 1], ['C & D', 1], ['% C & D', 1]], wir) + `<h4 class="dsec">Tests</h4>` + tbl([['Test'], ['Week', 1], ['Total', 1], ['Failed', 1], ['Reason']], tests);
  }
  function engBlock(w) {
    const del = w.deliverables;
    const r = w.rfi || {};
    const tiles = `<div class="dtiles"><div class="dtile click" data-wk="rfi"><div class="lbl">RFIs raised</div><div class="v">${r.total ?? '—'}</div><div class="muted small">${r.closed ?? '—'} closed · <b class="neg">${r.open ?? '—'} open</b></div></div>` +
      (del ? del.rows.filter(x => x.total).map(x => `<div class="dtile"><div class="lbl">Deliverables submitted</div><div class="v">${x.vals[0] ?? '—'}</div><div class="muted small">${x.vals[del.head.length - 1] ?? '—'} under review</div></div>`).join('') : '') +
      (w.shopDrawings ? `<div class="dtile"><div class="lbl">Shop drawings this week</div><div class="v">${w.shopDrawings.rows.length}</div></div>` : '') + `</div>`;
    return tiles + `<div class="grid g-1-1 inner"><div class="chart-box"><canvas id="wkDel"></canvas></div><div>${del ? tbl([['Deliverable'], ...del.head.map(h => [esc(h), 1])], del.rows.map(x => `<tr ${x.total ? 'class="tot"' : ''}><td>${esc(x.name)}</td>${x.vals.map(v => `<td class="n">${v ?? '—'}</td>`).join('')}</tr>`)) : ''}</div></div>` +
      (w.shopDrawings ? `<h4 class="dsec">Shop drawings</h4>` + gTable(w.shopDrawings, 'sd') : '');
  }
  function execBlock(w) {
    return `<div id="wkExec" class="hidden wk-exec">${(w.exec || []).map(g => `<h4 class="dsec">${esc(g.h)}</h4>${g.lines.some(l => l.list) ? '<ul>' + g.lines.map(l => `<li>${esc(l.t)}</li>`).join('') + '</ul>' : g.lines.map(l => `<p>${esc(l.t)}</p>`).join('')}`).join('')}</div>`;
  }

  function drawCharts(w) {
    const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const base = A.baseOpts;
    const S1 = col('--s1'), S2 = col('--s2'), S3 = col('--s3'), S4 = col('--s4');
    const mk = (id, cfg, pick) => {
      if (charts[id]) charts[id].destroy();
      const el = document.getElementById(id);
      if (!el) return;
      if (pick) {
        cfg.options.onClick = (e, els) => { if (els.length) { A.markPicked(); pick(els[0].index, els[0].datasetIndex); } };
        cfg.options.onHover = (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
      }
      charts[id] = new Chart(el, cfg);
    };
    const prog = (w.progress || []).filter(r => r.cumPlan !== null || r.cumAct !== null);
    mk('wkProg', {
      type: 'bar', data: { labels: prog.map(r => r.name.replace(/overall progress/i, 'Overall')), datasets: [
        { label: 'Planned', data: prog.map(r => r.cumPlan), backgroundColor: S2, borderRadius: 4, maxBarThickness: 18 },
        { label: 'Actual', data: prog.map(r => r.cumAct), backgroundColor: S1, borderRadius: 4, maxBarThickness: 18 }] },
      options: base({ indexAxis: 'y', interaction: { mode: 'index', axis: 'y', intersect: false }, scales: { y: { grid: { display: false }, ticks: { color: col('--text-2') } }, x: { grid: { color: col('--grid') }, ticks: { color: col('--text-2'), callback: v => v + '%' }, beginAtZero: true, max: 100 } },
        plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${c.dataset.label}: ${fmtP(c.parsed.x)}` } } } })
    }, i => openProg(w, w.progress.indexOf(prog[i])));
    const loss = (w.losses || []).filter(r => !r.total && r.lost);
    mk('wkLoss', {
      type: 'bar', data: { labels: loss.map(r => r.name), datasets: [{ label: 'Lost %', data: loss.map(r => r.lost), backgroundColor: col('--bad'), borderRadius: 4, maxBarThickness: 18 }] },
      options: base({ indexAxis: 'y', plugins: { ...base().plugins, legend: { display: false } }, scales: { y: { grid: { display: false }, ticks: { color: col('--text-2') } }, x: { grid: { color: col('--grid') }, ticks: { color: col('--text-2'), callback: v => v + '%' }, beginAtZero: true } } })
    }, i => openRow('Loss due to external constraint', loss[i], { name: 'Activity', lost: 'Lost %', rem: 'Remarks' }));
    const mp = w.manpower;
    if (mp) {
      const days = mp.days.map((d, i) => ({ d, i })).filter(x => (mp.totalDaily ? mp.totalDaily[x.i] : mp.indirectDaily[x.i] + mp.directDaily[x.i]) > 0);
      mk('wkMp', {
        type: 'bar', data: { labels: days.map(x => x.d), datasets: [
          { label: 'Direct', data: days.map(x => mp.directDaily[x.i]), backgroundColor: S1, stack: 's', maxBarThickness: 34 },
          { label: 'Indirect', data: days.map(x => mp.indirectDaily[x.i]), backgroundColor: S3, stack: 's', borderRadius: 4, maxBarThickness: 34 }] },
        options: base({ scales: { x: { ...base().scales.x, stacked: true }, y: { ...base().scales.y, stacked: true } }, plugins: { ...base().plugins, title: { display: true, text: 'Daily manpower', color: col('--text-2'), align: 'start' } } })
      }, i => openManpower(w, days[i].i));
      const trades = [...mp.direct, ...mp.indirect].sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 10);
      mk('wkTrades', {
        type: 'bar', data: { labels: trades.map(t => t.name), datasets: [{ label: 'Man-hours this week', data: trades.map(t => t.total), backgroundColor: S1, borderRadius: 4, maxBarThickness: 16 }] },
        options: base({ indexAxis: 'y', plugins: { ...base().plugins, legend: { display: false }, title: { display: true, text: 'Top 10 trades by man-hours', color: col('--text-2'), align: 'start' } }, scales: { y: { grid: { display: false }, ticks: { color: col('--text-2') } }, x: { grid: { color: col('--grid') }, ticks: { color: col('--text-2') }, beginAtZero: true } } })
      }, i => openTrade(w, trades[i]));
    }
    const eq = w.equipment;
    if (eq) {
      const top = [...eq.rows].sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 14);
      mk('wkEq', {
        type: 'bar', data: { labels: top.map(t => t.name), datasets: [{ label: 'Equipment-hours this week', data: top.map(t => t.total), backgroundColor: S4, borderRadius: 4, maxBarThickness: 30 }] },
        options: base({ plugins: { ...base().plugins, legend: { display: false }, title: { display: true, text: 'Equipment by type (hours this week)', color: col('--text-2'), align: 'start' } }, scales: { x: { ...base().scales.x, ticks: { color: col('--text-2'), autoSkip: false, maxRotation: 50, minRotation: 30 } }, y: base().scales.y } })
      }, i => openTrade(w, top[i], true));
    }
    const del = w.deliverables;
    if (del) {
      const rows = del.rows.filter(x => !x.total && x.vals[0]);
      const cats = del.head.slice(1);
      const palette = [S3, S4, col('--bad'), col('--muted'), S1, S2];
      mk('wkDel', {
        type: 'bar', data: { labels: rows.map(r => r.name), datasets: cats.map((c, j) => ({ label: c, data: rows.map(r => r.vals[j + 1] || 0), backgroundColor: palette[j % palette.length], stack: 's', maxBarThickness: 18 })) },
        options: base({ indexAxis: 'y', scales: { y: { stacked: true, grid: { display: false }, ticks: { color: col('--text-2') } }, x: { stacked: true, grid: { color: col('--grid') }, ticks: { color: col('--text-2') }, beginAtZero: true } }, plugins: { ...base().plugins, legend: { position: 'bottom', labels: { color: col('--text-2'), boxWidth: 10 } } } })
      });
    }
    // trends
    const pts = [];
    WEEKS.forEach((x, i) => {
      const s = x.summary || {}, p0 = (x.progress || [])[0] || {};
      if (i === 0 && p0.prevPlan !== null && p0.prevPlan !== undefined) pts.push({ l: 'Prev. of No.' + (x.no ?? ''), p: p0.prevPlan, a: p0.prevAct });
      pts.push({ l: 'No.' + (x.no ?? '') + ' ' + fd(x.progressDated || x.to).slice(0, 6), p: s.planned ?? p0.cumPlan, a: s.actual ?? p0.cumAct, k: key(x) });
    });
    mk('wkTrend', {
      type: 'line', data: { labels: pts.map(p => p.l), datasets: [
        { label: 'Planned %', data: pts.map(p => p.p), borderColor: S2, backgroundColor: S2, borderDash: [6, 4], borderWidth: 2, pointRadius: 4 },
        { label: 'Actual %', data: pts.map(p => p.a), borderColor: S1, backgroundColor: S1, borderWidth: 2.5, pointRadius: 4 }] },
      options: base({ scales: { x: base().scales.x, y: { ...base().scales.y, ticks: { color: col('--text-2'), callback: v => v + '%' } } }, plugins: { ...base().plugins, title: { display: true, text: 'Overall progress by report', color: col('--text-2'), align: 'start' } } })
    }, i => { if (pts[i].k) { SEL = pts[i].k; render(); } });
    mk('wkTrendMp', {
      type: 'line', data: { labels: WEEKS.map(x => 'No.' + (x.no ?? '')), datasets: [
        { label: 'Avg manpower', data: WEEKS.map(x => x.manpower?.combinedAvg ?? x.manpower?.avg ?? null), borderColor: S1, backgroundColor: S1, borderWidth: 2.5, pointRadius: 4 },
        { label: 'Avg equipment', data: WEEKS.map(x => x.equipment?.avg ?? null), borderColor: S4, backgroundColor: S4, borderWidth: 2.5, pointRadius: 4 }] },
      options: base({ plugins: { ...base().plugins, title: { display: true, text: 'Resources by report', color: col('--text-2'), align: 'start' } } })
    }, i => { SEL = key(WEEKS[i]); render(); });
  }

  // ---------------- details ----------------
  const cur = () => WEEKS.find(x => key(x) === SEL);
  const tiles = arr => `<div class="dtiles">${arr.filter(Boolean).map(([l, v, h]) => `<div class="dtile"><div class="lbl">${l}</div><div class="v">${v}</div>${h ? `<div class="muted small">${h}</div>` : ''}</div>`).join('')}</div>`;
  function openRow(title, obj, labels) {
    A.Details.open(() => ({ title, sub: weekLabel(cur()), body: tiles(Object.keys(labels).map(k => [labels[k], Array.isArray(obj[k]) ? obj[k].map(esc).join('<br>• ') : esc(obj[k] ?? '—')])) }));
  }
  function openProg(w, i) {
    const r = w.progress[i];
    A.Details.open(() => ({
      title: `${esc(r.name)} — progress`, sub: weekLabel(w) + (w.progressDated ? ' · dated ' + fd(w.progressDated) : ''),
      body: tiles([['Cum. planned', fmtP(r.cumPlan)], ['Cum. actual', fmtP(r.cumAct)], ['Variance', `<span class="${varCls(r.var)}">${sgn(r.var)}</span>`],
        ['Planned last week', fmtP(r.prevPlan)], ['Actual last week', fmtP(r.prevAct)], ['Planned this week', fmtP(r.wkPlan)], ['Achieved this week', fmtP(r.wkAct)],
        ['Weekly performance', r.wkPlan ? (r.wkAct / r.wkPlan).toFixed(2) : '—', 'Achieved ÷ planned this week'], ['Cumulative SPI', r.cumPlan ? (r.cumAct / r.cumPlan).toFixed(2) : '—']]) +
        `<h4 class="dsec">Across imported reports</h4>` + tbl([['Report'], ['Cum. planned', 1], ['Cum. actual', 1], ['Var', 1], ['Week actual', 1]],
          WEEKS.map(x => (x.progress || []).find(p => norm(p.name) === norm(r.name))).map((p, j) => p ? `<tr><td>${esc(weekLabel(WEEKS[j]))}</td><td class="n">${fmtP(p.cumPlan)}</td><td class="n">${fmtP(p.cumAct)}</td><td class="n ${varCls(p.var)}">${sgn(p.var)}</td><td class="n">${fmtP(p.wkAct)}</td></tr>` : '').filter(Boolean))
    }));
  }
  function openManpower(w, di) {
    const mp = w.manpower;
    const list = [...mp.direct.map(r => ({ ...r, t: 'Direct' })), ...mp.indirect.map(r => ({ ...r, t: 'Indirect' }))].filter(r => r.days[di]).sort((a, b) => b.days[di] - a.days[di]);
    A.Details.open(() => ({
      title: `Manpower on ${esc(mp.days[di])}`, sub: weekLabel(w),
      body: tiles([['Total', (mp.totalDaily ? mp.totalDaily[di] : mp.directDaily[di] + mp.indirectDaily[di]).toLocaleString()], ['Direct', mp.directDaily[di].toLocaleString()], ['Indirect', mp.indirectDaily[di].toLocaleString()]]) +
        tbl([['Trade / position'], ['Type'], ['Count', 1], ['Week man-hours', 1]], list.map(r => `<tr class="click" data-wtrade="${esc(r.name)}"><td>${esc(r.name)}</td><td>${r.t}</td><td class="n">${r.days[di]}</td><td class="n">${fmt(r.total, 0)}</td></tr>`))
    }));
  }
  function openTrade(w, r, isEq) {
    const days = (isEq ? w.equipment : w.manpower).days;
    A.Details.open(() => ({
      title: esc(r.name), sub: (isEq ? 'Equipment' : 'Manpower') + ' · ' + weekLabel(w),
      body: tiles([[isEq ? 'Equipment-hours' : 'Man-hours', fmt(r.total, 0)], ['Average per day', fmt(r.days.filter(Boolean).reduce((a, b) => a + b, 0) / Math.max(1, r.days.filter(Boolean).length), 1)], ['Peak', Math.max(...r.days)]]) +
        tbl([['Day'], ['Count', 1]], days.map((d, i) => `<tr><td>${esc(d)}</td><td class="n">${r.days[i]}</td></tr>`)) +
        `<h4 class="dsec">Across imported reports</h4>` + tbl([['Report'], [isEq ? 'Hours' : 'Man-hours', 1]], WEEKS.map(x => { const src = isEq ? x.equipment?.rows : [...(x.manpower?.direct || []), ...(x.manpower?.indirect || [])]; const m = (src || []).find(y => norm(y.name) === norm(r.name)); return `<tr><td>${esc(weekLabel(x))}</td><td class="n">${m ? fmt(m.total, 0) : '—'}</td></tr>`; }))
    }));
  }
  function openKpi(k) {
    const w = cur();
    if (k === 'progress') return openProg(w, 0);
    if (k === 'manpower') return A.Details.open(() => ({ title: 'Manpower', sub: weekLabel(w), body: tbl([['Trade / position'], ['Type'], ...w.manpower.days.map(d => [esc(d), 1]), ['Man-hours', 1]], [...w.manpower.direct.map(r => ({ ...r, t: 'Direct' })), ...w.manpower.indirect.map(r => ({ ...r, t: 'Indirect' }))].sort((a, b) => (b.total || 0) - (a.total || 0)).map(r => `<tr class="click" data-wtrade="${esc(r.name)}"><td>${esc(r.name)}</td><td>${r.t}</td>${r.days.map(v => `<td class="n">${v || '—'}</td>`).join('')}<td class="n">${fmt(r.total, 0)}</td></tr>`)) }));
    if (k === 'equipment') return A.Details.open(() => ({ title: 'Equipment', sub: weekLabel(w), body: tbl([['Equipment'], ...w.equipment.days.map(d => [esc(d), 1]), ['Hours', 1]], [...w.equipment.rows].sort((a, b) => (b.total || 0) - (a.total || 0)).map(r => `<tr class="click" data-wequip="${esc(r.name)}"><td>${esc(r.name)}</td>${r.days.map(v => `<td class="n">${v || '—'}</td>`).join('')}<td class="n">${fmt(r.total, 0)}</td></tr>`)) }));
    if (k === 'hse') return A.Details.open(() => ({ title: 'Health, safety & environment', sub: weekLabel(w), body: hseBlock(w) }));
    if (k === 'dates') return A.Details.open(() => ({ title: 'Schedule dates', sub: weekLabel(w), body: tiles([['Planned finish', fd(w.finish?.planned)], ['Forecast finish', fd(w.finish?.forecast)], ['Contract duration', (w.duration?.contract ?? '—') + ' d'], ['Elapsed', (w.duration?.elapsed ?? '—') + ' d'], ['Remaining', (w.duration?.remaining ?? '—') + ' d'], ['Elapsed %', fmtP(w.duration?.elapsedPct, 2)]]) + `<h4 class="dsec">Milestones</h4>` + tbl([['#'], ['Milestone'], ['Planned start'], ['Planned finish'], ['Actual / forecast'], ['Var']], (w.milestones || []).map(m => `<tr><td>${esc(m.no)}</td><td>${esc(m.name)}</td><td>${esc(m.pStart)}</td><td>${esc(m.pFinish)}</td><td>${esc(m.fFinish)}</td><td>${esc(m.var)}</td></tr>`)) }));
    if (k === 'rfi' || k === 'open') return A.Details.open(() => ({ title: 'Open items', sub: weekLabel(w), body: tiles([['RFIs raised', w.rfi?.total ?? '—'], ['RFIs closed', w.rfi?.closed ?? '—'], ['RFIs open', w.rfi?.open ?? '—']]) + qualityBlock(w) + `<h4 class="dsec">Key risks</h4>` + tbl([['Risk'], ['Owner'], ['Status']], (w.risks || []).map((r, i) => `<tr class="click" data-wrisk="${i}"><td>${esc(r.risk)}</td><td>${esc(r.owner)}</td><td>${status(r.status)}</td></tr>`)) }));
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-wk],[data-wprog],[data-wq],[data-wloss],[data-wdone],[data-wplan],[data-whse],[data-wwir],[data-wissue],[data-wrisk],[data-wimg],[data-wrow],[data-wtrade],[data-wequip]');
    if (!t || !$('#tab-weekly') || !SEL) return;
    const w = cur(), ds = t.dataset;
    if (ds.wk) openKpi(ds.wk);
    else if (ds.wprog) openProg(w, +ds.wprog);
    else if (ds.wq) { const r = w.quantities[+ds.wq]; A.Details.open(() => ({ title: esc(r.name), sub: 'Major quantity · ' + weekLabel(w), body: tiles([['Total BOQ', fmt(r.boq, 0) + ' ' + esc(r.unit)], ['Planned to date', fmt(r.plan, 0) + ' ' + esc(r.unit), fmtP(r.plan / r.boq * 100, 1)], ['Actual to date', fmt(r.actual, 0) + ' ' + esc(r.unit), fmtP(r.actual / r.boq * 100, 1)], ['Variance', fmt(r.actual - r.plan, 0) + ' ' + esc(r.unit)], ['Performance', r.plan ? (r.actual / r.plan).toFixed(2) : '—', 'Actual ÷ planned'], ['Remaining', fmt(r.boq - r.actual, 0) + ' ' + esc(r.unit)]]) + `<h4 class="dsec">Across imported reports</h4>` + tbl([['Report'], ['Planned', 1], ['Actual', 1]], WEEKS.map(x => { const m = (x.quantities || []).find(y => norm(y.name) === norm(r.name)); return `<tr><td>${esc(weekLabel(x))}</td><td class="n">${m ? fmt(m.plan, 0) : '—'}</td><td class="n">${m ? fmt(m.actual, 0) : '—'}</td></tr>`; })) })); }
    else if (ds.wloss) openRow('Loss due to external constraint', w.losses.filter(r => !r.total)[+ds.wloss], { name: 'Activity', lost: 'Lost %', rem: 'Remarks' });
    else if (ds.wdone) A.Details.open(() => ({ title: 'Work completed this week', sub: weekLabel(w), body: `<p>${esc(w.completed[+ds.wdone])}</p>` }));
    else if (ds.wplan) openRow('Work planned for next week', w.planned[+ds.wplan], { no: '#', act: 'Activity', loc: 'Location / chainage', rem: 'Remarks' });
    else if (ds.whse) openRow('HSE indicator', w.hse[+ds.whse], { label: 'Indicator', grp: 'Group', wk: 'This week', ytd: 'Year to date', ptd: 'Project to date' });
    else if (ds.wwir) { const r = w.wir[+ds.wwir]; A.Details.open(() => ({ title: 'WIR — ' + esc(r.name), sub: weekLabel(w), body: tiles([['This week', r.wk[0] ?? '—'], ['Week code A & B', r.wk[1] ?? '—'], ['Week code C & D', r.wk[2] ?? '—'], ['Week running', r.wk[3] ?? '—'], ['Total', r.cum[0] ?? '—'], ['Code A & B', r.cum[1] ?? '—'], ['Code C & D', r.cum[2] ?? '—'], ['Running', r.cum[3] ?? '—'], ['% C & D', esc(r.cdPct)], ['Main reasons', esc(r.reason || '—')]]) })); }
    else if (ds.wissue) openRow('Critical issue', w.issues[+ds.wissue], { cat: 'Area', desc: 'Description', action: 'Action required', by: 'Action by', rem: 'Remarks' });
    else if (ds.wrisk) { const r = w.risks[+ds.wrisk]; A.Details.open(() => ({ title: esc(r.risk), sub: 'Key risk · ' + weekLabel(w), body: tiles([['Potential impact', esc(r.impact)], ['Owner', esc(r.owner)], ['Status', status(r.status)]]) + `<h4 class="dsec">Mitigation actions</h4><ul>${r.mitigation.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` })); }
    else if (ds.wimg) { const [set, i] = ds.wimg.split('|'); const src = set === 'scurve' ? w.scurve[+i] : w.photos[+i].src; const n = set === 'photos' ? w.photos.length : 1; A.Details.open(() => ({ title: set === 'scurve' ? 'Overall progress S-curve' : `Site photo ${+i + 1} of ${n}`, sub: weekLabel(w), body: `<img class="wk-full" src="${src}" alt="">` + (set === 'photos' ? `<p class="row-btns">${+i > 0 ? `<button class="btn" data-wimg="photos|${+i - 1}">← Previous</button>` : ''}${+i < n - 1 ? `<button class="btn" data-wimg="photos|${+i + 1}">Next →</button>` : ''}</p>` : '') })); }
    else if (ds.wrow) { const [g, i] = ds.wrow.split('|'); const G = g === 'sd' ? w.shopDrawings : g === 'proc' ? w.procurement : w.permits[+g.replace('permit', '')]; const r = G.rows[+i]; A.Details.open(() => ({ title: esc(r.find(x => x && x.length > 12) || r[0] || 'Details'), sub: esc(G.title || '') + ' · ' + weekLabel(w), body: tiles(G.head.map((h, j) => [esc(h), esc(r[j] || '—').replace(/\n/g, '<br>')])) })); }
    else if (ds.wtrade) { const r = [...w.manpower.direct, ...w.manpower.indirect].find(x => x.name === ds.wtrade); if (r) openTrade(w, r); }
    else if (ds.wequip) { const r = w.equipment.rows.find(x => x.name === ds.wequip); if (r) openTrade(w, r, true); }
  });

  // ---------------- import / export ----------------
  const setStatus = t => { const el = $('#wkStatus'); if (el) el.innerHTML = t; };
  async function onDocx(file) {
    if (!/\.docx$/i.test(file.name)) return setStatus('✗ Please choose the weekly report as a Word <b>.docx</b> file.');
    setStatus(`Reading <b>${esc(file.name)}</b> (${(file.size / 1048576).toFixed(1)} MB)…`);
    await new Promise(r => setTimeout(r, 30));
    try {
      const w = await parseDocx(file);
      upsert(w);
      SEL = key(w);
      await idbSet('weeks', WEEKS);
      const found = [['progress', w.progress], ['HSE', w.hse], ['manpower', w.manpower], ['equipment', w.equipment], ['quantities', w.quantities], ['works completed', w.completed], ['planned next week', w.planned], ['quality', w.wir], ['engineering', w.deliverables], ['risks', w.risks], ['photos', w.photos && w.photos.length ? w.photos : null]]
        .map(([n, v]) => (v && (!Array.isArray(v) || v.length) ? '✓ ' : '• missing: ') + n).join(' · ');
      setStatus(`✓ Imported report <b>${esc(weekLabel(w))}</b> — ${(w.tables || []).length} tables, ${(w.photos || []).length} photos<br>${found}<br>To publish for everyone: click <b>Download weekly.json</b> and upload it to the repo folder <code>data/</code>.`);
      A.render(); render(); A.showTab('weekly');
    } catch (e) { console.error(e); setStatus('✗ Could not read the report: ' + esc(e.message)); }
  }
  function wireImport() {
    const drop = $('#dropWk'), inp = $('#fileWk');
    if (!drop) return;
    inp.onchange = () => inp.files[0] && onDocx(inp.files[0]);
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => e.dataTransfer.files[0] && onDocx(e.dataTransfer.files[0]));
    $('#wkExport').onclick = () => {
      if (!WEEKS.length) return setStatus('Nothing to export yet.');
      const blob = new Blob([JSON.stringify(forPublish())], { type: 'application/json' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'weekly.json'; l.click();
    };
    $('#wkClear').onclick = async () => { await idbDel('weeks'); WEEKS = []; SEL = null; setStatus('Local weekly reports cleared — reloading the published file…'); await boot(true); };
    $('#wkDelete').onclick = async () => {
      const w = cur(); if (!w) return;
      if (!confirm(`Remove report ${weekLabel(w)} from this browser?`)) return;
      WEEKS = WEEKS.filter(x => x !== w); SEL = null; await idbSet('weeks', WEEKS); A.render(); render();
      setStatus('Report removed locally. Download weekly.json and publish it to remove it for everyone.');
    };
    $('#wkSel').onchange = e => { SEL = e.target.value; render(); };
  }

  async function boot(skipLocal) {
    let pub = [];
    try { const r = await fetch('data/weekly.json', { cache: 'no-store' }); if (r.ok) pub = (await r.json()).weeks || []; } catch (e) { }
    const local = skipLocal ? null : await idbGet('weeks');
    WEEKS = [];
    pub.forEach(upsert);
    (local || []).forEach(w => { const p = WEEKS.find(x => key(x) === key(w)); if (!p || (w.imported || '') >= (p.imported || '')) upsert(w); });
    if (WEEKS.length) setStatus(`${WEEKS.length} weekly report(s) loaded${local && local.length ? ' (incl. local imports)' : ''}. Latest: <b>${esc(weekLabel(WEEKS[WEEKS.length - 1]))}</b>`);
    A.render(); render();
  }

  wireImport();
  const prevOnTab = A.onTab;
  A.onTab = n => { if (prevOnTab) prevOnTab(n); if (n === 'weekly') render(); };
  A.whenReady(() => boot());
})();
