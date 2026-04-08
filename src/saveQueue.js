// src/saveQueue.js
// Per-item failed-save state persistence and a module-level retry registry.
//
// Drafts are already persisted by InspectionPage (DRAFTS_KEY = 'inspection_drafts_v2').
// This module adds two things on top of that:
//   1. A localStorage set tracking which productKeys have failed saves
//      → restores the retry-button after a page refresh
//   2. A module-level retry registry so InspectionPage can trigger "Retry All"
//      without prop threading through PartnerGroup

const FAILED_SAVES_LS_KEY = 'failed_saves_v1';

// ── localStorage helpers ──────────────────────────────────────────────────────

function readFailedKeys() {
  try {
    const raw = localStorage.getItem(FAILED_SAVES_LS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (_) {
    return new Set();
  }
}

function writeFailedKeys(set) {
  try {
    localStorage.setItem(FAILED_SAVES_LS_KEY, JSON.stringify([...set]));
  } catch (_) {}
}

// ── Change listeners ──────────────────────────────────────────────────────────

let _listeners = [];

function notifyListeners() {
  const count = readFailedKeys().size;
  _listeners.forEach((fn) => fn(count));
}

/** Subscribe to failed-save count changes. Returns an unsubscribe function. */
export function onFailedSavesChange(listener) {
  _listeners.push(listener);
  return () => {
    _listeners = _listeners.filter((fn) => fn !== listener);
  };
}

// ── Failed-key mutations ──────────────────────────────────────────────────────

/** Mark a productKey as having a failed save (survives page refresh). */
export function markSaveFailed(productKey) {
  const keys = readFailedKeys();
  keys.add(productKey);
  writeFailedKeys(keys);
  notifyListeners();
}

/** Remove a productKey from the failed-save set (call after a successful save). */
export function markSaveSucceeded(productKey) {
  const keys = readFailedKeys();
  if (!keys.has(productKey)) return;
  keys.delete(productKey);
  writeFailedKeys(keys);
  notifyListeners();
}

/** Returns true if this productKey has a recorded failed save. */
export function hasPendingFailure(productKey) {
  return readFailedKeys().has(productKey);
}

/** Returns the current count of productKeys with pending failed saves. */
export function getFailedSaveCount() {
  return readFailedKeys().size;
}

// ── Module-level retry registry ───────────────────────────────────────────────
// ProductRows register their retry function on mount so InspectionPage can
// trigger "Retry All" without prop threading.

const _retryFns = new Map(); // productKey → () => void

export function registerRetryFn(productKey, fn) {
  _retryFns.set(productKey, fn);
}

export function unregisterRetryFn(productKey) {
  _retryFns.delete(productKey);
}

/**
 * Trigger retry for every currently registered item whose productKey is in
 * the failed-save set. Safe to call even when some registered rows are idle.
 */
export function retryAllFailed() {
  const failedKeys = readFailedKeys();
  for (const [key, fn] of _retryFns.entries()) {
    if (failedKeys.has(key)) fn();
  }
}
