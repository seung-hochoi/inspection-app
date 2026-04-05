import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import { BrowserMultiFormatReader } from '@zxing/browser';
import * as XLSX from 'xlsx';
import { ClipboardCheck, FileText, BarChart3 } from 'lucide-react';
import InspectionPage from './components/InspectionPage';
import RecordsPage from './components/RecordsPage';
import SummaryPage from './components/SummaryPage';

const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzIR8srYEDBgHOUKGfs0J3nk2BY4fsDPiw0J5cHfXUU7t77cEPWYw15mdUcW0T7oCw7Xg/exec";
const PENDING_KEY = "inspection_pending_v2";

// ─── Utility Functions ────────────────────────────────────────────────────────
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
    const partner = String(
      getValue(row, ["협력사명(구매조건명)", "협력사명", "거래처명(구매조건명)", "거래처명", "협력사"]) ||
        row.__partner || ""
    ).trim();
    const center = String(getValue(row, ["센터명", "센터"]) || row.__center || "").trim();
    const qty = parseQty(getValue(row, ["총 발주수량", "발주수량", "수량"]) || row.__qty || 0);
    return {
      ...row,
      __id: `${productCode || "empty"}-${center || "nocenter"}-${partner || "nopartner"}-${index}`,
      __index: index,
      __productCode: productCode,
      __productName: productName,
      __partner: partner,
      __center: center,
      __qty: qty,
      __productNameNormalized: normalizeText(productName),
      __partnerNormalized: normalizeText(partner),
    };
  });

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

const postApi = async (body) => {
  const resp = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok || data.ok === false) throw new Error(data.message || "API 오류");
  return data;
};

const retryApi = async (fn, retries = 3, delay = 2000) => {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delay));
      else throw err;
    }
  }
};

// ─── Styles ───────────────────────────────────────────────────────────────────
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
    height: 60,
    display: "flex",
    alignItems: "center",
    padding: "0 16px",
    gap: 10,
    boxShadow: `0 2px 14px ${C.shadow}`,
    borderBottom: `1px solid ${C.borderLight}`,
  },
  headerIcon: {
    width: 32, height: 32, borderRadius: 8,
    background: C.accent,
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "#fff", fontSize: 16, flexShrink: 0,
  },
  headerTitle: { fontSize: 17, fontWeight: 800, color: C.text, margin: 0, lineHeight: 1.2 },
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
  content: { flex: 1, paddingTop: 60, paddingBottom: 68 },
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

// ─── Small Helper Components ──────────────────────────────────────────────────
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

// ─── Barcode Scanner ─────────────────────────────────────────────────────────
function BarcodeScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [scanError, setScanError] = useState("");
  const [status, setStatus] = useState("카메라를 준비하고 있습니다...");

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const reader = new BrowserMultiFormatReader();
        let devices = [];
        try { devices = await BrowserMultiFormatReader.listVideoInputDevices(); } catch (_) {}
        const back = devices.find((d) => /back|rear|environment/i.test(d.label || "")) || devices[0];
        const cb = (result, err, controls) => {
          if (controls) controlsRef.current = controls;
          if (result) {
            const text =
              typeof result.getText === "function" ? result.getText() : String(result.text || result);
            if (text && !cancelled) {
              try { navigator.vibrate?.(100); } catch (_) {}
              onResult(text.replace(/\s+/g, "").trim());
            }
          }
          if (!err || err.name === "NotFoundException") {
            if (!cancelled) setStatus("바코드를 화면 중앙에 맞춰주세요.");
          }
        };
        if (back?.deviceId) {
          controlsRef.current = await reader.decodeFromVideoDevice(back.deviceId, videoRef.current, cb);
        } else {
          controlsRef.current = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
            videoRef.current,
            cb
          );
        }
        if (!cancelled) setStatus("바코드 인식 중...");
      } catch (e) {
        if (!cancelled) setScanError(e.message || "카메라를 시작할 수 없습니다.");
      }
    };
    start();
    return () => {
      cancelled = true;
      try { controlsRef.current?.stop(); } catch (_) {}
    };
  }, [onResult]);

  return (
    <div style={S.scannerOverlay}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, color: "#fff" }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>바코드 스캔</span>
        <button onClick={onClose} style={{ ...S.btnIcon, color: "#fff" }}>✕</button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        {scanError ? (
          <div style={{ color: "#fca5a5", textAlign: "center", padding: 24, fontSize: 14 }}>{scanError}</div>
        ) : (
          <>
            <div style={{ position: "relative", width: "100%", maxWidth: 360 }}>
              <video
                ref={videoRef}
                style={{ width: "100%", borderRadius: 8, display: "block" }}
                autoPlay
                playsInline
                muted
              />
              <div style={{
                position: "absolute",
                inset: 0,
                border: "2px solid rgba(255,255,255,0.6)",
                borderRadius: 8,
                pointerEvents: "none",
              }} />
            </div>
            <div style={{ color: "#e5e7eb", fontSize: 14 }}>{status}</div>
          </>
        )}
      </div>
      <div style={{ padding: 16 }}>
        <button onClick={onClose} style={{ ...S.btnSecondary, width: "100%" }}>닫기</button>
      </div>
    </div>
  );
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

// ─── Product Card ─────────────────────────────────────────────────────────────
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

// ─── Inspection Tab ───────────────────────────────────────────────────────────
function InspectionTab({ jobKey, jobRows, inspectionRows, worksheetUrl, showToast, onCsvUpload, onRefresh, happycall }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("전체"); // 전체 | 미입력 | 사진없음
  const [showScanner, setShowScanner] = useState(false);
  const csvInputRef = useRef(null);

  const savedMap = useMemo(() => {
    const map = {};
    (inspectionRows || []).forEach((r) => {
      const k = `${normalizeText(r.협력사명 || "")}||${normalizeProductCode(r.상품코드 || "")}`;
      map[k] = r;
    });
    return map;
  }, [inspectionRows]);

  const groupedProducts = useMemo(() => {
    const keyword = normalizeText(search);
    const map = new Map();

    (jobRows || []).forEach((row) => {
      const code = row.__productCode;
      if (!code) return;
      const name = row.__productName || "상품명 없음";
      const partner = row.__partner || "협력사 없음";
      const center = row.__center || "";
      const qty = row.__qty || 0;

      const matched =
        !keyword ||
        normalizeText(name).includes(keyword) ||
        normalizeText(partner).includes(keyword) ||
        String(code).toLowerCase().includes(search.trim().toLowerCase());
      if (!matched) return;

      // Filter: 미입력 — only products with no inspection qty saved
      if (filter === "미입력") {
        const sk = `${normalizeText(partner)}||${normalizeProductCode(code)}`;
        const saved = savedMap[sk];
        if (saved && parseQty(saved.검품수량) > 0) return;
      }

      if (!map.has(partner)) map.set(partner, new Map());
      const pMap = map.get(partner);
      if (!pMap.has(code)) {
        pMap.set(code, { productCode: code, productName: name, partner, totalQty: 0, centers: [] });
      }
      const prod = pMap.get(code);
      prod.totalQty += qty;
      const cIdx = prod.centers.findIndex((c) => c.center === center);
      if (cIdx < 0) prod.centers.push({ center, qty });
      else prod.centers[cIdx].qty += qty;
    });

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([partner, pMap]) => ({ partner, products: Array.from(pMap.values()) }));
  }, [jobRows, search, filter, savedMap]);

  const totalProducts = groupedProducts.reduce((s, g) => s + g.products.length, 0);
  const totalOrdered = (jobRows || []).reduce((s, r) => s + (r.__qty || 0), 0);

  const FILTERS = ["전체", "미입력", "사진없음"];

  return (
    <div>
      {/* Search + scan card */}
      <div style={{ ...S.card, padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
              fontSize: 15, color: C.textSecondary, pointerEvents: "none" }}>🔍</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="상품명 또는 코드 검색"
              style={{ ...S.input, paddingLeft: 38, minHeight: 44 }}
            />
          </div>
          <button
            onClick={() => setShowScanner(true)}
            style={{ ...S.btnPrimary, minWidth: 80, gap: 6, flexShrink: 0 }}
          >
            <span style={{ fontSize: 14 }}>📊</span>
            <span>스캔</span>
          </button>
          {search && (
            <button onClick={() => setSearch("")}
              style={{ ...S.btnIcon, color: C.textSecondary, flexShrink: 0 }}>✕</button>
          )}
        </div>

        {/* Filter chips */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                border: "none", cursor: "pointer", fontFamily: "inherit",
                borderRadius: 20, padding: "6px 16px", fontSize: 13, fontWeight: 700,
                transition: "all 0.15s",
                background: filter === f ? C.accent : C.card,
                color: filter === f ? "#fff" : C.textSoft,
                boxShadow: filter === f ? `0 2px 8px ${C.shadow}` : "none",
              }}
            >{f}</button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.textSecondary }}>
            {totalProducts}건
          </span>
        </div>
      </div>

      {/* CSV toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 12px 8px",
        padding: "8px 14px", background: C.cardWhite, borderRadius: 10,
        border: `1px solid ${C.borderLight}` }}>
        <span style={{ fontSize: 12, color: C.textSecondary, flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {jobKey ? `발주 ${totalOrdered.toLocaleString()}개` : "CSV를 업로드해 주세요"}
        </span>
        {worksheetUrl && (
          <a href={worksheetUrl} target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: C.accent, fontWeight: 600, textDecoration: "none",
              flexShrink: 0 }}>
            시트↗
          </a>
        )}
        <button
          onClick={() => csvInputRef.current?.click()}
          style={{ display: "flex", alignItems: "center", gap: 6, background: C.orangeBg,
            border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 12px",
            cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.orange, flexShrink: 0 }}
        >
          📁 CSV 업로드
        </button>
        <button onClick={onRefresh}
          style={{ ...S.btnIcon, padding: 6, minWidth: 36, minHeight: 36, fontSize: 16, flexShrink: 0 }}
          title="새로고침">🔄</button>
        <input ref={csvInputRef} type="file" accept=".csv" onChange={onCsvUpload} style={S.hidden} />
      </div>

      {/* Product groups */}
      {groupedProducts.length === 0 ? (
        <div style={S.emptyBox}>
          {jobKey ? "검색 결과가 없습니다." : "CSV를 업로드하면 상품 목록이 나타납니다."}
        </div>
      ) : (
        groupedProducts.map((group) => (
          <PartnerGroup
            key={group.partner}
            partnerName={group.partner}
            products={group.products}
            jobKey={jobKey}
            inspectionRows={inspectionRows}
            onSaved={onRefresh}
            showToast={showToast}
            defaultOpen={groupedProducts.length === 1}
            happycall={happycall}
          />
        ))
      )}

      {showScanner && (
        <BarcodeScanner onResult={(t) => { setSearch(t); setShowScanner(false); }}
          onClose={() => setShowScanner(false)} />
      )}
    </div>
  );
}



// ─── Records Tab ──────────────────────────────────────────────────────────────
function RecordsTab({ showToast }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState("전체");
  const [filterPartner, setFilterPartner] = useState("");
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [expandedRow, setExpandedRow] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loadRecords = useCallback(async () => {
    if (!SCRIPT_URL) return;
    setLoading(true);
    try {
      const resp = await fetch(`${SCRIPT_URL}?action=getRecords`);
      const data = await resp.json();
      if (!resp.ok || data.ok === false) throw new Error(data.message || "기록 로드 실패");
      setRecords(
        (Array.isArray(data.records) ? data.records : []).sort((a, b) =>
          String(b.작성일시 || "").localeCompare(String(a.작성일시 || ""), "ko")
        )
      );
    } catch (e) {
      showToast(e.message || "기록 로드 실패", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const partners = useMemo(() => {
    const set = new Set(records.map((r) => String(r.협력사명 || "")));
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b, "ko"));
  }, [records]);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      const type = getRecordType(r);
      if (filterType !== "전체" && type !== filterType) return false;
      if (filterPartner && String(r.협력사명 || "") !== filterPartner) return false;
      if (filterStart) {
        const d = new Date(r.작성일시 || "");
        if (d < new Date(filterStart)) return false;
      }
      if (filterEnd) {
        const d = new Date(r.작성일시 || "");
        const end = new Date(filterEnd);
        end.setDate(end.getDate() + 1);
        if (d > end) return false;
      }
      return true;
    });
  }, [records, filterType, filterPartner, filterStart, filterEnd]);

  const handleDelete = async (record) => {
    const rowNumber = Number(record.__rowNumber || 0);
    if (!rowNumber || !window.confirm("이 내역을 삭제할까요?")) return;
    setDeletingId(rowNumber);
    try {
      await retryApi(() =>
        postApi({ action: "cancelMovementEvent", payload: { rowNumber } })
      );
      setRecords((prev) => prev.filter((r) => Number(r.__rowNumber) !== rowNumber));
      showToast("삭제 완료", "success");
    } catch (e) {
      showToast(e.message || "삭제 실패", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const typeBadge = (type) => {
    if (type === "회송") return { ...S.badge, ...S.badgeRed };
    if (type === "교환") return { ...S.badge, ...S.badgeOrange };
    return { ...S.badge, ...S.badgeGray };
  };

  return (
    <div>
      {/* Filters */}
      <div style={S.card}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 100px", minWidth: 80 }}>
            <label style={S.label}>유형</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={S.inputSmall}
            >
              <option>전체</option>
              <option>회송</option>
              <option>교환</option>
            </select>
          </div>
          <div style={{ flex: "2 1 140px", minWidth: 120 }}>
            <label style={S.label}>협력사</label>
            <select
              value={filterPartner}
              onChange={(e) => setFilterPartner(e.target.value)}
              style={S.inputSmall}
            >
              <option value="">전체</option>
              {partners.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: "1 1 120px", minWidth: 110 }}>
            <label style={S.label}>시작일</label>
            <input
              type="date"
              value={filterStart}
              onChange={(e) => setFilterStart(e.target.value)}
              style={S.inputSmall}
            />
          </div>
          <div style={{ flex: "1 1 120px", minWidth: 110 }}>
            <label style={S.label}>종료일</label>
            <input
              type="date"
              value={filterEnd}
              onChange={(e) => setFilterEnd(e.target.value)}
              style={S.inputSmall}
            />
          </div>
        </div>
        <div style={{ ...S.rowBetween, marginTop: 10 }}>
          <span style={S.metaText}>{filtered.length}건 표시</span>
          <button
            onClick={loadRecords}
            disabled={loading}
            style={{ ...S.btnSecondary, fontSize: 13, minHeight: 40, padding: "8px 14px" }}
          >
            {loading ? "로딩 중..." : "새로고침"}
          </button>
        </div>
      </div>

      {/* Records list */}
      {filtered.length === 0 ? (
        <div style={S.emptyBox}>{loading ? "로딩 중..." : "표시할 내역이 없습니다."}</div>
      ) : (
        filtered.map((record, i) => {
          const type = getRecordType(record);
          const qty =
            type === "회송"
              ? parseQty(record.회송수량)
              : type === "교환"
              ? parseQty(record.교환수량)
              : Math.max(parseQty(record.회송수량), parseQty(record.교환수량));
          const rowNum = Number(record.__rowNumber || i);
          const isExpanded = expandedRow === rowNum;

          return (
            <div key={rowNum} style={S.card}>
              <div
                style={{ cursor: "pointer" }}
                onClick={() => setExpandedRow(isExpanded ? null : rowNum)}
              >
                <div style={S.rowBetween}>
                  <span style={typeBadge(type)}>{type}</span>
                  <span style={{ fontSize: 12, color: C.textSecondary }}>
                    {formatDateShort(record.작성일시)}
                  </span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.textDark }}>
                    {record.상품명 || "-"}
                  </div>
                  <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
                    {[record.협력사명, record.센터명, `${qty}개`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {record.비고 && (
                  <div
                    style={{
                      fontSize: 12,
                      color: C.textSecondary,
                      marginTop: 4,
                      fontStyle: "italic",
                    }}
                  >
                    "{record.비고}"
                  </div>
                )}
              </div>

              {isExpanded && (
                <div
                  style={{
                    marginTop: 12,
                    borderTop: `1px solid ${C.borderLight}`,
                    paddingTop: 12,
                  }}
                >
                  {[
                    ["상품코드", record.상품코드],
                    ["협력사", record.협력사명],
                    ["센터", record.센터명],
                    ["발주수량", record.발주수량],
                    ["회송수량", record.회송수량],
                    ["교환수량", record.교환수량],
                    ["비고", record.비고],
                    ["작성일시", formatDateTime(record.작성일시)],
                    ["수정일시", record.수정일시 ? formatDateTime(record.수정일시) : null],
                  ]
                    .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== 0)
                    .map(([k, v]) => (
                      <div
                        key={k}
                        style={{
                          display: "flex",
                          gap: 8,
                          marginBottom: 6,
                          fontSize: 13,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ color: C.textSecondary, minWidth: 70 }}>{k}</span>
                        <span style={{ color: C.textDark, fontWeight: 500 }}>{String(v)}</span>
                      </div>
                    ))}

                  {parseQty(record.사진개수) > 0 && (
                    <div style={{ ...S.metaText, marginBottom: 8 }}>
                      📷 사진 {record.사진개수}장
                    </div>
                  )}

                  <button
                    onClick={() => handleDelete(record)}
                    disabled={deletingId === rowNum}
                    style={{
                      ...S.btnDanger,
                      marginTop: 8,
                      opacity: deletingId === rowNum ? 0.6 : 1,
                    }}
                  >
                    {deletingId === rowNum ? "삭제 중..." : "🗑 삭제"}
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────
function SummaryTab({ summary, worksheetUrl, inspectionRows, records, showToast }) {
  const [recalcing, setRecalcing] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminPw, setAdminPw] = useState("");
  const [resetting, setResetting] = useState(false);

  const inspectionRate = useMemo(() => {
    const ordered = parseQty(summary.발주수량합계);
    const inspected = parseQty(summary.검품수량합계);
    if (!ordered) return null;
    return ((inspected / ordered) * 100).toFixed(1);
  }, [summary]);

  const partnerBreakdown = useMemo(() => {
    const map = {};
    (inspectionRows || []).forEach((r) => {
      const p = String(r.협력사명 || "").trim() || "알 수 없음";
      if (!map[p]) map[p] = { partner: p, ordered: 0, inspected: 0, returns: 0, exchanges: 0 };
      map[p].ordered += parseQty(r.발주수량);
      map[p].inspected += parseQty(r.검품수량);
    });
    (records || []).forEach((r) => {
      const p = String(r.협력사명 || "").trim() || "알 수 없음";
      if (!map[p]) map[p] = { partner: p, ordered: 0, inspected: 0, returns: 0, exchanges: 0 };
      map[p].returns += parseQty(r.회송수량);
      map[p].exchanges += parseQty(r.교환수량);
    });
    return Object.values(map).sort((a, b) => a.partner.localeCompare(b.partner, "ko"));
  }, [inspectionRows, records]);

  const handleRecalc = async () => {
    setRecalcing(true);
    try {
      await postApi({ action: "manualRecalc" });
      showToast("재계산 완료", "success");
    } catch (e) {
      showToast(e.message || "재계산 실패", "error");
    } finally {
      setRecalcing(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("현재 작업 데이터를 초기화할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    setResetting(true);
    try {
      await postApi({
        action: "resetCurrentJobInputData",
        payload: { password: adminPw },
      });
      showToast("초기화 완료", "success");
      setShowAdmin(false);
      setAdminPw("");
    } catch (e) {
      showToast(e.message || "초기화 실패", "error");
    } finally {
      setResetting(false);
    }
  };

  const summaryCards = [
    { label: "발주수량합계", value: parseQty(summary.발주수량합계).toLocaleString("ko-KR"), color: C.textDark },
    { label: "검품수량합계", value: parseQty(summary.검품수량합계).toLocaleString("ko-KR"), color: C.primary },
    { label: "검품완료", value: String(parseQty(summary.검품완료 || 0)), color: C.green },
    { label: "회송수량합계", value: parseQty(summary.회송수량합계).toLocaleString("ko-KR"), color: C.red },
    { label: "교환수량합계", value: parseQty(summary.교환수량합계).toLocaleString("ko-KR"), color: C.orange },
    {
      label: "검품률",
      value: inspectionRate !== null ? `${inspectionRate}%` : "-",
      color: C.primary,
    },
  ];

  return (
    <div>
      {/* Summary cards */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "8px 12px",
        }}
      >
        {summaryCards.map((card) => (
          <div key={card.label} style={S.summaryCard}>
            <div style={{ ...S.summaryCardValue, color: card.color }}>{card.value}</div>
            <div style={S.summaryCardLabel}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ ...S.card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={handleRecalc}
          disabled={recalcing}
          style={{ ...S.btnPrimary, opacity: recalcing ? 0.7 : 1 }}
        >
          {recalcing ? "계산 중..." : "🔄 수동 재계산"}
        </button>
        {worksheetUrl && (
          <a
            href={worksheetUrl}
            target="_blank"
            rel="noreferrer"
            style={{ ...S.btnSecondary, textDecoration: "none" }}
          >
            📊 워크시트
          </a>
        )}
      </div>

      {/* Partner breakdown */}
      {partnerBreakdown.length > 0 && (
        <div style={{ ...S.card, overflowX: "auto" }}>
          <div style={{ ...S.sectionTitle, marginBottom: 10 }}>협력사별 현황</div>
          <table style={S.table}>
            <thead>
              <tr>
                {["협력사", "발주", "검품", "회송", "교환"].map((h) => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partnerBreakdown.map((row) => (
                <tr key={row.partner}>
                  <td style={S.td}>{row.partner}</td>
                  <td style={S.td}>{row.ordered.toLocaleString("ko-KR")}</td>
                  <td style={{ ...S.td, color: row.inspected > 0 ? C.primary : C.textSecondary }}>
                    {row.inspected.toLocaleString("ko-KR")}
                  </td>
                  <td style={{ ...S.td, color: row.returns > 0 ? C.red : C.textSecondary }}>
                    {row.returns.toLocaleString("ko-KR")}
                  </td>
                  <td style={{ ...S.td, color: row.exchanges > 0 ? C.orange : C.textSecondary }}>
                    {row.exchanges.toLocaleString("ko-KR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Admin */}
      <div style={S.card}>
        <button
          onClick={() => setShowAdmin((s) => !s)}
          style={{ ...S.btnSecondary, fontSize: 13 }}
        >
          🔧 관리자 메뉴 {showAdmin ? "▲" : "▼"}
        </button>
        {showAdmin && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={S.label}>관리자 비밀번호</label>
              <input
                type="password"
                value={adminPw}
                onChange={(e) => setAdminPw(e.target.value)}
                placeholder="비밀번호 입력"
                style={S.input}
              />
            </div>
            <button
              onClick={handleReset}
              disabled={resetting || !adminPw}
              style={{
                ...S.btnDanger,
                opacity: resetting || !adminPw ? 0.6 : 1,
              }}
            >
              {resetting ? "초기화 중..." : "⚠️ 현재 작업 데이터 초기화"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const TABS = [
  { key: "inspection", label: "검품", icon: ClipboardCheck },
  { key: "records",    label: "기록", icon: FileText },
  { key: "summary",   label: "요약", icon: BarChart3 },
];

function App() {
  const [tab, setTab] = useState("inspection");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [jobKey, setJobKey] = useState("");
  const [jobRows, setJobRows] = useState([]);
  const [inspectionRows, setInspectionRows] = useState([]);
  const [records, setRecords] = useState([]);
  const [config, setConfig] = useState({});
  const [summary, setSummary] = useState({});
  const [happycall, setHappycall] = useState({});
  const [worksheetUrl, setWorksheetUrl] = useState("");
  const [currentFileName, setCurrentFileName] = useState("");
  const [toast, setToast] = useState({ message: "", type: "info" });

  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: "", type: "info" }), 2400);
  }, []);

  const loadBootstrap = useCallback(async () => {
    if (!SCRIPT_URL) {
      setLoadError("REACT_APP_GOOGLE_SCRIPT_URL 환경변수를 설정해 주세요.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const resp = await fetch(`${SCRIPT_URL}?action=bootstrap`);
      const result = await resp.json();
      if (!resp.ok || result.ok === false)
        throw new Error(result.message || "초기 데이터 로드 실패");
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
    } catch (e) {
      setLoadError(e.message || "초기 데이터 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBootstrap(); }, [loadBootstrap]);

  const handleCsvUpload = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!SCRIPT_URL) {
        showToast("SCRIPT_URL이 설정되지 않았습니다.", "error");
        return;
      }
      showToast("CSV 처리 중...", "info");
      try {
        const { text } = await decodeCsvFile(file);
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        const normalized = buildNormalizedRows(parsed.data || []);
        const key = computeJobKey(normalized);
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
        setJobRows(buildNormalizedRows(job.rows || normalized));
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

  return (
    <div style={S.app}>
      <style>{`* { box-sizing: border-box; } body { margin: 0; } input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { opacity: 1; }`}</style>

      {/* Header */}
      <header style={S.header}>
        <div style={S.headerIcon}>☑</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={S.headerTitle}>검품 시스템</p>
          {currentFileName && (
            <p style={S.headerSub}>
              {currentFileName.length > 40 ? currentFileName.slice(0, 40) + "…" : currentFileName}
            </p>
          )}
        </div>
        <div style={S.headerRight}>
          {worksheetUrl && (
            <a
              href={worksheetUrl} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: C.accent, fontWeight: 600, textDecoration: "none",
                padding: "6px 10px", background: C.accentBg, borderRadius: 8 }}
            >시트↗</a>
          )}
          <button onClick={loadBootstrap}
            style={{ ...S.btnIcon, color: C.textSecondary, fontSize: 16 }}
            title="새로고침">🔄</button>
        </div>
      </header>

      {/* Content */}
      <main style={S.content}>
        {loading && <div style={S.infoBox}>⏳ 초기 데이터를 불러오는 중...</div>}
        {loadError && <div style={S.errorBox}>⚠️ {loadError}</div>}

        {tab === "inspection" && (
          <InspectionPage
            jobKey={jobKey}
            rows={jobRows}
            config={config}
            records={records}
            happycall={happycall}
            inspectionRows={inspectionRows}
            onError={(msg) => showToast(msg, "error")}
            onToast={showToast}
            onCsvUpload={handleCsvUpload}
          />
        )}
        {tab === "records" && (
          <RecordsPage
            records={records}
            jobKey={jobKey}
            inspectionRows={inspectionRows}
            onToast={showToast}
            onRefresh={loadBootstrap}
          />
        )}
        {tab === "summary" && (
          <SummaryPage
            summary={summary}
            happycall={happycall}
            onToast={showToast}
            onRefresh={loadBootstrap}
          />
        )}
      </main>

      {/* Tab Bar */}
      <nav style={S.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
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
    </div>
  );
}

export default App;