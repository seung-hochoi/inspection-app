import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Minus, Plus, ImagePlus, Truck, ArrowLeftRight,
         CheckCircle2, AlertTriangle, Loader2, AlertCircle, ShieldAlert, Camera } from 'lucide-react';
import { C, radius, font, shadow, trans } from './styles';
import PhotoUploader from './PhotoUploader';
import ReturnExchangeModal from './ReturnExchangeModal';
import { saveBatch, saveProductImageMapping } from '../api';
import { normalizeProductCode, fileToBase64, getClientId } from '../utils';

// ProductRow is memoized: all callback props are stable useCallbacks; draft and
// saveStatus are per-key values that only change for the specific product that saved.
// Default shallow comparison correctly skips re-renders for unaffected products.
const ProductRow = React.memo(function ProductRow({
  row, jobKey, draft = {}, onDraftChange, onSaved, onMovementSaved, onError, onSaveError,
  saveStatus, highlight, centers = [], happycallRanks = null, eventName = '',
  productImageMap = {}, onProductImageUploaded, accumulatedQty = 0,
}) {
  // 'insp' = 검품사진, 'defect' = 불량사진 (return+exchange combined)
  const [showPhotoType, setShowPhotoType] = useState(null);
  const [showMovement, setShowMovement]   = useState(false);
  const [movementType, setMovementType]   = useState('RETURN');
  const [isConflict, setIsConflict]       = useState(false);
  const [thumbUploading, setThumbUploading] = useState(false);
  const saveTimerRef   = useRef(null);
  const latestDraftRef = useRef(draft);
  const inFlightRef    = useRef(false);
  const pendingSaveRef = useRef(false);
  const runSaveRef     = useRef(null);
  const thumbInputRef  = useRef(null);
  // Fingerprint of the last value that was successfully persisted to the server.
  // If the current draft matches it exactly, the scheduled save is skipped.
  const lastSavedFingerprintRef = useRef(null);
  latestDraftRef.current = draft;  // always up-to-date even in stale closures

  const cleanCode    = normalizeProductCode(row['상품코드']) || '';
  const productKey   = `${jobKey}||${cleanCode}||${row['협력사명'] || ''}`;
  const inspQty      = draft.inspQty !== undefined ? draft.inspQty : '';
  // defectReason is kept in draft/payload but editing moved to return/exchange modal
  const defectReason = draft.defectReason || '';
  // Photo ID arrays per category
  const inspPhotoIds   = draft.inspPhotoIds   || draft.photoFileIds || [];
  const defectPhotoIds = draft.defectPhotoIds ||
    [...(draft.returnPhotoIds || []), ...(draft.exchangePhotoIds || [])];
  const weightPhotoIds = draft.weightPhotoIds || [];
  const brixPhotoIds   = draft.brixPhotoIds   || [];

  // Representative thumbnail for this product (separate from inspection photos)
  const thumbItem = productImageMap[cleanCode];
  const thumbUrl  = thumbItem?.['파일ID']
    ? `https://drive.google.com/thumbnail?id=${thumbItem['파일ID']}&sz=w120`
    : null;

  const handleThumbUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !cleanCode) return;
    setThumbUploading(true);
    try {
      const photo = await fileToBase64(file);
      const result = await saveProductImageMapping({
        productCode: cleanCode,
        partnerName: row['협력사명'] || '',
        productName: row['상품명'] || '',
        photo,
      });
      onProductImageUploaded?.(cleanCode, result.data || result);
    } catch (err) {
      onError?.(`대표 이미지 업로드 실패: ${err.message}`);
    } finally {
      setThumbUploading(false);
      if (thumbInputRef.current) thumbInputRef.current.value = '';
    }
  }, [cleanCode, row, onProductImageUploaded, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  // runSaveRef is re-assigned on every render so the closure is always fresh —
  // this avoids stale-closure bugs without listing every variable in useCallback deps.
  runSaveRef.current = async () => {
    // In-flight guard: if a request is already pending, queue one follow-up
    if (inFlightRef.current) {
      pendingSaveRef.current = true;
      return;
    }
    const draftSnapshot = latestDraftRef.current;
    // Duplicate-save guard: skip if value matches last successfully saved state
    const fingerprint = buildDraftFingerprint(draftSnapshot);
    if (fingerprint === lastSavedFingerprintRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await saveBatch([buildInspRow(row, jobKey, draftSnapshot)]);
      const conflicts = result?.data?.conflicts;

      if (conflicts && conflicts.length > 0) {
        const conflict = conflicts[0];
        if (conflict.conflictType === 'editorConflict' || conflict.conflictType === 'legacyConflict') {
          // A different user/session has the most recent save — genuine conflict
          // legacyConflict: an old-app client tried to overwrite this new-app row
          setIsConflict(true);
          onError?.('충돌: 다른 사용자가 이미 저장했습니다. 🔄 새로고침 후 다시 입력해 주세요.');
          onSaveError?.(productKey);
        } else {
          // versionConflict — stale expected version (e.g. after page refresh).
          // Clear the stale server version and schedule a clean retry — no error shown.
          onDraftChange?.(productKey, {
            ...latestDraftRef.current,
            serverVersion: undefined,
            serverUpdatedAt: undefined,
          });
          saveTimerRef.current = setTimeout(() => runSaveRef.current?.(), 400);
        }
        return;
      }

      // Persist server version/updatedAt so next save can detect concurrent conflicts
      const savedRow = result?.data?.inspectionRows?.[0];
      if (savedRow && !savedRow.__conflict) {
        const serverVersion   = Number(savedRow['버전']    || 0);
        const serverUpdatedAt = String(savedRow['수정일시'] || '');
        if (serverVersion || serverUpdatedAt) {
          onDraftChange?.(productKey, {
            ...latestDraftRef.current, // use ref, not stale draftSnapshot
            serverVersion,
            serverUpdatedAt,
          });
        }
      }

      onSaved?.(productKey);
      lastSavedFingerprintRef.current = fingerprint;
    } catch (err) {
      onError?.(err.message || '저장 실패');
      onSaveError?.(productKey);
    } finally {
      inFlightRef.current = false;
      // Fire one follow-up save if the draft changed while this request was in-flight
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        saveTimerRef.current = setTimeout(() => runSaveRef.current?.(), 300);
      }
    }
  };

  // Stable debounce wrapper — no deps needed because the actual work lives in runSaveRef
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => runSaveRef.current?.(), 500);
  }, []);

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  // Clear the conflict indicator whenever the server status clears back to idle
  useEffect(() => {
    if (saveStatus === 'idle') setIsConflict(false);
  }, [saveStatus]);

  const updateDraft = useCallback((patch) => {
    setIsConflict(false);  // editing after a conflict resets the indicator
    const next = { ...latestDraftRef.current, ...patch };
    onDraftChange?.(productKey, next);
    scheduleSave();
  }, [productKey, onDraftChange, scheduleSave]);

  const handleQtyChange = (val) => {
    const clean = String(val).replace(/\D/g, '');
    updateDraft({ inspQty: clean });
  };
  const handleQtyBlur = () => {
    if (inspQty === '' || inspQty === undefined) handleQtyChange('0');
  };

  // Delete a single photo ID from a specific photo category
  const deletePhoto = (type, id) => {
    const curr =
      type === 'insp'   ? inspPhotoIds   :
      type === 'defect' ? defectPhotoIds :
      type === 'weight' ? weightPhotoIds :
      type === 'brix'   ? brixPhotoIds   : [];
    const key =
      type === 'insp'   ? 'inspPhotoIds'   :
      type === 'defect' ? 'defectPhotoIds' :
      type === 'weight' ? 'weightPhotoIds' :
      type === 'brix'   ? 'brixPhotoIds'   : null;
    if (key) updateDraft({ [key]: curr.filter((x) => x !== id) });
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
      '수주수량':  String(row.__centerList?.find((c) => c.name === centerName)?.qty ?? 0),
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

  const rowBg = highlight ? '#fefce8' : isDone ? '#f8fffb' : hasDefect ? '#fffbf5' : C.card;

  const hcRank   = happycallRanks?.['7d']?.rank   ?? happycallRanks?.['30d']?.rank   ?? null;
  const hcReason = happycallRanks?.['7d']?.reason || happycallRanks?.['30d']?.reason || '';

  return (
    <>
      <div
        style={{
          display: 'flex', background: rowBg, borderBottom: `1px solid ${C.border}`,
          contentVisibility: 'auto',
          containIntrinsicSize: '0 120px',
        }}
      >
        {/* Left accent bar — live color reflects completion / save state */}
        <div style={{ width: 4, flexShrink: 0, background: accentColor, transition: 'background 0.3s' }} />

        <div style={{ flex: 1, padding: '11px 14px 11px 11px', minWidth: 0 }}>

          {/* ── Row 1: Product identity + status / tag chips ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>

            {/* Representative product thumbnail */}
            <div
              style={{
                position: 'relative', flexShrink: 0,
                width: 46, height: 46, borderRadius: radius.sm,
                overflow: 'hidden',
                border: `1px solid ${C.border}`,
                background: C.bgAlt,
                cursor: 'pointer',
              }}
              title="대표 이미지 변경"
              onClick={() => thumbInputRef.current?.click()}
            >
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={row['상품명'] || ''}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                  loading="lazy"
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {thumbUploading
                    ? <Loader2 size={14} color={C.muted2} style={{ animation: 'spin 1s linear infinite' }} />
                    : <Camera size={14} color={C.muted2} strokeWidth={1.5} />}
                </div>
              )}
              {/* Camera overlay button */}
              {!thumbUploading && (
                <div style={{
                  position: 'absolute', bottom: 2, right: 2,
                  width: 16, height: 16, borderRadius: '50%',
                  background: 'rgba(15,23,42,0.55)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Camera size={9} color="#fff" strokeWidth={2} />
                </div>
              )}
              <input
                ref={thumbInputRef}
                type="file" accept="image/*"
                style={{ display: 'none' }}
                onChange={handleThumbUpload}
              />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                margin: '0 0 2px', fontSize: 13.5, fontWeight: 700, color: C.text,
                letterSpacing: '-0.015em', lineHeight: 1.3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {row['상품명'] || '—'}
              </p>
              <p style={{
                margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <span style={{ fontFamily: "'Menlo','Consolas',monospace", letterSpacing: '-0.01em' }}>
                  {cleanCode}
                </span>
                {row['협력사명'] && <span style={{ color: C.muted2 }}> · {row['협력사명']}</span>}
                {orderedQty > 0 && <span style={{ color: C.muted2 }}> · 발주 {orderedQty}</span>}
              </p>
            </div>
            {/* Tags + animated save-status badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {eventName && <Tag bg={C.orangeLight} color={C.orange} border={C.orangeMid}>{eventName}</Tag>}
              {hcRank && (
                <Tag bg={C.redLight} color={C.red} border={C.redMid} title={hcReason || undefined}>
                  TOP.{hcRank}
                </Tag>
              )}
              <SaveStatusBadge
                saveStatus={saveStatus}
                isDone={isDone}
                hasDefect={hasDefect}
                isConflict={isConflict}
              />
            </div>
          </div>

          {/* ── Row 2: Qty · result chip · defect reason · photos · movement ── */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7, flexWrap: 'wrap' }}>

            {/* 검품수량 stepper */}
            <div style={{
              display: 'flex', alignItems: 'stretch', flexShrink: 0,
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
                onFocus={() => { if (inspQty === '0') handleQtyChange(''); }}
                onBlur={handleQtyBlur}
                placeholder="0"
                style={{
                  width: 52, height: 36, textAlign: 'center', border: 'none',
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

            {/* Done chip — shown only when fully inspected */}
            {isDone && (
              <div style={{
                height: 36, padding: '0 10px', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', gap: 5,
                borderRadius: radius.sm,
                background: C.greenLight,
                border: `1.5px solid ${C.greenMid}`,
                fontSize: 12, fontWeight: 700,
                color: C.green,
              }}>
                <CheckCircle2 size={13} strokeWidth={2.5} />
                완료
              </div>
            )}

            {/* 불량 사유 — removed from inline row; entered via 회송/교환 modal */}

            {/* Photos + movement actions — pushed to far right */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              {/* Primary photo slots: 검품 + 불량 — higher usage, show up to 3 thumbs */}
              <PhotoSlot
                label="검품" fileIds={inspPhotoIds}
                color={C.primary} bg={C.primaryLight} border={C.primaryMid}
                onClick={() => setShowPhotoType('insp')}
                onDeletePhoto={(id) => deletePhoto('insp', id)}
              />
              <PhotoSlot
                label="불량" fileIds={defectPhotoIds}
                color={C.red} bg={C.redLight} border={C.redMid}
                onClick={() => setShowPhotoType('defect')}
                onDeletePhoto={(id) => deletePhoto('defect', id)}
              />
              {/* Compact photo slots: 중량 + 당도 — lower usage, 1 thumb max */}
              <PhotoSlot
                label="중량" fileIds={weightPhotoIds}
                color={C.muted} bg={C.bgAlt} border={C.borderMid}
                onClick={() => setShowPhotoType('weight')}
                onDeletePhoto={(id) => deletePhoto('weight', id)}
                compact
              />
              <PhotoSlot
                label="당도" fileIds={brixPhotoIds}
                color={C.muted} bg={C.bgAlt} border={C.borderMid}
                onClick={() => setShowPhotoType('brix')}
                onDeletePhoto={(id) => deletePhoto('brix', id)}
                compact
              />
              <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0 }} />
              <MovBtn
                icon={<Truck size={11} strokeWidth={2} />} label="회송"
                color={C.red} bg={C.redLight} border={C.redMid}
                onClick={() => { setMovementType('RETURN'); setShowMovement(true); }}
              />
              <MovBtn
                icon={<ArrowLeftRight size={11} strokeWidth={2} />} label="교환"
                color={C.orange} bg={C.orangeLight} border={C.orangeMid}
                onClick={() => { setMovementType('EXCHANGE'); setShowMovement(true); }}
              />
            </div>

          </div>
        </div>
      </div>

      {/* ── Modals: rendered via portal to avoid overflow/transform clipping ── */}
      {showPhotoType && createPortal(
        <PhotoUploader
          jobKey={jobKey}
          product={{
            productCode: cleanCode || row['상품코드'] || '',
            productName: row['상품명'] || '',
            partnerName: row['협력사명'] || '',
          }}
          existingFileIds={
            showPhotoType === 'insp'   ? inspPhotoIds   :
            showPhotoType === 'defect' ? defectPhotoIds :
            showPhotoType === 'weight' ? weightPhotoIds :
            showPhotoType === 'brix'   ? brixPhotoIds   : []
          }
          onDone={(ids) => {
            if (showPhotoType === 'insp')   updateDraft({ inspPhotoIds: ids });
            if (showPhotoType === 'defect') updateDraft({ defectPhotoIds: ids });
            if (showPhotoType === 'weight') updateDraft({ weightPhotoIds: ids });
            if (showPhotoType === 'brix')   updateDraft({ brixPhotoIds: ids });
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
          centers={
            row.__centerList?.length
              ? row.__centerList
              : centers.map((c) => ({ name: c, qty: 0 }))
          }
          accumulatedQty={accumulatedQty}
          onSave={handleMovementSave}
          onClose={() => setShowMovement(false)}
        />,
        document.body,
      )}
    </>
  );
});

export default ProductRow;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Produces a cheap string fingerprint of all save-relevant draft fields.
// Two calls with equal content return the same string, allowing the save guard
// to skip requests when nothing actually changed since the last successful save.
function buildDraftFingerprint(d) {
  return [
    d.inspQty     || '',
    d.defectReason || '',
    d.brixMin     || '',
    d.brixMax     || '',
    d.brixAvg     || '',
    (d.inspPhotoIds   || []).join(','),
    (d.defectPhotoIds || []).join(','),
    (d.weightPhotoIds || []).join(','),
    (d.brixPhotoIds   || []).join(','),
  ].join('|');
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// Animated chip showing save state, completion, or defect quality result.
function SaveStatusBadge({ saveStatus, isDone, hasDefect, isConflict }) {
  const state =
    isConflict              ? 'conflict' :
    saveStatus === 'saving' ? 'saving'   :
    saveStatus === 'saved'  ? 'saved'    :
    saveStatus === 'error'  ? 'error'    :
    isDone                  ? 'done'     :
    hasDefect               ? 'defect'   : null;

  if (!state) return null;

  const MAP = {
    saving:   { text: '저장 중', icon: <Loader2      size={10} strokeWidth={2.5} style={{ animation: 'spin 1s linear infinite' }} />, bg: C.yellowLight, color: C.yellow,  border: C.yellowMid },
    saved:    { text: '저장됨',  icon: <CheckCircle2  size={10} strokeWidth={2.5} />, bg: C.greenLight,  color: C.green,   border: C.greenMid  },
    error:    { text: '실패',    icon: <AlertCircle   size={10} strokeWidth={2.5} />, bg: C.redLight,    color: C.red,     border: C.redMid    },
    conflict: { text: '충돌',    icon: <ShieldAlert   size={10} strokeWidth={2.5} />, bg: '#faf5ff',     color: '#7c3aed', border: '#ddd6fe'   },
    done:     { text: '완료',    icon: <CheckCircle2  size={10} strokeWidth={2.5} />, bg: C.greenLight,  color: C.green,   border: C.greenMid  },
    defect:   { text: '불량',    icon: <AlertTriangle size={10} strokeWidth={2.5} />, bg: C.orangeLight, color: C.orange,  border: C.orangeMid },
  };
  const s = MAP[state];
  return (
    <motion.span
      key={state}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15 }}
      style={{
        fontSize: 10, fontWeight: 700, padding: '2px 6px',
        borderRadius: radius.full,
        background: s.bg, color: s.color, border: `1px solid ${s.border}`,
        letterSpacing: '0.02em', whiteSpace: 'nowrap',
        display: 'inline-flex', alignItems: 'center', gap: 3,
      }}
    >
      {s.icon}
      {s.text}
    </motion.span>
  );
}

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

// PhotoSlot: button with inline Drive thumbnails, per-photo delete, and compact mode.
// compact=true → smaller height, 1 thumb max (used for 중량/당도).
// compact=false (default) → full size, up to 3 thumbs (used for 검품/불량).
function PhotoSlot({ label, fileIds = [], color, bg, border, onClick, onDeletePhoto, compact = false }) {
  const MAX_THUMBS = compact ? 1 : 3;
  const thumbs   = fileIds.slice(0, MAX_THUMBS);
  const overflow = fileIds.length - thumbs.length;
  const hasPhotos = fileIds.length > 0;
  const height    = compact ? 28 : 30;
  const fontSize  = compact ? 9.5 : 10.5;
  const thumbSize = compact ? 15 : 18;

  return (
    <button
      type="button"
      onClick={onClick}
      className="action-btn"
      style={{
        height, padding: compact ? '0 6px' : '0 8px',
        background: hasPhotos ? bg : C.bgAlt,
        color: hasPhotos ? color : C.muted2,
        border: `1px solid ${hasPhotos ? border : C.border}`,
        borderRadius: radius.sm, fontSize, fontWeight: compact ? 500 : 600,
        cursor: 'pointer', fontFamily: font.base,
        display: 'inline-flex', alignItems: 'center', gap: compact ? 3 : 4,
        transition: trans, flexShrink: 0, whiteSpace: 'nowrap',
      }}
    >
      <ImagePlus size={compact ? 10 : 11} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span>{label}</span>
      {thumbs.map((id) => (
        <span key={id} style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}>
          <img
            src={`https://drive.google.com/thumbnail?id=${id}&sz=w40`}
            alt=""
            style={{
              width: thumbSize, height: thumbSize, borderRadius: 3,
              objectFit: 'cover', display: 'block',
              border: `1px solid ${border}`,
            }}
            onError={(e) => { if (e.currentTarget.parentElement) e.currentTarget.parentElement.style.display = 'none'; }}
          />
          {onDeletePhoto && (
            <span
              role="button"
              tabIndex={0}
              title="삭제"
              onClick={(e) => { e.stopPropagation(); onDeletePhoto(id); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onDeletePhoto(id); }
              }}
              style={{
                position: 'absolute', top: -4, right: -4,
                width: 13, height: 13,
                background: '#ef4444', color: '#fff', borderRadius: '50%',
                fontSize: 9, fontWeight: 900, lineHeight: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', border: '1.5px solid #fff',
                userSelect: 'none',
              }}
            >
              ×
            </span>
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span style={{
          fontSize: 9, fontWeight: 800, background: color, color: '#fff',
          borderRadius: radius.full, minWidth: 16, height: 16, padding: '0 3px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          +{overflow}
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
        height: 30, padding: '0 10px',
        background: bg, color, border: `1px solid ${border}`,
        borderRadius: radius.sm, fontSize: 11, fontWeight: 600,
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
  const weightIds = (draft.weightPhotoIds || []).filter(Boolean);
  const brixIds   = (draft.brixPhotoIds   || []).filter(Boolean);
  const allPhotoIds = [...new Set([...inspIds, ...defectIds, ...weightIds, ...brixIds])];
  const payload = {
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
  // Include server version/updatedAt so backend can detect concurrent conflicts
  if (draft.serverVersion)    payload.expectedVersion    = draft.serverVersion;
  if (draft.serverUpdatedAt)  payload.expectedUpdatedAt  = draft.serverUpdatedAt;
  // Stable session ID — backend uses this to allow same-user re-saves without version gating
  payload.clientId = getClientId();
  return payload;
}

// ── EOF ──