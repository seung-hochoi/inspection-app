import React, { useEffect, useRef } from 'react';
import { C, radius, font } from './styles';

/**
 * Toast — small temporary notification at bottom of screen.
 * Props: message (string), type ('success'|'error'|'info'), onDismiss (fn)
 */
export default function Toast({ message, type = 'info', onDismiss }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!message) return;
    timerRef.current = setTimeout(() => { onDismiss && onDismiss(); }, 2400);
    return () => clearTimeout(timerRef.current);
  }, [message, onDismiss]);

  if (!message) return null;

  const bg =
    type === 'success' ? C.green :
    type === 'error'   ? C.red   : '#1e293b';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)',
        zIndex: 9999, background: bg, color: '#fff',
        padding: '11px 22px', borderRadius: radius.full,
        fontSize: 14, fontWeight: 600, fontFamily: font.base,
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        pointerEvents: 'none', whiteSpace: 'nowrap',
        animation: 'slideUp 0.18s ease',
      }}
    >
      {message}
    </div>
  );
}
