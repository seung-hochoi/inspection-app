import React, { useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, FileX, ChevronDown, Camera, XCircle, Pencil, Download } from 'lucide-react';
import { C, radius, font, shadow, trans } from './styles';
import { cancelMovementEvent, saveBatch, uploadPhotos, downloadPhotoZip, savePhotoMeta } from '../api';
import { fileToBase64 } from '../utils';

export default function RecordsPage({ records = [], jobKey, onToast, onRefresh, inspectionRows = [] }) {
  const [filter, setFilter]       = useState('all');
  const [search, setSearch]       = useState('');
  const [expanded, setExpanded]   = useState(null);
  const [canceling, setCanceling] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // record being edited
  const [downloading, setDownloading] = useState('');

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

  const handleCancel = async (record) => {
    if (!record.__rowNumber) return;
    if (!window.confirm(`이 내역을 취소하시겠습니까?\n${record['상품명']} (${record['처리유형']})`)) return;
    setCanceling(record.__rowNumber);
    try {
      await cancelMovementEvent(record.__rowNumber);
      onToast?.('내역이 취소되었습니다.', 'success');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || '취소 실패', 'error');
    } finally {
      setCanceling(null);
    }
  };

  const handleDownloadZip = async (mode) => {
    setDownloading(mode);
    try {
      const result = await downloadPhotoZip({ mode });
      if (result.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
      } else if (result.zipBase64) {
        const byteChars = atob(result.zipBase64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = result.fileName || 'photos.zip'; a.click();
        URL.revokeObjectURL(url);
      } else {
        onToast?.('다운로드할 사진이 없습니다.', 'info');
      }
    } catch (err) {
      onToast?.(err.message || 'ZIP 생성 실패', 'error');
    } finally {
      setDownloading('');
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

      {/* ZIP Download bar */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 14,
        background: C.card, borderRadius: radius.md,
        border: `1px solid ${C.border}`, padding: '10px 12px',
        boxShadow: shadow.xs,
      }}>
        <button
          onClick={() => handleDownloadZip('inspection')}
          disabled={!!downloading}
          style={{
            flex: 1, height: 38, background: C.primaryLight, color: C.primary,
            border: `1.5px solid ${C.primaryMid}`, borderRadius: radius.sm,
            fontSize: 12.5, fontWeight: 600, cursor: downloading ? 'default' : 'pointer',
            fontFamily: font.base, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: downloading === 'inspection' ? 0.6 : 1,
          }}
        >
          <Download size={13} strokeWidth={2} />
          {downloading === 'inspection' ? '처리 중...' : '검품사진 저장'}
        </button>
        <button
          onClick={() => handleDownloadZip('movement')}
          disabled={!!downloading}
          style={{
            flex: 1, height: 38, background: C.redLight, color: C.red,
            border: `1.5px solid ${C.redMid}`, borderRadius: radius.sm,
            fontSize: 12.5, fontWeight: 600, cursor: downloading ? 'default' : 'pointer',
            fontFamily: font.base, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: downloading === 'movement' ? 0.6 : 1,
          }}
        >
          <Download size={13} strokeWidth={2} />
          {downloading === 'movement' ? '처리 중...' : '불량사진 저장'}
        </button>
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
                            BRIX / 사진 편집
                          </button>
                          {rec.__rowNumber && (
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

  const [brixMin, setBrixMin] = useState(String(inspRow?.['BRIX최저'] || ''));
  const [brixMax, setBrixMax] = useState(String(inspRow?.['BRIX최고'] || ''));
  const [saving,  setSaving]  = useState(false);
  const [uploadingWeight, setUploadingWeight] = useState(false);
  const [uploadingSugar,  setUploadingSugar]  = useState(false);
  const [weightIds, setWeightIds] = useState(
    () => String(inspRow?.['중량사진ID목록'] || '').split('\n').filter(Boolean)
  );
  const [sugarIds, setSugarIds] = useState(
    () => String(inspRow?.['당도사진ID목록'] || '').split('\n').filter(Boolean)
  );
  const weightRef = useRef(null);
  const sugarRef  = useRef(null);

  const brixAvg = useMemo(() => {
    const min = parseFloat(brixMin);
    const max = parseFloat(brixMax);
    if (!isNaN(min) && !isNaN(max)) return ((min + max) / 2).toFixed(1);
    return '';
  }, [brixMin, brixMax]);

  const handlePhotoUpload = async (type, files, setUploading, setIds, currentIds) => {
    if (!files.length) return;
    setUploading(true);
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
      setIds([...new Set([...currentIds, ...newIds])]);
      onToast?.('사진이 업로드되었습니다.', 'success');
    } catch (err) {
      onToast?.(err.message || '업로드 실패', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveBatch([{
        type: 'inspection',
        '작업기준일또는CSV식별값': jobKey,
        '상품코드':  normalizeCode(record['상품코드'] || ''),
        '상품명':    record['상품명']   || '',
        '협력사명':  record['협력사명'] || '',
        '발주수량':  String(record['발주수량'] || inspRow?.['발주수량'] || 0),
        '검품수량':  String(inspRow?.['검품수량'] || 0),
        '불량사유':  inspRow?.['불량사유'] || '',
        '사진파일ID목록': inspRow?.['사진파일ID목록'] || '',
        'BRIX최저': brixMin,
        'BRIX최고': brixMax,
        'BRIX평균': brixAvg,
      }]);
      onToast?.('저장되었습니다.', 'success');
      onClose();
    } catch (err) {
      onToast?.(err.message || '저장 실패', 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%', height: 40, padding: '0 10px',
    border: `1.5px solid ${C.border}`, borderRadius: radius.sm,
    fontSize: 14, fontFamily: font.base, color: C.text, outline: 'none',
    boxSizing: 'border-box', background: C.card,
    transition: 'border-color 0.15s',
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
        padding: '20px 18px', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: shadow.lg,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>검품 상세 편집</p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: C.muted }}>
              {record['상품명']} · {record['협력사명']}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, background: C.bgAlt, border: `1px solid ${C.border}`,
              borderRadius: radius.sm, cursor: 'pointer', color: C.muted,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>

        {/* BRIX Section */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: C.muted2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            BRIX 당도 측정
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>최솟값</label>
              <input type="number" step="0.1" value={brixMin} onChange={(e) => setBrixMin(e.target.value)}
                placeholder="0.0" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>최댓값</label>
              <input type="number" step="0.1" value={brixMax} onChange={(e) => setBrixMax(e.target.value)}
                placeholder="0.0" style={inputStyle} />
            </div>
            <div style={{ flexShrink: 0 }}>
              <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>평균 (자동)</label>
              <div style={{
                height: 40, minWidth: 64, padding: '0 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: brixAvg ? C.primaryLight : C.bgAlt,
                border: `1.5px solid ${brixAvg ? C.primaryMid : C.border}`,
                borderRadius: radius.sm, fontSize: 14, fontWeight: 700,
                color: brixAvg ? C.primary : C.muted2,
              }}>{brixAvg || '—'}</div>
            </div>
          </div>
        </div>

        {/* Weight Photo Section */}
        <div style={{ marginBottom: 14 }}>
          <input ref={weightRef} type="file" accept="image/*,.heic,.heif" multiple style={{ display: 'none' }}
            onChange={(e) => handlePhotoUpload('weight', Array.from(e.target.files || []), setUploadingWeight, setWeightIds, weightIds)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.muted2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>중량사진</p>
            <button
              onClick={() => weightRef.current?.click()}
              disabled={uploadingWeight}
              style={{
                height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600,
                background: C.primaryLight, color: C.primary, border: `1px solid ${C.primaryMid}`,
                borderRadius: radius.sm, cursor: 'pointer', fontFamily: font.base,
              }}
            >
              {uploadingWeight ? '업로드 중...' : `+ 추가 ${weightIds.length > 0 ? `(${weightIds.length}장)` : ''}`}
            </button>
          </div>
          {weightIds.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {weightIds.map((id) => (
                <img key={id} src={`https://drive.google.com/thumbnail?id=${id}&sz=w100`}
                  style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: radius.sm, border: `1px solid ${C.border}` }}
                  onError={(e) => { e.target.style.opacity = '0.3'; }} alt="중량사진" />
              ))}
            </div>
          )}
        </div>

        {/* Sugar Photo Section */}
        <div style={{ marginBottom: 18 }}>
          <input ref={sugarRef} type="file" accept="image/*,.heic,.heif" multiple style={{ display: 'none' }}
            onChange={(e) => handlePhotoUpload('sugar', Array.from(e.target.files || []), setUploadingSugar, setSugarIds, sugarIds)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.muted2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>당도사진</p>
            <button
              onClick={() => sugarRef.current?.click()}
              disabled={uploadingSugar}
              style={{
                height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600,
                background: C.greenLight, color: C.green, border: `1px solid ${C.greenMid}`,
                borderRadius: radius.sm, cursor: 'pointer', fontFamily: font.base,
              }}
            >
              {uploadingSugar ? '업로드 중...' : `+ 추가 ${sugarIds.length > 0 ? `(${sugarIds.length}장)` : ''}`}
            </button>
          </div>
          {sugarIds.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {sugarIds.map((id) => (
                <img key={id} src={`https://drive.google.com/thumbnail?id=${id}&sz=w100`}
                  style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: radius.sm, border: `1px solid ${C.border}` }}
                  onError={(e) => { e.target.style.opacity = '0.3'; }} alt="당도사진" />
              ))}
            </div>
          )}
        </div>

        {/* Save */}
        <button
          onClick={handleSave} disabled={saving}
          style={{
            width: '100%', height: 50, background: saving ? C.muted2 : C.primary,
            color: '#fff', border: 'none', borderRadius: radius.md,
            fontSize: 15, fontWeight: 700, cursor: saving ? 'default' : 'pointer',
            fontFamily: font.base, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {saving ? '저장 중...' : 'BRIX / 사진 저장'}
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

