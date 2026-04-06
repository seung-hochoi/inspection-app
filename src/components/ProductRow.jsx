import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Minus, Plus, ImagePlus, Truck, ArrowLeftRight,
         CheckCircle2, AlertTriangle, Loader2, AlertCircle, Camera,
         X as XIcon, Eye } from 'lucide-react';
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
  canEditInspection = true, canUploadPhoto = true, canEditReturnExchange = true,
}) {
  // 'insp' = 검품사진, 'defect' = 불량사진 (return+exchange combined)
  const [showPhotoType, setShowPhotoType] = useState(null);
  const [showMovement, setShowMovement]   = useState(false);
  const [movementType, setMovementType]   = useState('RETURN');
  const [isExpanded, setIsExpanded]       = useState(false);
  const [lightboxId, setLightboxId]       = useState(null);
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

  // Stable centers list for ReturnExchangeModal: row.__centerList takes precedence;
  // the fallback maps the string array to { name, qty } objects. Memoized so the
  // modal doesn't see a new array reference on every parent render.
  const centersList = useMemo(
    () => row.__centerList?.length
      ? row.__centerList
      : centers.map((c) => ({ name: c, qty: 0 })),
    [row.__centerList, centers],
  );

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
    // Capture which deletions are included in THIS payload before going async.
    // Used after success to clear only the IDs that were actually sent,
    // preserving any new deletions that arrive while the request is in-flight.
    const sentDeletionSet = new Set(draftSnapshot.deletedPhotoIds || []);
    // Duplicate-save guard: skip if value matches last successfully saved state
    const fingerprint = buildDraftFingerprint(draftSnapshot);
    if (fingerprint === lastSavedFingerprintRef.current) return;

    inFlightRef.current = true;
    lastSaveAttemptTimeRef.current = now;
    try {
      const result = await saveBatch([buildInspPayload(row, jobKey, draftSnapshot)]);

      // ── Save succeeded ────────────────────────────────────────────────────

      // Set the fingerprint FIRST so any pending follow-up save that fires
      // before the React state update propagates will hit the duplicate guard.
      lastSavedFingerprintRef.current = fingerprint;

      // Re-hydrate per-category photo IDs from the save response
      // so the action-button counts stay correct after save.
      const savedRow = result?.data?.inspectionRows?.[0];
      if (savedRow) {
        // Never re-add IDs the user explicitly deleted — even if the server
        // echoed them back before processing the deletion.
        const deletedSet = new Set(latestDraftRef.current.deletedPhotoIds || []);

        // Merge server photo IDs with local draft to guarantee counts survive
        const hydrateIds = (field) => {
          const serverIds = String(savedRow[field] || '').split('\n').filter(Boolean);
          const localIds  = latestDraftRef.current[field] || [];
          if (!serverIds.length) return localIds.length ? localIds : undefined;
          return [...new Set([...localIds, ...serverIds])].filter((id) => !deletedSet.has(id));
        };
        const pInsp   = hydrateIds('inspPhotoIds');
        const pDefect = hydrateIds('defectPhotoIds');
        const pWeight = hydrateIds('weightPhotoIds');
        const pBrix   = hydrateIds('brixPhotoIds');

        const nextDraft = { ...latestDraftRef.current };
        if (pInsp)   nextDraft.inspPhotoIds   = pInsp;
        if (pDefect) nextDraft.defectPhotoIds = pDefect;
        if (pWeight) nextDraft.weightPhotoIds = pWeight;
        if (pBrix)   nextDraft.brixPhotoIds   = pBrix;
        // Retain ALL pending deletedPhotoIds — including those just sent — so the
        // InspectionPage hydration effect's pendingDeletedSet guard stays active.
        // If we cleared sent IDs here, a stale loadBootstrap response arriving after
        // this save would bypass the guard (pendingDeletedSet would be empty) and
        // re-add the deleted photo back into the draft.
        // Confirmed deletions are pruned by the InspectionPage hydration effect once
        // a fresh inspectionRows from the server no longer contains those IDs.
        nextDraft.deletedPhotoIds = latestDraftRef.current.deletedPhotoIds || [];

        onDraftChange?.(productKey, nextDraft, { silent: true });
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

  const updateDraft = useCallback((patch) => {
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
    if (!key) return;
    const existingDeleted = latestDraftRef.current.deletedPhotoIds || [];
    updateDraft({
      [key]: curr.filter((x) => x !== id),
      deletedPhotoIds: [...new Set([...existingDeleted, id])],
    });
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

  const orderedQty  = parseInt(row['발주수량'], 10) || 0;
  const inspNum     = parseInt(inspQty, 10) || 0;
  const defectCount = orderedQty > 0 ? Math.max(0, orderedQty - inspNum) : 0;
  // hasMovement: return or exchange records already registered for this product
  const hasMovement = returnQty > 0 || exchangeQty > 0;
  // isDone (검품): inspected with no return/exchange records → light-green card
  // hasDefect (불량): return/exchange actually registered → orange card
  const isDone    = inspNum > 0 && !hasMovement;
  const hasDefect = hasMovement;

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
      {/* ── Outer wrapper: provides shared border/bg for card + expanded preview ── */}
      <div style={{ borderBottom: `1px solid ${C.border}` }}>
        {/* ── Main card row ── */}
        <div
          style={{
            display: 'flex', background: rowBg,
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
                  cursor: canUploadPhoto ? 'pointer' : 'default',
                }}
                title={canUploadPhoto ? '대표 이미지 변경' : undefined}
                onClick={canUploadPhoto ? () => thumbInputRef.current?.click() : undefined}
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
                {canUploadPhoto && !thumbUploading && (
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
                opacity: canEditInspection ? 1 : 0.55,
              }}>
                <StepperBtn onClick={() => canEditInspection && stepQty(-1)} aria-label="감소" disabled={!canEditInspection}>
                  <Minus size={12} strokeWidth={2.5} />
                </StepperBtn>
                <input
                  type="text" inputMode="numeric" aria-label="검품수량"
                  value={inspQty}
                  onChange={(e) => canEditInspection && handleQtyChange(e.target.value)}
                  onFocus={() => { if (canEditInspection && inspQty === '0') handleQtyChange(''); }}
                  onBlur={() => canEditInspection && handleQtyBlur()}
                  readOnly={!canEditInspection}
                  placeholder="0"
                  style={{
                    width: 52, height: 36, textAlign: 'center', border: 'none',
                    fontSize: 16, fontWeight: 800,
                    color: isDone ? C.green : hasDefect ? C.orange : C.text,
                    fontFamily: font.base, outline: 'none', background: 'transparent',
                    letterSpacing: '-0.02em',
                    cursor: canEditInspection ? 'text' : 'default',
                  }}
                />
                <StepperBtn onClick={() => canEditInspection && stepQty(1)} aria-label="증가" primary disabled={!canEditInspection}>
                  <Plus size={12} strokeWidth={2.5} />
                </StepperBtn>
              </div>

              {/* 검품 chip — shown when inspected with no return/exchange records */}
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
                  검품
                </div>
              )}

              {/* 불량 사유 — removed from inline row; entered via 회송/교환 modal */}

              {/* Photos + movement actions — pushed to far right (desktop), full-width 2-row on mobile */}
              <div className="action-btn-row" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                {/* Primary photo slots: 검품 + 불량 — higher usage, show up to 3 thumbs */}
                {canUploadPhoto && (
                  <>
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
                    <div className="action-separator" style={{ width: 1, height: 20, background: C.border, flexShrink: 0 }} />
                  </>
                )}
                {canEditReturnExchange && (
                  <>
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
                  </>
                )}
                {/* Expand / collapse photo preview toggle */}
                <button
                  type="button"
                  onClick={() => setIsExpanded((v) => !v)}
                  className="action-btn"
                  title={isExpanded ? '미리보기 닫기' : '사진 미리보기'}
                  style={{
                    height: 32, width: 32, padding: 0,
                    background: isExpanded ? C.primaryLight : C.bgAlt,
                    color: isExpanded ? C.primary : C.muted2,
                    border: `1px solid ${isExpanded ? C.primaryMid : C.border}`,
                    borderRadius: radius.sm, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    transition: trans, flex: '0 0 auto',
                  }}
                >
                  <Eye size={13} strokeWidth={2} />
                </button>
              </div>

            </div>
          </div>
        </div>

        {/* ── Expandable photo preview panel ── */}
        {isExpanded && (
          <div style={{ background: C.bgAlt, borderTop: `1px solid ${C.border}` }}>
            <div style={{ padding: '10px 14px 12px 15px' }}>
              <PhotoPreviewSection
                categories={[
                  { type: 'insp',   label: '검품사진', fileIds: inspPhotoIds,   color: C.primary, bg: C.primaryLight, border: C.primaryMid },
                  { type: 'defect', label: '불량사진', fileIds: defectPhotoIds, color: C.red,     bg: C.redLight,     border: C.redMid    },
                  { type: 'weight', label: '중량사진', fileIds: weightPhotoIds, color: C.muted,   bg: C.bgAlt,        border: C.borderMid },
                  { type: 'brix',   label: '당도사진', fileIds: brixPhotoIds,   color: C.muted,   bg: C.bgAlt,        border: C.borderMid },
                ]}
                onDeletePhoto={deletePhoto}
                onViewPhoto={(id) => setLightboxId(id)}
                onAddPhoto={(type) => setShowPhotoType(type)}
              />
            </div>
          </div>
        )}
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
          centers={centersList}
          accumulatedQty={accumulatedQty}
          returnQty={returnQty}
          exchangeQty={exchangeQty}
          onSave={handleMovementSave}
          onClose={() => setShowMovement(false)}
        />,
        document.body,
      )}
      {/* Lightbox — full-size image overlay */}
      {lightboxId && createPortal(
        <div
          onClick={() => setLightboxId(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 950,
            background: 'rgba(0,0,0,0.93)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img
            src={`https://drive.google.com/thumbnail?id=${lightboxId}&sz=w1200`}
            alt="사진 미리보기"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '92vw', maxHeight: '88vh',
              objectFit: 'contain', borderRadius: 6,
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            }}
          />
          <button
            onClick={() => setLightboxId(null)}
            style={{
              position: 'absolute', top: 14, right: 14,
              width: 38, height: 38, borderRadius: '50%',
              background: 'rgba(255,255,255,0.14)',
              border: '1px solid rgba(255,255,255,0.25)',
              cursor: 'pointer', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <XIcon size={18} strokeWidth={2.5} />
          </button>
        </div>,
        document.body,
      )}
    </>
  );
});

export default ProductRow;

// ─── Sub-components ──────────────────────────────────────────────────────────

// Animated chip showing save state, completion, or defect quality result.
function SaveStatusBadge({ saveStatus, isDone, hasDefect }) {
  const state =
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
    done:     { text: '검품',    icon: <CheckCircle2  size={10} strokeWidth={2.5} />, bg: C.greenLight,  color: C.green,   border: C.greenMid  },
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

function StepperBtn({ onClick, children, 'aria-label': ariaLabel, primary, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      className={primary ? 'stepper-btn stepper-btn-plus' : 'stepper-btn'}
      style={{
        width: 32, height: 36, border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: C.bgAlt,
        borderRight: primary ? 'none' : `1px solid ${C.border}`,
        borderLeft:  primary ? `1px solid ${C.border}` : 'none',
        color: primary ? C.primary : C.muted,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: trans, flexShrink: 0,
        opacity: disabled ? 0.45 : 1,
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
        </span>
      ))}
    </button>
  );
}

// ── PhotoPreviewSection: expanded card photo gallery with per-photo delete ──
function PhotoPreviewSection({ categories, onDeletePhoto, onViewPhoto, onAddPhoto }) {
  const hasSomething = categories.some((c) => c.fileIds.length > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!hasSomething && (
        <p style={{ margin: 0, fontSize: 12, color: C.muted, textAlign: 'center', padding: '6px 0' }}>
          업로드된 사진이 없습니다
        </p>
      )}
      {categories.map(({ type, label, fileIds, color, bg, border }) => (
        <div key={type}>
          {/* Section header: label + count badge + add button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: fileIds.length > 0 ? color : C.muted,
            }}>
              {label}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 800, padding: '0 5px',
              borderRadius: radius.full,
              background: fileIds.length > 0 ? color : C.border,
              color: fileIds.length > 0 ? '#fff' : C.muted2,
              minWidth: 16, height: 14,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {fileIds.length}
            </span>
            <button
              type="button"
              onClick={() => onAddPhoto(type)}
              style={{
                height: 22, padding: '0 7px', marginLeft: 2,
                background: bg, color: color,
                border: `1px solid ${border}`,
                borderRadius: radius.sm, fontSize: 10, fontWeight: 600,
                cursor: 'pointer', fontFamily: font.base,
                display: 'inline-flex', alignItems: 'center', gap: 3,
              }}
            >
              <ImagePlus size={10} strokeWidth={2} />
              추가
            </button>
          </div>

          {/* Thumbnail grid */}
          {fileIds.length === 0 ? (
            <p style={{ margin: 0, fontSize: 11, color: C.muted2 }}>사진 없음</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {fileIds.map((id) => (
                <div
                  key={id}
                  style={{ position: 'relative', flexShrink: 0, width: 64, height: 64, overflow: 'visible' }}
                >
                  <img
                    src={`https://drive.google.com/thumbnail?id=${id}&sz=w120`}
                    alt=""
                    onClick={() => onViewPhoto(id)}
                    style={{
                      width: 64, height: 64, objectFit: 'cover',
                      borderRadius: radius.sm,
                      border: `1.5px solid ${border}`,
                      cursor: 'pointer', display: 'block',
                    }}
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                  />
                  {/* Per-photo delete button — positioned inside the thumbnail */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeletePhoto(type, id); }}
                    title="삭제"
                    style={{
                      position: 'absolute', top: 3, right: 3,
                      width: 22, height: 22, borderRadius: '50%',
                      background: 'rgba(239,68,68,0.92)', color: '#fff',
                      border: '2px solid rgba(255,255,255,0.85)',
                      cursor: 'pointer', padding: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                      zIndex: 20,
                      lineHeight: 1,
                    }}
                  >
                    <XIcon size={11} strokeWidth={3} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
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