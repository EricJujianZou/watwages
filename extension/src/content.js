// Wires the WaterlooWorks adapter, cache, settings and marks stores, the
// pay/year/skills/docs parsers, the ROI scorer and the overlay together on
// the two job board pages. Loaded as an ES module, either through
// content-loader.js (the real extension) or fixtures/loader.js (the
// synthetic page). See docs/build-contract-v2.md.
//
// Every other WaterlooWorks page (dashboard, graduating, interviews, a
// single posting) is left completely untouched: boot() below does nothing
// unless ww.getBoard() recognises the current path as one of the two
// boards, and overlayEnabled: false does nothing visible anywhere either.

import * as ww from './adapter/ww.js';
import { buildPostingDetail, findApplyUrl } from './adapter/detail.js';
import { createQueue } from './adapter/queue.js';
import { getCachedJobs, setCachedJob } from './store/cache.js';
import { getSettings, setSettings, getProfile, onSettingsChanged, onProfileChanged } from './store/settings.js';
import { getMarks, setMark, onMarksChanged, getSavedSearches, saveSearch, getLatestFilters, setLatestFilters } from './store/marks.js';

import { parsePay, applyProfile } from './parse/pay.js';
import { parseYear } from './parse/year.js';
import { parseSkills, parseDocs } from './parse/package.js';
import { scoreJobs } from './score/roi.js';
import { createOverlay } from './ui/overlay/overlay.js';

const RESCORE_DEBOUNCE_MS = 400;
const BOOT_RETRY_MS = 500;
const BOOT_MAX_ATTEMPTS = 20;
const HOST_ID = 'wmj-overlay-host';
const NOTICE_ID = 'wmj-wait-notice';

let tableWatcher = null;
let lastStatus = '';
let state = null;
let bootAttempts = 0;
let bootRetryTimer = null;
let rescoreTimer = null;

// Tells the service worker what to show on the toolbar icon for this tab.
function reportStatus(status, detail, extra) {
  const key = status + '|' + (detail || '');
  if (key === lastStatus) return;
  lastStatus = key;
  try {
    const sent = chrome.runtime.sendMessage({ tag: 'wmj', type: 'status', status, detail, extra });
    if (sent && sent.catch) sent.catch(() => {});
  } catch (err) {
    // the badge is a nicety, never let it break the page
  }
}

// Asks the service worker to send an anonymous usage count. Only the event
// name and a tiny label go out, never anything about a posting.
function reportUsage(name, extra) {
  try {
    const sent = chrome.runtime.sendMessage({ tag: 'wmj', type: 'usage', name, extra });
    if (sent && sent.catch) sent.catch(() => {});
  } catch (err) {
    // counting must never break the page
  }
}

/** 'full' | 'direct' | null for the current page. Exported for tests. */
export function currentBoard() {
  return typeof location !== 'undefined' ? ww.getBoard(location.pathname) : null;
}

// ---------------------------------------------------------------------
// Building JobView-shaped objects from a row (native table or listing)
// ---------------------------------------------------------------------
// content.js passes one object per job to both scoreJobs() and
// overlay.setJobs()/updateJob(). Its fields are a superset of the JobView
// shape docs/build-contract-v2.md describes "the overlay renders": on top
// of those, it also carries `year` (YearReq) and `history` (History|null),
// which the ROI scorer needs but the overlay itself never has to read. A
// plain object with a couple of extra keys works for both callers, so one
// shape is simpler than keeping a second, near-identical one in step.

/** Builds the part of a JobView a row (native table or listing) can fill in before any posting is read. */
export function baseJobFromRow(row, marks) {
  const jobId = row.jobId;
  return {
    jobId,
    title: row.title || null,
    org: row.org || null,
    division: row.division || null,
    city: row.location || null,
    province: ww.deriveProvince(row.location),
    arrangement: null,
    term: row.term || null,
    duration: null,
    openings: row.openings,
    apps: row.apps,
    levels: ww.mapLevels(row.level),
    deadline: ww.parseDeadlineIso(row.deadline),
    daysLive: null,
    daysLeft: row.daysLeft,
    isNew: false,
    viewed: marks.viewed.indexOf(jobId) !== -1,
    interested: marks.interested.indexOf(jobId) !== -1,
    applied: marks.applied.indexOf(jobId) !== -1,
    disciplines: null,
    pay: undefined,
    skills: undefined,
    docs: undefined,
    roi: undefined,
    // Scorer-only fields, not part of the rendered JobView shape.
    year: null,
    history: null,
  };
}

// ---------------------------------------------------------------------
// Reading the board: full listing (attempted) or the visible table
// ---------------------------------------------------------------------

async function tryFullListing(board, onPage, maxPages) {
  try {
    const search = state && state.searchOverride ? state.searchOverride : undefined;
    const rows = await ww.fetchListingRows(board, { onPage, maxPages, search });
    if (!rows || !rows.length) return null;
    return rows;
  } catch (err) {
    return null;
  }
}

/**
 * The overlay opens on whatever page of rows WaterlooWorks has drawn, so the
 * student sees it at once. The full listing loads after that and adds the
 * rows from the other pages. Only when the drawn table cannot be read does
 * mounting wait on the full listing.
 */
async function readBoardRows(table, board) {
  const rows = table ? ww.getRows(table) : null;
  if (rows && rows.length) return { rows, source: 'table' };
  // No table yet: open on the first page of the results feed and let the
  // rest join behind it, the same way it does after the table.
  if (!table) {
    const first = await tryFullListing(board, undefined, 1);
    return first ? { rows: first, source: 'feed' } : { rows: null, source: 'none' };
  }
  const listing = await tryFullListing(board);
  if (listing) return { rows: listing, source: 'listing' };
  return { rows: null, source: 'none' };
}

// Each page of the full listing joins the table as it arrives, so the
// student can scroll and sort the first pages while the rest load.
async function loadRestOfListing(board) {
  const mine = state;
  const gen = mine.listingGen;
  mine.listingPending = true;
  pushProgress();
  let chain = Promise.resolve();
  const addPage = async (page) => {
    if (state !== mine || mine.listingGen !== gen) return;
    if (page.total != null) state.listingTotal = page.total;
    const fresh = page.rows.filter((row) => !state.jobs.has(row.jobId));
    // Rows already on screen pick up fresher list fields (applications, openings).
    for (const row of page.rows) {
      const job = state.jobs.get(row.jobId);
      if (!job) continue;
      const patch = listFields(baseJobFromRow(row, state.marks));
      Object.assign(job, patch);
      state.overlay.updateJob(row.jobId, patch);
    }
    if (!fresh.length) return;
    state.listingSource = 'listing';
    for (const row of fresh) state.jobs.set(row.jobId, baseJobFromRow(row, state.marks));
    state.overlay.setJobs(Array.from(state.jobs.values()));
    const ids = await applyCache(fresh.map((row) => row.jobId));
    if (state !== mine) return;
    scheduleRescore();
    state.queue.add(ids);
    pushProgress();
  };
  await tryFullListing(board, (page) => {
    chain = chain.then(() => addPage(page)).catch(() => {});
  });
  await chain;
  if (state !== mine || mine.listingGen !== gen) return;
  state.listingPending = false;
  pushProgress();
}

// A new search (from WaterlooWorks' filter popup, or Latest filters)
// replaces the list. The old rows stay on screen until the first page of
// the new list arrives, and postings read before fill in from the cache, so
// nothing is read twice.
async function reloadListing() {
  const mine = state;
  const gen = (mine.listingGen += 1);
  mine.listingPending = true;
  mine.listingTotal = null;
  pushProgress();
  let replaced = false;
  let chain = Promise.resolve();
  const addPage = async (page) => {
    if (state !== mine || mine.listingGen !== gen) return;
    if (page.total != null) mine.listingTotal = page.total;
    if (!replaced) {
      replaced = true;
      mine.jobs = new Map();
    }
    const fresh = page.rows.filter((row) => !mine.jobs.has(row.jobId));
    for (const row of fresh) mine.jobs.set(row.jobId, baseJobFromRow(row, mine.marks));
    mine.overlay.setJobs(Array.from(mine.jobs.values()));
    const ids = await applyCache(fresh.map((row) => row.jobId));
    if (state !== mine || mine.listingGen !== gen) return;
    scheduleRescore();
    mine.queue.add(ids);
    pushProgress();
  };
  await tryFullListing(mine.board, (page) => {
    chain = chain.then(() => addPage(page)).catch(() => {});
  });
  await chain;
  if (state !== mine || mine.listingGen !== gen) return;
  // No rows at all: the search matches nothing.
  if (!replaced) {
    mine.jobs = new Map();
    mine.overlay.setJobs([]);
  }
  mine.listingPending = false;
  pushProgress();
  refreshLatestFilters();
}

/** The search the table is showing now: Latest filters if applied, else WaterlooWorks' last request. */
async function currentSearch() {
  if (state && state.searchOverride) {
    const o = state.searchOverride;
    return { filters: o.filters, keyword: o.keyword, key: `${o.filters || 'null'}|${o.keyword || ''}` };
  }
  const req = await ww.getListingRequest();
  return ww.listingSearchOf(req && req.body);
}

// Remembers any search with a filter or keyword in it, and offers Latest
// filters when the saved one differs from what is on screen.
async function refreshLatestFilters() {
  const mine = state;
  if (!mine) return;
  const now = await currentSearch();
  if (now.filters || now.keyword) await setLatestFilters(mine.board, now);
  const latest = await getLatestFilters(mine.board);
  if (state !== mine) return;
  const latestKey = latest ? `${latest.filters || 'null'}|${latest.keyword || ''}` : null;
  mine.overlay.setLatestFilters(!!latest && latestKey !== now.key);
}

async function applyLatestFilters() {
  const mine = state;
  if (!mine) return;
  const latest = await getLatestFilters(mine.board);
  if (!latest || state !== mine) return;
  mine.searchOverride = { filters: latest.filters, keyword: latest.keyword };
  reportUsage('latest_filters');
  await reloadListing();
}

// ---------------------------------------------------------------------
// WaterlooWorks' own Advanced Filters popup
// ---------------------------------------------------------------------
// The overlay steps aside, the native page shows, and the popup opens. When
// the student presses Apply, WaterlooWorks sends a new results request with
// the filters in it; the overlay sees that request, comes back, and reloads
// the list with it. A pill on the native page brings the overlay back if
// they close the popup without applying.

const BACK_ID = 'wmj-back-pill';
const FILTER_POLL_MS = 400;

function showBackPill(onBack) {
  let el = document.getElementById(BACK_ID);
  if (!el) {
    el = document.createElement('button');
    el.id = BACK_ID;
    el.type = 'button';
    el.textContent = 'Back to WatWages';
    el.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;padding:10px 16px;border:0;border-radius:999px;'
      + 'background:#15171C;color:#F4F1EA;font:600 14px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)';
    document.body.appendChild(el);
  }
  el.onclick = onBack;
}

function hideBackPill() {
  const el = document.getElementById(BACK_ID);
  if (el) el.remove();
}

async function openAdvancedFilters() {
  const mine = state;
  if (!mine || mine.nativeFilters) return;
  const before = await currentSearch();
  const startReq = await ww.getListingRequest();
  const startBody = startReq && startReq.body;
  mine.nativeFilters = true;
  mine.host.style.display = 'none';
  restorePageContent(mine.hiddenNodes);
  mine.hiddenNodes = null;

  let timer = null;
  const back = (applied) => {
    if (timer) clearInterval(timer);
    hideBackPill();
    hideNotice();
    if (state !== mine) return;
    mine.nativeFilters = false;
    mine.hiddenNodes = hidePageContent(mine.host);
    mine.host.style.removeProperty('display');
    if (applied) {
      // The table's new request now carries the search, so Latest filters
      // stops overriding it.
      mine.searchOverride = null;
      reloadListing();
    }
  };
  showBackPill(() => back(false));
  const btn = ww.findAdvancedFiltersButton();
  if (btn) btn.click();
  else showNotice("Open Advanced Filters on this page. WatWages comes back when you press Apply.");
  reportUsage('advanced_filters', { found: !!btn });

  timer = setInterval(async () => {
    if (state !== mine) {
      clearInterval(timer);
      hideBackPill();
      return;
    }
    const req = await ww.getListingRequest();
    const body = req && req.body;
    if (!body || body === startBody) return;
    const now = ww.listingSearchOf(body);
    if (now.key !== before.key || mine.searchOverride) back(true);
  }, FILTER_POLL_MS);
}

function useOriginalLook() {
  reportUsage('original_look', { from: 'overlay' });
  setSettings({ overlayEnabled: false });
}

// Fields the board list carries that change while a posting is up. A fresh
// list value wins over a cached one, so read-once postings stay current.
function listFields(job) {
  const out = {};
  for (const key of ['apps', 'openings', 'deadline', 'daysLeft']) {
    if (job[key] != null) out[key] = job[key];
  }
  return out;
}

// ---------------------------------------------------------------------
// Reading one posting's detail, and folding it into the job's facts
// ---------------------------------------------------------------------

async function fetchJobPayload(jobId) {
  const [overviewHtml, postingData] = await Promise.all([ww.getPostingOverview(jobId), ww.getPostingData(jobId)]);
  let ratingRaw = null;
  if (postingData && postingData.divId) {
    // Ratings belong to the employer division, not the posting, so every
    // posting from one division shares a single request.
    const divId = postingData.divId;
    if (!state.ratings.has(divId)) {
      state.ratings.set(divId, ww.callPageFunction('getWorkTermRatingReportJson', [divId]).catch(() => {
        state.ratings.delete(divId);
        return null;
      }));
    }
    ratingRaw = await state.ratings.get(divId);
  }
  return { overviewHtml, postingData, ratingRaw };
}

// Rows from later pages of the board sometimes arrive without a title or
// organization. The posting itself always names both, so a read fills them in.
function namesFromPosting(postingData, detail) {
  const fromData = ww.titleOrgFrom(postingData);
  const fields = detail ? [...detail.applicationFields, ...detail.companyFields] : [];
  const pick = (re) => {
    const f = fields.find((x) => re.test(x.label));
    return f ? f.value : null;
  };
  return {
    title: fromData.title || pick(/^(job |posting )?title$/i),
    org: fromData.org || pick(/^(organi[sz]ation|employer|company)( name)?$/i),
  };
}

// A labelled value from the posting itself, whether it sits on one line
// ("Work Term: 2027 - Winter") or under its own heading with the value on
// the next line. Section bodies longer than a short phrase are skipped so a
// heading that merely mentions the words cannot supply a paragraph.
function postingValue(detail, re) {
  if (!detail) return null;
  const field = [...detail.applicationFields, ...detail.companyFields].find((f) => re.test(f.label));
  if (field && field.value) return field.value;
  const section = detail.sections.find((s) => re.test(s.heading));
  if (section && section.text && section.text.length <= 80) return section.text.split('\n')[0].trim();
  return null;
}

async function readOneJob(jobId) {
  const current = state.jobs.get(jobId);
  const { overviewHtml, postingData, ratingRaw } = await fetchJobPayload(jobId);

  const pay = parsePay(overviewHtml || '', {
    countryHint: current ? current.countryHint : null,
    completedWorkTerms: state.profile ? state.profile.completedWorkTerms : undefined,
  });
  const year = parseYear(overviewHtml || '');
  const skillsResult = parseSkills(overviewHtml || '');
  const docsResult = parseDocs(overviewHtml || '', postingData);
  const apps = ww.deriveApps(current ? current.apps : null, postingData);
  const daysLive = ww.deriveDaysLive(postingData);
  const arrangement = ww.deriveArrangement(postingData);
  const duration = ww.deriveDuration(postingData);
  const disciplines = ww.deriveDisciplines(postingData);
  const history = ratingRaw ? ww.mapRatingReport(ratingRaw) : (current ? current.history : null);
  const detail = buildPostingDetail(overviewHtml, postingData, ratingRaw);
  const named = namesFromPosting(postingData, detail);
  const postedTerm = postingValue(detail, /^work term$/i);
  const postedArrangement = arrangement != null
    ? arrangement
    : ww.deriveArrangement({ arrangement: postingValue(detail, /location arrangement|work arrangement/i) });

  const updated = {
    ...current,
    pay,
    year,
    apps,
    daysLive,
    isNew: daysLive != null && daysLive <= 7,
    skills: skillsResult.found ? skillsResult.names : null,
    docs: docsResult.found ? docsResult.items.map((item) => item.name) : null,
    arrangement: postedArrangement != null ? postedArrangement : (current ? current.arrangement : null),
    term: (current && current.term) || postedTerm || null,
    duration: duration != null ? duration : (postingValue(detail, /work term duration/i) || (current ? current.duration : null)),
    disciplines: disciplines != null ? disciplines : (current ? current.disciplines : null),
    history,
    title: (current && current.title) || named.title,
    org: (current && current.org) || named.org,
    applyUrl: state.board === 'direct' ? findApplyUrl(overviewHtml) : null,
  };

  state.jobs.set(jobId, updated);
  state.details.set(jobId, detail);
  await setCachedJob(jobId, updated);
  if (state.overlay) state.overlay.updateJob(jobId, updated);
  scheduleRescore();
  return { facts: updated, detail };
}

async function getDetail(jobId) {
  if (state.details.has(jobId)) return state.details.get(jobId);
  const { detail } = await readOneJob(jobId);
  markViewed(jobId);
  return detail;
}

function markViewed(jobId) {
  if (!state) return;
  const job = state.jobs.get(jobId);
  if (job && job.viewed) return;
  Promise.resolve(setMark(jobId, 'viewed', true)).catch(() => {});
}

// ---------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------

function scheduleRescore() {
  if (rescoreTimer) clearTimeout(rescoreTimer);
  rescoreTimer = setTimeout(() => {
    rescoreTimer = null;
    rescore();
  }, RESCORE_DEBOUNCE_MS);
}

function rescore() {
  if (!state) return;
  const jobsArray = Array.from(state.jobs.values());
  const roiMap = scoreJobs(jobsArray, state.profile, state.settings, { board: state.board });
  state.roi = roiMap;
  for (const [jobId, roi] of roiMap.entries()) {
    const job = state.jobs.get(jobId);
    if (!job) continue;
    job.roi = roi;
    if (state.overlay) state.overlay.updateJob(jobId, { roi });
  }
}

// ---------------------------------------------------------------------
// Queue progress
// ---------------------------------------------------------------------

function handleQueueProgress(progress) {
  if (!state) return;
  state.read = { done: progress.read, total: progress.total };
  pushProgress();
}

function pushProgress() {
  if (!state) return;
  // Progress counts every posting, with ones read on an earlier visit
  // already done, so reopening the overlay never looks like a restart.
  const total = state.jobs.size;
  const unread = Math.max(0, state.read.total - state.read.done);
  const done = total - unread;
  if (state.overlay) {
    state.overlay.setProgress({
      done,
      total,
      listing: state.listingPending ? { loaded: state.jobs.size, total: state.listingTotal || null } : null,
    });
  }
  if (state.listingPending) reportStatus('reading', 'all pages');
  else if (done >= total) {
    // How many postings the board had and how long reading them took, for the
    // board-read count.
    const seconds = state.mountedAt ? Math.round((Date.now() - state.mountedAt) / 1000) : null;
    reportStatus('ready', undefined, { postings: total, seconds });
  }
  else reportStatus('reading', `${done} of ${total}`);
}

// ---------------------------------------------------------------------
// The waiting notice: a small card on the native page while the board has
// no results drawn yet, so a click on "Show What's Worth It" never looks
// like it did nothing.
// ---------------------------------------------------------------------

function showNotice(text) {
  if (typeof document === 'undefined' || !document.body) return;
  let el = document.getElementById(NOTICE_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = NOTICE_ID;
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:320px;'
      + 'padding:12px 16px;border-radius:12px;background:#15171C;color:#F4F1EA;'
      + 'font:500 14px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)';
    document.body.appendChild(el);
  }
  el.textContent = text;
}

function hideNotice() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(NOTICE_ID);
  if (el) el.remove();
}

// ---------------------------------------------------------------------
// Hiding the native page and mounting the overlay's host
// ---------------------------------------------------------------------

function ensureHost() {
  let host = document.getElementById(HOST_ID);
  if (host) return host;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '2147483647';
  document.body.appendChild(host);
  return host;
}

function hidePageContent(host) {
  const hidden = new Map();
  for (const node of Array.from(document.body.children)) {
    if (node === host) continue;
    hidden.set(node, node.style.display);
    node.style.display = 'none';
  }
  document.documentElement.style.overflow = 'hidden';
  return hidden;
}

function restorePageContent(hidden) {
  if (!hidden) return;
  for (const [node, prevDisplay] of hidden.entries()) {
    if (prevDisplay) node.style.display = prevDisplay;
    else node.style.removeProperty('display');
  }
  document.documentElement.style.removeProperty('overflow');
}

// ---------------------------------------------------------------------
// The api object handed to createOverlay
// ---------------------------------------------------------------------

function buildApi(board) {
  return {
    board,
    profile: state.profile,
    getDetail,
    setMark: (jobId, kind, on) => {
      if (on && kind !== 'viewed') reportUsage('mark', { kind });
      return setMark(jobId, kind, on);
    },
    getSavedSearches: () => getSavedSearches(),
    saveSearch: (name, filters) => saveSearch(name, filters),
    openInWaterlooWorks: (jobId) => ww.openInWaterlooWorks(jobId, board),
    openAdvancedFilters,
    applyLatestFilters,
    useOriginalLook,
    // One count per column per page load, so a student flipping a sort back
    // and forth counts once.
    onSort: (column) => {
      if (sortedColumns.has(column)) return;
      sortedColumns.add(column);
      reportUsage('sort', { column });
    },
    // The table's current order, top first, so reading follows what is on screen.
    onOrder: (ids) => {
      if (!state) return;
      state.order = new Map(ids.map((id, i) => [id, i]));
      if (state.queue) state.queue.reprioritize();
    },
    urls: ww.URLS,
  };
}

// ---------------------------------------------------------------------
// Mount / teardown
// ---------------------------------------------------------------------

// With no results table on screen, the first attempt reads the board
// straight from WaterlooWorks' results feed, so the overlay opens without
// any click. Only when that fails does boot click All Jobs instead.
let listingFallbackTried = false;

async function mount(board) {
  const table = ww.findResultsTable();
  if (!table && listingFallbackTried) {
    reportStatus('waiting');
    return false;
  }
  if (!table) listingFallbackTried = true;

  showNotice('Loading WatWages.');
  const mountedAt = Date.now();
  const { rows, source } = await readBoardRows(table, board);
  if (!rows) {
    // With no table drawn yet the board is usually still on its search
    // screen, which is normal, so boot keeps waiting and clicks All Jobs.
    // Only a drawn table that cannot be read means WaterlooWorks changed.
    reportStatus(table ? 'unreadable' : 'waiting');
    return false;
  }

  const profile = await getProfile();
  const marks = await getMarks();

  const jobs = new Map(rows.map((row) => [row.jobId, baseJobFromRow(row, marks)]));

  hideNotice();
  const host = ensureHost();
  const hiddenNodes = hidePageContent(host);

  state = {
    board,
    table,
    host,
    hiddenNodes,
    jobs,
    details: new Map(),
    ratings: new Map(),
    roi: new Map(),
    settings: await getSettings(),
    profile,
    marks,
    listingSource: source,
    listingPending: false,
    listingTotal: null,
    listingGen: 0,
    mountedAt,
    searchOverride: null,
    nativeFilters: false,
    order: new Map(),
    read: { done: 0, total: 0 },
  };

  const overlay = createOverlay(host, buildApi(board));
  state.overlay = overlay;
  overlay.setJobs(Array.from(jobs.values()));
  overlay.setProfile(profile);

  const idsToQueue = await applyCache(Array.from(jobs.keys()));
  rescore();

  const queue = createQueue(readOneJob, {
    rank: (jobId) => (state && state.order.has(jobId) ? state.order.get(jobId) : Infinity),
    isHidden: () => (typeof document !== 'undefined' ? document.hidden : false),
    onProgress: handleQueueProgress,
  });
  state.queue = queue;
  queue.add(idsToQueue);
  pushProgress();
  if (source === 'table' || source === 'feed') loadRestOfListing(board);
  refreshLatestFilters();

  return true;
}

/** Folds cached facts into the jobs and returns the ids that still need reading. */
async function applyCache(ids) {
  const cached = await getCachedJobs(ids);
  const idsToQueue = [];
  for (const jobId of ids) {
    const entry = cached[jobId];
    if (!state || !state.jobs.has(jobId)) continue;
    if (entry && entry.facts) {
      // Read once: a posting read on an earlier visit is not read again.
      // Application counts refresh from the board list, or when the
      // posting is opened.
      const base = state.jobs.get(jobId);
      const merged = { ...base, ...entry.facts, ...listFields(base) };
      // A name the board list has always wins over an older cached blank.
      for (const key of ['title', 'org', 'division', 'city']) {
        if (base[key]) merged[key] = base[key];
      }
      state.jobs.set(jobId, merged);
      state.overlay.updateJob(jobId, merged);
      if (merged.skills === undefined || merged.docs === undefined) idsToQueue.push(jobId);
    } else {
      idsToQueue.push(jobId);
    }
  }
  return idsToQueue;
}

function teardown() {
  hideNotice();
  hideBackPill();
  if (!state) return;
  try {
    state.queue.stop();
  } catch (err) {
    // best effort
  }
  try {
    if (state.overlay) state.overlay.destroy();
  } catch (err) {
    // best effort
  }
  try {
    if (state.host && state.host.remove) state.host.remove();
  } catch (err) {
    // best effort
  }
  try {
    restorePageContent(state.hiddenNodes);
  } catch (err) {
    // best effort
  }
  state = null;
}

// Usage counts for the steps between opening a board and seeing it read,
// sent once per page load. The service worker sends each at most once a day.
const sortedColumns = new Set();
let boardOpenReported = false;
let boardStuckReported = false;

async function boot() {
  const board = currentBoard();
  if (!board) return;
  const settings = await getSettings();
  if (!settings.overlayEnabled) {
    hideNotice();
    reportStatus('off');
    return;
  }
  if (!boardOpenReported) {
    boardOpenReported = true;
    reportUsage('board_open');
  }
  if (bootAttempts >= BOOT_MAX_ATTEMPTS && !ww.findResultsTable() && !boardStuckReported) {
    boardStuckReported = true;
    reportUsage('board_stuck');
  }
  if (!ww.findResultsTable() && listingFallbackTried && clickAllJobs()) {
    showNotice('Loading all jobs from WaterlooWorks.');
  } else if (!ww.findResultsTable()) {
    showNotice(bootAttempts >= BOOT_MAX_ATTEMPTS
      ? "WatWages couldn't open by itself. Click All Jobs and it will open."
      : 'Waiting for WaterlooWorks to show job results.');
  }
  const mounted = await mount(board);
  if (!mounted) scheduleBootRetry();
}

// The board opens on a search screen with no results until the student
// picks a search. Pick "All Jobs" for them, once per board page, so the
// overlay opens without a click. A search the student runs afterwards is
// never overridden.
let allJobsClickedFor = null;
function clickAllJobs() {
  const here = typeof location !== 'undefined' ? location.pathname : '';
  if (allJobsClickedFor === here) return false;
  const btn = ww.findAllJobsButton();
  if (!btn) return false;
  allJobsClickedFor = here;
  btn.click();
  return true;
}

function scheduleBootRetry() {
  if (bootAttempts >= BOOT_MAX_ATTEMPTS) {
    watchForTable();
    return;
  }
  bootAttempts += 1;
  if (bootRetryTimer) clearTimeout(bootRetryTimer);
  bootRetryTimer = setTimeout(() => {
    boot();
  }, BOOT_RETRY_MS);
}

// WaterlooWorks can take longer than the retry window to draw the results, and
// a student usually lands on the dashboard first and reaches the board without
// a full page load. After the quick retries run out, keep watching the page
// and boot as soon as a results table shows up.
function watchForTable() {
  if (tableWatcher || typeof MutationObserver === 'undefined' || !document.body) return;
  let pending = null;
  tableWatcher = new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      if (state || !ww.findResultsTable()) return;
      tableWatcher.disconnect();
      tableWatcher = null;
      boot();
    }, BOOT_RETRY_MS);
  });
  tableWatcher.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------
// Reacting to settings, profile and marks changing from elsewhere (the
// panel, or chrome.storage.onChanged firing in this same tab)
// ---------------------------------------------------------------------

onSettingsChanged((next) => {
  const board = currentBoard();
  if (!board) return;
  if (!next.overlayEnabled) {
    if (state) teardown();
    hideNotice();
    reportStatus('off');
    return;
  }
  if (!state) {
    boot();
    return;
  }
  const prev = state.settings;
  state.settings = next;
  if (JSON.stringify(prev.weights) !== JSON.stringify(next.weights)) rescore();
});

onProfileChanged((next) => {
  if (!state) return;
  const prevTerms = state.profile ? state.profile.completedWorkTerms : null;
  state.profile = next;
  if (state.overlay) state.overlay.setProfile(next);
  const nextTerms = next ? next.completedWorkTerms : null;
  if (nextTerms != null && prevTerms !== nextTerms) {
    for (const [jobId, job] of state.jobs.entries()) {
      if (job.pay) {
        job.pay = applyProfile(job.pay, nextTerms);
        if (state.overlay) state.overlay.updateJob(jobId, { pay: job.pay });
      }
    }
  }
  rescore();
});

onMarksChanged((next) => {
  if (!state) return;
  state.marks = next;
  for (const [jobId, job] of state.jobs.entries()) {
    const viewed = next.viewed.indexOf(jobId) !== -1;
    const interested = next.interested.indexOf(jobId) !== -1;
    const applied = next.applied.indexOf(jobId) !== -1;
    if (job.viewed !== viewed || job.interested !== interested || job.applied !== applied) {
      job.viewed = viewed;
      job.interested = interested;
      job.applied = applied;
      if (state.overlay) state.overlay.updateJob(jobId, { viewed, interested, applied });
    }
  }
});

// The panel's "Show What's Worth It" button re-scores every open
// WaterlooWorks tab after saving settings.
const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage;
if (hasRuntime) {
  chrome.runtime.onMessage.addListener((msg) => {
    // The panel's own message carries no `tag` field (see panel/panel.js,
    // rescoreOpenTabs), unlike the {tag:'wmj', type:'status'} messages this
    // file sends the other way, so this checks `type` alone.
    if (msg && msg.type === 'wmj.rescore') rescore();
    return undefined;
  });
}

// Node (tests, and any other non-browser import of this module) has no
// document, and content.js must never try to boot itself there.
if (typeof document !== 'undefined') boot();
