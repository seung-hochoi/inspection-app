import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Minus, Plus, ImagePlus, Truck, ArrowLeftRight,
         CheckCircle2, AlertTriangle, Loader2, AlertCircle, ShieldAlert, Camera } from 'lucide-react';
import { C, radius, font, shadow, trans } from './styles';
import PhotoUploader from './PhotoUploader';
import ReturnExchangeModal from './ReturnExchangeModal';
import { saveBatch, saveProductImageMapping } from '../api';
import { normalizeProductCode, fileToBase64 } from '../utils';
import { buildInspPayload, buildMovPayload, buildDraftFingerprint } from '../savePayload';

// ProductRow is memoized: all callback props are stable useCallbacks; draft and
// saveStatus are per-key values that only change for the specific product that saved.
// Default shallow comparison correctly skips re-renders for unaffected products.
const ProductRow = React.memo(function ProductRow({
  row, jobKey, draft = {}, onDraftChange, onSaved, onMovementSaved, onError, onSaveError,
  saveStatus, highlight, centers = [], happycallRanks = null, eventName = '',
  productImageMap = {}, onProductImageUploaded, accumulatedQty = 0,
  returnCount = 0, exchangeCount = 0, returnQty = 0, exchangeQty = 0,
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
  // Rate limiter: track the wall-clock time of the last save attempt to prevent
  // saves firing faster than once per 2 seconds regardless of other guards.
  const lastSaveAttemptTimeRef = useRef(0);
  // Count consecutive versionConflict responses for this row.
  // If it exceeds the threshold, we stop retrying silently and surface an error
  // instead of looping indefinitely.
  const versionConflictCountRef = useRef(0);
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

    // Rate limiter: never fire more than once per 2 s for the same row, regardless
    // of other guards.  Prevents timer-collision loops from versionConflict retries.
    const now = Date.now();
    if (now - lastSaveAttemptTimeRef.current < 2000) {
      pendingSaveRef.current = true;
      return;
    }

    const draftSnapshot = latestDraftRef.current;
    // Duplicate-save guard: skip if value matches last successfully saved state
    const fingerprint = buildDraftFingerprint(draftSnapshot);
    if (fingerprint === lastSavedFingerprintRef.current) return;

    inFlightRef.current = true;
    lastSaveAttemptTimeRef.current = now;
    try {
      const result = await saveBatch([buildInspPayload(row, jobKey, draftSnapshot)]);
      const conflicts = result?.data?.conflicts;

      if (conflicts && conflicts.length > 0) {
        const conflict = conflicts[0];
        if (conflict.conflictType === 'editorConflict' || conflict.conflictType === 'legacyConflict') {
          // A different user/session has the most recent save — genuine conflict
          // legacyConflict: an old-app client tried to overwrite this new-app row
          versionConflictCountRef.current = 0;
          setIsConflict(true);
          onError?.('충돌: 다른 사용자가 이미 저장했습니다. 🔄 새로고침 후 다시 입력해 주세요.');
          onSaveError?.(productKey);
        } else {
          // versionConflict — stale expected version (e.g. after page refresh or
          // first save on a row previously written by an older app version).
          // Clear the stale tokens and schedule ONE clean retry after 500 ms.
          //
          // IMPORTANT: clear pendingSaveRef BEFORE returning so the finally block
          // does not schedule a competing second timer that causes an infinite loop
          // when the two timers keep setting pendingSaveRef on each other.
          versionConflictCountRef.current += 1;
          if (versionConflictCountRef.current > 3) {
            // Too many consecutive versionConflicts — surface the error instead of
            // silently retrying forever.
            versionConflictCountRef.current = 0;
            setIsConflict(true);
            onError?.('버전 충돌이 반복됩니다. 🔄 새로고침 후 다시 시도해 주세요.');
            onSaveError?.(productKey);
          } else {
            pendingSaveRef.current = false; // ← prevents finally from adding a 2nd timer
            onDraftChange?.(productKey, {
              ...latestDraftRef.current,
              serverVersion: undefined,
              serverUpdatedAt: undefined,
            }, { silent: true });
            saveTimerRef.current = setTimeout(() => runSaveRef.current?.(), 500);
          }
        }
        return;
      }

      // ── Save succeeded ────────────────────────────────────────────────────
      versionConflictCountRef.current = 0;

      // Set the fingerprint FIRST so any pending follow-up save that fires
      // before the React state update propagates will hit the duplicate guard.
      lastSavedFingerprintRef.current = fingerprint;

      // Persist server version/updatedAt so next save can detect concurrent conflicts.
      // Use { silent: true } so handleDraftChange does NOT set saveStatuses='saving'
      // — that spurious transition triggers unnecessary PartnerGroup re-renders.
      const savedRow = result?.data?.inspectionRows?.[0];
      if (savedRow && !savedRow.__conflict) {
        const serverVersion   = Number(savedRow['버전']    || 0);
        const serverUpdatedAt = String(savedRow['수정일시'] || '');
        if (serverVersion || serverUpdatedAt) {
          onDraftChange?.(productKey, {
            ...latestDraftRef.current, // use ref, not stale draftSnapshot
            serverVersion,
            serverUpdatedAt,
          }, { silent: true });
        }
      }

      onSaved?.(productKey);
    } catch (err) {
      onError?.(err.message || '저장 실패');
      onSaveError?.(productKey);
    } finally {
      inFlightRef.current = false;
      // Fire one follow-up save if the draft changed while this request was in-flight.
      // NOTE: the versionConflict branch clears pendingSaveRef before returning so
      // this block does NOT fire a competing timer alongside the retry timer.
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
    const result = await saveBatch([
      buildMovPayload(row, jobKey, {
        type, centerName, qty, note,
        centerList: row.__centerList || [],
      }),
    ]);
    // Pass fresh records back so InspectionPage can update records tab without a full reload.
    // freshRecords is injected by the backend when movement rows were saved successfully.
    onMovementSaved?.(result?.data?.freshRecords);
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
                count={returnCount}
                onClick={() => { setMovementType('RETURN'); setShowMovement(true); }}
              />
              <MovBtn
                icon={<ArrowLeftRight size={11} strokeWidth={2} />} label="교환"
                color={C.orange} bg={C.orangeLight} border={C.orangeMid}
                count={exchangeCount}
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
          returnQty={returnQty}
          exchangeQty={exchangeQty}
          onSave={handleMovementSave}
          onClose={() => setShowMovement(false)}
        />,
        document.body,
      )}
    </>
  );
});

export default ProductRow;

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

// PhotoSlot: button with inline Drive thumbnail, per-photo delete, and always-visible count badge.
// All PhotoSlot buttons are the same fixed size regardless of photo category so the
// action row fits on mobile without any button being clipped.
// compact prop is accepted but ignored for sizing (kept for call-site compatibility).
function PhotoSlot({ label, fileIds = [], color, bg, border, onClick, onDeletePhoto, compact = false }) { // eslint-disable-line no-unused-vars
  // Show at most 1 thumbnail inside the button so width stays fixed.
  // The count badge communicates the total; the +N overflow badge is omitted
  // because it would widen the button. Users open the modal to see all photos.
  const MAX_THUMBS = 1;
  const thumbs    = fileIds.slice(0, MAX_THUMBS);
  const hasPhotos = fileIds.length > 0;
  const count     = fileIds.length;

  // Shared fixed dimensions — same for every action button in the row.
  const BTN_H  = 32;
  const BTN_FS = 12;
  const BTN_PX = '0 8px';

  return (
    <button
      type="button"
      onClick={onClick}
      className="action-btn"
      style={{
        height: BTN_H, padding: BTN_PX,
        background: hasPhotos ? bg : C.bgAlt,
        color: hasPhotos ? color : C.muted2,
        border: `1px solid ${hasPhotos ? border : C.border}`,
        borderRadius: radius.sm, fontSize: BTN_FS, fontWeight: 600,
        cursor: 'pointer', fontFamily: font.base,
        display: 'inline-flex', alignItems: 'center', gap: 4,
        transition: trans, flex: '0 0 auto', whiteSpace: 'nowrap',
      }}
    >
      <ImagePlus size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span>{label}</span>
      {/* Always-visible count badge — immediately reflects local + server state */}
      <span style={{
        fontSize: 9, fontWeight: 800,
        padding: '0 4px',
        borderRadius: radius.full,
        background: hasPhotos ? color  : C.border,
        color: hasPhotos ? '#fff' : C.muted2,
        minWidth: 16, height: 14,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        letterSpacing: '-0.01em',
      }}>
        {count}
      </span>
      {/* Single thumbnail — max 1 to keep button at fixed width */}
      {thumbs.map((id) => (
        <span key={id} style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}>
          <img
            src={`https://drive.google.com/thumbnail?id=${id}&sz=w40`}
            alt=""
            style={{
              width: 16, height: 16, borderRadius: 3,
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
    </button>
  );
}

function MovBtn({ icon, label, color, bg, border, onClick, count = 0 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="action-btn"
      style={{
        height: 32, padding: '0 8px',
        background: count > 0 ? bg : C.bgAlt,
        color: count > 0 ? color : C.muted2,
        border: `1px solid ${count > 0 ? border : C.border}`,
        borderRadius: radius.sm, fontSize: 12, fontWeight: 600,
        cursor: 'pointer', fontFamily: font.base,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        transition: trans, flex: '0 0 auto', whiteSpace: 'nowrap',
      }}
    >
      {icon}{label}
      {/* Entry count badge — shows how many records are already saved */}
      {count > 0 && (
        <span style={{
          fontSize: 9, fontWeight: 800,
          background: color, color: '#fff',
          borderRadius: radius.full, minWidth: 14, height: 14, padding: '0 2px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── EOF ──