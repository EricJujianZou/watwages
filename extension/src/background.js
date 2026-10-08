// Service worker. Its only job is to show, on the toolbar icon, what the
// content script is doing in each tab, so a student never has to open the
// console to find out whether WatsWorthIt is running. The tooltip text set
// here is also what the popup shows the moment it opens, before it has
// heard any live status message of its own.

const NOT_RESULTS_TEXT = 'Open a WaterlooWorks job board to see WatWages.';
const PAGE_CHANGED_TEXT = "WaterlooWorks changed its page and WatWages can't read this table.";
const OFF_TEXT = "WatWages is turned off for this tab.";

const BADGE = {
  starting: { text: '...', color: '#6b736e' },
  waiting: { text: '...', color: '#6b736e' },
  reading: { text: '...', color: '#2a7d4f' },
  ready: { text: 'ON', color: '#2a7d4f' },
  unreadable: { text: '?', color: '#b4512c' },
  failed: { text: '!', color: '#b4512c' },
  off: { text: '', color: '#6b736e' },
};

// The total a tab's last "reading" status named, so its next "ready"
// status (which carries no detail of its own) can still name a count.
const lastTotalByTab = new Map();

function readingDetail(detail) {
  const match = /^(\d+) of (\d+)$/.exec(detail || '');
  return match ? { done: Number(match[1]), total: Number(match[2]) } : null;
}

function titleFor(status, detail, tabId) {
  if (status === 'reading') {
    const parsed = readingDetail(detail);
    if (!parsed) return NOT_RESULTS_TEXT;
    lastTotalByTab.set(tabId, parsed.total);
    return `Reading ${parsed.total} postings on this tab, ${parsed.done} done.`;
  }
  if (status === 'ready') {
    const total = lastTotalByTab.get(tabId);
    return total != null ? `${total} postings read.` : 'Postings read.';
  }
  if (status === 'unreadable') return PAGE_CHANGED_TEXT;
  if (status === 'off') return OFF_TEXT;
  return NOT_RESULTS_TEXT;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.tag !== 'wmj') return;
  if (msg.type === 'usage') {
    if (msg.name === 'mark') sendUsage('mark', { kind: String((msg.extra && msg.extra.kind) || '') });
    return;
  }
  if (msg.type !== 'status') return;
  if (msg.status === 'ready') countBoardRead(sender.tab && sender.tab.id);
  if (msg.status === 'unreadable' || msg.status === 'failed') onceADay('page-broken', { status: msg.status });
  const tabId = sender.tab && sender.tab.id;
  const badge = BADGE[msg.status];
  if (tabId == null || !badge) return;
  chrome.action.setBadgeText({ tabId, text: badge.text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
  chrome.action.setTitle({ tabId, title: titleFor(msg.status, msg.detail, tabId) });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastTotalByTab.delete(tabId);
  boardReadTabs.delete(tabId);
});

// Anonymous usage counts, sent to Umami so we can see how many students
// install WatsWorthIt and whether they keep using it. Every event carries a
// random install ID, the version, the install date and how many days old the
// install is. Nothing about a posting, a search or a setting is ever sent.
//
//   install      once, when Chrome installs the extension
//   board-read   the overlay finished reading a job board, once per tab
//   day-active   at most once per local day, on the first board read. The
//                count of day-active events with day=7 is how many installs
//                were still in use a week in, so breaking it down by the day
//                property gives the retention curve.
//   mark         the student marked a posting Interested or Applied
//   page-broken  at most once per day, when WaterlooWorks changed its page and
//                the extension can't read it
//
// Only Chrome Web Store installs send anything, so development installs from
// an unpacked folder stay out of the counts.

const UMAMI_URL = 'https://cloud.umami.is/api/send';
const UMAMI_WEBSITE_ID = 'c9457f22-f5b9-4a4e-b954-41e8c5b159f2';
const boardReadTabs = new Set();

function fromStore() {
  return Boolean(chrome.runtime.getManifest().update_url);
}

// Local calendar date, so a 9pm install counts as the day the student thinks it is.
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(fromDate, toDate) {
  const [y1, m1, d1] = fromDate.split('-').map(Number);
  const [y2, m2, d2] = toDate.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

async function usageRecord() {
  const { usage } = await chrome.storage.local.get('usage');
  if (usage && usage.installId) return usage;
  const fresh = { installId: crypto.randomUUID(), installedOn: today(), sentOn: {} };
  await chrome.storage.local.set({ usage: fresh });
  return fresh;
}

async function sendUsage(name, extra = {}) {
  if (!fromStore()) return;
  try {
    const { installId, installedOn } = await usageRecord();
    await fetch(UMAMI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event',
        payload: {
          website: UMAMI_WEBSITE_ID,
          hostname: 'watsworthit-extension',
          url: '/extension',
          title: 'WatsWorthIt extension',
          language: navigator.language,
          name,
          id: installId,
          data: {
            install_id: installId,
            version: chrome.runtime.getManifest().version,
            installed_on: installedOn,
            day: daysBetween(installedOn, today()),
            ...extra,
          },
        },
      }),
    });
  } catch (err) {
    // counting must never break the extension
  }
}

async function onceADay(name, extra) {
  if (!fromStore()) return;
  try {
    const usage = await usageRecord();
    const sentOn = usage.sentOn || {};
    if (sentOn[name] === today()) return;
    await chrome.storage.local.set({ usage: { ...usage, sentOn: { ...sentOn, [name]: today() } } });
    await sendUsage(name, extra);
  } catch (err) {
    // counting must never break the extension
  }
}

function countBoardRead(tabId) {
  if (tabId == null || boardReadTabs.has(tabId)) return;
  boardReadTabs.add(tabId);
  sendUsage('board-read');
  onceADay('day-active');
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    sendUsage('install');
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  }
});
