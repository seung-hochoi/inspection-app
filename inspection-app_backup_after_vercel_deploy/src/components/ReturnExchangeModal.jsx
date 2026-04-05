import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, ChevronDown, RotateCcw, Repeat2 } from 'lucide-react';
import { C, radius, font, cardStyle } from './styles';

/**
 * ReturnExchangeModal — records return (회송) or exchange (교환) movements.
 *
 * Props:
 *   product  { productCode, productName, partnerName, orderedQty }
 *   jobKey   string
 *   centers  string[]  — known center names derived from records (for dropdown)
 *   onSave({ type:'RETURN'|'EXCHANGE', centerName, qty, note })
 *   onClose()
 */
export default function ReturnExchangeModal({ product, jobKey, initialType, centers = [], accumulatedQty = 0, returnQty = 0, exchangeQty = 0, onSave, onClose }) {
  const [type, setType]               = useState(initialType || 'RETURN');
  const [centerName, setCenterName]   = useState('');
  const [customCenter, setCustomCenter] = useState('');
  const [useCustom, setUseCustom]     = useState(false);
  const [qty, setQty]                 = useState('');
  const [note, setNote]               = useState('');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const isReturn   = type === 'RETURN';
  const hasCenters = centers.length > 0;
  const typeLabel  = isReturn ? '회송' : '교환';
  const typeColor  = isReturn ? C.red : C.orange;

  // Quantity context shown below the qty label: 기존 / 입력 / 누적
  const existingQty  = isReturn ? returnQty : exchangeQty;
  const inputQty     = parseInt(qty, 10) || 0;
  const cumulativeQty = existingQty + inputQty;

  const resolvedCenter = hasCenters && !useCustom ? centerName : customCenter;

  const handleSave = async () => {
    const qtyNum = parseInt(qty, 10);
    if (isReturn && !resolvedCenter.trim()) { setError('센터명을 입력하세요.'); return; }
    if (!qtyNum || qtyNum <= 0) { setError('수량을 입력하세요.'); return; }
    setError('');
    setSaving(true);
    try {
      await onSave({ type, centerName: isReturn ? resolvedCenter.trim() : '', qty: qtyNum, note: note.trim() });
      onClose();
    } catch (err) {
      setError(err.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle = {
    width: '100%', height: 46, boxSizing: 'border-box',
    padding: '0 14px', border: `1.5px solid ${C.border}`,
    borderRadius: radius.md, fontSize: 15, fontFamily: font.base, color: C.text,
    background: C.card, outline: 'none',
    transition: 'border-color 0.15s',
  };
  const labelStyle = { fontSize: 11.5, fontWeight: 600, color: C.muted, marginBottom: 6, display: 'block', letterSpacing: '0.03em' };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        style={{
          ...cardStyle,
          width: '100%', maxWidth: 520,
          borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
          borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
          padding: '20px 20px 28px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>
              회송 / 교환 등록
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: C.muted }}>
              {product.productName} · {product.partnerName}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: C.bgAlt, border: `1px solid ${C.border}`,
              borderRadius: radius.sm, width: 34, height: 34,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: C.muted,
            }}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        {/* Type toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, background: C.bgAlt, padding: 4, borderRadius: radius.md }}>
          {[
            { key: 'RETURN',   label: '회송', color: C.red,    icon: <RotateCcw size={14} strokeWidth={2} /> },
            { key: 'EXCHANGE', label: '교환', color: C.orange, icon: <Repeat2   size={14} strokeWidth={2} /> },
          ].map(({ key, label, color, icon }) => (
            <button
              key={key}
              onClick={() => setType(key)}
              style={{
                flex: 1, height: 42, border: 'none',
                borderRadius: radius.sm, fontSize: 14, fontWeight: 700,
                cursor: 'pointer', fontFamily: font.base,
                background: type === key ? color : 'transparent',
                color:      type === key ? '#fff' : C.muted,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 0.15s',
                boxShadow: type === key ? `0 2px 8px rgba(0,0,0,0.15)` : 'none',
              }}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Center name — return only */}
        {isReturn && (
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>센터명 *</label>
          {hasCenters && !useCustom ? (
            <div style={{ position: 'relative' }}>
              <select
                value={centerName}
                onChange={(e) => {
                  if (e.target.value === '__custom__') { setUseCustom(true); setCenterName(''); }
                  else setCenterName(e.target.value);
                }}
                style={{
                  ...fieldStyle,
                  paddingRight: 36, appearance: 'none', cursor: 'pointer',
                }}
              >
                <option value="">센터 선택...</option>
                {centers.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.qty > 0 ? `${c.name} (${c.qty.toLocaleString()}개)` : c.name}
                  </option>
                ))}
                <option value="__custom__">직접 입력</option>
              </select>
              <ChevronDown
                size={15} strokeWidth={2} color={C.muted2}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              />
            </div>
          ) : !hasCenters ? (
            <div>
              <div style={{
                marginBottom: 8, padding: '8px 12px',
                background: C.bgAlt, borderRadius: radius.sm,
                border: `1px solid ${C.border}`,
              }}>
                <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
                  ⚠ 센터 목록을 불러올 수 없습니다. 직접 입력해 주세요.
                </p>
              </div>
              <input
                style={fieldStyle}
                placeholder="센터명 직접 입력"
                value={customCenter}
                onChange={(e) => setCustomCenter(e.target.value)}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...fieldStyle, flex: 1 }}
                placeholder="센터명 직접 입력"
                value={customCenter}
                onChange={(e) => setCustomCenter(e.target.value)}
              />
              <button
                onClick={() => { setUseCustom(false); setCustomCenter(''); }}
                style={{
                  height: 46, padding: '0 12px', border: `1.5px solid ${C.border}`,
                  borderRadius: radius.md, background: C.bgAlt, color: C.muted,
                  fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: font.base,
                  whiteSpace: 'nowrap',
                }}
              >
                목록에서 선택
              </button>
            </div>
          )}
        </div>
        )}

        {/* Qty */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>
            {typeLabel} 수량 *
            {product.orderedQty
              ? <span style={{ fontWeight: 400, color: C.muted, marginLeft: 5 }}>(발주: {Number(product.orderedQty).toLocaleString()})</span>
              : null}
          </label>
          {/* Quantity context: 기존 / 입력 / 누적 — updates live as user types */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, marginTop: -2 }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              기존 <strong style={{ color: existingQty > 0 ? typeColor : '#6b7280' }}>{existingQty.toLocaleString()}개</strong>
            </span>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>·</span>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              입력 <strong style={{ color: inputQty > 0 ? C.text : '#6b7280' }}>{inputQty.toLocaleString()}개</strong>
            </span>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>·</span>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              누적 <strong style={{ color: cumulativeQty > 0 ? typeColor : '#6b7280' }}>{cumulativeQty.toLocaleString()}개</strong>
            </span>
          </div>
          <input
            style={fieldStyle}
            type="number" inputMode="numeric" placeholder="0"
            value={qty} onChange={(e) => setQty(e.target.value)} min={1}
          />
        </div>

        {/* Note */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>비고</label>
          <input
            style={fieldStyle}
            placeholder="비고 (선택)"
            value={note} onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && (
          <p style={{
            color: C.red, fontSize: 13, marginBottom: 12,
            padding: '9px 13px', background: C.redLight, borderRadius: radius.sm,
            border: `1px solid ${C.redMid}`,
          }}>
            {error}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: '100%', height: 50, border: 'none',
            background: saving ? C.muted2 : typeColor,
            color: '#fff', borderRadius: radius.md,
            fontSize: 15, fontWeight: 700, cursor: saving ? 'default' : 'pointer',
            fontFamily: font.base, letterSpacing: '0.01em',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: saving ? 'none' : `0 2px 8px rgba(0,0,0,0.18)`,
            transition: 'background 0.15s',
          }}
        >
          {type === 'RETURN' ? <RotateCcw size={16} strokeWidth={2} /> : <Repeat2 size={16} strokeWidth={2} />}
          {saving ? '저장 중...' : `${typeLabel} 등록`}
        </button>
      </motion.div>
    </motion.div>
  );
}
