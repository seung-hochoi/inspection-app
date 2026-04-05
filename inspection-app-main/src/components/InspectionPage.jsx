import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, ScanLine, ClipboardList, Upload } from 'lucide-react';
import { C, radius, font, shadow, trans, inputStyle, btnPrimary } from './styles';
import PartnerGroup from './PartnerGroup';
import BarcodeScanner from './BarcodeScanner';

const DRAFTS_KEY = 'inspection_drafts_v2';

export default function InspectionPage({
  jobKey, rows = [], config = {}, records = [], happycall = {}, inspectionRows = [],
  onError, onToast, onCsvUpload,
}) {
  const [drafts, setDrafts]             = useState(() => loadDrafts());
  const [saveStatuses, setSaveStatuses] = useState({});
  const [search, setSearch]             = useState('');
  const [filter, setFilter]             = useState('all');
  const [showScanner, setShowScanner]   = useState(false);
  const searchRef  = useRef(null);
  const csvInputRef = useRef(null);

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

        const photoIds = String(ir['사진파일ID목록'] || '').split('\n').filter(Boolean);
        if (photoIds.length > 0 && !existing.inspPhotoIds?.length && !existing.photoFileIds?.length) {
          updates.inspPhotoIds = photoIds;
          changed = true;
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

  // ── Derived data from props ──────────────────────────────────────────────

  const exclusionIndex = useMemo(() => buildExclusionIndex(config.exclude_rows || []), [config.exclude_rows]);

  const eventSet = useMemo(() => {
    const s = new Set();
    for (const er of (config.event_rows || [])) {
      const code = normalizeCode(er['상품코드'] || er['코드'] || '');
      if (code) s.add(code);
    }
    return s;
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

  // ── Filtered rows (apply exclusion) ──────────────────────────────────────

  const activeRows = useMemo(
    () => rows.filter((r) => !isExcluded(r, exclusionIndex)),
    [rows, exclusionIndex],
  );

  // ── Draft / save handlers ─────────────────────────────────────────────────

  const handleDraftChange = useCallback((productKey, draft) => {
    setDrafts((prev) => ({ ...prev, [productKey]: draft }));
    setSaveStatuses((prev) => ({ ...prev, [productKey]: 'saving' }));
  }, []);

  const handleSaved = useCallback((productKey) => {
    setSaveStatuses((prev) => ({ ...prev, [productKey]: 'saved' }));
    setTimeout(() => {
      setSaveStatuses((prev) =>
        prev[productKey] === 'saved' ? { ...prev, [productKey]: 'idle' } : prev,
      );
    }, 1600);
  }, []);

  const handleError    = useCallback((msg) => { onError?.(msg); onToast?.(msg, 'error'); }, [onError, onToast]);
  const handleMovSaved = useCallback(() => onToast?.('저장되었습니다.', 'success'), [onToast]);

  const handleScan = useCallback((code) => {
    setShowScanner(false);
    const matched = activeRows.find((r) => String(r['상품코드'] || '').trim() === code.trim());
    if (matched) { setSearch(code.trim()); onToast?.(`바코드: ${code}`, 'info'); }
    else          { onToast?.(`상품코드 없음: ${code}`, 'error'); }
  }, [activeRows, onToast]);

  // ── Partner grouping with filter + search ─────────────────────────────────

  const partners         = groupByPartner(activeRows);
  const filteredPartners = applyFilter(partners, filter, jobKey, drafts);

  const totalRows = activeRows.length;
  const doneRows  = activeRows.filter((r) => {
    const key = `${jobKey}||${normalizeCode(r['상품코드'])}||${r['협력사명'] || ''}`;
    return parseInt((drafts[key] || {}).inspQty, 10) > 0;
  }).length;
  const pct = totalRows > 0 ? Math.round((doneRows / totalRows) * 100) : 0;

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
        padding: '12px 14px 10px',
      }}>
        {/* Progress row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: C.text, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>{doneRows}</span>
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
        <div style={{ height: 4, background: C.bgAlt, borderRadius: radius.full, overflow: 'hidden', marginBottom: 11 }}>
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
              value={search} onChange={(e) => setSearch(e.target.value)}
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
        </div>

        {/* Filter chips */}
        <div style={{
          display: 'inline-flex', borderRadius: radius.sm, overflow: 'hidden',
          border: `1px solid ${C.border}`, background: C.bgAlt,
        }}>
          {[
            { key: 'all',     label: '전체' },
            { key: 'empty',   label: '미입력' },
            { key: 'nophoto', label: '사진없음' },
          ].map((f, i) => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              height: 30, padding: '0 14px',
              background: filter === f.key ? C.primary : 'transparent',
              color: filter === f.key ? '#fff' : C.muted,
              border: 'none',
              borderLeft: i > 0 ? `1px solid ${C.border}` : 'none',
              fontSize: 12, fontWeight: filter === f.key ? 700 : 500,
              cursor: 'pointer', fontFamily: font.base, transition: trans,
              letterSpacing: filter === f.key ? '0.01em' : '0',
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* ── Product list ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 80px' }}>
        {activeRows.length === 0 ? <EmptyState /> : (
          filteredPartners.map(([partnerName, partnerRows]) => (
            <PartnerGroup
              key={partnerName}
              partnerName={partnerName}
              rows={partnerRows}
              jobKey={jobKey}
              drafts={drafts}
              saveStatuses={saveStatuses}
              searchQuery={search}
              centers={centers}
              happycallRanks={happycallRanks}
              eventSet={eventSet}
              onDraftChange={handleDraftChange}
              onSaved={handleSaved}
              onMovementSaved={handleMovSaved}
              onError={handleError}
              defaultExpanded
            />
          ))
        )}
      </div>

      {showScanner && <BarcodeScanner onScan={handleScan} onClose={() => setShowScanner(false)} />}
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

function applyFilter(partners, filter, jobKey, drafts) {
  if (filter === 'all') return partners;
  return partners.map(([name, rows]) => {
    const filtered = rows.filter((r) => {
      const key = `${jobKey}||${normalizeCode(r['상품코드'])}||${r['협력사명'] || ''}`;
      const d = drafts[key] || {};
      if (filter === 'empty')   return !(parseInt(d.inspQty, 10) > 0);
      if (filter === 'nophoto') return !(
        (d.inspPhotoIds && d.inspPhotoIds.length > 0) ||
        (d.defectPhotoIds && d.defectPhotoIds.length > 0) ||
        (d.photoFileIds && d.photoFileIds.length > 0)
      );
      return true;
    });
    return [name, filtered];
  }).filter(([, rows]) => rows.length > 0);
}

function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}'); }
  catch (_) { return {}; }
}
