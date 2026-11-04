/* Publish bar (owner only): everything imported in this browser is pushed to GitHub — under the right file names — so the
   public link shows it too. One commit per publish, unchanged files skipped, optional auto-publish after every import.
   Viewers: the page checks data/version.json every few minutes and offers a refresh when new data is published. */
(function () {
  'use strict';
  const A = window.APP;
  const $ = s => document.querySelector(s);
  const esc = A.esc;
  const TOK = 'trd_gh_token', AUTO = 'trd_pub_auto', HASH = 'trd_pub_hash';
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } } };
  const isAdmin = () => document.documentElement.classList.contains('admin');
  const repo = () => { const h = location.hostname.match(/^([^.]+)\.github\.io$/i), seg = location.pathname.split('/').filter(Boolean)[0]; return h && seg ? { o: h[1], r: seg } : { o: 'yehyaessam90-rgb', r: 'taif-road-dashboard' }; };
  const enc = s => new TextEncoder().encode(s);
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc(s)));
  const gitSha = async bytes => { const h = enc('blob ' + bytes.length + '\0'), all = new Uint8Array(h.length + bytes.length); all.set(h); all.set(bytes, h.length); return hex(await crypto.subtle.digest('SHA-1', all)); };
  const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const hashes = () => { try { return JSON.parse(ls.get(HASH) || '{}'); } catch (e) { return {}; } };

  // ---------------- what is only in this browser ----------------
  const idbRead = (db, store, key) => new Promise(res => { try { const r = indexedDB.open(db); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains(store)) return res(null); const q = d.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); }; r.onerror = () => res(null); } catch (e) { res(null); } });
  async function items() {
    const out = [];
    const x = A.localData && A.localData();
    if (x) out.push({ id: 'xlsx', label: 'Financial workbook (IPC / BOQ / spending)', path: 'data/project-data.xlsx', ...x });
    if (window.SCHEDX && SCHEDX.localData) out.push(...await SCHEDX.localData());
    if (window.WEEKLY && WEEKLY.localData) { const w = await WEEKLY.localData(); if (w) out.push({ id: 'weekly', label: 'Weekly reports', path: 'data/weekly.json', pubKey: x => JSON.stringify(JSON.parse(x).weeks), ...w }); }
    if (A.ipaLocal) { const v = await A.ipaLocal(); if (v) out.push({ id: 'ipa', label: 'Invoices — IPA Monthly Breakdown (' + v.name + ')', path: 'data/ipa-breakdown.xlsx', key: b64(v.bytes), bytes: () => v.bytes, bin: true }); }
    const site = await idbRead('trd_site', 'kv', 'site');
    if (site) { const t = JSON.stringify(site); out.push({ id: 'site', label: 'Site manpower & equipment sheet', path: 'data/site-resources.json', key: t, bytes: () => enc(t), pubKey: x => JSON.stringify(JSON.parse(x)) }); }
    const ev = ls.get('trd_events');
    if (ev) { const d = JSON.parse(ev), t = JSON.stringify(d.events); out.push({ id: 'events', label: 'Events (NCO letters)', path: 'data/events.json', key: t, pubKey: x => JSON.stringify(JSON.parse(x).events), bytes: () => enc(JSON.stringify(Object.assign({}, d, { updated: new Date().toISOString().slice(0, 10) }), null, 2)) }); }
    const H = hashes();
    let save = false;
    for (const it of out) {
      it.hash = await sha256(it.key); it.pending = H[it.id] !== it.hash;
      // the same content may already be on the site (published earlier, or uploaded by hand)
      if (it.pending && it.id !== 'xlsx' && (await pubHash(it)) === it.hash) { H[it.id] = it.hash; it.pending = false; save = true; }
    }
    if (save) ls.set(HASH, JSON.stringify(H));
    return out;
  }

  const PUBH = {};   // path → hash of the published file's comparable content (this page view)
  async function pubHash(it) {
    if (PUBH[it.path] === undefined) {
      PUBH[it.path] = null;
      try { const r = await fetch(it.path, { cache: 'no-store' }); if (r.ok) { const t = it.bin ? b64(new Uint8Array(await r.arrayBuffer())) : await r.text(); PUBH[it.path] = await sha256(it.pubKey ? it.pubKey(t) : t); } } catch (e) { }
    }
    return PUBH[it.path];
  }

  // a 401 / 403 / 404 from GitHub → say exactly what to change on the token
  async function diagnose(tok, err) {
    const { o, r } = repo(), H = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' };
    const fix = 'Open <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">github.com › Settings › Developer settings › Fine-grained tokens</a> → click the token → <b>Edit</b>';
    try {
      const u = await fetch('https://api.github.com/user', { headers: H });
      if (u.status === 401) return `✗ GitHub does not accept this token (wrong, expired or deleted). Create a new one and paste it with ⚙.`;
      const me = u.ok ? (await u.json()).login : '';
      const rp = await fetch(`https://api.github.com/repos/${o}/${r}`, { headers: H });
      if (me && me.toLowerCase() !== o.toLowerCase()) return `✗ The token belongs to the GitHub account <b>${esc(me)}</b>, but the site is in <b>${esc(o)}</b>. Sign in to GitHub as <b>${esc(o)}</b> and create the token there.`;
      if (!rp.ok) return `✗ The token cannot see the repository <b>${esc(r)}</b>. ${fix} → <b>Repository access</b>: choose <b>Only select repositories</b> and pick <b>${esc(r)}</b> → Save.`;
      return `✗ The token can <b>read</b> the repository but not <b>write</b> to it. ${fix} → <b>Repository access</b>: <b>Only select repositories</b> → <b>${esc(r)}</b> (not "Public repositories (read-only)"), then under <b>Permissions</b> click <b>＋ Add permissions</b> → tick <b>Contents</b> → set it to <b>Read and write</b> (Metadata stays Read-only — that is normal) → <b>Update</b>. The same token keeps working — no need to paste it again.`;
    } catch (e) { return '✗ ' + esc(err.message); }
  }

  // ---------------- GitHub ----------------
  async function commitFiles(tok, files, message, msg) {
    const { o, r } = repo();
    const gh = async (p, opt = {}) => {
      const res = await fetch(`https://api.github.com/repos/${o}/${r}${p}`, Object.assign({}, opt, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) } }));
      if (!res.ok) { let m = ''; try { m = (await res.json()).message; } catch (e) { } throw new Error(`GitHub ${res.status}${m ? ': ' + m : ''}`); }
      return res.json();
    };
    msg('Connecting to GitHub…');
    const ref = await gh('/git/ref/heads/main'), head = await gh('/git/commits/' + ref.object.sha);
    const all = await gh('/git/trees/' + head.tree.sha + '?recursive=1'), have = {};
    all.tree.forEach(t => { have[t.path] = t.sha; });
    const tree = [];
    for (const [i, f] of files.entries()) {
      const bytes = f.bytes();
      if (have[f.path] === await gitSha(bytes)) continue;   // already on the site
      msg(`Uploading ${i + 1} / ${files.length}: ${esc(f.label)} (${(bytes.length / 1048576).toFixed(1)} MB)…`);
      const b = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: b64(bytes), encoding: 'base64' }) });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
    }
    if (!tree.length) return 0;
    const vb = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: b64(enc(JSON.stringify({ rev: Date.now(), at: new Date().toISOString() }))), encoding: 'base64' }) });
    tree.push({ path: 'data/version.json', mode: '100644', type: 'blob', sha: vb.sha });
    msg('Creating the commit…');
    const t = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
    const c = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [ref.object.sha] }) });
    await gh('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
    return tree.length - 1;
  }

  // ---------------- publish everything ----------------
  let BUSY = false, AGAIN = false, LAST = '', ITEMS = [];
  async function publishAll(auto) {
    const tok = ls.get(TOK);
    if (!tok) { open(true); return; }
    if (BUSY) { AGAIN = true; return; }
    BUSY = true; draw();
    const msg = t => { LAST = t; const el = $('#pubMsg'); if (el) el.innerHTML = t; };
    try {
      let list = (await items()).filter(i => i.pending);
      const skipped = [];
      for (const i of list) if (i.guard && !(await i.guard())) skipped.push(i);
      list = list.filter(i => !skipped.includes(i));
      let n = 0;
      if (list.length) {
        n += await commitFiles(tok, list, 'Publish from the dashboard: ' + list.map(i => i.label).join(', '), msg);
        const H = hashes(); list.forEach(i => { H[i.id] = i.hash; delete PUBH[i.path]; }); ls.set(HASH, JSON.stringify(H));
      }
      if (window.JMEDIA && JMEDIA.pending()) { msg('Publishing junction presentations / photos…'); n += await JMEDIA.publish(tok, msg) || 0; }
      if (skipped.length) { LAST = skipped.map(i => `⚠ Not published: ${esc(i.label)} in this browser is ${esc(i.older)}.`).join('<br>'); BUSY = false; await refresh(); return; }
      LAST = `✓ ${auto ? 'Auto-published' : 'Published'} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${n ? ` — ${n} file${n === 1 ? '' : 's'}` : ' — the site already had everything'}. The public link shows it within 1–2 minutes.`;
    } catch (e) {
      LAST = /GitHub (401|403|404)/.test(e.message) ? await diagnose(tok, e) : '✗ ' + esc(e.message);
    }
    BUSY = false;
    await refresh();
    if (AGAIN) { AGAIN = false; publishAll(true); }
  }

  // ---------------- bar ----------------
  let OPEN = false;
  function open(v) { OPEN = v; draw(); }
  async function refresh() {
    if (!isAdmin()) return;
    try { ITEMS = await items(); } catch (e) { ITEMS = []; }
    draw();
  }
  function draw() {
    const bar = $('#pubBar');
    if (!bar) return;
    const tok = ls.get(TOK), auto = ls.get(AUTO) !== '0';
    const pend = ITEMS.filter(i => i.pending), jm = window.JMEDIA && JMEDIA.pending ? JMEDIA.pending() : 0;
    const names = pend.map(i => i.label).concat(jm ? [`Junction presentations / photos (${jm} change${jm === 1 ? '' : 's'})`] : []);
    const state = BUSY ? 'busy' : names.length ? 'pending' : 'ok';
    bar.className = 'pub-bar admin-only ' + state;
    bar.innerHTML = `<div class="pub-row">
        <span class="pub-ic">${state === 'busy' ? '⟳' : state === 'pending' ? '●' : '✓'}</span>
        <div class="pub-txt">${state === 'busy' ? '<b>Publishing to the site…</b>' : state === 'pending'
          ? `<b>${names.length} update${names.length === 1 ? ' is' : 's are'} only in this browser</b> — the public link does not show ${names.length === 1 ? 'it' : 'them'} yet: <span class="muted">${names.map(esc).join(' · ')}</span>`
          : '<b>The public link shows everything you see here.</b>'}
          <div id="pubMsg" class="small muted">${LAST}</div></div>
        <div class="pub-btns">
          ${tok ? `<label class="chk small" title="Publish automatically a few seconds after every import or change"><input type="checkbox" id="pubAuto" ${auto ? 'checked' : ''}> Auto-publish</label>` : ''}
          <button class="btn ${state === 'pending' ? 'primary' : 'ghost'}" id="pubNow" ${BUSY ? 'disabled' : ''}>⇪ ${tok ? 'Publish now' : 'Connect GitHub to publish'}</button>
          <button class="btn ghost" id="pubSet" title="GitHub connection">⚙</button>
        </div></div>
      ${OPEN || (!tok && state === 'pending') ? `<div class="pub-set">
        <p class="small"><b>Connect GitHub once</b> — then every import goes to the public link automatically (no downloading or uploading files):</p>
        <ol class="small"><li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com › Settings › Developer settings › Fine-grained tokens › Generate new token</a>.</li>
          <li>Repository access: <b>Only select repositories</b> → <code>taif-road-dashboard</code>. Permissions: <b>＋ Add permissions</b> → <b>Contents</b> → <b>Read and write</b> (Metadata stays Read-only). Choose an expiry (e.g. 1 year) → Generate.</li>
          <li>Copy the token (starts with <code>github_pat_</code>) and paste it here. It stays only in this browser.</li></ol>
        <div class="row-btns"><input type="password" id="pubTok" placeholder="github_pat_…" value="${esc(tok || '')}" autocomplete="off"><button class="btn primary" id="pubSave">Save & publish</button>${tok ? '<button class="btn ghost" id="pubForget">Disconnect</button>' : ''}</div></div>` : ''}`;
    const q = s => bar.querySelector(s);
    q('#pubNow').onclick = () => tok ? publishAll(false) : open(true);
    q('#pubSet').onclick = () => open(!OPEN);
    if (q('#pubAuto')) q('#pubAuto').onchange = e => { ls.set(AUTO, e.target.checked ? '1' : '0'); if (e.target.checked) changed(); };
    if (q('#pubSave')) q('#pubSave').onclick = () => { const v = q('#pubTok').value.trim(); if (!/^(github_pat_|ghp_)/.test(v)) { LAST = '✗ That does not look like a GitHub token (github_pat_…).'; return draw(); } ls.set(TOK, v); OPEN = false; publishAll(false); };
    if (q('#pubForget')) q('#pubForget').onclick = () => { ls.set(TOK, null); OPEN = false; LAST = 'GitHub disconnected in this browser.'; draw(); };
  }
  // modules call this after saving something locally
  let T = null;
  function changed() {
    if (!isAdmin()) return;
    clearTimeout(T);
    T = setTimeout(async () => { await refresh(); if (ls.get(TOK) && ls.get(AUTO) !== '0' && (ITEMS.some(i => i.pending) || (window.JMEDIA && JMEDIA.pending()))) publishAll(true); }, 2500);
  }

  // ---------------- viewers: new data published → offer a refresh ----------------
  let SEEN = null;
  async function poll() {
    try {
      const r = await fetch('data/version.json', { cache: 'no-store' });
      if (!r.ok) return;
      const v = (await r.json()).rev;
      if (SEEN === null) { SEEN = v; return; }
      if (v !== SEEN && !isAdmin() && !$('#newData')) {
        const b = document.createElement('div'); b.id = 'newData'; b.className = 'new-data';
        b.innerHTML = '🔄 <b>New data has been published.</b> <button class="btn primary">Refresh</button>';
        b.querySelector('button').onclick = () => location.reload();
        document.body.appendChild(b);
        if (document.hidden) location.reload();
      }
    } catch (e) { }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  setInterval(poll, 3 * 60 * 1000);

  window.PUBLISHER = { changed, refresh, publishAll, items };
  A.whenReady(() => { poll(); setTimeout(() => { refresh(); changed(); }, 4000); });
  // admin mode is switched on after the page loads (private link check)
  new MutationObserver(() => { if (isAdmin() && !ITEMS.length && !$('#pubBar').innerHTML) { refresh(); changed(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
})();
