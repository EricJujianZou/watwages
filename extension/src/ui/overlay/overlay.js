// WatWages overlay. Ported from the approved design
// (see docs/build-contract-v2.md, "Product changes from the approved
// design"). This is the only file that assembles the overlay's DOM; it
// renders into a shadow root on the host element passed in, and talks to
// the rest of the extension only through the api object, never by
// importing store or adapter modules directly.
//
// No em or en dashes anywhere in this file, comments included.

import { ICON_SPRITE, icon } from './icons.js';
import { OVERLAY_CSS } from './styles.js';
import { clamp, esc, plural, money, mid, fmtDate, fmtTime, daysUntil } from './format.js';

const TOOLTIP_TEXT =
  'How much pay you can expect for the effort of applying and your chances of getting in.';

const THEME_STORAGE_KEY = 'wmj-overlay-theme';
const LOGO_URL = new URL('../../../icons/logo-mark.png', import.meta.url).href;

const APR_BUCKETS = [
  { key: 'lt10', label: 'Under 10', test: (v) => v < 10 },
  { key: '10-30', label: '10 to 30', test: (v) => v >= 10 && v < 30 },
  { key: '30-75', label: '30 to 75', test: (v) => v >= 30 && v < 75 },
  { key: '75+', label: '75 or more', test: (v) => v >= 75 },
];

const LEVELS_ORDER = ['Junior', 'Intermediate', 'Senior'];
const ARRANGEMENTS = ['In-person', 'Hybrid', 'Remote'];

const COLUMNS = [
  { key: 'title', label: 'Job Title' },
  { key: 'org', label: 'Organization', cls: 'c-org' },
  { key: 'roi', label: 'ROI', numeric: true, info: true },
  { key: 'pay', label: 'Pay', numeric: true },
  { key: 'loc', label: 'Location', cls: 'c-loc' },
  { key: 'interested', label: 'Interested', icon: true },
  { key: 'open', label: 'Open in new tab', icon: true },
];

export function createOverlay(host, api) {
  // ---------- Shell ----------
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '2147483000';
  host.style.display = 'block';
  host.style.colorScheme = 'light dark';

  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  root.innerHTML = '';

  const styleEl = document.createElement('style');
  styleEl.textContent = OVERLAY_CSS;
  root.appendChild(styleEl);

  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap';
  root.appendChild(fontLink);

  const spriteWrap = document.createElement('div');
  spriteWrap.innerHTML = ICON_SPRITE;
  root.appendChild(spriteWrap.firstElementChild);

  const appEl = document.createElement('div');
  appEl.className = 'app';
  appEl.innerHTML = shellHTML();
  root.appendChild(appEl);

  // ---------- Element references ----------
  const viewsEl = appEl.querySelector('#views');
  const themeBtnEl = appEl.querySelector('#themeBtn');
  const themeKnobEl = appEl.querySelector('#themeKnob');
  const themeLblEl = appEl.querySelector('#themeLbl');
  const searchInputEl = appEl.querySelector('#q');
  const searchesBtnEl = appEl.querySelector('#searchesBtn');
  const advBtnEl = appEl.querySelector('#advBtn');
  const advCountEl = appEl.querySelector('#advCount');
  const chipsEl = appEl.querySelector('#chips');
  const rescountEl = appEl.querySelector('#rescount');
  const progEl = appEl.querySelector('#prog');
  const barEl = appEl.querySelector('#progbar');
  const barFillEl = barEl.firstElementChild;
  const theadEl = appEl.querySelector('#thead');
  const tbodyEl = appEl.querySelector('#tbody');
  const panelEl = appEl.querySelector('#panel');
  const panelPlateEl = appEl.querySelector('#pplate');
  const popEl = appEl.querySelector('#pop');
  const tipEl = appEl.querySelector('#tip');
  const toastEl = appEl.querySelector('#toast');

  // The rail's three links are real navigation, so WaterlooWorks handles
  // opening them; the overlay just points each one at the right URL and
  // marks whichever board is the current page.
  const urls = (api && api.urls) || {};
  const navHomeEl = appEl.querySelector('#navHome');
  const navFullEl = appEl.querySelector('#navFull');
  const navDirectEl = appEl.querySelector('#navDirect');
  if (navHomeEl && urls.home) navHomeEl.href = urls.home;
  if (navFullEl) {
    if (urls.full) navFullEl.href = urls.full;
    if (api && api.board === 'full') {
      navFullEl.classList.add('on');
      navFullEl.setAttribute('aria-current', 'page');
    }
  }
  if (navDirectEl) {
    if (urls.direct) navDirectEl.href = urls.direct;
    if (api && api.board === 'direct') {
      navDirectEl.classList.add('on');
      navDirectEl.setAttribute('aria-current', 'page');
    }
  }

  // ---------- State ----------
  const state = {
    allJobs: [],
    byId: new Map(),
    currentList: [],
    view: 'all',
    q: '',
    sort: { key: 'roi', dir: -1 },
    openId: null,
    tab: 'overview',
    filters: { mine: false, isNew: false, disc: new Set(), arr: new Set(), apr: null, noCover: false, noPortfolio: false },
    adv: { levels: new Set(), minPay: '', within: '' },
    profile: api && api.profile ? api.profile : null,
    progress: null,
    detailCache: new Map(),
    savedSearches: [],
    popoverKey: null,
    popoverAnchor: null,
    searchDebounce: null,
    focusTimer: null,
    toastTimer: null,
  };

  // ---------- Small helpers over the current data ----------
  function requiresDoc(job, re) {
    return Array.isArray(job.docs) && job.docs.some((d) => re.test(d));
  }
  function perRoleOf(job) {
    return job.apps != null && job.openings ? job.apps / job.openings : null;
  }
  function isMine(job) {
    const program = state.profile && state.profile.program;
    return !!(program && Array.isArray(job.disciplines) && job.disciplines.includes(program));
  }
  function payMidpointOf(job) {
    if (!job.pay) return null;
    if (job.pay.status === 'unpaid') return 0;
    if (job.pay.status === 'stated') return mid(job.pay.hourlyCad);
    return null;
  }
  function findRowEl(jobId) {
    for (const tr of tbodyEl.children) {
      if (tr.dataset && tr.dataset.id === jobId) return tr;
    }
    return null;
  }

  function inView(job) {
    if (state.view === 'interested') return !!job.interested;
    if (state.view === 'applied') return !!job.applied;
    if (state.view === 'viewed') return !!job.viewed;
    return true;
  }
  function matchesFilters(job) {
    const f = state.filters;
    const adv = state.adv;
    const q = state.q.trim().toLowerCase();
    if (q) {
      const hay = `${job.title || ''} ${job.org || ''} ${job.city || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.mine && !isMine(job)) return false;
    if (f.isNew && !job.isNew) return false;
    if (f.disc.size && !(job.disciplines || []).some((d) => f.disc.has(d))) return false;
    if (f.arr.size && !f.arr.has(job.arrangement)) return false;
    if (f.apr) {
      const r = perRoleOf(job);
      const bucket = APR_BUCKETS.find((b) => b.key === f.apr);
      if (r == null || !bucket.test(r)) return false;
    }
    if (f.noCover && requiresDoc(job, /cover/i)) return false;
    if (f.noPortfolio && requiresDoc(job, /portfolio/i)) return false;
    if (adv.levels.size && !(job.levels || []).some((l) => adv.levels.has(l))) return false;
    if (adv.minPay) {
      const m = payMidpointOf(job);
      if (m == null || m < Number(adv.minPay)) return false;
    }
    if (adv.within) {
      const d = daysUntil(job.deadline);
      if (d == null || d > Number(adv.within)) return false;
    }
    return true;
  }
  function scoreOf(j) {
    return j.roi && typeof j.roi.score === 'number' ? j.roi.score : -1;
  }
  const SORT_VAL = {
    title: (j) => (j.title || '').toLowerCase(),
    org: (j) => (j.org || '').toLowerCase(),
    roi: (j) => scoreOf(j),
    pay: (j) => (payMidpointOf(j) == null ? -1 : payMidpointOf(j)),
    loc: (j) => (j.city || '').toLowerCase(),
  };
  function computeList() {
    const list = state.allJobs.filter((j) => inView(j) && matchesFilters(j));
    const { key, dir } = state.sort;
    const val = SORT_VAL[key] || SORT_VAL.roi;
    list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const base = (x < y ? -1 : x > y ? 1 : 0) * dir;
      return base || scoreOf(b) - scoreOf(a);
    });
    return list;
  }

  function dueInfo(job, now) {
    const d = daysUntil(job.deadline, now);
    if (d == null) return { cls: '', text: 'No deadline listed' };
    if (d <= 0) return { cls: 'urgent', text: 'Closes today' };
    if (d <= 4) return { cls: 'soon', text: `Closes in ${plural(d, 'day')}` };
    return { cls: '', text: `Closes in ${d} days` };
  }

  // ---------- Views bar ----------
  function renderViewsBar() {
    const counts = {
      all: state.allJobs.length,
      interested: state.allJobs.filter((j) => j.interested).length,
      applied: state.allJobs.filter((j) => j.applied).length,
      viewed: state.allJobs.filter((j) => j.viewed).length,
    };
    const V = [
      ['all', 'All Jobs'],
      ['interested', 'Interested'],
      ['applied', 'Applied'],
      ['viewed', 'Viewed'],
    ];
    viewsEl.innerHTML = V.map(
      ([k, l]) =>
        `<button type="button" data-view="${k}" aria-pressed="${state.view === k}">${esc(l)}${
          k === 'all' ? '' : `<span class="n">${counts[k]}</span>`
        }</button>`
    ).join('');
  }
  viewsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    renderViewsBar();
    renderTable();
  });

  // ---------- Chips ----------
  function renderChips() {
    const f = state.filters;
    const adv = state.adv;
    const any = f.mine || f.isNew || f.disc.size || f.arr.size || f.apr || f.noCover || f.noPortfolio || adv.levels.size || adv.minPay || adv.within;
    const chipVal = (set) => {
      if (!set.size) return '';
      const a = [...set];
      return a.length === 1 ? a[0] : `${a.length} selected`;
    };
    chipsEl.innerHTML = `
      <button type="button" class="chip pill ${f.mine ? 'on' : ''}" data-toggle="mine" aria-pressed="${f.mine}">My Program</button>
      <button type="button" class="chip pill ${f.isNew ? 'on' : ''}" data-toggle="isNew" aria-pressed="${f.isNew}">New</button>
      <button type="button" class="chip ${f.disc.size ? 'on' : ''}" data-pop="disc">Targeted Degrees${f.disc.size ? `<span class="val">: ${esc(chipVal(f.disc))}</span>` : ''}${icon('down')}</button>
      <button type="button" class="chip ${f.arr.size ? 'on' : ''}" data-pop="arr">Employment Location Arrangement${f.arr.size ? `<span class="val">: ${esc(chipVal(f.arr))}</span>` : ''}${icon('down')}</button>
      <button type="button" class="chip ${f.apr ? 'on' : ''}" data-pop="apr">Applications per Role${f.apr ? `<span class="val">: ${esc(APR_BUCKETS.find((b) => b.key === f.apr).label)}</span>` : ''}${icon('down')}</button>
      <span class="fsep" aria-hidden="true"></span>
      <button type="button" class="chip pill ${f.noCover ? 'on' : ''}" data-toggle="noCover" aria-pressed="${f.noCover}">${icon('doc')}No cover letter</button>
      <button type="button" class="chip pill ${f.noPortfolio ? 'on' : ''}" data-toggle="noPortfolio" aria-pressed="${f.noPortfolio}">${icon('folio')}No portfolio</button>
      ${any ? '<button type="button" class="clearall" data-clear-all>Clear all</button>' : ''}`;
  }
  chipsEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear-all]')) {
      Object.assign(state.filters, { mine: false, isNew: false, disc: new Set(), arr: new Set(), apr: null, noCover: false, noPortfolio: false });
      state.adv = { levels: new Set(), minPay: '', within: '' };
      renderChips();
      renderTable();
      return;
    }
    const t = e.target.closest('[data-toggle]');
    if (t) {
      state.filters[t.dataset.toggle] = !state.filters[t.dataset.toggle];
      renderChips();
      renderTable();
      return;
    }
    const p = e.target.closest('[data-pop]');
    if (p) openFilterPopover(p);
  });

  // ---------- Popovers ----------
  function optionHTML(label, checked, attrs, count, radio = false) {
    return `<button type="button" class="opt" role="${radio ? 'menuitemradio' : 'menuitemcheckbox'}" aria-checked="${checked}" ${attrs}><span class="box">${icon('check')}</span><span>${label}</span>${count != null ? `<span class="n">${count}</span>` : ''}</button>`;
  }
  function buildFilterPopoverHTML(key) {
    const base = state.allJobs.filter(inView);
    if (key === 'disc') {
      const program = state.profile && state.profile.program;
      const all = [...new Set(state.allJobs.flatMap((j) => j.disciplines || []))].sort((a, b) => (b === program) - (a === program) || a.localeCompare(b));
      if (!all.length) return `<h4>Targeted Degrees</h4><p class="prose" style="padding:8px 10px;margin:0">No disciplines listed yet.</p>`;
      return (
        `<h4>Targeted Degrees</h4>` +
        all.map((d) => optionHTML(`${esc(d)}${d === program ? ' <small>Your program</small>' : ''}`, state.filters.disc.has(d), `data-disc="${esc(d)}"`, base.filter((j) => (j.disciplines || []).includes(d)).length)).join('')
      );
    }
    if (key === 'arr') {
      return `<h4>Employment Location Arrangement</h4>` + ARRANGEMENTS.map((a) => optionHTML(a, state.filters.arr.has(a), `data-arr="${a}"`, base.filter((j) => j.arrangement === a).length)).join('');
    }
    return (
      `<h4>Applications per opening so far</h4>` +
      APR_BUCKETS.map((b) =>
        optionHTML(b.label, state.filters.apr === b.key, `data-apr="${b.key}"`, base.filter((j) => { const r = perRoleOf(j); return r != null && b.test(r); }).length, true)
      ).join('')
    );
  }
  function buildAdvancedHTML() {
    const known = new Set(state.allJobs.flatMap((j) => j.levels || []));
    const levels = LEVELS_ORDER.filter((l) => known.has(l)).concat([...known].filter((l) => !LEVELS_ORDER.includes(l)).sort());
    const list = levels.length ? levels : LEVELS_ORDER;
    const levelOpts = list.map((l) => optionHTML(l, state.adv.levels.has(l), `data-lvl="${esc(l)}"`)).join('');
    return `<h4>Advanced Filters</h4>
      <div class="field"><label>Level</label>${levelOpts}</div>
      <div class="field"><label for="advMinPay">Pay at least, per hour</label><input id="advMinPay" type="number" min="0" step="1" placeholder="Any" value="${esc(state.adv.minPay)}"></div>
      <div class="field"><label for="advWithin">Deadline within</label><select id="advWithin"><option value="">Any time</option>${[3, 7, 14]
        .map((d) => `<option value="${d}" ${String(state.adv.within) === String(d) ? 'selected' : ''}>${d} days</option>`)
        .join('')}</select></div>
      <div class="popfoot"><button type="button" class="btn ghost" data-adv-clear>Clear</button><button type="button" class="btn dark" data-adv-apply>Apply filters</button></div>`;
  }
  function buildSearchesHTML(list) {
    const items = list || state.savedSearches || [];
    const rows = items.length
      ? items
          .map(
            (s, i) =>
              `<button type="button" class="opt" data-search="${i}"><span><b style="font-weight:600">${esc(s.name)}</b><small>${esc(describeFilters(s.filters))}</small></span></button>`
          )
          .join('')
      : `<p class="prose" style="padding:8px 10px;margin:0">No saved searches yet.</p>`;
    return `<h4>My Searches</h4>${rows}
      <div class="field" style="border-top:1px solid var(--line); margin-top:6px; padding-top:12px"><label for="ssName">Save the current search</label><input id="ssName" type="text" placeholder="Name this search"></div>
      <div class="popfoot"><button type="button" class="btn dark" data-save-search>Save search</button></div>`;
  }
  function showPopover(key, html, anchorEl, align = 'left') {
    state.popoverKey = key;
    state.popoverAnchor = anchorEl;
    popEl.innerHTML = `<div class="plate">${html}</div>`;
    popEl.setAttribute('aria-label', anchorEl.textContent.trim());
    placePopover(popEl, anchorEl, align);
  }
  function closePopover() {
    popEl.classList.remove('show');
    state.popoverKey = null;
    state.popoverAnchor = null;
  }
  function refreshPopoverContent() {
    if (!state.popoverKey) return;
    const html =
      state.popoverKey === 'advanced' ? buildAdvancedHTML() : state.popoverKey === 'searches' ? buildSearchesHTML() : buildFilterPopoverHTML(state.popoverKey);
    const plate = popEl.querySelector('.plate');
    if (plate) plate.innerHTML = html;
  }
  function openFilterPopover(btn) {
    const key = btn.dataset.pop;
    if (state.popoverKey === key && popEl.classList.contains('show')) {
      closePopover();
      return;
    }
    showPopover(key, buildFilterPopoverHTML(key), btn, 'left');
  }
  function toggleSetValue(set, v) {
    if (set.has(v)) set.delete(v);
    else set.add(v);
  }
  popEl.addEventListener('click', (e) => {
    const opt = e.target.closest('.opt');
    if (opt) {
      if (opt.dataset.disc) toggleSetValue(state.filters.disc, opt.dataset.disc);
      else if (opt.dataset.arr) toggleSetValue(state.filters.arr, opt.dataset.arr);
      else if (opt.dataset.apr) state.filters.apr = state.filters.apr === opt.dataset.apr ? null : opt.dataset.apr;
      else if (opt.dataset.lvl) toggleSetValue(state.adv.levels, opt.dataset.lvl);
      else if (opt.dataset.search != null) {
        applySavedSearch(+opt.dataset.search);
        closePopover();
        return;
      }
      renderChips();
      renderTable();
      refreshPopoverContent();
      return;
    }
    if (e.target.closest('[data-adv-apply]')) {
      const minPayEl = popEl.querySelector('#advMinPay');
      const withinEl = popEl.querySelector('#advWithin');
      state.adv.minPay = minPayEl ? minPayEl.value : '';
      state.adv.within = withinEl ? withinEl.value : '';
      renderChips();
      renderTable();
      closePopover();
      return;
    }
    if (e.target.closest('[data-adv-clear]')) {
      state.adv = { levels: new Set(), minPay: '', within: '' };
      renderChips();
      renderTable();
      closePopover();
      return;
    }
    if (e.target.closest('[data-save-search]')) {
      const nameEl = popEl.querySelector('#ssName');
      const name = (nameEl && nameEl.value.trim()) || 'Untitled search';
      const filters = snapshotFilters();
      Promise.resolve(api.saveSearch(name, filters))
        .then(() => toast(`Saved "${name}" to My Searches`))
        .catch(() => toast('Could not save this search.'));
      closePopover();
    }
  });
  advBtnEl.addEventListener('click', () => {
    if (state.popoverKey === 'advanced' && popEl.classList.contains('show')) {
      closePopover();
      return;
    }
    showPopover('advanced', buildAdvancedHTML(), advBtnEl, 'right');
  });
  searchesBtnEl.addEventListener('click', async () => {
    if (state.popoverKey === 'searches' && popEl.classList.contains('show')) {
      closePopover();
      return;
    }
    showPopover('searches', `<h4>My Searches</h4><p class="prose" style="padding:8px 10px;margin:0">Loading.</p>`, searchesBtnEl, 'right');
    const list = await loadSavedSearches();
    if (state.popoverKey === 'searches') {
      const plate = popEl.querySelector('.plate');
      if (plate) plate.innerHTML = buildSearchesHTML(list);
    }
  });
  async function loadSavedSearches() {
    try {
      const r = await api.getSavedSearches();
      state.savedSearches = Array.isArray(r) ? r : [];
    } catch (err) {
      state.savedSearches = [];
    }
    return state.savedSearches;
  }
  function snapshotFilters() {
    const f = state.filters;
    const adv = state.adv;
    return {
      q: state.q,
      mine: f.mine,
      isNew: f.isNew,
      disc: [...f.disc],
      arr: [...f.arr],
      apr: f.apr,
      noCover: f.noCover,
      noPortfolio: f.noPortfolio,
      levels: [...adv.levels],
      minPay: adv.minPay,
      within: adv.within,
    };
  }
  function describeFilters(filters) {
    if (!filters) return 'No filters';
    const parts = [];
    if (filters.q) parts.push(`Keyword ${filters.q}`);
    if (filters.mine) parts.push('My Program');
    if (filters.isNew) parts.push('New');
    if (filters.disc && filters.disc.length) parts.push(filters.disc.join(', '));
    if (filters.arr && filters.arr.length) parts.push(filters.arr.join(', '));
    if (filters.apr) {
      const b = APR_BUCKETS.find((x) => x.key === filters.apr);
      if (b) parts.push(`${b.label} per role`);
    }
    if (filters.noCover) parts.push('No cover letter');
    if (filters.noPortfolio) parts.push('No portfolio');
    if (filters.levels && filters.levels.length) parts.push(`Level: ${filters.levels.join(', ')}`);
    if (filters.minPay) parts.push(`Pay at least $${filters.minPay}`);
    if (filters.within) parts.push(`Deadline within ${filters.within} days`);
    return parts.length ? parts.join(', ') : 'No filters';
  }
  function applySavedSearch(i) {
    const s = state.savedSearches[i];
    if (!s) return;
    const filt = s.filters || {};
    state.q = filt.q || '';
    searchInputEl.value = state.q;
    state.filters = {
      mine: !!filt.mine,
      isNew: !!filt.isNew,
      disc: new Set(filt.disc || []),
      arr: new Set(filt.arr || []),
      apr: filt.apr || null,
      noCover: !!filt.noCover,
      noPortfolio: !!filt.noPortfolio,
    };
    state.adv = { levels: new Set(filt.levels || []), minPay: filt.minPay || '', within: filt.within || '' };
    state.view = 'all';
    renderViewsBar();
    renderChips();
    renderTable();
    toast(`Loaded "${s.name}"`);
  }
  function placePopover(el, anchor, align = 'left') {
    const r = anchor.getBoundingClientRect();
    el.style.visibility = 'hidden';
    el.classList.add('show');
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = align === 'right' ? r.right - w : r.left;
    x = clamp(x, 12, window.innerWidth - w - 12);
    let y = r.bottom + 8;
    if (y + h > window.innerHeight - 12) y = Math.max(12, r.top - h - 8);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.visibility = '';
  }

  // ---------- ROI tooltip ----------
  function showTip(anchor) {
    tipEl.innerHTML = `<p style="margin:0">${TOOLTIP_TEXT}</p>`;
    tipEl.classList.add('show');
    const r = anchor.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    const h = tipEl.offsetHeight;
    let x = clamp(r.left + r.width / 2 - w / 2, 12, window.innerWidth - w - 12);
    let y = r.bottom + 10;
    if (y + h > window.innerHeight - 12) y = Math.max(12, r.top - h - 10);
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
    anchor.setAttribute('aria-expanded', 'true');
  }
  function hideTip() {
    tipEl.classList.remove('show');
    const btn = theadEl.querySelector('.info[aria-expanded="true"]');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  // ---------- Table head and sorting ----------
  function renderHead() {
    theadEl.innerHTML = COLUMNS.map((c) => {
      if (c.icon) return `<th scope="col" class="ic" title="${esc(c.label)}"><span class="sr">${esc(c.label)}</span></th>`;
      const active = state.sort.key === c.key;
      const arrowIcon = active ? (state.sort.dir > 0 ? 'sortu' : 'sortd') : 'sort';
      const infoBtn = c.info ? `<button type="button" class="info" data-roi-info aria-label="What ROI means" aria-expanded="false">${icon('info')}</button>` : '';
      return `<th scope="col" class="${c.cls || ''} ${c.numeric ? 'c-n' : ''}" ${active ? `aria-sort="${state.sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}><span class="hd"><button type="button" class="sort" data-sort="${c.key}">${esc(c.label)}${icon(arrowIcon, 'i ar')}</button>${infoBtn}</span></th>`;
    }).join('');
    const infoBtn = theadEl.querySelector('[data-roi-info]');
    if (infoBtn) {
      infoBtn.addEventListener('mouseenter', () => showTip(infoBtn));
      infoBtn.addEventListener('focus', () => showTip(infoBtn));
      infoBtn.addEventListener('mouseleave', hideTip);
      infoBtn.addEventListener('blur', hideTip);
      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        tipEl.classList.contains('show') ? hideTip() : showTip(infoBtn);
      });
    }
  }
  theadEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const k = b.dataset.sort;
    state.sortedWhileLoading = !!(state.progress && state.progress.listing);
    state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === 'roi' || k === 'pay' ? -1 : 1 };
    renderHead();
    renderTable();
  });

  // ---------- Table rows ----------
  function cellRoi(job) {
    if (job.roi === undefined) return `<span class="skel" aria-label="Not read yet"></span>`;
    if (!job.roi || typeof job.roi.score !== 'number') return `<span class="pay none">Not scored</span>`;
    const top = job.roi.score >= 85;
    return `<span class="roi ${top ? 'top' : ''}"><span class="bar"><i style="width:${job.roi.score}%"></i></span><b>${job.roi.score}</b></span>`;
  }
  function cellPay(job) {
    if (job.pay === undefined) return `<span class="skel" aria-label="Not read yet"></span>`;
    if (!job.pay || job.pay.status === 'not_stated') {
      const title = job.pay && job.pay.quote ? esc(job.pay.quote) : '';
      return `<span class="pay none" title="${title}">Not listed</span>`;
    }
    if (job.pay.status === 'unpaid') return `<span class="pay none">Unpaid</span>`;
    const m = mid(job.pay.hourlyCad);
    if (m == null) return `<span class="pay none">Not listed</span>`;
    return `<span class="pay">${money(m)}<span style="font-weight:500;color:var(--ink3)">/hr</span></span>`;
  }
  function rowHTML(job) {
    const selected = state.openId === job.jobId;
    const locText = job.city ? esc(job.city) : `<span style="color:var(--ink3)">Not listed</span>`;
    return `<tr data-id="${esc(job.jobId)}" tabindex="0" class="${selected ? 'sel' : ''}" aria-selected="${selected}">
      <td data-col="title" class="${job.viewed ? 'viewed' : ''}" title="${esc(job.title)}">${job.isNew ? '<span class="tagnew">NEW</span>' : ''}<span class="t">${esc(job.title)}</span></td>
      <td data-col="org" class="c-org org" title="${esc(job.org)}">${esc(job.org)}</td>
      <td data-col="roi" class="c-n num">${cellRoi(job)}</td>
      <td data-col="pay" class="c-n num">${cellPay(job)}</td>
      <td data-col="loc" class="c-loc loc" title="${esc([job.city, job.province, job.arrangement].filter(Boolean).join(', '))}">${locText}${job.arrangement ? `<small>${esc(job.arrangement)}</small>` : ''}</td>
      <td data-col="interested" class="ic"><button type="button" class="ib ${job.interested ? 'on' : ''}" data-toggle-interested aria-pressed="${!!job.interested}" aria-label="${job.interested ? 'Remove from Interested' : 'Mark as interested'}" title="${job.interested ? 'Interested' : 'Mark as interested'}">${icon('mark')}</button></td>
      <td data-col="open" class="ic"><button type="button" class="ib" data-open-new aria-label="Open posting in a new tab" title="Open in new tab">${icon('ext')}</button></td>
    </tr>`;
  }
  function emptyRowHTML() {
    const msg = state.view === 'all' ? 'Remove a filter or clear the search to see more.' : 'Postings show up here once you mark them from All Jobs.';
    return `<tr><td colspan="7" style="height:auto;white-space:normal;border-radius:12px;cursor:default"><div class="empty"><b>No postings match</b>${msg}</div></td></tr>`;
  }
  function renderResultCount() {
    const viewTotal = state.allJobs.filter(inView).length;
    const n = state.currentList.length;
    const viewLabels = { all: 'postings', interested: 'marked as interested', applied: 'applied to', viewed: 'viewed' };
    const sortLabel = (COLUMNS.find((c) => c.key === state.sort.key) || {}).label || '';
    rescountEl.innerHTML = `${n} <span>${viewLabels[state.view]}${n !== viewTotal ? ` of ${viewTotal}` : ''}, sorted by ${esc(sortLabel)}</span>`;
  }
  function updateAdvCount() {
    const n = (state.adv.levels.size ? 1 : 0) + (state.adv.minPay ? 1 : 0) + (state.adv.within ? 1 : 0);
    advCountEl.hidden = !n;
    advCountEl.textContent = String(n);
  }
  function renderTable() {
    state.currentList = computeList();
    if (api.onOrder) api.onOrder(state.currentList.map((j) => j.jobId));
    renderResultCount();
    tbodyEl.innerHTML = state.currentList.length ? state.currentList.map(rowHTML).join('') : emptyRowHTML();
    updateAdvCount();
  }
  function patchRowValues(job) {
    const tr = findRowEl(job.jobId);
    if (!tr) return;
    const roiTd = tr.querySelector('[data-col="roi"]');
    if (roiTd) roiTd.innerHTML = cellRoi(job);
    const payTd = tr.querySelector('[data-col="pay"]');
    if (payTd) payTd.innerHTML = cellPay(job);
  }
  tbodyEl.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    if (e.target.closest('[data-toggle-interested]')) {
      toggleInterested(tr.dataset.id);
      return;
    }
    if (e.target.closest('[data-open-new]')) {
      api.openInWaterlooWorks(tr.dataset.id);
      return;
    }
    openPosting(tr.dataset.id);
  });
  tbodyEl.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && e.target === tr && e.key === 'Enter') openPosting(tr.dataset.id);
  });

  // ---------- Marks: interested, applied, viewed ----------
  function toggleInterested(jobId) {
    const job = state.byId.get(jobId);
    if (!job) return;
    const next = !job.interested;
    job.interested = next;
    try {
      api.setMark(jobId, 'interested', next);
    } catch (err) {
      // best effort, the UI already reflects the change optimistically
    }
    renderViewsBar();
    const tr = findRowEl(jobId);
    if (tr) {
      const btn = tr.querySelector('[data-toggle-interested]');
      if (btn) {
        btn.classList.toggle('on', next);
        btn.setAttribute('aria-pressed', String(next));
        btn.setAttribute('aria-label', next ? 'Remove from Interested' : 'Mark as interested');
        btn.title = next ? 'Interested' : 'Mark as interested';
      }
    }
    if (state.view === 'interested') renderTable();
    if (state.openId === jobId) patchPanelActions(job);
    toast(next ? 'Added to Interested' : 'Removed from Interested');
  }
  function applyToJob(jobId) {
    const job = state.byId.get(jobId);
    if (!job) return;
    const direct = !!job.applyUrl;
    if (direct) window.open(job.applyUrl, '_blank', 'noopener');
    else api.openInWaterlooWorks(jobId);
    if (!job.applied) {
      job.applied = true;
      try {
        api.setMark(jobId, 'applied', true);
      } catch (err) {
        // best effort
      }
      renderViewsBar();
      if (state.view === 'applied') renderTable();
      if (state.openId === jobId) patchPanelActions(job);
      toast(direct
        ? "Marked as applied. The employer's application page opened in a new tab."
        : 'Marked as applied. Continue applying in the new WaterlooWorks tab.');
    }
  }
  function markViewed(jobId) {
    const job = state.byId.get(jobId);
    if (!job || job.viewed) return;
    job.viewed = true;
    try {
      api.setMark(jobId, 'viewed', true);
    } catch (err) {
      // best effort
    }
    renderViewsBar();
    const tr = findRowEl(jobId);
    const titleTd = tr && tr.querySelector('[data-col="title"]');
    if (titleTd) titleTd.classList.add('viewed');
  }

  // ---------- Posting panel ----------
  function factsGridHTML(job) {
    let roiDD;
    if (job.roi === undefined) {
      roiDD = `<dd><span class="skel" aria-label="Not read yet" style="width:34px;height:22px"></span></dd>`;
    } else if (!job.roi || typeof job.roi.score !== 'number') {
      roiDD = `<dd class="none">Not scored</dd>`;
    } else {
      const payUsed = job.roi.payUsed;
      const oddsIn = job.roi.appsPerOpeningUsed != null ? job.roi.appsPerOpeningUsed : job.roi.odds ? 1 / job.roi.odds : null;
      const n = Math.max(1, Math.round(oddsIn || 1));
      roiDD = `<dd>${job.roi.score}<small>${payUsed != null ? money(payUsed) : '$0'}/hr at about 1 in ${n}</small></dd>`;
    }
    let payDD;
    if (job.pay === undefined) {
      payDD = `<dd><span class="skel" style="width:60px;height:20px"></span></dd>`;
    } else if (!job.pay || job.pay.status === 'not_stated') {
      const note = job.pay && job.pay.quote ? `<small>${esc(job.pay.quote)}</small>` : '';
      payDD = `<dd class="none">Not listed${note}</dd>`;
    } else if (job.pay.status === 'unpaid') {
      payDD = `<dd class="none">Unpaid</dd>`;
    } else {
      const m = mid(job.pay.hourlyCad);
      payDD = `<dd>${money(m)}/hr<small>From Compensation and Benefits</small></dd>`;
    }
    const rpo = perRoleOf(job);
    const appsDD =
      job.apps == null || !job.openings
        ? `<dd class="none">Not shown<small>This board does not list application counts.</small></dd>`
        : `<dd class="num">${Math.round(rpo * 10) / 10}<small>${plural(job.apps, 'application')} for ${plural(job.openings, 'opening')}${job.daysLive != null ? `, posted ${plural(job.daysLive, 'day')} ago` : ''}</small></dd>`;
    const locDD = job.city
      ? `<dd>${esc(job.city)}<small>${esc([job.province, job.arrangement].filter(Boolean).join(', '))}</small></dd>`
      : `<dd class="none">Not listed</dd>`;
    let skillsDD;
    if (job.skills === undefined) {
      skillsDD = `<dd><span class="skel" style="width:100%;height:22px"></span></dd>`;
    } else if (!job.skills || !job.skills.length) {
      skillsDD = `<dd class="none">None listed</dd>`;
    } else {
      const shown = job.skills.slice(0, 8).map((s) => `<span>${esc(s)}</span>`).join('');
      const more = job.skills.length > 8 ? `<span class="more">+${job.skills.length - 8} more</span>` : '';
      skillsDD = `<dd style="font-size:14px"><div class="skills">${shown}${more}</div></dd>`;
    }
    const termDD = `<dd>${job.term ? esc(job.term) : 'Not listed'}${job.duration ? `<small>${esc(job.duration)}</small>` : ''}</dd>`;
    return `<dl class="facts">
      <div class="fact roifact"><dt>ROI</dt>${roiDD}</div>
      <div class="fact"><dt>Pay</dt>${payDD}</div>
      <div class="fact"><dt>Applications per opening</dt>${appsDD}</div>
      <div class="fact"><dt>Location</dt>${locDD}</div>
      <div class="fact"><dt>Skills</dt>${skillsDD}</div>
      <div class="fact"><dt>Work term</dt>${termDD}</div>
    </dl>`;
  }
  function renderSection(sec) {
    const lines = String(sec.text || '').split('\n');
    let html = '';
    let ulBuf = [];
    const flush = () => {
      if (ulBuf.length) {
        html += `<ul>${ulBuf.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
        ulBuf = [];
      }
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        flush();
        continue;
      }
      if (line.startsWith('- ')) ulBuf.push(line.slice(2));
      else {
        flush();
        html += `<p>${esc(line)}</p>`;
      }
    }
    flush();
    return `<section class="sec"><h3>${esc(sec.heading)}</h3><div class="prose">${html}</div></section>`;
  }
  function disciplinesSectionHTML(job) {
    if (!job.disciplines || !job.disciplines.length) return '';
    const program = state.profile && state.profile.program;
    return `<section class="sec"><h3>Targeted Degrees and Disciplines</h3><div class="discs">${job.disciplines
      .map((d) => `<span class="${d === program ? 'you' : ''}">${esc(d)}${d === program ? ' (your program)' : ''}</span>`)
      .join('')}</div></section>`;
  }
  function applicationInfoSectionHTML(job, detail) {
    const docsRow =
      job.docs === undefined
        ? `<dt>Documents required</dt><dd><span class="skel"></span></dd>`
        : `<dt>Documents required</dt><dd>${job.docs && job.docs.length ? `<div class="docs">${job.docs.map((d) => `<span class="${/cover|portfolio/i.test(d) ? 'flag' : ''}">${esc(d)}</span>`).join('')}</div>` : 'Not listed'}</dd>`;
    const extra = detail && detail !== 'loading' && detail !== 'error' && Array.isArray(detail.applicationFields) ? detail.applicationFields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('') : '';
    return `<section class="sec"><h3>Application Information</h3><dl class="fields">${docsRow}${extra}</dl></section>`;
  }
  function companyInfoSectionHTML(detail) {
    if (!detail || detail === 'loading' || detail === 'error' || !Array.isArray(detail.companyFields) || !detail.companyFields.length) return '';
    return `<section class="sec"><h3>Company Information</h3><dl class="fields">${detail.companyFields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl></section>`;
  }
  function overviewBodyHTML(job, detail) {
    if (detail === 'loading' || detail === undefined) return `<p class="prose">Loading details.</p>`;
    if (detail === 'error') return `<p class="prose">Could not read this posting.</p>`;
    const sections = Array.isArray(detail.sections) ? detail.sections.map(renderSection).join('') : '';
    return sections + disciplinesSectionHTML(job) + applicationInfoSectionHTML(job, detail) + companyInfoSectionHTML(detail);
  }
  function ratingsTabHTML(job, detail) {
    if (detail === 'loading' || detail === undefined) return `<p class="prose">Loading details.</p>`;
    if (detail === 'error') return `<p class="prose">Could not read this posting.</p>`;
    const history = detail.history;
    const rating = detail.rating;
    const hasHired = history && typeof history.hired === 'number';
    const hasTerms = history && Array.isArray(history.byWorkTerm) && history.byWorkTerm.length;
    let chartSection;
    if (hasHired || hasTerms) {
      const span = history.terms ? `the last ${history.terms} terms` : 'past terms';
      const hiredLine = !hasHired
        ? ''
        : history.hired > 0
          ? `<p class="prose"><b class="num">${history.hired}</b> co-op ${history.hired === 1 ? 'student' : 'students'} hired in ${span}.</p>`
          : `<p class="prose">No co-op students hired in ${span}.</p>`;
      let bars = '';
      if (hasTerms) {
        const max = Math.max(0.0001, ...history.byWorkTerm.map((t) => t.share));
        const cols = history.byWorkTerm
          .map((t) => `<i style="height:${((t.share / max) * 100).toFixed(1)}%" title="Work term ${t.term}: ${Math.round(t.share * 100)}%"></i>`)
          .join('');
        const labels = history.byWorkTerm.map((t) => `<span>WT ${t.term}</span>`).join('');
        bars = `<div class="cols" role="img" aria-label="Share of past hires by work term">
          <span class="ax top num">${Math.round(max * 100)}%</span><span class="ax bot num">0%</span><span class="gl"></span>${cols}
        </div>
        <div class="xl">${labels}</div>`;
      }
      chartSection = `<section class="sec"><h3>Co-op students hired${hasTerms ? ', by work term' : ''}</h3>${hiredLine}${bars}</section>`;
    } else {
      chartSection = `<section class="sec"><h3>Co-op students hired</h3><p class="prose">No hiring history on file for this employer.</p></section>`;
    }
    let programsSection = '';
    if (history && Array.isArray(history.programs) && history.programs.length) {
      programsSection = `<section class="sec"><h3>Programs hired from</h3><div class="discs">${history.programs
        .map((p) => `<span>${esc(p.name)}<span class="num" style="margin-left:6px;color:var(--ink3)">${p.count}</span></span>`)
        .join('')}</div></section>`;
    }
    const ratingBlock =
      rating != null
        ? `<div class="rating"><b>${rating.toFixed(1)}</b><span>out of 10, from ${detail.ratingCount ? `${detail.ratingCount} ratings by ` : ''}past co-op students.</span></div>`
        : `<div class="rating"><span>Not enough students have rated this employer yet.</span></div>`;
    return chartSection + programsSection + ratingBlock;
  }
  function fetchDetailIfNeeded(jobId) {
    if (state.detailCache.has(jobId)) return;
    state.detailCache.set(jobId, 'loading');
    Promise.resolve(api.getDetail(jobId))
      .then((detail) => {
        state.detailCache.set(jobId, detail);
        if (state.openId === jobId) refreshOpenPanelDynamic();
      })
      .catch(() => {
        state.detailCache.set(jobId, 'error');
        if (state.openId === jobId) refreshOpenPanelDynamic();
      });
  }
  function refreshOpenPanelDynamic() {
    const job = state.byId.get(state.openId);
    if (!job) return;
    const detail = state.detailCache.get(job.jobId);
    const tabpanelEl = panelPlateEl.querySelector('[role="tabpanel"]');
    if (tabpanelEl) {
      tabpanelEl.innerHTML = state.tab === 'ratings' ? ratingsTabHTML(job, detail) : factsGridHTML(job) + overviewBodyHTML(job, detail);
    }
    const ratingsBtn = panelPlateEl.querySelector('[data-tab="ratings"]');
    if (ratingsBtn) {
      const badge = detail && detail !== 'loading' && detail !== 'error' && detail.rating != null ? `<span class="sc">${detail.rating.toFixed(1)}</span>` : '';
      ratingsBtn.innerHTML = `Work Term Ratings${badge}`;
    }
  }
  function patchPanelActions(job) {
    if (state.openId !== job.jobId) return;
    const d = dueInfo(job, new Date());
    const idlEl = panelPlateEl.querySelector('.idl');
    if (idlEl) {
      idlEl.innerHTML = `${job.isNew ? '<span class="pill new">New</span>' : ''}<span class="pill ${d.cls}">${esc(d.text)}</span>${job.applied ? '<span class="pill" style="background:var(--ok-bg);color:var(--ok)">Applied</span>' : ''}`;
    }
    const applyBtn = panelPlateEl.querySelector('[data-apply]');
    if (applyBtn) applyBtn.innerHTML = `${icon('send')}${job.applied ? 'Applied' : job.applyUrl ? 'Apply on employer site' : 'Apply'}`;
    const interestedBtn = panelPlateEl.querySelector('[data-toggle-interested]');
    if (interestedBtn) {
      interestedBtn.setAttribute('aria-pressed', String(!!job.interested));
      interestedBtn.classList.toggle('on', !!job.interested);
      interestedBtn.innerHTML = `${icon('mark')}${job.interested ? 'Interested' : 'Mark as interested'}`;
    }
  }
  function renderPanel() {
    const job = state.byId.get(state.openId);
    if (!job) return;
    const idx = state.currentList.findIndex((j) => j.jobId === job.jobId);
    const d = dueInfo(job, new Date());
    const interested = !!job.interested;
    const applied = !!job.applied;
    const detail = state.detailCache.get(job.jobId);
    panelPlateEl.innerHTML = `
      <div class="ptop">
        <span class="pos num">${idx >= 0 ? `${idx + 1} of ${state.currentList.length}` : 'Not in the current results'}</span>
        <button type="button" class="ib" data-step="-1" aria-label="Previous posting" ${idx <= 0 ? 'disabled' : ''}>${icon('up')}</button>
        <button type="button" class="ib" data-step="1" aria-label="Next posting" ${idx < 0 || idx >= state.currentList.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
        <button type="button" class="ib" data-open-new aria-label="Open posting in a new tab" title="Open in new tab">${icon('ext')}</button>
        <button type="button" class="ib" data-close aria-label="Close posting" title="Close">${icon('x')}</button>
      </div>
      <div class="pscroll">
        <div class="phead">
          <div class="idl">${d ? `${job.isNew ? '<span class="pill new">New</span>' : ''}<span class="pill ${d.cls}">${esc(d.text)}</span>${applied ? '<span class="pill" style="background:var(--ok-bg);color:var(--ok)">Applied</span>' : ''}` : ''}</div>
          <h2 id="ptitle" tabindex="-1">${esc(job.title)}</h2>
          <div class="who">${esc(job.org)}</div>
        </div>
        <div class="pacts">
          <button type="button" class="btn gold" data-apply ${job.applyUrl ? `title="Opens ${esc(job.applyUrl)}"` : ''}>${icon('send')}${applied ? 'Applied' : job.applyUrl ? 'Apply on employer site' : 'Apply'}</button>
          <button type="button" class="btn ${interested ? 'on' : ''}" data-toggle-interested aria-pressed="${interested}">${icon('mark')}${interested ? 'Interested' : 'Mark as interested'}</button>
        </div>
        <div class="tabs" role="tablist">
          <button type="button" role="tab" data-tab="overview" aria-selected="${state.tab === 'overview'}">Overview</button>
          <button type="button" role="tab" data-tab="ratings" aria-selected="${state.tab === 'ratings'}">Work Term Ratings${detail && detail !== 'loading' && detail !== 'error' && detail.rating != null ? `<span class="sc">${detail.rating.toFixed(1)}</span>` : ''}</button>
        </div>
        <div role="tabpanel">${state.tab === 'ratings' ? ratingsTabHTML(job, detail) : factsGridHTML(job) + overviewBodyHTML(job, detail)}</div>
      </div>`;
  }
  panelPlateEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      closePosting();
      return;
    }
    const stepBtn = e.target.closest('[data-step]');
    if (stepBtn) {
      step(+stepBtn.dataset.step);
      return;
    }
    if (e.target.closest('[data-open-new]')) {
      if (state.openId) api.openInWaterlooWorks(state.openId);
      return;
    }
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      state.tab = tabBtn.dataset.tab;
      panelPlateEl.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b === tabBtn)));
      refreshOpenPanelDynamic();
      tabBtn.focus();
      return;
    }
    if (e.target.closest('[data-toggle-interested]')) {
      if (state.openId) toggleInterested(state.openId);
      return;
    }
    if (e.target.closest('[data-apply]')) {
      if (state.openId) applyToJob(state.openId);
    }
  });

  function updateRowSelectionClasses() {
    for (const tr of tbodyEl.children) {
      const selected = tr.dataset && tr.dataset.id === state.openId;
      tr.classList.toggle('sel', selected);
      if (tr.dataset) tr.setAttribute('aria-selected', String(selected));
    }
  }
  function openPosting(jobId, opts = {}) {
    const job = state.byId.get(jobId);
    if (!job) return;
    const wasOpen = !!state.openId;
    const changingJob = state.openId !== jobId;
    state.openId = jobId;
    if (changingJob) state.tab = 'overview';
    markViewed(jobId);
    appEl.classList.add('open');
    panelEl.setAttribute('aria-hidden', 'false');
    updateRowSelectionClasses();
    const tr = findRowEl(jobId);
    if (tr) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    fetchDetailIfNeeded(jobId);
    renderPanel();
    if (opts.focus !== false) {
      clearTimeout(state.focusTimer);
      state.focusTimer = setTimeout(() => {
        const h2 = panelPlateEl.querySelector('#ptitle');
        if (h2) h2.focus({ preventScroll: true });
      }, wasOpen ? 0 : 340);
    }
  }
  function closePosting() {
    if (!state.openId) return;
    const jobId = state.openId;
    state.openId = null;
    appEl.classList.remove('open');
    panelEl.setAttribute('aria-hidden', 'true');
    updateRowSelectionClasses();
    const tr = findRowEl(jobId);
    if (tr) tr.focus({ preventScroll: true });
  }
  function step(delta) {
    if (!state.openId) return;
    const list = state.currentList;
    if (!list.length) return;
    let i = list.findIndex((j) => j.jobId === state.openId);
    i = clamp(i + delta, 0, list.length - 1);
    openPosting(list[i].jobId, { focus: false });
  }
  function moveRowFocus(delta) {
    const list = state.currentList;
    if (!list.length) return;
    const active = root.activeElement;
    const id = active && active.dataset ? active.dataset.id : null;
    let i = id ? list.findIndex((j) => j.jobId === id) : -1;
    i = clamp((i < 0 ? 0 : i) + delta, 0, list.length - 1);
    const tr = findRowEl(list[i].jobId);
    if (tr) tr.focus({ preventScroll: false });
  }

  // ---------- Search ----------
  searchInputEl.addEventListener('input', (e) => {
    const value = e.target.value;
    clearTimeout(state.searchDebounce);
    state.searchDebounce = setTimeout(() => {
      state.q = value;
      renderTable();
    }, 120);
  });

  // ---------- Theme ----------
  function currentTheme() {
    return host.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function paintTheme() {
    const t = currentTheme();
    themeKnobEl.innerHTML = icon(t === 'dark' ? 'moon' : 'sun');
    themeLblEl.textContent = t === 'dark' ? 'Dark' : 'Light';
    themeBtnEl.setAttribute('aria-label', `Switch to ${t === 'dark' ? 'light' : 'dark'} mode`);
  }
  themeBtnEl.addEventListener('click', () => {
    host.dataset.theme = currentTheme() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_STORAGE_KEY, host.dataset.theme);
    } catch (err) {
      // storage may be unavailable, theme just will not persist
    }
    paintTheme();
  });
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved) host.dataset.theme = saved;
  } catch (err) {
    // storage may be unavailable
  }
  const darkMql = window.matchMedia('(prefers-color-scheme: dark)');
  darkMql.addEventListener('change', paintTheme);

  // ---------- Toast ----------
  function toast(msg) {
    toastEl.innerHTML = esc(msg);
    toastEl.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  // ---------- Global keys, click-outside, resize, scroll ----------
  function onDocumentClick(e) {
    if (!popEl.classList.contains('show')) return;
    const path = e.composedPath();
    if (path.includes(popEl) || path.includes(searchesBtnEl) || path.includes(advBtnEl)) return;
    if (path.some((el) => el instanceof Element && el.matches && el.matches('[data-pop]'))) return;
    closePopover();
  }
  function onKeyDown(e) {
    const target = e.composedPath()[0];
    const tag = target && target.tagName;
    const isTyping = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if (e.key === 'Escape') {
      if (popEl.classList.contains('show')) {
        closePopover();
        return;
      }
      if (tipEl.classList.contains('show')) {
        hideTip();
        return;
      }
      if (state.openId) closePosting();
      return;
    }
    if (isTyping) return;
    if (e.key === '/') {
      e.preventDefault();
      searchInputEl.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      if (state.openId) {
        e.preventDefault();
        step(delta);
        return;
      }
      const active = root.activeElement;
      if (active && active.matches && active.matches('tr[data-id]')) {
        e.preventDefault();
        moveRowFocus(delta);
      }
    }
  }
  function onWindowResize() {
    closePopover();
    hideTip();
  }
  function onAppScroll() {
    hideTip();
    if (popEl.classList.contains('show') && state.popoverAnchor) {
      placePopover(popEl, state.popoverAnchor, state.popoverAnchor === advBtnEl || state.popoverAnchor === searchesBtnEl ? 'right' : 'left');
    }
  }
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onWindowResize);
  appEl.addEventListener('scroll', onAppScroll, { passive: true });

  // ---------- Progress ----------
  function updateProgressUI() {
    const p = state.progress;
    const reading = p && p.total && p.done < p.total;
    const busy = !!(p && (p.listing || reading));
    barEl.hidden = !busy;
    barEl.classList.toggle('indet', !!(p && p.listing && !reading));
    if (reading) barFillEl.style.width = `${Math.max(3, (p.done / p.total) * 100)}%`;
    if (!p || (!p.total && !p.listing)) {
      progEl.hidden = true;
      return;
    }
    progEl.hidden = false;
    const parts = [];
    if (p.listing) {
      const { loaded, total } = p.listing;
      if (state.sortedWhileLoading && total) parts.push(`Sorted ${loaded} of ${total} postings. The rest are still loading`);
      else parts.push(total ? `Loading postings, ${loaded} of ${total}` : `Loading postings, ${loaded} so far`);
    } else {
      state.sortedWhileLoading = false;
    }
    if (reading) parts.push(`Reading pay and details, ${p.done} of ${p.total}`);
    progEl.textContent = parts.length ? parts.join('. ') : `${p.total} postings read`;
  }

  // ---------- Public API ----------
  function setJobs(list) {
    const jobs = Array.isArray(list) ? list : [];
    state.allJobs = jobs;
    state.byId = new Map(jobs.map((j) => [j.jobId, j]));
    if (state.openId && !state.byId.has(state.openId)) {
      state.openId = null;
      appEl.classList.remove('open');
      panelEl.setAttribute('aria-hidden', 'true');
    }
    renderViewsBar();
    renderTable();
    if (state.openId) renderPanel();
  }
  function updateJob(jobId, partial) {
    const job = state.byId.get(jobId);
    if (!job || !partial) return;
    Object.assign(job, partial);
    patchRowValues(job);
    if ('interested' in partial || 'applied' in partial || 'viewed' in partial) {
      renderViewsBar();
      if (state.view !== 'all') renderTable();
    }
    if (state.openId === jobId) {
      patchPanelActions(job);
      refreshOpenPanelDynamic();
    }
  }
  function setProgress(progress) {
    state.progress = progress || null;
    updateProgressUI();
  }
  function setProfile(profile) {
    state.profile = profile || null;
    renderChips();
    renderTable();
    if (state.openId) refreshOpenPanelDynamic();
  }
  function destroy() {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onWindowResize);
    darkMql.removeEventListener('change', paintTheme);
    clearTimeout(state.toastTimer);
    clearTimeout(state.searchDebounce);
    clearTimeout(state.focusTimer);
    if (host.shadowRoot) host.shadowRoot.innerHTML = '';
  }

  // ---------- Initial paint ----------
  renderViewsBar();
  renderChips();
  renderHead();
  renderTable();
  updateProgressUI();
  paintTheme();

  return { setJobs, updateJob, setProgress, setProfile, destroy };
}

function shellHTML() {
  return `
<div class="frame">
  ${railHTML()}
  <main>
    <div class="top">
      <h1>WaterlooWorks via WatWages</h1>
      <div class="right">
        <div class="views glass" role="group" aria-label="View" id="views"></div>
        <button class="theme glass" id="themeBtn" type="button"><span class="knob" id="themeKnob"></span><span id="themeLbl"></span></button>
      </div>
    </div>
    <div class="work">
      <div class="results">
        <div class="filters glass">
          <div class="frow">
            <label class="search"><svg class="i" style="color:var(--ink3)"><use href="#i-search"/></svg>
              <span class="sr">Keyword search</span>
              <input id="q" type="search" placeholder="Search titles, organizations and cities" autocomplete="off">
              <kbd>/</kbd>
            </label>
            <button class="btn" id="searchesBtn" type="button"><svg class="i"><use href="#i-saved"/></svg>My Searches</button>
            <button class="btn dark" id="advBtn" type="button"><svg class="i"><use href="#i-sliders"/></svg>Advanced Filters<span class="count" id="advCount" hidden>0</span></button>
          </div>
          <div class="frow" id="chips" role="toolbar" aria-label="Quick filters"></div>
        </div>
        <section class="window glass" aria-labelledby="rescount">
          <div class="wbar">
            <div class="count" id="rescount" aria-live="polite"></div>
            <div class="prog" id="prog" hidden aria-live="polite"></div>
            <div class="hint"><span class="txt">Click a posting, then try pressing</span>
              <kbd aria-label="Up arrow">${icon('up')}</kbd>
              <kbd aria-label="Down arrow">${icon('down')}</kbd>
            </div>
          </div>
          <div class="progbar" id="progbar" hidden aria-hidden="true"><span></span></div>
          <table class="res" id="res">
            <colgroup><col class="c-title"><col class="c-org"><col class="c-roi"><col class="c-pay"><col class="c-loc"><col class="c-int"><col class="c-tab"></colgroup>
            <thead id="thead"></thead>
            <tbody id="tbody"></tbody>
          </table>
        </section>
      </div>
      <aside class="panel glass" id="panel" aria-label="Job posting" aria-hidden="true">
        <div class="plate" id="pplate"></div>
      </aside>
    </div>
  </main>
</div>
<div class="pop glass" id="pop" role="dialog"></div>
<div class="tip" id="tip" role="tooltip"></div>
<div class="toast glass" id="toast" role="status" aria-live="polite"></div>`;
}

function railHTML() {
  return `
<nav class="rail" aria-label="WatWages">
  <div class="rail-inner glass" id="railInner">
    <div class="mark"><b><img src="${LOGO_URL}" alt=""></b><span class="lbl">WatWages</span></div>
    <a href="#" data-nav="home" id="navHome"><svg class="i"><use href="#i-home"/></svg><span class="lbl">Home</span></a>
    <a href="#" data-nav="full" id="navFull"><svg class="i"><use href="#i-cycle"/></svg><span class="lbl">Full-Cycle Service</span></a>
    <a href="#" data-nav="direct" id="navDirect"><svg class="i"><use href="#i-case"/></svg><span class="lbl">Employer Student Direct</span></a>
    <div class="spacer"></div>
  </div>
</nav>`;
}
