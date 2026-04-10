import React, { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Search, ScanLine, ClipboardList, Upload, ArrowUp, ArrowDown, ArrowUpDown, X, RotateCcw, RefreshCw } from 'lucide-react';
import { C, radius, font, shadow, trans, inputStyle, btnPrimary } from './styles';
import PartnerGroup from './PartnerGroup';
import { fetchRecords } from '../api';
import { scheduleSync } from '../utils/syncScheduler';
import { onFailedSavesChange, getFailedSaveCount, retryAllFailed } from '../saveQueue';

// Lazy-load BarcodeScanner so @zxing/browser (~5 MB) is not in the initial bundle
const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

const DRAFTS_KEY = 'inspection_drafts_v2';

export default function InspectionPage({
  jobKey, rows = [], config = {}, records = [], happycall = {}, inspectionRows = [],
  productImageMap = {}, onProductImageUploaded,
  onError, onToast, onCsvUpload, onRefresh, onRecordsUpdate, onTargetSkuChange,
  authUser, isAdmin = false,
  // Optional: live summary / history for the KPI strip
  summary = {}, historyData = [],
}) {
  const [drafts, setDrafts]             = useState(() => loadDrafts());
  const [saveStatuses, setSaveStatuses] = useState({});
  // Track how many product rows have pending failed saves (drives "Retry All" button)
  const [failedSaveCount, setFailedSaveCount] = useState(() => getFailedSaveCount());
  const [searchInput, setSearchInput]   = useState('');
  const [search, setSearch]             = useState('');
  const [filter, setFilter]             = useState('all');
  const [sortQty, setSortQty]           = useState(null); // null | 'asc' | 'desc'
  const [openPartner, setOpenPartner]   = useState(null); // accordion: only one open
  const [showScanner, setShowScanner]   = useState(false);
  const searchRef          = useRef(null);
  const csvInputRef        = useRef(null);
  const scrollContainerRef = useRef(null);
  const partnerCardRefs    = useRef({});

  // ── Permission flags (derived from authUser; default true for safety) ────────
  const _perms               = (authUser && authUser.permissions) || [];
  const canEditInspection    = _perms.length === 0 || _perms.includes('EDIT_INSPECTION');
  const canUploadPhoto       = _perms.length === 0 || _perms.includes('UPLOAD_PHOTO');
  const canEditReturnExchange = _perms.length === 0 || _perms.includes('EDIT_RETURN_EXCHANGE');

  // Debounce: only update the filter-driving `search` after the user stops typing
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  // Debounce localStorage writes: flush at most every 400 ms while typing,
  // and always flush on page hide/unload so no drafts are lost.
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(draftsRef.current)); } catch (_) {}
    }, 400);
    return () => clearTimeout(t);
  }, [drafts]);

  useEffect(() => {
    const flush = () => {
      try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(draftsRef.current)); } catch (_) {}
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  // Subscribe to save-queue failed-save count changes so the "Retry All" button
  // appears / disappears in real-time as saves fail or succeed.
  useEffect(() => {
    return onFailedSavesChange(setFailedSaveCount);
  }, []);

  // Merge backend inspection rows into drafts when job loads (photo persistence + qty restore)
  useEffect(() => {
    if (!jobKey || !inspectionRows?.length) return;
    setDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const ir of inspectionRows) {
        const rawCode = ir['상품코드'] || '';
        const code    = normalizeCode(rawCode);
        const partner = String(ir['협력사명'] || '').trim();
        if (!code && !partner) continue;
        const key      = `${jobKey}||${code}||${partner}`;
        const existing = next[key] || {};
        const updates  = {};

        // ── Photo hydration ────────────────────────────────────────────────
        // Prefer per-category fields set by applyPhotoAssetFieldsToRow_ when the row
        // was saved by the new app (photoCategoriesJSON stored in photo_assets col 5).
        // Fall back to the combined 사진파일ID목록 → inspPhotoIds for older rows.
        const hasCategories =
          ir['inspPhotoIds'] !== undefined ||
          ir['defectPhotoIds'] !== undefined ||
          ir['weightPhotoIds'] !== undefined ||
          ir['brixPhotoIds'] !== undefined;

        // IDs the user explicitly deleted but whose deletion hasn't been confirmed
        // by the server yet (e.g. page reloaded before the save fired).
        // Never re-add these from server data during hydration.
        const pendingDeletedSet = new Set(existing.deletedPhotoIds || []);

        if (hasCategories) {
          // Per-category hydration — each type is independent
          const merge = (draftField, legacyField, serverField) => {
            const serverIds = String(ir[serverField] || '').split('\n').filter(Boolean)
              .filter((id) => !pendingDeletedSet.has(id));
            // Filter existing IDs through pendingDeletedSet too.
            // If the existing draft was restored from localStorage in an inconsistent
            // state (photo array still contains a deleted ID), force-remove it now
            // rather than relying on hasNew, which would return false and leave the
            // stale ID in place indefinitely.
            const rawExistingIds = [...(existing[draftField] || existing[legacyField] || [])];
            const existingIds    = rawExistingIds.filter((id) => !pendingDeletedSet.has(id));
            const hadStaleDeletions = existingIds.length < rawExistingIds.length;
            if (!serverIds.length && !hadStaleDeletions) return {};
            const existingSet = new Set(existingIds);
            const hasNew      = serverIds.some((id) => !existingSet.has(id));
            if (!hasNew && !hadStaleDeletions) return {};
            return { [draftField]: [...new Set([...existingIds, ...serverIds])] };
          };
          const pInsp   = merge('inspPhotoIds',   'photoFileIds',  'inspPhotoIds');
          const pDefect = merge('defectPhotoIds',  null,            'defectPhotoIds');
          const pWeight = merge('weightPhotoIds',  null,            'weightPhotoIds');
          const pBrix   = merge('brixPhotoIds',    null,            'brixPhotoIds');
          const photoUpdates = { ...pInsp, ...pDefect, ...pWeight, ...pBrix };
          if (Object.keys(photoUpdates).length > 0) {
            Object.assign(updates, photoUpdates);
            changed = true;
          }

          // Server-confirmation cleanup: remove from deletedPhotoIds any IDs the
          // server no longer reports (meaning the backend persisted the deletion).
          // This replaces the premature clear that used to happen in ProductRow.jsx's
          // save callback — we now wait for fresh server data to confirm the deletion.
          const existingDeleted = existing.deletedPhotoIds || [];
          if (existingDeleted.length > 0) {
            const allServerIds = new Set([
              ...String(ir['inspPhotoIds']   || '').split('\n').filter(Boolean),
              ...String(ir['defectPhotoIds'] || '').split('\n').filter(Boolean),
              ...String(ir['weightPhotoIds'] || '').split('\n').filter(Boolean),
              ...String(ir['brixPhotoIds']   || '').split('\n').filter(Boolean),
            ]);
            const stillPending = existingDeleted.filter((id) => allServerIds.has(id));
            if (stillPending.length < existingDeleted.length) {
              updates.deletedPhotoIds = stillPending;
              changed = true;
            }
          }
        } else {
          // Legacy fallback: combined list → inspPhotoIds only
          const photoIds = String(ir['사진파일ID목록'] || '').split('\n').filter(Boolean)
            .filter((id) => !pendingDeletedSet.has(id));
          // Apply the same stale-deletion guard as the per-category branch above.
          const rawExistingIds = [...(existing.inspPhotoIds || existing.photoFileIds || [])];
          const existingIds    = rawExistingIds.filter((id) => !pendingDeletedSet.has(id));
          const hadStale       = existingIds.length < rawExistingIds.length;
          if (photoIds.length > 0 || hadStale) {
            const existingSet = new Set(existingIds);
            const hasNewIds   = photoIds.some((id) => !existingSet.has(id));
            if (hasNewIds || hadStale) {
              updates.inspPhotoIds = [...new Set([...existingIds, ...photoIds])];
              changed = true;
            }
          }
        }

        // Hydrate scalar fields from server while guarding against stale data
        // overwriting a local edit that the user hasn't confirmed yet.
        //
        // Strategy: track the last server value seen per field via `_srv<Field>LastSeen`.
        // If the local value diverges from that last-known server value, the user has
        // an unsaved local edit → skip the server update so the edit isn't reverted.
        // Once the server echoes back the user's saved value, the tracking resets.
        //
        // Inlined per-field to satisfy no-loop-func (no closures over loop vars).
        const srvInspQty = String(ir['검품수량'] || '');
        if (srvInspQty && srvInspQty !== '0') {
          const prevSrv  = existing._srvInspQtyLastSeen;
          const localVal = existing.inspQty ?? '';
          const hasLocalChange = prevSrv !== undefined && localVal !== prevSrv;
          if (!hasLocalChange && localVal !== srvInspQty) { updates.inspQty = srvInspQty; changed = true; }
          if (prevSrv !== srvInspQty) { updates._srvInspQtyLastSeen = srvInspQty; changed = true; }
        }
        {
          const srvVal   = String(ir['불량사유'] || '').trim();
          const prevSrv  = existing._srvDefectReasonLastSeen;
          const localVal = existing.defectReason ?? '';
          const hasLocalChange = prevSrv !== undefined && localVal !== prevSrv;
          if (srvVal) {
            if (!hasLocalChange && localVal !== srvVal) { updates.defectReason = srvVal; changed = true; }
            if (prevSrv !== srvVal) { updates._srvDefectReasonLastSeen = srvVal; changed = true; }
          }
        }
        {
          const srvVal   = String(ir['BRIX최저'] || '').trim();
          const prevSrv  = existing._srvBrixMinLastSeen;
          const localVal = existing.brixMin ?? '';
          const hasLocalChange = prevSrv !== undefined && localVal !== prevSrv;
          if (srvVal) {
            if (!hasLocalChange && localVal !== srvVal) { updates.brixMin = srvVal; changed = true; }
            if (prevSrv !== srvVal) { updates._srvBrixMinLastSeen = srvVal; changed = true; }
          }
        }
        {
          const srvVal   = String(ir['BRIX최고'] || '').trim();
          const prevSrv  = existing._srvBrixMaxLastSeen;
          const localVal = existing.brixMax ?? '';
          const hasLocalChange = prevSrv !== undefined && localVal !== prevSrv;
          if (srvVal) {
            if (!hasLocalChange && localVal !== srvVal) { updates.brixMax = srvVal; changed = true; }
            if (prevSrv !== srvVal) { updates._srvBrixMaxLastSeen = srvVal; changed = true; }
          }
        }
        {
          const srvVal   = String(ir['BRIX평균'] || '').trim();
          const prevSrv  = existing._srvBrixAvgLastSeen;
          const localVal = existing.brixAvg ?? '';
          const hasLocalChange = prevSrv !== undefined && localVal !== prevSrv;
          if (srvVal) {
            if (!hasLocalChange && localVal !== srvVal) { updates.brixAvg = srvVal; changed = true; }
            if (prevSrv !== srvVal) { updates._srvBrixAvgLastSeen = srvVal; changed = true; }
          }
        }

        if (Object.keys(updates).length > 0) {
          next[key] = { ...existing, ...updates };
        }
      }
      return changed ? next : prev;
    });
  }, [jobKey, inspectionRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stable draft summary for filter memoization ──────────────────────────
  // Builds Sets of draft keys that are "done" or "have photos".
  // Returns the SAME object reference unless the set contents actually change,
  // so that filteredPartners / progress counter don't re-compute on every keystroke.
  const draftSummaryRef = useRef({ doneSet: new Set(), photoSet: new Set() });
  const draftSummary = useMemo(() => {
    const doneSet  = new Set();
    const photoSet = new Set();
    for (const [key, d] of Object.entries(drafts)) {
      if (parseInt(d.inspQty, 10) > 0) doneSet.add(key);
      if ((d.inspPhotoIds?.length || d.defectPhotoIds?.length || d.photoFileIds?.length) > 0)
        photoSet.add(key);
    }
    const prev = draftSummaryRef.current;
    if (setsEqual(prev.doneSet, doneSet) && setsEqual(prev.photoSet, photoSet)) return prev;
    const next = { doneSet, photoSet };
    draftSummaryRef.current = next;
    return next;
  }, [drafts]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data from props ──────────────────────────────────────────────
  const exclusionIndex = useMemo(() => buildExclusionIndex(config.exclude_rows || []), [config.exclude_rows]);

  // Build productCode → eventName map from sheet data.
  // Only include rows where 사용여부=TRUE and today is within [시작일, 종료일].
  const eventMap = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const parseDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
    const map = {};
    for (const er of (config.event_rows || [])) {
      const active = er['사용여부'] === true || String(er['사용여부'] || '').trim().toUpperCase() === 'TRUE';
      if (!active) continue;
      const start = parseDate(er['시작일']);
      const end   = parseDate(er['종료일']);
      if (start) { const s = new Date(start); s.setHours(0,0,0,0); if (today < s) continue; }
      if (end)   { const e = new Date(end);   e.setHours(23,59,59,999); if (today > e) continue; }
      const code = normalizeCode(er['상품코드'] || er['상품 코드'] || er['코드'] || '');
      const name = String(er['행사명'] || '').trim();
      if (code && name) map[code] = name;
    }
    return map;
  }, [config.event_rows]);

  // Unique center names from existing records, sorted
  const centers = useMemo(() => {
    const s = new Set();
    for (const r of records) {
      const c = String(r['센터명'] || '').trim();
      if (c) s.add(c);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [records]);

  // happycall.productRanks keyed by code:: / name:: etc.
  const happycallRanks = happycall?.productRanks || {};

  // Accumulated return+exchange qty per partner||code key, from existing records.
  // Also builds movementCounts: per-product entry counts (회송 N건 / 교환 N건)
  // and per-type qty totals (returnQty / exchangeQty) used by the modal to show
  // 기존 / 입력 / 누적 context below the quantity field.
  const { accumulatedMovement, movementCounts } = useMemo(() => {
    const acc    = {};
    const counts = {}; // key → { returnCount, exchangeCount, returnQty, exchangeQty }
    for (const r of records) {
      const code    = normalizeCode(String(r['상품코드'] || ''));
      const partner = String(r['협력사명'] || '').trim();
      if (!code && !partner) continue;
      const key = `${partner}||${code}`;
      const ret = parseInt(r['회송수량'], 10) || 0;
      const exc = parseInt(r['교환수량'], 10) || 0;
      if (ret > 0 || exc > 0) acc[key] = (acc[key] || 0) + ret + exc;
      if (!counts[key]) counts[key] = { returnCount: 0, exchangeCount: 0, returnQty: 0, exchangeQty: 0 };
      if (ret > 0) { counts[key].returnCount  += 1; counts[key].returnQty  += ret; }
      if (exc > 0) { counts[key].exchangeCount += 1; counts[key].exchangeQty += exc; }
    }
    return { accumulatedMovement: acc, movementCounts: counts };
  }, [records]);

  // ── Filtered rows (apply exclusion) ──────────────────────────────────────

  const activeRows = useMemo(
    () => rows.filter((r) => !isExcluded(r, exclusionIndex)),
    [rows, exclusionIndex],
  );

  // ── Merge preorder rows from config.reservation_rows into CSV rows ────────
  // Preorder rows arrive with raw GS-Retail center name variants that must be
  // normalized before deduplication so they align with CSV center keys.
  const allActiveRows = useMemo(() => {
    const reservationRows = Array.isArray(config?.reservation_rows) ? config.reservation_rows : [];
    const preorderRows = reservationRows.map((raw, i) => {
      const productCode = normalizeCode(String(raw['상품코드'] || '').trim());
      const productName = String(raw['상품명'] || '').trim();
      const partner     = String(raw['협력사명'] || '').trim();
      const qty         = Number(raw['발주수량']) || 0;
      const center      = normalizeCenterName(raw['센터명'] || '');
      // Skip incomplete or zero-qty rows to avoid polluting the product list
      if (!productCode || !productName || !partner || !qty) return null;
      return {
        '상품코드': productCode,
        '상품명':   productName,
        '협력사명': partner,
        '발주수량': qty,
        '전체발주수량': qty,
        '센터명':   center,
        __productCode: productCode,
        __productName: productName,
        __partner:     partner,
        __center:      center,
        __qty:         qty,
        __id:          `preorder-${productCode}-${partner}-${i}`,
        __index:       activeRows.length + i,
        __searchKey:   `${productName.toLowerCase()} ${productCode.toLowerCase()}`,
        __isPreorder:  true,
      };
    }).filter(Boolean);
    return [...activeRows, ...preorderRows];
  }, [activeRows, config]);

  // ── Deduplicate: merge rows sharing partner + productCode into one card ──────
  // CSV may have separate rows per center for the same product; the inspection
  // tab must show exactly ONE card per partner + productCode, with total 발주수량.
  // allActiveRows already includes preorder rows so they merge automatically.
  const deduplicatedRows = useMemo(() => {
    const map = new Map();
    for (const r of allActiveRows) {
      const code    = normalizeCode(r['상품코드'] || '');
      const partner = r['협력사명'] || '';
      const key     = `${partner}||${code}`;
      const qty     = parseInt(r['발주수량'], 10) || 0;
      const center  = String(r['센터명'] || '').trim();
      if (map.has(key)) {
        const prev  = map.get(key);
        const total = (parseInt(prev['발주수량'], 10) || 0) + qty;
        // Merge per-center qty into __centerList
        const cl = [...(prev.__centerList || [])];
        if (center) {
          const ci = cl.findIndex((c) => c.name === center);
          if (ci >= 0) cl[ci] = { ...cl[ci], qty: cl[ci].qty + qty };
          else         cl.push({ name: center, qty });
        }
        map.set(key, { ...prev, '발주수량': total, '전체발주수량': total, __qty: total, __centerList: cl });
      } else {
        const cl = center ? [{ name: center, qty }] : [];
        map.set(key, { ...r, __centerList: cl });
      }
    }
    // Sort each product's center list by qty descending
    for (const [k, v] of map.entries()) {
      if ((v.__centerList?.length ?? 0) > 1) {
        map.set(k, { ...v, __centerList: [...v.__centerList].sort((a, b) => b.qty - a.qty) });
      }
    }
    return Array.from(map.values());
  }, [allActiveRows]);

  // Notify the parent of the inspection target SKU count (single source of truth).
  // The parent uses this same number for the top SKU badge.
  useEffect(() => {
    onTargetSkuChange?.(deduplicatedRows.length);
  }, [deduplicatedRows.length, onTargetSkuChange]);

  const handleDraftChange = useCallback((productKey, draft, options = {}) => {
    setDrafts((prev) => ({ ...prev, [productKey]: draft }));
    // Only mark 'saving' for real user-triggered changes.
    // Version-token-only updates (post-save) pass { silent: true } so they don't
    // cause a spurious 'saving' flash or unnecessary PartnerGroup re-renders.
    if (!options.silent) {
      setSaveStatuses((prev) => ({ ...prev, [productKey]: 'saving' }));
    }
  }, []);

  const handleSaved = useCallback((productKey) => {
    setSaveStatuses((prev) => ({ ...prev, [productKey]: 'saved' }));
    setTimeout(() => {
      setSaveStatuses((prev) =>
        prev[productKey] === 'saved' ? { ...prev, [productKey]: 'idle' } : prev,
      );
    }, 1600);
  }, []);

  const handleSaveError = useCallback((productKey) => {
    setSaveStatuses((prev) => ({ ...prev, [productKey]: 'error' }));
    setTimeout(() => {
      setSaveStatuses((prev) =>
        prev[productKey] === 'error' ? { ...prev, [productKey]: 'idle' } : prev,
      );
    }, 3000);
  }, []);

  const handleError    = useCallback((msg) => { onError?.(msg); onToast?.(msg, 'error'); }, [onError, onToast]);
  const handleMovSaved = useCallback(async (freshRecords) => {
    onToast?.('저장되었습니다.', 'success');
    if (Array.isArray(freshRecords) && onRecordsUpdate) {
      // Backend provided fresh records in the response (legacy path).
      onRecordsUpdate(freshRecords);
    } else if (onRecordsUpdate) {
      // saveBatch no longer returns freshRecords to keep the save response fast.
      // Fetch records separately — much cheaper than triggering a full bootstrap reload.
      fetchRecords().then(r => {
        if (Array.isArray(r?.records)) onRecordsUpdate(r.records);
      }).catch(() => {});
    }
    // Coalesce return-sheet syncs: multiple rapid saves share one backend call.
    scheduleSync();
  }, [onToast, onRecordsUpdate]);

  const handleScan = useCallback((code) => {
    setShowScanner(false);
    const matched = deduplicatedRows.find((r) => String(r['상품코드'] || '').trim() === code.trim());
    if (matched) {
      setSearchInput(code.trim());
      onToast?.(`바코드: ${code}`, 'info');
      // Keyword stays visible; cleared only when user clicks the search input again
    } else {
      onToast?.(`상품코드 없음: ${code}`, 'error');
    }
  }, [deduplicatedRows, onToast]);

  // ── Partner grouping with filter + search ─────────────────────────────────

  // Recompute grouping only when the deduplicated row list changes (not on every draft save)
  const partners = useMemo(() => groupByPartner(deduplicatedRows), [deduplicatedRows]);

  // Recompute filter only when partners, filter mode, or done/photo sets actually change.
  // draftSummary is stable during normal typing → this memo only fires when a product
  // crosses the 0↔done boundary or gets its first/last photo.
  const filteredPartners = useMemo(
    () => applyFilter(partners, filter, jobKey, draftSummary),
    [partners, filter, jobKey, draftSummary],
  );

  // Precompute done/total counts per partner so PartnerGroup never needs to
  // re-derive them on render. Uses stable draftSummary.doneSet, so this only
  // recalculates when a product crosses the done boundary — not on every keystroke.
  const partnerDoneCounts = useMemo(() => {
    const out = {};
    for (const [name, pRows] of filteredPartners) {
      let done = 0;
      for (const r of pRows) {
        const key = `${jobKey}||${r.__productCode || normalizeCode(r['상품코드'])}||${r['협력사명'] || ''}`;
        if (draftSummary.doneSet.has(key)) done += 1;
      }
      out[name] = { done, total: pRows.length };
    }
    return out;
  }, [filteredPartners, jobKey, draftSummary]);

  // Apply quantity sort after filtering (null = original order)
  const sortedPartners = useMemo(() => {
    if (!sortQty) return filteredPartners;
    return filteredPartners.map(([name, rows]) => {
      const sorted = [...rows].sort((a, b) => {
        const qa = parseInt(a['발주수량'], 10) || 0;
        const qb = parseInt(b['발주수량'], 10) || 0;
        return sortQty === 'asc' ? qa - qb : qb - qa;
      });
      return [name, sorted];
    });
  }, [filteredPartners, sortQty]);

  // Filter partners/rows by search query at the parent level so only affected
  // groups re-render. When search is empty, `sortedPartners` is returned as-is
  // (same reference) so PartnerGroup receives the same props and does not re-render.
  const searchFilteredPartners = useMemo(() => {
    if (!search) return sortedPartners;
    const q = search.toLowerCase();
    const result = [];
    for (const [name, pRows] of sortedPartners) {
      const visible = pRows.filter((r) => {
        const key = r.__searchKey || `${(r['상품명'] || '').toLowerCase()} ${(r['상품코드'] || '').toLowerCase()}`;
        return key.includes(q);
      });
      if (visible.length > 0) result.push([name, visible]);
    }
    return result;
  }, [sortedPartners, search]);

  const toggleSort = useCallback(() => {
    setSortQty((prev) => prev === null ? 'asc' : prev === 'asc' ? 'desc' : null);
  }, []);
  const clearSort = useCallback(() => setSortQty(null), []);

  const handleTogglePartner = useCallback((name) => {
    setOpenPartner((prev) => prev === name ? null : name);
  }, []);

  // Scroll the opened partner card into view once its accordion animation has
  // fully settled.  Instead of a hardcoded timeout we use a ResizeObserver on
  // the card wrapper: framer-motion drives height from 0 → auto, so the wrapper
  // keeps getting taller while the animation runs.  We wait 50 ms after the
  // LAST observed resize event — that gap means the animation has stopped and
  // the layout is stable.
  //
  // behavior:'instant' is deliberate: 'smooth' conflicts with the in-progress
  // CSS animation on iOS Safari and can land at a wrong position.
  useEffect(() => {
    if (!openPartner) return;
    const el = partnerCardRefs.current[openPartner];
    if (!el) return;
    let debounce = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        ro.disconnect();
        el.scrollIntoView({ behavior: 'instant', block: 'start' });
      }, 50);
    });
    ro.observe(el);
    return () => {
      clearTimeout(debounce);
      ro.disconnect();
    };
  }, [openPartner]);
  const { totalRows, doneRows, pct } = useMemo(() => {
    const total = deduplicatedRows.length;
    // Use stable draftSummary.doneSet instead of raw drafts to avoid re-running
    // this on every keystroke — only recalculates when a product's done-status flips.
    const done  = deduplicatedRows.filter((r) => {
      const key = `${jobKey}||${normalizeCode(r['상품코드'])}||${r['협력사명'] || ''}`;
      return draftSummary.doneSet.has(key);
    }).length;
    return { totalRows: total, doneRows: done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [deduplicatedRows, jobKey, draftSummary]);

  // Quantity-based progress: inspected qty vs total order qty across all deduped rows.
  // This recalculates on every draft change (users typing), but the math is a simple loop.
  const { inspectedQty, totalOrderQty, qtyPct } = useMemo(() => {
    let totalQ = 0;
    let inspQ  = 0;
    for (const r of deduplicatedRows) {
      totalQ += parseInt(r['발주수량'], 10) || 0;
      const key = `${jobKey}||${normalizeCode(r['상품코드'])}||${r['협력사명'] || ''}`;
      inspQ += parseInt(drafts[key]?.inspQty, 10) || 0;
    }
    return {
      totalOrderQty: totalQ,
      inspectedQty:  inspQ,
      qtyPct: totalQ > 0 ? Math.round((inspQ / totalQ) * 100) : 0,
    };
  }, [deduplicatedRows, jobKey, drafts]);

  // Build partner short-name map from config.mapping_rows (협력사명 → 파트너사).
  // Dynamically reflects any rows added to the mapping sheet.
  const partnerShortNameMap = useMemo(() => {
    const map = {};
    for (const row of (config.mapping_rows || [])) {
      const full  = String(row['협력사명'] || '').trim();
      const short = String(row['파트너사'] || '').trim();
      if (full && short) map[full] = short;
    }
    return map;
  }, [config.mapping_rows]);

  // ── KPI strip — latest history snapshot merged with live counters ────────────
  const kpiStrip = useMemo(() => {
    // Pull the most recent history row (same logic as SummaryPage)
    let latestHistory = null;
    if (Array.isArray(historyData) && historyData.length > 0) {
      const safe = (d) => {
        const s = String(d || '');
        const m = s.match(/(\d{1,2})\/(\d{1,2})/);
        if (m) return String(m[1]).padStart(2, '0') + '/' + String(m[2]).padStart(2, '0');
        const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return iso[2] + '/' + iso[3];
        return s;
      };
      latestHistory = [...historyData].sort((a, b) => safe(b['일자']).localeCompare(safe(a['일자'])))[0];
    }
    const fromHist = (...keys) => {
      if (!latestHistory) return null;
      for (const key of keys) {
        const v = latestHistory[key];
        if (v == null || v === '') continue;
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[%,]/g, '').trim());
        if (isFinite(n)) return n;
      }
      return null;
    };
    const fmtPct = (v) => v != null ? Number(v).toFixed(1) + '%' : '-';
    const fmtQty = (v) => v != null ? Math.round(v).toLocaleString('ko-KR') : '-';
    const fmtAmt = (v) => {
      if (v == null) return '-';
      if (v >= 100_000_000) return (v / 100_000_000).toFixed(1) + '억';
      return Math.round(v).toLocaleString('ko-KR');
    };

    const histTotalAmt     = fromHist('총 입고금액');
    const histTargetAmt    = fromHist('총 입고금액(냉동/가공/계란 제외)', '총 입고금액 (냉동/가공/계란 제외)');
    const histTotalQty     = fromHist('총 입고수량(개)');
    const histTargetQty    = fromHist('총 입고수량(개)(냉동/가공/계란 제외)', '총 입고수량(개) (냉동/가공/계란 제외)');
    const histInspRate     = fromHist('검품률(전체)',              '검품률 (전체)',           '검품률');
    const histInspRateExcl = fromHist('검품률(냉동/가공/계란 제외)', '검품률 (냉동/가공/계란 제외)');
    const histTotalSku     = fromHist('입고 SKU (전체)',           '입고 SKU(전체)');
    const histTargetSku    = fromHist('검품입고 SKU (검품불가 제외)', '검품입고 SKU(검품불가 제외)', '검품대상 SKU');
    const histSkuCovAll    = fromHist('SKU 커버리지(전체)',          'SKU 커버리지 (전체)');
    const histSkuCovExcl   = fromHist('SKU 커버리지(냉동/가공/계란 제외)', 'SKU 커버리지 (냉동/가공/계란 제외)');

    // Live values override history where available
    const liveTotalSku  = histTotalSku  != null ? String(Math.round(histTotalSku))  : '-';
    const liveTargetSku = histTargetSku != null ? String(Math.round(histTargetSku)) : String(totalRows);
    const liveInspSku   = String(doneRows);
    const liveInspQty   = String(inspectedQty.toLocaleString('ko-KR'));
    const liveTargetQty = fmtQty(histTargetQty ?? totalOrderQty);

    // 검품률 overrides: inspected / hist qty
    const liveInspRateAll  = histTotalQty  != null && histTotalQty  > 0
      ? (inspectedQty / histTotalQty  * 100).toFixed(1) + '%'
      : fmtPct(histInspRate);
    const liveInspRateExcl = totalOrderQty > 0
      ? (inspectedQty / totalOrderQty * 100).toFixed(1) + '%'
      : fmtPct(histInspRateExcl);

    // SKU coverage live: doneRows / total/target
    const liveSkuCovAll  = histTotalSku  != null && histTotalSku  > 0
      ? (doneRows / histTotalSku  * 100).toFixed(1) + '%'
      : fmtPct(histSkuCovAll);
    const liveSkuCovExcl = totalRows > 0
      ? (doneRows / totalRows * 100).toFixed(1) + '%'
      : fmtPct(histSkuCovExcl);

    return [
      { label: '총 금액',          value: fmtAmt(histTotalAmt),  unit: '원' },
      { label: '검품대상 금액',     value: fmtAmt(histTargetAmt), unit: '원' },
      { label: '총 SKU',           value: liveTotalSku,           unit: 'SKU' },
      { label: '검품 SKU',         value: liveTargetSku,          unit: 'SKU' },
      { label: '총 수량',          value: fmtQty(histTotalQty),   unit: 'EA' },
      { label: '검품대상 수량',     value: liveTargetQty,          unit: 'EA' },
      { label: '검품 수량',        value: liveInspQty,            unit: 'EA' },
      { label: '검품 SKU(실진행)', value: liveInspSku,            unit: 'SKU' },
      { label: '검품률(전체)',      value: liveInspRateAll,        unit: '' },
      { label: '검품률(대상기준)',  value: liveInspRateExcl,       unit: '' },
      { label: 'SKU커버리지(전체)', value: liveSkuCovAll,          unit: '' },
      { label: 'SKU커버리지(대상)', value: liveSkuCovExcl,         unit: '' },
    ];
  }, [historyData, totalRows, doneRows, inspectedQty, totalOrderQty]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      {/* ── Toolbar ── */}
      <div style={{
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
        boxShadow: shadow.sm,
        padding: '10px 14px 10px',
      }}>
        {/* KPI strip — horizontally scrollable row of 12 summary chips */}
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 10,
          paddingBottom: 2,
          // Hide scrollbar visually on webkit while keeping scroll functionality
          msOverflowStyle: 'none', scrollbarWidth: 'none',
        }}>
          {kpiStrip.map((kpi) => (
            <div key={kpi.label} style={{
              flexShrink: 0,
              background: C.bgAlt, border: `1px solid ${C.border}`,
              borderRadius: radius.sm, padding: '5px 9px',
              minWidth: 80,
            }}>
              <p style={{ margin: 0, fontSize: 9, color: C.muted, fontWeight: 600, letterSpacing: '0.04em', whiteSpace: 'nowrap', fontFamily: font.base }}>{kpi.label}</p>
              <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 800, color: C.text, fontFamily: font.base, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {kpi.value}
                {kpi.unit && <span style={{ fontSize: 9, fontWeight: 400, color: C.muted, marginLeft: 2 }}>{kpi.unit}</span>}
              </p>
            </div>
          ))}
        </div>

        {/* Progress row: dual bars — SKU (left) and Quantity (right) */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'stretch' }}>
          {/* SKU progress */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: C.text, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>{doneRows}</span>
                <span style={{ fontSize: 11, color: C.muted }}>/ {totalRows} SKU</span>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.03em',
                color: pct === 100 ? C.green : C.primary,
                background: pct === 100 ? C.greenLight : C.primaryLight,
                padding: '2px 8px', borderRadius: radius.full,
                border: `1px solid ${pct === 100 ? C.greenMid : C.primaryMid}`,
              }}>{pct}%</span>
            </div>
            <div style={{ height: 3, background: C.bgAlt, borderRadius: radius.full, overflow: 'hidden' }}>
              <motion.div
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                style={{ height: '100%', borderRadius: radius.full, background: pct === 100 ? C.green : `linear-gradient(90deg, ${C.primary} 0%, #60a5fa 100%)` }}
              />
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: C.border, flexShrink: 0 }} />

          {/* Quantity progress */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <span style={{ fontSize: 9, color: C.muted, fontWeight: 600, letterSpacing: '0.04em', fontFamily: font.base }}>검품수량</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 17, fontWeight: 800, color: C.text, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>{inspectedQty.toLocaleString()}</span>
                  <span style={{ fontSize: 11, color: C.muted }}>/ {totalOrderQty.toLocaleString()} EA</span>
                </div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.03em',
                color: qtyPct === 100 ? C.green : C.primary,
                background: qtyPct === 100 ? C.greenLight : C.primaryLight,
                padding: '2px 8px', borderRadius: radius.full,
                border: `1px solid ${qtyPct === 100 ? C.greenMid : C.primaryMid}`,
              }}>{qtyPct}%</span>
            </div>
            <div style={{ height: 3, background: C.bgAlt, borderRadius: radius.full, overflow: 'hidden' }}>
              <motion.div
                animate={{ width: `${qtyPct}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                style={{ height: '100%', borderRadius: radius.full, background: qtyPct === 100 ? C.green : `linear-gradient(90deg, ${C.primary} 0%, #60a5fa 100%)` }}
              />
            </div>
          </div>
        </div>

        {/* Search + scan */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 9 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search
              size={14} strokeWidth={2}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.muted2, pointerEvents: 'none' }}
            />
            <input
              ref={searchRef}
              type="text" placeholder="상품명 또는 코드 검색"
              value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              // Clear previous keyword when the user taps the input to start a new search
              onClick={() => setSearchInput('')}
              style={{ ...inputStyle, paddingLeft: 34, height: 40 }}
            />
          </div>
          <button onClick={() => setShowScanner(true)} style={{
            ...btnPrimary, height: 40, padding: '0 14px', fontSize: 12.5, flexShrink: 0,
          }}>
            <ScanLine size={14} strokeWidth={2} />
            스캔
          </button>
          {onCsvUpload && (
            <>
              <input
                ref={csvInputRef} type="file" accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }} onChange={onCsvUpload}
              />
              <button onClick={() => csvInputRef.current?.click()} style={{
                height: 40, padding: '0 14px', fontSize: 12.5, flexShrink: 0,
                background: C.bgAlt, color: C.muted, border: `1px solid ${C.border}`,
                borderRadius: radius.sm, cursor: 'pointer', fontFamily: font.base,
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <Upload size={14} strokeWidth={2} />
                CSV
              </button>
            </>
          )}
          {onRefresh && (
            <button onClick={onRefresh} style={{
              height: 40, padding: '0 14px', fontSize: 12.5, flexShrink: 0,
              background: C.bgAlt, color: C.muted, border: `1px solid ${C.border}`,
              borderRadius: radius.sm, cursor: 'pointer', fontFamily: font.base,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <RotateCcw size={14} strokeWidth={2} />
              새로고침
            </button>
          )}
          {/* "Retry All" button — visible only when one or more saves have failed */}
          {failedSaveCount > 0 && (
            <button
              onClick={retryAllFailed}
              style={{
                height: 40, padding: '0 14px', fontSize: 12.5, flexShrink: 0,
                background: C.redLight, color: C.red, border: `1px solid ${C.redMid}`,
                borderRadius: radius.sm, cursor: 'pointer', fontFamily: font.base,
                display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700,
              }}
              title={`저장 실패 ${failedSaveCount}건 — 클릭하여 전체 재시도`}
            >
              <RefreshCw size={14} strokeWidth={2} />
              전체 재시도 ({failedSaveCount})
            </button>
          )}
        </div>

        {/* Filter chips + 발주 sort chip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'inline-flex', borderRadius: radius.md, overflow: 'hidden',
            border: `1px solid ${C.border}`, background: C.bgAlt, padding: 2, gap: 2,
          }}>
            {[
              { key: 'all',     label: '전체' },
              { key: 'empty',   label: '미입력' },
              { key: 'nophoto', label: '사진없음' },
            ].map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} style={{
                height: 28, padding: '0 13px',
                background: filter === f.key ? C.card : 'transparent',
                color: filter === f.key ? C.primary : C.muted,
                border: filter === f.key ? `1px solid ${C.primaryMid}` : '1px solid transparent',
                borderRadius: radius.sm,
                fontSize: 12, fontWeight: filter === f.key ? 700 : 500,
                cursor: 'pointer', fontFamily: font.base, transition: trans,
                boxShadow: filter === f.key ? shadow.xs : 'none',
                letterSpacing: filter === f.key ? '0.01em' : '0',
              }}>{f.label}</button>
            ))}
            {/* 발주 sort chip — cycles: null → asc → desc → null */}
            <button
              onClick={toggleSort}
              title={sortQty === 'asc' ? '발주 오름차순 (클릭 시 내림차순)' : sortQty === 'desc' ? '발주 내림차순 (클릭 시 해제)' : '발주수량 정렬'}
              style={{
                height: 28, padding: '0 10px',
                display: 'flex', alignItems: 'center', gap: 4,
                background: sortQty ? C.card : 'transparent',
                color: sortQty ? C.primary : C.muted,
                border: sortQty ? `1px solid ${C.primaryMid}` : '1px solid transparent',
                borderRadius: radius.sm,
                fontSize: 12, fontWeight: sortQty ? 700 : 500,
                cursor: 'pointer', fontFamily: font.base, transition: trans,
                boxShadow: sortQty ? shadow.xs : 'none',
                letterSpacing: sortQty ? '0.01em' : '0',
                flexShrink: 0,
              }}
            >
              {sortQty === 'asc'
                ? <ArrowUp   size={11} strokeWidth={2.5} />
                : sortQty === 'desc'
                ? <ArrowDown size={11} strokeWidth={2.5} />
                : <ArrowUpDown size={11} strokeWidth={2} />}
              발주
            </button>
          </div>
        </div>
      </div>

      {/* ── Product list ── */}
      <div ref={scrollContainerRef} style={{ padding: '12px 12px 80px' }}>
        {deduplicatedRows.length === 0 ? <EmptyState /> : (
          searchFilteredPartners.map(([partnerName, partnerRows]) => {
            const counts = partnerDoneCounts[partnerName] || { done: 0, total: partnerRows.length };
            return (
            <div
              key={partnerName}
              ref={(el) => { if (el) partnerCardRefs.current[partnerName] = el; }}
            >
              <PartnerGroup
                partnerName={partnerName}
                rows={partnerRows}
                jobKey={jobKey}
                drafts={drafts}
                saveStatuses={saveStatuses}
                doneCount={counts.done}
                totalCount={counts.total}
                highlightSearch={!!search}
                centers={centers}
                happycallRanks={happycallRanks}
                eventMap={eventMap}
                productImageMap={productImageMap}
                accumulatedMovement={accumulatedMovement}
                movementCounts={movementCounts}
                onProductImageUploaded={onProductImageUploaded}
                onDraftChange={handleDraftChange}
                onSaved={handleSaved}
                onMovementSaved={handleMovSaved}
                onError={handleError}
                onSaveError={handleSaveError}
                expanded={openPartner === partnerName}
                onToggle={handleTogglePartner}
                canEditInspection={canEditInspection}
                canUploadPhoto={canUploadPhoto}
                canEditReturnExchange={canEditReturnExchange}
                isAdmin={isAdmin}
                partnerShortNameMap={partnerShortNameMap}
              />
            </div>
            );
          })
        )}
      </div>

      {showScanner && (
        <Suspense fallback={null}>
          <BarcodeScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
        </Suspense>
      )}
    </motion.div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      margin: '24px 0', padding: '52px 24px',
      background: C.card, borderRadius: radius.lg, border: `1.5px dashed ${C.border}`,
      textAlign: 'center', color: C.muted,
    }}>
      <ClipboardList size={40} strokeWidth={1.5} color={C.muted2} style={{ display: 'block', margin: '0 auto 14px' }} />
      <p style={{ fontSize: 15, fontWeight: 700, color: C.textSec, margin: '0 0 6px' }}>작업 데이터 없음</p>
      <p style={{ fontSize: 13, margin: 0 }}>상단 CSV 업로드 버튼을 눌러 작업 파일을 불러오세요.</p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeCode(value) {
  if (!value) return '';
  let text = String(value).replace(/\uFEFF/g, '').trim();
  const m = text.match(/^=T\("(.+)"\)$/i);
  if (m) text = m[1];
  text = text.replace(/^"+|"+$/g, '').trim();
  const num = text.replace(/,/g, '').trim();
  if (/^\d+(\.0+)?$/.test(num)) return num.replace(/\.0+$/, '');
  return text;
}

/**
 * Strips GS Retail company prefix variants from a raw 사전예약 center name
 * and ensures the result ends with "센터" to match CSV row center keys.
 *
 * Examples:
 *   "(주)지에스리테일송파2일배"   → "송파2일배센터"
 *   "지에스리테일경산저온"        → "경산저온센터"
 *   "(주)지에리스테일(해인cvs도)" → "해인cvs도센터"
 *   "(주)지에스리테일양지물류센터" → "양지물류센터"
 */
export function normalizeCenterName(rawCenter) {
  let name = String(rawCenter || '').trim();

  // Remove company prefix variants — longest patterns first to avoid partial matches.
  name = name
    .replace(/^\(주\)지에스리테일/, '')
    .replace(/^\(주\)지에리스테일/, '')
    .replace(/^지에스리테일/, '')
    .replace(/^지에리스테일/, '')
    .replace(/^GS리테일/, '');

  // Strip outer wrapper parentheses when the entire remaining value is enclosed:
  // "(해인cvs도)" → "해인cvs도"  (meaningful text, preserve it)
  // "(양지물류센터)" → "양지물류센터"  (already has 센터 suffix)
  const wrappedMatch = name.match(/^\(([^)]+)\)$/);
  if (wrappedMatch) name = wrappedMatch[1];

  // Normalize repeated spaces and trim
  name = name.replace(/\s+/g, ' ').trim();

  // Append "센터" when the normalized name doesn't already end with it
  if (name && !name.endsWith('센터')) name += '센터';

  return name;
}

function buildExclusionIndex(excludeRows) {
  const excludedCodes    = {};
  const excludedPairs    = {};
  const excludedPartners = {};
  for (const row of excludeRows) {
    const active = (() => {
      const val = String(row['사용여부'] || '').trim().toLowerCase();
      if (!val) return true;
      return ['y', 'yes', '사용', '활성', '1', 'true'].includes(val);
    })();
    if (!active) continue;
    const code    = normalizeCode(row['상품코드'] || row['상품 코드'] || row['코드'] || row['바코드'] || '');
    const partner = String(row['협력사'] || row['협력사명'] || '').trim();
    if (!code && !partner) continue;
    if (partner) {
      if (code) excludedPairs[`${code}||${partner}`] = true;
      else      excludedPartners[partner] = true;
    } else {
      excludedCodes[code] = true;
    }
  }
  return { excludedCodes, excludedPairs, excludedPartners };
}

function isExcluded(row, idx) {
  const code    = normalizeCode(row['상품코드'] || '');
  const partner = String(row['협력사명'] || '').trim();
  return (
    !!idx.excludedCodes[code] ||
    !!idx.excludedPairs[`${code}||${partner}`] ||
    !!idx.excludedPartners[partner]
  );
}

function groupByPartner(rows) {
  const map = new Map();
  for (const r of rows) {
    const p = r['협력사명'] || '(협력사 없음)';
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(r);
  }
  // Sort partners in Korean (가나다) order
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'ko'));
}

function applyFilter(partners, filter, jobKey, draftSummary) {
  if (filter === 'all') return partners;
  return partners.map(([name, rows]) => {
    const filtered = rows.filter((r) => {
      const key = `${jobKey}||${normalizeCode(r['상품코드'])}||${r['협력사명'] || ''}`;
      if (filter === 'empty')   return !draftSummary.doneSet.has(key);
      if (filter === 'nophoto') return !draftSummary.photoSet.has(key);
      return true;
    });
    return [name, filtered];
  }).filter(([, rows]) => rows.length > 0);
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function loadDrafts() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
    // Sanitize on restore: purge any deleted IDs from photo arrays before React
    // ever sees the data.  Defends against any timing edge-case where the photo
    // array and deletedPhotoIds were written to localStorage in an inconsistent
    // state (e.g., useEffect([drafts]) flushed mid-update) and also covers the
    // tab-switch / remount path where stale data could otherwise survive forever.
    const PHOTO_FIELDS = ['inspPhotoIds', 'defectPhotoIds', 'weightPhotoIds', 'brixPhotoIds', 'photoFileIds'];
    const out = {};
    for (const [k, draft] of Object.entries(raw)) {
      if (!draft || typeof draft !== 'object') { out[k] = draft; continue; }
      const deletedSet = new Set(draft.deletedPhotoIds || []);
      if (!deletedSet.size) { out[k] = draft; continue; }
      const clean = { ...draft };
      let dirty = false;
      for (const field of PHOTO_FIELDS) {
        if (Array.isArray(clean[field]) && clean[field].some((id) => deletedSet.has(id))) {
          clean[field] = clean[field].filter((id) => !deletedSet.has(id));
          dirty = true;
        }
      }
      out[k] = dirty ? clean : draft;
    }
    return out;
  } catch (_) { return {}; }
}
