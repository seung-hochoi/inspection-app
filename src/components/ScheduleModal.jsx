import React, { useState, useEffect, useRef } from 'react';

const ACCENT     = '#5876a4';
const TEXT       = '#2c3a4e';
const TEXT_SOFT  = '#8090a8';
const BORDER     = '#d2dded';
const CARD_BG    = '#edf1f8';
const CARD_WHITE = '#ffffff';
const SHADOW     = 'rgba(70,100,150,0.16)';

/**
 * Assign a calendar year to each month entry.
 * The backend returns months in sheet order (no year field).
 * We infer year by walking the array: whenever a month number decreases
 * relative to the previous one, we increment the working year.
 * Starting year: if the first month number <= today's month we start at
 * today's year; otherwise we start at today's year - 1.
 */
function assignYears(months) {
  if (!months || months.length === 0) return [];
  const todayYear  = new Date().getFullYear();
  const todayMonth = new Date().getMonth() + 1;
  let year = months[0].month <= todayMonth ? todayYear : todayYear - 1;
  const result = [];
  let prev = null;
  for (const m of months) {
    if (prev !== null && m.month <= prev) year += 1;
    result.push({ ...m, year });
    prev = m.month;
  }
  return result;
}

/**
 * Group year-annotated months into { year, months[] } buckets.
 */
function groupByYear(annotated) {
  const map = new Map();
  for (const m of annotated) {
    if (!map.has(m.year)) map.set(m.year, []);
    map.get(m.year).push(m);
  }
  return Array.from(map.entries()).map(([year, months]) => ({ year, months }));
}

// months = [{ month: number, label: string, days: [{ day: number, workers: string[] }] }]
export default function ScheduleModal({ months, loading, onClose }) {
  const now        = new Date();
  const thisYear   = now.getFullYear();
  const thisMonth  = now.getMonth() + 1;
  const bodyRef    = useRef(null);
  const currentRef = useRef(null); // ref on the current month's row

  // expandedYears: Set<number>
  const [expandedYears, setExpandedYears] = useState(() => new Set([thisYear]));
  // expandedMonths: Set<string>  key = `${year}-${month}`
  const [expandedMonths, setExpandedMonths] = useState(
    () => new Set([`${thisYear}-${thisMonth}`])
  );

  const toggleYear = (year) =>
    setExpandedYears((prev) => {
      const next = new Set(prev);
      next.has(year) ? next.delete(year) : next.add(year);
      return next;
    });

  const toggleMonth = (key) =>
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Scroll to current month once data is ready
  useEffect(() => {
    if (currentRef.current && bodyRef.current) {
      const offset = currentRef.current.offsetTop;
      bodyRef.current.scrollTop = Math.max(0, offset - 52);
    }
  }, [loading]);

  const yearGroups = groupByYear(assignYears(months));

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
        {/* ── Sticky title bar ─────────────────────────────────────────── */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 2,
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

        {/* ── Content ──────────────────────────────────────────────────── */}
        <div style={{ paddingBottom: 32 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXT_SOFT, fontSize: 13 }}>
              불러오는 중…
            </div>
          ) : yearGroups.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXT_SOFT, fontSize: 13 }}>
              일정 데이터가 없습니다
            </div>
          ) : yearGroups.map(({ year, months: yMonths }) => {
            const yearOpen    = expandedYears.has(year);
            const isThisYear  = year === thisYear;

            return (
              <div key={year}>
                {/* ── Level 1: Year header ─────────────────────────────── */}
                <button
                  onClick={() => toggleYear(year)}
                  style={{
                    width: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 20px',
                    background: isThisYear ? '#e8eef8' : '#dce4f0',
                    border: 'none',
                    borderBottom: `1px solid ${BORDER}`,
                    borderLeft: `4px solid ${isThisYear ? ACCENT : '#a0b0c8'}`,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 800, color: isThisYear ? ACCENT : TEXT }}>
                    {year}년
                  </span>
                  <span style={{
                    fontSize: 11, color: TEXT_SOFT,
                    display: 'inline-block',
                    transform: yearOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.18s ease',
                  }}>▼</span>
                </button>

                {/* ── Level 2: Month list (only when year is expanded) ──── */}
                {yearOpen && yMonths.map((m) => {
                  const monthKey  = `${year}-${m.month}`;
                  const isCurrent = isThisYear && m.month === thisMonth;
                  const monthOpen = expandedMonths.has(monthKey);

                  return (
                    <div
                      key={monthKey}
                      ref={isCurrent ? currentRef : null}
                    >
                      {/* Month header */}
                      <button
                        onClick={() => toggleMonth(monthKey)}
                        style={{
                          width: '100%',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '9px 20px 9px 28px',
                          background: isCurrent ? '#f0f5ff' : CARD_BG,
                          border: 'none',
                          borderBottom: `1px solid ${BORDER}`,
                          borderLeft: `3px solid ${isCurrent ? ACCENT : 'transparent'}`,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                        <span style={{
                          fontSize: 11, color: TEXT_SOFT,
                          display: 'inline-block',
                          transform: monthOpen ? 'rotate(180deg)' : 'none',
                          transition: 'transform 0.18s ease',
                        }}>▼</span>
                      </button>

                      {/* Day list */}
                      {monthOpen && (
                        <div style={{
                          background: CARD_WHITE,
                          borderBottom: `1px solid ${BORDER}`,
                        }}>
                          {m.days.map(({ day, workers }) => (
                            <div
                              key={day}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 14,
                                padding: '5px 20px 5px 32px',
                                borderBottom: '1px solid #f0f4f8',
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
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

