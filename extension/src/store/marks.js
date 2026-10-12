// chrome.storage.local wrapper for marks (interested / applied / viewed)
// and saved searches, with an in-memory fallback and pub-sub, matching the
// pattern in store/settings.js.

import { STORAGE_KEYS } from '../contract.js';

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
}

const MARK_KINDS = ['interested', 'applied', 'viewed'];

const memoryState = {
  marks: { interested: [], applied: [], viewed: [] },
  savedSearches: [],
};
const memoryListeners = new Set();

function notifyMemoryListeners(kind, value) {
  for (const listener of memoryListeners) {
    try {
      listener(kind, value);
    } catch (err) {
      // one bad subscriber should not break the others
    }
  }
}

function normalizeMarks(stored) {
  const next = { interested: [], applied: [], viewed: [] };
  if (stored) {
    for (const kind of MARK_KINDS) {
      if (Array.isArray(stored[kind])) next[kind] = [...new Set(stored[kind])];
    }
  }
  return next;
}

function normalizeSavedSearches(stored) {
  return Array.isArray(stored) ? stored : [];
}

export async function getMarks() {
  if (hasChromeStorage()) {
    const result = await new Promise((resolve) => chrome.storage.local.get(STORAGE_KEYS.marks, resolve));
    return normalizeMarks(result[STORAGE_KEYS.marks]);
  }
  return normalizeMarks(memoryState.marks);
}

/** kind is 'interested' | 'applied' | 'viewed'. on:true adds the jobId, on:false removes it. */
export async function setMark(jobId, kind, on) {
  if (!MARK_KINDS.includes(kind)) throw new Error(`Unknown mark kind: ${kind}`);
  const current = await getMarks();
  const ids = new Set(current[kind]);
  if (on) ids.add(jobId);
  else ids.delete(jobId);
  const next = { ...current, [kind]: [...ids] };
  if (hasChromeStorage()) {
    await new Promise((resolve) => chrome.storage.local.set({ [STORAGE_KEYS.marks]: next }, resolve));
  } else {
    memoryState.marks = next;
    notifyMemoryListeners('marks', next);
  }
  return next;
}

/** cb(nextMarks) whenever marks change. Returns an unsubscribe function. */
export function onMarksChanged(cb) {
  if (hasChromeStorage()) {
    const listener = (changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE_KEYS.marks]) return;
      cb(normalizeMarks(changes[STORAGE_KEYS.marks].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  const listener = (kind, value) => {
    if (kind === 'marks') cb(normalizeMarks(value));
  };
  memoryListeners.add(listener);
  return () => memoryListeners.delete(listener);
}

export async function getSavedSearches() {
  if (hasChromeStorage()) {
    const result = await new Promise((resolve) => chrome.storage.local.get(STORAGE_KEYS.savedSearches, resolve));
    return normalizeSavedSearches(result[STORAGE_KEYS.savedSearches]);
  }
  return normalizeSavedSearches(memoryState.savedSearches);
}

/** Saves filters under name, replacing any earlier search with the same name. */
export async function saveSearch(name, filters) {
  const current = await getSavedSearches();
  const next = [...current.filter((s) => s.name !== name), { name, filters }];
  if (hasChromeStorage()) {
    await new Promise((resolve) => chrome.storage.local.set({ [STORAGE_KEYS.savedSearches]: next }, resolve));
  } else {
    memoryState.savedSearches = next;
    notifyMemoryListeners('savedSearches', next);
  }
  return next;
}

export async function deleteSearch(name) {
  const current = await getSavedSearches();
  const next = current.filter((s) => s.name !== name);
  if (hasChromeStorage()) {
    await new Promise((resolve) => chrome.storage.local.set({ [STORAGE_KEYS.savedSearches]: next }, resolve));
  } else {
    memoryState.savedSearches = next;
    notifyMemoryListeners('savedSearches', next);
  }
  return next;
}

/**
 * The last WaterlooWorks search with any filter or keyword in it, per board,
 * so the student can put it back after logging out or switching looks.
 */
export async function getLatestFilters(board) {
  let all = null;
  if (hasChromeStorage()) {
    const result = await new Promise((resolve) => chrome.storage.local.get(STORAGE_KEYS.latestFilters, resolve));
    all = result[STORAGE_KEYS.latestFilters];
  } else {
    all = memoryState.latestFilters;
  }
  const entry = all && typeof all === 'object' ? all[board] : null;
  return entry && (entry.filters || entry.keyword) ? entry : null;
}

export async function setLatestFilters(board, search) {
  const entry = { filters: search.filters || null, keyword: search.keyword || '', savedAt: Date.now() };
  if (hasChromeStorage()) {
    const result = await new Promise((resolve) => chrome.storage.local.get(STORAGE_KEYS.latestFilters, resolve));
    const all = { ...(result[STORAGE_KEYS.latestFilters] || {}), [board]: entry };
    await new Promise((resolve) => chrome.storage.local.set({ [STORAGE_KEYS.latestFilters]: all }, resolve));
  } else {
    memoryState.latestFilters = { ...(memoryState.latestFilters || {}), [board]: entry };
  }
}
