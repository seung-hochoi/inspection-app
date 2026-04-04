import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Minus, Plus, Camera, RotateCcw, Repeat2 } from 'lucide-react';
import { C, radius, font, shadow, trans } from './styles';
import PhotoUploader from './PhotoUploader';
import ReturnExchangeModal from './ReturnExchangeModal';
import { saveBatch } from '../api';
import { normalizeProductCode } from '../utils';

export default function ProductRow({
  row, jobKey, draft = {}, onDraftChange, onSaved, onMovementSaved, onError,
  saveStatus, highlight, centers = [], happycallRanks = null, isEvent = false,
}) {
  // 'insp' = 검품사진, 'defect' = 불량사진 (return+exchange combined)
  const [showPhotoType, setShowPhotoType] = useState(null);
  const [showMovement, setShowMovement]   = useState(false);
  const [movementType, setMovementType]   = useState('RETURN');
  const saveTimerRef   = useRef(null);
  const latestDraftRef = useRef(draft);
  latestDraftRef.current = draft;  // always up-to-date even in stale closures

  const cleanCode    = normalizeProductCode(row['상품코드']) || '';
  const productKey   = `${jobKey}||${cleanCode}||${row['협력사명'] || ''}`;
  const inspQty      = draft.inspQty      !== undefined ? draft.inspQty      : '';
  const defectReason = draft.defectReason !== undefined ? draft.defectReason : '';
  // 검품사진
  const inspPhotoIds   = draft.inspPhotoIds  || draft.photoFileIds   || [];
  // 불량사진: combined from defectPhotoIds (new) or legacy returnPhotoIds+exchangePhotoIds
  const defectPhotoIds = draft.defectPhotoIds ||
    [...(draft.returnPhotoIds || []), ...(draft.exchangePhotoIds || [])];

  // scheduleSave: does NOT depend on draft — reads latestDraftRef inside timeout
  const scheduleSave = useCallback((latestDraft) => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveBatch([buildInspRow(row, jobKey, latestDraft || latestDraftRef.current)]);
        onSaved?.(productKey);
      } catch (err) {
        onError?.(err.message || '저장 실패');
      }
    }, 500);
  }, [row, jobKey, productKey, onSaved, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  const updateDraft = useCallback((patch) => {
    const next = { ...latestDraftRef.current, ...patch };
    onDraftChange?.(productKey, next);
    scheduleSave(next);
  }, [productKey, onDraftChange, scheduleSave]);

  const handleQtyChange = (val) => {
    const clean = String(val).replace(/\D/g, '');
    updateDraft({ inspQty: clean });
  };
  const stepQty = (delta) => {
    const current = parseInt(latestDraftRef.current.inspQty, 10) || 0;
    updateDraft({ inspQty: String(Math.max(0, current + delta)) });
  };

  const handleMovementSave = async ({ type, centerName, qty, note }) => {
    await saveBatch([{
      type: 'movement',
      '작업기준일또는CSV식별값': jobKey,
      '상품코드':  cleanCode || row['상품코드'] || '',
      '상품명':    row['상품명']    || '',
      '협력사명':  row['협력사명']  || '',
      '센터명':    centerName || '',
      '처리유형':  type === 'RETURN' ? '회송' : '교환',
      '회송수량':  type === 'RETURN'   ? String(qty) : '0',
      '교환수량':  type === 'EXCHANGE' ? String(qty) : '0',
      '발주수량':  String(row['발주수량'] || 0),
      '전체발주수량': String(row['전체발주수량'] || row['발주수량'] || 0),
      '비고': note || '',
      movementType: type,
    }]);
    onMovementSaved?.();
  };

  const orderedQty = parseInt(row['발주수량'], 10) || 0;
  const inspNum    = parseInt(inspQty, 10) || 0;
  const defectCount = orderedQty > 0 ? Math.max(0, orderedQty - inspNum) : 0;
  const isDone      = inspNum > 0 && inspNum >= orderedQty;
  const hasDefect   = inspNum > 0 && inspNum < orderedQty;

  const accentColor =
    saveStatus === 'saving' ? C.yellow :
    saveStatus === 'error'  ? C.red    :
    saveStatus === 'saved'  ? C.green  :
    isDone    ? C.green  :
    hasDefect ? C.orange : C.border;

  const statusLabel =
    saveStatus === 'saving' ? { text: '저장 중', bg: C.yellowMid,  color: C.yellow } :
    saveStatus === 'saved'  ? { text: '저장됨',  bg: C.greenMid,   color: C.green  } :
    saveStatus === 'error'  ? { text: '오류',    bg: C.redMid,     color: C.red    } :
    isDone    ? { text: '완료', bg: C.greenSoft, color: C.green  } :
    hasDefect ? { text: '불량', bg: C.orangeMid, color: C.orange } :
    null;

  const rowBg = highlight ? '#fefce8' : isDone ? '#f8fffb' : hasDefect ? '#fffbf5' : C.card;

  const hcRank   = happycallRanks?.['7d']?.rank   ?? happycallRanks?.['30d']?.rank   ?? null;
  const hcReason = happycallRanks?.['7d']?.reason || happycallRanks?.['30d']?.reason || '';

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12 }}
        style={{ display: 'flex', background: rowBg, borderBottom: `1px solid ${C.border}` }}
      >
        {/* ── Accent bar ── */}
        <div style={{ width: 3, flexShrink: 0, background: accentColor, transition: 'background 0.3s' }} />

        {/* ── Card body ── */}
        <div style={{ flex: 1, padding: '12px 14px 12px 11px', minWidth: 0 }}>

          {/* ── Section 1: Product header ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <p style={{
              flex: 1, margin: 0,
              fontSize: 14, fontWeight: 600, color: C.text,
              letterSpacing: '-0.015em', lineHeight: 1.35,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {row['상품명'] || '—'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {isEvent && <Tag bg={C.orangeLight} color={C.orange} border={C.orangeMid}>행사</Tag>}
              {hcRank && <Tag bg={C.redLight} color={C.red} border={C.redMid} title={hcReason || undefined}>TOP.{hcRank}</Tag>}
              {statusLabel && (
                <motion.span
                  key={`${saveStatus}-${isDone}-${hasDefect}`}
                  initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px',
                    borderRadius: radius.full, background: statusLabel.bg, color: statusLabel.color,
                    letterSpacing: '0.03em', whiteSpace: 'nowrap',
                  }}
                >{statusLabel.text}</motion.span>
              )}
            </div>
          </div>

          {/* ── Section 2: Metadata ── */}
          <p style={{
            margin: '0 0 10px', fontSize: 11.5, color: C.muted, lineHeight: 1.4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {[cleanCode, row['협력사명']].filter(Boolean).join(' · ')}
            {orderedQty > 0 && <span style={{ color: C.muted2 }}> · 발주 {orderedQty}</span>}
          </p>

          {/* ── Section 3: Qty stepper + compact defect reason + photo buttons ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>

            {/* 검품수량 stepper */}
            <div style={{ flexShrink: 0 }}>
              <p style={fieldLabel}>검품수량</p>
              <div style={{
                display: 'flex', alignItems: 'stretch',
                borderRadius: radius.sm, overflow: 'hidden',
                border: `1.5px solid ${isDone ? C.greenMid : hasDefect ? C.orangeMid : C.border}`,
                boxShadow: isDone
                  ? `0 0 0 2px ${C.greenLight}`
                  : hasDefect ? `0 0 0 2px ${C.orangeLight}` : shadow.xs,
                background: C.card, transition: 'border-color 0.2s, box-shadow 0.2s',
              }}>
                <StepperBtn onClick={() => stepQty(-1)} aria-label="감소">
                  <Minus size={12} strokeWidth={2.5} />
                </StepperBtn>
                <input
                  type="text" inputMode="numeric" aria-label="검품수량"
                  value={inspQty}
                  onChange={(e) => handleQtyChange(e.target.value)}
                  placeholder={orderedQty > 0 ? String(orderedQty) : '0'}
                  style={{
                    width: 54, height: 36, textAlign: 'center', border: 'none',
                    fontSize: 16, fontWeight: 800,
                    color: isDone ? C.green : hasDefect ? C.orange : C.text,
                    fontFamily: font.base, outline: 'none', background: 'transparent',
                    letterSpacing: '-0.02em',
                  }}
                />
                <StepperBtn onClick={() => stepQty(1)} aria-label="증가" primary>
                  <Plus size={12} strokeWidth={2.5} />
                </StepperBtn>
              </div>
            </div>

            {/* 불량 count indicator */}
            {orderedQty > 0 && inspNum > 0 && (
              <div style={{ flexShrink: 0 }}>
                <p style={fieldLabel}>불량</p>
                <div style={{
                  height: 36, minWidth: 44, padding: '0 10px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: radius.sm,
                  background: defectCount > 0 ? C.orangeLight : C.greenLight,
                  border: `1.5px solid ${defectCount > 0 ? C.orangeMid : C.greenMid}`,
                  fontSize: 15, fontWeight: 800,
                  color: defectCount > 0 ? C.orange : C.green,
                  letterSpacing: '-0.02em', fontFamily: font.base,
                }}>
                  {defectCount}
                </div>
              </div>
            )}

            {/* 불량 사유 — compact inline */}
            <div style={{ flex: '1 1 120px', minWidth: 0 }}>
              <p style={fieldLabel}>불량 사유</p>
              <input
                type="text"
                placeholder="불량 사유"
                value={defectReason}
                onChange={(e) => updateDraft({ defectReason: e.target.value })}
                aria-label="불량 사유"
                style={{
                  width: '100%', height: 36, padding: '0 8px',
                  border: `1.5px solid ${defectReason ? C.borderMid : C.border}`,
                  borderRadius: radius.sm, fontSize: 12, fontFamily: font.base,
                  color: C.text, outline: 'none',
                  background: defectReason ? '#fefce8' : C.bgAlt,
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              />
            </div>

            {/* Photo buttons: 검품사진 / 불량사진 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, paddingTop: 18 }}>
              <PhotoTypeBtn
                label="검품사진" count={inspPhotoIds.length}
                color={C.primary} bg={C.primaryLight} border={C.primaryMid}
                onClick={() => setShowPhotoType('insp')}
              />
              <PhotoTypeBtn
                label="불량사진" count={defectPhotoIds.length}
                color={C.red} bg={C.redLight} border={C.redMid}
                onClick={() => setShowPhotoType('defect')}
              />
            </div>

          </div>

          {/* ── Section 4: Movement buttons ── */}
          <div style={{ display: 'flex', gap: 7, marginTop: 10, justifyContent: 'flex-end' }}>
            <MovBtn
              icon={<RotateCcw size={12} strokeWidth={2} />} label="회송"
              color={C.red} bg={C.redLight} border={C.redMid}
              onClick={() => { setMovementType('RETURN'); setShowMovement(true); }}
            />
            <MovBtn
              icon={<Repeat2 size={12} strokeWidth={2} />} label="교환"
              color={C.orange} bg={C.orangeLight} border={C.orangeMid}
              onClick={() => { setMovementType('EXCHANGE'); setShowMovement(true); }}
            />
          </div>

        </div>
      </motion.div>

      {/* ── Modals: rendered via portal to avoid overflow/transform clipping ── */}
      {showPhotoType && createPortal(
        <PhotoUploader
          jobKey={jobKey}
          product={{
            productCode: cleanCode || row['상품코드'] || '',
            productName: row['상품명'] || '',
            partnerName: row['협력사명'] || '',
          }}
          existingFileIds={showPhotoType === 'insp' ? inspPhotoIds : defectPhotoIds}
          onDone={(ids) => {
            if (showPhotoType === 'insp')    updateDraft({ inspPhotoIds: ids });
            if (showPhotoType === 'defect')  updateDraft({ defectPhotoIds: ids });
            setShowPhotoType(null);
          }}
          onClose={() => setShowPhotoType(null)}
        />,
        document.body,
      )}
      {showMovement && createPortal(
        <ReturnExchangeModal
          product={{
            productCode: cleanCode || row['상품코드'] || '',
            productName: row['상품명'] || '',
            partnerName: row['협력사명'] || '',
            orderedQty,
          }}
          jobKey={jobKey}
          initialType={movementType}
          centers={centers}
          onSave={handleMovementSave}
          onClose={() => setShowMovement(false)}
        />,
        document.body,
      )}
    </>
  );
}

// ─── Design tokens ───────────────────────────────────────────────────────────

const fieldLabel = {
  margin: '0 0 3px',
  fontSize: 10, fontWeight: 600, color: C.muted2,
  letterSpacing: '0.04em', textTransform: 'uppercase',
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function Tag({ bg, color, border, children, title }) {
  return (
    <span title={title} style={{
      fontSize: 9.5, fontWeight: 700, padding: '2px 6px',
      borderRadius: radius.full, background: bg, color, border: `1px solid ${border}`,
      letterSpacing: '0.02em', whiteSpace: 'nowrap',
      cursor: title ? 'help' : 'default',
    }}>
      {children}
    </span>
  );
}

function StepperBtn({ onClick, children, 'aria-label': ariaLabel, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={primary ? 'stepper-btn stepper-btn-plus' : 'stepper-btn'}
      style={{
        width: 32, height: 36, border: 'none', cursor: 'pointer',
        background: C.bgAlt,
        borderRight: primary ? 'none' : `1px solid ${C.border}`,
        borderLeft:  primary ? `1px solid ${C.border}` : 'none',
        color: primary ? C.primary : C.muted,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: trans, flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function PhotoTypeBtn({ label, count, color, bg, border, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="action-btn"
      style={{
        height: 28, padding: '0 8px',
        background: count > 0 ? bg : C.bgAlt,
        color: count > 0 ? color : C.muted2,
        border: `1px solid ${count > 0 ? border : C.border}`,
        borderRadius: radius.sm, fontSize: 10.5, fontWeight: 600,
        cursor: 'pointer', fontFamily: font.base,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3,
        transition: trans, flexShrink: 0, whiteSpace: 'nowrap', minWidth: 60,
      }}
    >
      <Camera size={9} strokeWidth={2} />
      {label}
      {count > 0 && (
        <span style={{
          fontSize: 9, fontWeight: 800, background: color, color: '#fff',
          borderRadius: '50%', width: 14, height: 14,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          marginLeft: 1,
        }}>
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}

function MovBtn({ icon, label, color, bg, border, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="action-btn"
      style={{
        height: 30, padding: '0 12px', minWidth: 58,
        background: bg, color, border: `1px solid ${border}`,
        borderRadius: radius.sm, fontSize: 12, fontWeight: 600,
        cursor: 'pointer', fontFamily: font.base,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        transition: trans, flexShrink: 0,
      }}
    >
      {icon}{label}
    </button>
  );
}

function buildInspRow(row, jobKey, draft) {
  const cleanCode = normalizeProductCode(row['상품코드']) || '';
  // Combine inspection + defect photos into one field
  const inspIds   = (draft.inspPhotoIds || draft.photoFileIds || []).filter(Boolean);
  const defectIds = (draft.defectPhotoIds ||
    [...(draft.returnPhotoIds || []), ...(draft.exchangePhotoIds || [])]).filter(Boolean);
  const allPhotoIds = [...new Set([...inspIds, ...defectIds])];
  return {
    type: 'inspection',
    '작업기준일또는CSV식별값': jobKey,
    '상품코드':  cleanCode,
    '상품명':    row['상품명']    || '',
    '협력사명':  row['협력사명']  || '',
    '발주수량':  String(row['발주수량'] || 0),
    '검품수량':  String(parseInt(draft.inspQty, 10) || 0),
    '불량사유':  draft.defectReason || '',
    '사진파일ID목록': allPhotoIds.join('\n'),
    'BRIX최저': draft.brixMin || '',
    'BRIX최고': draft.brixMax || '',
    'BRIX평균': draft.brixAvg || '',
  };
}

// ── EOF ──