import React, { useEffect, useRef } from 'react';

const ACCENT     = '#5876a4';
const TEXT       = '#2c3a4e';
const TEXT_SOFT  = '#8090a8';
const BORDER     = '#d2dded';
const CARD_BG    = '#edf1f8';
const CARD_WHITE = '#ffffff';
const SHADOW     = 'rgba(70,100,150,0.16)';

// months = [{ month: number, label: string, days: [{ day: number, workers: string[] }] }]
export default function ScheduleModal({ months, loading, onClose }) {
  const bodyRef        = useRef(null);
  const currentRef     = useRef(null);
  const thisMonth      = new Date().getMonth() + 1;

  // Scroll to current month after first render
  useEffect(() => {
    if (currentRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = currentRef.current.offsetTop - 56; // 56 = sticky header height
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 400,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        ref={bodyRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: CARD_WHITE,
          borderRadius: '20px 20px 0 0',
          width: '100%', maxWidth: 480,
          maxHeight: '88vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
          fontFamily: "'Apple SD Gothic Neo','Pretendard',system-ui,-apple-system,sans-serif",
          boxShadow: `0 -4px 24px ${SHADOW}`,
        }}
      >
        {/* Sticky title bar */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 1,
          background: CARD_WHITE,
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px 12px',
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>근무 일정</span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: TEXT_SOFT, fontSize: 18, padding: 0, lineHeight: 1,
            }}
          >✕</button>
        </div>

        {/* Month sections */}
        <div style={{ padding: '4px 0 32px' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXT_SOFT, fontSize: 13 }}>
              불러오는 중…
            </div>
          ) : months.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXT_SOFT, fontSize: 13 }}>
              일정 데이터가 없습니다
            </div>
          ) : (
            months.map((m) => {
              const isCurrent = m.month === thisMonth;
              return (
                <div
                  key={m.month}
                  ref={isCurrent ? currentRef : null}
                  style={{ marginTop: 0 }}
                >
                  {/* Month title row */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '14px 20px 8px',
                    borderBottom: `2px solid ${isCurrent ? ACCENT : BORDER}`,
                    position: 'sticky', top: 47, zIndex: 1,
                    background: isCurrent ? '#f0f5ff' : CARD_BG,
                  }}>
                    <span style={{
                      fontSize: 13, fontWeight: 700,
                      color: isCurrent ? ACCENT : TEXT,
                    }}>
                      {m.label}
                    </span>
                    {isCurrent && (
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        background: '#dbeafe', color: '#2563eb',
                        borderRadius: 8, padding: '1px 7px',
                      }}>
                        이번달
                      </span>
                    )}
                  </div>

                  {/* Day list */}
                  <div style={{ padding: '4px 20px 8px' }}>
                    {m.days.map(({ day, workers }) => (
                      <div
                        key={day}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          padding: '5px 0',
                          borderBottom: `1px solid ${BORDER}`,
                        }}
                      >
                        <span style={{
                          fontSize: 12, color: TEXT_SOFT,
                          width: 28, flexShrink: 0, textAlign: 'right',
                        }}>
                          {day}일
                        </span>
                        <span style={{
                          fontSize: 12, fontWeight: 600,
                          color: workers.length > 0 ? TEXT : '#c0c8d4',
                        }}>
                          {workers.length > 0 ? workers.join(' · ') : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
