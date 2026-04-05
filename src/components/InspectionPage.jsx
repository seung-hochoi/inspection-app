import React, { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Search, ScanLine, ClipboardList, Upload, ArrowUp, ArrowDown, ArrowUpDown, X, RotateCcw } from 'lucide-react';
import { C, radius, font, shadow, trans, inputStyle, btnPrimary } from './styles';
import PartnerGroup from './PartnerGroup';

// Lazy-load BarcodeScanner so @zxing/browser (~5 MB) is not in the initial bundle
const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

const DRAFTS_KEY = 'inspection_drafts_v2';

export default function InspectionPage({
  jobKey, rows = [], config = {}, records = [], happycall = {}, inspectionRows = [],
  productImageMap = {}, onProductImageUploaded,
  onError, onToast, onCsvUpload, onRefresh, onRecordsUpdate,
  authUser,
}) {
  const [drafts, setDrafts]             = useState(() => loadDrafts());
  const [saveStatuses, setSaveStatuses] = useState({});
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

  useEffect(() => {
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch (_) {}
  }, [drafts]);

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

        if (hasCategories) {
          // Per-category hydration — each type is independent
          const merge = (draftField, legacyField, serverField) => {
            const serverIds = String(ir[serverField] || '').split('\n').filter(Boolean);
            if (!serverIds.length) return {};
            const existingIds  = [...(existing[draftField] || existing[legacyField] || [])];
            const existingSet  = new Set(existingIds);
            const hasNew       = serverIds.some((id) => !existingSet.has(id));
            if (!hasNew) return {};
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
        } else {
          // Legacy fallback: combined list → inspPhotoIds only
          const photoIds = String(ir['사진파일ID목록'] || '').split('\n').filter(Boolean);
          if (photoIds.length > 0) {
            const existingIds = [...(existing.inspPhotoIds || existing.photoFileIds || [])];
            const existingSet = new Set(existingIds);
            const hasNewIds   = photoIds.some((id) => !existingSet.has(id));
            if (hasNewIds) {
              updates.inspPhotoIds = [...new Set([...existingIds, ...photoIds])];
              changed = true;
            }
          }
        }

        const inspQty = String(ir['검품수량'] || '');
        if (inspQty && inspQty !== '0' && !existing.inspQty) {
          updates.inspQty = inspQty;
          changed = true;
        }
        const defectReason = String(ir['불량사유'] || '').trim();
        if (defectReason && !existing.defectReason) {
          updates.defectReason = defectReason;
          changed = true;
        }
        if (ir['BRIX최저'] && !existing.brixMin) { updates.brixMin = String(ir['BRIX최저']); changed = true; }
        if (ir['BRIX최고'] && !existing.brixMax) { updates.brixMax = String(ir['BRIX최고']); changed = true; }
        if (ir['BRIX평균'] && !existing.brixAvg) { updates.brixAvg = String(ir['BRIX평균']); changed = true; }

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

  // ── Deduplicate: merge rows sharing partner + productCode into one card ──────
  // CSV may have separate rows per center for the same product; the inspection
  // tab must show exactly ONE card per partner + productCode, with total 발주수량.
  const deduplicatedRows = useMemo(() => {
    const map = new Map();
    for (const r of activeRows) {
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
  }, [activeRows]);

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
  const handleMovSaved = useCallback((freshRecords) => {
    onToast?.('저장되었습니다.', 'success');
    // If the backend returned fresh records, update only records state (no loading flash).
    // Fall back to full reload if fresh records are unavailable (e.g. backend error).
    if (Array.isArray(freshRecords) && onRecordsUpdate) {
      onRecordsUpdate(freshRecords);
    } else {
      onRefresh?.();
    }
  }, [onToast, onRecordsUpdate, onRefresh]);

  const handleScan = useCallback((code) => {
    setShowScanner(false);
    const matched = deduplicatedRows.find((r) => String(r['상품코드'] || '').trim() === code.trim());
    if (matched) { setSearchInput(code.trim()); onToast?.(`바코드: ${code}`, 'info'); }
    else          { onToast?.(`상품코드 없음: ${code}`, 'error'); }
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

  const toggleSort = useCallback(() => {
    setSortQty((prev) => prev === null ? 'asc' : prev === 'asc' ? 'desc' : null);
  }, []);
  const clearSort = useCallback(() => setSortQty(null), []);

  const handleTogglePartner = useCallback((name) => {
    setOpenPartner((prev) => (prev === name ? null : name));
  }, []);

  // Auto-scroll the opened partner card to the top of the scroll container
  useEffect(() => {
    if (!openPartner) return;
    const el        = partnerCardRefs.current[openPartner];
    const container = scrollContainerRef.current;
    if (!el || !container) return;
    // Wait one frame for the DOM to settle before measuring
    const raf = requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const elRect        = el.getBoundingClientRect();
      const scrollAdjust  = elRect.top - containerRect.top - 8;
      container.scrollBy({ top: scrollAdjust, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* ── Sticky toolbar ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
        boxShadow: shadow.sm,
        padding: '10px 14px 10px',
      }}>
        {/* Progress row: stats left, % badge right */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>{doneRows}</span>
            <span style={{ fontSize: 12, color: C.muted }}>/ {totalRows} 완료</span>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
            color: pct === 100 ? C.green : C.primary,
            background: pct === 100 ? C.greenLight : C.primaryLight,
            padding: '2px 10px', borderRadius: radius.full,
            border: `1px solid ${pct === 100 ? C.greenMid : C.primaryMid}`,
          }}>{pct}%</span>
        </div>
        <div style={{ height: 3, background: C.bgAlt, borderRadius: radius.full, overflow: 'hidden', marginBottom: 10 }}>
          <motion.div
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{
              height: '100%', borderRadius: radius.full,
              background: pct === 100 ? C.green : `linear-gradient(90deg, ${C.primary} 0%, #60a5fa 100%)`,
            }}
          />
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
              style={{ ...inputStyle, paddingLeft: 34, height: 40, fontSize: 13 }}
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
      <div ref={scrollContainerRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 80px' }}>
        {activeRows.length === 0 ? <EmptyState /> : (
          sortedPartners.map(([partnerName, partnerRows]) => (
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
                searchQuery={search}
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
              />
            </div>
          ))
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
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}'); }
  catch (_) { return {}; }
}
