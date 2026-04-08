import React, { useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, FileX, ChevronDown, Camera, XCircle, Pencil, ImagePlus, X as XIcon } from 'lucide-react';
import { C, radius, font, shadow, trans } from './styles';
import { cancelMovementEvent, saveBatch, uploadPhotos, savePhotoMeta } from '../api';
import { fileToBase64, getClientId } from '../utils';
import { v4 as uuidv4 } from 'uuid';

// Error messages the backend uses when a row is already gone (stale local data).
const ALREADY_DELETED_PATTERNS = [
  '이미 삭제되었거나 존재하지 않는 행',
  'already deleted',
  'row not found',
];

const isAlreadyDeletedError = (msg = '') =>
  ALREADY_DELETED_PATTERNS.some((p) => msg.toLowerCase().includes(p.toLowerCase()));

export default function RecordsPage({ records = [], jobKey, onToast, onRefresh, onRecordsUpdate, inspectionRows = [], config = {}, authUser }) {
  const canEditReturnExchange = !authUser || !(authUser.permissions || []).length ||
    (authUser.permissions || []).includes('EDIT_RETURN_EXCHANGE');
  const [filter, setFilter]       = useState('all');
  const [search, setSearch]       = useState('');
  const [expanded, setExpanded]   = useState(null);
  const [canceling, setCanceling] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // record being edited

  const filtered = useMemo(() => {
    let list = records;
    if (filter !== 'all') {
      list = list.filter((r) => r['처리유형'] === (filter === 'RETURN' ? '회송' : '교환'));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        (r['상품명'] || '').toLowerCase().includes(q) ||
        (r['상품코드'] || '').toLowerCase().includes(q) ||
        (r['협력사명'] || '').toLowerCase().includes(q) ||
        (r['센터명'] || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [records, filter, search]);

  const removeRecordFromState = useCallback((rowNumber) => {
    if (onRecordsUpdate) {
      onRecordsUpdate((prev) => prev.filter((r) => r.__rowNumber !== rowNumber));
    }
  }, [onRecordsUpdate]);

  const handleCancel = async (record) => {
    if (!record.__rowNumber) return;
    if (!window.confirm(`이 내역을 취소하시겠습니까?\n${record['상품명']} (${record['처리유형']})`)) return;
    setCanceling(record.__rowNumber);
    try {
      const result = await cancelMovementEvent({
        rowNumber: record.__rowNumber,
        // Secondary verification fields — backend cross-checks before deleting
        상품코드:  record['상품코드'] || '',
        처리유형:  record['처리유형'] || '',
        센터명:    record['센터명']   || '',
        협력사명:  record['협력사명'] || '',
      });
      // Use the fresh records list returned by the backend (read AFTER the delete)
      // instead of re-fetching via loadBootstrap, which may serve a cached GET response.
      if (onRecordsUpdate && Array.isArray(result?.records)) {
        onRecordsUpdate(result.records);
      } else {
        removeRecordFromState(record.__rowNumber);
      }
      onToast?.('내역이 취소되었습니다.', 'success');
    } catch (err) {
      const msg = err.message || '';
      if (isAlreadyDeletedError(msg)) {
        // Row is gone on the backend — remove stale local entry and treat as success.
        removeRecordFromState(record.__rowNumber);
        onToast?.('이미 삭제된 내역입니다. 화면에서 제거했습니다.', 'info');
      } else {
        onToast?.(msg || '취소 실패', 'error');
      }
    } finally {
      setCanceling(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      style={{ padding: '14px 12px 80px' }}
    >
      {/* Toolbar */}
      <div style={{
        background: C.card, borderRadius: radius.lg,
        border: `1px solid ${C.border}`, boxShadow: shadow.sm,
        padding: '12px 14px', marginBottom: 14,
      }}>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search
            size={14} strokeWidth={2}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.muted2, pointerEvents: 'none' }}
          />
          <input
            type="text" placeholder="상품명 · 코드 · 협력사 · 센터 검색"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', height: 40, boxSizing: 'border-box', paddingLeft: 34, paddingRight: 14,
              border: `1.5px solid ${C.border}`, borderRadius: radius.sm,
              fontSize: 13, fontFamily: font.base, color: C.text, outline: 'none', background: C.card,
              transition: 'border-color 0.15s',
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'inline-flex', borderRadius: radius.sm, overflow: 'hidden',
            border: `1px solid ${C.border}`, background: C.bgAlt,
          }}>
            {[{ key: 'all', label: '전체' }, { key: 'RETURN', label: '회송' }, { key: 'EXCHANGE', label: '교환' }].map((f, i) => (
              <button key={f.key} onClick={() => setFilter(f.key)} style={{
                height: 30, padding: '0 14px',
                background: filter === f.key
                  ? (f.key === 'RETURN' ? C.red : f.key === 'EXCHANGE' ? C.orange : C.primary)
                  : 'transparent',
                color: filter === f.key ? '#fff' : C.muted,
                border: 'none', borderLeft: i > 0 ? `1px solid ${C.border}` : 'none',
                fontSize: 12, fontWeight: filter === f.key ? 700 : 500,
                cursor: 'pointer', fontFamily: font.base, transition: trans,
              }}>{f.label}</button>
            ))}
          </div>
          <span style={{
            fontSize: 11, color: C.muted2, marginLeft: 'auto',
            background: C.bgAlt, padding: '3px 10px', borderRadius: radius.full,
            border: `1px solid ${C.border}`, fontVariantNumeric: 'tabular-nums',
          }}>{filtered.length}건</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{
          padding: '56px 24px', textAlign: 'center', color: C.muted,
          background: C.card, borderRadius: radius.lg,
          border: `1.5px dashed ${C.border}`,
        }}>
          <FileX size={38} strokeWidth={1.5} color={C.muted2} style={{ marginBottom: 12, display: 'block', margin: '0 auto 12px' }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: C.textSec, margin: '0 0 4px' }}>내역 없음</p>
          <p style={{ fontSize: 12, margin: 0 }}>회송 또는 교환 내역이 없습니다.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((rec) => {
            const key      = rec.__rowNumber || JSON.stringify(rec);
            const isOpen   = expanded === key;
            const isReturn = rec['처리유형'] === '회송';
            const qty      = isReturn ? rec['회송수량'] : rec['교환수량'];
            const photoCount = parseInt(rec['사진개수'], 10) || 0;
            const typeColor  = isReturn ? C.red : C.orange;
            const typeBg     = isReturn ? C.redLight : C.orangeLight;
            const typeBorder = isReturn ? C.redMid : C.orangeMid;

            return (
              <div key={key} style={{
                background: C.card, borderRadius: radius.md,
                border: `1px solid ${isOpen ? C.borderMid : C.border}`,
                boxShadow: isOpen ? shadow.md : shadow.xs,
                overflow: 'hidden',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}>
                <button
                  onClick={() => setExpanded(isOpen ? null : key)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', padding: '12px 14px',
                    background: 'none', border: 'none', cursor: 'pointer', fontFamily: font.base,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <span style={{
                      background: typeBg, color: typeColor,
                      fontSize: 10.5, fontWeight: 800, padding: '3px 9px',
                      borderRadius: radius.full, flexShrink: 0,
                      border: `1px solid ${typeBorder}`, letterSpacing: '0.04em',
                    }}>{rec['처리유형'] || '-'}</span>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: C.text,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.01em' }}>
                        {rec['상품명'] || '-'}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted }}>
                        {[rec['협력사명'], rec['센터명']].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingLeft: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: typeColor, fontVariantNumeric: 'tabular-nums' }}>{qty || 0}개</span>
                    {photoCount > 0 && (
                      <span style={{ fontSize: 10.5, color: C.primary, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <Camera size={10} strokeWidth={2} />{photoCount}
                      </span>
                    )}
                    <motion.div
                      animate={{ rotate: isOpen ? 0 : -90 }}
                      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                      style={{ display: 'flex', alignItems: 'center' }}
                    >
                      <ChevronDown size={14} color={C.muted2} strokeWidth={2} />
                    </motion.div>
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="detail"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 14px', background: C.cardAlt }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 12 }}>
                          <DRow label="작성일시" value={rec['작성일시'] || '-'} />
                          <DRow label="상품코드"  value={rec['상품코드'] || '-'} />
                          <DRow label="발주수량"  value={rec['발주수량'] || '-'} />
                          {isReturn  && <DRow label="회송수량" value={rec['회송수량'] || '-'} color={C.red} />}
                          {!isReturn && <DRow label="교환수량" value={rec['교환수량'] || '-'} color={C.orange} />}
                          {rec['비고']  && <DRow label="비고"   value={rec['비고']} />}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          {canEditReturnExchange && (
                            <button
                              onClick={() => setEditTarget(rec)}
                              className="action-btn"
                              style={{
                                flex: 1, height: 38,
                                background: C.primaryLight, color: C.primary,
                                border: `1.5px solid ${C.primaryMid}`, borderRadius: radius.sm,
                                fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                                fontFamily: font.base,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                              }}
                            >
                              <Pencil size={12} strokeWidth={2} />
                              상세내용
                            </button>
                          )}
                          {canEditReturnExchange && rec.__rowNumber && (
                            <button
                              onClick={() => handleCancel(rec)}
                              disabled={canceling === rec.__rowNumber}
                              className="action-btn"
                              style={{
                                flex: 1, height: 38,
                                background: canceling === rec.__rowNumber ? C.bgAlt : C.redLight,
                                color: canceling === rec.__rowNumber ? C.muted2 : C.red,
                                border: `1.5px solid ${C.redMid}`, borderRadius: radius.sm,
                                fontSize: 12.5, fontWeight: 600,
                                cursor: canceling === rec.__rowNumber ? 'default' : 'pointer',
                                fontFamily: font.base,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                              }}
                            >
                              <XCircle size={13} strokeWidth={2} />
                              {canceling === rec.__rowNumber ? '취소 중...' : '이 내역 취소'}
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {editTarget && (
        <RecordEditModal
          record={editTarget}
          inspectionRows={inspectionRows}
          config={config}
          jobKey={jobKey}
          onClose={() => setEditTarget(null)}
          onToast={onToast}
        />
      )}
    </motion.div>
  );
}

// ─── Record Edit Modal ────────────────────────────────────────────────────────

function normalizeCode(value) {
  if (!value) return '';
  let text = String(value).replace(/\uFEFF/g, '').trim();
  const m = text.match(/^=T\("(.+)"\)$/i);
  if (m) text = m[1];
  return text.replace(/^"+|"+$/g, '').replace(/\.0+$/, '').trim();
}

function RecordEditModal({ record, inspectionRows, jobKey, onClose, onToast }) {
  const inspRow = useMemo(() => {
    const code    = normalizeCode(record['상품코드'] || '');
    const partner = record['협력사명'] || '';
    return inspectionRows.find(
      (ir) => normalizeCode(ir['상품코드'] || '') === code && (ir['협력사명'] || '') === partner
    ) || null;
  }, [record, inspectionRows]);

  const [memo,    setMemo]    = useState(String(inspRow?.['불량사유'] || ''));
  const [saving,  setSaving]  = useState(false);
  const [uploadingType, setUploadingType] = useState(null);

  const splitIds = (v) => Array.isArray(v)
    ? v.filter(Boolean)
    : String(v || '').split('\n').filter(Boolean);

  const [defectIds, setDefectIds] = useState(() => splitIds(inspRow?.['defectPhotoIds']));
  const defectRef = useRef(null);

  const orderedQty   = parseInt(record['발주수량'] || inspRow?.['발주수량'] || 0, 10) || 0;
  const inspectedQty = parseInt(inspRow?.['검품수량'] || 0, 10) || 0;
  const returnQty    = record['처리유형'] === '회송'  ? (parseInt(record['회송수량'], 10) || 0) : 0;
  const exchangeQty  = record['처리유형'] === '교환' ? (parseInt(record['교환수량'], 10) || 0) : 0;

  const handlePhotoUpload = async (type, files, setIds) => {
    if (!files.length) return;
    setUploadingType(type);
    try {
      const photos = [];
      for (const file of files) {
        const encoded = await fileToBase64(file);
        if (encoded) photos.push({ name: encoded.fileName, type: encoded.mimeType, data: encoded.imageBase64 });
      }
      const code = normalizeCode(record['상품코드'] || '');
      const result = await uploadPhotos({
        itemKey: `${jobKey}||${code}||${record['협력사명'] || ''}`,
        productName: record['상품명'] || '',
        '상품코드': code,
        '협력사명': record['협력사명'] || '',
        // Pass photoType so the backend routes to the correct subfolder and filename prefix.
        // 'defect' → "불량_" prefix / 불량 subfolder; 'insp' → "검품_" prefix / 검품 subfolder.
        photoType: type,
        photos,
      });
      const photosArr = Array.isArray(result.data?.photos) ? result.data.photos
        : Array.isArray(result.data) ? result.data : [];
      const newIds = photosArr.map((item) => String(item.fileId || '').trim()).filter(Boolean);
      for (const fileId of newIds) {
        await savePhotoMeta({
          type,
          '작업기준일또는CSV식별값': jobKey,
          '상품코드': code,
          '협력사명': record['협력사명'] || '',
          photoFileId: fileId,
          photoAction: 'append',
        });
      }
      setIds((prev) => [...new Set([...prev, ...newIds])]);
      onToast?.('사진이 업로드되었습니다.', 'success');
    } catch (err) {
      onToast?.(err.message || '업로드 실패', 'error');
    } finally {
      setUploadingType(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveBatch([{
        type: 'inspection',
        clientId: getClientId(),
        operationId: uuidv4(),
        '작업기준일또는CSV식별값': jobKey,
        '상품코드':  normalizeCode(record['상품코드'] || ''),
        '상품명':    record['상품명']   || '',
        '협력사명':  record['협력사명'] || '',
        '발주수량':  String(record['발주수량'] || inspRow?.['발주수량'] || 0),
        '검품수량':  String(inspRow?.['검품수량'] || 0),
        '불량사유':  memo,
        defectPhotoIds: defectIds,
      }]);
      onToast?.('저장되었습니다.', 'success');
      onClose();
    } catch (err) {
      onToast?.(err.message || '저장 실패', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 800,
        background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '100%', maxWidth: 520,
        background: C.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
        padding: '20px 18px 28px', maxHeight: '92vh', overflowY: 'auto',
        boxShadow: shadow.lg,
      }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: '0 0 3px', fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>
              상세내용
            </p>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: C.textSec,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {record['상품명'] || '—'}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, background: C.bgAlt, border: `1px solid ${C.border}`,
            borderRadius: radius.sm, cursor: 'pointer', color: C.muted,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>✕</button>
        </div>

        {/* ── Summary grid ── */}
        <div style={{
          background: C.cardAlt, borderRadius: radius.md,
          border: `1px solid ${C.border}`, padding: '10px 12px',
          marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: '6px 16px',
        }}>
          <InfoChip label="코드"    value={normalizeCode(record['상품코드'] || '') || '—'} mono />
          <InfoChip label="협력사"  value={record['협력사명'] || '—'} />
          <InfoChip label="작성일시" value={record['작성일시'] || '—'} />
          {orderedQty   > 0 && <InfoChip label="발주"  value={orderedQty} />}
          {inspectedQty > 0 && <InfoChip label="검품"  value={inspectedQty} color={C.green} />}
          {returnQty    > 0 && <InfoChip label="회송"  value={returnQty}   color={C.red} />}
          {exchangeQty  > 0 && <InfoChip label="교환"  value={exchangeQty} color={C.orange} />}
        </div>

        {/* ── Defect reason ── */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.muted2, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
            불량사유
          </label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="불량사유를 입력하세요"
            rows={2}
            style={{
              width: '100%', padding: '8px 10px', boxSizing: 'border-box',
              border: `1.5px solid ${memo ? C.borderMid : C.border}`,
              borderRadius: radius.sm, fontSize: 13, fontFamily: font.base,
              color: C.text, outline: 'none', resize: 'vertical',
              background: memo ? '#fefce8' : C.card,
              lineHeight: 1.5, transition: 'border-color 0.15s, background 0.15s',
            }}
          />
        </div>

        <div style={{ height: 1, background: C.border, margin: '0 0 14px' }} />

        {/* ── Defect photo ── */}
        <PhotoSection
          title="불량사진" color={C.red} bg={C.redLight} border={C.redMid}
          ids={defectIds} setIds={setDefectIds} fileRef={defectRef}
          uploadType="defect" uploadingType={uploadingType}
          onUpload={(files) => handlePhotoUpload('defect', files, setDefectIds)}
        />

        {/* ── Save ── */}
        <button
          onClick={handleSave} disabled={saving}
          style={{
            width: '100%', height: 50, background: saving ? C.muted2 : C.primary,
            color: '#fff', border: 'none', borderRadius: radius.md,
            fontSize: 15, fontWeight: 700, cursor: saving ? 'default' : 'pointer',
            fontFamily: font.base, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginTop: 14,
          }}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}

function DRow({ label, value, color }) {
  return (
    <div>
      <span style={{ fontSize: 10, color: C.muted2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 2 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: color || C.textSec }}>{value}</span>
    </div>
  );
}

// Compact key-value chip for the inspection summary grid inside RecordEditModal
function InfoChip({ label, value, color, mono }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span style={{
        fontSize: 12, fontWeight: 600, color: color || C.textSec,
        fontFamily: mono ? "'Menlo','Consolas',monospace" : font.base,
      }}>
        {value}
      </span>
    </div>
  );
}

// Reusable photo section: label, count badge, add button, thumbnail grid with per-photo delete.
// compact=true → smaller thumbnails (48×48), compact empty state (used for 중량/당도)
function PhotoSection({ title, color, bg, border, ids, setIds, fileRef, uploadType, uploadingType, onUpload, compact = false }) {
  const isUploading = uploadingType === uploadType;
  const thumbSize   = compact ? 48 : 60;
  return (
    <div style={{ marginBottom: compact ? 10 : 14 }}>
      <input
        ref={fileRef}
        type="file" accept="image/*,.heic,.heif" multiple style={{ display: 'none' }}
        onChange={(e) => { onUpload(Array.from(e.target.files || [])); e.target.value = ''; }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: compact ? 10.5 : 11, fontWeight: 700, color: C.muted2,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {title}
          </span>
          {ids.length > 0 && (
            <span style={{
              fontSize: 9.5, fontWeight: 800, background: color, color: '#fff',
              borderRadius: radius.full, minWidth: 18, height: 18, padding: '0 4px',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>{ids.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={isUploading}
          style={{
            height: compact ? 26 : 28, padding: '0 9px', fontSize: 11, fontWeight: 600,
            background: isUploading ? C.bgAlt : bg,
            color: isUploading ? C.muted2 : color,
            border: `1px solid ${isUploading ? C.border : border}`,
            borderRadius: radius.sm, cursor: isUploading ? 'default' : 'pointer',
            fontFamily: font.base, display: 'flex', alignItems: 'center', gap: 4, transition: trans,
          }}
        >
          <ImagePlus size={9} strokeWidth={2} />
          {isUploading ? '업로드 중...' : '추가'}
        </button>
      </div>
      {ids.length === 0 ? (
        <div style={{
          height: compact ? 30 : 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: C.bgAlt, borderRadius: radius.sm,
          border: `1.5px dashed ${C.border}`, fontSize: 11, color: C.muted2,
        }}>
          사진 없음
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ids.map((id) => (
            <span key={id} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, width: thumbSize, height: thumbSize }}>
              <img
                src={`https://drive.google.com/thumbnail?id=${id}&sz=w100`}
                alt={title}
                style={{
                  width: thumbSize, height: thumbSize, objectFit: 'cover',
                  borderRadius: radius.sm, border: `1.5px solid ${border}`, display: 'block',
                }}
                onError={(e) => { e.target.style.opacity = '0.3'; }}
              />
              <button
                type="button"
                onClick={() => setIds((prev) => prev.filter((x) => x !== id))}
                title="삭제"
                style={{
                  position: 'absolute', top: 2, right: 2,
                  width: 20, height: 20,
                  background: 'rgba(239,68,68,0.92)', color: '#fff', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', border: '2px solid rgba(255,255,255,0.85)', padding: 0,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                  zIndex: 20,
                }}
              >
                <XIcon size={10} strokeWidth={3} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}



// ─── Photo requirement logic (sheet-driven) ──────────────────────────────────
