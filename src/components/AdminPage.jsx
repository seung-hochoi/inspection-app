/**
 * AdminPage — full admin management panel, visible only to ADMIN role.
 *
 * Sections:
 *   사용자 관리  – User Management
 *   세션 관리    – Active Session Management
 *   로그         – Audit Log Viewer
 *   공지 관리    – Notice Management
 *   설정         – System Settings
 *   권한 정책    – Role/Permission Policy (read-only)
 *   데이터 관리  – Data Operations
 *   대표이미지   – Product Representative Image Management
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Users, MonitorCheck, FileText, Bell, Settings, Shield, Database, Image, RefreshCw, Plus, Trash2, Edit2, Check, X, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { C, radius, font, shadow } from './styles';
import {
  listUsers, createUser, updateUser,
  listSessions, forceLogoutSession,
  listAuditLogs,
  listNotices, saveNotice, deleteNotice,
  getSystemSettings, saveSystemSettings,
  listProductImages, deleteProductImage,
  manualRecalc, syncHistory, resetCurrentJobInputData,
} from '../api';

// ── Shared style helpers ──────────────────────────────────────────────────────

const PANEL = {
  background: '#fff',
  borderRadius: radius.md,
  border: `1px solid ${C.border}`,
  boxShadow: shadow.sm,
  padding: '16px',
  marginBottom: 12,
};

const BTN_BASE = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 12px', borderRadius: radius.sm,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  fontFamily: font.base, border: 'none', whiteSpace: 'nowrap',
  transition: 'opacity 0.15s',
};

const BTN = {
  primary: { ...BTN_BASE, background: C.accent, color: '#fff' },
  danger:  { ...BTN_BASE, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' },
  ghost:   { ...BTN_BASE, background: C.bgAlt || '#f1f5f9', color: C.text, border: `1px solid ${C.border}` },
};

const TH = {
  fontSize: 11, fontWeight: 700, color: C.textSoft || C.muted,
  padding: '6px 8px', textAlign: 'left', borderBottom: `1px solid ${C.border}`,
  background: C.bgAlt || '#f8fafc',
};
const TD = {
  fontSize: 12, padding: '6px 8px', borderBottom: `1px solid ${C.borderLight}`,
  color: C.text, verticalAlign: 'middle',
};

function SectionTitle({ children }) {
  return (
    <h2 style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: '0 0 12px 0', letterSpacing: '-0.01em' }}>
      {children}
    </h2>
  );
}

function StatusBadge({ value }) {
  const on = String(value).toUpperCase() === 'TRUE' || value === true;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px',
      borderRadius: 99, letterSpacing: '0.02em',
      background: on ? '#dcfce7' : '#fee2e2',
      color: on ? '#166534' : '#b91c1c',
      border: `1px solid ${on ? '#bbf7d0' : '#fca5a5'}`,
    }}>
      {on ? '활성' : '비활성'}
    </span>
  );
}

function RoleBadge({ role }) {
  const colors = {
    ADMIN:    { bg: '#f5f3ff', color: '#7c3aed', border: '#ddd6fe' },
    MANAGER:  { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
    INSPECTOR:{ bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
    VIEWER:   { bg: '#f8fafc', color: '#475569', border: '#e2e8f0' },
  };
  const s = colors[String(role).toUpperCase()] || colors.VIEWER;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99, ...s, border: `1px solid ${s.border}` }}>
      {role}
    </span>
  );
}

function Spinner() {
  return <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} color={C.accent} />;
}

// ── 1. User Management ────────────────────────────────────────────────────────

function UserManagement({ showToast }) {
  const [users, setUsers]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [editTarget, setEditTarget] = useState(null); // null=create, obj=edit
  const [form, setForm]             = useState({ id: '', name: '', role: 'INSPECTOR', password: '', active: 'TRUE', note: '' });
  const [saving, setSaving]         = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listUsers();
      setUsers(res.users || []);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { reload(); }, [reload]);

  const openCreate = () => { setForm({ id: '', name: '', role: 'INSPECTOR', password: '', active: 'TRUE', note: '' }); setEditTarget(null); setShowForm(true); };
  const openEdit   = (u) => {
    setForm({ id: u.ID, name: u.NAME, role: u.ROLE, password: '', active: u.ACTIVE || 'TRUE', note: u.NOTE || '' });
    setEditTarget(u);
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editTarget) {
        await updateUser({ id: form.id, name: form.name, role: form.role, active: form.active, note: form.note, ...(form.password ? { password: form.password } : {}) });
        showToast('사용자 정보가 수정되었습니다.', 'success');
      } else {
        await createUser({ id: form.id, name: form.name, role: form.role, password: form.password, note: form.note });
        showToast('사용자가 생성되었습니다.', 'success');
      }
      setShowForm(false);
      reload();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (u) => {
    const newActive = u.ACTIVE === 'TRUE' ? 'FALSE' : 'TRUE';
    try {
      await updateUser({ id: u.ID, active: newActive });
      showToast(newActive === 'TRUE' ? '활성화되었습니다.' : '비활성화되었습니다.', 'success');
      reload();
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionTitle>사용자 관리</SectionTitle>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={BTN.ghost} onClick={reload}><RefreshCw size={12} />새로고침</button>
          <button style={BTN.primary} onClick={openCreate}><Plus size={12} />사용자 추가</button>
        </div>
      </div>

      {showForm && (
        <div style={{ ...PANEL, background: '#f8fafc', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{editTarget ? '사용자 수정' : '사용자 추가'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {!editTarget && <Field label="ID" value={form.id}       onChange={v => setForm(p => ({ ...p, id: v }))}  placeholder="로그인 ID" />}
            <Field label="이름"   value={form.name}     onChange={v => setForm(p => ({ ...p, name: v }))} placeholder="이름" />
            <Field label="비밀번호" value={form.password} onChange={v => setForm(p => ({ ...p, password: v }))} placeholder={editTarget ? '변경시만 입력' : '비밀번호'} type="password" />
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textSoft, display: 'block', marginBottom: 3 }}>역할</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} style={{ width: '100%', padding: '5px 8px', borderRadius: radius.sm, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: font.base }}>
                {['INSPECTOR','MANAGER','VIEWER','ADMIN'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {editTarget && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.textSoft, display: 'block', marginBottom: 3 }}>상태</label>
                <select value={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.value }))} style={{ width: '100%', padding: '5px 8px', borderRadius: radius.sm, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: font.base }}>
                  <option value="TRUE">활성</option>
                  <option value="FALSE">비활성</option>
                </select>
              </div>
            )}
            <Field label="메모" value={form.note} onChange={v => setForm(p => ({ ...p, note: v }))} placeholder="메모 (선택)" />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
            <button style={BTN.ghost} onClick={() => setShowForm(false)}>취소</button>
            <button style={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? <Spinner /> : <Check size={12} />}{saving ? '저장 중' : '저장'}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>{['ID','이름','역할','상태','마지막 로그인','메모','액션'].map(h => <th key={h} style={TH}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.ID}>
                  <td style={TD}><span style={{ fontWeight: 700 }}>{u.ID}</span></td>
                  <td style={TD}>{u.NAME}</td>
                  <td style={TD}><RoleBadge role={u.ROLE} /></td>
                  <td style={TD}><StatusBadge value={u.ACTIVE} /></td>
                  <td style={TD}><span style={{ fontSize: 11, color: C.textSoft }}>{u.LAST_LOGIN_AT || '-'}</span></td>
                  <td style={TD}><span style={{ fontSize: 11, color: C.textSoft }}>{u.NOTE || '-'}</span></td>
                  <td style={TD}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button style={{ ...BTN.ghost, padding: '3px 8px', fontSize: 11 }} onClick={() => openEdit(u)}><Edit2 size={10} />수정</button>
                      <button style={{ ...BTN.ghost, padding: '3px 8px', fontSize: 11 }} onClick={() => toggleActive(u)}>
                        {u.ACTIVE === 'TRUE' ? '비활성화' : '활성화'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: C.textSoft, padding: 24 }}>사용자가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: C.textSoft, display: 'block', marginBottom: 3 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', padding: '5px 8px', borderRadius: radius.sm, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: font.base, boxSizing: 'border-box' }} />
    </div>
  );
}

// ── 2. Session Management ─────────────────────────────────────────────────────

function SessionManagement({ showToast }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSessions();
      setSessions(res.sessions || []);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { reload(); }, [reload]);

  const forceOut = async (token) => {
    try {
      await forceLogoutSession(token);
      showToast('강제 로그아웃 완료', 'success');
      reload();
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionTitle>세션 관리</SectionTitle>
        <button style={BTN.ghost} onClick={reload}><RefreshCw size={12} />새로고침</button>
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>{['사용자 ID','이름','역할','로그인 시간','만료 시간','IP','강제 로그아웃'].map(h => <th key={h} style={TH}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={i}>
                  <td style={TD}>{s.USER_ID || s.userId || '-'}</td>
                  <td style={TD}>{s.USER_NAME || s.userName || '-'}</td>
                  <td style={TD}><RoleBadge role={s.ROLE || s.role || 'VIEWER'} /></td>
                  <td style={TD}><span style={{ fontSize: 11 }}>{s.CREATED_AT || s.createdAt || '-'}</span></td>
                  <td style={TD}><span style={{ fontSize: 11 }}>{s.EXPIRES_AT || s.expiresAt || '-'}</span></td>
                  <td style={TD}><span style={{ fontSize: 11 }}>{s.IP_ADDRESS || '-'}</span></td>
                  <td style={TD}>
                    <button style={{ ...BTN.danger, padding: '3px 8px', fontSize: 11 }} onClick={() => forceOut(s.SESSION_TOKEN || s.sessionToken || '')}>
                      로그아웃
                    </button>
                  </td>
                </tr>
              ))}
              {!sessions.length && <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: C.textSoft, padding: 24 }}>활성 세션이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 3. Audit Log Viewer ───────────────────────────────────────────────────────

function LogViewer({ showToast }) {
  const [logs, setLogs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filters, setFilters]     = useState({ userId: '', action: '', result: '', dateFrom: '', dateTo: '' });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAuditLogs(filters);
      setLogs(res.logs || []);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [filters, showToast]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <SectionTitle>감사 로그</SectionTitle>
        <button style={BTN.ghost} onClick={reload}><RefreshCw size={12} />새로고침</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {[['userId','사용자 ID'],['action','액션'],['result','결과'],['dateFrom','날짜(부터)'],['dateTo','날짜(까지)']].map(([k, label]) => (
          <div key={k}>
            <label style={{ fontSize: 10, fontWeight: 600, color: C.textSoft, display: 'block', marginBottom: 2 }}>{label}</label>
            <input value={filters[k]} onChange={e => setFilters(p => ({ ...p, [k]: e.target.value }))}
              placeholder={label} style={{ padding: '4px 7px', borderRadius: radius.sm, border: `1px solid ${C.border}`, fontSize: 11, fontFamily: font.base, width: 110 }} />
          </div>
        ))}
        <div style={{ alignSelf: 'flex-end' }}>
          <button style={BTN.primary} onClick={reload}><RefreshCw size={11} />조회</button>
        </div>
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div> : (
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead style={{ position: 'sticky', top: 0 }}>
              <tr>{['시간','사용자','역할','액션','대상','결과','메시지'].map(h => <th key={h} style={TH}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={TD}>{l['LOGGED_AT'] || '-'}</td>
                  <td style={TD}>{l['USER_ID'] || '-'}</td>
                  <td style={TD}><RoleBadge role={l['ROLE'] || 'VIEWER'} /></td>
                  <td style={TD}><span style={{ fontWeight: 600 }}>{l['ACTION'] || '-'}</span></td>
                  <td style={TD}>{l['TARGET_KEY'] || l['PRODUCT_CODE'] || '-'}</td>
                  <td style={TD}>{l['RESULT'] || '-'}</td>
                  <td style={{ ...TD, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l['MESSAGE']}>{l['MESSAGE'] || ''}</td>
                </tr>
              ))}
              {!logs.length && <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: C.textSoft, padding: 24 }}>로그가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 4. Notice Management ──────────────────────────────────────────────────────

function NoticeManagement({ showToast }) {
  const [notices, setNotices]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm]           = useState({ id: '', title: '', content: '', active: true, pinned: false });
  const [saving, setSaving]       = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listNotices();
      setNotices(res.notices || []);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { reload(); }, [reload]);

  const openCreate = () => { setForm({ id: '', title: '', content: '', active: true, pinned: false }); setEditTarget(null); setShowForm(true); };
  const openEdit   = (n) => { setForm({ id: n.ID, title: n.TITLE, content: n.CONTENT, active: n.ACTIVE === 'TRUE', pinned: n.PINNED === 'TRUE' }); setEditTarget(n); setShowForm(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveNotice({ id: form.id || undefined, title: form.title, content: form.content, active: form.active, pinned: form.pinned });
      showToast('공지가 저장되었습니다.', 'success');
      setShowForm(false);
      reload();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('공지를 삭제하시겠습니까?')) return;
    try {
      await deleteNotice(id);
      showToast('삭제되었습니다.', 'success');
      reload();
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionTitle>공지 관리</SectionTitle>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={BTN.ghost} onClick={reload}><RefreshCw size={12} />새로고침</button>
          <button style={BTN.primary} onClick={openCreate}><Plus size={12} />공지 추가</button>
        </div>
      </div>

      {showForm && (
        <div style={{ ...PANEL, background: '#f8fafc', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{editTarget ? '공지 수정' : '공지 추가'}</div>
          <Field label="제목" value={form.title} onChange={v => setForm(p => ({ ...p, title: v }))} placeholder="공지 제목" />
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.textSoft, display: 'block', marginBottom: 3 }}>내용</label>
            <textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} placeholder="공지 내용"
              rows={4} style={{ width: '100%', padding: '6px 8px', borderRadius: radius.sm, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: font.base, boxSizing: 'border-box', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
              <input type="checkbox" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} />활성
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
              <input type="checkbox" checked={form.pinned} onChange={e => setForm(p => ({ ...p, pinned: e.target.checked }))} />상단 고정
            </label>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
            <button style={BTN.ghost} onClick={() => setShowForm(false)}>취소</button>
            <button style={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? <Spinner /> : <Check size={12} />}{saving ? '저장 중' : '저장'}</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div> : (
        <div>
          {notices.map(n => (
            <div key={n.ID} style={{ ...PANEL, marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {n.PINNED === 'TRUE' && <span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: 99, padding: '1px 5px', fontWeight: 700 }}>📌 고정</span>}
                  <StatusBadge value={n.ACTIVE} />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{n.TITLE}</span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: C.textSoft, whiteSpace: 'pre-wrap' }}>{n.CONTENT}</p>
                <span style={{ fontSize: 10, color: C.textSoft, marginTop: 4, display: 'block' }}>{n.CREATED_AT}</span>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button style={{ ...BTN.ghost, padding: '3px 8px', fontSize: 11 }} onClick={() => openEdit(n)}><Edit2 size={10} />수정</button>
                <button style={{ ...BTN.danger, padding: '3px 8px', fontSize: 11 }} onClick={() => handleDelete(n.ID)}><Trash2 size={10} />삭제</button>
              </div>
            </div>
          ))}
          {!notices.length && <p style={{ textAlign: 'center', color: C.textSoft, padding: 24 }}>공지가 없습니다.</p>}
        </div>
      )}
    </div>
  );
}

// ── 5. System Settings ────────────────────────────────────────────────────────

function SystemSettings({ showToast }) {
  const [settings, setSettings] = useState({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSystemSettings();
      setSettings(res.settings || {});
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { reload(); }, [reload]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSystemSettings(settings);
      showToast('설정이 저장되었습니다.', 'success');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const LABELS = {
    session_expiry_hours:  '세션 만료 시간 (시간)',
    maintenance_mode:      '점검 모드 (true/false)',
    daily_reset_hour_kst:  '일일 초기화 시각 (KST 시)',
    daily_backup_hour_kst: '일일 백업 시각 (KST 시)',
    system_banner:         '시스템 배너 메시지',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionTitle>시스템 설정</SectionTitle>
        <button style={BTN.ghost} onClick={reload}><RefreshCw size={12} />새로고침</button>
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div> : (
        <div>
          {Object.entries(settings).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.text, width: 220, flexShrink: 0 }}>
                {LABELS[k] || k}
              </label>
              <input value={String(v)} onChange={e => setSettings(p => ({ ...p, [k]: e.target.value }))}
                style={{ flex: 1, padding: '5px 8px', borderRadius: radius.sm, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: font.base }} />
            </div>
          ))}
          <button style={{ ...BTN.primary, marginTop: 8 }} onClick={handleSave} disabled={saving}>
            {saving ? <Spinner /> : <Check size={12} />}{saving ? '저장 중' : '저장'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── 6. Permission Policy ──────────────────────────────────────────────────────

const ROLE_POLICY = {
  ADMIN:     ['VIEW','EDIT_INSPECTION','EDIT_RETURN_EXCHANGE','UPLOAD_PHOTO','DOWNLOAD_ZIP','VIEW_LOG','MANAGE_USERS','MANAGE_NOTICES','MANAGE_SETTINGS','MANAGE_DATA','MANAGE_PRODUCT_IMAGES'],
  MANAGER:   ['VIEW','EDIT_INSPECTION','EDIT_RETURN_EXCHANGE','UPLOAD_PHOTO','DOWNLOAD_ZIP'],
  INSPECTOR: ['VIEW','EDIT_INSPECTION','UPLOAD_PHOTO'],
  VIEWER:    ['VIEW'],
};

const PERM_LABELS = {
  VIEW:                  '기본 조회',
  EDIT_INSPECTION:       '검품 수량 입력',
  EDIT_RETURN_EXCHANGE:  '회송/교환 입력',
  UPLOAD_PHOTO:          '사진 업로드',
  DOWNLOAD_ZIP:          'ZIP 다운로드',
  VIEW_LOG:              '감사 로그 조회',
  MANAGE_USERS:          '사용자 관리',
  MANAGE_NOTICES:        '공지 관리',
  MANAGE_SETTINGS:       '시스템 설정',
  MANAGE_DATA:           '데이터 관리',
  MANAGE_PRODUCT_IMAGES: '대표이미지 관리',
};

function PermissionPolicy() {
  const allPerms = Object.keys(PERM_LABELS);
  const roles    = ['ADMIN','MANAGER','INSPECTOR','VIEWER'];
  return (
    <div>
      <SectionTitle>권한 정책 (읽기 전용)</SectionTitle>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={TH}>권한</th>
              {roles.map(r => <th key={r} style={{ ...TH, textAlign: 'center' }}><RoleBadge role={r} /></th>)}
            </tr>
          </thead>
          <tbody>
            {allPerms.map(p => (
              <tr key={p}>
                <td style={{ ...TD, fontWeight: 600 }}>{PERM_LABELS[p]}<br /><span style={{ fontSize: 10, color: C.textSoft, fontWeight: 400 }}>{p}</span></td>
                {roles.map(r => (
                  <td key={r} style={{ ...TD, textAlign: 'center' }}>
                    {ROLE_POLICY[r].includes(p)
                      ? <Check size={14} color="#16a34a" strokeWidth={2.5} />
                      : <X size={14} color="#d1d5db" strokeWidth={2} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: C.textSoft, marginTop: 8 }}>※ 권한 정책 변경은 Code.gs의 ROLE_PERMISSIONS_ 객체를 직접 수정해 주세요.</p>
    </div>
  );
}

// ── 7. Data Operations ────────────────────────────────────────────────────────

function DataOperations({ showToast }) {
  const [busy, setBusy] = useState('');

  const run = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      showToast(label + ' 완료', 'success');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setBusy(''); }
  };

  const ops = [
    { key: 'recalc',  label: '수동 재계산 (manualRecalc)', icon: RefreshCw, fn: manualRecalc, color: C.accent, bg: '#eff6ff' },
    { key: 'history', label: '이력 동기화 (syncHistory)',    icon: Database,  fn: syncHistory,  color: '#16a34a', bg: '#f0fdf4' },
  ];

  return (
    <div>
      <SectionTitle>데이터 관리</SectionTitle>
      <p style={{ fontSize: 12, color: C.textSoft, marginBottom: 12 }}>
        주의: 아래 작업은 실제 시트 데이터에 영향을 줍니다. 필요할 때만 실행하세요.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ops.map(({ key, label, icon: Icon, fn, color, bg }) => (
          <button key={key} disabled={!!busy} onClick={() => run(label, fn)}
            style={{ ...BTN_BASE, background: bg, color, border: `1px solid ${color}44`, padding: '8px 16px', fontSize: 12.5, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
            {busy === label ? <Spinner /> : <Icon size={13} />}
            {busy === label ? '실행 중...' : label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 8. Product Image Management ───────────────────────────────────────────────

function ProductImageManagement({ showToast }) {
  const [images, setImages]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listProductImages();
      setImages(res.images || []);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { reload(); }, [reload]);

  const handleDelete = async (mapKey) => {
    if (!window.confirm('이미지 매핑을 삭제하시겠습니까?')) return;
    try {
      await deleteProductImage(mapKey);
      showToast('삭제되었습니다.', 'success');
      reload();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const filtered = search
    ? images.filter(img => (img['상품명'] || '').includes(search) || (img['상품코드'] || '').includes(search) || (img['협력사명'] || '').includes(search))
    : images;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionTitle>대표이미지 관리</SectionTitle>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="상품명/코드/협력사 검색"
            style={{ padding: '5px 8px', borderRadius: radius.sm, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: font.base, width: 180 }} />
          <button style={BTN.ghost} onClick={reload}><RefreshCw size={12} />새로고침</button>
        </div>
      </div>
      <p style={{ fontSize: 11, color: C.textSoft, marginBottom: 10 }}>
        대표이미지 등록은 각 상품 행의 이미지 영역에서 직접 할 수 있습니다 (ADMIN 전용).
        여기서는 삭제만 가능합니다.
      </p>
      {loading ? <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {filtered.map(img => (
            <div key={img['맵키'] || img['상품코드']} style={{ ...PANEL, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {img['파일ID'] ? (
                <img src={`https://drive.google.com/thumbnail?id=${img['파일ID']}&sz=w160`} alt={img['상품명']}
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', borderRadius: radius.sm, background: '#f1f5f9' }} loading="lazy" />
              ) : (
                <div style={{ width: '100%', aspectRatio: '1', background: '#f1f5f9', borderRadius: radius.sm, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Image size={24} color={C.textSoft} strokeWidth={1.5} />
                </div>
              )}
              <div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.text }}>{img['상품명'] || '-'}</p>
                <p style={{ margin: 0, fontSize: 11, color: C.textSoft }}>{img['상품코드']} · {img['협력사명'] || '-'}</p>
              </div>
              <button style={{ ...BTN.danger, justifyContent: 'center', fontSize: 11 }} onClick={() => handleDelete(img['맵키'])}>
                <Trash2 size={10} />삭제
              </button>
            </div>
          ))}
          {!filtered.length && <p style={{ textAlign: 'center', color: C.textSoft, padding: 24, gridColumn: '1/-1' }}>이미지가 없습니다.</p>}
        </div>
      )}
    </div>
  );
}

// ── Root AdminPage component ──────────────────────────────────────────────────

const ADMIN_TABS = [
  { key: 'users',    label: '사용자 관리', icon: Users },
  { key: 'sessions', label: '세션 관리',   icon: MonitorCheck },
  { key: 'logs',     label: '로그',        icon: FileText },
  { key: 'notices',  label: '공지 관리',   icon: Bell },
  { key: 'settings', label: '설정',        icon: Settings },
  { key: 'policy',   label: '권한 정책',   icon: Shield },
  { key: 'data',     label: '데이터 관리', icon: Database },
  { key: 'images',   label: '대표이미지',  icon: Image },
];

export default function AdminPage({ showToast }) {
  const [tab, setTab] = useState('users');

  return (
    <div style={{ padding: '12px 12px 80px', maxWidth: 900, margin: '0 auto' }}>
      {/* Admin header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Shield size={18} color="#7c3aed" strokeWidth={2} />
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#7c3aed', letterSpacing: '-0.02em' }}>관리자 메뉴</h1>
        <span style={{ fontSize: 10, fontWeight: 700, background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: 99, padding: '1px 7px' }}>ADMIN ONLY</span>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16, background: '#fff', padding: 8, borderRadius: radius.md, border: `1px solid ${C.border}`, boxShadow: shadow.sm }}>
        {ADMIN_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            ...BTN_BASE,
            background: tab === t.key ? '#7c3aed' : 'transparent',
            color:      tab === t.key ? '#fff' : C.text,
            border: tab === t.key ? 'none' : `1px solid transparent`,
            fontWeight: tab === t.key ? 700 : 500,
          }}>
            <t.icon size={12} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={PANEL}>
        {tab === 'users'    && <UserManagement     showToast={showToast} />}
        {tab === 'sessions' && <SessionManagement  showToast={showToast} />}
        {tab === 'logs'     && <LogViewer          showToast={showToast} />}
        {tab === 'notices'  && <NoticeManagement   showToast={showToast} />}
        {tab === 'settings' && <SystemSettings     showToast={showToast} />}
        {tab === 'policy'   && <PermissionPolicy />}
        {tab === 'data'     && <DataOperations     showToast={showToast} />}
        {tab === 'images'   && <ProductImageManagement showToast={showToast} />}
      </div>
    </div>
  );
}
