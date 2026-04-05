import React, { useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, FileX, ChevronDown, Camera, XCircle, Pencil, Download, ImagePlus, CheckCircle2, AlertCircle } from 'lucide-react';
import { C, radius, font, shadow, trans } from './styles';
import { cancelMovementEvent, saveBatch, uploadPhotos, savePhotoMeta } from '../api';
import { fileToBase64 } from '../utils';
import { buildAndDownloadPhotoZips } from '../utils/photoZipBuilder';

export default function RecordsPage({ records = [], jobKey, onToast, onRefresh, inspectionRows = [], config = {} }) {
  const [filter, setFilter]       = useState('all');
  const [search, setSearch]       = useState('');
  const [expanded, setExpanded]   = useState(null);
  const [canceling, setCanceling] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // record being edited
  const [downloading, setDownloading] = useState('');
  const [dlProgress, setDlProgress] = useState({ stage: '', percent: 0, text: '' });

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
    setDlProgress({ stage: 'generating', percent: 10, text: 'ZIP 생성 중...' });
    try {
      const { count, parts } = await buildAndDownloadPhotoZips(mode, {
        onProgress: setDlProgress,
      });
      if (count === 0) {
        onToast?.('다운로드할 사진이 없습니다.', 'info');
      } else {
        const partsNote = parts > 1 ? ` (${parts}개 파일)` : '';
        onToast?.(`총 ${count}장 다운로드 시작${partsNote}`, 'success');
      }
    } catch (err) {
      onToast?.(err.message || 'ZIP 생성 실패', 'error');
    } finally {
      setDownloading('');
      setDlProgress({ stage: '', percent: 0, text: '' });
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
          {downloading === 'inspection'
            ? (dlProgress.text || '처리 중...')
            : '검품사진 저장'}
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
          {downloading === 'movement'
            ? (dlProgress.text || '처리 중...')
            : '불량사진 저장'}
        </button>
      </div>
      {/* Progress bar — visible only while ZIP is being generated/downloaded */}
      {!!downloading && dlProgress.percent > 0 && (
        <div style={{ marginBottom: 10, borderRadius: radius.sm, overflow: 'hidden', background: C.border, height: 4 }}>
          <div style={{
            height: '100%',
            width: `${dlProgress.percent}%`,
            background: downloading === 'inspection' ? C.primary : C.red,
            transition: 'width 0.4s ease',
          }} />
        </div>
      )}
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
                            상세내용
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

function RecordEditModal({ record, inspectionRows, jobKey, onClose, onToast, config = {} }) {
  const inspRow = useMemo(() => {
    const code    = normalizeCode(record['상품코드'] || '');
    const partner = record['협력사명'] || '';
    return inspectionRows.find(
      (ir) => normalizeCode(ir['상품코드'] || '') === code && (ir['협력사명'] || '') === partner
    ) || null;
  }, [record, inspectionRows]);

  const [brixMin, setBrixMin] = useState(String(inspRow?.['BRIX최저'] || ''));
  const [brixMax, setBrixMax] = useState(String(inspRow?.['BRIX최고'] || ''));
  const [memo,    setMemo]    = useState(String(inspRow?.['불량사유'] || ''));
  const [saving,  setSaving]  = useState(false);
  const [uploadingType, setUploadingType] = useState(null);

  const [inspIds,   setInspIds]   = useState(
    () => String(inspRow?.['사진파일ID목록'] || '').split('\n').filter(Boolean)
  );
  const [defectIds, setDefectIds] = useState([]);
  const [weightIds, setWeightIds] = useState(
    () => String(inspRow?.['중량사진ID목록'] || '').split('\n').filter(Boolean)
  );
  const [sugarIds, setSugarIds] = useState(
    () => String(inspRow?.['당도사진ID목록'] || '').split('\n').filter(Boolean)
  );

  const inspRef   = useRef(null);
  const defectRef = useRef(null);
  const weightRef = useRef(null);
  const sugarRef  = useRef(null);

  const brixAvg = useMemo(() => {
    const min = parseFloat(brixMin);
    const max = parseFloat(brixMax);
    if (!isNaN(min) && !isNaN(max)) return ((min + max) / 2).toFixed(1);
    return '';
  }, [brixMin, brixMax]);

  const orderedQty   = parseInt(record['발주수량'] || inspRow?.['발주수량'] || 0, 10) || 0;
  const inspectedQty = parseInt(inspRow?.['검품수량'] || 0, 10) || 0;
  const returnQty    = record['처리유형'] === '회송'  ? (parseInt(record['회송수량'], 10) || 0) : 0;
  const exchangeQty  = record['처리유형'] === '교환' ? (parseInt(record['교환수량'], 10) || 0) : 0;

  // Build lookup maps from sheet config data (once per modal open)
  const { partnerToStandard, subCategoryEntries, dangjdoRules } = useMemo(
    () => buildPhotoRequirementMaps(config.mapping_rows, config.dangjdo_rows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.mapping_rows, config.dangjdo_rows]
  );

  const partnerShort   = standardizePartnerName(record['협력사명'], partnerToStandard);
  const productCodeNorm = normalizeCode(record['상품코드'] || '');

  // Weight requirement chip — derived from mapping sheet subcategory/product-name inference
  const weightChip = useMemo(() => {
    const cat = inferWeightCategory(record['상품명'] || '', subCategoryEntries);
    if (!cat) return null;
    return { label: cat, done: weightIds.length > 0 };
  }, [record, subCategoryEntries, weightIds.length]);

  // Sweetness requirement chip — from 당도 sheet (exact partner+code, fallback code-only)
  const sweetnessChip = useMemo(() => {
    const rule = findDangjdoRule(productCodeNorm, partnerShort, dangjdoRules);
    if (!rule) return null;
    const count = sugarIds.length;
    return { label: rule.label, required: rule.required, count, done: count >= rule.required };
  }, [productCodeNorm, partnerShort, dangjdoRules, sugarIds.length]);

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
      const allPhotoIds = [...new Set([...inspIds, ...defectIds, ...weightIds, ...sugarIds])];
      await saveBatch([{
        type: 'inspection',
        '작업기준일또는CSV식별값': jobKey,
        '상품코드':  normalizeCode(record['상품코드'] || ''),
        '상품명':    record['상품명']   || '',
        '협력사명':  record['협력사명'] || '',
        '발주수량':  String(record['발주수량'] || inspRow?.['발주수량'] || 0),
        '검품수량':  String(inspRow?.['검품수량'] || 0),
        '불량사유':  memo,
        '사진파일ID목록': allPhotoIds.join('\n'),
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

        {/* ── Inspection summary grid ── */}
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

        {/* ── Photo requirement chips ── */}
        {(weightChip || sweetnessChip) && (
          <div style={{ marginBottom: 14 }}>
            <p style={{ margin: '0 0 6px', fontSize: 10.5, fontWeight: 700, color: C.muted2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              촬영 필요
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {weightChip && (
                <ReqChip
                  prefix="중량"
                  label={weightChip.label}
                  status={weightChip.done ? 'done' : 'missing'}
                  text={weightChip.done ? '완료' : '미완료'}
                />
              )}
              {sweetnessChip && (
                <ReqChip
                  prefix="당도"
                  label={sweetnessChip.label}
                  status={sweetnessChip.done ? 'done' : sweetnessChip.count > 0 ? 'partial' : 'missing'}
                  text={sweetnessChip.done ? '완료' : `${sweetnessChip.count}/${sweetnessChip.required}`}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Memo / defect reason ── */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.muted2, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
            비고 / 불량사유
          </label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="비고 또는 불량사유를 입력하세요"
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

        {/* ── 4 Photo sections ── */}
        <PhotoSection
          title="검품사진" color={C.primary} bg={C.primaryLight} border={C.primaryMid}
          ids={inspIds} setIds={setInspIds} fileRef={inspRef}
          uploadType="insp" uploadingType={uploadingType}
          onUpload={(files) => handlePhotoUpload('insp', files, setInspIds)}
        />
        <PhotoSection
          title="불량사진" color={C.red} bg={C.redLight} border={C.redMid}
          ids={defectIds} setIds={setDefectIds} fileRef={defectRef}
          uploadType="defect" uploadingType={uploadingType}
          onUpload={(files) => handlePhotoUpload('defect', files, setDefectIds)}
        />
        <PhotoSection
          title="중량사진" color={C.muted} bg={C.bgAlt} border={C.borderMid}
          ids={weightIds} setIds={setWeightIds} fileRef={weightRef}
          uploadType="weight" uploadingType={uploadingType}
          onUpload={(files) => handlePhotoUpload('weight', files, setWeightIds)}
          compact
        />
        <PhotoSection
          title="당도사진" color={C.green} bg={C.greenLight} border={C.greenMid}
          ids={sugarIds} setIds={setSugarIds} fileRef={sugarRef}
          uploadType="sugar" uploadingType={uploadingType}
          onUpload={(files) => handlePhotoUpload('sugar', files, setSugarIds)}
          compact
        />

        <div style={{ height: 1, background: C.border, margin: '0 0 14px' }} />

        {/* ── BRIX Section ── */}
        <div style={{ marginBottom: 18 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: C.muted2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            BRIX 당도 측정
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>최솟값</label>
              <input type="number" step="0.1" value={brixMin} onChange={(e) => setBrixMin(e.target.value)}
                placeholder="0.0" style={{
                  width: '100%', height: 38, padding: '0 10px',
                  border: `1.5px solid ${C.border}`, borderRadius: radius.sm,
                  fontSize: 14, fontFamily: font.base, color: C.text, outline: 'none',
                  boxSizing: 'border-box', background: C.card,
                }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>최댓값</label>
              <input type="number" step="0.1" value={brixMax} onChange={(e) => setBrixMax(e.target.value)}
                placeholder="0.0" style={{
                  width: '100%', height: 38, padding: '0 10px',
                  border: `1.5px solid ${C.border}`, borderRadius: radius.sm,
                  fontSize: 14, fontFamily: font.base, color: C.text, outline: 'none',
                  boxSizing: 'border-box', background: C.card,
                }} />
            </div>
            <div style={{ flexShrink: 0 }}>
              <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: 'block', marginBottom: 4 }}>평균 (자동)</label>
              <div style={{
                height: 38, minWidth: 60, padding: '0 10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: brixAvg ? C.primaryLight : C.bgAlt,
                border: `1.5px solid ${brixAvg ? C.primaryMid : C.border}`,
                borderRadius: radius.sm, fontSize: 14, fontWeight: 700,
                color: brixAvg ? C.primary : C.muted2,
              }}>{brixAvg || '—'}</div>
            </div>
          </div>
        </div>

        {/* ── Save ── */}
        <button
          onClick={handleSave} disabled={saving}
          style={{
            width: '100%', height: 50, background: saving ? C.muted2 : C.primary,
            color: '#fff', border: 'none', borderRadius: radius.md,
            fontSize: 15, fontWeight: 700, cursor: saving ? 'default' : 'pointer',
            fontFamily: font.base, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {saving ? '저장 중...' : '상세내용 저장'}
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
            <span key={id} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
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
                  position: 'absolute', top: -5, right: -5,
                  width: 16, height: 16,
                  background: '#ef4444', color: '#fff', borderRadius: '50%',
                  fontSize: 10, fontWeight: 900,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', border: '1.5px solid #fff', padding: 0,
                }}
              >×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}



// ─── Photo requirement logic (sheet-driven) ──────────────────────────────────

/**
 * Build lookup maps from bootstrap config data.
 * - partnerToStandard: full partner name -> short standard name
 * - subCategoryEntries: list of { normalized, tokens, majorCategory } for product-name inference
 * - dangjdoRules: active rows from the "당도" sheet, filtered by 사용여부=TRUE
 */
function buildPhotoRequirementMaps(mappingRows, dangjdoRows) {
  const partnerToStandard  = {};
  const subCategoryEntries = [];
  const VALID_CATEGORIES   = ['채소', '과일', '축산', '수산'];

  for (const row of (mappingRows || [])) {
    const sub         = String(row['소분류명'] || '').trim();
    const major       = String(row['대분류']  || '').trim();
    const partnerFull = String(row['협력사']  || '').trim();
    const partnerShrt = String(row['값']      || '').trim();

    if (sub && VALID_CATEGORIES.includes(major)) {
      subCategoryEntries.push({
        normalized: sub.toLowerCase(),
        tokens: sub.split('/').map((t) => t.trim().toLowerCase()).filter(Boolean),
        majorCategory: major,
      });
    }
    if (partnerFull && partnerShrt) partnerToStandard[partnerFull] = partnerShrt;
  }

  // Active dangjdo rules: 사용여부 must be true / TRUE / Y / 1
  const dangjdoRules = [];
  for (const row of (dangjdoRows || [])) {
    const active = row['사용여부'];
    const isActive =
      active === true ||
      String(active).trim() === 'TRUE' ||
      String(active).trim() === '1' ||
      String(active).trim().toUpperCase() === 'Y';
    if (!isActive) continue;
    const partner  = String(row['협력사']  || '').trim();
    const code     = String(row['상품코드'] || '').trim();
    const label    = String(row['분류']    || '').trim();
    const required = parseInt(row['필요장수'], 10) || 0;
    if (label && required > 0) dangjdoRules.push({ partner, code, label, required });
  }

  return { partnerToStandard, subCategoryEntries, dangjdoRules };
}

function standardizePartnerName(name, partnerToStandard) {
  return partnerToStandard[String(name || '').trim()] || String(name || '').trim();
}

/** Infer major weight category from product name by matching subcategory tokens */
function inferWeightCategory(productName, subCategoryEntries) {
  const nameLower = (productName || '').toLowerCase();
  let bestMatch   = null;
  for (const entry of subCategoryEntries) {
    let matched = entry.normalized && nameLower.includes(entry.normalized);
    if (!matched) {
      for (const token of entry.tokens) {
        if (token && nameLower.includes(token)) { matched = true; break; }
      }
    }
    if (matched && (!bestMatch || entry.normalized.length > bestMatch.normalized.length)) {
      bestMatch = entry;
    }
  }
  return bestMatch ? bestMatch.majorCategory : null;
}

/**
 * Lookup dangjdo rule for a product.
 * Priority: 1) exact partner+code, 2) code-only fallback among active rules.
 */
function findDangjdoRule(productCode, partnerShort, dangjdoRules) {
  for (const rule of dangjdoRules) {
    if (rule.partner === partnerShort && rule.code === productCode) return rule;
  }
  for (const rule of dangjdoRules) {
    if (rule.code === productCode) return rule;
  }
  return null;
}

/**
 * Compact requirement status chip.
 * status: 'done' | 'partial' | 'missing'
 * prefix: "중량" or "당도"
 * text: "완료", "1/2", "미완료"
 */
function ReqChip({ prefix, label, status, text }) {
  const isDone    = status === 'done';
  const isPartial = status === 'partial';
  const bg     = isDone ? C.greenLight  : isPartial ? C.yellowLight  : C.redLight;
  const color  = isDone ? C.green       : isPartial ? C.yellow       : C.red;
  const border = isDone ? C.greenMid    : isPartial ? C.yellowMid    : C.redMid;
  const Icon   = isDone ? CheckCircle2  : AlertCircle;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      height: 24, padding: '0 9px',
      background: bg, color, border: `1px solid ${border}`,
      borderRadius: radius.full, fontSize: 10.5, fontWeight: 700,
    }}>
      <Icon size={10} strokeWidth={2.5} />
      <span style={{ fontWeight: 500, fontSize: 9.5 }}>{prefix}</span>
      {label}
      <span style={{ fontWeight: 600 }}>{text}</span>
    </span>
  );
}
