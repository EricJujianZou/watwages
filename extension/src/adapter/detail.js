// Builds a PostingDetail (docs/build-contract-v2.md, "Data the overlay
// renders") out of the page's own getPostingOverview HTML, getPostingData
// and a raw getWorkTermRatingReportJson response. Pure and DOM-free, so it
// is unit tested directly; content.js only supplies the three raw inputs.
//
// The posting overview's real structure has never been seen (see the
// module comment in ./ww.js): this reads it the same way parse/package.js
// reads Required Skills and Application Documents Required, generalised to
// every "Label:" line the text contains, rather than a fixed list of
// section names. A line that is only a label ("Job Summary:") opens a
// section whose body runs until the next label line; a line with a value on
// the same line ("Application Deadline: Oct 2, 2026") is a single field
// instead. Correct this the first time a real posting overview is read.

import { mapRatingReport, readRating } from './ww.js';
import { decodeEntities } from '../parse/entities.js';

const COMPANY_FIELD_PATTERN = /company|organization|division|employer|website|address/i;

function normalizeHtml(input) {
  let t = String(input == null ? '' : input);
  if (/<[a-z][\s\S]*>/i.test(t)) {
    t = t.replace(/<(?:br|\/p|\/div|\/li|\/tr|\/td|\/th|\/h[1-6]|\/dt|\/dd|\/section)\b[^>]*>/gi, '\n');
    t = t.replace(/<[^>]*>/g, '');
  }
  t = decodeEntities(t);
  t = t.replace(/ /g, ' ');
  t = t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/[ \t]+/g, ' ');
  t = t
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return t;
}

const HEADING_ONLY_RE = /^([A-Z][A-Za-z0-9 /&()'-]{2,60}):$/;
const INLINE_FIELD_RE = /^([A-Z][A-Za-z0-9 /&()'-]{2,60}):\s+(.+)$/;

function isLabelLine(line) {
  const t = line.trim();
  return HEADING_ONLY_RE.test(t) || INLINE_FIELD_RE.test(t);
}

function normalizeBullet(line) {
  const m = line.match(/^\s*[-•*]\s+(.*)$/);
  return m ? `- ${m[1]}` : line;
}

/**
 * @param {string} text normalized posting overview text
 * @returns {{sections: {heading:string, text:string}[], fields: {label:string, value:string}[]}}
 */
function splitLabelledContent(text) {
  const lines = text.split('\n');
  const sections = [];
  const fields = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      i += 1;
      continue;
    }
    const headingMatch = line.match(HEADING_ONLY_RE);
    if (headingMatch) {
      const heading = headingMatch[1].trim();
      const bodyLines = [];
      i += 1;
      while (i < lines.length && !isLabelLine(lines[i])) {
        if (lines[i].trim()) bodyLines.push(normalizeBullet(lines[i]));
        i += 1;
      }
      const bodyText = bodyLines.join('\n').trim();
      if (bodyText) sections.push({ heading, text: bodyText });
      continue;
    }
    const inlineMatch = line.match(INLINE_FIELD_RE);
    if (inlineMatch) {
      fields.push({ label: inlineMatch[1].trim(), value: inlineMatch[2].trim() });
      i += 1;
      continue;
    }
    // A stray line before any label at all: nothing to attach it to.
    i += 1;
  }
  return { sections, fields };
}

/**
 * @param {string} overviewHtml raw getPostingOverview response
 * @param {object|null} postingData raw getPostingData response
 * @param {object|null} ratingRaw raw getWorkTermRatingReportJson response
 * @returns {import('../contract.js').PostingDetail}
 */
export function buildPostingDetail(overviewHtml, postingData, ratingRaw) {
  const text = normalizeHtml(overviewHtml);
  const { sections, fields } = splitLabelledContent(text);

  const companyFields = [];
  const applicationFields = [];
  for (const field of fields) {
    if (COMPANY_FIELD_PATTERN.test(field.label)) companyFields.push(field);
    else applicationFields.push(field);
  }

  const history = ratingRaw ? mapRatingReport(ratingRaw) : null;
  const rated = readRating(ratingRaw);
  const rating = rated ? rated.score : null;
  const ratingCount = rated ? rated.count : null;

  return { sections, companyFields, applicationFields, history, rating, ratingCount };
}

// Employer Student Direct postings usually say "Application Delivery: Website"
// and then "If by Website, go to: https://...". That address is where the
// student actually applies, so the overlay's Apply button goes straight
// there. Returns null when the posting does not ask for a website
// application or names no address after saying so.
const WEBSITE_DELIVERY_RE = /if by website|apply (?:directly )?(?:by|via|through|on) (?:the )?(?:employer'?s? |company'?s? )?website|application (?:delivery|method)[^\n<]{0,40}website/i;
const URL_RE = /https?:\/\/[^\s"'<>)]+|www\.[^\s"'<>)]+/i;

export function findApplyUrl(overviewHtml) {
  const raw = String(overviewHtml == null ? '' : overviewHtml);
  const hit = raw.match(WEBSITE_DELIVERY_RE);
  if (!hit) return null;
  const after = raw.slice(hit.index, hit.index + 2000);
  const found = after.match(URL_RE);
  if (!found) return null;
  let url = found[0].replace(/&amp;/g, '&').replace(/[.,;:]+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}
