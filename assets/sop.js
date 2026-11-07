/* Summary of Progress — every P6 item broken down by location and detail (e.g. Main Carriage › Wet Utilities › Stormwater
   Manhole › Catch Basin › area), with done / remaining, earned value, the quantities loaded on the activities (executed =
   loaded × % complete), the BOQ certified quantities of the same BOQ groups, and the look-ahead to send to site. */
(function () {
  'use strict';
  const A = window.APP, SX = window.SCHEDX;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = A.esc, fmt = A.fmt, fmtP = A.fmtP, fmtM = A.fmtM;
  const DAY = 864e5;
  const ST = (() => { try { return Object.assign({ loc: '', view: 'work', days: 14, q: '', open: {} }, JSON.parse(localStorage.getItem('trd_sop') || '{}')); } catch (e) { return { loc: '', view: 'work', days: 14, q: '', open: {} }; } })();
  const keep = () => { try { localStorage.setItem('trd_sop', JSON.stringify({ loc: ST.loc, view: ST.view, days: ST.days })); } catch (e) { } };

  // ---------------- quantities ----------------
  const UNIT = u => { const x = String(u || '').toLowerCase(); return /cubic|m3|m³|^cm$/.test(x) ? 'm³' : /square|m2|m²/.test(x) ? 'm²' : /linear|^lm$|^m$|metre|meter/.test(x) ? 'm' : /ton/.test(x) ? 't' : /kilo|^kg/.test(x) ? 'kg' : /unit|^ut$|^nos?$|each|^no\.?$/.test(x) ? 'nr' : /l\.?s|lump/.test(x) ? 'LS' : x; };
  // temporary works are loaded in P6 but have no BOQ item of their own
  const TEMP = /scaffold|formwork|shutter|false ?work|propping/i;
  const KEYQ = /^concrete$|reinforc|rebar|prestress|asphalt|bitumin|pipe|excavation/i;
  const qOrder = (a, b) => (TEMP.test(a.name) - TEMP.test(b.name)) || (KEYQ.test(b.name) - KEYQ.test(a.name)) || b.tot - a.tot;
  const groupOf = short => { const m = /^B-\s*([0-9A-Z]+)\s*\/\s*([0-9A-Z.]+)\s+/i.exec(String(short || '')); return m ? `B-${m[1].toUpperCase()}/${m[2].toUpperCase()}` : null; };
  // per activity: [{ key, name, unit, tot, group }] — the BOQ-coded resource when there is one (the generic twin is the same quantity)
  let QCACHE = null;
  function actQty() {
    const S = SX.S;
    if (QCACHE && QCACHE.S === S) return QCACHE.m;
    const m = new Map();
    (S.ra || []).forEach(r => {
      const rs = S.rl[r[1]]; if (!rs || rs[2] !== 'M' || !r[2]) return;
      const g = groupOf(rs[0]), l = m.get(r[0]) || []; m.set(r[0], l);
      l.push({ name: rs[1], unit: UNIT(rs[3]), tot: r[2], group: g });
    });
    m.forEach((l, k) => { const coded = l.filter(x => x.group); if (coded.length) m.set(k, coded); });
    QCACHE = { S, m };
    return m;
  }
  // BOQ items of a group, in the same unit as the P6 quantity
  function boqGroup(group, unit) {
    const M = A.M; if (!M || !group) return null;
    const items = (M.items || []).filter(i => i.code && (i.code === group || i.code.startsWith(group + '.')));
    if (!items.length) return null;
    const conv = (u, q) => { const b = UNIT(u); if (b === unit) return q; if (b === 'kg' && unit === 't') return q / 1000; if (b === 't' && unit === 'kg') return q * 1000; return null; };
    let cq = 0, tq = 0, ok = 0, camt = 0, tamt = 0;
    items.forEach(i => { const c = conv(i.unit, i.rqty ?? i.cqty), t = conv(i.unit, i.tqty); camt += i.ramt ?? i.camt; tamt += i.tamt; if (c !== null) { cq += c; tq += t || 0; ok++; } });
    return { name: (M.heads && M.heads[group]) || items[0].desc, items: items.length, cq: ok ? cq : null, tq: ok ? tq : null, camt, tamt };
  }

  // ---------------- tree ----------------
  const chain = n => /^[+\-]?\d+[.,]\d+\s*[-–]\s*[+\-]?\d+[.,]\d+$/.test(String(n).trim());
  const tidy = s => String(s || '').replace(/\s+/g, ' ').trim();
  const nice = s => { const t = tidy(s); return t === t.toUpperCase() && /[A-Z]{3}/.test(t) ? t.toLowerCase().replace(/(^|[\s(\-/&,])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Mc|Sr|Stc|Mv|Lv|Hv|Mong|Moi|Its|Grp|Hdpe|Pn|Rcc|Tse|J\d|Ehv|Sec|Mse|Cctv|Mep)\b/gi, w => w.toUpperCase()) : t; };
  function locations() {
    const S = SX.S, X = SX.X, out = new Map();
    S.wbs.forEach(w => { if (!w.parent) return; const p = X.W[w.parent]; if (p && !p.parent && /^6$|construction/i.test(p.code + ' ' + p.name)) out.set(w.id, nice(w.name)); });
    return out;
  }
  function build() {
    const S = SX.S, X = SX.X, dd = X.dd, d1 = dd + ST.days * DAY, Q = actQty(), k = X.k;
    const root = { name: 'All', kids: new Map(), acts: [] };
    const q = ST.q.trim().toLowerCase();
    S.acts.forEach((a, ai) => {
      if (SX.isMs(a)) return;
      const path = X.wbsPath(a.w);
      if (!path.length) return;
      const top = path[0];
      const inCon = /^6$|construction/i.test(top.code + ' ' + top.name);
      if (ST.loc === '' && !inCon) return;
      if (ST.loc && ST.loc !== '*' && !(path[1] && path[1].id === ST.loc)) return;
      if (q && !(a.n.toLowerCase().includes(q) || a.c.toLowerCase().includes(q) || path.some(w => w.name.toLowerCase().includes(q)))) return;
      let names;
      if (!inCon) names = path.map(w => nice(w.name));
      else if (ST.view === 'wbs') names = path.slice(1).map(w => nice(w.name));
      else {
        // by work type: location › details … › area (part / junction) › chainage
        const L2 = path[1], L3 = path[2], rest = path.slice(3);
        const l2n = tidy(L2 ? L2.name : '').toUpperCase();
        const det = rest.filter(w => !chain(w.name) && tidy(w.name).toUpperCase() !== l2n).map(w => nice(w.name));
        const ch = rest.filter(w => chain(w.name)).map(w => tidy(w.name));
        // the area (part / junction) goes last — unless a detail level already names it (e.g. "Junction 7 Structural Works")
        const l3k = L3 ? tidy(L3.name).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).join(' ') : '';
        const named = l3k && det.some(n => n.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').includes(l3k));
        names = [nice(L2 ? L2.name : top.name), ...(named ? [nice(L3.name)] : []), ...det.filter(n => !(named && n.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').includes(l3k))), ...(L3 && !named ? [nice(L3.name)] : []), ...ch];
      }
      const qa = Q.get(ai) || [];
      const pv = a.wt ? a.wt * X.pf(a, dd) : 0;
      const s = a.s, f = a.f, done = SX.isDone(a);
      const la = !done && s !== null && f !== null && s <= d1 && f >= dd;
      const rec = { a, ai, ev: a.wt * a.p / 100 * k, pv: pv * k, bac: a.wt * k, qa, la, laStart: la && !a.as && s <= d1, laFinish: la && f <= d1 };
      let node = root;
      const up = n => { n.n = (n.n || 0) + 1; if (done) n.done = (n.done || 0) + 1; else if (a.as) n.act = (n.act || 0) + 1;
        n.ev = (n.ev || 0) + rec.ev; n.pv = (n.pv || 0) + rec.pv; n.bac = (n.bac || 0) + rec.bac; n.wt = (n.wt || 0) + a.wt; n.ew = (n.ew || 0) + a.wt * a.p / 100;
        if (la) { n.la = (n.la || 0) + 1; if (rec.laStart) n.las = (n.las || 0) + 1; if (rec.laFinish) n.laf = (n.laf || 0) + 1; }
        if (f !== null && (!n.f || f > n.f)) n.f = f; if (a.bf !== null && (!n.bf || a.bf > n.bf)) n.bf = a.bf; if (s !== null && (!n.s || s < n.s)) n.s = s;
        n.q = n.q || {}; qa.forEach(x => { const key = x.name + '|' + x.unit; const t = n.q[key] || (n.q[key] = { name: x.name, unit: x.unit, tot: 0, exe: 0, groups: new Set() }); t.tot += x.tot; t.exe += x.tot * a.p / 100; if (x.group) t.groups.add(x.group); }); };
      up(root);
      const ids = [];
      names.forEach(nm => {
        ids.push(nm);
        let c = node.kids.get(nm);
        if (!c) { c = { name: nm, id: ids.join(' › '), kids: new Map(), acts: [] }; node.kids.set(nm, c); }
        node = c; up(node);
      });
      node.acts.push(rec);
    });
    return root;
  }

  // ---------------- page ----------------
  let TREE = null;
  const pctOf = n => n.wt ? n.ew / n.wt * 100 : n.n ? (n.done || 0) / n.n * 100 : 0;
  const plOf = n => n.bac ? n.pv / n.bac * 100 : 0;
  const bar = (v, pl) => `<div class="pbar"><div class="t"><i style="width:${Math.min(100, v)}%"></i>${pl !== undefined ? `<span class="pl" style="left:${Math.min(100, pl)}%"></span>` : ''}</div><span>${fmtP(v, 1)}</span></div>`;
  const topQ = (n, k = 3) => Object.values(n.q || {}).sort(qOrder).slice(0, k).map(t => `<span class="sop-q" title="${esc(t.name)}: executed ${fmt(t.exe, 0)} of ${fmt(t.tot, 0)} ${esc(t.unit)} loaded on the activities">${esc(t.name)} <b>${fmt(t.exe, 0)}</b>/${fmt(t.tot, 0)} ${esc(t.unit)}</span>`).join('');
  function render() {
    const host = $('#sopBody');
    if (!host) return;
    if (!SX || !SX.S) { host.innerHTML = '<div class="card empty"><h3>Loading the P6 programme…</h3></div>'; return; }
    const LOC = locations();
    if (ST.loc && ST.loc !== '*' && !LOC.has(ST.loc)) ST.loc = '';
    TREE = build();
    const R = TREE, X = SX.X;
    host.innerHTML = `<div class="prog-bar"></div>
      <div class="card sop-ctl">
        <div class="sop-row"><span class="muted small">Location</span><div class="seg" id="sopLoc"><button data-l="" class="${ST.loc === '' ? 'on' : ''}">All construction</button>${[...LOC].map(([id, n]) => `<button data-l="${esc(id)}" class="${ST.loc === id ? 'on' : ''}">${esc(n)}</button>`).join('')}<button data-l="*" class="${ST.loc === '*' ? 'on' : ''}" title="Engineering, procurement, testing … too">Whole programme</button></div></div>
        <div class="sop-row"><span class="muted small">Group</span><div class="seg" id="sopView"><button data-v="work" class="${ST.view === 'work' ? 'on' : ''}" title="Location › work › element › type › area (part) › chainage">By work type → area</button><button data-v="wbs" class="${ST.view === 'wbs' ? 'on' : ''}" title="As in the P6 WBS: location › part › work …">P6 WBS order</button></div>
          <span class="muted small">Look-ahead</span><div class="seg" id="sopDays">${[7, 14, 21, 28].map(d => `<button data-d="${d}" class="${ST.days === d ? 'on' : ''}">${d} days</button>`).join('')}</div>
          <input type="search" id="sopQ" placeholder="Find (e.g. catch basin, deck slab, J7)…" value="${esc(ST.q)}">
          <button class="btn ghost" id="sopExp">Expand all</button><button class="btn ghost" id="sopCol">Collapse</button><button class="btn" id="sopCsv">⬇ Excel summary</button></div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="lbl">Activities</div><div class="val">${fmt(R.n || 0, 0)}</div><div class="sub">${fmt(R.done || 0, 0)} done · ${fmt(R.act || 0, 0)} in progress · ${fmt((R.n || 0) - (R.done || 0) - (R.act || 0), 0)} not started</div></div>
        <div class="kpi"><div class="lbl">Physical progress</div><div class="val">${fmtP(pctOf(R), 2)}</div><div class="sub">planned ${fmtP(plOf(R), 2)} at cut-off ${SX.fd(X.dd)}</div></div>
        <div class="kpi"><div class="lbl">Earned value</div><div class="val">${fmtM(R.ev || 0)}</div><div class="sub">of ${fmtM(R.bac || 0)} SAR · PV ${fmtM(R.pv || 0)} · SPI ${R.pv ? (R.ev / R.pv).toFixed(2) : '—'}</div></div>
        <div class="kpi"><div class="lbl">Remaining value</div><div class="val">${fmtM((R.bac || 0) - (R.ev || 0))}</div><div class="sub">SAR excl. VAT</div></div>
        <div class="kpi click" id="sopLaKpi"><div class="lbl">Next ${ST.days} days</div><div class="val">${fmt(R.la || 0, 0)}</div><div class="sub">${fmt(R.las || 0, 0)} to start · ${fmt(R.laf || 0, 0)} to finish · list for site ›</div></div>
      </div>
      <div class="card"><div class="card-h"><h3>Summary of progress</h3><span class="muted small">Progress = cost-weighted % complete (▏= planned at cut-off) · quantities = loaded on the P6 activities, executed = loaded × % complete · click a row for details</span></div>
        <div class="table-wrap sop-wrap"><table class="tbl sop-tbl"><thead><tr><th>Item</th><th class="n">Activities</th><th>Progress</th><th class="n">Earned value</th><th class="n">Remaining</th><th>Quantities (executed / loaded)</th><th class="n">Next ${ST.days} d</th><th>Forecast finish</th></tr></thead><tbody id="sopRows">${rows(R, 0)}</tbody></table></div></div>
      <div class="card" id="sopLa"><div class="card-h"><h3>Look-ahead — next ${ST.days} days (to send to site)</h3><span class="muted small">Activities that should start or finish from ${SX.fd(X.dd)} to ${SX.fd(X.dd + ST.days * DAY)}, or continue through it</span><div class="row-btns"><button class="btn" id="sopLaCsv">⬇ Excel</button><button class="btn ghost" id="sopLaPrint">🖨 Print</button></div></div>${lookahead(R)}</div>
      <div class="card"><div class="card-h"><h3>BOQ ↔ P6 quantities</h3><span class="muted small">Per BOQ group that the P6 resources point to (e.g. B-5A/5A.6 = Junction 7 concrete): BOQ certified to date vs P6 executed (loaded × %)</span></div>${recon(R)}</div>`;
    SX.renderProgBars();
    wire();
  }
  function rows(node, depth) {
    const kids = [...node.kids.values()];
    return kids.map(c => {
      const has = c.kids.size > 0, open = ST.open[c.id] !== undefined ? ST.open[c.id] : depth < 1 || !!ST.q;
      const v = pctOf(c), pl = plOf(c), late = v + 0.05 < pl;
      return `<tr class="click sop-r d${Math.min(depth, 8)}" data-sop="${esc(c.id)}"><td style="padding-left:${10 + depth * 16}px">${has ? `<span class="sop-tg" data-sop-tg="${esc(c.id)}">${open ? '▾' : '▸'}</span>` : '<span class="sop-tg"></span>'}<b>${esc(c.name)}</b></td>
        <td class="n">${fmt(c.n, 0)}<div class="muted small">${c.done || 0}✓ ${c.act || 0}▶</div></td><td>${bar(v, pl)}${late ? '<div class="small neg">behind plan ' + fmtP(pl - v, 1) + '</div>' : ''}</td>
        <td class="n">${fmtM(c.ev || 0)}<div class="muted small">of ${fmtM(c.bac || 0)}</div></td><td class="n">${fmtM((c.bac || 0) - (c.ev || 0))}</td><td class="sop-qc">${topQ(c) || '<span class="muted small">—</span>'}</td>
        <td class="n">${c.la ? `<b>${c.la}</b><div class="muted small">${c.las || 0} start · ${c.laf || 0} finish</div>` : '—'}</td><td>${SX.fd(c.f)}${c.f && c.bf && c.f > c.bf + DAY ? `<div class="small neg">+${Math.round((c.f - c.bf) / DAY)} d</div>` : ''}</td></tr>` + (has && open ? rows(c, depth + 1) : '');
    }).join('');
  }
  const find = id => { let n = TREE; for (const p of id.split(' › ')) { n = n && n.kids.get(p); } return n; };
  const allRecs = n => n.acts.concat(...[...n.kids.values()].map(allRecs));
  function laList(node) {
    return allRecs(node).filter(r => r.la).sort((x, y) => (x.a.s ?? 0) - (y.a.s ?? 0));
  }
  const remQ = r => r.qa.map(x => `${fmt(x.tot * (1 - r.a.p / 100), 0)} ${esc(x.unit)} ${esc(x.name)}`).join(' · ');
  function laTable(list, withPath) {
    if (!list.length) return '<p class="muted">Nothing due in this window.</p>';
    const X = SX.X;
    return `<div class="table-wrap"><table class="tbl"><thead><tr><th>Activity</th>${withPath ? '<th>Item / area</th>' : ''}<th>Status</th><th>Start</th><th>Finish</th><th class="n">%</th><th>To do</th><th class="n">Float</th></tr></thead><tbody>${list.slice(0, 400).map(r => {
      const a = r.a, what = r.laFinish ? (a.as ? 'Finish' : 'Start & finish') : r.laStart ? 'Start' : 'Continue';
      return `<tr class="click" data-act="${esc(a.c)}"><td><b>${esc(a.c)}</b><div class="small">${esc(a.n)}</div></td>${withPath ? `<td class="small muted">${esc(pathOf(a))}</td>` : ''}<td><span class="status ${what === 'Continue' ? 'na' : 'warn'}">${what}</span></td><td>${SX.fd(a.s)}${a.as ? ' <span class="muted small">actual</span>' : ''}</td><td>${SX.fd(a.f)}</td><td class="n">${a.p}%</td><td class="small">${remQ(r) || '—'}</td><td class="n ${a.tf !== null && a.tf <= 0 ? 'neg' : ''}">${a.tf ?? '—'}</td></tr>`;
    }).join('')}</tbody></table></div>${list.length > 400 ? `<p class="muted small">First 400 of ${list.length} — the Excel file has all.</p>` : ''}`;
  }
  const pathOf = a => SX.X.wbsPath(a.w).slice(1).map(w => nice(w.name)).filter(n => !/^(Junction \d+ Structural Works|Bridge Works)$/i.test(n)).slice(0, 6).join(' › ');
  function lookahead(R) {
    const list = laList(R);
    return `<div class="dtiles"><div class="dtile"><div class="lbl">To start</div><div class="v">${list.filter(r => r.laStart).length}</div></div><div class="dtile"><div class="lbl">To finish</div><div class="v">${list.filter(r => r.laFinish).length}</div></div><div class="dtile"><div class="lbl">Continuing</div><div class="v">${list.filter(r => !r.laStart && !r.laFinish).length}</div></div><div class="dtile"><div class="lbl">Critical (float ≤ 0)</div><div class="v neg">${list.filter(r => r.a.tf !== null && r.a.tf <= 0).length}</div></div></div>` + laTable(list, true);
  }
  // all BOQ groups the selection's P6 resources point to
  function groups(node) {
    const g = new Map();
    allRecs(node).forEach(r => r.qa.forEach(x => {
      if (!x.group) return;
      const key = x.group + '|' + x.name + '|' + x.unit;
      const t = g.get(key) || { group: x.group, unit: x.unit, name: x.name, tot: 0, exe: 0, n: 0 };
      t.tot += x.tot; t.exe += x.tot * r.a.p / 100; t.n++; g.set(key, t);
    }));
    return [...g.values()].sort((a, b) => a.group.localeCompare(b.group, undefined, { numeric: true }));
  }
  function recon(node, limit = 200) {
    const G = groups(node);
    if (!G.length) return '<p class="muted">No BOQ-coded quantities are loaded on these activities.</p>';
    if (!A.M || !A.M.items || !A.M.items.some(i => i.code)) return '<p class="muted">Load the IPA Monthly Breakdown workbook (Import › 1b) to compare with the BOQ.</p>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr><th>BOQ group</th><th>P6 resource</th><th class="n">BOQ qty</th><th class="n">BOQ certified</th><th class="n">P6 loaded</th><th class="n">P6 executed</th><th class="n">Certified − executed</th><th class="n">BOQ certified SAR</th></tr></thead><tbody>${G.slice(0, limit).map(t => {
      const tmp = TEMP.test(t.name), b = tmp ? null : boqGroup(t.group, t.unit), g = boqGroup(t.group, t.unit);
      const diff = b && b.tq !== null ? b.tq - t.exe : null;
      return `<tr><td><b>${esc(t.group)}</b><div class="small muted">${esc(g ? g.name : 'not in the BOQ workbook')}${tmp ? ' · <i>temporary works — no BOQ item</i>' : ''}</div></td><td>${esc(t.name)} <span class="muted small">(${t.n} act.)</span></td>
        <td class="n">${b && b.cq !== null ? fmt(b.cq, 0) + ' ' + esc(t.unit) : '—'}</td><td class="n">${b && b.tq !== null ? fmt(b.tq, 0) + `<div class="muted small">${b.cq ? fmtP(b.tq / b.cq * 100, 1) : ''}</div>` : '—'}</td>
        <td class="n">${fmt(t.tot, 0)} ${esc(t.unit)}</td><td class="n">${fmt(t.exe, 0)}<div class="muted small">${t.tot ? fmtP(t.exe / t.tot * 100, 1) : ''}</div></td>
        <td class="n ${diff === null ? '' : diff < -0.5 ? 'neg' : 'pos'}">${diff === null ? '—' : (diff > 0 ? '+' : '') + fmt(diff, 0)}</td><td class="n">${b ? fmtM(b.tamt) : '—'}<div class="muted small">${b && b.camt ? 'of ' + fmtM(b.camt) : ''}</div></td></tr>`;
    }).join('')}</tbody></table></div><p class="muted small">BOQ qty / certified = items of that BOQ group in the same unit (IPA Monthly Breakdown, latest IPC). The BOQ groups cover a whole structure or bill, so compare them at that level (e.g. a junction); P6 executed = quantity loaded on each activity × its physical %. P6 remaining units are not updated in the XER, so they are not used.</p>`;
  }

  // ---------------- details ----------------
  function detail(id) {
    const n = find(id); if (!n) return { title: 'Not found', body: '' };
    const recs = allRecs(n), X = SX.X;
    const Q = Object.values(n.q || {}).sort(qOrder);
    return {
      title: esc(n.name), sub: esc(id),
      body: `<div class="dtiles">
          <div class="dtile"><div class="lbl">Physical progress</div><div class="v">${fmtP(pctOf(n), 2)}</div><div class="muted small">planned ${fmtP(plOf(n), 2)}</div></div>
          <div class="dtile"><div class="lbl">Activities</div><div class="v">${n.n}</div><div class="muted small">${n.done || 0} done · ${n.act || 0} in progress · ${n.n - (n.done || 0) - (n.act || 0)} not started</div></div>
          <div class="dtile"><div class="lbl">Earned value</div><div class="v">SAR ${fmt(n.ev || 0, 0)}</div><div class="muted small">of ${fmt(n.bac || 0, 0)} · PV ${fmt(n.pv || 0, 0)}</div></div>
          <div class="dtile"><div class="lbl">Remaining value</div><div class="v">SAR ${fmt((n.bac || 0) - (n.ev || 0), 0)}</div></div>
          <div class="dtile"><div class="lbl">Start → forecast finish</div><div class="v">${SX.fd(n.s)} → ${SX.fd(n.f)}</div><div class="muted small">baseline finish ${SX.fd(n.bf)}</div></div>
          <div class="dtile"><div class="lbl">Next ${ST.days} days</div><div class="v">${n.la || 0}</div><div class="muted small">${n.las || 0} to start · ${n.laf || 0} to finish</div></div></div>
        ${Q.length ? `<h4 class="dsec">Quantities loaded on the activities</h4><div class="table-wrap"><table class="tbl"><thead><tr><th>Resource</th><th class="n">Loaded</th><th class="n">Executed</th><th class="n">Remaining</th><th>Progress</th><th>BOQ group</th></tr></thead><tbody>${Q.map(t => `<tr><td><b>${esc(t.name)}</b></td><td class="n">${fmt(t.tot, 0)} ${esc(t.unit)}</td><td class="n">${fmt(t.exe, 0)}</td><td class="n">${fmt(t.tot - t.exe, 0)}</td><td>${bar(t.tot ? t.exe / t.tot * 100 : 0)}</td><td class="small">${[...t.groups].map(esc).join(', ') || '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <h4 class="dsec">BOQ ↔ P6 for the BOQ groups of this item</h4>${recon(n, 60)}
        <h4 class="dsec">Next ${ST.days} days</h4>${laTable(laList(n), false)}
        <h4 class="dsec">Activities (${recs.length}) — earned value per activity</h4>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Activity</th><th>Status</th><th class="n">%</th><th class="n">BAC</th><th class="n">EV</th><th class="n">PV</th><th>Quantity executed / loaded</th><th>Start</th><th>Finish</th></tr></thead><tbody>${recs.sort((x, y) => (x.a.s ?? 0) - (y.a.s ?? 0)).slice(0, 500).map(r => `<tr class="click" data-act="${esc(r.a.c)}"><td><b>${esc(r.a.c)}</b><div class="small">${esc(r.a.n)}</div></td><td>${SX.stTag(r.a)}</td><td class="n">${r.a.p}%</td><td class="n">${fmt(r.bac, 0)}</td><td class="n">${fmt(r.ev, 0)}</td><td class="n">${fmt(r.pv, 0)}</td><td class="small">${r.qa.map(x => `${fmt(x.tot * r.a.p / 100, 0)} / ${fmt(x.tot, 0)} ${esc(x.unit)} ${esc(x.name)}`).join('<br>') || '—'}</td><td>${SX.fd(r.a.s)}</td><td>${SX.fd(r.a.f)}</td></tr>`).join('')}</tbody></table></div>${recs.length > 500 ? '<p class="muted small">First 500 shown — the Excel file has all.</p>' : ''}`
    };
  }

  // ---------------- export ----------------
  function xlsx(name, sheets) {
    const wb = XLSX.utils.book_new();
    sheets.forEach(([n, rows, w]) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = w.map(x => ({ wch: x })); XLSX.utils.book_append_sheet(wb, ws, n); });
    XLSX.writeFile(wb, name, { compression: true });
  }
  const dstr = t => t === null || t === undefined ? '' : new Date(t).toISOString().slice(0, 10);
  function summarySheet() {
    const out = [['Level', 'Item path', 'Item', 'Activities', 'Done', 'In progress', 'Progress %', 'Planned %', 'BAC SAR', 'EV SAR', 'PV SAR', 'Remaining SAR', 'Main quantities executed / loaded', 'Next days activities', 'Start', 'Forecast finish', 'Baseline finish']];
    const walk = (n, d) => n.kids.forEach(c => { out.push([d + 1, c.id, c.name, c.n, c.done || 0, c.act || 0, +pctOf(c).toFixed(2), +plOf(c).toFixed(2), Math.round(c.bac || 0), Math.round(c.ev || 0), Math.round(c.pv || 0), Math.round((c.bac || 0) - (c.ev || 0)), Object.values(c.q || {}).sort(qOrder).slice(0, 4).map(t => `${t.name} ${Math.round(t.exe)}/${Math.round(t.tot)} ${t.unit}`).join('; '), c.la || 0, dstr(c.s), dstr(c.f), dstr(c.bf)]); walk(c, d + 1); });
    walk(TREE, 0);
    return out;
  }
  function laSheet(node) {
    return [['Activity ID', 'Activity', 'Item / area', 'Action', 'Start', 'Finish', '% complete', 'Remaining quantity', 'Total float (d)', 'Critical']].concat(laList(node).map(r => [r.a.c, r.a.n, pathOf(r.a), r.laFinish ? (r.a.as ? 'Finish' : 'Start & finish') : r.laStart ? 'Start' : 'Continue', dstr(r.a.s), dstr(r.a.f), r.a.p, r.qa.map(x => `${Math.round(x.tot * (1 - r.a.p / 100))} ${x.unit} ${x.name}`).join('; '), r.a.tf, r.a.tf !== null && r.a.tf <= 0 ? 'Yes' : '']));
  }
  function actSheet() {
    return [['Activity ID', 'Activity', 'Item path', 'Status', '% complete', 'BAC SAR', 'EV SAR', 'PV SAR', 'Resource', 'Unit', 'Loaded qty', 'Executed qty', 'BOQ group', 'Start', 'Finish']].concat(allRecs(TREE).flatMap(r => (r.qa.length ? r.qa : [null]).map(x => [r.a.c, r.a.n, pathOf(r.a), r.a.st, r.a.p, Math.round(r.bac), Math.round(r.ev), Math.round(r.pv), x ? x.name : '', x ? x.unit : '', x ? +x.tot.toFixed(2) : '', x ? +(x.tot * r.a.p / 100).toFixed(2) : '', x && x.group || '', dstr(r.a.s), dstr(r.a.f)])));
  }
  function reconSheet() {
    return [['BOQ group', 'BOQ description', 'P6 resource', 'Unit', 'BOQ qty', 'BOQ certified qty', 'P6 loaded', 'P6 executed', 'Certified − executed', 'BOQ amount SAR', 'BOQ certified SAR']].concat(groups(TREE).map(t => { const b = TEMP.test(t.name) ? null : boqGroup(t.group, t.unit); return [t.group, b ? b.name : '', t.name, t.unit, b && b.cq !== null ? Math.round(b.cq) : '', b && b.tq !== null ? Math.round(b.tq) : '', Math.round(t.tot), Math.round(t.exe), b && b.tq !== null ? Math.round(b.tq - t.exe) : '', b ? Math.round(b.camt) : '', b ? Math.round(b.tamt) : '']; }));
  }
  const fname = s => 'Summary_of_Progress_' + (ST.loc && ST.loc !== '*' ? (locations().get(ST.loc) || '').replace(/\W+/g, '_') + '_' : '') + s + '_' + dstr(SX.X.dd) + '.xlsx';

  function wire() {
    $$('#sopLoc [data-l]').forEach(b => b.onclick = () => { ST.loc = b.dataset.l; ST.open = {}; keep(); render(); });
    $$('#sopView [data-v]').forEach(b => b.onclick = () => { ST.view = b.dataset.v; ST.open = {}; keep(); render(); });
    $$('#sopDays [data-d]').forEach(b => b.onclick = () => { ST.days = +b.dataset.d; keep(); render(); });
    const q = $('#sopQ'); q.oninput = () => { clearTimeout(q.t); q.t = setTimeout(() => { ST.q = q.value; render(); const n = $('#sopQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 350); };
    $('#sopExp').onclick = () => { const all = (n, d) => n.kids.forEach(c => { if (d < 6) ST.open[c.id] = true; all(c, d + 1); }); all(TREE, 0); render(); };
    $('#sopCol').onclick = () => { ST.open = {}; TREE.kids.forEach(c => { ST.open[c.id] = false; }); render(); };
    $('#sopCsv').onclick = () => xlsx(fname('summary'), [['Summary', summarySheet(), [5, 70, 40, 10, 8, 10, 11, 10, 14, 14, 14, 14, 60, 12, 11, 12, 12]], ['Look-ahead', laSheet(TREE), [22, 60, 60, 14, 11, 11, 10, 40, 10, 8]], ['Activities', actSheet(), [22, 60, 60, 10, 9, 12, 12, 12, 22, 6, 10, 10, 12, 11, 11]], ['BOQ vs P6', reconSheet(), [14, 50, 22, 6, 12, 14, 12, 12, 14, 14, 14]]]);
    $('#sopLaCsv').onclick = () => xlsx(fname('lookahead_' + ST.days + 'd'), [['Look-ahead', laSheet(TREE), [22, 60, 60, 14, 11, 11, 10, 40, 10, 8]]]);
    $('#sopLaPrint').onclick = () => { document.body.classList.add('sop-print-la'); window.print(); setTimeout(() => document.body.classList.remove('sop-print-la'), 500); };
    $('#sopLaKpi').onclick = () => $('#sopLa').scrollIntoView({ behavior: 'smooth' });
  }
  document.addEventListener('click', e => {
    const tg = e.target.closest('[data-sop-tg]');
    if (tg) { e.stopPropagation(); const id = tg.dataset.sopTg, n = find(id), d = id.split(' › ').length - 1; const open = ST.open[id] !== undefined ? ST.open[id] : d < 1 || !!ST.q; ST.open[id] = !open; $('#sopRows').innerHTML = rows(TREE, 0); return; }
    const r = e.target.closest('[data-sop]');
    if (r && !e.target.closest('[data-act]')) A.Details.open(() => detail(r.dataset.sop));
  });

  const prev = A.onTab;
  A.onTab = n => { if (prev) prev(n); if (n === 'sop') render(); };
  if (SX) SX.onChange(() => { QCACHE = null; if ($('#tab-sop') && $('#tab-sop').classList.contains('active')) render(); });
  window.SOP = { render, build, boqGroup };
})();
