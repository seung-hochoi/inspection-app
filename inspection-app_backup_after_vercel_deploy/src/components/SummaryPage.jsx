import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, AlertTriangle, Lock, BarChart3, Package, TrendingUp, ArrowDownLeft, ArrowLeftRight, Database, Download, FolderDown } from 'lucide-react';
import clsx from 'clsx';
import { C, radius, font, shadow, trans } from './styles';
import { manualRecalc, resetCurrentJobInputData, syncHistory } from '../api';
import { buildAndDownloadPhotoZips } from '../utils/photoZipBuilder';

export default function SummaryPage({ summary = {}, happycall = {}, onToast, onRefresh }) {
  const [recalcing, setRecalcing] = useState(false);
  const [syncing,   setSyncing]   = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetPw,   setResetPw]   = useState('');
  const [downloading, setDownloading] = useState('');   // active mode key
  const [dlProgress,  setDlProgress]  = useState({ stage: '', percent: 0, text: '' });

  const handleRecalc = async () => {
    setRecalcing(true);
    try {
      await manualRecalc();
      await onRefresh?.();
      onToast?.('재계산 완료', 'success');
    } catch (err) {
      onToast?.(err.message || '재계산 실패', 'error');
    } finally { setRecalcing(false); }
  };

  const handleSyncHistory = async () => {
    setSyncing(true);
    try {
      await syncHistory();
      onToast?.('이력관리 기록 완료', 'success');
    } catch (err) {
      onToast?.(err.message || '이력관리 기록 실패', 'error');
    } finally { setSyncing(false); }
  };

  const handleReset = async () => {
    if (!resetPw) { onToast?.('비밀번호를 입력하세요.', 'error'); return; }
    setResetting(true);
    try {
      await resetCurrentJobInputData(resetPw);
      setShowReset(false); setResetPw('');
      onToast?.('초기화 완료', 'success');
      onRefresh?.();
    } catch (err) {
      onToast?.(err.message || '초기화 실패 (비밀번호 확인)', 'error');
    } finally { setResetting(false); }
  };

  // Download a single photo ZIP category
  const handleDownloadZip = async (mode) => {
    setDownloading(mode);
    setDlProgress({ stage: 'generating', percent: 10, text: 'ZIP 생성 중...' });
    try {
      const { count, parts } = await buildAndDownloadPhotoZips(mode, { onProgress: setDlProgress });
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

  // Download all 4 categories sequentially
  const handleDownloadAll = async () => {
    setDownloading('all');
    const modes = [
      { mode: 'inspection', label: '검품사진' },
      { mode: 'movement',   label: '불량사진' },
      { mode: 'weight',     label: '중량사진' },
      { mode: 'sugar',      label: '당도사진' },
    ];
    let totalFiles = 0;
    let totalParts = 0;
    try {
      for (const { mode, label } of modes) {
        setDlProgress({ stage: 'generating', percent: 10, text: `${label} ZIP 생성 중...` });
        const { count, parts } = await buildAndDownloadPhotoZips(mode, { onProgress: setDlProgress });
        totalFiles += count;
        totalParts += parts;
      }
      if (totalFiles === 0) {
        onToast?.('다운로드할 사진이 없습니다.', 'info');
      } else {
        onToast?.(`전체 ${totalFiles}장 / ${totalParts}개 파일 다운로드 시작`, 'success');
      }
    } catch (err) {
      onToast?.(err.message || '전체 다운로드 실패', 'error');
    } finally {
      setDownloading('');
      setDlProgress({ stage: '', percent: 0, text: '' });
    }
  };

  const s = summary || {};
  const totalProducts   = s['총상품수']   || s.totalProducts  || 0;
  const totalOrdered    = s['총발주수량'] || s.totalOrdered   || 0;
  const totalInspected  = s['총검품수량'] || s.totalInspected || 0;
  const totalReturn     = s['총회송수량'] || s.totalReturn    || 0;
  const totalExchange   = s['총교환수량'] || s.totalExchange  || 0;
  const partnerSummaries = s['협력사별']  || s.partners       || [];

  // Format raw decimal ratio (e.g. 0.0284) as percentage string (e.g. "2.8%")
  const inspectionRate = (() => {
    const raw = s['검품률'] ?? s.inspectionRate;
    if (raw === undefined || raw === null || raw === '' || raw === '-') return '0%';
    const n = parseFloat(raw);
    if (isNaN(n)) return String(raw);
    return (n < 2 ? n * 100 : n).toFixed(1) + '%';
  })();

  const kpis = [
    { label: '총 상품수',   value: totalProducts,  color: C.primary, bg: C.primaryLight, border: C.primaryMid,  icon: <Package size={16} strokeWidth={2} />    },
    { label: '총 발주수량', value: totalOrdered,   color: C.textSec, bg: C.bgAlt,        border: C.border,     icon: <BarChart3 size={16} strokeWidth={2} />  },
    { label: '검품수량',    value: totalInspected, color: C.green,   bg: C.greenLight,   border: C.greenMid,   icon: <TrendingUp size={16} strokeWidth={2} /> },
    { label: '검품률',      value: inspectionRate, color: C.primary, bg: C.primaryLight, border: C.primaryMid, icon: <TrendingUp size={16} strokeWidth={2} />  },
    { label: '회송수량',    value: totalReturn,    color: C.red,     bg: C.redLight,     border: C.redMid,     icon: <ArrowDownLeft size={16} strokeWidth={2} /> },
    { label: '교환수량',    value: totalExchange,  color: C.orange,  bg: C.orangeLight,  border: C.orangeMid,  icon: <ArrowLeftRight size={16} strokeWidth={2} /> },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      style={{ padding: '14px 12px 80px' }}
    >
      {/* KPI grid — 2 columns, 3 rows */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 9, marginBottom: 18 }}>
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: i * 0.04 }}
            style={{
              background: k.bg, borderRadius: radius.md,
              border: `1px solid ${k.border}`,
              padding: '13px 12px 11px',
              boxShadow: shadow.xs,
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <p style={{ margin: 0, fontSize: 9.5, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: font.base }}>{k.label}</p>
              <span style={{ color: k.color, opacity: 0.65 }}>{k.icon}</span>
            </div>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: k.color, fontFamily: font.base, lineHeight: 1, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{String(k.value)}</p>
          </motion.div>
        ))}
      </div>

      {/* Per-partner table */}
      {Array.isArray(partnerSummaries) && partnerSummaries.length > 0 && (
        <div style={{
          background: C.card, borderRadius: radius.lg,
          border: `1px solid ${C.border}`, boxShadow: shadow.sm,
          marginBottom: 16, overflow: 'hidden',
        }}>
          <div style={{
            padding: '11px 16px', borderBottom: `1px solid ${C.border}`,
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>협력사별 현황</p>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, fontFamily: font.base }}>
              <thead>
                <tr style={{ background: C.bgAlt }}>
                  {['협력사', '발주', '검품', '회송', '교환', '검품률'].map((h) => (
                    <th key={h} style={{
                      padding: '8px 12px', textAlign: h === '협력사' ? 'left' : 'right',
                      color: C.muted2, fontWeight: 700, fontSize: 10.5,
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      borderBottom: `1px solid ${C.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {partnerSummaries.map((p, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '9px 12px', fontWeight: 600, color: C.text }}>{p['협력사명'] || p.name || '-'}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: C.textSec, fontWeight: 500 }}>{p['발주수량'] || p.ordered || 0}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: C.green, fontWeight: 600 }}>{p['검품수량'] || p.inspected || 0}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: C.red, fontWeight: 600 }}>{p['회송수량'] || p.returned || 0}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: C.orange, fontWeight: 600 }}>{p['교환수량'] || p.exchanged || 0}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: C.primary, fontWeight: 700 }}>{p['검품률'] || p.rate || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Photo ZIP download section ── */}
      <div style={{
        background: C.card, borderRadius: radius.lg,
        border: `1px solid ${C.border}`, boxShadow: shadow.sm,
        overflow: 'hidden', marginBottom: 16,
      }}>
        <div style={{
          padding: '11px 16px', borderBottom: `1px solid ${C.border}`,
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <FolderDown size={14} strokeWidth={2} color={C.muted} />
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>사진 다운로드</p>
        </div>
        <div style={{ padding: '14px 14px 12px' }}>
          {/* 4 individual category buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            {[
              { mode: 'inspection', label: '검품사진 저장', color: C.primary,  bg: C.primaryLight,  border: C.primaryMid  },
              { mode: 'movement',   label: '불량사진 저장', color: C.red,       bg: C.redLight,      border: C.redMid      },
              { mode: 'weight',     label: '중량사진 저장', color: C.muted,     bg: C.bgAlt,         border: C.borderMid   },
              { mode: 'sugar',      label: '당도사진 저장', color: C.green,     bg: C.greenLight,    border: C.greenMid    },
            ].map(({ mode, label, color, bg, border }) => {
              const active = downloading === mode;
              const busy   = !!downloading;
              return (
                <button
                  key={mode}
                  onClick={() => handleDownloadZip(mode)}
                  disabled={busy}
                  className="action-btn"
                  style={{
                    height: 40, background: active ? C.bgAlt : bg,
                    color: active ? C.muted2 : color,
                    border: `1.5px solid ${active ? C.border : border}`,
                    borderRadius: radius.sm, fontSize: 12.5, fontWeight: 600,
                    cursor: busy ? 'default' : 'pointer',
                    fontFamily: font.base, transition: trans,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    opacity: busy && !active ? 0.5 : 1,
                  }}
                >
                  <Download size={12} strokeWidth={2} style={{ animation: active ? 'none' : 'none', flexShrink: 0 }} />
                  {active ? (dlProgress.text || '처리 중...') : label}
                </button>
              );
            })}
          </div>
          {/* 전체 다운로드 — all 4 categories */}
          <button
            onClick={handleDownloadAll}
            disabled={!!downloading}
            className="action-btn"
            style={{
              width: '100%', height: 42,
              background: downloading === 'all' ? C.bgAlt : C.primaryLight,
              color: downloading === 'all' ? C.muted2 : C.primary,
              border: `1.5px solid ${downloading === 'all' ? C.border : C.primaryMid}`,
              borderRadius: radius.sm, fontSize: 13, fontWeight: 700,
              cursor: downloading ? 'default' : 'pointer',
              fontFamily: font.base, transition: trans,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}
          >
            <FolderDown size={14} strokeWidth={2} />
            {downloading === 'all' ? (dlProgress.text || '처리 중...') : '전체 다운로드'}
          </button>
          {/* Progress bar */}
          {!!downloading && dlProgress.percent > 0 && (
            <div style={{ marginTop: 8, borderRadius: radius.xs, overflow: 'hidden', background: C.border, height: 3 }}>
              <div style={{
                height: '100%', width: `${dlProgress.percent}%`,
                background: C.primary, transition: 'width 0.4s ease',
              }} />
            </div>
          )}
        </div>
      </div>

      {/* Admin panel */}
      <div style={{
        background: C.card, borderRadius: radius.lg,
        border: `1px solid ${C.border}`, boxShadow: shadow.sm,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '11px 16px', borderBottom: `1px solid ${C.border}`,
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>관리</p>
        </div>
        <div style={{ padding: '14px 14px 16px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={handleRecalc} disabled={recalcing} className="action-btn" style={{
              flex: '1 1 45%', height: 42,
              background: recalcing ? C.bgAlt : C.primaryLight, color: recalcing ? C.muted2 : C.primary,
              border: `1.5px solid ${recalcing ? C.border : C.primaryMid}`, borderRadius: radius.sm,
              fontSize: 13, fontWeight: 600, cursor: recalcing ? 'default' : 'pointer',
              fontFamily: font.base, transition: trans,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}>
              <RefreshCw size={13} strokeWidth={2} style={{ animation: recalcing ? 'spin 1s linear infinite' : 'none' }} />
              {recalcing ? '처리 중...' : '수동 재계산'}
            </button>
            <button onClick={handleSyncHistory} disabled={syncing} className="action-btn" style={{
              flex: '1 1 45%', height: 42,
              background: syncing ? C.bgAlt : '#f0fdf4', color: syncing ? C.muted2 : '#16a34a',
              border: `1.5px solid ${syncing ? C.border : '#86efac'}`, borderRadius: radius.sm,
              fontSize: 13, fontWeight: 600, cursor: syncing ? 'default' : 'pointer',
              fontFamily: font.base, transition: trans,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}>
              <Database size={13} strokeWidth={2} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
              {syncing ? '기록 중...' : '이력관리 기록'}
            </button>
            <button onClick={() => setShowReset((v) => !v)} className="action-btn" style={{
              flex: '1 1 100%', height: 42,
              background: C.redLight, color: C.red,
              border: `1.5px solid ${C.redMid}`, borderRadius: radius.sm,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: font.base, transition: trans,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}>
              <AlertTriangle size={13} strokeWidth={2} />
              초기화
            </button>
          </div>

          {showReset && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.2 }}
              style={{
                marginTop: 12, padding: '12px 14px', borderRadius: radius.sm,
                background: C.redLight, border: `1px solid ${C.redMid}`,
                overflow: 'hidden',
              }}
            >
              <p style={{ fontSize: 12, color: C.red, margin: '0 0 8px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                <AlertTriangle size={12} strokeWidth={2} />
                현재 작업 입력 데이터가 모두 삭제됩니다.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <Lock size={13} strokeWidth={2} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.muted2, pointerEvents: 'none' }} />
                  <input
                    type="password" placeholder="비밀번호"
                    value={resetPw} onChange={(e) => setResetPw(e.target.value)}
                    style={{
                      width: '100%', height: 40, padding: '0 12px 0 32px', boxSizing: 'border-box',
                      border: `1.5px solid ${C.redMid}`, borderRadius: radius.sm,
                      fontSize: 14, fontFamily: font.base, color: C.text, outline: 'none',
                      background: '#fff',
                    }}
                  />
                </div>
                <button onClick={handleReset} disabled={resetting} style={{
                  height: 40, padding: '0 18px',
                  background: resetting ? C.muted2 : C.red, color: '#fff',
                  border: 'none', borderRadius: radius.sm,
                  fontSize: 13, fontWeight: 700, cursor: resetting ? 'default' : 'pointer',
                  fontFamily: font.base,
                }}>{resetting ? '처리 중...' : '확인'}</button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
