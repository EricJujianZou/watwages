// Shared shapes and constants. Every module imports from here so the three
// parts of the build agree. See docs/build-contract.md.

export const TERMS = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'];

export const DEFAULT_SETTINGS = {
  overlayEnabled: true,
  // Each weight is an integer 1..5. Every factor starts at 3, where it
  // counts exactly as the ROI formula describes it.
  weights: { pay: 3, odds: 3, level: 3, year: 3, repeat: 3 },
};

// Fixed exchange rates to CAD, set by hand at release time. Students do
// not care about the fourth decimal; the popover states the rate used.
// The extension makes no network calls, so these are bundled.
export const RATES_TO_CAD = {
  CAD: 1,
  USD: 1.37,
  EUR: 1.60,
  GBP: 1.85,
  CNY: 0.19,
  JPY: 0.0093,
  INR: 0.016,
  AUD: 0.90,
  CHF: 1.70,
  HKD: 0.175,
  SGD: 1.06,
};
export const RATES_SET_ON = '2026-09-21';

export const STORAGE_KEYS = {
  settings: 'wmj.settings',
  profile: 'wmj.profile',
  cachePrefix: 'wmj.job.',
  marks: 'wmj.marks',
  savedSearches: 'wmj.savedSearches',
  latestFilters: 'wmj.latestFilters',
};

export const MESSAGE_TAG = 'wmj';

/**
 * @typedef {{min:number, max:number}} Range
 *
 * @typedef {Object} Pay
 * @property {'stated'|'unpaid'|'not_stated'} status
 * @property {string|null} currency   ISO code, a key of RATES_TO_CAD
 * @property {{min:number, max:number, period:'hour'|'day'|'week'|'month'|'year'|'span', weeks?:number}|null} original
 * @property {Range|null} hourly      in the stated currency
 * @property {Range|null} hourlyCad
 * @property {string|null} quote      the sentence the figure was read from
 * @property {string[]} assumptions   plain sentences for the popover
 *
 * @typedef {Object} YearReq
 * @property {boolean} found
 * @property {string|null} minTerm          one of TERMS
 * @property {number|null} minWorkTerms
 * @property {'required'|'preferred'|null} strength
 * @property {string|null} quote
 *
 * @typedef {Object} History
 * @property {{term:number, share:number}[]} byWorkTerm   term 1..6, shares sum to 1
 * @property {{name:string, count:number}[]} programs   most hired programs, by hires
 * @property {number|null} [hired]   division hires across the report's terms
 * @property {number|null} [terms]   how many terms the report covers, nine as of 2026-09
 *
 * @typedef {Object} JobFacts
 * @property {string} jobId
 * @property {string} title
 * @property {string} org
 * @property {'junior'|'intermediate'|'senior'|null} [level]  a single level; older shape, still read
 * @property {string[]} [levels]   a posting can list several levels; new shape, preferred when present
 * @property {number|null} apps
 * @property {number|null} openings
 * @property {number|null} daysLive
 * @property {number|null} daysLeft
 * @property {Pay|null|undefined} pay   undefined means the posting hasn't been read yet
 * @property {YearReq|null} year
 * @property {History|null} history
 * @property {import('./parse/package.js').Skills|null|undefined} skills  undefined on facts cached before this field existed
 * @property {import('./parse/package.js').Docs|null|undefined} docs
 *
 * @typedef {{program:string, term:string, completedWorkTerms:number}|null} Profile
 *
 * @typedef {Object} RoiResult
 * @property {number|null} score          0..100, absolute (not a percentile). null when pay
 *   hasn't been read yet and no board median is available to stand in for it.
 * @property {number|null} payUsed        hourly CAD used for this job. 0 for unpaid. null
 *   when score is null.
 * @property {boolean} payEstimated       true when payUsed came from the board's median pay,
 *   not from this posting.
 * @property {number} appsPerOpeningUsed
 * @property {number} odds                1 / appsPerOpeningUsed
 * @property {{level:number, year:number, repeat:number}} factors
 * @property {string[]} reasons
 * @property {{kind:'year'|'company_best'|'company_other', text:string}[]} chips
 */
