/**
 * Spinner — shared loading indicator for the whole app.
 *
 * Usage:
 *   <Spinner />                       // 20 px inline
 *   <Spinner size={32} />             // custom size
 *   <Spinner size={32} color="#2563eb" />
 *
 *   <LoadingScreen label="세션 확인 중..." />   // full-viewport
 *   <LoadingBlock  label="불러오는 중..." />    // content-area block
 */

import React from 'react';
import { C, font } from './styles';

// ── Core spinning arc ────────────────────────────────────────────────────────

export function Spinner({ size = 20, color = C.muted, trackColor = C.border, thickness = 2.5 }) {
  return (
    <span
      role="status"
      aria-label="로딩 중"
      style={{
        display:       'inline-block',
        width:         size,
        height:        size,
        borderRadius:  '50%',
        border:        `${thickness}px solid ${trackColor}`,
        borderTopColor: color,
        animation:     'spin 0.65s linear infinite',
        flexShrink:    0,
      }}
    />
  );
}

// ── Full-viewport loading screen (auth check, etc.) ──────────────────────────

export function LoadingScreen({ label = '불러오는 중...' }) {
  return (
    <div
      style={{
        minHeight:      '100vh',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            14,
        background:     '#dce3ed',
        fontFamily:     font.base,
      }}
    >
      <Spinner size={32} color="#4f6282" trackColor="rgba(255,255,255,0.35)" thickness={3} />
      <span style={{ fontSize: 13, fontWeight: 500, color: '#5a6e8a', letterSpacing: '0.01em' }}>
        {label}
      </span>
    </div>
  );
}

// ── In-content loading block (inside cards / modals / main pane) ─────────────

export function LoadingBlock({ label = '불러오는 중...' }) {
  return (
    <div
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            10,
        padding:        '28px 16px',
        fontFamily:     font.base,
        fontSize:       13,
        fontWeight:     500,
        color:          C.muted,
        letterSpacing:  '0.01em',
      }}
    >
      <Spinner size={18} color={C.muted} trackColor={C.border} thickness={2} />
      {label}
    </div>
  );
}
