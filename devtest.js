/* =====================================================================
   Insert Master: automatic UX tester (dev tool).
   Press the ` key to open it (there is no button for it), or open the page with ?dev=quick|standard|thorough|problems to start a run by itself.
   It clicks, types, switches tabs and presses keys on its own (about 10 actions a second, as many thousands as you like) while it checks that
   the app works (errors, state, numbers, the decoder's answers recomputed independently) and looks right (covered or cut-off controls, contrast,
   jank), then tells you what went right and wrong, with how to reproduce each problem and a guess at the cause.
   What it knows about Insert Master:
     inputs       the code box (valid ISO and ANSI codes, hyphen/space/lower-case variants, chipbreaker suffixes, and awkward text: empty, letters, negatives,
                  1e308, NaN, unicode, HTML), the sample buttons, the three tabs, the unit button, and the nine builder lists
     invariants   no NaN / undefined / Infinity / [object Object] anywhere in the page; the decoder's breakdown equals an independent recomputation
                  (ISO and ANSI fractions, inch and mm); the same insert typed in ISO and in ANSI gives the same sizes; the same code typed several ways gives the
                  same answer; inch and mm columns agree; the builder code is always valid and always decodes to what was chosen; typed text never becomes markup
     flows        sample tour, builder to decoder, shape sweep, units sweep, every letter, same insert two ways, awkward input, tab thrash, clear and refill, data audit
   Seeded: the same seed gives the same sequence of actions.
   Modes: Quick, Standard and Thorough follow a plan (every control, pairs, random runs, whole flows) with a percentage bar and a finishing time;
   "Aim at problems" remembers what broke before, replays it, hunts around the likeliest suspects and shrinks each failure to its shortest recipe;
   "Free run" is the open-ended mode. Runs keep going when the tab is in the background, and time can be sped up (10 or more actions a second).
   Browser storage: the app itself stores nothing; whatever is in localStorage / sessionStorage when a run starts is put back when it ends.
   ===================================================================== */
(() => {
'use strict';
if (window.DevTest) return;
const A = window.__devApi;
if (!A) return;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
const NOW = performance.now.bind(performance);   // the real clock: while a run is on, the page's own performance.now() can be sped up
const now = NOW;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------------------------------------------------------- keep running in the background, and speed
   A hidden tab gets no animation frames and its timers are held to one a second, so a run would crawl the moment you switched away. While a run
   is on, timers go through a Web Worker (its clock is not throttled), a frame request the browser does not answer while the page is hidden is
   answered from that clock, and a Web Lock keeps the browser from freezing the tab. `speed` runs the page's clock that many times faster so
   animations finish sooner; from 10x up, frames also come from the worker clock instead of waiting for the display. */
const BG = (() => {
  const native = { st: window.setTimeout, ct: window.clearTimeout, raf: window.requestAnimationFrame, caf: window.cancelAnimationFrame };
  let worker = null, nextId = 1, on = false, release = null, wasHidden = 0, K = 1, T0 = 0;
  const waits = new Map(), frames = new Map(), BASE = 1e9;
  const startWorker = () => {
    if (worker) return true;
    try {
      const url = URL.createObjectURL(new Blob(['self.onmessage=function(e){var d=e.data;setTimeout(function(){self.postMessage(d.id)},d.ms)}'], { type: 'text/javascript' }));
      worker = new Worker(url); worker.onmessage = (e) => { const f = waits.get(e.data); if (f) { waits.delete(e.data); f(); } }; worker.onerror = () => { worker = null; };
      return true;
    } catch (e) { worker = null; return false; }
  };
  const wait = (fn, ms) => { const id = nextId++; waits.set(id, fn); worker.postMessage({ id, ms }); return id; };
  const fast = () => T0 + (NOW() - T0) * K;
  const timeout = function (fn, ms) { const a = Array.prototype.slice.call(arguments, 2); if (typeof fn !== 'function' || !worker) return native.st.apply(window, arguments); return BASE + wait(() => fn.apply(window, a), Math.max(0, (+ms || 0) / K)); };
  const clear = (id) => { if (id >= BASE) waits.delete(id - BASE); else native.ct.call(window, id); };
  const frame = (cb) => {
    if (!worker) return native.raf.call(window, cb);
    const id = nextId++; let done = false, nat = 0;
    if (K >= 10) { wait(() => { if (done) return; done = true; frames.delete(id); cb(performance.now()); }, 4); frames.set(id, () => { done = true; }); return BASE + id; }
    const run = () => { if (done) return; done = true; frames.delete(id); if (nat) native.caf.call(window, nat); cb(performance.now()); };
    nat = native.raf.call(window, run);
    const tick = () => { if (done) return; if (document.hidden) { wasHidden++; run(); } else wait(tick, 50); }; wait(tick, 34);
    frames.set(id, () => { done = true; native.caf.call(window, nat); });
    return BASE + id;
  };
  const cancelFrame = (id) => { if (id >= BASE) { const c = frames.get(id - BASE); if (c) c(); frames.delete(id - BASE); } else native.caf.call(window, id); };
  return {
    start(speed) {
      if (on) return; on = true; wasHidden = 0; K = Math.max(1, Math.min(40, +speed || 1)); T0 = NOW();
      if (startWorker()) { window.setTimeout = timeout; window.clearTimeout = clear; window.requestAnimationFrame = frame; window.cancelAnimationFrame = cancelFrame; if (K > 1) performance.now = fast; }
      try { if (navigator.locks) navigator.locks.request('devtest-run', { mode: 'shared' }, () => new Promise((r) => { release = r; })).catch(() => {}); } catch (e) { /* ignore */ }
    },
    stop() {
      if (!on) return; on = false;
      try { delete performance.now; } catch (e) { /* ignore */ }
      window.setTimeout = native.st; window.clearTimeout = native.ct; window.requestAnimationFrame = native.raf; window.cancelAnimationFrame = native.caf;
      if (release) { release(); release = null; }
    },
    get active() { return on; }, get speed() { return K; }, get hiddenFrames() { return wasHidden; }, get turbo() { return K >= 10; },
  };
})();

/* ---------------------------------------------------------------- random */
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let rng = mulberry32(1);
const rf = (a = 0, b = 1) => a + (b - a) * rng(), ri = (a, b) => Math.floor(rf(a, b + 1)), chance = (p) => rng() < p, pick = (arr) => arr[Math.floor(rng() * arr.length)];
function wpick(items, w) { let t = 0; const ws = items.map((x, i) => (t += Math.max(0, w(x, i)))); let r = rng() * t; for (let i = 0; i < items.length; i++) { r -= Math.max(0, w(items[i], i)); if (r <= 0) return items[i]; } return items[items.length - 1]; }

/* ---------------------------------------------------------------- state */
const T = {
  live: { phase: '', scenario: '', stage: 'idle', kind: '', ctl: '', desc: '', diff: null, ms: 0, fmax: 0, fAvg: 0, cats: [], trace: [] },
  open: false, running: false, paused: false, seed: 1, rate: 10, max: 0, n: 0, sub: 0, t0: 0, tRun: 0, endReason: '',
  pass: 0, fail: 0, warn: 0, checks: new Map(),       // checks: name -> {runs, bad}
  kinds: new Map(),                                    // action kind -> {n, bad, ms:[], jank}
  issues: new Map(), log: [], recent: [], cur: null,
  cover: new Map(),                                    // control key -> {n, bad, label, kind}
  pairs: new Set(), lastKey: '', features: new Map(),
  downloads: [], blobs: new Map(), counters: { filePickerBlocked: 0, externalBlocked: 0, dialogs: 0, healed: 0, rejectedOk: 0, loadedOk: 0 },
  hits: 0, soft: 0, spec: {}, scenario: null, mode: 'free', plan: null, speed: 10,
  errs: [], toasts: [], toastSeq: 0, shifts: 0, longtasks: [], dts: [], base: 16, heap0: 0, mem0: null, lastRate: 0, rateWin: [], blank: 0, offscreen: 0, thumbs: 0,
};
const sevRank = { error: 3, warn: 2, info: 1 };

/* ---------------------------------------------------------------- findings */
const norm = (m) => String(m).replace(/0x[0-9a-f]+/gi, '0x#').replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').slice(0, 160);
function check(name, ok) { const c = T.checks.get(name) || { runs: 0, bad: 0 }; c.runs++; if (!ok) c.bad++; T.checks.set(name, c); return ok; }
function snap() { return null; }
function dumpState() {
  try { const i = $('#decoder-input'); return `tab ${tabNow()} · units ${A.getUnit()} · decoder box "${i ? i.value.slice(0, 40) : ''}" · builder ${$('#builder-output') ? $('#builder-output').textContent : ''}`; } catch (e) { return ''; }
}
function find(kind, sev, msg, extra = {}) {
  const sig = kind + '|' + norm(msg + (extra.where || ''));
  let it = T.issues.get(sig);
  if (!it) {
    if (T.issues.size > 600) return;
    it = { sig, kind, sev, msg: String(msg).slice(0, 400), count: 0, first: T.n, last: T.n, ctl: new Set(), actions: new Set(), repro: T.recent.slice(-12), seed: T.seed, state: dumpState(), diag: extra.diag || diagnose(kind, msg, extra), thumb: extra.thumb === false ? null : (kind.startsWith('visual') || kind === 'blank' ? snap() : null), stack: extra.stack || '' };
    it.trail = T.scenario ? T.scenario.slice() : null; it.key = sig;
    T.issues.set(sig, it); logLine(sev === 'error' ? 'bad' : 'warn', `#${T.n} ${kind}: ${it.msg}`);
  }
  it.count++; it.last = T.n; if (sev === 'error') T.hits++; else if (sev === 'warn' && !/^(jank|slow|layout-shift|leak)$/.test(kind)) T.soft++;
  if (T.cur) { it.actions.add(T.cur.kind); if (T.cur.ctl) it.ctl.add(T.cur.ctl); }
  if (sevRank[sev] > sevRank[it.sev]) it.sev = sev;
  if (T.cur) T.cur.bad.push(kind);
  return it;
}
function diagnose(kind, msg, x) {
  const m = String(msg);
  if (kind === 'js-error' || kind === 'promise') {
    const top = (x.stack || '').split('\n').slice(0, 3).map((l) => l.trim()).filter(Boolean).join(' <- ');
    if (/undefined|null/.test(m) && /read|reading|of/.test(m)) return 'A value was missing when the code used it (null or undefined). Likely a lookup of a letter or code that is not in the tables. ' + (top ? 'Look at: ' + top : '');
    if (/not a function/.test(m)) return 'Something was called that is not a function, often a handler wired to the wrong element. ' + (top ? 'Look at: ' + top : '');
    if (/NaN|Infinity|finite|Invalid array length|out of range|Invalid string length/i.test(m)) return 'A number went bad (NaN, Infinity or out of range). Check the input validation of whatever the last action fed in. ' + (top ? 'Look at: ' + top : '');
    return top ? 'Look at: ' + top : 'No stack was available; reproduce with the steps shown.';
  }
  if (kind === 'oracle') return 'The page showed something different from an independent recomputation (from the tables and the standards\' arithmetic). Either the page or the tester is wrong; compare the two values in the message.';
  if (kind === 'data') return 'The reference tables disagree with themselves (units, geometry or ANSI/ISO codes). Check the table data at the top of the script.';
  if (kind === 'state') return 'The app state disagrees with what the controls show (or itself). A handler changed one without updating the other.';
  if (kind === 'text-bad') return 'The text "NaN", "undefined", "null", "Infinity" or "[object Object]" is showing on the page. A value was missing or not a number when it was printed.';
  if (kind === 'input-validation') return 'An input that cannot describe a real insert was accepted and shown as if it were fine. Reject it with the "Invalid Format" message, or explain it.';
  if (kind === 'visual-covered') return 'Another element sits on top of this control, so a person could not click it. Check z-index, a stuck overlay, or panel overflow.';
  if (kind === 'visual-clipped') return 'This text is wider than its box and is cut off. Give it room, let it wrap, or add an ellipsis with a tooltip.';
  if (kind === 'visual-offscreen') return 'This control is partly outside the window or its panel, so it cannot be reached. Check the layout at this size.';
  if (kind === 'visual-overflow') return 'The page is wider than the window, so a horizontal scrollbar appears. Find the element that sticks out.';
  if (kind === 'visual-contrast') return 'Text color and its background are too close, so it is hard to read. Raise the contrast to at least 4.5:1 (3:1 for large text).';
  if (kind === 'visual-icon') return 'An icon rendered with no size, so the button shows nothing. The icon font or SVG did not load.';
  if (kind === 'jank' || kind === 'freeze') return 'A frame took far longer than normal right after this action: the main thread was busy (heavy rebuild, layout thrash, or a long synchronous loop). Break the work up.';
  if (kind === 'slow') return 'This kind of action takes a long time to finish. Add progress feedback or speed up the slow part.';
  if (kind === 'leak') return 'JavaScript memory keeps growing as the app is used. Something is kept alive that should be released.';
  if (kind === 'layout-shift') return 'Things on the page jumped around right after this action. Reserve space for content that appears later.';
  if (kind === 'a11y') return 'A control has no accessible name, so screen readers and tooltips cannot describe it. Add aria-label or visible text.';
  if (kind === 'storage') return 'The app wrote to (or removed from) localStorage / sessionStorage, or changed the address. The tester puts the original storage back when the run ends.';
  if (kind === 'xss') return 'Text typed into the app showed up as live HTML. Escape user text before putting it in innerHTML.';
  return '';
}
function logLine(cls, text) { T.log.push({ cls, text, t: Date.now() }); if (T.log.length > 800) T.log.splice(0, 200); }

/* ---------------------------------------------------------------- hooks */
const HK = { on: false, undo: [] };
function swap(obj, key, fn) { const o = obj[key]; obj[key] = fn(o); HK.undo.push(() => { obj[key] = o; }); }
const onErr = (e) => {
  if (!T.running) return;
  if (e.target && e.target !== window && e.target.tagName) { find('resource', 'warn', 'A resource failed to load: ' + (e.target.src || e.target.href || e.target.tagName), { where: e.target.src || e.target.href, thumb: false }); return; }
  find('js-error', 'error', e.message || 'Script error', { stack: e.error && e.error.stack });
};
const onRej = (e) => { if (T.running) find('promise', 'error', 'Unhandled promise rejection: ' + (e.reason && e.reason.message || e.reason), { stack: e.reason && e.reason.stack }); };
function hook() {
  if (HK.on) return; HK.on = true;
  window.addEventListener('error', onErr, true); window.addEventListener('unhandledrejection', onRej);
  HK.undo.push(() => { window.removeEventListener('error', onErr, true); window.removeEventListener('unhandledrejection', onRej); });
  swap(console, 'error', (o) => function () { if (T.running && !T.quiet) find('console-error', 'error', [...arguments].map((a) => (a && a.message) || String(a)).join(' ').slice(0, 300), { stack: arguments[0] && arguments[0].stack }); return o.apply(this, arguments); });
  swap(console, 'warn', (o) => function () { if (T.running && !T.quiet) find('console-warn', 'warn', [...arguments].map((a) => String(a)).join(' ').slice(0, 300), { thumb: false }); return o.apply(this, arguments); });
  swap(HTMLInputElement.prototype, 'click', (o) => function () { if (this.type === 'file') { T.counters.filePickerBlocked++; return; } return o.apply(this, arguments); });
  swap(URL, 'createObjectURL', (o) => function (b) { const u = o.call(URL, b); T.blobs.set(u, b); if (T.blobs.size > 20) T.blobs.delete(T.blobs.keys().next().value); return u; });
  swap(HTMLAnchorElement.prototype, 'click', (o) => function () {
    if (this.download) { T.downloads.push({ name: this.download, blob: T.blobs.get(this.href), n: T.n }); if (T.downloads.length > 30) T.downloads.shift(); return; }
    if (this.getAttribute('href') && !/^#/.test(this.getAttribute('href')) && (this.target && this.target !== '_self' || this.origin !== location.origin || this.pathname !== location.pathname)) { T.counters.externalBlocked++; return; }
    return o.apply(this, arguments);
  });
  swap(window, 'open', () => function () { T.counters.externalBlocked++; return null; });
  swap(History.prototype, 'pushState', (o) => function () { try { return o.apply(this, arguments); } catch (e) { /* ignore */ } });
  swap(window, 'alert', () => function () { T.counters.dialogs++; });
  swap(window, 'confirm', () => function () { T.counters.dialogs++; return true; });
  swap(window, 'prompt', () => function () { T.counters.dialogs++; return ''; });
  swap(Element.prototype, 'setPointerCapture', (o) => function () { try { return o.apply(this, arguments); } catch (e) { /* synthetic pointer ids have no capture */ } });
  swap(Element.prototype, 'releasePointerCapture', (o) => function () { try { return o.apply(this, arguments); } catch (e) { /* same */ } });
  // the tester must never leave the page: no link that goes anywhere but a spot on this page may be followed (the portfolio link has the same origin as the app, so checking the origin is not enough)
  const leaves = (a) => { try { const u = new URL(a.getAttribute('href'), location.href); return (a.target && a.target !== '_self') || (u.origin + u.pathname + u.search) !== (location.origin + location.pathname + location.search); } catch (e) { return true; } };
  const blockNav = (e) => { if (!T.running || e.isTrusted) return; const a = e.target && e.target.closest && e.target.closest('a[href]'); if (a && !a.hasAttribute('download') && leaves(a)) { e.preventDefault(); e.stopImmediatePropagation(); T.counters.externalBlocked++; } };
  const guard = (e) => { if (T.running) { e.preventDefault(); e.returnValue = 'The UX test is still running.'; return e.returnValue; } };
  window.addEventListener('beforeunload', guard); HK.undo.push(() => window.removeEventListener('beforeunload', guard));
  document.addEventListener('click', blockNav, true); HK.undo.push(() => document.removeEventListener('click', blockNav, true));
  const tt = $('#toasts');
  if (tt) { const mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) T.toasts.push({ seq: ++T.toastSeq, kind: n.classList.contains('err') ? 'err' : n.classList.contains('warn') ? 'warn' : 'ok', text: n.textContent.trim().slice(0, 200), n: T.n }); if (T.toasts.length > 60) T.toasts.shift(); }))); mo.observe(tt, { childList: true }); HK.undo.push(() => mo.disconnect()); }
  try { const po = new PerformanceObserver((l) => l.getEntries().forEach((en) => { if (en.hadRecentInput) return; T.shifts += en.value; })); po.observe({ type: 'layout-shift', buffered: false }); HK.undo.push(() => po.disconnect()); } catch (e) { /* not supported */ }
  try { const po = new PerformanceObserver((l) => l.getEntries().forEach((en) => { T.longtasks.push({ d: en.duration, n: T.n }); if (T.longtasks.length > 200) T.longtasks.shift(); })); po.observe({ type: 'longtask', buffered: false }); HK.undo.push(() => po.disconnect()); } catch (e) { /* not supported */ }
}
function unhook() { HK.undo.reverse().forEach((f) => { try { f(); } catch (e) { /* ignore */ } }); HK.undo = []; HK.on = false; }
// frame monitor: how long between frames, so a stall shows up as a long gap
const FM = { on: false, last: 0, max: 0 };
function fmLoop() { if (!FM.on) return; const t = NOW(); if (FM.last) { const dt = t - FM.last; T.dts.push(dt); if (T.dts.length > 900) T.dts.shift(); if (dt > FM.max) FM.max = dt; } FM.last = t; requestAnimationFrame(fmLoop); }

/* ---------------------------------------------------------------- the page's controls */
const root = () => $('#devtest');
const inDev = (el) => !!(el.closest && el.closest('#devtest'));
function visible(el) {
  if (!el.isConnected || inDev(el)) return false;
  const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.05) return false;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.02) return false; }
  return true;
}
function showing(el) {   // false when a scrolling or collapsing parent has pushed the control out of sight (it can't be tested right now)
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p); if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const a = p.getBoundingClientRect(); if (a.height < 1 && cs.overflowY !== 'visible') return false;
    if (cx < a.left - 1 || cx > a.right + 1 || cy < a.top - 1 || cy > a.bottom + 1) return false;
  }
  return true;
}
function ctlKey(el) {
  if (el.id) return '#' + el.id;
  const t = el.tagName.toLowerCase(), cls = (el.className && typeof el.className === 'string' ? el.className.split(/\s+/).filter((c) => c && !/^(hv|on|off|run|sm|big|primary|ghost|icon|dd-i)$/.test(c))[0] : '') || '';
  const d = el.dataset ? Object.entries(el.dataset).filter(([k]) => !/tip/.test(k)).slice(0, 1).map(([k, v]) => `[data-${k}=${String(v).slice(0, 14)}]`).join('') : '';
  const tx = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22);
  const par = el.closest('[id]') && el.closest('[id]') !== el ? '@' + el.closest('[id]').id : '';
  return t + (cls ? '.' + cls : '') + d + (tx ? `"${tx}"` : '') + par;
}
function kindOf(el) {
  const t = el.tagName;
  if (t === 'SELECT') return 'select'; if (t === 'TEXTAREA') return 'text';
  if (t === 'INPUT') { const y = el.type; return y === 'checkbox' || y === 'radio' ? 'check' : y === 'range' ? 'range' : y === 'number' ? 'number' : y === 'color' ? 'color' : y === 'file' ? 'file' : y === 'button' || y === 'submit' ? 'button' : 'text'; }
  if (t === 'A') return 'link';
  return 'button';
}
const SEL = 'button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=switch], [onclick], [tabindex]:not([tabindex="-1"])';
function scan() {
  const out = [], seen = new Set();
  $$(SEL).forEach((el) => {
    if (seen.has(el) || inDev(el)) return; seen.add(el);
    const k = kindOf(el);
    if (k === 'file') return;
    const hiddenNative = el.tagName === 'SELECT' && el.classList.contains('native');
    if (!hiddenNative && !visible(el)) return;
    if (el.tagName === 'LABEL' && el.querySelector('input')) return;   // the input itself is the target
    out.push({ el, k, key: ctlKey(el) });
  });
  return out;
}
function note(key, label, kind, bad) {
  let c = T.cover.get(key); if (!c) { c = { n: 0, bad: 0, label, kind }; T.cover.set(key, c); }
  c.n++; if (bad) c.bad++;
  if (T.lastKey && T.cover.size < 4000) T.pairs.add(T.lastKey + '>' + key);
  T.lastKey = key;
}
function seenControls(list) { list.forEach((c) => { if (!T.cover.has(c.key)) T.cover.set(c.key, { n: 0, bad: 0, label: c.key, kind: c.k }); }); }

/* ---------------------------------------------------------------- synthetic input */
function center(el) { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
function mev(type, x, y, o = {}) {
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, view: window, button: o.button || 0, buttons: o.buttons || 0, ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt, metaKey: false, detail: o.detail || 0 };
  return type.startsWith('pointer') ? new PointerEvent(type, Object.assign(base, { pointerId: o.id || 1, pointerType: o.type || 'mouse', isPrimary: o.primary !== false, width: 1, height: 1, pressure: o.buttons ? 0.5 : 0 })) : new MouseEvent(type, base);
}
function fire(target, type, x, y, o) { (target || document.body).dispatchEvent(mev(type, x, y, o)); }
function under(x, y) { return document.elementFromPoint(clamp(x, 0, innerWidth - 1), clamp(y, 0, innerHeight - 1)) || document.body; }
function pdown(el, x, y, o = {}) { const b = o.button || 0; const oo = Object.assign({ buttons: b === 2 ? 2 : b === 1 ? 4 : 1 }, o); fire(el, 'pointerdown', x, y, oo); fire(el, 'mousedown', x, y, oo); try { if (el.focus && /^(INPUT|BUTTON|TEXTAREA|SELECT)$/.test(el.tagName)) el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
function pmove(x, y, o = {}) { const t = under(x, y); fire(t, 'pointermove', x, y, o); fire(t, 'mousemove', x, y, o); }
function pup(el, x, y, o = {}) { const oo = Object.assign({ buttons: 0 }, o); fire(el, 'pointerup', x, y, oo); fire(el, 'mouseup', x, y, oo); }
async function realClick(el, o = {}) {
  try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ }
  const [x, y] = center(el), t = el.isConnected ? el : document.body;
  pmove(x, y); await raf();
  pdown(t, x, y, o); await raf(); pup(t, x, y, o);
  if (o.button === 2) fire(t, 'contextmenu', x, y, o); else fire(t, 'click', x, y, Object.assign({ detail: 1 }, o));
  if (o.dbl) { fire(t, 'dblclick', x, y, { detail: 2 }); }
}
function setValue(el, v) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, 'value'); d && d.set ? d.set.call(el, v) : (el.value = v);
}
function key(k, o = {}, target) {
  const t = target || document.activeElement || document.body, code = /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : /^\d$/.test(k) ? 'Digit' + k : k === ' ' ? 'Space' : k;
  const init = { key: k, code, bubbles: true, cancelable: true, composed: true, ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt, metaKey: false, view: window };
  t.dispatchEvent(new KeyboardEvent('keydown', init)); t.dispatchEvent(new KeyboardEvent('keyup', init));
}


/* ---------------------------------------------------------------- waiting and settling */
async function settle() { await raf(); await raf(); return true; }   // nothing in this app is asynchronous: two frames are enough for the page to finish drawing
function heal() { T.stuck = 0; }   // nothing in this app can get stuck open (no dialogs, no busy overlay)

/* ---------------------------------------------------------------- the app's tables, and an independent recomputation of what it should show */
const D = A.DATA, IC = A.IC_SERIES, SZ = A.SIZE_CODES, TH = A.THICKNESS, RAD = A.RADIUS, BS = A.buildState;
const BUILD_KEYS = ['shape', 'relief', 'tolerance', 'hole', 'size', 'thick', 'rad', 'edge', 'hand'];
const BUILD_ID = { shape: 'build-shape', relief: 'build-relief', tolerance: 'build-tolerance', hole: 'build-hole', size: 'build-size', thick: 'build-thickness', rad: 'build-radius', edge: 'build-edge', hand: 'build-hand' };
const inp = () => $('#decoder-input');
const tabNow = () => ['decoder', 'info', 'builder'].find((m) => { const p = $('#mode-' + m); return p && !p.classList.contains('hidden'); }) || '?';
const gcdI = (a, b) => (b ? gcdI(b, a % b) : a);
const fracOf = (f) => { const [n, d] = String(f).split('/').map(Number); return d ? n / d : n; };
const inchTxt = (n, d) => { if (n === 0) return '0.000"'; const g = gcdI(n, d), a = n / g, b = d / g; return `${(a / b).toFixed(3)}" (${b === 1 ? a : a + '/' + b}")`; };   // 3/16 -> 0.188" (3/16")
const inchTbl = (f) => (f === '0' ? '0.000"' : `${fracOf(f).toFixed(3)}" (${f}")`);   // a fraction already written in the table
const NOMINAL_THICK = { '1.2': [5, 64], '1.8': [7, 64] };   // the two decimal ANSI thickness digits are nominal 5/64" and 7/64"
const MM_TOL = 0.03;   // inch and mm columns are rounded separately, so allow this much
const SHAPE_FACTOR = { C: 1 / Math.sin(80 * Math.PI / 180), D: 1 / Math.sin(55 * Math.PI / 180), V: 1 / Math.sin(35 * Math.PI / 180), S: 1, R: 1, T: Math.sqrt(3) };   // cutting edge length / I.C.
function splitTailO(tail) {
  if (!tail) return {};
  if (tail.length <= 2 && D.edge[tail[0]] && (tail.length === 1 || D.hand[tail[1]])) return { edge: tail[0], hand: tail[1] };
  if (tail.length === 1 && D.hand[tail]) return { hand: tail };
  return { suffix: tail };
}
function oIso(code) {
  const m = /^([A-Z])([A-Z])([A-Z])([A-Z])(\d{2})(\d{2}|T\d)(\d{2}|M0)([A-Z]*)$/.exec(code); if (!m) return null;
  const [, sh, , , , size, thick, rad, tail] = m; if (rad === 'M0' && sh !== 'R') return null;
  if (+size === 0 || thick === '00') return null;   // a zero size or thickness is not an insert
  const dims = [];
  if (sh === 'R' && rad === 'M0') dims.push(['Diameter', `${(+size).toFixed(2)} mm`]);
  else if (SZ[sh]) { const i = SZ[sh].indexOf(size); dims.push([sh === 'R' ? 'Diameter' : 'Size (I.C.)', i < 0 ? `Non-standard code ${size} (≈ ${+size} mm edge)` : `${IC[i].mm.toFixed(2)} mm · ${inchTbl(IC[i].inch)}`]); }
  else dims.push(['Size (Edge Length)', `≈ ${+size} mm cutting edge`]);
  const t = TH.find((x) => x.iso === thick); dims.push(['Thickness', t ? `${t.mm.toFixed(2)} mm · ${inchTbl(t.inch)}` : `Unknown (${thick})`]);
  const r = RAD.find((x) => x.iso === rad), rm = r ? r.mm : parseInt(rad, 10) / 10;
  dims.push(['Nose Radius', rm === null ? 'None (round insert)' : rm === 0 ? 'Sharp (0.0 mm)' : `${rm.toFixed(1)} mm` + (r ? ` · ${inchTbl(r.inch)}` : '')]);
  return { iso: true, dims, zero: false, ...splitTailO(tail) };
}
function oAnsi(code) {
  const m = /^([A-Z])([A-Z])([A-Z])([A-Z])(\d(?:\.5)?)(\d(?:\.5)?|1\.[28])(\d)?([A-Z]*)$/.exec(code); if (!m) return null;   // thickness: whole or half sixteenths, or the nominal 1.2 / 1.8
  const [, sh, , , , size, thick, rad, tail] = m; if ((rad === undefined) !== (sh === 'R')) return null;
  if (parseFloat(size) === 0 || parseFloat(thick) === 0) return null;   // a zero size or thickness is not an insert
  const val = (a, b, mm) => ({ pre: inchTxt(a, b), mm: mm === undefined ? a / b * 25.4 : mm });
  const dims = [[sh === 'R' ? 'Diameter' : 'Size (I.C.)', val(Math.round(parseFloat(size) * 2), 16)]];
  const nom = NOMINAL_THICK[thick]; dims.push(['Thickness', nom ? val(nom[0], nom[1]) : val(Math.round(parseFloat(thick) * 2), 32)]);
  if (rad !== undefined) dims.push(['Nose Radius', +rad === 0 ? 'Sharp (0)' : val(+rad, 64)]);
  return { iso: false, dims, zero: +size === 0 || +thick === 0, ...splitTailO(tail) };
}
function oracle(raw0) {   // what the decoder should show for this text
  const raw = String(raw0).trim().toUpperCase(); if (raw === '') return { hidden: true };
  const segs = raw.split('-').map((x) => x.replace(/\s+/g, '')).filter(Boolean);
  let p = null, c = '', chip = '';
  for (let k = 1; k <= segs.length && !p; k++) { c = segs.slice(0, k).join(''); p = oIso(c) || oAnsi(c); chip = segs.slice(k).join('-'); }
  if (!p) return { invalid: true };
  const sh = D.shape[c[0]], rl = D.relief[c[1]], tl = D.tolerance[c[2]], ho = D.hole[c[3]];
  const cards = [['Shape', sh ? `${sh.desc} (${sh.angle})` : `Unknown (${c[0]})`], ['Relief', rl ? `${rl.desc} — ${rl.note}` : `Unknown (${c[1]})`], ['Tolerance', tl ? `${tl.desc} · IC: ${tl.ic}` : `Unknown (${c[2]})`], ['Type', ho ? ho.desc : `Unknown (${c[3]})`], ...p.dims];
  if (p.edge) cards.push(['Edge Condition', D.edge[p.edge].desc]);
  if (p.hand) cards.push(['Cutting Hand', D.hand[p.hand].desc]);
  const suffix = [p.suffix, chip].filter(Boolean).join('-'); if (suffix) cards.push(['Chipbreaker / Suffix', `${suffix} (manufacturer-specific)`]);
  return { cards, badge: p.iso ? 'Metric (ISO)' : 'Imperial (ANSI)', bcls: p.iso ? 'badge-iso' : 'badge-ansi', zero: p.zero, code: c, iso: p.iso };
}
function readDecoder() {
  const res = $('#decoder-results'), b = $('#standard-badge'), g = $('#decode-grid');
  return { hidden: res.classList.contains('hidden'), badge: b.textContent, bcls: b.className, cards: $$('.decode-card', g).map((c) => ({ label: (c.querySelector('.decode-label') || {}).textContent, val: (c.querySelector('.decode-val') || {}).textContent })), empty: $('.decode-empty', g) ? $('.decode-empty', g).textContent : null, grid: g };
}
function sameVal(exp, got) {
  if (typeof exp === 'string') return exp === got;
  const m = /^(.*) · ([\d.]+) mm$/.exec(got || ''); return !!m && m[1] === exp.pre && Math.abs(+m[2] - exp.mm) <= MM_TOL;
}
const showVal = (v) => (typeof v === 'string' ? v : `${v.pre} · ${v.mm.toFixed(2)} mm`);
function diffCards(o, g) {   // '' when the page matches the oracle
  if (o.hidden) return g.hidden ? '' : 'results are showing while the code box is empty';
  if (g.hidden) return 'results are hidden although the code box has text';
  if (o.invalid) return g.badge === 'Invalid Format' && /badge-err/.test(g.bcls) && g.cards.length === 0 && g.empty && /Unsupported code structure/.test(g.empty) ? '' : `should say Invalid Format, shows badge "${g.badge}" with ${g.cards.length} cards`;
  if (g.badge !== o.badge || !g.bcls.includes(o.bcls)) return `badge should be "${o.badge}", shows "${g.badge}" (${g.bcls})`;
  if (g.cards.length !== o.cards.length) return `should show ${o.cards.length} cards (${o.cards.map((c) => c[0]).join(', ')}), shows ${g.cards.length} (${g.cards.map((c) => c.label).join(', ')})`;
  for (let i = 0; i < o.cards.length; i++) { const [l, v] = o.cards[i], c = g.cards[i]; if (c.label !== l) return `card ${i + 1} should be "${l}", shows "${c.label}"`; if (!sameVal(v, c.val)) return `${l} should be "${showVal(v)}", shows "${c.val}"`; }
  return '';
}
const decoderDiff = () => diffCards(oracle(inp().value), readDecoder());
const ALLOWED_TAGS = /^(DIV|SPAN)$/;
function gridMarkup() {   // any tag inside the breakdown other than the app's own divs and spans means typed text became markup
  return $$('*', $('#decode-grid')).filter((e) => !ALLOWED_TAGS.test(e.tagName));
}

/* ---------------------------------------------------------------- browser storage: put it back the way it was */
const LS = { snap: null };
const storeDump = () => { const o = {}; for (const st of ['localStorage', 'sessionStorage']) { try { const s = window[st]; for (let i = 0; i < s.length; i++) { const k = s.key(i); if (!/^devtest/.test(k)) o[st + ':' + k] = s.getItem(k); } } catch (e) { /* blocked */ } } return o; };
function storeSnap() { LS.snap = { dump: storeDump(), url: location.href }; }
function storeRestore() {
  if (!LS.snap) return; const now0 = storeDump(), was = LS.snap.dump;
  for (const k of Object.keys(now0)) { const [st, key] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]; try { if (!(k in was)) window[st].removeItem(key); else if (was[k] !== now0[k]) window[st].setItem(key, was[k]); } catch (e) { /* ignore */ } }
  for (const k of Object.keys(was)) if (!(k in now0)) { const [st, key] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]; try { window[st].setItem(key, was[k]); } catch (e) { /* ignore */ } }
}

/* ---------------------------------------------------------------- oracles */
function expect(name, ok, msg, kind = 'oracle', sev = 'error') { if (!check(name, !!ok)) find(kind, sev, msg, { where: name, thumb: false }); return !!ok; }
const BAD_TEXT = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object \w+\]|\bnull\b/;
function checkState() {
  // 1. nothing that looks like a failed calculation is printed anywhere (hidden panels included)
  const w = document.createTreeWalker($('main') || document.body, NodeFilter.SHOW_TEXT); let badTxt = '';
  for (let n; (n = w.nextNode());) { const mt = BAD_TEXT.exec(n.nodeValue); if (mt && !(n.parentElement && inDev(n.parentElement))) { badTxt = n.nodeValue.trim().slice(0, 80); break; } }
  if (!check('no NaN / undefined / Infinity / null on the page', !badTxt)) find('text-bad', 'error', `The page shows a broken value: "${badTxt}"`, { where: badTxt.slice(0, 30), thumb: false });
  // 2. tabs
  const shown = ['decoder', 'info', 'builder'].filter((m) => !$('#mode-' + m).classList.contains('hidden')), act = ['decoder', 'info', 'builder'].filter((m) => $('#tab-' + m).classList.contains('tab-active'));
  expect('exactly one tab is showing, and it is the highlighted one', shown.length === 1 && act.length === 1 && shown[0] === act[0], `Panels showing: ${shown.join('+') || 'none'}; highlighted tabs: ${act.join('+') || 'none'}`, 'state', 'error');
  // 3. the decoder answers what an independent recomputation says
  const o = oracle(inp().value), g = readDecoder(), df = diffCards(o, g);
  if (!check('decoder breakdown equals the independent recomputation', !df)) find('oracle', 'error', `Decoding "${inp().value.slice(0, 60)}": ${df}`, { where: df.slice(0, 40) });
  else if (o.cards) feature('decoder answers recomputed');
  const mk = gridMarkup();
  if (!check('typed text never becomes markup', mk.length === 0 && !$$('main img, main script, main iframe, main [onerror], main [onload], main svg').some((e) => !inDev(e)))) find('xss', 'error', `Text typed into the code box became live HTML inside the breakdown: <${(mk[0] || { tagName: '?' }).tagName.toLowerCase()}> from "${inp().value.slice(0, 50)}"`, { where: 'decoder markup' });
  // inch and mm in every card agree
  g.cards.forEach((c) => { const m = /(\d+\.\d{3})"/.exec(c.val || ''), mm = /([\d.]+) mm/.exec(c.val || ''); if (m && mm && c.label !== 'Nose Radius') expect('inch and mm in the same card agree', Math.abs(+m[1] * 25.4 - +mm[1]) <= MM_TOL + 0.02, `${c.label} shows ${c.val}: ${m[1]}" is ${(+m[1] * 25.4).toFixed(2)} mm, not ${mm[1]} mm`); });
  // 4. the builder
  const code = BUILD_KEYS.map((k) => BS[k]).join('');
  BUILD_KEYS.forEach((k) => { const s = $('#' + BUILD_ID[k]); if (s && !check('every builder list shows the chosen value', s.value === BS[k] && s.options.length > 0)) find('state', 'error', `The ${k} list shows "${s.value}" (${s.options.length} options) but the builder state says "${BS[k]}"`, { where: 'builder ' + k, thumb: false }); });
  expect('the big code is built from the chosen options', $('#builder-output').textContent === code, `The Active Specification Code reads "${$('#builder-output').textContent}" but the options give "${code}"`, 'state');
  expect('every built code is a valid ISO code', !!oIso(code), `The builder produced "${code}", which is not a valid ISO insert code`, 'state');
  expect('round inserts use a round radius code, others do not', BS.shape === 'R' ? (BS.rad === 'M0' || BS.rad === '00') : BS.rad !== 'M0', `Shape ${BS.shape} with nose radius code ${BS.rad}`, 'state');
  const so = A.sizeOptions(BS.shape, BS.rad).map((x) => x.code), ro = A.radiusOptions(BS.shape).map((x) => x.code), opts = (id) => $$('option', $('#' + id)).map((x) => x.value);
  expect('the size list matches the shape', JSON.stringify(opts('build-size')) === JSON.stringify(so) && so.includes(BS.size), `Size list ${opts('build-size').join(',')} for shape ${BS.shape}/${BS.rad}, chosen ${BS.size}`, 'state');
  expect('the radius list matches the shape', JSON.stringify(opts('build-radius')) === JSON.stringify(ro) && ro.includes(BS.rad), `Radius list ${opts('build-radius').join(',')} for shape ${BS.shape}, chosen ${BS.rad}`, 'state');
  const dsc = { shape: BS.shape && D.shape[BS.shape] && (D.shape[BS.shape].angle === '—' ? 'Round — no point angle' : `Point angle: ${D.shape[BS.shape].angle}`), relief: D.relief[BS.relief] && D.relief[BS.relief].note, tolerance: D.tolerance[BS.tolerance] && `I.C. tolerance ${D.tolerance[BS.tolerance].ic} · Thickness tolerance ${D.tolerance[BS.tolerance].th}` };
  ['shape', 'relief', 'tolerance'].forEach((k) => expect('builder notes describe the chosen option', $('#desc-' + k).textContent === dsc[k], `The note under ${k} says "${$('#desc-' + k).textContent}", expected "${dsc[k]}"`, 'state'));
  // 5. units and reference tables
  const unit = A.getUnit(), ub = $('#unit-toggle-btn').textContent;
  expect('the unit button names the unit in use', ub === `Units: ${unit === 'ansi' ? 'ANSI (Inch)' : 'ISO (Metric)'}`, `Unit is ${unit} but the button says "${ub}"`, 'state');
  if ($('#table-thick tbody tr')) checkTables(unit);
  // 6. the app stores nothing and does not change the address
  if (LS.snap && T.n % 5 === 0) { const a = JSON.stringify(storeDump()), b = JSON.stringify(LS.snap.dump); expect('the app leaves browser storage and the address alone', a === b && location.href === LS.snap.url, a !== b ? 'The app changed localStorage / sessionStorage while it was being used' : `The address changed from ${LS.snap.url} to ${location.href}`, 'storage', 'warn'); }
}
const cellsOf = (id) => $$('#' + id + ' tbody tr').map((r) => $$('td', r).map((c) => c.textContent));
function checkTables(unit) {
  const fmt = (mm, inch) => (unit === 'ansi' ? inchTbl(inch) : `${mm.toFixed(2)} mm`), lab = unit === 'ansi' ? 'Inch' : 'Metric';
  expect('table unit headings follow the unit button', $$('.unit-label').every((e) => e.textContent === lab), `Unit headings read ${$$('.unit-label').map((e) => e.textContent).join('/')} but the unit is ${unit}`, 'state');
  const same = (id, rows, what) => { const got = cellsOf(id), ok = got.length === rows.length && rows.every((r, i) => r.length === got[i].length && r.every((c, j) => c === got[i][j])); if (!check(`the ${what} table matches its data`, ok)) { let i = got.findIndex((r, k) => !rows[k] || r.join('|') !== rows[k].join('|')); find('oracle', 'error', `The ${what} table: ${got.length} rows (expected ${rows.length}); first difference at row ${i + 1}: shows [${(got[i] || []).join(' | ')}], expected [${(rows[i] || []).join(' | ')}]`, { where: what + ' ' + unit, thumb: false }); } };
  same('table-thick', TH.map((t) => [t.iso, t.ansi, fmt(t.mm, t.inch)]), 'thickness');
  same('table-radius', RAD.map((r) => [r.iso, r.ansi, r.mm === null ? 'Round (metric)' : r.mm === 0 ? 'Sharp' : fmt(r.mm, r.inch)]), 'nose radius');
  same('table-size', IC.map((ic, i) => [fmt(ic.mm, ic.inch), ic.ansi, ...['C', 'D', 'S', 'T', 'W'].map((s) => SZ[s][i])]), 'size');
  same('table-shape', Object.entries(D.shape).map(([k, v]) => [k, v.desc, v.angle]), 'shape');
  same('table-relief', Object.entries(D.relief).map(([k, v]) => [k, v.desc, v.note]), 'relief');
  same('table-tolerance', Object.entries(D.tolerance).map(([k, v]) => [k, v.ic, v.th, v.desc]), 'tolerance');
  same('table-type', Object.entries(D.hole).map(([k, v]) => [k, v.desc]), 'insert type');
  same('table-edge', Object.entries(D.edge).map(([k, v]) => [k, v.desc]), 'edge condition');
  same('table-hand', Object.entries(D.hand).map(([k, v]) => [k, v.desc]), 'hand');
}
/* the data against the arithmetic of the standards: units, geometry and codes */
function staticAudit() {
  const ok = (c, m) => { if (!check('reference data is self-consistent', !!c)) find('data', 'error', m, { where: m.slice(0, 50), thumb: false }); };
  IC.forEach((ic, i) => { ok(Math.abs(fracOf(ic.inch) * 25.4 - ic.mm) < 0.01, `I.C. ${ic.inch}" is ${(fracOf(ic.inch) * 25.4).toFixed(3)} mm but the table says ${ic.mm}`); ok(Math.abs(+ic.ansi / 8 - fracOf(ic.inch)) < 1e-9, `ANSI size digit ${ic.ansi} means ${ic.ansi}/8" but the table says ${ic.inch}"`); if (i) ok(ic.mm > IC[i - 1].mm, `I.C. sizes are not increasing at ${ic.inch}"`); });
  TH.forEach((t, i) => { ok(Math.abs(fracOf(t.inch) * 25.4 - t.mm) <= MM_TOL, `Thickness ${t.iso}: ${t.inch}" is ${(fracOf(t.inch) * 25.4).toFixed(2)} mm but the table says ${t.mm}`); const nom = NOMINAL_THICK[t.ansi]; ok(Math.abs((nom ? nom[0] / nom[1] : parseFloat(t.ansi) / 16) - fracOf(t.inch)) < 1e-9, `ANSI thickness digit ${t.ansi} means ${nom ? nom.join('/') : t.ansi + '/16'}" but the table says ${t.inch}"`); if (i) ok(t.mm > TH[i - 1].mm, `Thickness values are not increasing at ${t.iso}`); });
  RAD.forEach((r, i) => { if (r.mm === null) return; ok(Math.abs(fracOf(r.inch) * 25.4 - r.mm) <= MM_TOL, `Nose radius ${r.iso}: ${r.inch}" is ${(fracOf(r.inch) * 25.4).toFixed(2)} mm but the table says ${r.mm}`); ok(Math.abs((r.ansi === '½' ? 0.5 : parseFloat(r.ansi)) / 64 - fracOf(r.inch)) < 1e-9, `ANSI radius digit ${r.ansi} means ${r.ansi}/64" but the table says ${r.inch}"`); if (r.iso !== '00') ok(Math.abs(parseInt(r.iso, 10) / 10 - r.mm) < 1e-9, `ISO radius code ${r.iso} should be ${parseInt(r.iso, 10) / 10} mm but the table says ${r.mm}`); if (i && RAD[i - 1].mm !== null) ok(r.mm > RAD[i - 1].mm, `Nose radius values are not increasing at ${r.iso}`); });
  Object.entries(SZ).forEach(([s, codes]) => { ok(codes.length === IC.length, `Shape ${s} has ${codes.length} ISO size codes for ${IC.length} I.C. sizes`); codes.forEach((c, i) => { if (i) ok(+c > +codes[i - 1], `Shape ${s} size codes are not increasing at ${c}`); if (SHAPE_FACTOR[s]) ok(Math.abs(+c - IC[i].mm * SHAPE_FACTOR[s]) < 1, `Shape ${s}, I.C. ${IC[i].inch}": ISO size code ${c} but the cutting edge is ${(IC[i].mm * SHAPE_FACTOR[s]).toFixed(1)} mm (I.C. x ${SHAPE_FACTOR[s].toFixed(3)})`); }); });
  const mr = A.METRIC_ROUND; mr.forEach((c, i) => { if (i) ok(+c > +mr[i - 1], `Metric round diameters are not increasing at ${c}`); });
  Object.entries({ H: 6, O: 8, P: 5, S: 4, T: 3 }).forEach(([s, n]) => ok(D.shape[s].angle === `${180 - 360 / n}°`, `Shape ${s} (${D.shape[s].desc}) has point angle ${D.shape[s].angle} but a regular ${n}-sided shape has ${180 - 360 / n}°`));
  Object.entries(D.shape).forEach(([s, v]) => { if (s !== 'R') ok(v.desc.includes(v.angle.replace('°', '')) || /Hexagonal|Octagonal|Pentagonal|Square|Rectangular|Triangular/.test(v.desc), `Shape ${s}: description "${v.desc}" does not mention its angle ${v.angle}`); });
  Object.entries({ N: 0, A: 3, B: 5, C: 7, D: 15, E: 20, F: 25, G: 30, P: 11 }).forEach(([l, deg]) => ok(D.relief[l] && D.relief[l].desc.startsWith(`${deg}°`), `Relief angle ${l} should be ${deg}° but the table says "${D.relief[l] && D.relief[l].desc}"`));
  Object.entries({ R: /Right/, L: /Left/, N: /Neutral/ }).forEach(([l, re]) => ok(D.hand[l] && re.test(D.hand[l].desc), `Hand ${l}: description "${D.hand[l] && D.hand[l].desc}" does not match`));
  ['shape', 'relief', 'tolerance', 'hole', 'edge', 'hand'].forEach((tb) => { const seen = new Map(); Object.entries(D[tb]).forEach(([k, v]) => { ok(/^[A-Z]$/.test(k), `${tb} key "${k}" is not a single capital letter`); if (!check('every letter has its own description', !seen.has(v.desc))) find('data', 'info', `${tb}: letters ${seen.get(v.desc)} and ${k} share the description "${v.desc}", so the decoder cannot tell them apart in words`, { where: tb + v.desc, thumb: false }); seen.set(v.desc, k); }); });
  Object.entries(D.tolerance).forEach(([k, v]) => ok(/^±\d/.test(v.ic) && /^±\d/.test(v.th), `Tolerance ${k} has odd values: ${v.ic} / ${v.th}`));
  feature('data audits');
}
function leakCheck() {
  if (performance.memory) { const mb = performance.memory.usedJSHeapSize / 1048576; if (!T.heap0) T.heap0 = mb; if (!check('JS memory stays bounded', mb < T.heap0 + 300)) find('leak', 'warn', `JS heap grew from ${T.heap0.toFixed(0)} MB to ${mb.toFixed(0)} MB`, { where: 'heap', thumb: false }); }
}
const feature = (n) => T.features.set(n, (T.features.get(n) || 0) + 1);

function lum(c) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
function parseRGBA(s) { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
function bgOf(el) { let a = el; const stack = []; while (a && a.nodeType === 1) { const cs0 = getComputedStyle(a); if (cs0.backgroundImage && cs0.backgroundImage !== 'none') return null; const c = parseRGBA(cs0.backgroundColor); if (c && c[3] > 0.05) { stack.push(c); if (c[3] >= 0.98) break; } a = a.parentElement; } let base = [10, 10, 12]; for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; base = base.map((v, k) => k < 3 ? c[k] * c[3] + v * (1 - c[3]) : 1); } return base; }
let scanBusy = false;
async function checkDom(deep) {
  if (scanBusy) return; scanBusy = true;
  const later = [];   // layout problems are only reported if they are still there a moment later (animations move things)
  const maybe = (kind, sev, msg, where, test) => { later.push({ kind, sev, msg, where, test }); };
  try {
    const modalOpen = !!$('.modal.on, #tut.on, #busy.on, #mobile.on');
    if (!check('page fits the window width', document.documentElement.scrollWidth <= innerWidth + 1)) maybe('visual-overflow', 'warn', `The page is ${document.documentElement.scrollWidth}px wide in a ${innerWidth}px window`, 'page', () => document.documentElement.scrollWidth > innerWidth + 1);
    const list = scan(); seenControls(list);
    const ids = new Map(); $$('[id]').forEach((e) => { if (!inDev(e)) ids.set(e.id, (ids.get(e.id) || 0) + 1); });
    ids.forEach((n, id) => { if (n > 1) find('a11y', 'warn', `The id "${id}" is used ${n} times on the page`, { where: id, thumb: false }); });
    const limit = deep ? 400 : 60, sample = deep ? list : list.filter(() => chance(Math.min(1, limit / Math.max(1, list.length))));
    sample.slice(0, limit).forEach(({ el, key: kk, k }) => {
      if (k === 'select' && el.classList.contains('native')) return;
      if (!visible(el) || !showing(el)) return;
      const r = el.getBoundingClientRect(), name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim() || el.getAttribute('alt') || (el.labels && el.labels[0] && el.labels[0].textContent.trim()) || el.dataset.tip || '';
      if (!check('every control has a name', !!name || el.type === 'hidden')) find('a11y', 'warn', `A ${k} has no accessible name: ${kk}`, { where: kk, thumb: false });
      const ico = el.querySelector('svg, i'); if (ico && !el.textContent.trim()) { const ir = ico.getBoundingClientRect(); if (!check('button icons render', ir.width > 1 && ir.height > 1)) find('visual-icon', 'warn', `The icon on ${kk} has no size`, { where: kk }); }
      if (!modalOpen && r.width > 2) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const coverTest = () => { if (!el.isConnected || !showing(el)) return false; const q = el.getBoundingClientRect(), x = q.left + q.width / 2, y = q.top + q.height / 2; if (x <= 0 || y <= 0 || x >= innerWidth || y >= innerHeight) return false; const top = document.elementFromPoint(x, y); coverTest.by = top; return !!top && !(top === el || el.contains(top) || top.contains(el) || el.tagName === 'LABEL' || top.closest('.dd-menu, #toasts, .tip, #devtest, .modal.on, #tut, #busy')); };
        if (cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight) {
          const covered = coverTest(); check('controls are not covered by something else', !covered);
          if (covered) maybe('visual-covered', 'warn', `${kk} is covered by ${coverTest.by ? ctlKey(coverTest.by) : 'something'}`, kk, coverTest);
        }
        const sideTest = () => { if (!el.isConnected) return false; const q = el.getBoundingClientRect(); return q.width > 2 && (q.right > innerWidth + 1 || q.left < -1); };
        const out = sideTest(); check('controls are inside the window', !out);
        if (out) maybe('visual-offscreen', 'warn', `${kk} sticks out of the window sideways (${Math.round(r.left)}..${Math.round(r.right)} of ${innerWidth})`, kk, sideTest);
      }
      const cs = getComputedStyle(el);
      const clipTest = () => el.isConnected && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'visible' && getComputedStyle(el).textOverflow !== 'ellipsis' && el.clientWidth > 0;
      if (name && !el.matches('input, textarea, select') && clipTest()) { check('text is not cut off', false); maybe('visual-clipped', 'warn', `Text is cut off in ${kk} (${el.scrollWidth}px of text in ${el.clientWidth}px)`, kk, clipTest); } else check('text is not cut off', true);
    });
    if (deep) {
      const tx = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim().length > 1 && n.parentElement && !inDev(n.parentElement) && !/^(SCRIPT|STYLE)$/.test(n.parentElement.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
      for (let n; (n = w.nextNode()) && tx.length < 250;) { const p = n.parentElement; if (p && visible(p) && showing(p)) tx.push(p); }
      new Set(tx).forEach((p) => {
        const cs = getComputedStyle(p), fg = parseRGBA(cs.color), bg = bgOf(p); if (!fg || !bg) return; if (/rgba\([^)]*,\s*0\)|transparent/.test(cs.webkitTextFillColor || '') || fg[3] < 0.05) return;   // outline text: the stroke is what shows
           // (a gradient or image behind the text can't be measured this way)
        const fl = lum(fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]))), bl = lum(bg), ratio = (Math.max(fl, bl) + 0.05) / (Math.min(fl, bl) + 0.05), big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.6 && +cs.fontWeight >= 700);
        const faint = p.closest('[disabled], .disabled, [aria-disabled=true], :disabled');
        const ok = !!faint || ratio >= 3; check('text is readable (contrast)', ok);
        if (!ok) maybe('visual-contrast', 'info', `Low contrast ${ratio.toFixed(1)}:1 for "${p.textContent.trim().slice(0, 30)}" in ${ctlKey(p)}`, ctlKey(p), () => { if (!p.isConnected) return false; const c2 = getComputedStyle(p), f2 = parseRGBA(c2.color), b2 = bgOf(p); if (!f2 || !b2) return false; const l1 = lum(f2.slice(0, 3).map((v, i) => v * f2[3] + b2[i] * (1 - f2[3]))), l2 = lum(b2); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) < 3; });
      });
      if (document.getAnimations().length > 250) find('jank', 'warn', 'More than 250 animations are running at once', { where: 'animations', thumb: false });
    }
    if (later.length) { await sleep(400); later.forEach((q) => { let still = false; try { still = q.test(); } catch (e) { /* element went away */ } if (still) find(q.kind, q.sev, q.msg, { where: q.where }); }); }
  } finally { scanBusy = false; }
}

/* ---------------------------------------------------------------- actions */
const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const AWKWARD = ['', ' ', '   ', 'a', 'x', '-', '--', '-CNMG432', 'CNMG432-', 'CNMG-432', 'CNMG-432-PM', 'cnmg120408en', 'CNMG 120408 EN', 'CNMG-120408-EN', ' CNMG120408EN ', 'CNMG120408EN-PM', 'CNMG120408EN-PM-X', 'CNMG120408EN--PM',
  'CNMG432-<img src=x onerror=alert(1)>', 'CNMG432-<b>bold</b>', 'CNMG432-<script>alert(1)</script>', 'CNMG432-&amp;', 'CNMG432-"quoted\'s"', 'CNMG120408<svg onload=alert(1)>', '<img src=x onerror=alert(1)>', '"><b>x</b>',
  'CNMG120408M0', 'RCMT1204M0', 'RCMT1204M0EN', 'RCMT09T3M0', 'RNMG1204', 'RNMG124', 'RNMG1243', 'CNMG4', 'CNMG43', 'CNMG4320', 'CNMG0', 'CNMG000', 'CNMG000000', 'CNMG0000', 'CNMG00', 'CCMT21.51', 'CCMT2.51', 'CCMT21.71', 'CCMT21.91', 'CCMT41.21', 'CCMT41.81', 'CCMT4.5', 'CNMG6.5', 'CNMG-1', 'CNMG-1e309', 'CNMG1e309', 'NaN', 'undefined', 'null', 'Infinity', '-Infinity', '1e309', '-1e308', '1e308', '-1', '0', '00000000', '0'.repeat(400), '9'.repeat(40),
  'CNMG120408' + 'X'.repeat(3000), 'CNMG432' + '-A'.repeat(500), 'ZZZZ999999', 'ZZZZ1204T4', 'XXXX12T308', 'CNMG12T308', 'CNMG120410', 'CNMG120499', 'CNMG120408ZZ', 'CNMG120408E', 'CNMG120408R', 'CNMG120408L', 'CNMG120408N', 'CNMG120408EN2', 'CNMG120408ENR', 'CNMG120408KR',
  '日本語', 'CNMG４３２', 'ＣＮＭＧ432', '😀🔩', 'ǅNMG432', 'ßNMG432', 'ﬃMG432', 'İNMG432', 'CNMG432\u0000', 'CNMG​432', '../../etc/passwd', 'a;b,c|d', "' OR 1=1 --", '${7*7}', '{{7*7}}', '%00%0a', '\\u0041'];
function awkward() { return pick(AWKWARD); }
function genIso() {
  const sh = chance(0.85) ? pick('CDEHKLMOPRSTVWAB'.split('')) : pick(LET.split('')), rl = chance(0.9) ? pick(Object.keys(D.relief)) : pick(LET.split('')), tl = chance(0.9) ? pick(Object.keys(D.tolerance)) : pick(LET.split('')), ho = chance(0.9) ? pick(Object.keys(D.hole)) : pick(LET.split(''));
  const rad = sh === 'R' && chance(0.7) ? 'M0' : pick(RAD.filter((r) => r.mm !== null).map((r) => r.iso).concat(['10', '99']));
  const size = SZ[sh] && chance(0.8) ? pick(SZ[sh]) : String(ri(0, 99)).padStart(2, '0'), thick = chance(0.85) ? pick(TH.map((t) => t.iso)) : chance(0.5) ? 'T' + ri(0, 9) : String(ri(0, 99)).padStart(2, '0');
  return sh + rl + tl + ho + size + thick + (rad === 'M0' && sh !== 'R' ? '08' : rad) + pick(['', '', 'E', 'EN', 'R', 'L', 'N', 'SL', 'FR', 'KN', 'ZR', 'PM', 'XX', 'EN-PM', '-PM', '-PM-X']);
}
function genAnsi() {
  const sh = chance(0.85) ? pick('CDEHKLMOPRSTVWAB'.split('')) : pick(LET.split('')), L = () => (chance(0.9) ? null : pick(LET.split('')));
  const size = pick(['1', '2', '2.5', '3', '4', '5', '6', '7', '8', '9', '0', '1.5']), thick = pick(['1', '1.2', '1.5', '1.8', '2', '2.5', '3', '3.5', '4', '5', '6', '7', '8', '9', '0', '1.7', '2.3', '4.9']), rad = sh === 'R' ? '' : String(ri(0, 9));
  return sh + (L() || pick(Object.keys(D.relief))) + (L() || pick(Object.keys(D.tolerance))) + (L() || pick(Object.keys(D.hole))) + size + thick + rad + pick(['', '', 'E', 'R', 'L', 'N', 'ER', 'SL', 'PM', '-PM', '-PM-X']);
}
function mutate(c) { const i = ri(0, Math.max(0, c.length - 1)), how = ri(0, 4); return how === 0 ? c.slice(0, i) + c.slice(i + 1) : how === 1 ? c.slice(0, i) + pick(LET.split('').concat('0123456789-. '.split(''))) + c.slice(i) : how === 2 ? c.slice(0, i) + pick(['0', '9', 'M0', 'T', '.', '-']) + c.slice(i + 1) : how === 3 ? c.toLowerCase() : c.slice(0, i); }
function codeText() { const r = rng(); return r < 0.3 ? genIso() : r < 0.5 ? genAnsi() : r < 0.7 ? mutate(chance(0.5) ? genIso() : genAnsi()) : r < 0.85 ? awkward() : pick(SAMPLES); }
async function typeCode(v) { const i = inp(); try { i.focus({ preventScroll: true }); } catch (e) { /* ignore */ } setValue(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); }
async function goTab(m) { const b = $('#tab-' + m); if (b) await realClick(b); await raf(); }
function setSel(s, v) { setValue(s, v); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
async function randomBuilder(n) { const keys = BUILD_KEYS.slice().sort(() => rng() - 0.5).slice(0, n); for (const k of keys) { const s = $('#' + BUILD_ID[k]); if (s && s.options.length) setSel(s, pick([...s.options]).value); } await raf(); }
async function aClick(c) {
  const o = {}; const r = rng(); if (r < 0.04) o.shift = true; else if (r < 0.07) o.ctrl = true; else if (r < 0.09) o.button = 2;
  await realClick(c.el, o);
}
async function aForm(c) {
  const el = c.el; const k = c.k; let d = '';
  if (k === 'select') { const opts = [...el.options]; const o = pick(opts); setValue(el, o.value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); d = o.text; }
  else if (k === 'range') { const mn = +el.min || 0, mx = +el.max || 100; const v = pick([mn, mx, (mn + mx) / 2, mn - 1, mx + 1]); setValue(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); d = String(v); }
  else if (k === 'number' || k === 'text') { const v = k === 'text' ? codeText() : pick(AWKWARD); el.focus && el.focus({ preventScroll: true }); setValue(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); if (chance(0.5)) el.blur(); d = v.slice(0, 30); }
  else if (k === 'check') { await realClick(el); d = el.checked ? 'on' : 'off'; }
  return d;
}
async function aDecode(spec) {
  const how = spec.code != null ? 'given' : pick(['iso', 'ansi', 'awkward', 'mutant', 'variant', 'sample']);
  let v = spec.code != null ? spec.code : how === 'iso' ? genIso() : how === 'ansi' ? genAnsi() : how === 'awkward' ? awkward() : how === 'mutant' ? mutate(chance(0.5) ? genIso() : genAnsi()) : how === 'sample' ? pick(SAMPLES) : variant(chance(0.5) ? genIso() : genAnsi());
  if (tabNow() !== 'decoder') await goTab('decoder');
  await typeCode(v); await raf(); return (how === 'given' ? '' : how + ' ') + JSON.stringify(v.length > 50 ? v.slice(0, 50) + '…' : v);
}
function variant(c) { const r = rng(); return r < 0.25 ? c.toLowerCase() : r < 0.5 ? c.replace(/^(.{4})(.{2})(.{2})/, '$1 $2 $3') : r < 0.75 ? '  ' + c + '  ' : c.replace(/^(.{4})/, '$1-'); }
async function aBuilder() { if (tabNow() !== 'builder') await goTab('builder'); const n = ri(1, 4); await randomBuilder(n); return `set ${n} list(s) → ${$('#builder-output').textContent}`; }
async function aTab() { const m = pick(['decoder', 'info', 'builder']); await goTab(m); return m; }
async function aUnits() { if (tabNow() !== 'info') await goTab('info'); await realClick($('#unit-toggle-btn')); return 'units → ' + A.getUnit(); }
const KEYS = [['Escape'], ['Enter'], ['Delete'], ['Backspace'], ['ArrowLeft'], ['ArrowRight'], ['ArrowUp'], ['ArrowDown'], ['Tab'], ['Tab', { shift: 1 }], [' '], ['?'], ['h'], ['u'], ['i'], ['1'], ['0'], ['+'], ['-'], ['z', { ctrl: 1 }], ['a', { ctrl: 1 }], ['c', { ctrl: 1 }], ['v', { ctrl: 1 }], ['PageUp'], ['PageDown'], ['Home'], ['End'], ['F1'], ['ContextMenu']];
function aKey() { const [k, o] = pick(KEYS); const tgt = document.activeElement && !inDev(document.activeElement) ? document.activeElement : document.body; key(k, o || {}, tgt); return (o && o.ctrl ? 'Ctrl+' : '') + (o && o.shift ? 'Shift+' : '') + (k === ' ' ? 'Space' : k); }
const SAMPLES = ['CNMG432', 'DNMG431', 'CNMG120408', 'CCMT09T304', 'TNMG160404ER', 'VNMG160408EL', 'CNMG120408EN', 'RCMT1204M0', 'CCMT21.51', 'TNMG160404-PM', 'CNMG120408RL'];
const shuffle = (a) => a.slice().sort(() => rng() - 0.5);
const typed = async (code) => { await typeCode(code); const df = decoderDiff(); return df; };
const mmOf = (shape, rad, size) => (shape === 'R' && rad === 'M0' ? +size : SZ[shape] && SZ[shape].indexOf(size) >= 0 ? IC[SZ[shape].indexOf(size)].mm : undefined);
const cardMap = (g) => Object.fromEntries(g.cards.map((c) => [c.label, c.val]));
const MACROS = {
  async 'sample tour'() {
    await goTab('decoder');
    for (const b of $$('.sample-btn').filter((x) => x.closest('#mode-decoder') && visible(x))) {
      const want = b.textContent.trim(); await realClick(b); await raf();
      expect('sample buttons fill the code box', inp().value === want, `Clicking the sample ${want} left "${inp().value}" in the box`, 'state');
      const g = readDecoder(); expect('samples decode as valid codes', !g.hidden && g.badge !== 'Invalid Format' && !g.cards.some((c) => /Unknown/.test(c.val)), `The sample ${want} does not decode cleanly (${g.badge}${g.cards.filter((c) => /Unknown/.test(c.val)).map((c) => ', ' + c.label + ' ' + c.val).join('')})`);
      expect('sample answers equal the recomputation', !decoderDiff(), `Sample ${want}: ${decoderDiff()}`);
    }
    for (const s of SAMPLES) { const df = await typed(s); const g = readDecoder(); expect('every documented example code decodes', !df && g.badge !== 'Invalid Format', `Example code ${s}: ${df || 'Invalid Format'}`); }
    feature('sample codes decoded');
  },
  async 'builder to decoder'() {
    await goTab('builder'); await randomBuilder(ri(3, 9)); checkState();
    const code = $('#builder-output').textContent; await realClick($('.builder-decode-btn')); await raf();
    expect('Open in decoder shows the decoder', tabNow() === 'decoder', `After "Open in decoder" the ${tabNow()} tab is showing`, 'state');
    expect('Open in decoder copies the code', inp().value === code, `The builder said ${code} but the decoder box holds "${inp().value}"`, 'state');
    const df = decoderDiff(); expect('a built code decodes to what the recomputation says', !df, `Built code ${code}: ${df}`);
    const by = cardMap(readDecoder()), sh = D.shape[BS.shape], t = TH.find((x) => x.iso === BS.thick), r = RAD.find((x) => x.iso === BS.rad);
    expect('the breakdown names the chosen shape, relief, tolerance and type', by.Shape === `${sh.desc} (${sh.angle})` && by.Relief === `${D.relief[BS.relief].desc} — ${D.relief[BS.relief].note}` && by.Tolerance && by.Tolerance.startsWith(D.tolerance[BS.tolerance].desc) && by.Type === D.hole[BS.hole].desc, `Builder chose ${code} but the breakdown says Shape "${by.Shape}", Relief "${by.Relief}", Type "${by.Type}"`);
    expect('the breakdown names the chosen edge and hand', by['Edge Condition'] === D.edge[BS.edge].desc && by['Cutting Hand'] === D.hand[BS.hand].desc, `Builder chose edge ${BS.edge} and hand ${BS.hand} but the breakdown says "${by['Edge Condition']}" / "${by['Cutting Hand']}"`);
    expect('the breakdown shows the chosen thickness and radius', by.Thickness && by.Thickness.startsWith(t.mm.toFixed(2)) && (r.mm === null ? by['Nose Radius'] === 'None (round insert)' : r.mm === 0 ? /^Sharp/.test(by['Nose Radius']) : by['Nose Radius'].startsWith(r.mm.toFixed(1))), `Builder chose thickness ${BS.thick} and radius ${BS.rad} but the breakdown says "${by.Thickness}" / "${by['Nose Radius']}"`);
    feature('builder codes opened in the decoder');
  },
  async 'shape sweep'() {
    await goTab('builder'); const sel = $('#build-shape');
    for (const s of shuffle(Object.keys(D.shape)).concat(['R', 'C', 'R', 'H', 'R'])) {
      const pre = { shape: BS.shape, size: BS.size, rad: BS.rad }, preMm = mmOf(pre.shape, pre.rad, pre.size);
      setSel(sel, s); await raf(); checkState();
      expect('choosing a shape applies it', BS.shape === s, `Chose shape ${s}, the builder holds ${BS.shape}`, 'state');
      expect('moving to or from round fixes the radius code', s === 'R' ? (BS.rad === 'M0' || BS.rad === '00') : BS.rad !== 'M0', `Shape ${pre.shape} → ${s}: radius code ${pre.rad} → ${BS.rad}`, 'state');
      if (pre.shape !== 'R' && s === 'R') expect('a round insert starts as a metric round', BS.rad === 'M0', `Shape ${pre.shape} → R: radius code ${BS.rad}, expected M0`, 'state');
      if (pre.shape === 'R' && s !== 'R') expect('leaving round restores a nose radius', BS.rad === '08', `Shape R → ${s}: radius code ${BS.rad}, expected 08`, 'state');
      const post = mmOf(BS.shape, BS.rad, BS.size), cand = A.sizeOptions(BS.shape, BS.rad).map((o) => o.mm).filter((v) => v !== undefined);
      if (preMm !== undefined && cand.length) { const best = Math.min(...cand.map((v) => Math.abs(v - preMm))); expect('changing shape keeps the same (or nearest) I.C.', post !== undefined && Math.abs(Math.abs(post - preMm) - best) < 1e-9, `Shape ${pre.shape} → ${s} (size ${pre.size} = ${preMm} mm): now size ${BS.size} = ${post} mm; the nearest available is ${best.toFixed(2)} mm away`, 'state'); }
    }
    feature('shape sweeps');
  },
  async 'radius and size sweep'() {
    await goTab('builder'); setSel($('#build-shape'), 'R'); await raf();
    for (const rd of shuffle(['M0', '00', 'M0', '00'])) { const pre = mmOf(BS.shape, BS.rad, BS.size); setSel($('#build-radius'), rd); await raf(); checkState(); expect('the round radius choice is applied', BS.rad === rd, `Chose radius ${rd}, holds ${BS.rad}`, 'state'); const cand = A.sizeOptions(BS.shape, BS.rad).map((o) => o.mm), post = mmOf(BS.shape, BS.rad, BS.size); if (pre !== undefined) expect('switching the round radius keeps the nearest diameter', post !== undefined && Math.abs(Math.abs(post - pre) - Math.min(...cand.map((v) => Math.abs(v - pre)))) < 1e-9, `Radius → ${rd}: size ${post} mm after ${pre} mm`, 'state'); }
    for (const k of ['size', 'thick', 'edge', 'hand', 'relief', 'tolerance', 'hole']) { const s = $('#' + BUILD_ID[k]); for (const o of shuffle([...s.options]).slice(0, 4)) { setSel(s, o.value); expect('each list applies its choice', BS[k] === o.value, `Chose ${k} = ${o.value}, holds ${BS[k]}`, 'state'); } }
    checkState(); feature('builder sweeps');
  },
  async 'units sweep'() {
    await goTab('info'); if (A.getUnit() !== 'ansi') { await realClick($('#unit-toggle-btn')); await raf(); }
    const ids = ['thick', 'radius', 'size'], grab = () => Object.fromEntries(ids.map((i) => [i, cellsOf('table-' + i)])), html = () => $$('#mode-info tbody').map((t) => t.innerHTML).join('|');
    const a1 = grab(), h1 = html(); await realClick($('#unit-toggle-btn')); await raf(); checkState(); const iso = grab(); expect('the button switches to metric', A.getUnit() === 'iso', `Unit is ${A.getUnit()} after one press`, 'state');
    await realClick($('#unit-toggle-btn')); await raf(); const h2 = html(); expect('two presses of Units return the tables to how they were', h1 === h2, 'The tables are different after switching units twice', 'state');
    const cmp = (id, col, label) => a1[id].forEach((r, i) => { const inch = /(\d+\.\d{3})"/.exec(r[col]), mm = /([\d.]+) mm/.exec((iso[id][i] || [])[col] || ''); if (inch && mm) expect('inch and metric tables agree', Math.abs(+inch[1] * 25.4 - +mm[1]) <= MM_TOL + 0.02, `${label} row ${i + 1}: ${r[col]} is ${(+inch[1] * 25.4).toFixed(2)} mm but the metric table says ${mm[1]} mm`); });
    cmp('thick', 2, 'Thickness'); cmp('radius', 2, 'Nose radius'); cmp('size', 0, 'Size');
    expect('both unit tables list the same rows', ids.every((i) => a1[i].length === iso[i].length && a1[i].every((r, k) => r[0] === iso[i][k][0] || i === 'size')), 'The inch and metric tables list different codes', 'state');
    staticAudit(); feature('unit sweeps');
  },
  async 'every letter'() {
    await goTab('decoder'); const base = 'CNMG120408EN', parts = [[0, 'shape'], [1, 'relief'], [2, 'tolerance'], [3, 'hole']];
    let n = 0; for (const [pos, tb] of parts) for (const l of Object.keys(D[tb]).concat(['X', 'Y'])) { const code = base.slice(0, pos) + l + base.slice(pos + 1), df = await typed(code); expect('every letter in every position decodes correctly', !df, `${code}: ${df}`); if (++n % 10 === 0) await raf(); }
    for (const e of Object.keys(D.edge)) for (const h of ['', ...Object.keys(D.hand)]) { const code = 'CNMG120408' + e + h, df = await typed(code), by = cardMap(readDecoder()); expect('every edge and hand letter decodes correctly', !df && by['Edge Condition'] === D.edge[e].desc && (!h || by['Cutting Hand'] === D.hand[h].desc), `${code}: ${df || 'wrong edge/hand text'}`); if (++n % 10 === 0) await raf(); }
    for (const h of Object.keys(D.hand)) { const df = await typed('CNMG120408' + h), by = cardMap(readDecoder()); expect('a lone hand letter is a hand', !df && by['Cutting Hand'] === D.hand[h].desc && !by['Edge Condition'], `CNMG120408${h}: ${df || 'lone letter taken as edge or suffix'}`); }
    feature('letters decoded');
  },
  async 'same insert two ways'() {
    await goTab('decoder'); const shapes = Object.keys(SZ).filter((s) => s !== 'W' || chance(0.5));
    for (let n = 0; n < 14; n++) {
      const sh = pick(shapes), i = ri(0, IC.length - 1), t = pick(TH), rd = pick(RAD.filter((r) => r.mm !== null && r.ansi !== '½')), rnd = sh === 'R';
      const iso = sh + 'NMG' + SZ[sh][i] + t.iso + (rnd ? '00' : rd.iso), ansi = sh + 'NMG' + IC[i].ansi + t.ansi + (rnd ? '' : rd.ansi);
      const d1 = await typed(iso), g1 = readDecoder(), d2 = await typed(ansi), g2 = readDecoder();
      expect('ISO and ANSI codes both decode', !d1 && !d2 && g1.badge === 'Metric (ISO)' && g2.badge === 'Imperial (ANSI)', `${iso} → ${d1 || g1.badge}; ${ansi} → ${d2 || g2.badge}`);
      const m1 = cardMap(g1), m2 = cardMap(g2), pick1 = (v) => ({ inch: ((/(\d+\.\d{3})"/.exec(v || '')) || [])[1], mm: +(((/([\d.]+) mm/.exec(v || '')) || [])[1]) });
      for (const lab of rnd ? ['Diameter', 'Thickness'] : ['Size (I.C.)', 'Thickness', 'Nose Radius']) { const x = pick1(m1[lab === 'Diameter' ? 'Diameter' : lab]), y = pick1(m2[lab]); if (/Sharp/.test(m1[lab] || '') && /Sharp/.test(m2[lab] || '')) continue; expect('the same insert in ISO and ANSI shows the same size', x.inch && x.inch === y.inch && Math.abs(x.mm - y.mm) <= MM_TOL, `${lab}: ISO ${iso} shows "${m1[lab]}", ANSI ${ansi} shows "${m2[lab]}"`); }
      for (const lab of ['Shape', 'Relief', 'Tolerance', 'Type']) expect('ISO and ANSI codes with the same letters describe the same insert', m1[lab] === m2[lab], `${lab}: "${m1[lab]}" (ISO ${iso}) vs "${m2[lab]}" (ANSI ${ansi})`);
      if (n % 4 === 3) await raf();
    }
    feature('ISO = ANSI comparisons');
  },
  async 'typed several ways'() {
    await goTab('decoder');
    for (let n = 0; n < 6; n++) {
      const c = chance(0.5) ? genIso() : genAnsi(); await typed(c); const ref = JSON.stringify(readDecoder().cards);
      for (const v of [c.toLowerCase(), '  ' + c + '  ', c.replace(/^(.{4})/, '$1 ')]) { await typeCode(v); const g = readDecoder(); expect('the same code typed with other case or spaces gives the same answer', JSON.stringify(g.cards) === ref && g.badge === (readDecoderBadge(c)), `"${c}" and "${v}" give different breakdowns`); }
    }
    feature('code variants compared');
  },
  async 'awkward input'() {
    await goTab('decoder'); let n = 0;
    for (const v of shuffle(AWKWARD)) { await typeCode(v); const df = decoderDiff(); expect('awkward text is decoded or refused correctly', !df, `"${v.slice(0, 50)}": ${df}`); checkState(); if (++n % 12 === 0) await raf(); }
    await typeCode(''); expect('clearing the box hides the results', readDecoder().hidden, 'Results are still showing after the code box was cleared');
    feature('awkward inputs');
  },
  async 'clear and refill'() {
    await goTab('decoder'); for (let n = 0; n < 5; n++) { const c = codeText(); await typeCode(c); const a = JSON.stringify(readDecoder().cards); await typeCode(''); expect('clearing hides the results', readDecoder().hidden, 'Results still showing after clearing'); await typeCode(c); expect('typing the same code again gives the same answer', JSON.stringify(readDecoder().cards) === a, `"${c.slice(0, 40)}" decodes differently the second time`); }
  },
  async 'tab thrash'() {
    await goTab('decoder'); const c = pick(SAMPLES); await typeCode(c);
    for (let i = 0; i < 14; i++) { await goTab(pick(['decoder', 'info', 'builder', 'info'])); if (chance(0.3)) { const b = $('#unit-toggle-btn'); if (b && visible(b)) await realClick(b); } checkState(); }
    expect('the code box keeps its text while other tabs are used', inp().value === c, `The decoder box held "${c}" and now holds "${inp().value}"`, 'state'); expect('the decoder answer survives tab changes', !decoderDiff(), decoderDiff());
  },
  async 'rapid fire'() { const list = scan().filter((c) => c.k !== 'link'); for (let i = 0; i < 25 && list.length; i++) { const c = pick(list); if (c.el.isConnected && visible(c.el)) { c.k === 'button' ? await realClick(c.el) : await aForm(c); note(c.key, c.key, c.k, false); } if (chance(0.5)) await raf(); } },
  async 'data audit'() { staticAudit(); },
};
function readDecoderBadge(c) { const o = oracle(c); return o.invalid ? 'Invalid Format' : o.badge; }
async function aMacro(forced) { const name = forced && MACROS[forced] ? forced : pick(Object.keys(MACROS)); T.sub++; await MACROS[name](); feature('macro: ' + name); return name; }

const KINDS = [
  ['click', 24, async (st) => { const c = T.spec.ctl ? st.list.find((q) => q.key === T.spec.ctl) : wpick(st.list.filter((q) => q.k === 'button' || q.k === 'link'), (q) => 1 / Math.pow(1 + (T.cover.get(q.key) ? T.cover.get(q.key).n : 0), 1.2)); if (!c) return null; T.cur.ctl = c.key; T.cur.desc = 'click ' + c.key; await aClick(c); note(c.key, c.key, c.k, false); return c.key; }],
  ['form', 18, async (st) => { const c = T.spec.ctl ? st.list.find((q) => q.key === T.spec.ctl) : wpick(st.list.filter((q) => ['select', 'range', 'number', 'text', 'check'].includes(q.k)), (q) => 1 / Math.pow(1 + (T.cover.get(q.key) ? T.cover.get(q.key).n : 0), 1.2)); if (!c) return null; T.cur.ctl = c.key; const d = await aForm(c); T.cur.desc = `${c.k} ${c.key} = ${d}`; note(c.key, c.key, c.k, false); return c.key; }],
  ['decode', 22, async () => { const d = await aDecode(T.spec); T.cur.desc = 'type ' + d; return null; }],
  ['builder', 10, async () => { const d = await aBuilder(); T.cur.desc = d; return null; }],
  ['tab', 5, async () => { const d = await aTab(); T.cur.desc = 'open the ' + d + ' tab'; return null; }],
  ['units', 4, async () => { const d = await aUnits(); T.cur.desc = d; return null; }],
  ['key', 7, async () => { const d = aKey(); T.cur.desc = 'key ' + d; return null; }],
  ['macro', 3, async () => { const d = await aMacro(T.spec.macro); T.cur.desc = 'macro: ' + d; return null; }],
  ['setup', 0, async () => { const d = await aSetup(T.spec.name); T.cur.desc = 'start from ' + d; return null; }],
];


/* ---------------------------------------------------------------- what is being tested right now */
const CATS = [['errors', /^(js-error|promise|console-error|resource)$/, 'no script errors, rejected promises or console errors'], ['answers', /^(oracle|data)$/, 'the decoder, builder and tables agree with an independent recomputation of the standards'], ['state', /^(state|storage)$/, 'tabs, units, builder lists and the code all agree with each other'], ['layout', /^visual-/, 'nothing is covered, clipped, off-screen or unreadable'], ['messages', /^(text-bad|xss|input-validation)$/, 'no NaN / undefined shown, typed text never becomes markup, impossible codes are refused'], ['smoothness', /^(jank|freeze|layout-shift)$/, 'no long freezes or jumping layout'], ['speed', /^slow$/, 'the action finished promptly'], ['memory', /^leak$/, 'JS memory stays bounded']];
function stateParts() {
  try {
    const i = inp(), g = readDecoder();
    return { 'tab': tabNow(), 'units': A.getUnit(), 'code box': i.value.slice(0, 40), 'decoder shows': g.hidden ? 'nothing' : g.badge, 'decoder cards': g.cards.length, 'builder': $('#builder-output').textContent };
  } catch (e) { return {}; }
}
const diffParts = (a, b) => Object.keys(b).filter((k) => a && a[k] !== b[k]);
const PURPOSE = { click: 'press the button and check it does its job (or nothing) without breaking the answers, the tabs or the layout', form: 'set the control the way a person (or a careless one) would and check the app applies it or refuses it politely, never showing NaN or going blank', decode: 'type a code (valid ISO or ANSI, a variant, a mutant or awkward text) and compare the breakdown with an independent recomputation', builder: 'change builder lists and check the code, the size and radius lists and the notes stay consistent and valid', tab: 'switch tabs and check exactly one panel shows and nothing is lost', units: 'switch between inch and metric and check every table follows', key: 'press the key and check nothing breaks', macro: 'run a whole journey of connected steps with checks along the way', setup: 'put the app into an awkward starting state before the next actions run' };

/* ---------------------------------------------------------------- one test */
async function oneAction(spec) {
  const outer = rng, aseed = spec && spec.seed != null ? spec.seed >>> 0 : Math.floor(outer() * 4294967296);
  rng = mulberry32(aseed); T.spec = spec || {};   // every action draws from its own seeded stream, so (kind, control, seed) replays it
  try { return await oneAction0(aseed); } finally { rng = outer; T.spec = {}; }
}
async function oneAction0(aseed) {
  T.n++; const n = T.n; const spec = T.spec;
  heal();
  let st = { list: scan() };
  if (spec.ctl && !st.list.some((q) => q.key === spec.ctl)) { const want = tabOfCtl(spec.ctl); if (tabNow() !== want) { await goTab(want); st = { list: scan() }; } }   // the control lives on a tab that is not showing: open it first
  seenControls(st.list);
  let kind = spec.kind ? KINDS.find((k) => k[0] === spec.kind) : wpick(KINDS, (k) => k[1]), cur = T.cur = { n, kind: kind[0], desc: kind[0], ctl: '', bad: [], seed: aseed };
  const stepRec = { kind: kind[0], seed: aseed }; if (spec.ctl) stepRec.ctl = spec.ctl; for (const k of ['name', 'code', 'macro', 'fuzz']) if (spec[k] !== undefined) stepRec[k] = spec[k]; if (T.scenario) T.scenario.push(stepRec); T.scenarioCtl = stepRec;
  const before = stateParts(); T.live.stage = 'doing it'; T.live.ctl = spec.ctl || ''; T.live.kind = kind[0]; T.live.desc = kind[0]; T.live.diff = null; T.live.cats = [];
  const tt0 = T.toastSeq, sh0 = T.shifts, lt0 = T.longtasks.length, t0 = now();
  FM.max = 0; T.expectedErrToasts = false; const dl0 = T.downloads.length;
  try { await kind[2](st); } catch (e) { find('js-error', 'error', 'Action threw: ' + (e && e.message), { stack: e && e.stack }); }
  T.live.stage = 'settling'; const ok = await settle();
  await raf(); if (!BG.turbo) await sleep(30);
  const ms = now() - t0;
  // oracles
  const ks = T.kinds.get(cur.kind) || { n: 0, bad: 0, ms: [], jank: 0 }; ks.n++; ks.ms.push(ms); if (ks.ms.length > 400) ks.ms.shift(); T.kinds.set(cur.kind, ks);
  checkState();
  if (n % 6 === 0) await checkDom(false);
  if (n % 60 === 0) await checkDom(true);
  if (n % 40 === 0) leakCheck();
  // toasts that said something went wrong
  T.toasts.filter((m) => m.seq > tt0 && m.kind === 'err').forEach((m) => { if (!T.expectedErrToasts && !check('no unexpected error messages', false)) find('toast-error', 'warn', 'The app showed an error message: ' + m.text, { where: m.text.slice(0, 40), thumb: false }); });
  // XSS: typed text must not become markup
  if ($$('img').some((i) => !inDev(i) && /^x$/i.test(i.getAttribute('src') || ''))) find('xss', 'error', 'Text typed or dropped into the app became live HTML (an <img src=x> exists)', { where: 'xss' });
  // smoothness
  const worst = FM.max, jank = Math.max(80, T.base * 3.2), freeze = Math.max(300, T.base * 9);
  if (!check('no long freezes', worst < freeze)) find('freeze', 'error', `The page froze for ${Math.round(worst)} ms after: ${cur.desc}`, { where: cur.kind + ':' + (cur.ctl || ''), thumb: false });
  else if (cur.kind !== 'macro' && !check('frames stay smooth', worst < jank)) { ks.jank++; find('jank', 'warn', `A frame took ${Math.round(worst)} ms (normal is ${Math.round(T.base)} ms) after: ${cur.kind}`, { where: cur.kind, thumb: false }); }
  const shift = T.shifts - sh0; if (!check('layout does not jump', shift < 0.25)) find('layout-shift', 'info', `The layout shifted (score ${shift.toFixed(2)}) after: ${cur.desc}`, { where: cur.kind + ':' + (cur.ctl || ''), thumb: false });
  const slow = cur.kind === 'macro' ? 30000 : 3000;
  if (!check('actions finish promptly', ms < slow)) find('slow', 'warn', `${cur.kind} took ${(ms / 1000).toFixed(1)} s: ${cur.desc}`, { where: cur.kind + ':' + (cur.ctl || ''), thumb: false });
  T.live.stage = 'checked'; T.live.desc = cur.desc; T.live.ctl = cur.ctl; T.live.diff = diffParts(before, stateParts()); T.live.ms = ms; T.live.fmax = worst; T.live.fAvg = T.dts.length ? T.dts.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, T.dts.length) : 0;
  T.live.cats = CATS.map(([cat, kinds, what]) => ({ cat, what, bad: cur.bad.filter((b) => kinds.test(b)).length })); T.live.trace.push({ at: Math.round((Date.now() - T.t0) / 100) / 10, text: cur.desc, changed: T.live.diff, ms: Math.round(ms), bad: cur.bad.length }); if (T.live.trace.length > 200) T.live.trace.shift();
  const bad = cur.bad.length > 0; if (bad) { T.fail++; ks.bad++; if (cur.ctl && T.cover.get(cur.ctl)) T.cover.get(cur.ctl).bad++; } else T.pass++;
  if (cur.ctl) stepRec.ctl = cur.ctl;
  T.recent.push(`#${n} ${cur.desc}`); if (T.recent.length > 40) T.recent.shift();
  logLine(bad ? 'bad' : 'ok', `#${n} ${cur.desc}${bad ? '  ⟵ ' + cur.bad.join(', ') : ''}`);
  T.cur = null;
}


/* ---------------------------------------------------------------- plans: Quick, Standard, Thorough, and Aim at problems */
const MODES = {
  quick: { label: 'Quick: about 250 actions, every control once, pairs, random runs and each whole flow', budget: 250 },
  standard: { label: 'Standard: about 900 actions with awkward values, pairs, random runs and every flow twice', budget: 900 },
  thorough: { label: 'Thorough: about 3000 actions, every control many times, thousands of pairs and runs, every flow', budget: 3000 },
  problems: { label: 'Aim at problems: scouts for suspects, replays old problems, spends most of its time on what is most likely to break, shrinks every failure', budget: 450, scoutShare: .14 },
  free: { label: 'Free run: the original open-ended run (your rate, max and seed below)', budget: 0 },
};
const SETUPS = {
  'the reference tab in metric': async () => { await goTab('info'); if (A.getUnit() !== 'iso') await realClick($('#unit-toggle-btn')); },
  'the reference tab in inches': async () => { await goTab('info'); if (A.getUnit() !== 'ansi') await realClick($('#unit-toggle-btn')); },
  'a round insert in the builder': async () => { await goTab('builder'); setSel($('#build-shape'), 'R'); },
  'an unusual shape in the builder': async () => { await goTab('builder'); setSel($('#build-shape'), pick(['H', 'K', 'L', 'O', 'P', 'A', 'B'])); },
  'a very long code': async () => { await goTab('decoder'); await typeCode('CNMG120408' + 'X'.repeat(3000)); },
  'an empty code box': async () => { await goTab('decoder'); await typeCode(''); },
  'markup in the code box': async () => { await goTab('decoder'); await typeCode('CNMG432-<img src=x onerror=alert(1)>'); },
  'an ANSI code': async () => { await goTab('decoder'); await typeCode('CNMG432'); },
  'an invalid code': async () => { await goTab('decoder'); await typeCode('NOPE'); },
  'a chipbreaker suffix': async () => { await goTab('decoder'); await typeCode('TNMG160404-PM'); },
};
async function aSetup(name) { const fn = SETUPS[name] || SETUPS[pick(Object.keys(SETUPS))]; await fn(); await settle(); return name; }
async function resetBaseline() {
  try {
    heal(); A.switchMode('decoder'); if (A.getUnit() !== 'ansi') A.toggleUnits();
    const init = { shape: 'C', rad: '08', relief: 'N', tolerance: 'M', hole: 'G', size: '12', thick: '04', edge: 'E', hand: 'N' };
    for (const k of ['shape', 'rad', 'relief', 'tolerance', 'hole', 'size', 'thick', 'edge', 'hand']) { const s = $('#' + BUILD_ID[k]); if (s && s.value !== init[k] && [...s.options].some((o) => o.value === init[k])) setSel(s, init[k]); }
    await typeCode('CNMG120408EN'); await settle();
  } catch (e) { find('js-error', 'error', 'Resetting the tester failed: ' + (e && e.message), { stack: e && e.stack }); }
}
const OFFSCREEN = [['#build-shape', 'select'], ['#build-relief', 'select'], ['#build-tolerance', 'select'], ['#build-hole', 'select'], ['#build-size', 'select'], ['#build-thickness', 'select'], ['#build-radius', 'select'], ['#build-edge', 'select'], ['#build-hand', 'select'], ['#unit-toggle-btn', 'button']];   // controls on tabs that are not showing right now
const tabOfCtl = (k) => (/^#build|builder/.test(k) ? 'builder' : /^#unit|table/.test(k) ? 'info' : 'decoder');
function targets() {
  const out = [], seen = new Set();
  OFFSCREEN.forEach(([id, k]) => { seen.add(id); out.push({ id, kind: k === 'select' ? 'form' : 'click', k, prior: k === 'select' ? 3.5 : 2 }); });
  scan().forEach((c) => { if (seen.has(c.key)) return; seen.add(c.key); const form = ['select', 'range', 'number', 'text', 'color', 'check'].includes(c.k); out.push({ id: c.key, kind: form ? 'form' : 'click', k: c.k, prior: c.k === 'number' || c.k === 'text' ? 5 : c.k === 'select' || c.k === 'range' ? 3.5 : c.k === 'color' ? 3 : c.k === 'check' ? 2.5 : c.k === 'dropdown' ? 3 : c.k === 'link' ? 1 : 2 }); });
  return out;
}
const PSEUDO = [['decode', 5], ['builder', 4], ['tab', 2], ['units', 2.5], ['macro', 3.5], ['key', 2]].map(([kind, prior]) => ({ id: 'kind:' + kind, kind, prior, pseudo: true }));
function stepFor(t, fuzz) {
  const st = { kind: t.kind, seed: Math.floor(rng() * 4294967296) };
  if (!t.pseudo) st.ctl = t.id; if (fuzz) st.fuzz = true;
  return st;
}
function planPhase(name, planned) { const now0 = NOW(); if (T.phaseName) { const ps = T.phases[T.phaseName]; ps.ms = now0 - T.phaseT0; ps.done = T.n - ps.n0; } T.phaseName = name; T.phaseT0 = now0; T.phases[name] = T.phases[name] || { n0: T.n, ms: 0, done: 0, planned }; T.live.phase = name; ui(); }
async function scenarioRun(name, steps) {
  await resetBaseline(); T.scenario = []; T.live.scenario = name; const h0 = T.hits, s0 = T.soft;
  for (const st of steps) { if (!T.running) break; await oneAction(st); if (T.hits > h0 + 8) break; }
  const done = T.scenario.slice(); T.scenario = null; return { hit: T.hits - h0, soft: T.soft - s0, done };
}
async function runPlanned(mode) {
  const M = MODES[mode], total = T.budgetOverride || M.budget; T.plan = { total, mode };
  const split = { 'every control': .34, 'pairs': .14, 'random runs': .30, 'flows': .22 }, planned = {}; Object.keys(split).forEach((k) => { planned[k] = Math.round(total * split[k]); T.plan[k] = planned[k]; });
  const ps = (name) => { planPhase(name, planned[name]); return T.n + planned[name]; };
  let target = ps('every control'); await resetBaseline();
  const all = targets().concat(PSEUDO); let i = 0, sinceReset = 0;
  while (T.running && T.n < target) { const t = all[i++ % all.length]; if (i % all.length === 1) all.sort(() => rng() - 0.5); await oneAction(stepFor(t, true)); if (++sinceReset >= 14) { sinceReset = 0; await resetBaseline(); } }
  target = ps('pairs');
  while (T.running && T.n < target) { const cs = targets().concat(PSEUDO); await scenarioRun('pair', [stepFor(pick(cs), true), stepFor(pick(cs), true)]); }
  target = ps('random runs');
  while (T.running && T.n < target) { const len = ri(3, 8); await scenarioRun('random run', Array.from({ length: len }, () => ({}))); }
  target = ps('flows');
  const flows = Object.keys(MACROS).map((m) => ({ kind: 'macro', macro: m })).concat(SAMPLES.map((s) => ({ kind: 'decode', code: s })), shuffle(AWKWARD).slice(0, 24).map((s) => ({ kind: 'decode', code: s })), [{ kind: 'units' }, { kind: 'tab' }, { kind: 'builder' }]);
  let f = 0; while (T.running && T.n < target) { const spec = Object.assign({}, flows[f++ % flows.length]); if (f % flows.length === 1) flows.sort(() => rng() - 0.5); await scenarioRun('flow: ' + (spec.macro || (spec.code != null ? 'type ' + JSON.stringify(String(spec.code).slice(0, 24)) : spec.kind)), [spec]); }
}

/* aim at problems: what is remembered, scouting, replay, hunting, shrinking */
const MEM = 'devtest-problems.v1';
const loadMem = () => { try { const o = JSON.parse(localStorage.getItem(MEM)); return o && typeof o === 'object' ? { ctl: o.ctl || {}, repros: o.repros || [] } : { ctl: {}, repros: [] }; } catch (e) { return { ctl: {}, repros: [] }; } };
const saveMem = (o) => { try { localStorage.setItem(MEM, JSON.stringify(o)); } catch (e) { /* ignore */ } };
async function runProblems() {
  const M = MODES.problems, total = T.budgetOverride || M.budget, mem = loadMem(); T.plan = { total, mode: 'problems' };
  const P = T.problems = { memory: { suspects: Object.keys(mem.ctl).length, repros: mem.repros.length }, replay: [], minimal: [], suspects: [], types: {}, aimed: 0, explore: 0, scouted: 0 };
  const scoutN = Math.round(total * M.scoutShare), replayN = Math.min(mem.repros.length, Math.round(total * .1)), shrinkN = 24, huntN = Math.max(20, total - scoutN - replayN - shrinkN);
  T.plan.scouting = scoutN; T.plan['replaying old problems'] = replayN; T.plan.hunting = huntN; T.plan['shrinking repros'] = shrinkN;
  const sus = new Map(), get = (t) => { let x = sus.get(t.id); if (!x) { const m = mem.ctl[t.id]; x = { t, id: t.id, label: t.id, prior: t.prior, mem: m ? m.score * .7 : 0, found: 0, hits: 0, uses: 0, bad: {} }; sus.set(t.id, x); } return x; };
  const weight = (x) => Math.pow(.5 + x.prior * .35 + x.mem + x.found, 1.6);
  const roulette = (list) => { let tot = 0; const w = list.map((x) => { const v = weight(x); tot += v; return v; }); let k = rng() * tot; for (let i = 0; i < list.length; i++) { k -= w[i]; if (k <= 0) return list[i]; } return list[list.length - 1]; };
  const idOf = (st) => st.ctl || 'kind:' + st.kind;
  const learn = (steps, hit, soft) => { for (const st of steps) { const x = sus.get(idOf(st)); if (!x) continue; x.uses++; if (hit) { x.found += 1.6; x.hits += hit; } else if (soft) x.found += .4; } if (hit && steps.length) { const x = sus.get(idOf(steps[steps.length - 1])); if (x) x.found += 2.4; } };
  const pool = mem.repros.map((r) => ({ steps: r.steps })), sig = (a) => a.map((x) => idOf(x) + '/' + (x.name || x.macro || x.example || '')).join('>');
  try {
    await resetBaseline();
    planPhase('scouting', scoutN);
    { const ts = targets().concat(PSEUDO); ts.forEach(get); const order = [...sus.values()].sort((a, b) => (b.prior + b.mem * 2 + (b.uses ? 0 : 1.5) + rng()) - (a.prior + a.mem * 2 + (a.uses ? 0 : 1.5) + rng()));
      let used = 0; for (const x of order) { if (used >= scoutN || !T.running) break; const st = stepFor(x.t, true); const res = await scenarioRun('scout: ' + x.id, [st]); used++; P.scouted++; learn(res.done, res.hit, res.soft); if (res.hit) pool.push({ steps: res.done }); } }
    planPhase('replaying old problems', replayN);
    { const keep = []; for (const old of mem.repros.slice(0, replayN)) { if (!T.running) break; const c0 = (T.issues.get(old.key) || { count: 0 }).count; const res = await scenarioRun('replay: ' + old.msg.slice(0, 60), old.steps); const still = res.hit > 0 || (T.issues.get(old.key) || { count: 0 }).count > c0; P.replay.push({ msg: old.msg, kind: old.kind, still, steps: old.steps.length }); if (still) { old.seen = (old.seen || 1) + 1; keep.push(old); pool.push({ steps: old.steps }); } }
      mem.repros = keep.concat(mem.repros.slice(replayN)); }
    planPhase('hunting', huntN);
    { const target = T.n + huntN; const setupNames = Object.keys(SETUPS);
      while (T.running && T.n < target) {
        const ts = targets().concat(PSEUDO); ts.forEach(get); const live = ts.map((t) => get(t));
        const withSetups = (steps) => (rng() < .5 ? Array.from({ length: rng() < .25 ? 2 : 1 }, () => ({ kind: 'setup', name: pick(setupNames), seed: Math.floor(rng() * 4294967296) })).concat(steps) : steps);
        const roll = rng(); let kind, steps = [];
        if (roll < .14) { kind = 'explore'; P.explore++; steps = withSetups(Array.from({ length: ri(3, 7) }, () => stepFor(pick(ts), true))); }
        else if (roll < .26 && pool.length) {
          kind = 'mutate'; P.aimed++; const base = pick(pool).steps.map((x) => Object.assign({}, x)); const how = ri(0, 4);
          if (how === 0 && base.length > 1) base.splice(ri(0, base.length - 1), 1); else if (how === 1) { const j = ri(0, base.length - 1); base[j].seed = Math.floor(rng() * 4294967296); base[j].fuzz = true; } else if (how === 2 && base.length > 1) { const j = ri(0, base.length - 2); [base[j], base[j + 1]] = [base[j + 1], base[j]]; } else if (how === 3) base.push(stepFor(roulette(live).t, true)); else base.forEach((x) => { x.seed = Math.floor(rng() * 4294967296); });
          steps = base;
        } else {
          P.aimed++; const x = roulette(live);
          if (roll < .5) { kind = 'pair'; const partner = rng() < .5 ? roulette(live).t : pick(ts); const a = stepFor(x.t, true), b = stepFor(partner, true); steps = withSetups(rng() < .5 ? [a, b] : [b, a]); }
          else if (roll < .72 && x.t.kind === 'form') { kind = 'fuzz'; steps = withSetups(Array.from({ length: ri(3, 6) }, () => stepFor(x.t, true))); }
          else { kind = 'chain'; steps = withSetups(Array.from({ length: ri(4, 8) }, () => stepFor(rng() < .65 ? roulette(live).t : pick(ts), true))); }
        }
        P.types[kind] = (P.types[kind] || 0) + 1;
        const res = await scenarioRun('hunt (' + kind + ')', steps); learn(res.done, res.hit, res.soft);
        if (res.hit && !pool.some((q) => sig(q.steps) === sig(res.done))) pool.push({ steps: res.done });
      } }
    planPhase('shrinking repros', shrinkN);
    { const errs = [...T.issues.values()].filter((i) => i.sev === 'error' && i.trail && i.trail.length > 1).sort((a, b) => b.count - a.count).slice(0, 6); let budget = shrinkN;
      for (const iss of errs) { if (!T.running || budget <= 0) break; let cur = iss.trail.map((x) => Object.assign({}, x)), j = 0;
        while (j < cur.length - 1 && budget > 0 && T.running) { const trial = cur.slice(0, j).concat(cur.slice(j + 1)); const c0 = (T.issues.get(iss.key) || { count: 0 }).count; budget--; await scenarioRun('shrink: ' + iss.msg.slice(0, 50), trial); if ((T.issues.get(iss.key) || { count: 0 }).count > c0) cur = trial; else j++; }
        iss.minimal = cur; P.minimal.push({ msg: iss.msg, from: iss.trail.length, to: cur.length, steps: cur.map((d) => idOf(d) + (d.name ? ' = ' + d.name : '') + (d.macro ? ' = ' + d.macro : '') + (d.example ? ' = ' + d.example : '')) }); } }
  } finally {
    for (const x of sus.values()) { const old = mem.ctl[x.id] ? mem.ctl[x.id].score * .75 : 0, score = Math.round((old + x.found) * 100) / 100; if (score > .2) mem.ctl[x.id] = { score, hits: (mem.ctl[x.id] ? mem.ctl[x.id].hits : 0) + x.hits }; else delete mem.ctl[x.id]; }
    for (const i of T.issues.values()) if (i.sev === 'error' && (i.minimal || i.trail) && !mem.repros.some((q) => q.key === i.key)) mem.repros.unshift({ key: i.key, kind: i.kind, msg: i.msg, steps: (i.minimal || i.trail).map((x) => Object.assign({}, x)), seen: 1 });
    mem.repros = mem.repros.slice(0, 40); saveMem(mem);
    P.suspects = [...sus.values()].filter((x) => x.uses || x.mem).map((x) => ({ id: x.id, prior: x.prior, score: Math.round((x.mem + x.found) * 100) / 100, hits: x.hits, remembered: x.mem > 0 })).sort((a, b) => (b.score - a.score) || (b.prior - a.prior)).slice(0, 12); P.measured = P.suspects.some((x) => x.score > 0);
  }
}

/* ---------------------------------------------------------------- run control */
async function calibrate() {
  FM.on = true; FM.last = 0; T.dts = []; requestAnimationFrame(fmLoop);
  await sleep(1100);
  const d = T.dts.slice(2).sort((a, b) => a - b); T.base = d.length ? d[Math.floor(d.length / 2)] : 16.7;
}
async function loop() {
  while (T.running) {
    if (T.paused || (document.hidden && !BG.active)) { await sleep(250); if (document.hidden && !T.hiddenWarned) { T.hiddenWarned = true; logLine('warn', 'The tab is in the background, so the browser slows timers. Keep this tab visible for 10 actions per second.'); } continue; }
    T.hiddenWarned = false; const t0 = now();
    try { await oneAction(); } catch (e) { find('js-error', 'error', 'Tester error: ' + (e && e.message), { stack: e && e.stack }); T.cur = null; }
    T.rateWin.push(now()); while (T.rateWin.length > 40) T.rateWin.shift();
    if (T.max && T.n >= T.max) { stop('reached ' + T.max + ' actions'); break; }
    if (T.duration && now() - T.tRun > T.duration * 1000) { stop('time limit'); break; }
    const wait = T.turbo ? 0 : Math.max(0, 1000 / T.rate - (now() - t0)); if (wait > 0) await sleep(wait); else await raf();
    if (T.n % 25 === 0) autosave();
  }
}
async function start(o = {}) {
  if (T.running) return;
  const pop = document.getElementById('alphaPop'), popGo = document.getElementById('alphaPopGo'); if (pop && popGo) { popGo.click(); await sleep(500); }   // the alpha testing popup would cover every control and fill the report with false warnings
  T.seed = o.seed != null ? +o.seed : (T.seed || 1); rng = mulberry32(T.seed >>> 0); T.rate = o.rate || T.rate || 10; T.max = o.max != null ? +o.max : T.max; T.duration = o.duration || 0; T.turbo = !!o.turbo; T.quiet = false;
  if (T.n === 0 || o.reset) resetStats(); T.running = true; T.paused = false; T.tEnd = 0; T.tRun = now(); T.t0 = T.t0 || Date.now(); T.endReason = '';
  storeSnap(); uiSnap();
  hook(); logLine('ok', `Started: seed ${T.seed}, ${T.turbo ? 'full speed' : T.rate + ' actions/s'}${T.max ? ', ' + T.max + ' actions' : ', until stopped'}`); ui();
  await calibrate(); if (!T.running) return;
  T.mode = MODES[o.mode] ? o.mode : 'free'; T.budgetOverride = o.budget || 0; T.speed = o.speed != null ? +o.speed : (T.mode === 'free' ? 1 : 10); T.phases = {}; T.phaseName = ''; T.plan = null; T.problems = null; T.live.trace = [];
  BG.start(T.speed);
  if (T.mode === 'free') { loop(); return; }
  try { if (T.mode === 'problems') await runProblems(); else await runPlanned(T.mode); } catch (e) { find('js-error', 'error', 'Tester error: ' + (e && e.message), { stack: e && e.stack }); }
  T.scenario = null; stop(T.running ? 'plan finished' : 'stopped');
}
function stop(why) { if (!T.running) return; storeRestore(); uiRestore(); if (T.phaseName && T.phases[T.phaseName]) { const ps = T.phases[T.phaseName]; ps.ms = NOW() - T.phaseT0; ps.done = T.n - ps.n0; } T.running = false; T.tEnd = now(); T.endReason = why || 'stopped'; FM.on = false; T.turboUsed = BG.turbo; T.bgFrames = BG.hiddenFrames; T.speedUsed = BG.speed; BG.stop(); unhook(); logLine('ok', 'Finished: ' + T.endReason); autosave(); ui(); }
let UI0 = null;
function uiSnap() { try { UI0 = { tab: tabNow(), unit: A.getUnit(), code: inp().value, bs: Object.assign({}, BS) }; } catch (e) { UI0 = null; } }
function uiRestore() {   // put the page back the way the person left it
  if (!UI0) return; try {
    for (const k of ['shape', 'rad', 'size', 'thick', 'relief', 'tolerance', 'hole', 'edge', 'hand']) { const s = $('#' + BUILD_ID[k]); if (s && s.value !== UI0.bs[k] && [...s.options].some((o) => o.value === UI0.bs[k])) setSel(s, UI0.bs[k]); }
    if (A.getUnit() !== UI0.unit) A.toggleUnits(); inp().value = UI0.code; A.decode(); A.switchMode(UI0.tab);
  } catch (e) { /* ignore */ }
}
function resetStats() {
  Object.assign(T, { n: 0, sub: 0, pass: 0, fail: 0, checks: new Map(), kinds: new Map(), issues: new Map(), log: [], recent: [], cur: null, cover: new Map(), pairs: new Set(), lastKey: '', features: new Map(), downloads: [], counters: { filePickerBlocked: 0, externalBlocked: 0, dialogs: 0, healed: 0, rejectedOk: 0, loadedOk: 0 }, toasts: [], shifts: 0, longtasks: [], mem0: null, heap0: 0, rateWin: [], thumbs: 0, t0: Date.now(), offscreen: 0, errCount: 0 });
  Object.assign(T, { hits: 0, soft: 0, phases: {}, phaseName: '', plan: null, problems: null, scenario: null, bgFrames: 0 }); T.live.trace = []; T.live.cats = []; T.live.diff = null;
}

/* ---------------------------------------------------------------- report */
const pct = (a, b) => (b ? Math.round(100 * a / b) : 0);
const fmtT = (ms) => { const s = Math.round(ms / 1000), m = Math.floor(s / 60); return m ? `${m} min ${s % 60} s` : `${s} s`; };
function build() {
  const dur = (T.running ? now() : T.tEnd || now()) - (T.tRun || now()), issues = [...T.issues.values()].sort((a, b) => sevRank[b.sev] - sevRank[a.sev] || b.count - a.count);
  const tot = [...T.cover.values()], hit = tot.filter((c) => c.n > 0), miss = tot.filter((c) => c.n === 0);
  const rate = T.rateWin.length > 2 ? (T.rateWin.length - 1) / ((T.rateWin[T.rateWin.length - 1] - T.rateWin[0]) / 1000) : (dur > 500 ? T.n / (dur / 1000) : 0);
  const dts = [...T.dts].sort((a, b) => a - b), p = (q) => dts.length ? dts[Math.min(dts.length - 1, Math.floor(q * dts.length))] : 0;
  const errs = issues.filter((i) => i.sev === 'error'), warns = issues.filter((i) => i.sev === 'warn'), infos = issues.filter((i) => i.sev === 'info');
  return { dur, issues, errs, warns, infos, tot, hit, miss, rate, p50: p(0.5), p95: p(0.95), p99: p(0.99), fps: dts.length ? 1000 / (dts.reduce((a, b) => a + b, 0) / dts.length) : 0 };
}
function reportText() {
  const R = build(), L = [];
  L.push('# Insert Master: automatic UX test report', '', `Seed ${T.seed} · ${T.n} actions (${T.sub} extra steps inside macros) in ${fmtT(R.dur)} · about ${R.rate.toFixed(1)} actions/s · ${T.endReason || (T.running ? 'still running' : 'stopped')}`, '');
  const verdict = R.errs.length ? 'NEEDS ATTENTION' : R.warns.length ? 'GOOD, WITH WARNINGS' : 'ALL CLEAR';
  L.push(`## Verdict: ${verdict}`, `- ${T.pass} of ${T.n} actions passed every check (${pct(T.pass, T.n)}%), ${T.fail} had a problem`, `- ${R.errs.length} errors, ${R.warns.length} warnings, ${R.infos.length} notes (distinct problems)`, `- Smoothness: ${R.fps.toFixed(0)} fps average, frame time typical ${R.p50.toFixed(0)} ms, 95th ${R.p95.toFixed(0)} ms, 99th ${R.p99.toFixed(0)} ms; ${T.longtasks.length} long tasks`, '');
  if (T.plan) L.push('', `Mode: ${MODES[T.mode].label.split(':')[0]} · plan of ${T.plan.total} actions · ${Object.keys(T.plan).filter((k) => !['total', 'mode'].includes(k)).map((k) => k + ' ' + Math.min(T.plan[k], (T.phases[k] || { done: 0 }).done || 0)).join(', ')}`);
  if (T.problems) { const P = T.problems; L.push('', '## Aimed at problems', `- ${T.n ? Math.round(100 * (T.n - P.scouted - P.explore) / T.n) : 0}% of the actions went to suspects (${Object.entries(P.types).map(([k, v]) => k + ' ' + v).join(', ')}); memory at the start: ${P.memory.suspects} suspect controls, ${P.memory.repros} old problems`,
    P.measured ? '- Suspects (score = what went wrong around them):' : '- Nothing went wrong, so there is no measured ranking. These are the controls the tester thinks most likely to break (a starting guess by kind of control):');
    P.suspects.forEach((x) => L.push(`    ${x.id}: ${P.measured ? 'score ' + x.score : 'likelihood about ' + x.prior + ' of 5'}, ${x.hits} problem(s)${x.remembered ? ' (remembered)' : ''}`));
    if (P.replay.length) { L.push('- Old problems, replayed:'); P.replay.forEach((x) => L.push(`    ${x.still ? 'STILL FAILING' : 'fixed'} [${x.kind}] ${x.msg.slice(0, 110)}`)); }
    if (P.minimal.length) { L.push('- Shortest recipes:'); P.minimal.forEach((x) => L.push(`    ${x.msg.slice(0, 100)} (${x.from} → ${x.to} steps): ${x.steps.join(' > ')}`)); } }
  if (T.turboUsed) L.push('', 'Note: this run used the sped-up clock with frames not tied to the display, so smoothness numbers are only a rough guide. Pick Real time for a true grade.');
  if (T.bgFrames) L.push('', `Note: the tab was in the background for part of the run (${T.bgFrames} frames came from a worker clock).`);
  L.push('## What went wrong');
  if (!R.issues.length) L.push('Nothing. Every check passed.');
  R.issues.forEach((i, k) => {
    L.push('', `### ${k + 1}. [${i.sev.toUpperCase()}] ${i.kind}: ${i.msg}`, `- Seen ${i.count} time${i.count > 1 ? 's' : ''}, first at action #${i.first}, last at #${i.last}${i.actions.size ? ' · during: ' + [...i.actions].join(', ') : ''}${i.ctl.size ? ' · controls: ' + [...i.ctl].slice(0, 4).join(', ') : ''}`);
    if (i.diag) L.push(`- Likely cause: ${i.diag}`);
    if (i.state) L.push('- App state when it first happened: ' + i.state);
    if (i.stack) L.push('- Stack: ' + i.stack.split('\n').slice(0, 4).map((l) => l.trim()).join(' | '));
    L.push(`- To reproduce (seed ${i.seed}), the last actions before it were:`, ...i.repro.slice(-8).map((r) => '    ' + r));
  });
  L.push('', '## What went right');
  [...T.checks.entries()].sort((a, b) => b[1].runs - a[1].runs).forEach(([n, c]) => L.push(`- ${c.bad ? '✗' : '✓'} ${n}: ${c.runs - c.bad} of ${c.runs} passed`));
  if (T.features.size) { L.push('', '## Features exercised'); [...T.features.entries()].filter(([k]) => !/^example: /.test(k)).forEach(([k, v]) => L.push(`- ${k}: ${v}`)); const ex = [...T.features.keys()].filter((k) => /^example: /.test(k)); if (ex.length) L.push(`- examples opened: ${ex.length} different (${ex.map((k) => k.slice(9)).join(', ')})`); }
  L.push('', '## Actions', ...[...T.kinds.entries()].map(([k, v]) => { const a = [...v.ms].sort((x, y) => x - y); return `- ${k}: ${v.n} run, ${v.bad} with problems, median ${Math.round(a[Math.floor(a.length / 2)] || 0)} ms, slowest ${Math.round(a[a.length - 1] || 0)} ms${v.jank ? ', ' + v.jank + ' janky' : ''}`; }));
  L.push('', '## Coverage', `- Controls found: ${R.tot.length}; used at least once: ${R.hit.length} (${pct(R.hit.length, R.tot.length)}%); different control-to-control combinations tried: ${T.pairs.size}`, `- Blocked safely: ${T.counters.filePickerBlocked} file pickers, ${T.counters.externalBlocked} external links, ${T.counters.dialogs} browser dialogs; stuck states healed: ${T.counters.healed}`);
  const worstCtl = R.tot.filter((c) => c.bad).sort((a, b) => b.bad - a.bad).slice(0, 8); if (worstCtl.length) L.push('- Controls involved in the most problems: ' + worstCtl.map((c) => `${c.label} (${c.bad})`).join('; '));
  if (R.miss.length) L.push(`- Not used yet (${R.miss.length}): ${R.miss.slice(0, 40).map((c) => c.label).join('; ')}${R.miss.length > 40 ? '; …' : ''}`);
  return L.join('\n');
}
function reportJSON() { const R = build(); return JSON.stringify({ mode: T.mode, plan: T.plan, problems: T.problems, seed: T.seed, actions: T.n, durationMs: Math.round(R.dur), rate: R.rate, pass: T.pass, fail: T.fail, issues: R.issues.map((i) => ({ kind: i.kind, severity: i.sev, message: i.msg, count: i.count, first: i.first, last: i.last, likelyCause: i.diag, stack: i.stack, state: i.state, during: [...i.actions], controls: [...i.ctl], repro: i.repro, thumb: i.thumb })), checks: Object.fromEntries([...T.checks.entries()].map(([k, v]) => [k, v])), kinds: Object.fromEntries([...T.kinds.entries()].map(([k, v]) => [k, { n: v.n, bad: v.bad, jank: v.jank }])), features: Object.fromEntries(T.features), coverage: { total: R.tot.length, used: R.hit.length, pairs: T.pairs.size, unused: R.miss.map((c) => c.label) }, smoothness: { fps: R.fps, p50: R.p50, p95: R.p95, p99: R.p99, longTasks: T.longtasks.length } }, null, 1); }
function autosave() { try { localStorage.setItem('devtest-report', JSON.stringify({ at: Date.now(), n: T.n, text: reportText() })); } catch (e) { /* ignore */ } }
function download(name, text, type) { const b = new Blob([text], { type }), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.dispatchEvent(new MouseEvent('click')); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }

/* ---------------------------------------------------------------- panel */
let el = null, tab = 'now', lastUi = 0;
const CSS = `#devtest{position:fixed;left:12px;bottom:12px;width:540px;max-width:calc(100vw - 24px);height:680px;max-height:calc(100vh - 24px);z-index:2147483000;display:flex;flex-direction:column;background:#0d0f13f2;color:#e8eaee;border:1px solid #2c323c;border-radius:12px;box-shadow:0 18px 60px #000a;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;resize:both;overflow:hidden;min-width:340px;min-height:220px}
#devtest *{box-sizing:border-box}#devtest .h{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #232831;cursor:move;user-select:none}#devtest .h b{font:700 12px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase}#devtest .h .sp{flex:1}
#devtest button{font:600 11px system-ui,sans-serif;color:#e8eaee;background:#1b2028;border:1px solid #333b47;border-radius:7px;padding:5px 9px;cursor:pointer}#devtest button:hover{border-color:#6c7a90}#devtest button.go{background:#1f6f43;border-color:#2e9d62}#devtest button.no{background:#7a2530;border-color:#b0404f}#devtest button.on{border-color:#7ab8ff;color:#7ab8ff}
#devtest input{font:11px ui-monospace,monospace;color:#e8eaee;background:#12161c;border:1px solid #333b47;border-radius:6px;padding:4px 6px;width:64px}#devtest label{display:flex;align-items:center;gap:4px;color:#98a2b3}
#devtest .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid #232831}#devtest .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#232831;border-bottom:1px solid #232831}#devtest .stats div{background:#0d0f13;padding:6px 8px}#devtest .stats b{display:block;font-size:15px}#devtest .stats span{color:#98a2b3;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
#devtest .tabs{display:flex;gap:4px;padding:6px 10px 0}#devtest .body{flex:1;overflow:auto;padding:8px 10px;white-space:pre-wrap;word-break:break-word}#devtest .ok{color:#7bd59a}#devtest .bad{color:#ff7b8a}#devtest .warn{color:#ffc766}#devtest .dim{color:#7b8696}#devtest .iss{border:1px solid #2c323c;border-radius:8px;padding:7px 9px;margin-bottom:7px;background:#12161c}#devtest .iss h4{margin:0 0 3px;font:700 11px system-ui,sans-serif}#devtest .iss img{display:block;margin-top:5px;border-radius:5px;max-width:100%}
#devtest>.h,#devtest>.row,#devtest>.stats,#devtest>.tabs,#devtest>.bar{flex:none}#devtest .body{flex:1 1 auto;min-height:0}#devtest .tabs{flex-wrap:wrap;padding-bottom:6px}
#devtest>#dtLabel,#devtest>#dtEta,#devtest>#dtPhases{flex:none}#devtest select{font:600 11px system-ui,sans-serif;color:#e8eaee;background:#1b2028;border:1px solid #333b47;border-radius:7px;padding:4px 6px}#devtest .bar{height:4px;background:#232831}#devtest .bar i{display:block;height:100%;background:#2e9d62}`;
function build_ui() {
  if (el) return;
  const st = document.createElement('style'); st.id = 'devtest-css'; st.textContent = CSS; document.head.appendChild(st);
  el = document.createElement('div'); el.id = 'devtest'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Automatic UX tester');
  el.innerHTML = `<div class="h"><b>UX tester</b><span class="dim">press ` + '`' + ` to hide</span><span class="sp"></span><button data-a="min" title="Collapse">–</button><button data-a="close" title="Hide (the test keeps running)">✕</button></div>
<div class="row"><select id="dtMode" title="What kind of run"><option value="quick">Quick</option><option value="standard">Standard</option><option value="thorough">Thorough</option><option value="problems">Aim at problems</option><option value="free" selected>Free run</option></select><select id="dtSpeed" title="How much faster than real time the page's animations and timers run. Faster means more actions per second."><option value="1">Real time</option><option value="4">4× faster</option><option value="10" selected>10× faster</option><option value="20">20× faster</option></select><button data-a="forget" title="Forget the suspects and problems remembered from earlier Aim at problems runs">Forget memory</button></div>
<div class="dim" id="dtLabel" style="padding:2px 10px"></div>
<div class="row"><button class="go" data-a="start">▶ Start</button><button data-a="pause" disabled>❚❚ Pause</button><button class="no" data-a="stop" disabled>■ Stop</button>
<label>per sec<input id="dtRate" type="number" min="1" max="60" value="10"></label><label>max<input id="dtMax" type="number" min="0" value="0" title="0 = keep going until stopped"></label><label>seed<input id="dtSeed" type="number" value="1"></label><label title="Ignore the rate and go as fast as the page allows"><input id="dtTurbo" type="checkbox" style="width:auto">turbo</label></div>
<div class="bar"><i id="dtBar" style="width:0%"></i></div>
<div class="dim" id="dtEta" style="padding:3px 10px"></div><div id="dtPhases" style="padding:0 10px"></div>
<div class="stats"><div><b id="dtN">0</b><span>actions</span></div><div><b id="dtP" class="ok">0</b><span>passed</span></div><div><b id="dtF" class="bad">0</b><span>failed</span></div><div><b id="dtR">0</b><span>per sec</span></div><div><b id="dtT">0s</b><span>running</span></div></div>
<div class="tabs"><button data-t="now" class="on">Now</button><button data-t="log">Live log</button><button data-t="issues">Problems <span id="dtI">0</span></button><button data-t="report">Report</button><button data-t="cover">Coverage</button></div>
<div class="body" id="dtBody"></div>
<div class="row"><button data-a="copy">Copy report</button><button data-a="md">Save .md</button><button data-a="json">Save .json</button><button data-a="clear">Clear</button><span class="dim" id="dtMsg"></span></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t) { tab = b.dataset.t; $$('.tabs button', el).forEach((x) => x.classList.toggle('on', x === b)); ui(true); return; }
    const a = b.dataset.a;
    if (a === 'forget') { try { localStorage.removeItem(MEM); } catch (e) { /* ignore */ } labelUi(); msg('Memory cleared'); }
    else if (a === 'start') start({ mode: $('#dtMode').value, speed: +$('#dtSpeed').value, seed: +$('#dtSeed').value || 1, rate: clamp(+$('#dtRate').value || 10, 1, 60), max: Math.max(0, +$('#dtMax').value || 0), turbo: $('#dtTurbo').checked, reset: T.n > 0 && !T.running });
    else if (a === 'stop') stop('stopped by you');
    else if (a === 'pause') { T.paused = !T.paused; b.textContent = T.paused ? '▶ Resume' : '❚❚ Pause'; }
    else if (a === 'close') toggle(false);
    else if (a === 'min') el.style.height = el.style.height === '40px' ? '680px' : '40px';
    else if (a === 'copy') { const t = reportText(); (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => msg('Report copied'), () => { tab = 'report'; ui(true); msg('Select and copy from the Report tab'); }); }
    else if (a === 'md') download('ux-test-report.md', reportText(), 'text/markdown');
    else if (a === 'json') download('ux-test-report.json', reportJSON(), 'application/json');
    else if (a === 'clear') { if (!T.running) { resetStats(); ui(true); } else msg('Stop the test first'); }
  });
  // drag by the header
  let drag = null; $('.h', el).addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; const r = el.getBoundingClientRect(); drag = { x: e.clientX - r.left, y: e.clientY - r.top }; el.setPointerCapture && e.isTrusted && el.setPointerCapture(e.pointerId); });
  addEventListener('pointermove', (e) => { if (!drag || !e.isTrusted) return; el.style.left = clamp(e.clientX - drag.x, 0, innerWidth - 100) + 'px'; el.style.top = clamp(e.clientY - drag.y, 0, innerHeight - 40) + 'px'; el.style.bottom = 'auto'; });
  addEventListener('pointerup', () => { drag = null; });
  el.addEventListener('keydown', (e) => e.stopPropagation());
  $('#dtMode', el).onchange = labelUi; labelUi();
  setInterval(() => { if (T.open && now() - lastUi > 400) ui(); }, 500);
}
const msg = (t) => { const m = $('#dtMsg'); if (m) { m.textContent = t; setTimeout(() => { m.textContent = ''; }, 2500); } };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmtDur = (ms) => { ms = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(ms / 3600), m = Math.floor(ms % 3600 / 60), sec = ms % 60; return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`; };
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
function labelUi() { const l = $('#dtLabel'), m = $('#dtMode'); if (!l || !m) return; let t = MODES[m.value].label; if (m.value === 'problems') { const mm = loadMem(); t += ` · remembered: ${Object.keys(mm.ctl).length} suspect controls, ${mm.repros.length} problems to replay`; } l.textContent = t; }
/* time left: phases already measured use their own average, the ones not reached yet use the average so far */
function estimate() {
  const plan = T.plan; if (!plan) return 0; const names = Object.keys(T.phases), allNames = Object.keys(plan).filter((k) => !['total', 'mode'].includes(k));
  const perAct = T.n > 4 ? (Date.now() - T.t0) / T.n : 800; let left = 0;
  for (const n of allNames) { const planned = plan[n], ps = T.phases[n]; if (!ps) { left += planned * perAct; continue; } const live = n === T.phaseName, done = live ? T.n - ps.n0 : ps.done, ms = live ? NOW() - T.phaseT0 : ps.ms; left += Math.max(0, planned - done) * (done >= 3 ? ms / done : perAct); }
  return left;
}
function etaText(total) {
  const R = build(), rate = T.n / Math.max(1, R.dur / 1000), tests = ' · ' + rate.toFixed(1) + ' actions per second' + (BG.speed > 1 && T.running ? ', time ×' + BG.speed : '');
  if (T.running && T.plan) { const left = estimate(), fin = Date.now() + left; T.finishAt = T.finishAt && T.n > 5 ? T.finishAt * 0.85 + fin * 0.15 : fin; return T.n < 3 ? 'estimating the finishing time…' : `${Math.round(Math.min(99.9, 100 * T.n / total))}% · about ${fmtDur(T.finishAt - Date.now())} left · done around ${clock(T.finishAt)}${tests}`; }
  if (!T.running && T.n && T.plan) return `${T.endReason || 'finished'} · took ${fmtDur(R.dur)}${tests}`;
  return T.running ? `running${tests}` : '';
}
function phasesHtml() { if (!T.plan) return ''; return Object.keys(T.plan).filter((k) => !['total', 'mode'].includes(k)).map((n) => { const ps = T.phases[n], planned = T.plan[n], done = !ps ? 0 : (n === T.phaseName && T.running ? T.n - ps.n0 : ps.done); return `<div style="display:flex;gap:8px;align-items:center;font-size:11px"><span style="width:130px">${esc(n)}</span><span style="width:64px" class="dim">${Math.min(done, planned)} / ${planned}</span><div class="bar" style="flex:1"><i style="width:${Math.min(100, 100 * done / Math.max(1, planned))}%"></i></div></div>`; }).join(''); }
function nowHtml() {
  const L = T.live, row = (k, v) => (v === '' || v == null ? '' : `<tr><td style="color:#98a2b3;white-space:nowrap;padding-right:10px;vertical-align:top">${k}</td><td>${v}</td></tr>`);
  if (!T.n && !T.running) return '<span class="dim">Press Start. This tab shows exactly what is being tested at each moment, and why.</span>';
  const chips = L.cats.length ? L.cats.map((c) => `<span title="${esc(c.what)}" class="${c.bad ? 'bad' : 'ok'}" style="border:1px solid #33333f;border-radius:9px;padding:0 6px;margin:1px 3px 1px 0;display:inline-block">${c.bad ? '✗' : '✓'} ${esc(c.cat)}</span>`).join('') : '<span class="dim">runs after the action settles</span>';
  const exp = L.kind === 'form' ? 'the control ends up with a valid value or its old one, and nothing shows NaN' : L.kind === 'decode' ? 'the breakdown equals the independent recomputation (or Invalid Format for an impossible code), with no markup from typed text' : L.kind === 'builder' ? 'the big code, the lists and the notes agree and the code is valid' : L.kind === 'units' ? 'every table switches between inch and metric and the two agree' : '';
  const fr = L.fmax ? `${Math.round(L.ms)} ms · frames avg ${L.fAvg.toFixed(1)} ms, worst ${Math.round(L.fmax)} ms` : '';
  return `<table>${row('Phase', esc(L.phase) + (T.plan && T.phases[L.phase] ? ` · ${Math.min(T.plan[L.phase] || 0, T.n - T.phases[L.phase].n0)} of ${T.plan[L.phase] || 0}` : ''))}${row('Scenario', esc(L.scenario))}${row('Stage', esc(L.stage))}${row('Action', L.kind ? `<b>${esc(L.kind)}</b> ${esc(L.desc || '')}` : '')}${row('Purpose', L.kind && PURPOSE[L.kind] ? esc('To ' + PURPOSE[L.kind] + '.') : '')}${row('Expecting', esc(exp))}${row('Changed', L.diff ? (L.diff.length ? esc(L.diff.join(', ')) : '<span class="warn">nothing changed on screen</span>') : '')}${row('Response', fr)}${row('Checks', chips)}${row('Problems so far', T.issues.size ? `<span class="bad">${T.issues.size}</span>` : '<span class="ok">none</span>')}</table><div style="border-top:1px solid #232831;margin-top:6px;padding-top:4px;font:11px/1.4 ui-monospace,monospace;color:#b9b9c6;max-height:160px;overflow:auto">${L.trace.slice(-14).reverse().map((x) => `<div class="${x.bad ? 'bad' : ''}">${x.at}s · ${esc(x.text)}${x.changed && x.changed.length ? ' → ' + esc(x.changed.join(', ')) : ''} · ${x.ms} ms${x.bad ? ' · ' + x.bad + ' problem(s)' : ''}</div>`).join('')}</div>`;
}
function ui(force) {
  if (!el || (!T.open && !force)) return; lastUi = now();
  const R = build(), set = (id, v) => { const e = $('#' + id); if (e && e.textContent !== String(v)) e.textContent = v; };
  set('dtN', T.n); set('dtP', T.pass); set('dtF', T.fail); set('dtR', R.rate.toFixed(1)); set('dtT', fmtT(R.dur)); set('dtI', R.issues.length);
  const total = T.plan ? T.plan.total : T.max, pctDone = total ? Math.min(T.running ? 99.9 : 100, 100 * T.n / total) : 0, bar = $('#dtBar'); if (bar) bar.style.width = (total ? pctDone : T.running ? (T.n % 100) : 0) + '%';
  set('dtEta', etaText(total)); const phEl = $('#dtPhases'); if (phEl) { const h = phasesHtml(); if (phEl.dataset.h !== h) { phEl.dataset.h = h; phEl.innerHTML = h; } }
  const s = $('[data-a=start]', el), p = $('[data-a=pause]', el), x = $('[data-a=stop]', el); s.disabled = T.running; p.disabled = !T.running; x.disabled = !T.running; s.textContent = T.running ? '● Running' : T.n ? '▶ Run again' : '▶ Start';
  const body = $('#dtBody'), atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
  if (tab === 'now') body.innerHTML = nowHtml();
  else if (tab === 'log') { body.innerHTML = T.log.slice(-160).map((l) => `<div class="${l.cls}">${esc(l.text)}</div>`).join('') || '<span class="dim">Press Start. It will click, type codes, switch tabs and units, use the builder and press keys by itself, and check what happens. Leave this tab in front so the browser does not slow it.</span>'; if (atBottom) body.scrollTop = body.scrollHeight; }
  else if (tab === 'issues') { body.innerHTML = R.issues.length ? R.issues.map((i) => `<div class="iss"><h4 class="${i.sev === 'error' ? 'bad' : i.sev === 'warn' ? 'warn' : 'dim'}">${i.sev.toUpperCase()} · ${esc(i.kind)} · ×${i.count}</h4>${esc(i.msg)}${i.diag ? `<div class="dim">Likely cause: ${esc(i.diag)}</div>` : ''}<div class="dim">first at #${i.first} · ${esc([...i.actions].join(', '))}</div>${i.thumb ? `<img src="${i.thumb}" alt="">` : ''}<div class="dim">${esc(i.repro.slice(-5).join('\n'))}</div></div>`).join('') : '<span class="ok">No problems found so far.</span>'; }
  else if (tab === 'report') body.textContent = reportText();
  else if (tab === 'cover') { const rows = [...T.cover.values()].sort((a, b) => a.n - b.n); body.innerHTML = `<div class="dim">${R.hit.length} of ${R.tot.length} controls used · ${T.pairs.size} combinations</div>` + rows.slice(0, 300).map((c) => `<div class="${c.n ? (c.bad ? 'bad' : 'ok') : 'dim'}">${String(c.n).padStart(4)} × ${esc(c.label)} <span class="dim">(${c.kind}${c.bad ? ', ' + c.bad + ' problems' : ''})</span></div>`).join(''); }
}
function toggle(force) {
  build_ui(); T.open = force == null ? !T.open : !!force; el.hidden = !T.open; if (T.open) ui(true);
}
window.DevTest = { toggle, start, stop, report: reportText, reportJSON, state: T, issues: () => [...T.issues.values()] };
})();
