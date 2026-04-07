// Design tokens — single source of truth for all components
export const C = {
  // Page / surface
  bg:         '#f1f5f9',   // slate-100
  bgAlt:      '#e8eef5',
  card:       '#ffffff',
  cardAlt:    '#f8fafc',   // slate-50

  // Borders
  border:     '#e2e8f0',   // slate-200
  borderMid:  '#cbd5e1',   // slate-300

  // Brand blue (slightly lighter, more modern)
  primary:    '#2563eb',   // blue-600
  primaryHov: '#1d4ed8',   // blue-700
  primaryLight:'#eff6ff',  // blue-50
  primaryMid: '#bfdbfe',   // blue-200
  primarySoft:'#93c5fd',   // blue-300

  // Success green
  green:      '#16a34a',   // green-600
  greenHov:   '#15803d',   // green-700
  greenLight: '#f0fdf4',   // green-50
  greenMid:   '#bbf7d0',   // green-200
  greenSoft:  '#dcfce7',   // green-100

  // Danger red
  red:        '#dc2626',   // red-600
  redHov:     '#b91c1c',   // red-700
  redLight:   '#fff1f2',
  redMid:     '#fecdd3',   // rose-200

  // Warning orange
  orange:     '#ea580c',   // orange-600
  orangeLight:'#fff7ed',   // orange-50
  orangeMid:  '#fed7aa',   // orange-200

  // Amber
  yellow:     '#d97706',   // amber-600
  yellowLight:'#fffbeb',   // amber-50
  yellowMid:  '#fde68a',   // amber-200

  // Typography
  text:       '#0f172a',   // slate-900
  textSec:    '#1e293b',   // slate-800
  muted:      '#64748b',   // slate-500
  muted2:     '#94a3b8',   // slate-400
  muted3:     '#cbd5e1',   // slate-300
};

export const shadow = {
  xs:    '0 1px 2px rgba(15,23,42,0.05)',
  sm:    '0 1px 3px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.04)',
  md:    '0 4px 16px rgba(15,23,42,0.08), 0 1px 4px rgba(15,23,42,0.04)',
  lg:    '0 12px 40px rgba(15,23,42,0.10), 0 2px 8px rgba(15,23,42,0.05)',
  xl:    '0 24px 56px rgba(15,23,42,0.13), 0 4px 16px rgba(15,23,42,0.06)',
  inset: 'inset 0 1px 3px rgba(15,23,42,0.07)',
  focus: '0 0 0 3px rgba(37,99,235,0.18)',
};

export const radius = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, full: 9999 };

export const font = { base: "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif" };

// Base transition
export const trans = 'all 0.15s ease';

// Surface card
export const cardStyle = {
  background: C.card,
  borderRadius: radius.lg,
  border: `1px solid ${C.border}`,
  boxShadow: shadow.md,
  overflow: 'hidden',
};

// Elevated card (modals, important panels)
export const cardElevated = {
  background: C.card,
  borderRadius: radius.xl,
  border: `1px solid ${C.border}`,
  boxShadow: shadow.lg,
  overflow: 'hidden',
};

export const inputStyle = {
  height: 42,
  padding: '0 14px',
  border: `1.5px solid ${C.border}`,
  borderRadius: radius.sm,
  // 16px minimum prevents iOS Safari from auto-zooming when the user taps an input.
  fontSize: 16,
  fontFamily: font.base,
  color: C.text,
  background: C.card,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};

export const btnPrimary = {
  height: 42,
  padding: '0 18px',
  background: C.primary,
  color: '#fff',
  border: 'none',
  borderRadius: radius.sm,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: font.base,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
  boxShadow: '0 1px 3px rgba(37,99,235,0.30)',
  letterSpacing: '0.01em',
  transition: 'background 0.15s, box-shadow 0.15s',
};

export const btnOutline = {
  height: 38,
  padding: '0 14px',
  background: 'transparent',
  color: C.primary,
  border: `1.5px solid ${C.primarySoft}`,
  borderRadius: radius.sm,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: font.base,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  whiteSpace: 'nowrap',
  transition: 'background 0.15s, border-color 0.15s',
};

export const btnGhost = {
  height: 34,
  padding: '0 12px',
  background: 'transparent',
  color: C.muted,
  border: `1px solid ${C.border}`,
  borderRadius: radius.sm,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: font.base,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  transition: 'background 0.15s',
};

