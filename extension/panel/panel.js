// The extension's action popup. Reads and writes settings and profile
// through src/store/settings.js, which falls back to an in-memory store
// when chrome.storage is undefined, so the panel opens from disk for
// checking. See docs/build-contract-v2.md, "Popup copy".

import { TERMS, STORAGE_KEYS } from '../src/contract.js';
import { getSettings, setSettings, getProfile, setProfile } from '../src/store/settings.js';

const DEFAULT_WEIGHTS = { pay: 3, odds: 3, level: 3, year: 3, repeat: 3 };
const DEFAULT_PROFILE = { program: '', term: TERMS[0], completedWorkTerms: 0 };

const FULL_CYCLE_URL = 'https://waterlooworks.uwaterloo.ca/myAccount/co-op/full/jobs.htm';
const WATERLOOWORKS_MATCH = 'https://waterlooworks.uwaterloo.ca/*';

const LOOK_LABEL_ON = 'Use the original WaterlooWorks';
const LOOK_LABEL_OFF = 'Switch to the WatWages look';

let settings = { overlayEnabled: true, weights: { ...DEFAULT_WEIGHTS } };
let profile = { ...DEFAULT_PROFILE };

const byId = (id) => document.getElementById(id);

const termSelect = byId('wmj-term');
for (const term of TERMS) {
  const opt = document.createElement('option');
  opt.value = term;
  opt.textContent = term;
  termSelect.appendChild(opt);
}

const weightSliders = {
  pay: byId('wmj-weight-pay'),
  odds: byId('wmj-weight-odds'),
  level: byId('wmj-weight-level'),
  year: byId('wmj-weight-year'),
  repeat: byId('wmj-weight-repeat'),
};
const weightValues = {
  pay: byId('wmj-weight-pay-value'),
  odds: byId('wmj-weight-odds-value'),
  level: byId('wmj-weight-level-value'),
  year: byId('wmj-weight-year-value'),
  repeat: byId('wmj-weight-repeat-value'),
};

const savedTimers = new WeakMap();

function showSaved(id) {
  const label = byId(id);
  label.textContent = 'Saved';
  clearTimeout(savedTimers.get(label));
  savedTimers.set(
    label,
    setTimeout(() => {
      label.textContent = '';
    }, 1500)
  );
}

function renderProfile() {
  byId('wmj-program').value = profile.program || '';
  termSelect.value = profile.term || TERMS[0];
  byId('wmj-completed-terms').value = profile.completedWorkTerms;
}

function renderWeights() {
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const value = settings.weights[key];
    weightSliders[key].value = value;
    weightValues[key].textContent = String(value);
  }
}

function renderLookToggle() {
  byId('wmj-look-toggle').textContent = settings.overlayEnabled ? LOOK_LABEL_ON : LOOK_LABEL_OFF;
}

async function load() {
  const storedSettings = (await getSettings()) || {};
  settings = {
    overlayEnabled: typeof storedSettings.overlayEnabled === 'boolean' ? storedSettings.overlayEnabled : true,
    weights: { ...DEFAULT_WEIGHTS, ...(storedSettings.weights || {}) },
  };
  const storedProfile = await getProfile();
  profile = { ...DEFAULT_PROFILE, ...(storedProfile || {}) };
  renderProfile();
  renderWeights();
  renderLookToggle();
}

byId('wmj-program').addEventListener('change', (e) => {
  profile.program = e.target.value;
  setProfile(profile);
  showSaved('wmj-saved-about');
});

termSelect.addEventListener('change', (e) => {
  profile.term = e.target.value;
  setProfile(profile);
  showSaved('wmj-saved-about');
});

byId('wmj-completed-terms').addEventListener('change', (e) => {
  const n = Math.min(6, Math.max(0, Math.round(Number(e.target.value) || 0)));
  e.target.value = n;
  profile.completedWorkTerms = n;
  setProfile(profile);
  showSaved('wmj-saved-about');
});

for (const key of Object.keys(DEFAULT_WEIGHTS)) {
  weightSliders[key].addEventListener('input', (e) => {
    const n = Math.min(5, Math.max(1, Math.round(Number(e.target.value) || 3)));
    settings.weights[key] = n;
    weightValues[key].textContent = String(n);
  });
}

byId('wmj-look-toggle').addEventListener('click', async () => {
  settings.overlayEnabled = !settings.overlayEnabled;
  renderLookToggle();
  await setSettings({ overlayEnabled: settings.overlayEnabled });
});

// Sends a fresh scoring pass to every open WaterlooWorks tab. With none
// open, opens the Full-Cycle Service board instead, since that is the
// board most students start from.
async function rescoreOpenTabs() {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: WATERLOOWORKS_MATCH });
  } catch (err) {
    tabs = [];
  }
  if (!tabs.length) {
    chrome.tabs.create({ url: FULL_CYCLE_URL });
    return;
  }
  await Promise.all(
    tabs.map((tab) =>
      chrome.tabs.sendMessage(tab.id, { type: 'wmj.rescore' }).catch(() => {
        // No content script listening on this tab (a page WatsWorthIt does
        // not touch, or one still loading); nothing to do about it here.
      })
    )
  );
}

byId('wmj-show').addEventListener('click', async () => {
  await setProfile(profile);
  await setSettings({ weights: { ...settings.weights } });
  await rescoreOpenTabs();
});

// Clear saved readings. Arbitrary chrome.storage.local keys, so this uses
// its own small storage shim rather than src/store/settings.js, which only
// knows about the settings and profile keys.
function createMemoryStorage() {
  const data = {};
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) out[k] = data[k];
      return out;
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

const cacheStorage =
  typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
    ? chrome.storage.local
    : createMemoryStorage();

byId('wmj-clear-cache').addEventListener('click', async () => {
  const all = await cacheStorage.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(STORAGE_KEYS.cachePrefix));
  if (keys.length) await cacheStorage.remove(keys);
  const btn = byId('wmj-clear-cache');
  const note = document.createElement('p');
  note.className = 'wmj-clear-note';
  note.setAttribute('role', 'status');
  note.setAttribute('tabindex', '-1');
  note.textContent = 'Cleared. Postings will be read again on your next search.';
  btn.replaceWith(note);
  note.focus();
});

load();
