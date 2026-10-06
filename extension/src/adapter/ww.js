// The only module in this extension that knows WaterlooWorks' own DOM and
// URLs.
//
// Header labels in SELECTORS were guessed from research notes until
// 2026-09-25, when real page captures landed at
// /home/ubuntu/projects/watermyjobs/captures/ww-capture (outside this
// extension, never copied in here). Those captures have every <script> tag
// stripped, so they show none of getPostingOverview / getPostingData /
// getWorkTermRatingReportJson, the internal listing API's tokens, or any
// rendered row content, but the static markup does confirm real
// `data-column col-key="..." title="..."` pairs: Id/ID, JobTitle/Job Title,
// Organization, Division, Openings, City, Level, ApplicationCount/Apps (full
// board only), Term (direct board only, no ApplicationCount there, matching
// the research note that Employer Student Direct never shows an application
// count), Deadline/App Deadline. SELECTORS below is updated to match. Row
// content itself is still unconfirmed: the table body is rendered by Vue
// from `section.rows` at runtime, so getRows()'s reading logic (by header
// text, never by position or class) is the part still resting on the old,
// untested assumptions and is the one to correct first against a live page.
//
// Everything that touches window.postMessage to reach the page's own
// getPostingOverview / getPostingData / getWorkTermRatingReportJson also
// lives here, as the content-script side of the bridge whose MAIN-world
// half is adapter/bridge-main.js.

import { MESSAGE_TAG } from '../contract.js';

export const SELECTORS = {
  headers: {
    id: 'ID',
    title: 'Job Title',
    org: 'Organization',
    division: 'Division',
    openings: 'Openings',
    location: 'City',
    level: 'Level',
    apps: ['Apps', 'Applications'],
    deadline: ['App Deadline', 'Deadline'],
    term: 'Term',
  },
  // Guessed as "the first table on the page whose header row contains the
  // ID column label". No class name is relied on, since Orbis markup is not
  // confirmed and class names on generated tables are the least stable part
  // of a page like this. The 2026-09-25 captures show a real
  // `<table class="table width--100">` with `<thead class="table__header">`
  // and `<tbody>` rows carrying class `table__row--body`, but this selector
  // stays a bare "table" so a class rename upstream can never break lookup.
  tableCandidateSelector: 'table',
  // Real header cells (2026-09-25 captures) are `.table__heading` with no
  // separate label span (`v-html="column"` writes straight into the `<th>`),
  // so headerLabelSelector below will not match live WaterlooWorks and
  // headerText() falls back to the whole cell's visible text, which is
  // exactly what a plain `.table__heading` cell needs. The selector is kept
  // in case a future markup version nests the label after all.
  headerLabelSelector: '.js--data-grid--header--label',
  iconSelector: '.material-icons',
  resizeHandleSelector: '.resize--handle',
};

// Confirmed by the 2026-09-25 captures (see the comment above SELECTORS).
export const BOARD_PATHS = {
  full: '/myAccount/co-op/full/jobs.htm',
  direct: '/myAccount/co-op/direct/jobs.htm',
};

export const URLS = {
  home: 'https://waterlooworks.uwaterloo.ca/myAccount/dashboard.htm',
  full: 'https://waterlooworks.uwaterloo.ca/myAccount/co-op/full/jobs.htm',
  direct: 'https://waterlooworks.uwaterloo.ca/myAccount/co-op/direct/jobs.htm',
};

/** 'full' | 'direct' | null, from a pathname (or full URL). Pure. */
export function getBoard(pathnameOrUrl) {
  const text = String(pathnameOrUrl || '');
  if (text.indexOf(BOARD_PATHS.full) !== -1) return 'full';
  if (text.indexOf(BOARD_PATHS.direct) !== -1) return 'direct';
  return null;
}

function ownerDocOf(node) {
  return (node && node.ownerDocument) || (typeof document !== 'undefined' ? document : null);
}

// ---------------------------------------------------------------------
// Header and table discovery
// ---------------------------------------------------------------------

function normalizeHeader(text) {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Pure: index of the header whose text matches label, or -1. */
export function matchHeaderIndex(headerTexts, label) {
  const targets = (Array.isArray(label) ? label : [label]).map(normalizeHeader);
  for (const target of targets) {
    for (let i = 0; i < headerTexts.length; i++) {
      if (normalizeHeader(headerTexts[i]) === target) return i;
    }
  }
  return -1;
}

/** Text of a cell without icon ligatures such as "swap_vert". */
function visibleText(cell) {
  if (!cell) return '';
  const hasIcons = typeof cell.querySelector === 'function' && cell.querySelector(SELECTORS.iconSelector);
  if (!hasIcons) return cell.textContent || '';
  const doc = ownerDocOf(cell);
  const walker = doc.createTreeWalker(cell, 4 /* NodeFilter.SHOW_TEXT */);
  let out = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent && parent.closest(SELECTORS.iconSelector)) continue;
    out += node.nodeValue + ' ';
  }
  return out;
}

function headerLabelEl(cell) {
  if (!cell || typeof cell.querySelector !== 'function') return null;
  return cell.querySelector(SELECTORS.headerLabelSelector);
}

function headerText(cell) {
  const label = headerLabelEl(cell);
  return label ? label.textContent : visibleText(cell);
}

/** The element inside an ID cell whose whole text is the posting number. */
function findIdLeaf(cell) {
  if (!cell || typeof cell.querySelectorAll !== 'function') return null;
  for (const el of cell.querySelectorAll('*')) {
    if (el.children.length === 0 && /^\d{4,}$/.test((el.textContent || '').trim())) return el;
  }
  return null;
}

function idFromCell(cell) {
  if (!cell) return null;
  const leaf = findIdLeaf(cell);
  if (leaf) return leaf.textContent.trim();
  const text = visibleText(cell).replace(/\s+/g, ' ').trim();
  const digits = text.match(/\d{4,}/);
  if (digits) return digits[0];
  return text.length ? text : null;
}

function getHeaderRow(table) {
  if (table.tHead && table.tHead.rows && table.tHead.rows[0]) return table.tHead.rows[0];
  return (table.rows && table.rows[0]) || null;
}

function getHeaderTexts(table) {
  const headerRow = getHeaderRow(table);
  if (!headerRow) return null;
  const cells = headerRow.cells || [];
  return Array.from(cells).map(headerText);
}

function getBodyRows(table) {
  if (table.tBodies && table.tBodies.length) return Array.from(table.tBodies[0].rows);
  const all = Array.from(table.rows || []);
  return all.slice(1);
}

/**
 * Finds the results table on the page. Never guesses beyond "header row has
 * an ID column": if that is not found the caller is expected to treat the
 * page as unrecognised.
 */
/**
 * The board's own "All Jobs" quick search button, or null. Looks for the
 * label first (any case or spacing), then for the first pill in the quick
 * search rail (`.tag-rail` in the 2026-09-25 captures, where All Jobs is the
 * first button), so a relabel or a restyle alone does not break it.
 */
const ALL_JOBS_LABELS = ['all jobs', 'all postings', 'all job postings', 'view all jobs'];
export function findAllJobsButton(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || typeof root.querySelectorAll !== 'function') return null;
  for (const btn of root.querySelectorAll('button, a[role="button"]')) {
    const text = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (ALL_JOBS_LABELS.includes(text)) return btn;
  }
  const rail = root.querySelector ? root.querySelector('[class*="tag-rail"]') : null;
  return rail && rail.querySelector ? rail.querySelector('button') : null;
}

export function findResultsTable(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || typeof root.querySelectorAll !== 'function') return null;
  const tables = root.querySelectorAll(SELECTORS.tableCandidateSelector);
  for (const table of tables) {
    const headerTexts = getHeaderTexts(table);
    if (!headerTexts) continue;
    if (matchHeaderIndex(headerTexts, SELECTORS.headers.id) !== -1) return table;
  }
  return null;
}

/** Map of column key (from SELECTORS.headers) to index, or -1 if not found (or null if no header row). */
export function getColumns(table) {
  const headerTexts = getHeaderTexts(table);
  if (!headerTexts) return null;
  const columns = {};
  for (const key of Object.keys(SELECTORS.headers)) {
    columns[key] = matchHeaderIndex(headerTexts, SELECTORS.headers[key]);
  }
  return columns;
}

/** The current header labels of the results table, in column order. Used by the debug export. */
export function getHeaderLabels(table) {
  return getHeaderTexts(table);
}

function cellText(tr, index) {
  if (index == null || index < 0) return null;
  const cell = tr.cells[index];
  if (!cell) return null;
  const text = visibleText(cell).replace(/\s+/g, ' ').trim();
  return text.length ? text : null;
}

function parseIntOrNull(text) {
  if (text == null) return null;
  const match = String(text).match(/-?\d+/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Reads every body row currently rendered in the table into a plain row
 * object. This is the visible-table strategy: it only sees whatever page of
 * results WaterlooWorks has rendered right now, not the whole board (see
 * fetchListingRows for the attempt at reading every page). Returns null when
 * the ID column cannot be located, per the "never guess" rule.
 */
export function getRows(table) {
  const columns = getColumns(table);
  if (!columns || columns.id === -1) return null;
  const bodyRows = getBodyRows(table);
  return bodyRows.map((tr) => {
    const jobId = idFromCell(tr.cells[columns.id]);
    const location = cellText(tr, columns.location);
    const deadline = cellText(tr, columns.deadline);
    return {
      jobId,
      title: cellText(tr, columns.title),
      org: cellText(tr, columns.org),
      division: cellText(tr, columns.division),
      level: cellText(tr, columns.level),
      term: cellText(tr, columns.term),
      openings: parseIntOrNull(cellText(tr, columns.openings)),
      apps: parseIntOrNull(cellText(tr, columns.apps)),
      deadline,
      location,
      countryHint: deriveCountryHint(location),
      daysLeft: parseDaysLeft(deadline),
    };
  });
}

// ---------------------------------------------------------------------
// Full listing, attempted (unconfirmed: see the module comment at the top
// and the final report this agent hands back)
// ---------------------------------------------------------------------
// docs/research/waterlooworks-surface.md: "Every call is a POST to jobs.htm
// carrying an `action` token. Tokens are embedded in the jobs page and
// rotate on each page load ... Listing: POST with `dataParams.action` and
// `isDataViewer: true`, JSON rows of job IDs, paginates at 100." Nobody on
// this project has seen the token's real markers, the request's other
// fields, or the response shape (the 2026-09-25 captures have every
// <script> tag stripped). Everything below is a best-effort, defensive
// attempt: every step validates its own output and returns null the moment
// something does not look trustworthy, so a wrong guess here always falls
// back to the tested, visible-table strategy in getRows() rather than
// silently feeding made-up data into the rest of the extension.

/**
 * The results table's own action token. Confirmed live on 2026-09-26: the
 * jobs page carries dozens of `action: "..."` tokens, one per page feature,
 * and the one WaterlooWorks' table sends sits inside the data viewer's
 * `dataParams: { ... }` block, present from page load before any search
 * runs. Any other token returns page markup instead of jobs, so only a
 * token right after "dataParams" is trusted. Null when there is none.
 */
export function findListingAction(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.scripts) return null;
  for (const script of Array.from(root.scripts)) {
    const text = script.textContent || '';
    const re = /dataParams\s*:\s*\{[^}]{0,300}?action["']?\s*[:=]\s*["']([A-Za-z0-9_-]{6,})["']/g;
    const match = re.exec(text);
    if (match) return match[1];
  }
  return null;
}

// The columns WaterlooWorks' table asks for, by board (col-keys confirmed
// in the 2026-09-25 captures). Sent when building a request without having
// seen the table's own, so the response carries titles and organizations.
const LISTING_COLUMNS = {
  full: ['Id', 'JobTitle', 'Organization', 'Division', 'Openings', 'City', 'Level', 'ApplicationCount', 'Deadline'],
  direct: ['Id', 'JobTitle', 'Organization', 'Division', 'Openings', 'City', 'Level', 'Term', 'Deadline'],
};

function listingColumnsParam(board) {
  const keys = LISTING_COLUMNS[board === 'direct' ? 'direct' : 'full'];
  return JSON.stringify(keys.map((key) => ({ title: key, key, isId: key === 'Id', sortable: true, visible: true })));
}

const LISTING_ROW_ID_KEYS = ['id', 'jobId', 'postingId', 'jobPostingId', 'job_id'];
const LISTING_TITLE_KEYS = ['title', 'jobTitle', 'postingTitle', 'JobTitle'];
const LISTING_ORG_KEYS = ['org', 'organization', 'organizationLegalName', 'employerName'];
const LISTING_DIVISION_KEYS = ['division', 'organizationDivisionLegalName'];
const LISTING_LOCATION_KEYS = ['city', 'location', 'workTermLocation', 'region'];
const LISTING_LEVEL_KEYS = ['level', 'experienceLevel'];
const LISTING_TERM_KEYS = ['term', 'workTerm'];
const LISTING_OPENINGS_KEYS = ['openings', 'numOpenings', 'numberOfOpenings'];
const LISTING_APPS_KEYS = ['applications', 'numApplications', 'applicationCount'];
const LISTING_DEADLINE_KEYS = ['deadline', 'applicationDeadline', 'appDeadline'];

// Matches field names without regard to case (the live board sends "Id",
// "JobTitle", "Organization"), and reads a cell that arrives as an object
// or as a snippet of HTML down to its text.
function firstDefined(obj, keys) {
  const lower = lowerKeys(obj);
  for (const key of keys) {
    const v = jsonCellText(lower[key.toLowerCase()]);
    if (v != null && v !== '') return v;
  }
  return null;
}

// Last resort when none of the expected names are there: the first field
// whose name matches, read down to text.
function firstMatchingKey(obj, re) {
  for (const key of Object.keys(obj)) {
    if (!re.test(key)) continue;
    const v = jsonCellText(obj[key]);
    if (v != null && v !== '') return v;
  }
  return null;
}

/** Title and organization from any posting-shaped object (a listing row or getPostingData), each null when absent. */
export function titleOrgFrom(obj) {
  if (!obj || typeof obj !== 'object') return { title: null, org: null };
  obj = flattenKeyValueRow(obj);
  const title = firstDefined(obj, LISTING_TITLE_KEYS) ?? firstMatchingKey(obj, /title/i);
  const org = firstDefined(obj, LISTING_ORG_KEYS) ?? firstMatchingKey(obj, /^(?!.*division).*(organi[sz]ation|employer|company)/i);
  return { title: title != null ? String(title) : null, org: org != null ? String(org) : null };
}

function jsonCellText(v) {
  if (v == null) return null;
  if (typeof v === 'object') {
    const inner = lowerKeys(v);
    for (const key of ['value', 'text', 'label', 'name', 'display', 'displayvalue', 'postingtitle', 'title']) {
      if (inner[key] != null && typeof inner[key] !== 'object') return jsonCellText(inner[key]);
    }
    return null;
  }
  if (typeof v === 'string' && v.indexOf('<') !== -1) {
    return v.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return v;
}

// The live board can send each row as { id, data: [{ key, value }, ...] }.
// Spread those pairs into one flat object; when two keys differ only by case
// ("Deadline" and "deadline") the first one, the display text, is kept.
function flattenKeyValueRow(entry) {
  if (!entry || !Array.isArray(entry.data)) return entry;
  const pairs = entry.data.filter((p) => p && typeof p === 'object' && typeof p.key === 'string');
  if (!pairs.length) return entry;
  const out = {};
  const taken = new Set();
  for (const key of Object.keys(entry)) {
    if (key === 'data') continue;
    out[key] = entry[key];
    taken.add(key.toLowerCase());
  }
  for (const { key, value } of pairs) {
    if (taken.has(key.toLowerCase())) continue;
    out[key] = value;
    taken.add(key.toLowerCase());
  }
  return out;
}

function toRowShape(entry) {
  entry = flattenKeyValueRow(entry);
  let jobId = null;
  const idValue = firstDefined(entry, LISTING_ROW_ID_KEYS);
  if (idValue != null) jobId = String(idValue);
  if (!jobId) return null; // the one field this function refuses to guess at
  const location = firstDefined(entry, LISTING_LOCATION_KEYS);
  const deadline = firstDefined(entry, LISTING_DEADLINE_KEYS);
  const rawTitle = firstDefined(entry, LISTING_TITLE_KEYS) ?? firstMatchingKey(entry, /title/i);
  const rawOrg = firstDefined(entry, LISTING_ORG_KEYS) ?? firstMatchingKey(entry, /^(?!.*division).*(organi[sz]ation|employer|company)/i);
  return {
    jobId,
    title: rawTitle != null ? String(rawTitle) : null,
    org: rawOrg != null ? String(rawOrg) : null,
    division: (() => {
      const v = firstDefined(entry, LISTING_DIVISION_KEYS);
      return v != null ? String(v) : null;
    })(),
    level: (() => {
      const v = firstDefined(entry, LISTING_LEVEL_KEYS);
      return v != null ? String(v) : null;
    })(),
    term: (() => {
      const v = firstDefined(entry, LISTING_TERM_KEYS);
      return v != null ? String(v) : null;
    })(),
    openings: (() => {
      const v = firstDefined(entry, LISTING_OPENINGS_KEYS);
      return v != null ? parseIntOrNull(String(v)) : null;
    })(),
    apps: (() => {
      const v = firstDefined(entry, LISTING_APPS_KEYS);
      return v != null ? parseIntOrNull(String(v)) : null;
    })(),
    deadline: deadline != null ? String(deadline) : null,
    location: location != null ? String(location) : null,
    countryHint: deriveCountryHint(location != null ? String(location) : null),
    daysLeft: deadline != null ? parseDaysLeft(String(deadline)) : null,
  };
}

/** Pure: maps one page's raw JSON response to row objects (see getRows), or null when nothing in it looks like a job row. Exported for its own unit tests; fetchListingRows is the function callers use. */
const LISTING_ARRAY_KEYS = ['rows', 'data', 'results', 'jobs', 'postings', 'list', 'items', 'records', 'datalist'];

function lowerKeys(obj) {
  const out = {};
  for (const key of Object.keys(obj)) out[key.toLowerCase()] = obj[key];
  return out;
}

/** The array of result rows, looked for up to two levels down. */
function findRowArray(json, depth) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object' || depth > 2) return null;
  const lower = lowerKeys(json);
  for (const key of LISTING_ARRAY_KEYS) {
    if (Array.isArray(lower[key])) return lower[key];
  }
  for (const key of LISTING_ARRAY_KEYS) {
    if (lower[key] && typeof lower[key] === 'object') {
      const inner = findRowArray(lower[key], depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

export function extractListingRows(json) {
  const arr = findRowArray(json, 0);
  if (!arr) return null;
  const mapped = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') return null; // not a shape worth trusting
    const row = toRowShape(entry);
    if (!row) return null;
    mapped.push(row);
  }
  return mapped;
}

const LISTING_PAGE_SIZE = 100; // used only when WaterlooWorks' own request was not seen
const LISTING_PAGE_TIMEOUT_MS = 10000; // one slow page gives up instead of stalling the listing
const LISTING_MAX_PAGES = 100; // 10,000 rows: far past the "hundreds to low thousands" this board ever holds (see docs/research/waterlooworks-surface.md, "Corpus size"), kept only as a runaway guard.

/**
 * Attempts to read every row on the board, across every page, through the
 * internal JSON listing API research described. Returns null the moment any
 * step cannot be trusted (no token found, a request fails, or a response
 * does not parse into row-shaped objects), so the caller always has a safe
 * "nothing usable" signal rather than a partial, silently-wrong list.
 * doFetch is injectable for tests; the real caller lets it default to fetch.
 */
export async function fetchListingRows(board, opts = {}) {
  const doFetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return null;
  const boardPath = board === 'direct' ? BOARD_PATHS.direct : BOARD_PATHS.full;
  const onPage = opts.onPage || (() => {});

  // Best: the exact request WaterlooWorks' own table sent, with only the
  // page number changed. Otherwise build one from the action token.
  let url = boardPath;
  let params = null;
  const template = opts.template !== undefined ? opts.template : await getListingRequest();
  if (template && template.body) {
    params = new URLSearchParams(template.body);
    if (template.url) url = template.url;
  } else {
    const action = opts.action || findListingAction(opts.doc);
    if (!action) return null;
    params = new URLSearchParams({
      page: '1',
      sort: JSON.stringify([{ key: 'Id', direction: 'desc' }]),
      itemsPerPage: String(LISTING_PAGE_SIZE),
      filters: 'null',
      columns: listingColumnsParam(board),
      keyword: '',
      action,
      isDataViewer: 'true',
    });
  }
  const pageSize = parseInt(params.get('itemsPerPage') || params.get('postPerPage'), 10) || LISTING_PAGE_SIZE;

  const rows = [];
  const seen = new Set();
  let total = null;
  const maxPages = opts.maxPages || LISTING_MAX_PAGES;
  for (let page = 1; page <= maxPages; page++) {
    params.set('page', String(page));
    let json;
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = abort ? setTimeout(() => abort.abort(), LISTING_PAGE_TIMEOUT_MS) : null;
    try {
      const res = await doFetch(url, {
        signal: abort ? abort.signal : undefined,
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: params.toString(),
      });
      if (!res || !res.ok) return page === 1 ? null : rows;
      json = await res.json();
    } catch (err) {
      return page === 1 ? null : rows;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const pageRows = extractListingRows(json);
    if (pageRows == null) {
      if (page === 1 && typeof console !== 'undefined') {
        console.warn('WatWages: the results list came back in a shape it does not recognise. Top-level fields:', json && typeof json === 'object' ? Object.keys(json) : typeof json);
      }
      return page === 1 ? null : rows;
    }
    if (total == null) total = extractListingTotal(json);
    if (page === 1 && typeof console !== 'undefined') {
      const first = findRowArray(json, 0)[0];
      if (first && pageRows[0] && (!pageRows[0].title || !pageRows[0].org)) {
        console.warn('WatWages: listing rows are missing a title or organization. First row:', JSON.stringify(first).slice(0, 800));
      }
    }
    const fresh = pageRows.filter((row) => !seen.has(row.jobId));
    for (const row of fresh) seen.add(row.jobId);
    rows.push(...fresh);
    onPage({ rows: fresh, loaded: rows.length, total });
    // A page of nothing new means the server ignored the page number.
    if (pageRows.length < pageSize || fresh.length === 0) break;
    if (total != null && rows.length >= total) break;
  }
  return rows;
}

const LISTING_TOTAL_KEYS = ['totalresults', 'totalitems', 'total', 'totalcount', 'count', 'recordstotal', 'numresults'];

/** The total number of results a listing response reports, or null. */
export function extractListingTotal(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const lower = lowerKeys(json);
  for (const key of LISTING_TOTAL_KEYS) {
    const n = parseInt(lower[key], 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

// ---------------------------------------------------------------------
// Opening a posting natively
// ---------------------------------------------------------------------

/**
 * Opens WaterlooWorks itself in a new tab for this posting. Unconfirmed: the
 * page never showed a per-posting URL in the 2026-09-25 captures or the
 * research notes (postings open through an in-page Vue click handler, not a
 * route), so there may be no stable link to a single posting at all. This
 * opens the job's own board instead, which is always correct and gets the
 * student onto native WaterlooWorks; it just cannot jump straight to the
 * row. Fix this the first time a real posting's address bar is checked.
 */
export function openInWaterlooWorks(jobId, board) {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return;
  const url = board === 'direct' ? URLS.direct : URLS.full;
  window.open(url, '_blank', 'noopener');
}

// ---------------------------------------------------------------------
// Derived facts: country hint, province, arrangement, days left/live, apps
// ---------------------------------------------------------------------

const US_STATE_ABBREVS = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY',
]);
const CA_PROVINCE_ABBREVS = new Set(['ON', 'BC', 'QC', 'AB', 'MB', 'SK', 'NS', 'NB', 'PE', 'NL', 'YT', 'NT', 'NU']);

/** Pure: 'US', 'CA' or null from a row's location text, e.g. "Austin, TX". */
export function deriveCountryHint(locationText) {
  if (!locationText) return null;
  const text = locationText.toLowerCase();
  if (/\b(usa|united states|u\.s\.a?\.?)\b/.test(text)) return 'US';
  if (/\bcanada\b/.test(text)) return 'CA';
  const match = locationText.match(/,?\s*([A-Za-z]{2})\s*$/);
  if (match) {
    const abbrev = match[1].toUpperCase();
    if (CA_PROVINCE_ABBREVS.has(abbrev)) return 'CA';
    if (US_STATE_ABBREVS.has(abbrev)) return 'US';
  }
  return null;
}

/** Pure: the two-letter province or state code from a row's location text, or null. */
export function deriveProvince(locationText) {
  if (!locationText) return null;
  const match = locationText.match(/,?\s*([A-Za-z]{2})\s*$/);
  if (!match) return null;
  const abbrev = match[1].toUpperCase();
  if (CA_PROVINCE_ABBREVS.has(abbrev) || US_STATE_ABBREVS.has(abbrev)) return abbrev;
  return null;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseFlexibleDate(text) {
  const cleaned = String(text).replace(/\b(at|by)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

/**
 * Pure: whole days between now and the deadline cell text, or null when the
 * text does not parse as a date. Assumption, unconfirmed: the real deadline
 * cell text is something JavaScript's Date parser can read directly (for
 * example "Sep 25, 2026 11:59 PM"); if not, this needs a dedicated pattern.
 */
export function parseDaysLeft(deadlineText, now) {
  if (!deadlineText) return null;
  const date = parseFlexibleDate(deadlineText);
  if (!date) return null;
  const reference = now || new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((startOfDay(date).getTime() - startOfDay(reference).getTime()) / msPerDay);
}

/**
 * Pure: the deadline cell text as an ISO string, local calendar date. Written
 * as "YYYY-MM-DDT12:00:00" (noon, no timezone designator) rather than plain
 * "YYYY-MM-DD" or a UTC-suffixed string: a bare date-only ISO string parses
 * as UTC midnight per spec, so re-reading it with `new Date(iso)` and then
 * local getters (as src/ui/overlay/format.js's daysUntil does) can land on
 * the wrong calendar day for any reader west of UTC. Noon local time is far
 * enough from both day boundaries that this round-trips correctly in every
 * timezone.
 */
export function parseDeadlineIso(deadlineText) {
  const date = parseFlexibleDate(deadlineText);
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T12:00:00`;
}

/**
 * Pure: days a posting has been live, from postingData when it carries a
 * recognisable date field, else null. Assumption, unconfirmed: the real
 * getPostingData response includes one of these field names for when the
 * posting opened.
 */
export function deriveDaysLive(postingData, now) {
  if (!postingData || typeof postingData !== 'object') return null;
  const raw = firstDefined(postingData, ['datePosted', 'postedDate', 'startDate', 'openDate', 'postingDate']);
  if (raw == null) return null;
  const date = parseFlexibleDate(String(raw));
  if (!date) return null;
  const reference = now || new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.floor((startOfDay(reference).getTime() - startOfDay(date).getTime()) / msPerDay);
  return diff >= 0 ? diff : null;
}

/**
 * Pure: applications count, preferring the results table cell and falling
 * back to postingData when the column is hidden or absent (the Employer
 * Student Direct board never shows one; see docs/research). Assumption,
 * unconfirmed: the real getPostingData response includes one of these field
 * names.
 */
export function deriveApps(rowApps, postingData) {
  if (rowApps != null) return rowApps;
  if (!postingData || typeof postingData !== 'object') return null;
  const raw = firstDefined(postingData, ['applications', 'numApplications', 'appCount', 'totalApplications', 'applicantCount']);
  if (raw == null) return null;
  const num = typeof raw === 'number' ? raw : parseIntOrNull(String(raw));
  return num == null || Number.isNaN(num) ? null : num;
}

/**
 * Pure: 'In-person' | 'Hybrid' | 'Remote' | null from postingData. Assumption,
 * unconfirmed: field name and wording, per docs/research (Employment
 * Location Arrangement is a real Advanced Filter, but its field name inside
 * getPostingData has never been seen).
 */
export function deriveArrangement(postingData) {
  if (!postingData || typeof postingData !== 'object') return null;
  const raw = firstDefined(postingData, ['arrangement', 'employmentLocationArrangement', 'workArrangement', 'locationArrangement']);
  if (raw == null) return null;
  const text = String(raw);
  if (/remote|virtual/i.test(text)) return 'Remote';
  if (/hybrid/i.test(text)) return 'Hybrid';
  if (/in-?person|on-?site/i.test(text)) return 'In-person';
  return null;
}

/** Pure: the work term duration as posted (e.g. "4 months", "8 months"), or null. Unconfirmed field name. */
export function deriveDuration(postingData) {
  if (!postingData || typeof postingData !== 'object') return null;
  const raw = firstDefined(postingData, ['duration', 'workTermDuration', 'termDuration']);
  return raw != null ? String(raw) : null;
}

/** Pure: targeted degrees/disciplines as posted, or null. Unconfirmed field name. */
export function deriveDisciplines(postingData) {
  if (!postingData || typeof postingData !== 'object') return null;
  const raw = firstDefined(postingData, ['disciplines', 'targetedDegrees', 'programs']) || postingData.disciplines;
  if (!Array.isArray(raw)) return null;
  const names = raw.map((v) => (typeof v === 'string' ? v : v && (v.name || v.label))).filter(Boolean);
  return names.length ? names : null;
}

/**
 * Pure: normalized level labels ('Junior'|'Intermediate'|'Senior') a posting
 * lists, from the Level column text. A posting can list more than one
 * ("Junior, Intermediate"); unrecognised words are dropped rather than
 * guessed at. Capitalized to match both the overlay's own level filter
 * (src/ui/overlay/overlay.js, LEVELS_ORDER) and score/roi.js, which
 * lowercases before comparing, so either casing would work for scoring, but
 * only this one also works for the overlay's exact-match filter chips.
 * Assumption, unconfirmed: the real column uses these words; if it uses
 * numbers or a different scheme this is the function to fix.
 */
export function mapLevels(text) {
  if (!text) return [];
  const out = [];
  for (const part of String(text).split(/[,/]/)) {
    const t = part.toLowerCase();
    if (/junior/.test(t)) out.push('Junior');
    else if (/intermediate/.test(t)) out.push('Intermediate');
    else if (/senior/.test(t)) out.push('Senior');
  }
  return Array.from(new Set(out));
}

/** Back-compat single-level reader some callers still want: the first recognised level, or null. */
export function mapLevel(text) {
  const levels = mapLevels(text);
  return levels.length ? levels[0] : null;
}

// ---------------------------------------------------------------------
// Bridge client: postMessage to bridge-main.js (MAIN world)
// ---------------------------------------------------------------------

const PENDING = new Map();
let nextRequestId = 1;
let listenerInstalled = false;

function ensureListener() {
  if (listenerInstalled) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  listenerInstalled = true;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.tag !== MESSAGE_TAG || data.direction !== 'response') return;
    const pending = PENDING.get(data.id);
    if (!pending) return;
    PENDING.delete(data.id);
    clearTimeout(pending.timer);
    if (data.error) pending.reject(new Error(data.error));
    else pending.resolve(data.result);
  });
}

/**
 * Sends a tagged, id'd request to bridge-main.js and resolves with its
 * response, or rejects on timeout. This is the only way content.js reaches
 * the page's own functions, since content scripts cannot call them
 * directly.
 */
export function callPageFunction(type, args, opts = {}) {
  ensureListener();
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 8000;
  const id = 'wmj-' + nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      PENDING.delete(id);
      reject(new Error('wmj bridge timeout for ' + type));
    }, timeoutMs);
    PENDING.set(id, { resolve, reject, timer });
    window.postMessage({ tag: MESSAGE_TAG, direction: 'request', id, type, args: args || [] }, '*');
  });
}

/** WaterlooWorks' own last results request, { url, body }, or null. */
export async function getListingRequest() {
  if (typeof window === 'undefined') return null;
  try {
    return await callPageFunction('wmjListingRequest', [], { timeoutMs: 2000 });
  } catch (err) {
    return null;
  }
}

export function getPostingOverview(jobId, opts) {
  return callPageFunction('getPostingOverview', [jobId], opts);
}

export function getPostingData(jobId, opts) {
  return callPageFunction('getPostingData', [jobId], opts);
}

export function getWorkTermRatingReportJson(divId, opts) {
  return callPageFunction('getWorkTermRatingReportJson', [divId], opts).then(mapRatingReport);
}

// ---------------------------------------------------------------------
// mapRatingReport
// ---------------------------------------------------------------------
// Maps the raw response of the page's getWorkTermRatingReportJson into the
// History shape from contract.js. Confirmed against a live capture on
// 2026-09-28: the response is { page, sections: [...] }, the same report
// WaterlooWorks draws on its own Work Term Ratings tab. The sections used
// here, all at the division level, which is what the charts describe:
//
//   type 'table', title 'Hiring History': columns ['', 'Students Hired',
//     '2023 - Fall', ...], rows [['Employer Organization', name, '2', ...],
//     ['Employer Division', name, '2', ...]], hires per term as strings
//   type 'pieChart', title 'Hires by Student Work Term Number...': data
//     [{name: 'First', y: '26'}, ... {name: 'Sixth +', y: '5'}], percents
//   type 'barChart', title 'Most Frequently Hired Programs...': categories
//     [program names] with series[0].data [hire counts]
//   type 'table', title 'Work Term Ratings Summary': columns ['', ...,
//     'Average Work Term Satisfaction Rating', 'Number Of Ratings'], rows
//     for organization, division and all students. Values are 'N/A' below
//     five ratings.
//
// An employer with no report comes back as { missingReportStructure: true }.

const WORK_TERM_NAMES = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };

function stripTags(s) {
  return typeof s === 'string' ? s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function findSection(raw, type, titlePattern) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections)) return null;
  return raw.sections.find((s) => s && s.type === type && titlePattern.test(stripTags(s.title))) || null;
}

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** The division row of a report table, falling back to the organization row. */
function reportRows(table) {
  if (!table || !Array.isArray(table.rows)) return { division: null, organization: null };
  const find = (re) => table.rows.find((r) => Array.isArray(r) && re.test(String(r[0]))) || null;
  return { division: find(/division/i), organization: find(/organi[sz]ation/i) };
}

export function mapRatingReport(raw) {
  const empty = { byWorkTerm: [], programs: [], hired: null, terms: null };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections)) return empty;

  let hired = null;
  let terms = null;
  const hiring = findSection(raw, 'table', /hiring history/i);
  if (hiring && Array.isArray(hiring.columns)) {
    const { division, organization } = reportRows(hiring);
    const row = division || organization;
    const firstTerm = hiring.columns.findIndex((c) => /\d{4}/.test(String(c)));
    if (row && firstTerm > 0) {
      const counts = row.slice(firstTerm).map(toNumber);
      terms = counts.length;
      hired = counts.reduce((sum, n) => sum + (n || 0), 0);
    }
  }

  const byWorkTerm = [];
  const termPie = findSection(raw, 'pieChart', /work term number/i);
  if (termPie && Array.isArray(termPie.data)) {
    let total = 0;
    const entries = [];
    for (const d of termPie.data) {
      const word = String((d && d.name) || '').toLowerCase().match(/[a-z]+/);
      const term = word ? WORK_TERM_NAMES[word[0]] : null;
      const y = toNumber(d && d.y);
      if (!term || y == null || y < 0) continue;
      entries.push({ term, y });
      total += y;
    }
    if (total > 0) for (const e of entries.sort((a, b) => a.term - b.term)) byWorkTerm.push({ term: e.term, share: e.y / total });
  }

  const programs = [];
  const programBar = findSection(raw, 'barChart', /hired programs/i);
  if (programBar && Array.isArray(programBar.categories) && Array.isArray(programBar.series) && programBar.series[0]) {
    const counts = programBar.series[0].data || [];
    programBar.categories.forEach((name, i) => {
      const count = toNumber(counts[i]);
      if (typeof name === 'string' && name.trim() && count != null && count > 0) programs.push({ name: name.trim(), count });
    });
    programs.sort((a, b) => b.count - a.count);
  }

  return { byWorkTerm, programs, hired, terms };
}

/** Pure: { score, count } from the report's ratings table, division first, or null below five ratings. */
export function readRating(raw) {
  const table = findSection(raw, 'table', /work term ratings/i);
  if (!table || !Array.isArray(table.columns)) return null;
  const scoreCol = table.columns.findIndex((c) => /average/i.test(String(c)));
  const countCol = table.columns.findIndex((c) => /number of ratings/i.test(String(c)));
  if (scoreCol < 0) return null;
  const { division, organization } = reportRows(table);
  for (const row of [division, organization]) {
    const score = row ? toNumber(row[scoreCol]) : null;
    if (score != null) return { score, count: countCol >= 0 ? toNumber(row[countCol]) : null };
  }
  return null;
}

/** Pure: the average work term rating out of 10, or null. */
export function deriveRating(raw) {
  const r = readRating(raw);
  return r ? r.score : null;
}
