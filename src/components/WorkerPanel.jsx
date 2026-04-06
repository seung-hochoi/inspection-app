import React, { useEffect, useRef } from 'react';

const CARD_WHITE = '#ffffff';
const CARD_BG    = '#edf1f8';
const BORDER     = '#d2dded';
const TEXT       = '#2c3a4e';
const TEXT_SOFT  = '#8090a8';
const GREEN      = '#22c55e';
const GREEN_RING = '#bbf7d0';
const RED        = '#ef4444';
const RED_RING   = '#fecaca';
const SHADOW     = 'rgba(70,100,150,0.14)';

// workers = Array<{ name: string, cell: string }> | null
// Dot: cell === "휴무" → red, otherwise → green
// Label: cell === "지원" → append " (지원)"
export default function WorkerPanel({ workers, onClose }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const handle = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handle), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handle); };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: 86,
        right: 8,
        zIndex: 300,
        background: CARD_WHITE,
        borderRadius: 12,
        boxShadow: `0 4px 24px ${SHADOW}`,
        border: `1px solid ${BORDER}`,
        width: 170,
        overflow: 'hidden',
        fontFamily: "'Apple SD Gothic Neo','Pretendard',system-ui,-apple-system,sans-serif",
      }}
    >
      {/* Panel header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px',
        background: CARD_BG,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>오늘 근무</span>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: TEXT_SOFT, fontSize: 13, padding: 0, lineHeight: 1,
          }}
        >✕</button>
      </div>

      {/* Worker rows */}
      <div>
        {workers == null ? (
          <div style={{ padding: '12px 14px', fontSize: 12, color: TEXT_SOFT, textAlign: 'center' }}>
            불러오는 중…
          </div>
        ) : workers.length === 0 ? (
          <div style={{ padding: '12px 14px', fontSize: 12, color: TEXT_SOFT, textAlign: 'center' }}>
            근무자 없음
          </div>
        ) : (
          workers.map((w, i) => {
            const isOff     = w.cell === '휴무';
            const isSupport = w.cell === '지원';
            return (
              <div
                key={w.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 14px',
                  borderBottom: i < workers.length - 1 ? `1px solid ${BORDER}` : 'none',
                }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: isOff ? RED : GREEN,
                  boxShadow: `0 0 0 2px ${isOff ? RED_RING : GREEN_RING}`,
                  display: 'inline-block',
                }} />
                <span style={{
                  fontSize: 12, fontWeight: 600,
                  color: isOff ? TEXT_SOFT : TEXT,
                  whiteSpace: 'nowrap',
                }}>
                  {w.name}{isSupport ? ' (지원)' : ''}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}



