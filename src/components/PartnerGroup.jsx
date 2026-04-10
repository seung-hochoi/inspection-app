import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';
import { C, radius, font, trans } from './styles';
import ProductRow from './ProductRow';

function PartnerGroupBase({
  partnerName, rows, jobKey,
  drafts = {}, saveStatuses = {},
  // doneCount/totalCount are precomputed by InspectionPage — no row scanning here.
  doneCount = 0, totalCount = 0,
  // highlightSearch: rows are already filtered; this just controls highlight UI.
  highlightSearch = false,
  centers = [], happycallRanks = {}, eventMap = {},
  productImageMap = {}, onProductImageUploaded,
  accumulatedMovement = {},
  movementCounts = {},
  onDraftChange, onSaved, onMovementSaved, onError, onSaveError,
  expanded = false, onToggle,
  canEditInspection = true, canUploadPhoto = true, canEditReturnExchange = true,
  isAdmin = false,
  // Map of 협력사명 → 파트너사 short names, derived from the mapping sheet.
  partnerShortNameMap = {},
}) {
  const handleHeaderClick = () => onToggle?.(partnerName);

  // doneCount and totalCount arrive as props — no filter loop needed here.
  const allDone = doneCount === totalCount && totalCount > 0;
  const pct     = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // rows are pre-filtered by InspectionPage when highlightSearch is true.
  const visibleRows = rows;

  if (visibleRows.length === 0) return null;

  return (
    <div style={{
      marginBottom: 10,
      borderRadius: radius.lg,
      overflow: 'hidden',
      border: `1px solid ${allDone ? C.greenMid : C.border}`,
      boxShadow: allDone
        ? `0 2px 10px rgba(22,163,74,0.10), 0 1px 3px rgba(22,163,74,0.06)`
        : '0 2px 8px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.03)',
      transition: 'border-color 0.2s, box-shadow 0.2s',
    }}>
      {/* Group header */}
      <button
        onClick={handleHeaderClick}
        className="partner-header-btn"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: allDone
            ? 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)'
            : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          border: 'none', padding: '12px 14px', cursor: 'pointer', fontFamily: font.base,
          transition: trans,
          borderBottom: expanded ? `1px solid ${allDone ? C.greenMid : C.border}` : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            minWidth: 38, height: 22, padding: '0 8px',
            background: allDone ? C.green : doneCount > 0 ? C.primary : C.muted2,
            color: '#fff', fontSize: 11, fontWeight: 700,
            borderRadius: radius.full, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            letterSpacing: '0.01em', flexShrink: 0,
            boxShadow: allDone ? '0 1px 3px rgba(22,163,74,0.30)' : doneCount > 0 ? '0 1px 3px rgba(37,99,235,0.25)' : 'none',
            transition: 'background 0.2s',
          }}>
            {doneCount}/{totalCount}
          </span>
          <span style={{
            fontSize: 13.5, fontWeight: 700,
            color: allDone ? C.green : C.text,
            letterSpacing: '-0.015em',
            transition: 'color 0.2s',
          }}>
            {partnerShortNameMap[partnerName] || partnerName}
          </span>
          {allDone && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 10, fontWeight: 700, color: C.green, letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: C.greenLight, padding: '2px 8px', borderRadius: radius.full,
              border: `1px solid ${C.greenMid}`,
            }}>
              <CheckCircle2 size={10} strokeWidth={2.5} />
              완료
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {totalCount > 0 && (
            <>
              <div style={{ width: 80, height: 5, background: C.bgAlt, borderRadius: radius.full, overflow: 'hidden' }}>
                <div style={{
                  width: `${pct}%`, height: '100%',
                  background: allDone
                    ? C.green
                    : `linear-gradient(90deg, ${C.primary} 0%, #60a5fa 100%)`,
                  borderRadius: radius.full, transition: 'width 0.4s ease',
                }} />
              </div>
              {!allDone && (
                <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {pct}%
                </span>
              )}
            </>
          )}
          <motion.div
            animate={{ rotate: expanded ? 0 : -90 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            style={{ display: 'flex', alignItems: 'center' }}
          >
            <ChevronDown size={15} color={C.muted2} strokeWidth={2} />
          </motion.div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden', background: C.card }}
          >
            {visibleRows.map((r) => {
              // Use precomputed __productCode to avoid regex inside render.
              const code = r.__productCode || normalizeCode(r['상품코드']);
              const key  = `${jobKey}||${code}||${r['협력사명'] || ''}`;
              const movKey = `${r['협력사명'] || ''}||${code}`;
              const mc     = movementCounts[movKey] || {};
              return (
                <ProductRow
                  key={key} row={r} jobKey={jobKey}
                  draft={drafts[key] || {}}
                  saveStatus={saveStatuses[key] || 'idle'}
                  highlight={highlightSearch}
                  centers={centers}
                  happycallRanks={happycallRanks[`code::${code}`] || null}
                  eventName={eventMap[code] || ''}
                  productImageMap={productImageMap}
                  accumulatedQty={accumulatedMovement[movKey] || 0}
                  returnCount={mc.returnCount || 0}
                  exchangeCount={mc.exchangeCount || 0}
                  returnQty={mc.returnQty || 0}
                  exchangeQty={mc.exchangeQty || 0}
                  onProductImageUploaded={onProductImageUploaded}
                  onDraftChange={onDraftChange}
                  onSaved={onSaved}
                  onMovementSaved={onMovementSaved}
                  onError={onError}
                  onSaveError={onSaveError}
                  canEditInspection={canEditInspection}
                  canUploadPhoto={canUploadPhoto}
                  canEditReturnExchange={canEditReturnExchange}
                  isAdmin={isAdmin}
                />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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

// Custom comparison: only re-render when a prop that affects THIS partner changes.
function arePartnerGroupPropsEqual(prev, next) {
  if (prev.partnerName      !== next.partnerName)      return false;
  if (prev.jobKey           !== next.jobKey)           return false;
  if (prev.rows             !== next.rows)             return false;
  if (prev.doneCount        !== next.doneCount)        return false;
  if (prev.totalCount       !== next.totalCount)       return false;
  if (prev.highlightSearch  !== next.highlightSearch)  return false;
  if (prev.centers          !== next.centers)          return false;
  if (prev.happycallRanks   !== next.happycallRanks)   return false;
  if (prev.eventMap         !== next.eventMap)         return false;
  if (prev.accumulatedMovement !== next.accumulatedMovement) return false;
  if (prev.movementCounts      !== next.movementCounts)      return false;
  if (prev.expanded         !== next.expanded)         return false;
  if (prev.onToggle         !== next.onToggle)         return false;
  if (prev.onDraftChange    !== next.onDraftChange)    return false;
  if (prev.onSaved          !== next.onSaved)          return false;
  if (prev.onMovementSaved  !== next.onMovementSaved)  return false;
  if (prev.onError          !== next.onError)          return false;
  if (prev.onSaveError      !== next.onSaveError)      return false;
  if (prev.canEditInspection     !== next.canEditInspection)     return false;
  if (prev.canUploadPhoto        !== next.canUploadPhoto)        return false;
  if (prev.canEditReturnExchange !== next.canEditReturnExchange) return false;
  if (prev.partnerShortNameMap   !== next.partnerShortNameMap)   return false;

  // Check drafts and saveStatuses only for this partner's own rows.
  // Use __productCode (precomputed in buildNormalizedRows) to avoid regex.
  for (const r of next.rows) {
    const code = r.__productCode || normalizeCode(r['상품코드']);
    const key  = `${next.jobKey}||${code}||${r['협력사명'] || ''}`;
    if (prev.drafts[key]       !== next.drafts[key])       return false;
    if (prev.saveStatuses[key] !== next.saveStatuses[key]) return false;
  }

  return true;
}

export default React.memo(PartnerGroupBase, arePartnerGroupPropsEqual);

