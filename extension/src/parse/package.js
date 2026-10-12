// Pure parser for the two things a student wants to know before opening a
// posting: which named skills and tools it asks for, and which documents
// the application package needs beyond a resume. Its only import is the
// HTML code decoder. Runs in a content script and in Node, like pay.js and year.js.
//
// Input is the posting overview (HTML or text). Both fields are read from
// their own labelled section ("Required Skills:", "Application Documents
// Required:"). getPostingData is searched as a fallback for the documents
// list, since nobody on this project has seen whether the overview carries
// the Application Information block or only the posting body.
import { decodeEntities } from './entities.js';

export const DEFAULT_RULES = {
  skillHeadings: ['required skills', 'skills required', 'required skills and qualifications', 'skills'],
  docHeadings: ['application documents required', 'application documents', 'documents required', 'required documents'],
  maxSectionChars: 3000,
  // The three documents a WaterlooWorks package can ask for. Grade reports
  // and work term history go with every application, so they are not read.
  docs: [
    { name: 'Resume', short: 'Resume', pattern: /\b(?:r[eé]sum[eé]s?|cv|curriculum vitae)(?![a-z])/i },
    { name: 'Cover letter', short: 'cover', pattern: /\bcover letters?\b/i },
    { name: 'Portfolio', short: 'portfolio', pattern: /\bportfolios?\b/i },
  ],
  // Named, checkable skills only. Soft skills ("communication", "team
  // player") are left out on purpose, since every posting lists them.
  // Short or ambiguous names are matched case sensitively.
  skills: [
    ['Python', /\bpython\b/i],
    ['JavaScript', /\bjavascript\b|\bJS\b/i],
    ['TypeScript', /\btypescript\b/i],
    ['Java', /\bjava\b(?!\s*script)/i],
    ['C++', /\bC\+\+|\bcpp\b/i],
    ['C#', /\bC#|\.NET\b|\bdotnet\b/i],
    ['C', /(?:^|[\s,(/])C(?=$|[\s,)/;.]|\s+programming)/],
    ['Go', /\bGolang\b|\bGo\b(?=\s*[,/)]|\s+(?:and|or|programming|language))/],
    ['Rust', /\bRust\b/],
    ['Kotlin', /\bkotlin\b/i],
    ['Swift', /\bSwift\b/],
    ['Ruby', /\bruby\b/i],
    ['PHP', /\bPHP\b/],
    ['Scala', /\bscala\b/i],
    ['R', /(?:^|[\s,(/])R(?=[\s,)/;.]|$)/],
    ['MATLAB', /\bmatlab\b/i],
    ['SQL', /\b(?:my|postgre|no|t-|ms)?sql\b/i],
    ['Bash', /\bbash\b|\bshell script/i],
    ['React', /\breact(?:\.js|js)?\b(?!\s+native)/i],
    ['React Native', /\breact native\b/i],
    ['Angular', /\bangular\b/i],
    ['Vue', /\bvue(?:\.js)?\b/i],
    ['Node.js', /\bnode(?:\.js|js)?\b/i],
    ['HTML/CSS', /\bhtml5?\b|\bcss3?\b/i],
    ['Django', /\bdjango\b/i],
    ['Flask', /\bflask\b/i],
    ['Spring', /\bspring (?:boot|framework)\b/i],
    ['AWS', /\bAWS\b|\bamazon web services\b/i],
    ['Azure', /\bazure\b/i],
    ['GCP', /\bGCP\b|\bgoogle cloud\b/i],
    ['Docker', /\bdocker\b/i],
    ['Kubernetes', /\bkubernetes\b|\bk8s\b/i],
    ['Git', /\bgit\b(?!hub|lab)/i],
    ['Linux', /\blinux\b|\bunix\b/i],
    ['PyTorch', /\bpytorch\b/i],
    ['TensorFlow', /\btensorflow\b/i],
    ['Machine learning', /\bmachine learning\b|\bML\b/i],
    ['LLMs', /\bLLMs?\b|\blarge language models?\b/i],
    ['Computer vision', /\bcomputer vision\b/i],
    ['Pandas', /\bpandas\b/i],
    ['Spark', /\bSpark\b/],
    ['Tableau', /\btableau\b/i],
    ['Power BI', /\bpower ?bi\b/i],
    ['Excel', /\bExcel\b/],
    ['VBA', /\bVBA\b/],
    ['Figma', /\bfigma\b/i],
    ['Adobe', /\badobe\b|\bphotoshop\b|\billustrator\b/i],
    ['SolidWorks', /\bsolidworks\b/i],
    ['AutoCAD', /\bautocad\b/i],
    ['CAD', /\bCAD\b/],
    ['Simulink', /\bsimulink\b/i],
    ['LabVIEW', /\blabview\b/i],
    ['Verilog', /\bverilog\b|\bsystemverilog\b/i],
    ['VHDL', /\bVHDL\b/i],
    ['FPGA', /\bFPGAs?\b/i],
    ['PCB design', /\bPCB\b|\baltium\b|\bkicad\b/i],
    ['Embedded', /\bembedded\b|\bfirmware\b|\bmicrocontrollers?\b/i],
    ['ROS', /\bROS2?\b/],
    ['PLC', /\bPLCs?\b/],
    ['Salesforce', /\bsalesforce\b/i],
    ['SAP', /\bSAP\b/],
    ['Jira', /\bjira\b/i],
  ],
};

function normalizeText(input) {
  let t = String(input == null ? '' : input);
  if (/<[a-z][\s\S]*>/i.test(t)) {
    t = t.replace(/<(?:br|\/p|\/div|\/li|\/tr|\/td|\/th|\/h[1-6]|\/dt|\/dd|\/section)\b[^>]*>/gi, '\n');
    t = t.replace(/<[^>]*>/g, ' ');
  }
  t = decodeEntities(t);
  t = t.replace(/ /g, ' ');
  t = t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  return t;
}

function looksLikeLabel(line) {
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

/** Text of the first section whose heading is in `headings`, or null. */
function findSection(text, headings, maxChars) {
  const lines = text.split('\n');
  for (const heading of headings) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      const lower = line.toLowerCase();
      if (lower.replace(/\s*:$/, '') === heading) {
        const body = collectUntilLabel(lines, i + 1).join('\n').trim();
        if (body) return body.slice(0, maxChars);
      } else if (lower.startsWith(heading + ':') || lower.startsWith(heading + ' :')) {
        const rest = line.slice(line.indexOf(':') + 1).trim();
        const body = [rest, ...collectUntilLabel(lines, i + 1)].join('\n').trim();
        if (body) return body.slice(0, maxChars);
      }
    }
  }
  return null;
}

// Depth-limited walk over getPostingData's response for a string stored
// under a key that looks like the documents field. The response shape is
// unconfirmed, so this only looks and never assumes.
function findDocsInData(data, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 4) return null;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && /document/i.test(key) && value.trim()) return value;
    if (Array.isArray(value) && /document/i.test(key)) {
      const joined = value.map((v) => (typeof v === 'string' ? v : v && (v.name || v.label || v.title))).filter(Boolean).join(', ');
      if (joined) return joined;
    }
  }
  for (const value of Object.values(data)) {
    const found = findDocsInData(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * @typedef {Object} Skills
 * @property {boolean} found     the posting has a Required Skills section
 * @property {string[]} names    named skills, in the order the posting lists them
 * @property {string|null} quote the section text, trimmed
 *
 * @param {string} text posting overview, HTML or text
 * @returns {Skills}
 */
export function parseSkills(text, rules = DEFAULT_RULES) {
  const clean = normalizeText(text);
  const section = clean ? findSection(clean, rules.skillHeadings, rules.maxSectionChars) : null;
  if (!section) return { found: false, names: [], quote: null };
  const hits = [];
  for (const [name, pattern] of rules.skills) {
    const m = pattern.exec(section);
    if (m) hits.push({ name, at: m.index });
  }
  const names = hits.sort((a, b) => a.at - b.at).map((h) => h.name);
  return { found: true, names: Array.from(new Set(names)), quote: section };
}

/**
 * @typedef {Object} Docs
 * @property {boolean} found
 * @property {{name:string, short:string}[]} items  in the order resume, cover letter, portfolio
 * @property {string|null} quote
 *
 * @param {string} text posting overview, HTML or text
 * @param {object} [postingData] raw getPostingData response
 * @returns {Docs}
 */
export function parseDocs(text, postingData, rules = DEFAULT_RULES) {
  const clean = normalizeText(text);
  let section = clean ? findSection(clean, rules.docHeadings, 500) : null;
  if (!section) {
    const fromData = findDocsInData(postingData);
    if (fromData) section = normalizeText(fromData).slice(0, 500);
  }
  if (!section) return { found: false, items: [], quote: null };
  const items = [];
  for (const doc of rules.docs) {
    if (doc.pattern.test(section)) items.push({ name: doc.name, short: doc.short });
  }
  return { found: items.length > 0, items, quote: section };
}
