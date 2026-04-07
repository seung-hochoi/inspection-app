import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import { ClipboardCheck, FileText, BarChart3, RefreshCw, Database, AlertTriangle, Lock, Download, FolderDown, LogOut, BookOpen } from 'lucide-react';
import gs25Logo from './gs25-logo.svg';
import InspectionPage from './components/InspectionPage';
import RecordsPage from './components/RecordsPage';
import SummaryPage from './components/SummaryPage';
import CriteriaPage from './components/CriteriaPage';
import LoginPage from './components/LoginPage';
import WorkerPanel from './components/WorkerPanel';
import ScheduleModal from './components/ScheduleModal';
import { manualRecalc, syncHistory, resetCurrentJobInputData, fetchHistoryData, fetchWorkSchedule, fetchFullSchedule, login as apiLogin, validateSession, logout as apiLogout, setSessionToken, listSessions, forceLogoutSession, fetchBootstrapParallel } from './api'; // eslint-disable-line no-unused-vars
import { flushSync as flushPendingSync } from './utils/syncScheduler';
import { buildAndDownloadPhotoZips } from './utils/photoZipBuilder';
import { LoadingScreen, LoadingBlock } from './components/Spinner';

// ============================================================
// SECTION 1: CONSTANTS / CONFIG
// ============================================================

// ── URL / storage keys ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzIR8srYEDBgHOUKGfs0J3nk2BY4fsDPiw0J5cHfXUU7t77cEPWYw15mdUcW0T7oCw7Xg/exec";
const PENDING_KEY = "inspection_pending_v2";

// ── Tab definitions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TABS = [
  { key: "inspection", label: "검품",    icon: ClipboardCheck },
  { key: "records",    label: "기록",    icon: FileText },
  { key: "summary",    label: "요약",    icon: BarChart3 },
  { key: "criteria",   label: "검품기준", icon: BookOpen },
];

// ── Color palette ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const C = {
  bg: "#dce3ed",
  card: "#edf1f8",
  cardWhite: "#ffffff",
  accent: "#5876a4",
  accentDark: "#46669a",
  accentBg: "#d8e8f6",
  accentBgStrong: "#c0d4eb",
  green: "#4a9068",
  greenBg: "#d6f0e4",
  red: "#b85250",
  redBg: "#f5dfde",
  orange: "#c07840",
  orangeBadge: "#c07818",
  orangeBg: "#fce8d0",
  text: "#2c3a4e",
  textMid: "#47587a",
  textSoft: "#6878a0",
  textSecondary: "#8090a8",
  border: "#beccde",
  borderLight: "#d2dded",
  inputBg: "#e8eef8",
  shadow: "rgba(70,100,150,0.09)",
  shadowMd: "rgba(70,100,150,0.16)",
  // aliases kept for unchanged components
  primary: "#5876a4",
  primaryDark: "#46669a",
  gray: "#8090a8",
  textDark: "#2c3a4e",
};

// ── Style objects ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const S = {
  app: {
    minHeight: "100vh",
    background: C.bg,
    fontFamily: "'Apple SD Gothic Neo','Pretendard',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    position: "fixed",
    top: 0, left: 0, right: 0, zIndex: 100,
    background: C.cardWhite,
    boxShadow: `0 2px 14px ${C.shadow}`,
    borderBottom: `1px solid ${C.borderLight}`,
  },
  headerMain: {
    height: 60,
    display: "flex",
    alignItems: "center",
    padding: "0 16px",
    gap: 10,
  },
  actionStrip: {
    height: 44,
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    gap: 5,
    overflowX: "auto",
    borderTop: `1px solid ${C.borderLight}`,
    scrollbarWidth: "none",  // Firefox
    msOverflowStyle: "none", // IE/Edge
  },
  headerIcon: {
    width: 34, height: 34, borderRadius: 9,
    background: `linear-gradient(135deg, ${C.accent} 0%, #3b82f6 100%)`,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
    boxShadow: "0 2px 8px rgba(37,99,235,0.28)",
  },
  headerTitle: { fontSize: 16, fontWeight: 800, color: C.text, margin: 0, lineHeight: 1.2, letterSpacing: "-0.02em" },
  headerSub: { fontSize: 11, color: C.textSecondary, margin: 0, lineHeight: 1.2, marginTop: 1 },
  headerRight: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 },
  tabBar: {
    position: "fixed",
    bottom: 0, left: 0, right: 0, zIndex: 100,
    background: C.cardWhite,
    borderTop: `1px solid ${C.borderLight}`,
    display: "flex",
    height: 60,
    boxShadow: `0 -2px 14px ${C.shadow}`,
  },
  tabBtn: {
    flex: 1,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    gap: 3, border: "none", background: "transparent",
    cursor: "pointer", fontSize: 11, fontWeight: 600,
    color: C.textSecondary, padding: "4px 0",
    fontFamily: "inherit",
    transition: "color 0.18s",
  },
  tabBtnActive: { color: C.accent },
  tabIcon: { fontSize: 20 },
  content: { flex: 1, paddingTop: 130, paddingBottom: 68 },
  card: {
    background: C.cardWhite,
    borderRadius: 14,
    boxShadow: `0 2px 12px ${C.shadow}`,
    margin: "8px 12px",
    padding: 16,
  },
  cardNoPad: {
    background: C.cardWhite,
    borderRadius: 14,
    boxShadow: `0 2px 12px ${C.shadow}`,
    margin: "8px 12px",
    overflow: "hidden",
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 },
  metaText: { fontSize: 12, color: C.textSecondary },
  btnPrimary: {
    background: C.accent, color: "#fff",
    border: "none", borderRadius: 10,
    padding: "10px 18px", fontSize: 14, fontWeight: 600,
    cursor: "pointer", minHeight: 42,
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    fontFamily: "inherit",
    boxShadow: `0 2px 8px ${C.shadow}`,
  },
  btnSecondary: {
    background: C.cardWhite, color: C.textMid,
    border: `1.5px solid ${C.border}`,
    borderRadius: 10, padding: "10px 16px",
    fontSize: 14, fontWeight: 600,
    cursor: "pointer", minHeight: 42,
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    fontFamily: "inherit",
  },
  btnDanger: {
    background: C.redBg, color: C.red,
    border: `1px solid ${C.red}30`,
    borderRadius: 8, padding: "8px 14px",
    fontSize: 13, fontWeight: 600,
    cursor: "pointer", minHeight: 38,
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
    fontFamily: "inherit",
  },
  btnIcon: {
    background: "transparent", border: "none", cursor: "pointer",
    padding: 8, minWidth: 44, minHeight: 44,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: 8, fontSize: 18, fontFamily: "inherit",
  },
  btnStepper: {
    background: C.accent, color: "#fff",
    border: "none", borderRadius: 8,
    width: 44, height: 44, fontSize: 20, fontWeight: 700,
    cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, fontFamily: "inherit",
  },
  input: {
    border: `1.5px solid ${C.border}`,
    borderRadius: 10, padding: "10px 12px",
    fontSize: 15, fontFamily: "inherit", outline: "none",
    width: "100%", boxSizing: "border-box",
    minHeight: 46, color: C.text, background: C.cardWhite,
    transition: "border-color 0.15s",
  },
  inputSmall: {
    border: `1.5px solid ${C.border}`,
    borderRadius: 8, padding: "8px 12px",
    fontSize: 13, fontFamily: "inherit", outline: "none",
    width: "100%", boxSizing: "border-box",
    minHeight: 38, color: C.text, background: C.cardWhite,
  },
  qtyInput: {
    border: `1.5px solid ${C.border}`,
    borderRadius: 8, padding: "8px",
    fontSize: 20, fontWeight: 700, textAlign: "center",
    width: 80, minHeight: 46, color: C.text,
    background: C.cardWhite, boxSizing: "border-box",
    fontFamily: "inherit",
  },
  searchRow: { display: "flex", gap: 8, alignItems: "center", margin: "8px 12px" },
  badge: { borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 700, display: "inline-block", lineHeight: "18px" },
  badgeBlue: { background: C.accentBg, color: C.accent },
  badgeGreen: { background: C.greenBg, color: C.green },
  badgeRed: { background: C.redBg, color: C.red },
  badgeOrange: { background: C.orangeBg, color: C.orange },
  badgeGray: { background: C.borderLight, color: C.textSoft },
  productCard: { borderBottom: `1px solid ${C.borderLight}`, padding: "12px 16px" },
  productName: { fontSize: 15, fontWeight: 700, color: C.text, margin: 0 },
  productCode: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  partnerHeader: {
    width: "100%",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 16px",
    background: `linear-gradient(90deg, ${C.card} 0%, ${C.cardWhite} 100%)`,
    border: "none", cursor: "pointer",
    borderBottom: `1px solid ${C.borderLight}`,
    fontFamily: "inherit",
  },
  partnerTitle: { fontSize: 15, fontWeight: 700, color: C.text },
  partnerCount: {
    fontSize: 12, color: C.accent,
    background: C.accentBg, borderRadius: 12,
    padding: "2px 9px", fontWeight: 700,
  },
  statusDot: { width: 9, height: 9, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  toast: {
    position: "fixed", bottom: 72, left: "50%",
    transform: "translateX(-50%)",
    background: "#1e2a3a", color: "#fff",
    borderRadius: 10, padding: "10px 20px",
    fontSize: 14, fontWeight: 600, zIndex: 9999,
    whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.22)",
    pointerEvents: "none",
  },
  modalOverlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
    zIndex: 500, display: "flex", alignItems: "flex-end", justifyContent: "center",
  },
  modalBox: {
    background: C.cardWhite, borderRadius: "20px 20px 0 0",
    width: "100%", maxWidth: 640, maxHeight: "90vh",
    overflow: "auto", padding: 20, boxSizing: "border-box",
  },
  scannerOverlay: { position: "fixed", inset: 0, background: "#000", zIndex: 600, display: "flex", flexDirection: "column" },
  row: { display: "flex", gap: 8, alignItems: "center" },
  rowBetween: { display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" },
  divider: { height: 1, background: C.borderLight, margin: "8px 0" },
  emptyBox: { padding: 40, textAlign: "center", color: C.textSecondary, fontSize: 14 },
  hidden: { display: "none" },
  label: { fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 4, display: "block" },
  infoBox: {
    background: C.accentBg, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: "10px 14px",
    fontSize: 13, color: C.accent, margin: "8px 12px",
  },
  errorBox: {
    background: C.redBg, border: `1px solid ${C.red}30`,
    borderRadius: 10, padding: "10px 14px",
    fontSize: 13, color: C.red, margin: "8px 12px",
  },
  summaryCard: {
    background: C.cardWhite, borderRadius: 12, padding: "14px 16px",
    flex: "1 1 130px", minWidth: 120, boxShadow: `0 2px 8px ${C.shadow}`, textAlign: "center",
  },
  summaryCardValue: { fontSize: 26, fontWeight: 800, color: C.text, margin: 0 },
  summaryCardLabel: { fontSize: 12, color: C.textSecondary, marginTop: 4 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    background: C.card, padding: "8px 10px",
    textAlign: "left", fontSize: 12, fontWeight: 700,
    color: C.textSecondary, borderBottom: `1px solid ${C.border}`,
  },
  td: {
    padding: "8px 10px",
    borderBottom: `1px solid ${C.borderLight}`,
    color: C.text, fontSize: 13,
  },
};

// ── Work schedule: compute today's rows for the panel ────────────────────────
// Only 김민석 and 최승호 are shown. Red dot if "휴무", green otherwise.
const CORE_WORKERS = ['김민석', '최승호'];

function computeWorkers(workers) {
  const today = String(new Date().getDate());
  return CORE_WORKERS.map((name) => {
    const w = workers.find((r) => String(r.name || '').trim() === name);
    const cell = String(w?.days?.[today] ?? '').trim();
    return { name, cell };
  });
}

// ============================================================
// SECTION 2: API HELPERS
// ============================================================

// ── Low-level fetch wrapper (→ SCRIPT_URL defined in SECTION 1) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const postApi = async (body) => {
  const resp = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok || data.ok === false) {
    const err = new Error(data.message || "API 오류");
    err.isLogicalError = true;
    throw err;
  }
  return data;
};

const retryApi = async (fn, retries = 3, delay = 2000) => {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      // Do NOT retry server-side logical rejections (conflict, version mismatch, etc.)
      if (err.isLogicalError) throw err;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delay));
      else throw err;
    }
  }
};


// ============================================================
// SECTION 3: SAVE PAYLOAD HELPERS
// ============================================================

// buildInspPayload and buildMovPayload were extracted to src/savePayload.js.
// ProductRow.jsx imports them via:
//   import { buildInspPayload, buildMovPayload } from '../savePayload';
// No inline payload-building functions remain in App.js.

// ============================================================
// SECTION 4: PHOTO HELPERS
// ============================================================

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve({ name: file.name, type: file.type || "application/octet-stream", data: base64 });
    };
    reader.onerror = () => reject(new Error("사진 읽기 실패"));
    reader.readAsDataURL(file);
  });


// ============================================================
// SECTION 5: BOOTSTRAP / LOADERS
// ============================================================

// ── String / value normalizers (required by CSV row builders below) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const normalizeKey = (key) => String(key || "").replace(/\uFEFF/g, "").trim();

const normalizeText = (value) =>
  String(value ?? "").replace(/\uFEFF/g, "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

const normalizeProductCode = (value) => {
  if (value == null) return "";
  let text = String(value).replace(/\uFEFF/g, "").trim();
  const tMatch = text.match(/^=T\("(.+)"\)$/i);
  if (tMatch) text = tMatch[1];
  text = text.replace(/^"+|"+$/g, "").trim();
  const numericText = text.replace(/,/g, "").trim();
  if (/^\d+(\.0+)?$/.test(numericText)) return numericText.replace(/\.0+$/, "");
  return text;
};

const parseQty = (value) => {
  const num = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isNaN(num) ? 0 : num;
};

const clampText = (value, maxLength = 4000) => {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 7))}...(생략)`;
};

const hashString = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return String(hash);
};

const computeJobKey = (rows) =>
  `job_${hashString(JSON.stringify((rows || []).map((r) => ({
    productCode: r.__productCode,
    productName: r.__productName,
    center: r.__center,
    partner: r.__partner,
    qty: r.__qty,
  }))))}`;


// ── Job key / CSV row builders ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const decodeCsvFile = async (file) => {
  const buffer = await file.arrayBuffer();
  const tryDecode = (enc) => new TextDecoder(enc).decode(buffer);
  const isBroken = (t) => (t.match(/\uFFFD/g) || []).length > 5;
  let text = tryDecode("utf-8");
  if (isBroken(text)) text = tryDecode("euc-kr");
  return { text };
};

const getValue = (row, candidates) => {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return "";
};

const buildNormalizedRows = (parsedRows) =>
  (parsedRows || []).map((rawRow, index) => {
    const row = {};
    Object.keys(rawRow || {}).forEach((k) => { row[normalizeKey(k)] = rawRow[k]; });

    const productCode = normalizeProductCode(
      getValue(row, ["상품코드", "상품 코드", "바코드", "코드"]) || row.__productCode || ""
    );
    const productName = String(
      getValue(row, ["상품명", "상품 명", "품목명", "품명"]) || row.__productName || ""
    ).trim();
    const rawPartner = getValue(
      row,
      ["협력사명(구매조건명)", "협력사명", "거래처명(구매조건명)", "거래처명", "협력사"]
    ) || row.__partner || "";
    const partner = String(rawPartner).trim();
    const center = String(getValue(row, ["센터명", "센터"]) || row.__center || "").trim();
    const qty = parseQty(getValue(row, ["총 발주수량", "발주수량", "수량"]) || row.__qty || 0);

    return {
      ...row,
      // Canonical Korean field names — used by groupByPartner, PartnerGroup, ProductRow
      '협력사명':     partner,
      '상품코드':     productCode,
      '상품명':       productName,
      '센터명':       center,
      '발주수량':     qty,
      '전체발주수량': qty,
      __id: `${productCode || "empty"}-${center || "nocenter"}-${partner || "nopartner"}-${index}`,
      __index: index,
      __productCode: productCode,
      __productName: productName,
      __partner: partner,
      __center: center,
      __qty: qty,
      __productNameNormalized: normalizeText(productName),
      __partnerNormalized: normalizeText(partner),
      // Precomputed lowercase string for fast search filtering — avoids repeated
      // toLowerCase() and normalizeCode() calls inside every PartnerGroup render.
      __searchKey: `${productName.toLowerCase()} ${productCode.toLowerCase()}`,
    };
  });


// ============================================================
// SECTION 6: STATE HELPERS
// ============================================================

// ── Date / display formatters ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const formatDateTime = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("ko-KR");
};

const formatDateShort = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("ko-KR");
};

const getRecordType = (record) => {
  const t = String(record.처리유형 || "").trim();
  if (t) return t;
  if (parseQty(record.회송수량) > 0) return "회송";
  if (parseQty(record.교환수량) > 0) return "교환";
  return "기타";
};


// ============================================================
// SECTION 7: ACTION HANDLERS
// ============================================================

// NOTE: Top-level action handlers (showToast, loadBootstrap,
// handleProductImageUploaded, handleCsvUpload) live inside the
// App component below because they depend on React state setters.
// They are marked inline with a sub-group comment inside App().

// ============================================================
// SECTION 8: RENDER HELPERS
// ============================================================

// NOTE: No standalone render-helper functions exist in App.js.
// Tab rendering is handled by InspectionPage, RecordsPage, and
// SummaryPage (imported from src/components/*).
// The main App component JSX is in SECTION 9 below.

// ============================================================
// SECTION 9: UI COMPONENTS (inline)
// ============================================================

// ── Small utility components ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function AppToast({ toast }) {
  if (!toast.message) return null;
  const bg =
    toast.type === "error" ? "#dc2626" : toast.type === "success" ? "#16a34a" : "#1e293b";
  return <div style={{ ...S.toast, background: bg }}>{toast.message}</div>;
}

function Modal({ title, onClose, children }) {
  return (
    <div style={S.modalOverlay} onClick={onClose}>
      <div style={S.modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...S.rowBetween, marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.textDark }}>{title}</h3>
          <button onClick={onClose} style={S.btnIcon}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Admin: Active Sessions Modal ─────────────────────────────────────────────
function ActiveSessionsModal({ onClose, showToast }) {
  const [sessions, setSessions]   = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [forcing,  setForcing]    = useState(null);

  useEffect(() => {
    listSessions()
      .then((res) => setSessions(res.sessions || []))
      .catch((err) => showToast(err.message || '세션 목록 불러오기 실패', 'error'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleForce = async (token) => {
    setForcing(token);
    try {
      await forceLogoutSession(token);
      setSessions((prev) => prev.filter((s) => s.SESSION_TOKEN !== token));
      showToast('강제 로그아웃 완료', 'success');
    } catch (err) {
      showToast(err.message || '강제 로그아웃 실패', 'error');
    } finally {
      setForcing(null);
    }
  };

  // Shorten UA string for display (keep browser + OS readable)
  const shortUa = (ua) => {
    if (!ua) return '-';
    // Try to extract a recognisable fragment: "Chrome/NNN", "Firefox/NNN", "Safari/NNN", etc.
    const m = ua.match(/(Chrome|Firefox|Safari|Edge|OPR|SamsungBrowser)\/[\d.]+/);
    const browser = m ? m[0] : null;
    const os = ua.includes('Windows') ? 'Windows'
             : ua.includes('Mac')     ? 'Mac'
             : ua.includes('Android') ? 'Android'
             : ua.includes('iPhone') || ua.includes('iPad') ? 'iOS'
             : ua.includes('Linux')   ? 'Linux' : null;
    if (browser || os) return [browser, os].filter(Boolean).join(' / ');
    return ua.length > 38 ? ua.slice(0, 38) + '…' : ua;
  };

  return (
    <Modal title="접속중인 사용자" onClose={onClose}>
      {loading ? (
        <LoadingBlock label="불러오는 중..." />
      ) : sessions.length === 0 ? (
        <div style={S.emptyBox}>활성 세션이 없습니다.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ ...S.table, fontSize: 12, minWidth: 760 }}>
            <thead>
              <tr>
                {['USER_ID', 'USER_NAME', 'ROLE', 'IP', 'BROWSER / OS', 'CREATED_AT', 'LAST_SEEN_AT', 'EXPIRES_AT', ''].map((h) => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.SESSION_TOKEN}>
                  <td style={S.td}>{s.USER_ID}</td>
                  <td style={S.td}>{s.USER_NAME}</td>
                  <td style={S.td}>{s.ROLE}</td>
                  <td style={{ ...S.td, fontFamily: "'SF Mono','Menlo','Consolas',monospace", fontSize: 11 }}>
                    {s.IP_ADDRESS || '-'}
                  </td>
                  <td style={{ ...S.td, maxWidth: 160 }} title={s.USER_AGENT || ''}>
                    {shortUa(s.USER_AGENT)}
                  </td>
                  <td style={S.td}>{s.CREATED_AT}</td>
                  <td style={S.td}>{s.LAST_SEEN_AT}</td>
                  <td style={S.td}>{s.EXPIRES_AT}</td>
                  <td style={S.td}>
                    <button
                      onClick={() => handleForce(s.SESSION_TOKEN)}
                      disabled={!!forcing}
                      style={{
                        ...S.btnDanger,
                        fontSize: 11, padding: '4px 10px', minHeight: 28,
                        opacity: forcing ? 0.6 : 1,
                        cursor: forcing ? 'default' : 'pointer',
                      }}
                    >
                      {forcing === s.SESSION_TOKEN ? '처리중...' : '강제 로그아웃'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function StatusDot({ status }) {
  const colors = {
    idle: C.gray,
    pending: "#f59e0b",
    saving: C.primary,
    saved: C.green,
    error: C.red,
  };
  return <span style={{ ...S.statusDot, background: colors[status] || C.gray }} />;
}

// ─── Photo Zoom Modal ─────────────────────────────────────────────────────────
function PhotoZoom({ url, onClose }) {
  return (
    <div
      style={{ ...S.modalOverlay, alignItems: "center", justifyContent: "center", zIndex: 700 }}
      onClick={onClose}
    >
      <img
        src={url}
        alt="사진 확대"
        style={{ maxWidth: "95vw", maxHeight: "90vh", borderRadius: 8, objectFit: "contain" }}
      />
    </div>
  );
}

// ─── Return / Exchange Modal ──────────────────────────────────────────────────
function ReturnExchangeModal({ product, jobKey, onClose, onSaved, showToast }) {
  const defaultCenter = product.centers?.[0]?.center || "";
  const [centerName, setCenterName] = useState(defaultCenter);
  const [customCenter, setCustomCenter] = useState("");
  const [returnQty, setReturnQty] = useState("");
  const [exchangeQty, setExchangeQty] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [photoFiles, setPhotoFiles] = useState([]);
  const photoRef = useRef(null);

  const effectiveCenter = centerName === "__custom__" ? customCenter : centerName;

  const handleSave = async () => {
    const rQty = parseQty(returnQty);
    const eQty = parseQty(exchangeQty);
    if (rQty === 0 && eQty === 0 && !memo.trim() && photoFiles.length === 0) {
      setFormError("회송수량, 교환수량, 비고, 사진 중 하나 이상 입력해 주세요.");
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const rows = [];
      let photoIds = "";
      if (photoFiles.length > 0) {
        const b64Photos = await Promise.all(photoFiles.map(fileToBase64));
        const uploadResult = await retryApi(() => postApi({
          action: "uploadPhotos",
          payload: {
            작업기준일또는CSV식별값: jobKey,
            상품코드: product.productCode,
            상품명: product.productName,
            협력사명: product.partner,
            사진들: b64Photos,
          },
        }));
        photoIds = (uploadResult.data || []).map((f) => f.fileId).filter(Boolean).join("\n");
      }

      if (rQty > 0) {
        rows.push({
          type: "movement",
          movementType: "RETURN",
          작업기준일또는CSV식별값: jobKey,
          상품코드: product.productCode,
          상품명: product.productName,
          협력사명: product.partner,
          센터명: effectiveCenter,
          처리유형: "회송",
          회송수량: rQty,
          교환수량: 0,
          발주수량: product.totalQty || 0,
          전체발주수량: product.totalQty || 0,
          비고: memo || "",
          사진파일ID목록: photoIds,
        });
      }
      if (eQty > 0) {
        rows.push({
          type: "movement",
          movementType: "EXCHANGE",
          작업기준일또는CSV식별값: jobKey,
          상품코드: product.productCode,
          상품명: product.productName,
          협력사명: product.partner,
          센터명: effectiveCenter,
          처리유형: "교환",
          회송수량: 0,
          교환수량: eQty,
          발주수량: product.totalQty || 0,
          전체발주수량: product.totalQty || 0,
          비고: memo || "",
          사진파일ID목록: photoIds,
        });
      }
      if (rows.length === 0 && memo.trim()) {
        rows.push({
          type: "movement",
          movementType: "RETURN",
          작업기준일또는CSV식별값: jobKey,
          상품코드: product.productCode,
          상품명: product.productName,
          협력사명: product.partner,
          센터명: effectiveCenter,
          처리유형: "회송",
          회송수량: 0,
          교환수량: 0,
          발주수량: product.totalQty || 0,
          전체발주수량: product.totalQty || 0,
          비고: memo,
          사진파일ID목록: photoIds,
        });
      }

      if (rows.length > 0) {
        await retryApi(() => postApi({ action: "saveBatch", rows }));
      }
      showToast("저장 완료", "success");
      onSaved?.();
      onClose();
    } catch (e) {
      setFormError(e.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const hasMultipleCenters = product.centers && product.centers.length > 1;
  const hasCenters = product.centers && product.centers.length > 0;

  return (
    <Modal title="회송 / 교환 입력" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Center selection */}
        {hasCenters ? (
          <div>
            <label style={S.label}>센터</label>
            <select
              value={centerName}
              onChange={(e) => setCenterName(e.target.value)}
              style={S.input}
            >
              {product.centers.map((c) => (
                <option key={c.center} value={c.center}>{c.center}</option>
              ))}
              <option value="__custom__">직접 입력</option>
            </select>
            {centerName === "__custom__" && (
              <input
                value={customCenter}
                onChange={(e) => setCustomCenter(e.target.value)}
                placeholder="센터명 입력"
                style={{ ...S.input, marginTop: 6 }}
              />
            )}
          </div>
        ) : (
          <div>
            <label style={S.label}>센터명</label>
            <input
              value={centerName}
              onChange={(e) => setCenterName(e.target.value)}
              placeholder="센터명 입력"
              style={S.input}
            />
          </div>
        )}

        {/* Return qty */}
        <div>
          <label style={S.label}>회송수량</label>
          <div style={S.row}>
            <button
              onClick={() => setReturnQty(String(Math.max(0, parseQty(returnQty) - 1)))}
              style={{ ...S.btnStepper, width: 44, height: 44, fontSize: 20 }}
            >－</button>
            <input
              type="number"
              min="0"
              value={returnQty}
              onChange={(e) => setReturnQty(e.target.value)}
              style={{ ...S.qtyInput, flex: 1 }}
              placeholder="0"
            />
            <button
              onClick={() => setReturnQty(String(parseQty(returnQty) + 1))}
              style={{ ...S.btnStepper, width: 44, height: 44, fontSize: 20 }}
            >＋</button>
          </div>
        </div>

        {/* Exchange qty */}
        <div>
          <label style={S.label}>교환수량</label>
          <div style={S.row}>
            <button
              onClick={() => setExchangeQty(String(Math.max(0, parseQty(exchangeQty) - 1)))}
              style={{ ...S.btnStepper, width: 44, height: 44, fontSize: 20 }}
            >－</button>
            <input
              type="number"
              min="0"
              value={exchangeQty}
              onChange={(e) => setExchangeQty(e.target.value)}
              style={{ ...S.qtyInput, flex: 1 }}
              placeholder="0"
            />
            <button
              onClick={() => setExchangeQty(String(parseQty(exchangeQty) + 1))}
              style={{ ...S.btnStepper, width: 44, height: 44, fontSize: 20 }}
            >＋</button>
          </div>
        </div>

        {/* Memo */}
        <div>
          <label style={S.label}>비고 / 불량사유</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            style={{ ...S.input, minHeight: 72, resize: "vertical" }}
            placeholder="불량사유, 메모 등 (선택)"
          />
        </div>

        {/* Photo */}
        <div>
          <label style={S.label}>사진 첨부 (선택)</label>
          <button
            onClick={() => photoRef.current?.click()}
            style={{ ...S.btnSecondary, fontSize: 13, minHeight: 40 }}
          >
            📷 사진 선택 {photoFiles.length > 0 ? `(${photoFiles.length}장)` : ""}
          </button>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setPhotoFiles(Array.from(e.target.files || []))}
            style={S.hidden}
          />
          {photoFiles.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {photoFiles.map((f, i) => (
                <span key={i} style={{ ...S.badge, ...S.badgeBlue }}>{f.name.slice(0, 20)}</span>
              ))}
            </div>
          )}
        </div>

        {formError && <div style={{ color: C.red, fontSize: 13 }}>{formError}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ ...S.btnSecondary, flex: 1 }}>취소</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ ...S.btnPrimary, flex: 1, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── useIsMobile hook ─────────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const h = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return mobile;
}

// ─── PhotoThumb ───────────────────────────────────────────────────────────────
function PhotoThumb({ src, label, uploading, onRemove }) {
  return (
    <div style={{ position: "relative", width: 78, height: 78, flexShrink: 0 }}>
      {src ? (
        <img
          src={src}
          alt={label || "사진"}
          style={{ width: 78, height: 78, objectFit: "cover", borderRadius: 10,
            border: `1.5px solid ${C.borderLight}`, display: "block" }}
        />
      ) : (
        <div style={{ width: 78, height: 78, borderRadius: 10, background: C.inputBg,
          border: `1.5px dashed ${C.border}`, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 20, color: C.textSecondary }}>
          {uploading ? "…" : "📷"}
        </div>
      )}
      {uploading && (
        <div style={{ position: "absolute", inset: 0, borderRadius: 10,
          background: "rgba(88,118,164,0.35)", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 700 }}>
          업로드
        </div>
      )}
      <button
        onClick={onRemove}
        style={{ position: "absolute", top: -5, right: -5, width: 20, height: 20,
          borderRadius: "50%", background: "#e04040", color: "#fff", border: "2px solid #fff",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, padding: 0, lineHeight: 1, zIndex: 2 }}
      >×</button>
      {label && (
        <div style={{ textAlign: "center", fontSize: 10, color: C.textSecondary,
          marginTop: 3, maxWidth: 78, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap" }}>{label}</div>
      )}
    </div>
  );
}

// ─── PhotoSection ─────────────────────────────────────────────────────────────
function PhotoSection({ title, photos, onAdd, onRemove, inputRef }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: C.card, borderRadius: 12,
      padding: "12px 14px", border: `1px solid ${C.borderLight}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>📷 {title}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.accent,
          background: C.accentBg, borderRadius: 10, padding: "1px 8px" }}>{photos.length}</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start",
        minHeight: 78 }}>
        {photos.map((p, i) => (
          <PhotoThumb
            key={i}
            src={p.previewUrl}
            label={p.name ? p.name.replace(/\.[^.]+$/, "").slice(0, 6) : ""}
            uploading={p.uploading}
            onRemove={() => onRemove(i)}
          />
        ))}
        <button
          onClick={() => inputRef.current?.click()}
          style={{ width: 78, height: 78, borderRadius: 10, background: C.cardWhite,
            border: `1.5px dashed ${C.border}`, cursor: "pointer", display: "flex",
            flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 4, color: C.textSecondary, flexShrink: 0 }}
        >
          <span style={{ fontSize: 22 }}>+</span>
          <span style={{ fontSize: 10 }}>추가</span>
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple style={S.hidden}
        onChange={(e) => { onAdd(Array.from(e.target.files || [])); e.target.value = ""; }} />
    </div>
  );
}

// ─── QtyPill ──────────────────────────────────────────────────────────────────
function QtyPill({ value, committed, onChange, onIncrement, onDecrement, accent }) {
  const clr = accent || C.accent;
  return (
    <div style={{ display: "flex", alignItems: "stretch", borderRadius: 10,
      overflow: "hidden", border: `1.5px solid ${C.border}`, height: 40, flexShrink: 0 }}>
      <button
        onClick={onDecrement}
        style={{ minWidth: 38, background: C.card, border: "none", cursor: "pointer",
          fontWeight: 700, fontSize: 16, color: C.textSecondary,
          borderRight: `1px solid ${C.borderLight}`, padding: "0 4px",
          display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <span style={{ fontSize: 13, color: C.textSecondary, fontWeight: 700,
          minWidth: 22, textAlign: "center" }}>{committed ?? "0"}</span>
      </button>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 52, textAlign: "center", border: "none", background: C.cardWhite,
          fontSize: 16, fontWeight: 700, color: C.text, outline: "none",
          fontFamily: "inherit", padding: "0 4px" }}
      />
      <button
        onClick={onIncrement}
        style={{ minWidth: 38, background: clr, border: "none", cursor: "pointer",
          color: "#fff", fontWeight: 700, fontSize: 18,
          borderLeft: `1px solid ${clr}`,
          display: "flex", alignItems: "center", justifyContent: "center" }}
      >+</button>
    </div>
  );
}


// ── ProductCard ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LEGACY — ProductCard is no longer rendered by the production flow.
// InspectionPage → components/PartnerGroup.jsx → components/ProductRow.jsx.
// Kept here for reference only.
function ProductCard({ product, jobKey, savedInspection, onSaved, showToast, happycall }) {
  const isMobile = useIsMobile();
  const [inspQty, setInspQty] = useState(() => String(parseQty(savedInspection?.검품수량 || 0) || ""));
  const [returnQty, setReturnQty] = useState("");
  const [defectReason, setDefectReason] = useState(() => savedInspection?.불량사유 || "");
  const [saveStatus, setSaveStatus] = useState("idle");
  const [committedQty, setCommittedQty] = useState(() => String(parseQty(savedInspection?.검품수량 || 0) || "0"));

  // Photos
  const [inspPhotos, setInspPhotos] = useState([]);
  const [defectPhotos, setDefectPhotos] = useState([]);
  const [uploadedPhotoIds, setUploadedPhotoIds] = useState(() => {
    return String(savedInspection?.사진파일ID목록 || "").split("\n").filter(Boolean);
  });

  const [showReturnModal, setShowReturnModal] = useState(false);
  const inspPhotoRef = useRef(null);
  const defectPhotoRef = useRef(null);
  const saveTimerRef = useRef(null);

  // Happycall badge
  const hcData = happycall?.[product.productCode] || happycall?.[String(product.productCode)];
  const hcRank = hcData ? (hcData.rank || hcData.순위 || hcData.ranking || null) : null;
  const isEvent = !!(product.행사 || product.__isEvent);

  const statusColors = { idle: C.border, pending: "#f0a020", saving: C.accent, saved: C.green, error: C.red };
  const borderColor = statusColors[saveStatus] || C.border;

  // LEGACY — save logic moved to ProductRow.jsx; this path is no longer active
  const doSave = useCallback(async (qtyVal, memoVal, photoIds) => {
    if (!jobKey) return;
    setSaveStatus("saving");
    try {
      await retryApi(() =>
        postApi({
          action: "saveBatch",
          rows: [{
            type: "inspection",
            작업기준일또는CSV식별값: jobKey,
            상품코드: product.productCode,
            상품명: product.productName,
            협력사명: product.partner,
            발주수량: product.totalQty || 0,
            검품수량: parseQty(qtyVal),
            회송수량: 0,
            교환수량: 0,
            불량사유: memoVal || "",
            사진파일ID목록: (photoIds || []).join("\n"),
            BRIX최저: "", BRIX최고: "", BRIX평균: "",
          }],
        })
      );
      setSaveStatus("saved");
      setCommittedQty(String(parseQty(qtyVal)));
      onSaved?.();
    } catch (e) {
      setSaveStatus("error");
      showToast?.(e.message || "저장 실패", "error");
    }
  }, [jobKey, product, onSaved, showToast]);

  const scheduleSave = useCallback((qtyVal, memoVal) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("pending");
    saveTimerRef.current = setTimeout(() => doSave(qtyVal, memoVal, uploadedPhotoIds), 1500);
  }, [doSave, uploadedPhotoIds]);

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const handleAddPhotos = async (files, type) => {
    if (!files.length || !jobKey) return;
    const localPhotos = files.map((f) => ({
      previewUrl: URL.createObjectURL(f),
      name: f.name, uploading: true, id: null,
    }));
    const setFn = type === "insp" ? setInspPhotos : setDefectPhotos;
    setFn((prev) => [...prev, ...localPhotos]);
    try {
      const b64s = await Promise.all(files.map(fileToBase64));
      const res = await retryApi(() =>
        postApi({
          action: "uploadPhotos",
          payload: {
            작업기준일또는CSV식별값: jobKey,
            상품코드: product.productCode,
            상품명: product.productName,
            협력사명: product.partner,
            사진들: b64s,
          },
        })
      );
      const newIds = (res.data || []).map((f) => f.fileId).filter(Boolean);
      setUploadedPhotoIds((prev) => [...prev, ...newIds]);
      setFn((prev) => {
        const updated = [...prev];
        const start = updated.length - localPhotos.length;
        newIds.forEach((id, i) => {
          if (updated[start + i]) updated[start + i] = { ...updated[start + i], id, uploading: false };
        });
        return updated;
      });
      showToast?.(`사진 ${files.length}장 업로드 완료`, "success");
    } catch (err) {
      setFn((prev) => prev.filter((p) => !localPhotos.some((lp) => lp.previewUrl === p.previewUrl)));
      showToast?.(err.message || "사진 업로드 실패", "error");
    }
  };

  const removePhoto = (type, idx) => {
    const setFn = type === "insp" ? setInspPhotos : setDefectPhotos;
    setFn((prev) => {
      const next = [...prev];
      const removed = next.splice(idx, 1)[0];
      if (removed?.id) setUploadedPhotoIds((ids) => ids.filter((id) => id !== removed.id));
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const allPhotos = inspPhotos.length + defectPhotos.length;
  const hasData = parseQty(inspQty) > 0 || defectReason || allPhotos > 0;

  // ── Mobile layout ────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ borderBottom: `1px solid ${C.borderLight}`, padding: "14px 14px 16px" }}>
        {/* Product header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, background: C.inputBg,
            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, border: `1px solid ${C.borderLight}` }}>📦</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{product.productName}</span>
              {hcRank && (
                <span style={{ fontSize: 10, fontWeight: 700, background: C.orangeBadge,
                  color: "#fff", borderRadius: 6, padding: "1px 6px" }}>TOP.{hcRank}</span>
              )}
              {isEvent && (
                <span style={{ fontSize: 10, fontWeight: 700, background: C.accent,
                  color: "#fff", borderRadius: 6, padding: "1px 6px" }}>행사</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: C.textSecondary }}>
              {product.partner} · {product.productCode}
            </div>
          </div>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: borderColor,
            flexShrink: 0, marginTop: 5 }} />
        </div>

        {/* Qty rows — mobile */}
        {[
          { label: "검품사량", val: inspQty, setVal: setInspQty, committed: committedQty },
          { label: "불량수량", val: returnQty, setVal: setReturnQty, committed: "0" },
        ].map(({ label, val, setVal, committed }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 10,
            marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.textSoft,
              width: 56, flexShrink: 0 }}>{label}</span>
            <QtyPill
              value={val}
              committed={committed}
              onChange={(v) => { setVal(v); if (label === "검품사량") scheduleSave(v, defectReason); }}
              onIncrement={() => {
                const n = String(parseQty(val) + 1);
                setVal(n);
                if (label === "검품사량") scheduleSave(n, defectReason);
              }}
              onDecrement={() => {
                const n = String(Math.max(0, parseQty(val) - 1));
                setVal(n);
                if (label === "검품사량") scheduleSave(n, defectReason);
              }}
            />
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            type="text"
            value={defectReason}
            onChange={(e) => { setDefectReason(e.target.value); scheduleSave(inspQty, e.target.value); }}
            placeholder="불량사유 입력"
            style={{ ...S.inputSmall, flex: 1 }}
          />
          <button
            onClick={() => setShowReturnModal(true)}
            style={{ ...S.btnDanger, fontSize: 12, padding: "6px 12px", minHeight: 38 }}
          >회송</button>
          <button
            onClick={() => {
              if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
              doSave(inspQty, defectReason, uploadedPhotoIds);
            }}
            disabled={saveStatus === "saving"}
            style={{ ...S.btnPrimary, fontSize: 12, padding: "6px 14px", minHeight: 38 }}
          >{saveStatus === "saving" ? "…" : "저장"}</button>
        </div>

        {showReturnModal && (
          <ReturnExchangeModal
            product={product} jobKey={jobKey}
            onClose={() => setShowReturnModal(false)}
            onSaved={onSaved} showToast={showToast}
          />
        )}
      </div>
    );
  }

  // ── Desktop layout ────────────────────────────────────────────────────────
  return (
    <div style={{ borderBottom: `1px solid ${C.borderLight}`, padding: "16px 20px" }}>
      {/* Product header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: C.inputBg,
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, border: `1px solid ${C.borderLight}` }}>📦</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{product.productName}</span>
            {hcRank && (
              <span style={{ fontSize: 11, fontWeight: 700, background: C.orangeBadge,
                color: "#fff", borderRadius: 6, padding: "2px 7px" }}>TOP.{hcRank}</span>
            )}
            {isEvent && (
              <span style={{ fontSize: 11, fontWeight: 700, background: C.accent,
                color: "#fff", borderRadius: 6, padding: "2px 7px" }}>행사</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
            {product.partner} · <span style={{ fontWeight: 600 }}>{product.productCode}</span>
            {product.centers?.length > 0 && (
              <span style={{ marginLeft: 6, color: C.textSoft }}>
                {product.centers.map((c) => c.center).filter(Boolean).join(", ")}
              </span>
            )}
          </div>
        </div>
        {/* Quick action pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => inspPhotoRef.current?.click()}
            style={{ display: "flex", alignItems: "center", gap: 4, background: C.accentBg,
              border: `1px solid ${C.border}`, borderRadius: 9, padding: "6px 12px",
              cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.accent }}
          >
            📷 {allPhotos > 0 ? `${allPhotos}+` : "0+"}
          </button>
          <span style={{ fontSize: 11, color: C.textSecondary }}>
            발주 {(product.totalQty || 0).toLocaleString()}개
          </span>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: borderColor }} />
        </div>
      </div>

      {/* Inspection qty row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.textSoft, width: 52, flexShrink: 0 }}>검품사량</span>
        <QtyPill
          value={inspQty}
          committed={committedQty}
          onChange={(v) => { setInspQty(v); scheduleSave(v, defectReason); }}
          onIncrement={() => { const n = String(parseQty(inspQty) + 1); setInspQty(n); scheduleSave(n, defectReason); }}
          onDecrement={() => { const n = String(Math.max(0, parseQty(inspQty) - 1)); setInspQty(n); scheduleSave(n, defectReason); }}
        />
        <input
          type="text"
          value={defectReason}
          onChange={(e) => { setDefectReason(e.target.value); scheduleSave(inspQty, e.target.value); }}
          placeholder="불량사유"
          style={{ flex: 1, minWidth: 120, border: `1.5px solid ${C.border}`, borderRadius: 9,
            padding: "8px 12px", fontSize: 13, fontFamily: "inherit", outline: "none",
            color: C.text, background: C.cardWhite, height: 40 }}
        />
        <button
          onClick={() => inspPhotoRef.current?.click()}
          style={{ display: "flex", alignItems: "center", gap: 5, background: C.accentBg,
            border: `1px solid ${C.border}`, borderRadius: 9, padding: "7px 12px",
            cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.accent, height: 40, flexShrink: 0 }}
        >
          📷 {inspPhotos.length}
        </button>
        <button
          onClick={() => setShowReturnModal(true)}
          style={{ background: C.redBg, border: `1px solid ${C.red}25`, borderRadius: 9,
            padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700,
            color: C.red, height: 40, flexShrink: 0 }}
        >최송</button>
        {saveStatus !== "idle" && (
          <span style={{ fontSize: 11, color: statusColors[saveStatus], fontWeight: 700, flexShrink: 0 }}>
            {{ pending: "입력중", saving: "저장중", saved: "✓", error: "오류" }[saveStatus]}
          </span>
        )}
      </div>

      {/* Defect qty row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.textSoft, width: 52, flexShrink: 0 }}>불량수량</span>
        <QtyPill
          value={returnQty}
          committed="0"
          onChange={setReturnQty}
          onIncrement={() => setReturnQty(String(parseQty(returnQty) + 1))}
          onDecrement={() => setReturnQty(String(Math.max(0, parseQty(returnQty) - 1)))}
          accent={C.red}
        />
        <div style={{ flex: 1 }} />
        <button
          onClick={() => defectPhotoRef.current?.click()}
          style={{ display: "flex", alignItems: "center", gap: 5, background: C.orangeBg,
            border: `1px solid ${C.border}`, borderRadius: 9, padding: "7px 12px",
            cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.orange, height: 40, flexShrink: 0 }}
        >
          📷 {defectPhotos.length}
        </button>
        <button
          onClick={() => setShowReturnModal(true)}
          style={{ background: C.redBg, border: `1px solid ${C.red}25`, borderRadius: 9,
            padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700,
            color: C.red, height: 40, flexShrink: 0 }}
        >최송</button>
        <div style={{ width: 20 }} />
      </div>

      {/* Photo sections */}
      {(inspPhotos.length > 0 || defectPhotos.length > 0 || hasData) && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <PhotoSection
            title="검품 사진"
            photos={inspPhotos}
            onAdd={(files) => handleAddPhotos(files, "insp")}
            onRemove={(i) => removePhoto("insp", i)}
            inputRef={inspPhotoRef}
          />
          <PhotoSection
            title="불량 사진"
            photos={defectPhotos}
            onAdd={(files) => handleAddPhotos(files, "defect")}
            onRemove={(i) => removePhoto("defect", i)}
            inputRef={defectPhotoRef}
          />
        </div>
      )}

      {/* Hidden photo inputs */}
      <input ref={inspPhotoRef} type="file" accept="image/*" multiple style={S.hidden}
        onChange={(e) => { handleAddPhotos(Array.from(e.target.files || []), "insp"); e.target.value = ""; }} />
      <input ref={defectPhotoRef} type="file" accept="image/*" multiple style={S.hidden}
        onChange={(e) => { handleAddPhotos(Array.from(e.target.files || []), "defect"); e.target.value = ""; }} />

      {showReturnModal && (
        <ReturnExchangeModal
          product={product} jobKey={jobKey}
          onClose={() => setShowReturnModal(false)}
          onSaved={onSaved} showToast={showToast}
        />
      )}
    </div>
  );
}

// ─── Partner Group ─────────────────────────────────────────────────────────────

// ── PartnerGroup ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LEGACY — moved to src/components/PartnerGroup.jsx; no longer rendered from App.js.
// InspectionPage imports PartnerGroup directly from ./PartnerGroup.
function PartnerGroup({ partnerName, products, jobKey, inspectionRows, onSaved, showToast, defaultOpen, happycall }) {
  const [open, setOpen] = useState(defaultOpen !== false);

  const savedMap = useMemo(() => {
    const map = {};
    (inspectionRows || []).forEach((r) => {
      const k = `${normalizeText(r.협력사명 || "")}||${normalizeProductCode(r.상품코드 || "")}`;
      map[k] = r;
    });
    return map;
  }, [inspectionRows]);

  const doneCount = useMemo(() => {
    return products.filter((p) => {
      const k = `${normalizeText(p.partner || "")}||${normalizeProductCode(p.productCode || "")}`;
      return savedMap[k] && parseQty(savedMap[k].검품수량) > 0;
    }).length;
  }, [products, savedMap]);

  return (
    <div style={S.cardNoPad}>
      <button onClick={() => setOpen((o) => !o)} style={S.partnerHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${C.accent}`,
            background: open ? C.accent : "transparent", display: "flex", alignItems: "center",
            justifyContent: "center", flexShrink: 0 }}>
            {open && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>}
          </div>
          <span style={S.partnerTitle}>{partnerName}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {doneCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: C.green,
              background: C.greenBg, borderRadius: 10, padding: "2px 8px" }}>
              {doneCount}/{products.length}
            </span>
          )}
          <span style={S.partnerCount}>{products.length}건</span>
          <span style={{ fontSize: 13, color: C.textSecondary, marginLeft: 2 }}>
            {open ? "∧" : "∨"}
          </span>
        </div>
      </button>
      {open && products.map((p) => {
        const savedKey = `${normalizeText(p.partner || "")}||${normalizeProductCode(p.productCode || "")}`;
        return (
          <ProductCard
            key={`${p.partner}||${p.productCode}`}
            product={p}
            jobKey={jobKey}
            savedInspection={savedMap[savedKey] || null}
            onSaved={onSaved}
            showToast={showToast}
            happycall={happycall}
          />
        );
      })}
    </div>
  );
}

// ── ActionStrip: fixed scrollable bar of download + admin action buttons ──────
function ActionStrip({
  downloading, dlProgress,
  syncing, resetting,
  showReset, resetPw,
  onResetPwChange, onToggleReset,
  onDownloadZip, onDownloadAll, onSyncHistory, onReset,
  authUser,
}) {
  const busy = !!downloading;
  const perms = (authUser && authUser.permissions) || [];
  const canDownload = perms.includes('DOWNLOAD_ZIP');
  const canManage   = perms.includes('MANAGE_USERS');
  const BTN = {
    height: 30, padding: "0 10px", border: "none", borderRadius: 8,
    fontSize: 11.5, fontWeight: 600, cursor: "pointer", flexShrink: 0,
    fontFamily: "'Apple SD Gothic Neo','Pretendard',system-ui,sans-serif",
    display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
    transition: "opacity 0.15s, background 0.15s",
  };
  const ZIPS = [
    { mode: "inspection", label: "검품사진↓", color: C.accent,  bg: C.accentBg },
    { mode: "movement",   label: "불량사진↓", color: C.red,     bg: C.redBg    },
    { mode: "weight",     label: "중량사진↓", color: C.gray,    bg: C.card     },
    { mode: "sugar",      label: "당도사진↓", color: C.green,   bg: C.greenBg  },
  ];
  return (
    <>
      <div
        className="action-strip"
        style={{
          ...S.actionStrip,
          background: C.card,
        }}
      >
        {/* ZIP downloads */}
        {canDownload && ZIPS.map(({ mode, label, color, bg }) => {
          const active = downloading === mode;
          return (
            <button
              key={mode}
              onClick={() => onDownloadZip(mode)}
              disabled={busy}
              style={{
                ...BTN,
                background: active ? C.cardWhite : bg,
                color: active ? C.textSecondary : color,
                border: `1px solid ${active ? C.border : color + "44"}`,
                opacity: busy && !active ? 0.5 : 1,
              }}
            >
              <Download size={10} strokeWidth={2.5} />
              {active ? (dlProgress.text || "처리중") : label}
            </button>
          );
        })}

        {/* Separator */}
        {canDownload && <div style={{ width: 1, height: 20, background: C.borderLight, flexShrink: 0 }} />}

        {/* All download */}
        {canDownload && (
        <button
          onClick={onDownloadAll}
          disabled={busy}
          style={{
            ...BTN,
            background: downloading === "all" ? C.cardWhite : C.accentBg,
            color: downloading === "all" ? C.textSecondary : C.accent,
            border: `1px solid ${C.border}`,
            opacity: busy && downloading !== "all" ? 0.5 : 1,
          }}
        >
          <FolderDown size={10} strokeWidth={2.5} />
          {downloading === "all" ? (dlProgress.text || "처리중") : "전체↓"}
        </button>
        )}

        {/* Separator */}
        <div style={{ width: 1, height: 20, background: C.borderLight, flexShrink: 0 }} />

        {/* History */}
        <button
          onClick={onSyncHistory}
          disabled={syncing}
          style={{
            ...BTN,
            background: syncing ? C.cardWhite : C.greenBg,
            color: syncing ? C.textSecondary : C.green,
            border: `1px solid ${syncing ? C.border : C.green + "44"}`,
          }}
        >
          <Database size={10} strokeWidth={2.5} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
          {syncing ? "기록중" : "이력관리 기록"}
        </button>

        {/* Reset — admin only */}
        {canManage && (
        <button
          onClick={onToggleReset}
          style={{
            ...BTN,
            background: showReset ? C.red : C.redBg,
            color: showReset ? "#fff" : C.red,
            border: `1px solid ${C.red + "44"}`,
          }}
        >
          <AlertTriangle size={10} strokeWidth={2.5} />
          초기화
        </button>
        )}
      </div>

      {/* Reset password panel */}
      {canManage && showReset && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
          background: C.redBg, borderTop: `1px solid ${C.red + "30"}`,
        }}>
          <AlertTriangle size={12} strokeWidth={2} color={C.red} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: C.red, fontWeight: 600, flexShrink: 0 }}>
            입력 데이터 모두 삭제
          </span>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <Lock size={11} strokeWidth={2} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: C.red, pointerEvents: "none" }} />
            <input
              type="password" placeholder="비밀번호"
              value={resetPw} onChange={(e) => onResetPwChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onReset(); }}
              style={{
                height: 30, padding: "0 10px 0 26px",
                border: `1.5px solid ${C.red + "80"}`, borderRadius: 7,
                fontSize: 12, fontFamily: "inherit", outline: "none",
                color: C.red, background: "#fff", width: 130,
              }}
            />
          </div>
          <button
            onClick={onReset}
            disabled={resetting}
            style={{
              height: 30, padding: "0 14px",
              background: resetting ? C.textSecondary : C.red, color: "#fff",
              border: "none", borderRadius: 7,
              fontSize: 12, fontWeight: 700, cursor: resetting ? "default" : "pointer",
              fontFamily: "inherit", flexShrink: 0,
            }}
          >{resetting ? "처리중" : "확인"}</button>
          <button
            onClick={onToggleReset}
            style={{ ...BTN, background: "transparent", color: C.textSecondary, border: "none", padding: "0 4px" }}
          >✕</button>
        </div>
      )}

      {/* Download progress bar */}
      {!!downloading && dlProgress.percent > 0 && (
        <div style={{ height: 2, background: C.borderLight }}>
          <div style={{
            height: "100%", width: `${dlProgress.percent}%`,
            background: C.accent, transition: "width 0.4s ease",
          }} />
        </div>
      )}
    </>
  );
}

// ── CSV Web Worker helpers (module-level — outside the React component) ────────

// Ref to the currently-active parse worker so it can be cancelled if the user
// picks a new file before the previous parse completes.
let _csvWorker = null;

/**
 * Parse + normalize a CSV file entirely off the main thread.
 * The ArrayBuffer is transferred to the worker (zero-copy).
 * Returns Promise<{ normalized: Row[], jobKey: string }>.
 */
function parseCsvInWorker(buffer) {
  return new Promise((resolve, reject) => {
    // CRA 5 / webpack 5: new Worker(new URL(…, import.meta.url)) is the canonical syntax.
    const worker = new Worker(new URL('./workers/csvWorker.js', import.meta.url));
    _csvWorker = worker;
    worker.onmessage = (ev) => {
      _csvWorker = null;
      worker.terminate();
      if (ev.data.type === 'result') resolve(ev.data);
      else reject(new Error(ev.data.message || 'CSV 처리 오류'));
    };
    worker.onerror = (ev) => {
      _csvWorker = null;
      worker.terminate();
      reject(new Error(ev.message || 'CSV 워커 오류'));
    };
    // Transferring the buffer avoids copying up to several MB between threads.
    worker.postMessage({ buffer }, [buffer]);
  });
}

// ── Main App component ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const AUTH_TOKEN_KEY = "insp_session_token";
const AUTH_USER_KEY  = "insp_session_user";

function App() {
  // ── Auth state ────────────────────────────────────────────────────────────
  const [authUser,    setAuthUser]    = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [tab, setTab] = useState("inspection");
  const [loading, setLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [jobKey, setJobKey] = useState("");
  const [jobRows, setJobRows] = useState([]);
  const [inspectionRows, setInspectionRows] = useState([]);
  const [records, setRecords] = useState([]);
  const [config, setConfig] = useState({});
  const [summary, setSummary] = useState({});
  const [happycall, setHappycall] = useState({});
  // Single source of truth for inspection target SKU count — set by InspectionPage
  // once it finishes deduplicating rows (partner × productCode pairs).
  const [inspectionTargetSkuTotal, setInspectionTargetSkuTotal] = useState(0);
  const [worksheetUrl, setWorksheetUrl] = useState("");
  const [currentFileName, setCurrentFileName] = useState("");
  const [toast, setToast] = useState({ message: "", type: "info" });
  const [productImages, setProductImages] = useState([]);
  const [historyData, setHistoryData] = useState([]);

  // ── Action bar state (shared across header + all tabs) ────────────────────────
  const [downloading,  setDownloading]  = useState("");
  const [dlProgress,   setDlProgress]   = useState({ stage: "", percent: 0, text: "" });
  const [syncing,      setSyncing]      = useState(false);
  const [resetting,    setResetting]    = useState(false);
  const [showReset,    setShowReset]    = useState(false);
  const [resetPw,      setResetPw]      = useState("");

  // ── Admin: session management state ──────────────────────────────────────────
  const [showSessionsModal,  setShowSessionsModal]  = useState(false);
  const [showWorkerPanel,    setShowWorkerPanel]    = useState(false);
  const [workWorkers,        setWorkWorkers]        = useState(null);
  const [showScheduleModal,  setShowScheduleModal]  = useState(false);
  const [scheduleMonths,     setScheduleMonths]     = useState(null); // null = not yet fetched
  const [scheduleLoading,    setScheduleLoading]    = useState(false);
  const canManageUsers = !!(authUser && (authUser.permissions || []).includes('MANAGE_USERS'));

  // Fetch today's work schedule once when admin is confirmed
  useEffect(() => {
    if (!canManageUsers) return;
    fetchWorkSchedule()
      .then((res) => setWorkWorkers(computeWorkers(res.workers || [])))
      .catch(() => {});
  }, [canManageUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch full schedule on demand when the modal is first opened
  const handleOpenSchedule = useCallback(() => {
    setShowScheduleModal(true);
    if (scheduleMonths !== null) return; // already loaded
    setScheduleLoading(true);
    fetchFullSchedule()
      .then((res) => setScheduleMonths(res.months || []))
      .catch(() => setScheduleMonths([]))
      .finally(() => setScheduleLoading(false));
  }, [scheduleMonths]);

  // ── Login note (e.g. forced-logout message to show on the login screen) ──────
  const [loginNote, setLoginNote] = useState('');

  // ── Action handlers (SECTION 7) ───────────────────────────────
  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: "", type: "info" }), 2400);
  }, []);

  const loadBootstrap = useCallback(async () => {
    // Flush any pending postSaveSync before reloading so the backend data is fully
    // up-to-date and we don't overwrite locally accumulated changes with stale state.
    flushPendingSync();
    if (!SCRIPT_URL) {
      setLoadError("REACT_APP_GOOGLE_SCRIPT_URL 환경변수를 설정해 주세요.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      // Fire getConfig / getCurrentJob / getRecords / getInspectionRows / getDashboard
      // in parallel. Wall-clock time is max(each request) instead of their sum.
      const result = await fetchBootstrapParallel();
      const d = result.data || {};
      const job = d.current_job || {};
      setJobKey(job.job_key || "");
      setJobRows(buildNormalizedRows(job.rows || []));
      setInspectionRows(Array.isArray(d.rows) ? d.rows : []);
      setRecords(Array.isArray(d.records) ? d.records : []);
      setConfig(d.config || {});
      setSummary(d.summary || {});
      setHappycall(d.happycall || {});
      setWorksheetUrl(d.worksheet_url || "");
      setCurrentFileName(job.source_file_name || "");
      setProductImages(Array.isArray(d.product_images) ? d.product_images : []);
      setInitialLoadDone(true);
    } catch (e) {
      setLoadError(e.message || "초기 데이터 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  // Deferred bootstrap: loads happycall analytics and product images after first paint.
  // Fired in parallel with the main bootstrap so the loading spinner clears as soon as
  // core data is ready, without waiting for the heavier analytic reads.
  const loadDeferredBootstrap = useCallback(async () => {
    if (!SCRIPT_URL) return;
    try {
      const resp = await fetch(`${SCRIPT_URL}?action=bootstrapDeferred`);
      const result = await resp.json();
      if (!resp.ok || result.ok === false) return;
      const d = result.data || {};
      if (d.happycall)       setHappycall(d.happycall);
      if (d.product_images)  setProductImages(Array.isArray(d.product_images) ? d.product_images : []);
    } catch (_e) { /* non-blocking — main app works fine without deferred data */ }
  }, []);

  useEffect(() => {
    loadBootstrap();
    loadDeferredBootstrap(); // fire in parallel; doesn't affect loading state
  }, [loadBootstrap, loadDeferredBootstrap]);

  // ── Auth: restore session from localStorage on first mount ────────────────
  useEffect(() => {
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!storedToken) {
      setAuthLoading(false);
      return;
    }
    validateSession(storedToken)
      .then((res) => {
        if (res.ok && res.user) {
          setSessionToken(storedToken);
          setAuthUser(res.user);
        } else {
          localStorage.removeItem(AUTH_TOKEN_KEY);
          localStorage.removeItem(AUTH_USER_KEY);
        }
      })
      .catch(() => {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
      })
      .finally(() => setAuthLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = useCallback(async (id, password) => {
    const res = await apiLogin(id, password);
    if (!res.ok) throw new Error(res.error || '로그인 실패');
    localStorage.setItem(AUTH_TOKEN_KEY, res.sessionToken);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(res.user));
    setSessionToken(res.sessionToken);
    setAuthUser(res.user);
  }, []);

  const handleLogout = useCallback(async () => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    try { await apiLogout(token); } catch (_) {}
    setSessionToken(null);
    setAuthUser(null);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  }, []);

  // ── Session-validity polling: detect forced logout every 30 s ─────────────
  useEffect(() => {
    if (!authUser) return;
    const interval = setInterval(async () => {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) return;
      try {
        const res = await validateSession(token);
        if (!res.ok) {
          clearInterval(interval);
          setSessionToken(null);
          setAuthUser(null);
          localStorage.removeItem(AUTH_TOKEN_KEY);
          localStorage.removeItem(AUTH_USER_KEY);
          setLoginNote('관리자에 의해 로그아웃되었습니다.');
        }
      } catch (_) { /* network hiccup — skip tick */ }
    }, 30_000);
    return () => clearInterval(interval);
  }, [authUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build a fast productCode -> image item lookup used by ProductRow thumbnails
  const productImageMap = useMemo(() => {
    const map = {};
    for (const item of productImages) {
      const code = String(item['상품코드'] || '').trim();
      if (code) map[code] = item;
    }
    return map;
  }, [productImages]);

  // Called by ProductRow after a successful representative-image upload
  const handleProductImageUploaded = useCallback((productCode, newItem) => {
    setProductImages((prev) => {
      const next = prev.filter((it) => String(it['상품코드'] || '').trim() !== productCode);
      return [...next, newItem];
    });
  }, []);

  // ── Action bar handlers ────────────────────────────────────────────────────
  const handleSyncHistory= useCallback(async () => {
    setSyncing(true);
    try {
      await syncHistory();
      // Reload history data for charts
      const res = await fetchHistoryData();
      setHistoryData(Array.isArray(res.data) ? res.data : []);
      showToast("이력관리 기록 완료", "success");
    } catch (err) {
      showToast(err.message || "이력관리 기록 실패", "error");
    } finally { setSyncing(false); }
  }, [showToast]);

  const handleReset = useCallback(async () => {
    if (!resetPw) { showToast("비밀번호를 입력하세요.", "error"); return; }
    setResetting(true);
    try {
      await resetCurrentJobInputData(resetPw);
      setShowReset(false); setResetPw("");
      showToast("초기화 완료", "success");
      loadBootstrap();
    } catch (err) {
      showToast(err.message || "초기화 실패 (비밀번호 확인)", "error");
    } finally { setResetting(false); }
  }, [resetPw, loadBootstrap, showToast]);

  const handleDownloadZip = useCallback(async (mode) => {
    setDownloading(mode);
    setDlProgress({ stage: "generating", percent: 10, text: "ZIP 생성 중..." });
    try {
      const { count, parts } = await buildAndDownloadPhotoZips(mode, { onProgress: setDlProgress });
      if (count === 0) {
        showToast("다운로드할 사진이 없습니다.", "info");
      } else {
        showToast(`총 ${count}장 다운로드 시작${parts > 1 ? ` (${parts}개 파일)` : ""}`, "success");
      }
    } catch (err) {
      showToast(err.message || "ZIP 생성 실패", "error");
    } finally {
      setDownloading(""); setDlProgress({ stage: "", percent: 0, text: "" });
    }
  }, [showToast]);

  const handleDownloadAll = useCallback(async () => {
    setDownloading("all");
    const modes = [
      { mode: "inspection", label: "검품사진" },
      { mode: "movement",   label: "불량사진" },
      { mode: "weight",     label: "중량사진" },
      { mode: "sugar",      label: "당도사진" },
    ];
    let totalFiles = 0; let totalParts = 0;
    try {
      for (const { mode, label } of modes) {
        setDlProgress({ stage: "generating", percent: 10, text: `${label} ZIP 생성 중...` });
        const { count, parts } = await buildAndDownloadPhotoZips(mode, { onProgress: setDlProgress });
        totalFiles += count; totalParts += parts;
      }
      if (totalFiles === 0) { showToast("다운로드할 사진이 없습니다.", "info"); }
      else { showToast(`전체 ${totalFiles}장 / ${totalParts}개 파일 다운로드 시작`, "success"); }
    } catch (err) {
      showToast(err.message || "전체 다운로드 실패", "error");
    } finally {
      setDownloading(""); setDlProgress({ stage: "", percent: 0, text: "" });
    }
  }, [showToast]);

  // Load history data once on initial load
  useEffect(() => {
    fetchHistoryData()
      .then((res) => { if (Array.isArray(res.data)) setHistoryData(res.data); })
      .catch(() => {}); // silently ignore if backend not reachable
  }, []);

  // ── Lightweight auto-refresh: detect changes from other users every 12 s ────
  // Polls only a tiny timestamp endpoint (no sheet reads on the backend).
  // Only refetches inspection rows when the timestamp has actually changed.
  // Never overwrites an input that the user is currently editing (the
  // InspectionPage hydration effect already guards against that).
  const lastKnownSaveTs = useRef('');
  useEffect(() => {
    if (!authUser || !SCRIPT_URL) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${SCRIPT_URL}?action=getLastUpdated`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const ts = data.lastUpdated || '';
        if (!ts || ts === lastKnownSaveTs.current) return;
        lastKnownSaveTs.current = ts;
        // Fetch fresh inspection rows without triggering a full-page loading state
        const rowRes = await fetch(`${SCRIPT_URL}?action=getInspectionRows`, { cache: 'no-store' });
        if (!rowRes.ok) return;
        const rowData = await rowRes.json();
        if (Array.isArray(rowData.rows)) {
          setInspectionRows(rowData.rows);
        }
      } catch (_) { /* network hiccup — skip tick */ }
    }, 12_000);
    return () => clearInterval(poll);
  }, [authUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Header summary chips ─────────────────────────────────────────────────────
  const headerSkuCount = useMemo(() => {
    const keys = new Set(
      (jobRows || [])
        .filter((r) => r.__productCode)
        .map((r) => `${r.__productCode}||${r.__partner || r['협력사명'] || ''}`)
    );
    return keys.size;
  }, [jobRows]);

  const headerInspCount = useMemo(() => {
    const keys = new Set();
    for (const r of (inspectionRows || [])) {
      if (parseInt(r['검품수량'], 10) > 0 && r['상품코드']) {
        keys.add(`${String(r['상품코드']).trim()}||${String(r['협력사명'] || '').trim()}`);
      }
    }
    return keys.size;
  }, [inspectionRows]);

  // eslint-disable-next-line no-unused-vars
  const headerInspRate    = headerSkuCount > 0 ? Math.round((headerInspCount / headerSkuCount) * 100) : 0;

  // headerTargetQty — exclusion-applied 수량 shown in the header badge.
  // Priority: backend summary ('검품 입고수량') → client-side sum from jobRows.
  // Note: the SKU count formerly derived here is now sourced from InspectionPage
  // (inspectionTargetSkuTotal) so that both the badge and the progress bar use
  // the exact same deduplication logic (partner × productCode pairs).
  const headerTargetQty = useMemo(() => {
    const fromSummary = (key) => {
      const v = summary[key];
      if (v == null || v === '') return null;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
      return isFinite(n) ? n : null;
    };
    const bInspQty = fromSummary('검품 입고수량');
    if (bInspQty !== null) return bInspQty;

    const excludeRows = Array.isArray(config.exclude_rows) ? config.exclude_rows : [];
    const isExcluded = (code, partner) => {
      const normCode = String(code || '').trim().toLowerCase();
      if (!normCode) return false;
      for (const ex of excludeRows) {
        if (String(ex['사용여부'] || '').trim().toUpperCase() !== 'TRUE') continue;
        const exCode = String(ex['상품코드'] || '').trim().toLowerCase();
        if (!exCode || exCode !== normCode) continue;
        const exPartner = String(ex['협력사'] || ex['협력사명'] || '').trim().toLowerCase();
        if (!exPartner) return true;
        if (exPartner === String(partner || '').trim().toLowerCase()) return true;
      }
      return false;
    };
    let qty = 0;
    for (const r of (jobRows || [])) {
      const code    = r.__productCode || '';
      const rowQty  = Number(r.__qty) || 0;
      const partner = r.__partner || r['협력사명'] || '';
      if (code && rowQty > 0 && !isExcluded(code, partner)) {
        qty += rowQty;
      }
    }
    return qty;
  }, [summary, jobRows, config.exclude_rows]);

  const handleLogoutConfirm = useCallback(() => {
    if (window.confirm('로그아웃 하시겠습니까?')) handleLogout();
  }, [handleLogout]);

  const handleCsvUpload = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!SCRIPT_URL) {
        showToast("SCRIPT_URL이 설정되지 않았습니다.", "error");
        return;
      }
      // Cancel any in-progress parse so stale results don't race with this one.
      if (_csvWorker) { _csvWorker.terminate(); _csvWorker = null; }
      showToast("CSV 처리 중...", "info");
      try {
        const buffer = await file.arrayBuffer();
        // Worker handles encoding detection + Papa.parse + buildNormalizedRows off the main thread.
        const { normalized, jobKey: key } = await parseCsvInWorker(buffer);
        const jsonStr = JSON.stringify(normalized);
        const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
        const result = await retryApi(() =>
          postApi({
            action: "cacheCsv",
            payload: {
              job_key: key,
              source_file_name: file.name,
              source_file_modified: new Date(file.lastModified).toISOString(),
              parsed_rows_base64: b64,
            },
          })
        );
        const job = result.job || {};
        setJobKey(job.job_key || key);
        setJobRows(normalized);
        setSummary(result.summary || {});
        setCurrentFileName(file.name);
        showToast(`CSV 업로드 완료 (${normalized.length}행)`, "success");
      } catch (err) {
        showToast(err.message || "CSV 처리 실패", "error");
      } finally {
        e.target.value = "";
      }
    },
    [showToast]
  );

  // ── Auth guard ───────────────────────────────────────────────────────────────
  if (authLoading) {
    return <LoadingScreen label="세션 확인 중..." />;
  }

  if (!authUser) {
    return <LoginPage onLogin={handleLogin} note={loginNote} onClearNote={() => setLoginNote('')} />;
  }

  return (
    <div style={S.app}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { opacity: 1; }
        .action-strip::-webkit-scrollbar { display: none; }
        .header-right-cluster::-webkit-scrollbar { display: none; }
      `}</style>

      {/* ── Header ── */}
      <header style={S.header}>
        {/* ── ROW 1: logo · 검품PDA · SKU badge · 수량 badge ── */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '0 14px', height: 52, overflow: 'hidden',
          gap: 10,
        }}>
          <img src={gs25Logo} alt="GS25" style={{ height: 28, flexShrink: 0, display: 'block' }} />
          <div style={{ width: 1, height: 22, background: C.borderLight, flexShrink: 0 }} />
          <p style={{
            fontSize: 15, fontWeight: 800, color: C.text, margin: 0,
            letterSpacing: '-0.02em', whiteSpace: 'nowrap',
            flex: '0 0 auto',
          }}>
            검품PDA
          </p>

          {/* SKU badge — inspection target SKU count (single source of truth: deduplicatedRows.length) */}
          {inspectionTargetSkuTotal > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: C.textMid,
              background: C.card, border: `1px solid ${C.borderLight}`,
              borderRadius: 6, padding: '3px 8px',
              flex: '0 0 auto', flexShrink: 0, whiteSpace: 'nowrap',
            }}>
              SKU&nbsp;<span style={{ color: C.accent }}>{inspectionTargetSkuTotal.toLocaleString()}</span>
            </span>
          )}

          {/* 수량 badge — 검품 입고수량 (exclusion-applied) */}
          {headerTargetQty > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: C.textMid,
              background: C.card, border: `1px solid ${C.borderLight}`,
              borderRadius: 6, padding: '3px 8px',
              flex: '0 0 auto', flexShrink: 0, whiteSpace: 'nowrap',
            }}>
              수량&nbsp;<span style={{ color: C.accent }}>{headerTargetQty.toLocaleString()}</span>
            </span>
          )}
        </div>

        {/* ── ROW 2: fixed label · scrollable action strip ── */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '0 14px 6px',
          minHeight: 28,
          overflow: 'hidden',
        }}>
          {/* Fixed left label */}
          <span style={{
            fontSize: 10, fontWeight: 500,
            letterSpacing: '0.08em', color: 'rgba(15,23,42,0.30)',
            fontFamily: "'Pretendard',-apple-system,BlinkMacSystemFont,system-ui,sans-serif",
            textTransform: 'uppercase', whiteSpace: 'nowrap',
            flex: '0 0 auto', flexShrink: 0,
            marginRight: 10,
          }}>
            MADE BY . SEUNG-HO
          </span>

          {/* Vertical divider */}
          <div style={{ width: 1, height: 14, background: C.borderLight, flexShrink: 0, marginRight: 10 }} />

          {/* Scrollable action strip */}
          <div
            className="header-right-cluster"
            style={{
              display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 6,
              overflowX: 'auto', overflowY: 'hidden',
              WebkitOverflowScrolling: 'touch',
              overscrollBehaviorX: 'contain',
              touchAction: 'pan-x',
              scrollbarWidth: 'none', msOverflowStyle: 'none',
              flex: '1 1 0', minWidth: 0,
            }}
          >
            {/* CSV file name chip */}
            {currentFileName && (
              <span style={{
                fontSize: 10, fontWeight: 500, color: C.textSecondary,
                background: C.card, border: `1px solid ${C.borderLight}`,
                borderRadius: 6, padding: '2px 7px',
                flex: '0 0 auto', flexShrink: 0, whiteSpace: 'nowrap',
                maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {currentFileName.length > 20 ? currentFileName.slice(0, 20) + '…' : currentFileName}
              </span>
            )}

            {/* 시트↗ link */}
            {worksheetUrl && (
              <a
                href={worksheetUrl} target="_blank" rel="noreferrer"
                style={{
                  fontSize: 11, fontWeight: 700, color: C.accent,
                  textDecoration: 'none', padding: '3px 8px',
                  background: C.accentBg, borderRadius: 7,
                  border: `1px solid ${C.accent}30`,
                  flex: '0 0 auto', flexShrink: 0, whiteSpace: 'nowrap',
                }}
              >시트↗</a>
            )}

            {/* User name + role badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: C.card, border: `1px solid ${C.borderLight}`,
              borderRadius: 8, padding: '3px 8px',
              flex: '0 0 auto', flexShrink: 0,
            }}>
              <span style={{
                fontSize: 11, fontWeight: 700, color: C.text,
                maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {authUser.name || authUser.id}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: authUser.role === 'ADMIN' ? '#7c3aed' : authUser.role === 'MANAGER' ? C.accent : C.textSoft,
                background: authUser.role === 'ADMIN' ? '#f5f3ff' : authUser.role === 'MANAGER' ? C.accentBg : C.borderLight,
                border: `1px solid ${authUser.role === 'ADMIN' ? '#ddd6fe' : authUser.role === 'MANAGER' ? C.accent + '44' : C.border}`,
                borderRadius: 5, padding: '1px 6px', letterSpacing: '0.02em', whiteSpace: 'nowrap',
              }}>
                {authUser.role || 'USER'}
              </span>
            </div>

            {/* Admin: 근무 panel button — MANAGE_USERS only */}
            {canManageUsers && (
              <button
                onClick={() => setShowWorkerPanel((v) => !v)}
                title="오늘 근무 현황"
                style={{
                  background: showWorkerPanel ? '#d1fae5' : C.accentBg,
                  border: `1px solid ${showWorkerPanel ? '#6ee7b7' : C.accent + '44'}`,
                  borderRadius: 7, padding: '4px 8px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, fontWeight: 700,
                  color: showWorkerPanel ? '#065f46' : C.accent,
                  flex: '0 0 auto', flexShrink: 0, whiteSpace: 'nowrap',
                }}
              >
                근무
              </button>
            )}

            {/* Admin: active sessions button */}
            {canManageUsers && (
              <button
                onClick={() => setShowSessionsModal(true)}
                title="접속중인 사용자 관리"
                style={{
                  background: C.accentBg, border: `1px solid ${C.accent}44`,
                  borderRadius: 7, padding: '4px 8px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, fontWeight: 700, color: C.accent,
                  flex: '0 0 auto', flexShrink: 0, whiteSpace: 'nowrap',
                }}
              >
                👥 접속현황
              </button>
            )}

            {/* Logout */}
            <button
              onClick={handleLogoutConfirm}
              title="로그아웃"
              style={{
                background: 'transparent', border: `1px solid ${C.borderLight}`,
                borderRadius: 7, padding: '4px 8px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
                color: C.textSecondary, fontSize: 11, fontWeight: 600,
                flex: '0 0 auto', flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              <LogOut size={13} strokeWidth={2} />
              로그아웃
            </button>
          </div>
        </div>

        {/* Row 3: scrollable action strip */}
        <ActionStrip
          downloading={downloading}
          dlProgress={dlProgress}
          syncing={syncing}
          resetting={resetting}
          showReset={showReset}
          resetPw={resetPw}
          onResetPwChange={setResetPw}
          onToggleReset={() => setShowReset((v) => !v)}
          onDownloadZip={handleDownloadZip}
          onDownloadAll={handleDownloadAll}
          onSyncHistory={handleSyncHistory}
          onReset={handleReset}
          authUser={authUser}
        />
      </header>

      {/* Content */}
      <main style={S.content}>
        {loading && !initialLoadDone && <LoadingBlock label="초기 데이터를 불러오는 중..." />}
        {loadError && <div style={S.errorBox}>⚠️ {loadError}</div>}

        {tab === "inspection" && (
          <InspectionPage
            jobKey={jobKey}
            rows={jobRows}
            config={config}
            records={records}
            happycall={happycall}
            inspectionRows={inspectionRows}
            productImageMap={productImageMap}
            onProductImageUploaded={handleProductImageUploaded}
            onError={(msg) => showToast(msg, "error")}
            onToast={showToast}
            onCsvUpload={handleCsvUpload}
            onRefresh={loadBootstrap}
            onRecordsUpdate={setRecords}
            onTargetSkuChange={setInspectionTargetSkuTotal}
            authUser={authUser}
          />
        )}
        {tab === "records" && (
          <RecordsPage
            records={records}
            jobKey={jobKey}
            inspectionRows={inspectionRows}
            config={config}
            onToast={showToast}
            onRefresh={loadBootstrap}
            onRecordsUpdate={setRecords}
            authUser={authUser}
          />
        )}
        {tab === "summary" && (
          <SummaryPage
            summary={summary}
            happycall={happycall}
            jobRows={jobRows}
            historyData={historyData}
            config={config}
            inspTargetSku={inspectionTargetSkuTotal}
            onToast={showToast}
            onRefresh={loadBootstrap}
          />
        )}
        {tab === "criteria" && (
          <CriteriaPage jobRows={jobRows} />
        )}
      </main>

      {/* Tab Bar */}
      <nav style={S.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              // Flush any pending return-sheet sync before entering records/summary tab
              // so the view shows data that includes the most recent movement saves.
              if (t.key !== 'inspection') flushPendingSync();
              setTab(t.key);
            }}
            style={{
              ...S.tabBtn,
              ...(tab === t.key ? S.tabBtnActive : {}),
              borderTop: tab === t.key ? `2px solid ${C.primary}` : "2px solid transparent",
            }}
          >
            <span style={{ ...S.tabIcon, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <t.icon size={18} strokeWidth={2} />
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Toast */}
      <AppToast toast={toast} />

      {/* Admin: active sessions modal — MANAGE_USERS only */}
      {canManageUsers && showSessionsModal && (
        <ActiveSessionsModal
          onClose={() => setShowSessionsModal(false)}
          showToast={showToast}
        />
      )}

      {/* Admin: 근무 worker panel — MANAGE_USERS only */}
      {canManageUsers && showWorkerPanel && (
        <WorkerPanel
          workers={workWorkers}
          onClose={() => setShowWorkerPanel(false)}
          onOpenSchedule={handleOpenSchedule}
        />
      )}

      {/* Admin: 근무 일정 modal — MANAGE_USERS only */}
      {canManageUsers && showScheduleModal && (
        <ScheduleModal
          months={scheduleLoading ? [] : (scheduleMonths || [])}
          loading={scheduleLoading}
          onClose={() => setShowScheduleModal(false)}
        />
      )}
    </div>
  );
}

export default App;