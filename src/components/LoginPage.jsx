import React, { useState } from 'react';
import gs25Logo from '../gs25-logo.svg';

const C = {
  bg: "#dce3ed",
  card: "#ffffff",
  accent: "#5876a4",
  accentDark: "#46669a",
  accentBg: "#d8e8f6",
  text: "#2c3a4e",
  textSoft: "#6878a0",
  textSecondary: "#8090a8",
  border: "#beccde",
  borderLight: "#d2dded",
  red: "#b85250",
  redBg: "#f5dfde",
  shadow: "rgba(70,100,150,0.09)",
  shadowMd: "rgba(70,100,150,0.16)",
  inputBg: "#f0f4fb",
};

export default function LoginPage({ onLogin, loading: externalLoading }) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const busy = submitting || !!externalLoading;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!id.trim() || !password.trim()) {
      setError('아이디와 비밀번호를 입력하세요.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onLogin(id.trim(), password.trim());
    } catch (err) {
      if (err.message === 'INVALID_CREDENTIALS') {
        setError('아이디나 비밀번호를 확인해주세요.');
      } else {
        setError('서버 문제');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      fontFamily: "'Apple SD Gothic Neo','Pretendard',system-ui,-apple-system,sans-serif",
    }}>
      <div style={{
        width: '100%',
        maxWidth: 360,
        background: C.card,
        borderRadius: 20,
        boxShadow: `0 8px 32px ${C.shadowMd}`,
        padding: '36px 28px 32px',
      }}>
        {/* Logo + title */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src={gs25Logo} alt="GS25" style={{ height: 32, marginBottom: 14 }} />
          <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>
            검품 시스템
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.textSecondary }}>
            로그인 후 이용 가능합니다
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} autoComplete="on">
          {/* ID field */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSoft, marginBottom: 6 }}>
              아이디
            </label>
            <input
              type="text"
              autoComplete="username"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="아이디 입력"
              disabled={busy}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '11px 14px', fontSize: 15,
                border: `1.5px solid ${C.border}`, borderRadius: 10,
                background: C.inputBg, color: C.text,
                fontFamily: 'inherit', outline: 'none',
                minHeight: 46, transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.border; }}
            />
          </div>

          {/* Password field */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.textSoft, marginBottom: 6 }}>
              비밀번호
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호 입력"
              disabled={busy}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '11px 14px', fontSize: 15,
                border: `1.5px solid ${C.border}`, borderRadius: 10,
                background: C.inputBg, color: C.text,
                fontFamily: 'inherit', outline: 'none',
                minHeight: 46, transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.border; }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: '10px 14px', marginBottom: 16,
              background: C.redBg, borderRadius: 8,
              border: `1px solid ${C.red}30`,
              fontSize: 13, color: C.red, fontWeight: 500,
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={busy}
            style={{
              width: '100%', minHeight: 48,
              background: busy ? C.textSecondary : C.accent,
              color: '#fff', border: 'none', borderRadius: 12,
              fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
              fontFamily: 'inherit',
              boxShadow: busy ? 'none' : `0 4px 16px ${C.accent}55`,
              transition: 'background 0.18s, box-shadow 0.18s',
            }}
          >
            {busy ? '처리 중...' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  );
}
