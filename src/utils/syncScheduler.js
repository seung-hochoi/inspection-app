/**
 * Shared debounce scheduler for postSaveSync calls.
 *
 * Why: after every movement save the frontend fires postSaveSync, which runs
 * syncReturnSheets_ + syncInspectionMovementTotals_ on the backend — each
 * taking ~1–2 s and holding the script lock.  If the user saves several
 * movement rows in quick succession this becomes the new serialisation
 * bottleneck.  Collapsing them into a single deferred call eliminates the
 * redundant backend work without changing business correctness: the sheets
 * still sync, just once after the burst settles rather than once per row.
 *
 * Usage:
 *   scheduleSync()       — call after a movement save
 *   flushSync()          — call on tab switch / before manual refresh
 */
import { postSaveSync } from '../api';

const DEBOUNCE_MS = 1500;

let _timer = null;

/** Schedule (or re-schedule) a postSaveSync call. */
export function scheduleSync() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(_fire, DEBOUNCE_MS);
}

/**
 * If a sync is pending, fire it immediately and cancel the debounce timer.
 * Safe to call with no pending sync — it's a no-op in that case.
 */
export function flushSync() {
  if (!_timer) return;
  clearTimeout(_timer);
  _timer = null;
  _fire();
}

function _fire() {
  postSaveSync().catch(() => {}); // fire-and-forget; failures don't affect save UX
}
