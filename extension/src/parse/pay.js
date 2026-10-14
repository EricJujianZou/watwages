// Pure pay parser. No dependencies. Runs in a content script and in Node.
// See docs/build-contract.md, "Pay parsing requirements".
//
// Input is the posting overview (HTML or text). The parser first narrows
// to the "Compensation and Benefits" section when the posting has one,
// then looks for money figures with a currency marker, works out the pay
// period from the words next to the figure, and converts to CAD per hour
// using the fixed rates in contract.js.
//
// The word lists that drive matching live in rules/pay.json. A content
// script cannot reliably import JSON with assertions, so DEFAULT_RULES
// below is a plain object kept identical to that file and
// extension/tests/pay.test.js asserts the two stay in sync.

import { RATES_TO_CAD, RATES_SET_ON } from '../contract.js';

/** @typedef {import('../contract.js').Pay} Pay */

export const DEFAULT_RULES = {
  sectionHeadings: ['compensation and benefits', 'compensation & benefits', 'compensation', 'salary', 'pay rate', 'wage'],
  currencyWords: {
    USD: ['usd', 'us$', 'u.s. dollars', 'us dollars', 'american dollars', 'u.s.$'],
    CAD: ['cad', 'c$', 'cdn', 'can$', 'ca$', 'canadian dollars'],
    EUR: ['eur', 'euro', 'euros', '€'],
    GBP: ['gbp', '£', 'pounds sterling'],
    CNY: ['rmb', 'cny', 'yuan', '¥'],
    JPY: ['jpy', 'yen'],
    INR: ['inr', 'rupees', '₹'],
    AUD: ['aud', 'a$', 'australian dollars'],
    CHF: ['chf', 'swiss francs'],
    HKD: ['hkd', 'hk$'],
    SGD: ['sgd', 's$', 'singapore dollars'],
  },
  periodWords: {
    hour: ['/hour', '/hr', '/h', 'per hour', 'an hour', 'each hour', 'hourly', 'p/h', 'ph'],
    day: ['/day', 'per day', 'a day', 'daily', 'per diem'],
    week: ['/week', '/wk', 'per week', 'a week', 'weekly'],
    month: ['/month', '/mo', 'per month', 'a month', 'monthly'],
    year: ['/year', '/yr', 'per year', 'a year', 'annually', 'per annum', 'annual', 'yearly'],
  },
  // Payment frequency phrases that mention a period but do not set one.
  frequencyWords: ['bi-weekly', 'biweekly', 'bi weekly', 'semi-monthly', 'semimonthly', 'every two weeks', 'every 2 weeks', 'twice a month'],
  unpaidWords: ['unpaid', 'volunteer', 'honorarium'],
  ignoreWords: [
    'relocation', 'housing allowance', 'housing stipend', 'signing bonus',
    'sign on bonus', 'sign-on bonus', 'series a', 'series b', 'series c',
    'series d', 'in funding', 'in revenue', 'raised', 'valuation',
    'travel allowance', 'flight', 'per diem allowance',
  ],
  workTermWords: ['work term', 'work terms', 'co-op term', 'coop term'],
  ordinalWords: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'],
  hoursPerWeekDefault: 40,
  daysPerWeek: 5,
  weeksPerYear: 52,
  monthsPerYear: 12,
  // A figure paid over a whole span ("$12k for 16 weeks", "$9,000 per term").
  // A term with no length given counts as a four month co-op term.
  termWeeksDefault: 16,
  numberWords: {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
    fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, twenty: 20,
  },
  minHourly: 10,
  maxHourly: 250,
  // When no period is stated, the size of the figure decides.
  magnitude: { hourBelow: 200, weekBelow: 2500, monthBelow: 20000 },
  // When no figure is found, the phrase that explains why, checked in this
  // order. Without a compensation section only sentences that mention pay
  // are checked, so 'competitive environment' never counts.
  notStatedReasons: {
    interview: [
      'tbd', 'to be determined', 'to be discussed', 'discussed at interview',
      'discussed at the interview', 'discussed in interview', 'discussed in the interview',
      'discussed during the interview', 'discussed during interview', 'disclosed at interview',
      'disclosed during the interview', 'provided at interview', 'shared during the interview',
    ],
    competitive: ['competitive'],
    experience: ['commensurate with experience', 'depending on experience', 'depends on experience', 'based on experience', 'doe'],
    negotiable: ['negotiable'],
  },
  payContextWords: ['salary', 'pay', 'compensation', 'wage', 'rate', 'remuneration', 'stipend'],
  maxSectionChars: 2000,
};

// ---------------------------------------------------------------------
// Text handling
// ---------------------------------------------------------------------

function normalizeText(input) {
  let t = String(input == null ? '' : input);
  if (/<[a-z][\s\S]*>/i.test(t)) {
    t = t.replace(/<(?:br|\/p|\/div|\/li|\/tr|\/td|\/th|\/h[1-6]|\/dt|\/dd|\/section)\b[^>]*>/gi, '\n');
    t = t.replace(/<[^>]*>/g, ' ');
  }
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#36;/g, '$');
  t = t.replace(/ /g, ' ');
  t = t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  return t;
}

/**
 * Narrow to the compensation section when the posting has one. Returns
 * the text after the heading up to the next label line, capped.
 */
function findSection(text, rules) {
  const lines = text.split('\n');
  const headings = rules.sectionHeadings;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const lower = line.toLowerCase().replace(/:$/, '').trim();
    const idx = headings.indexOf(lower);
    if (idx === -1) {
      // The heading can share a line with its value: "Compensation: $27/hr".
      const inline = headings.find((h) => lower.startsWith(h + ':') || lower.startsWith(h + ' :'));
      if (!inline) continue;
      const rest = line.slice(line.toLowerCase().indexOf(':') + 1).trim();
      const body = [rest, ...collectUntilLabel(lines, i + 1)].join('\n').trim();
      return body.slice(0, rules.maxSectionChars);
    }
    const body = collectUntilLabel(lines, i + 1).join('\n').trim();
    if (body) return body.slice(0, rules.maxSectionChars);
  }
  return null;
}

function looksLikeLabel(line) {
  // "Targeted Degrees and Disciplines:" or "Job Requirements:" style lines.
  return /^[A-Z][A-Za-z0-9 /&()'-]{2,60}:$/.test(line.trim());
}

function collectUntilLabel(lines, from) {
  const out = [];
  for (let i = from; i < lines.length; i += 1) {
    if (looksLikeLabel(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

function splitSentences(text) {
  const protectedText = text.replace(/(\d)\.(\d)/g, '$1\u0000$2');
  const parts = protectedText.split(/(?<=[.!?])\s+(?=[A-Z0-9$€£¥])/);
  return parts.map((p) => p.replace(/\u0000/g, '.').trim()).filter(Boolean);
}

function candidateLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    for (const s of splitSentences(line)) out.push(s);
  }
  return out;
}

function containsAny(lowerText, words) {
  return words.some((w) => lowerText.includes(w.toLowerCase()));
}

// ---------------------------------------------------------------------
// Money figures
// ---------------------------------------------------------------------

const CUR_PRE = "(?:US\\$|U\\.S\\.\\$|C\\$|CA\\$|CAD\\s?\\$|USD\\s?\\$|A\\$|S\\$|HK\\$|\\$|€|£|¥|₹|(?:USD|CAD|CDN|EUR|GBP|RMB|CNY|JPY|INR|AUD|CHF|HKD|SGD)\\s?)";
const NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
const K = '(\\s?[kK]\\b)?';
const CUR_POST = "(\\s?(?:\\$|(?:USD|CAD|CDN|EUR|GBP|RMB|CNY|JPY|INR|AUD|CHF|HKD|SGD|dollars|euros?|pounds|yuan|yen)\\b))?";
const MONEY = `(${CUR_PRE})?\\s?${NUM}${K}${CUR_POST}`;
const RANGE_SEP = '\\s*(?:-|–|—|to|and|~)\\s*';

const LEFT_PERIOD = '(?:\\s*\\/\\s*(?:hour|hr|h|day|week|wk|month|mo|year|yr)\\b)?';
const RANGE_RE = new RegExp(`(?:between\\s+)?${MONEY}${LEFT_PERIOD}${RANGE_SEP}${MONEY}`, 'gi');
const SINGLE_RE = new RegExp(MONEY, 'gi');

function parseNumber(numStr, kGroup) {
  let n = parseFloat(String(numStr).replace(/,/g, ''));
  if (kGroup) n *= 1000;
  return n;
}

function currencyFromMarker(marker) {
  if (!marker) return null;
  const m = marker.trim().toLowerCase().replace(/\s+/g, '');
  if (m === '$' || m === 'dollars') return '$';
  if (m.startsWith('us') || m === 'u.s.$') return 'USD';
  if (m.startsWith('ca') || m.startsWith('c$') || m.startsWith('cdn')) return 'CAD';
  if (m.startsWith('eur') || m === '€') return 'EUR';
  if (m.startsWith('gbp') || m === '£' || m === 'pounds') return 'GBP';
  if (m.startsWith('rmb') || m.startsWith('cny') || m === '¥' || m === 'yuan') return 'CNY';
  if (m.startsWith('jpy') || m === 'yen') return 'JPY';
  if (m.startsWith('inr') || m === '₹') return 'INR';
  if (m.startsWith('aud') || m === 'a$') return 'AUD';
  if (m.startsWith('chf')) return 'CHF';
  if (m.startsWith('hkd') || m === 'hk$') return 'HKD';
  if (m.startsWith('sgd') || m === 's$') return 'SGD';
  return '$';
}

/**
 * Every money figure in a sentence, ranges paired. Each item:
 * { min, max, marker, index, end }. Figures with no currency marker on
 * either end are dropped, so "38.5 hours" is never read as pay.
 */
const PERIOD_RIGHT_AFTER = /^\s*(?:\/\s*(?:hour|hr|h|day|week|wk|month|mo|year|yr)\b|per\s+(?:hour|day|week|month|year|annum)\b|an\s+hour\b|a\s+(?:day|week|month|year)\b|hourly|daily|weekly|monthly|annually|yearly)/i;

function moneyLike(marker, k, rest) {
  if (marker) return true;
  return PERIOD_RIGHT_AFTER.test(rest);
}

function findMoney(sentence, opts = {}) {
  const found = [];
  const taken = [];
  const currencyInSentence = !!opts.currencyInSentence;
  RANGE_RE.lastIndex = 0;
  let m;
  while ((m = RANGE_RE.exec(sentence)) !== null) {
    const [whole, pre1, num1, k1, post1, pre2, num2, k2, post2] = m;
    const end = m.index + whole.length;
    const rest = sentence.slice(end);
    const marker = pre1 || post1 || pre2 || post2;
    const isBetween = /^between/i.test(whole);
    // A bare pair of numbers only counts when a period follows it, or when
    // the "between X and Y" form appears in a sentence that names a currency.
    if (!marker && !moneyLike(null, null, rest) && !(isBetween && currencyInSentence)) continue;
    // "38.00/hr - 45.00/hr": the left figure carries its own period.
    const leftIsMoney = !!(pre1 || post1 || k1) || (!marker && moneyLike(null, null, sentence.slice(m.index + (pre1 || '').length + num1.length)));
    const leftSmallLabel = !leftIsMoney && !isBetween && /^\d{1,2}$/.test(num1) && !moneyLike(null, null, rest);
    if (leftSmallLabel) continue;
    found.push({
      min: Math.min(parseNumber(num1, k1), parseNumber(num2, k2)),
      max: Math.max(parseNumber(num1, k1), parseNumber(num2, k2)),
      marker: marker || null,
      index: m.index,
      end,
    });
    taken.push([m.index, end]);
  }
  SINGLE_RE.lastIndex = 0;
  while ((m = SINGLE_RE.exec(sentence)) !== null) {
    const [whole, pre, num, k, post] = m;
    const start = m.index;
    const end = start + whole.length;
    if (taken.some(([a, b]) => start >= a && start < b)) continue;
    const marker = pre || post;
    if (!moneyLike(marker, k, sentence.slice(end))) continue;
    const v = parseNumber(num, k);
    found.push({ min: v, max: v, marker: marker || null, index: start, end });
  }
  found.sort((a, b) => a.index - b.index);
  return found;
}

// ---------------------------------------------------------------------
// Period, hours, currency
// ---------------------------------------------------------------------

function stripFrequency(text, rules) {
  let t = text;
  for (const w of rules.frequencyWords) {
    t = t.split(new RegExp(w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi')).join(' ');
  }
  return t;
}

const HPW_RE = /(\d+(?:\.\d+)?)\s*(?:working\s*)?(?:hours?|hrs?)\s*(?:a|per|\/|each)\s*(?:week|wk)/i;

function stripHoursPerWeek(text) {
  return text.replace(new RegExp(HPW_RE.source, 'gi'), ' ');
}

function periodIn(text, rules) {
  const lower = stripHoursPerWeek(stripFrequency(text, rules)).toLowerCase().replace(/\s*\/\s*/g, '/');
  for (const period of ['hour', 'day', 'week', 'month', 'year']) {
    for (const w of rules.periodWords[period]) {
      const idx = lower.indexOf(w);
      if (idx === -1) continue;
      // Short tokens like "ph" and "/h" must stand alone.
      const before = idx === 0 ? ' ' : lower[idx - 1];
      const after = idx + w.length >= lower.length ? ' ' : lower[idx + w.length];
      const wordy = /^[a-z]/.test(w);
      if (wordy && /[a-z]/.test(before)) continue;
      if (/[a-z]/.test(after) && !['/hour', 'per hour', 'an hour', 'each hour', '/day', 'per day', 'a day', '/week', 'per week', 'a week', '/month', 'per month', 'a month', '/year', 'per year', 'a year', 'per annum'].includes(w)) {
        if (w === '/h' || w === 'ph' || w === '/mo' || w === '/wk' || w === '/yr' || w === '/hr') {
          // "/hr" followed by a letter (like "/hrs") is still the hour.
          if (!(w === '/hr' && after === 's')) continue;
        } else {
          continue;
        }
      }
      return period;
    }
  }
  return null;
}

const SPAN_RE = /^\s*(?:\(?\s*total\s*\)?\s*)?,?\s*(?:for|over)\s+(?:a|an|the|each|your)?\s*(\d+(?:\.\d+)?|[a-z]+)[\s-]*(week|wk|month|mo)s?\b(?!\s*(?:work\s*|co-?op\s*)?term)/i;
const TERM_LUMP_RE = /^\s*(?:\(?\s*total\s*\)?\s*)?,?\s*(?:per|each|a|for\s+(?:the|each|a|your))\s+(?:(\d+|[a-z]+)[\s-]*(week|month)s?\s+)?(?:work\s*|co-?op\s*)?term\b/i;

function countOf(word, rules) {
  if (/^\d/.test(word)) return parseFloat(word);
  const n = rules.numberWords[word.toLowerCase()];
  return n == null ? null : n;
}

function weeksOf(n, unit, rules) {
  return /^(week|wk)/i.test(unit) ? n : n * rules.weeksPerYear / rules.monthsPerYear;
}

/** Weeks the figure is paid over when it is a total for a span, or null. */
function spanWeeks(after, rules) {
  const m = SPAN_RE.exec(after);
  if (m) {
    const n = countOf(m[1], rules);
    if (n) return { weeks: weeksOf(n, m[2], rules), stated: true };
  }
  const t = TERM_LUMP_RE.exec(after);
  if (t) {
    const n = t[1] ? countOf(t[1], rules) : null;
    if (n) return { weeks: weeksOf(n, t[2], rules), stated: true };
    return { weeks: rules.termWeeksDefault, stated: false };
  }
  return null;
}

/**
 * A figure followed by a span ("for 16 weeks", "per term") is a total for
 * that span. Otherwise the period stated next to a figure wins. Failing that, the sentence,
 * then the lines around it, then the whole section. Failing all of that,
 * the size of the figure decides.
 */
function findPeriod(sentence, money, context, rules) {
  const span = spanWeeks(sentence.slice(money.end, money.end + 40), rules);
  if (span) return { period: 'span', how: 'stated', weeks: span.weeks, weeksStated: span.stated };
  const after = sentence.slice(money.end, money.end + 28);
  const near = periodIn(after, rules);
  if (near) return { period: near, how: 'stated' };
  const inSentence = periodIn(sentence, rules);
  if (inSentence) return { period: inSentence, how: 'stated' };
  const inContext = periodIn(context, rules);
  if (inContext) return { period: inContext, how: 'nearby' };
  const mag = rules.magnitude;
  const v = money.max;
  if (v < mag.hourBelow) return { period: 'hour', how: 'guessed' };
  if (v < mag.weekBelow) return { period: 'week', how: 'guessed' };
  if (v < mag.monthBelow) return { period: 'month', how: 'guessed' };
  return { period: 'year', how: 'guessed' };
}

function findCurrency(marker, sentence, context, rules, countryHint) {
  const fromMarker = currencyFromMarker(marker);
  if (fromMarker && fromMarker !== '$') return fromMarker;
  for (const text of [sentence, context]) {
    const lower = text.toLowerCase();
    for (const code of Object.keys(rules.currencyWords)) {
      for (const w of rules.currencyWords[code]) {
        const idx = lower.indexOf(w);
        if (idx === -1) continue;
        const before = idx === 0 ? ' ' : lower[idx - 1];
        const after = idx + w.length >= lower.length ? ' ' : lower[idx + w.length];
        if (/[a-z]/.test(w[0]) && (/[a-z]/.test(before) || /[a-z]/.test(after))) continue;
        return code;
      }
    }
  }
  if (countryHint === 'US') return 'USD';
  return 'CAD';
}

function findHoursPerWeek(text, rules, opts) {
  const m = HPW_RE.exec(text);
  if (m) return parseFloat(m[1]);
  if (opts.hoursPerWeek != null) return opts.hoursPerWeek;
  return rules.hoursPerWeekDefault;
}

function convertToHourly(amount, period, hoursPerWeek, rules, weeks) {
  if (period === 'hour') return amount;
  if (period === 'span') return amount / (weeks * hoursPerWeek);
  if (period === 'day') return amount / (hoursPerWeek / rules.daysPerWeek);
  if (period === 'week') return amount / hoursPerWeek;
  if (period === 'month') return amount / (hoursPerWeek * rules.weeksPerYear / rules.monthsPerYear);
  if (period === 'year') return amount / (hoursPerWeek * rules.weeksPerYear);
  return amount;
}

function formatMoney(value, currency) {
  const rounded = Math.round(value * 100) / 100;
  const isWhole = Number.isInteger(rounded);
  const digits = rounded.toLocaleString('en-US', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  if (!currency || currency === 'CAD' || currency === 'USD') return '$' + digits;
  return `${currency} ${digits}`;
}

function formatRateDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const PERIOD_PHRASE = { hour: 'per hour', day: 'per day', week: 'per week', month: 'per month', year: 'per year' };

// ---------------------------------------------------------------------
// Pay by work term
// ---------------------------------------------------------------------

const TERM_BEFORE_RE = /(?:work\s*term|co-?op\s*term|term)\s*#?\s*(\d)\s*[:\-–—]?\s*$|(first|second|third|fourth|fifth|sixth|seventh|eighth)\s*(?:work\s*term|co-?op\s*term|term)?\s*[:\-–—]?\s*$|\b(\d)(?:st|nd|rd|th)\s*(?:work\s*term|co-?op\s*term|term)?\s*[:\-–—]?\s*$/i;
const TERM_AFTER_RE = /^\s*(?:\/\s*[a-z]+|per\s+[a-z]+|an?\s+[a-z]+|hourly|daily|weekly|monthly)?\s*(?:[,;]?\s*(?:for|in|on|during)?\s*(?:the|your)?\s*)?(?:(first|second|third|fourth|fifth|sixth|seventh|eighth)|(\d)(?:st|nd|rd|th)?)\s*(?:work\s*term|co-?op\s*term|term)/i;

function termNumber(word, digit, rules) {
  if (digit) return parseInt(digit, 10);
  if (word) return rules.ordinalWords.indexOf(word.toLowerCase()) + 1;
  return null;
}

function termFor(sentence, money, rules) {
  const before = sentence.slice(Math.max(0, money.index - 24), money.index);
  const mb = TERM_BEFORE_RE.exec(before);
  if (mb) return termNumber(mb[2], mb[1] || mb[3], rules);
  const after = sentence.slice(money.end, money.end + 40);
  const ma = TERM_AFTER_RE.exec(after);
  if (ma) return termNumber(ma[1], ma[2], rules);
  return null;
}

/**
 * Collect "Work Term N: $x" style figures across the section. Returns
 * [{term, min, max, marker, sentence}] sorted by term, or null.
 */
function collectPerTerm(sentences, rules) {
  const byTerm = new Map();
  let sawTermWord = false;
  for (const s of sentences) {
    const lower = s.toLowerCase();
    if (containsAny(lower, rules.workTermWords) || /\b(first|second|third|fourth|fifth|sixth)\s*:/i.test(s) || /\bterm\s*\d/i.test(s)) sawTermWord = true;
    if (containsAny(lower, rules.ignoreWords)) continue;
    for (const money of findMoney(s, { currencyInSentence: mentionsCurrency(s, rules) })) {
      const term = termFor(s, money, rules);
      if (term == null || term < 1 || term > 8) continue;
      if (!byTerm.has(term)) byTerm.set(term, { term, ...money, sentence: s });
    }
  }
  if (!sawTermWord || byTerm.size < 2) return null;
  return Array.from(byTerm.values()).sort((a, b) => a.term - b.term);
}

function chooseTerm(perTerm, completedWorkTerms) {
  if (completedWorkTerms == null || Number.isNaN(Number(completedWorkTerms))) return null;
  const want = Number(completedWorkTerms) + 1;
  let best = null;
  for (const entry of perTerm) {
    if (entry.term === want) return entry;
    if (entry.term < want && (!best || entry.term > best.term)) best = entry;
  }
  return best || perTerm[0];
}

// ---------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------

function baseResult(status) {
  return {
    status,
    currency: null,
    original: null,
    hourly: null,
    hourlyCad: null,
    quote: null,
    assumptions: [],
    perTerm: null,
    hoursPerWeek: null,
    source: null,
  };
}

function rateAssumption(currency, rate) {
  return `Converted from ${currency} at ${rate} CAD, a fixed rate set ${formatRateDate(RATES_SET_ON)}.`;
}

function periodAssumption(min, max, period, how, hoursPerWeek, currency, rules, weeks, weeksStated) {
  const stated = min === max ? formatMoney(min, currency) : `${formatMoney(min, currency)} to ${formatMoney(max, currency)}`;
  if (period === 'span') {
    const w = Math.round(weeks * 10) / 10;
    return weeksStated
      ? `Stated as ${stated} for the whole ${w} weeks. Converted at ${hoursPerWeek} hours a week.`
      : `Stated as ${stated} for the term. Read the term as ${w} weeks at ${hoursPerWeek} hours a week.`;
  }
  const hours = period === 'day'
    ? `${hoursPerWeek / rules.daysPerWeek} hours a day`
    : `${hoursPerWeek} hours a week`;
  if (period === 'hour') {
    return how === 'guessed' ? `No pay period stated. Read ${stated} as an hourly rate from its size.` : null;
  }
  const lead = how === 'guessed'
    ? `No pay period stated. Read ${stated} as ${PERIOD_PHRASE[period]} from its size.`
    : `Stated as ${stated} ${PERIOD_PHRASE[period]}.`;
  return `${lead} Converted at ${hours}.`;
}

function perTermAssumption(perTerm, chosen, completedWorkTerms, currency) {
  const list = perTerm.map((e) => `term ${e.term} ${e.min === e.max ? formatMoney(e.min, currency) : formatMoney(e.min, currency) + ' to ' + formatMoney(e.max, currency)}`).join(', ');
  if (chosen) {
    return `Pay changes by work term (${list}). Showing work term ${chosen.term}, the next one after your ${completedWorkTerms} completed.`;
  }
  return `Pay changes by work term (${list}). Showing the lowest to highest. Add your completed work terms in the panel to see yours.`;
}

function finish(pick, meta, rules) {
  const { currency, period, how, weeks, weeksStated, hoursPerWeek, quote, source, perTerm, chosen, completedWorkTerms } = meta;
  const hourlyMin = convertToHourly(pick.min, period, hoursPerWeek, rules, weeks);
  const hourlyMax = convertToHourly(pick.max, period, hoursPerWeek, rules, weeks);
  const rate = RATES_TO_CAD[currency] != null ? RATES_TO_CAD[currency] : 1;
  const assumptions = [];
  if (perTerm) assumptions.push(perTermAssumption(perTerm, chosen, completedWorkTerms, currency));
  const pa = periodAssumption(pick.min, pick.max, period, how, hoursPerWeek, currency, rules, weeks, weeksStated);
  if (pa) assumptions.push(pa);
  if (currency !== 'CAD') assumptions.push(rateAssumption(currency, rate));
  return {
    status: 'stated',
    currency,
    original: period === 'span' ? { min: pick.min, max: pick.max, period, weeks } : { min: pick.min, max: pick.max, period },
    hourly: { min: hourlyMin, max: hourlyMax },
    hourlyCad: { min: hourlyMin * rate, max: hourlyMax * rate },
    quote,
    assumptions,
    perTerm: perTerm ? perTerm.map((e) => ({ term: e.term, min: e.min, max: e.max })) : null,
    hoursPerWeek,
    source,
  };
}

function inRange(pick, period, hoursPerWeek, currency, rules, weeks) {
  const rate = RATES_TO_CAD[currency] != null ? RATES_TO_CAD[currency] : 1;
  const lo = convertToHourly(pick.min, period, hoursPerWeek, rules, weeks) * rate;
  const hi = convertToHourly(pick.max, period, hoursPerWeek, rules, weeks) * rate;
  return lo >= rules.minHourly && lo <= rules.maxHourly && hi >= rules.minHourly && hi <= rules.maxHourly;
}

function makeParsePay(defaultRules) {
  return function parsePay(text, opts = {}) {
    const rules = opts.rules || defaultRules;
    const clean = normalizeText(text);
    if (!clean) return baseResult('not_stated');

    const section = findSection(clean, rules);
    const scope = section || clean;
    const sentences = candidateLines(scope);
    const hoursPerWeek = findHoursPerWeek(scope, rules, opts);
    const completedWorkTerms = opts.completedWorkTerms != null ? Number(opts.completedWorkTerms) : null;

    // Pay stated per work term.
    const perTerm = collectPerTerm(sentences, rules);
    if (perTerm) {
      const first = perTerm[0];
      const { period, how, weeks, weeksStated } = findPeriod(first.sentence, first, scope, rules);
      const currency = findCurrency(first.marker, first.sentence, scope, rules, opts.countryHint);
      const span = { min: Math.min(...perTerm.map((e) => e.min)), max: Math.max(...perTerm.map((e) => e.max)) };
      if (inRange(span, period, hoursPerWeek, currency, rules, weeks)) {
        const chosen = chooseTerm(perTerm, completedWorkTerms);
        const pick = chosen ? { min: chosen.min, max: chosen.max } : span;
        return finish(pick, {
          currency, period, how, weeks, weeksStated, hoursPerWeek,
          quote: perTerm.map((e) => e.sentence).filter((s, i, arr) => arr.indexOf(s) === i).join(' '),
          source: section, perTerm, chosen, completedWorkTerms,
        }, rules);
      }
    }

    // Otherwise the first figure that reads as pay. Lines aimed at
    // graduate students only are tried last, since our users are
    // undergraduates.
    const ordered = [...sentences].sort((a, b) => gradOnly(a) - gradOnly(b));
    for (const sentence of ordered) {
      for (const money of findMoney(sentence, { currencyInSentence: mentionsCurrency(sentence, rules) })) {
        if (containsAny(clauseAround(sentence, money).toLowerCase(), rules.ignoreWords)) continue;
        const { period, how, weeks, weeksStated } = findPeriod(sentence, money, scope, rules);
        const currency = findCurrency(money.marker, sentence, scope, rules, opts.countryHint);
        if (!inRange(money, period, hoursPerWeek, currency, rules, weeks)) continue;
        return finish(money, {
          currency, period, how, weeks, weeksStated, hoursPerWeek, quote: sentence, source: section,
          perTerm: null, chosen: null, completedWorkTerms,
        }, rules);
      }
    }

    const lowerAll = scope.toLowerCase();
    if (containsAny(lowerAll, rules.unpaidWords)) {
      const r = baseResult('unpaid');
      r.quote = sentences.find((s) => containsAny(s.toLowerCase(), rules.unpaidWords)) || null;
      r.source = section;
      return r;
    }
    const r = baseResult('not_stated');
    r.source = section;
    r.reason = findNotStatedReason(section, sentences, rules);
    return r;
  };
}

// The part of a sentence a figure sits in, cut at commas, semicolons, "and"
// and "plus". "Salary USD $45/hr and relocation stipend" keeps the salary,
// since the stipend is a separate clause from the $45.
const CLAUSE_BREAK_RE = /[,;]|\s(?:and|plus|\+)\s/gi;
function clauseAround(sentence, money) {
  let start = 0;
  let end = sentence.length;
  CLAUSE_BREAK_RE.lastIndex = 0;
  let m;
  while ((m = CLAUSE_BREAK_RE.exec(sentence)) !== null) {
    // A comma inside a number such as "$2,000" is not a break.
    if (m[0] === ',' && /\d/.test(sentence[m.index - 1] || '') && /\d/.test(sentence[m.index + 1] || '')) continue;
    if (m.index + m[0].length <= money.index) start = m.index + m[0].length;
    else if (m.index >= money.end) { end = m.index; break; }
  }
  return sentence.slice(start, end);
}

/** Key of rules.notStatedReasons that explains a missing figure, or null. */
function findNotStatedReason(section, sentences, rules) {
  const pool = section
    ? [section]
    : sentences.filter((s) => rules.payContextWords.some((w) => new RegExp(`\\b${w}`, 'i').test(s)));
  for (const [key, phrases] of Object.entries(rules.notStatedReasons)) {
    for (const text of pool) {
      if (phrases.some((p) => new RegExp(`\\b${p}\\b`, 'i').test(text))) return key;
    }
  }
  return null;
}

function mentionsCurrency(sentence, rules) {
  const lower = sentence.toLowerCase();
  if (/[$€£¥₹]/.test(lower)) return true;
  return Object.values(rules.currencyWords).some((words) => words.some((w) => {
    const idx = lower.indexOf(w);
    if (idx === -1) return false;
    const before = idx === 0 ? ' ' : lower[idx - 1];
    const after = idx + w.length >= lower.length ? ' ' : lower[idx + w.length];
    return !(/[a-z]/.test(before) || /[a-z]/.test(after));
  }));
}

function gradOnly(sentence) {
  const lower = sentence.toLowerCase();
  if (lower.includes('undergrad')) return 0;
  if (/\b(graduate|masters?|phd|doctoral)\b/.test(lower)) return 1;
  return 0;
}

/**
 * Re-pick the figure for a student's next work term from a parsed Pay.
 * Returns the same object when the posting does not pay by work term.
 * @param {Pay} pay
 * @param {number|null} completedWorkTerms
 * @returns {Pay}
 */
export function applyProfile(pay, completedWorkTerms, rules = DEFAULT_RULES) {
  if (!pay || pay.status !== 'stated' || !pay.perTerm || !pay.perTerm.length) return pay;
  const chosen = chooseTerm(pay.perTerm, completedWorkTerms);
  const span = { min: Math.min(...pay.perTerm.map((e) => e.min)), max: Math.max(...pay.perTerm.map((e) => e.max)) };
  const pick = chosen ? { min: chosen.min, max: chosen.max } : span;
  const period = pay.original.period;
  const hoursPerWeek = pay.hoursPerWeek || rules.hoursPerWeekDefault;
  const how = pay.assumptions.some((a) => a.startsWith('No pay period stated')) ? 'guessed' : 'stated';
  const result = finish(pick, {
    currency: pay.currency, period, how, hoursPerWeek, quote: pay.quote, source: pay.source,
    perTerm: pay.perTerm, chosen, completedWorkTerms: completedWorkTerms != null ? Number(completedWorkTerms) : null,
  }, rules);
  return result;
}

export function createPayParser(rules) {
  return makeParsePay(rules);
}

export const parsePay = makeParsePay(DEFAULT_RULES);
