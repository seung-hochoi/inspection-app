# Helper script - can be deleted
target = r'C:\inspection-app-main (1)\inspection-app-main\src\App.js'
content = r"""import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import { BrowserMultiFormatReader } from '@zxing/browser';
import * as XLSX from 'xlsx';

const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "";
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
    const productCode = normalizeProductCode(getValue(row, ["상품코드", "상품 코드", "바코드", "코드"]));
    const productName = String(getValue(row, ["상품명", "상품 명", "품목명", "품명"]) || "").trim();
    const partner = String(
      getValue(row, ["협력사명(구매조건명)", "협력사명", "거래처명(구매조건명)", "거래처명", "협력사"]) || ""
    ).trim();
    const center = String(getValue(row, ["센터명", "센터"]) || "").trim();
    const qty = parseQty(getValue(row, ["총 발주수량", "발주수량", "수량"]));
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
  bg: "#f8fafc",
  card: "#ffffff",
  primary: "#2563eb",
  primaryDark: "#1d4ed8",
  green: "#16a34a",
  red: "#dc2626",
  orange: "#ea580c",
  gray: "#9ca3af",
  textDark: "#111827",
  textMid: "#374151",
  textSecondary: "#6b7280",
  border: "#e5e7eb",
  borderLight: "#f3f4f6",
};

const S = {
  app: {
    minHeight: "100vh",
    background: C.bg,
    fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    background: C.primary,
    color: "#fff",
    height: 56,
    display: "flex",
    alignItems: "center",
    padding: "0 16px",
    gap: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  },
  headerTitle: { fontSize: 17, fontWeight: 700, margin: 0, lineHeight: 1.2 },
  headerSub: { fontSize: 11, opacity: 0.75, margin: 0, lineHeight: 1.2 },
  headerRight: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 },
  tabBar: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    background: "#fff",
    borderTop: `1px solid ${C.border}`,
    display: "flex",
    height: 56,
    boxShadow: "0 -2px 8px rgba(0,0,0,0.06)",
  },
  tabBtn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 600,
    color: C.textSecondary,
    padding: "4px 0",
    fontFamily: "inherit",
  },
  tabBtnActive: { color: C.primary },
  tabIcon: { fontSize: 20 },
  content: { flex: 1, paddingTop: 56, paddingBottom: 64 },
  card: {
    background: C.card,
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    margin: "8px 12px",
    padding: 16,
  },
  cardNoPad: {
    background: C.card,
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    margin: "8px 12px",
    overflow: "hidden",
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: C.textDark, marginBottom: 4 },
  metaText: { fontSize: 12, color: C.textSecondary },
  btnPrimary: {
    background: C.primary,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 44,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontFamily: "inherit",
  },
  btnSecondary: {
    background: "#f1f5f9",
    color: C.textMid,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 44,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontFamily: "inherit",
  },
  btnDanger: {
    background: "#fef2f2",
    color: C.red,
    border: `1px solid #fecaca`,
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 40,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    fontFamily: "inherit",
  },
  btnIcon: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    fontSize: 18,
    fontFamily: "inherit",
  },
  btnStepper: {
    background: C.primary,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    width: 48,
    height: 48,
    fontSize: 22,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontFamily: "inherit",
  },
  input: {
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 15,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    minHeight: 48,
    color: C.textDark,
    background: "#fff",
  },
  inputSmall: {
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    minHeight: 40,
    color: C.textDark,
    background: "#fff",
  },
  qtyInput: {
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "8px",
    fontSize: 20,
    fontWeight: 700,
    textAlign: "center",
    width: 80,
    minHeight: 48,
    color: C.textDark,
    background: "#fff",
    boxSizing: "border-box",
    fontFamily: "inherit",
  },
  searchRow: { display: "flex", gap: 8, alignItems: "center", margin: "8px 12px" },
  badge: { borderRadius: 20, padding: "2px 8px", fontSize: 12, fontWeight: 600, display: "inline-block" },
  badgeBlue: { background: "#dbeafe", color: "#1e40af" },
  badgeGreen: { background: "#dcfce7", color: "#15803d" },
  badgeRed: { background: "#fee2e2", color: "#b91c1c" },
  badgeOrange: { background: "#fed7aa", color: "#c2410c" },
  badgeGray: { background: "#f3f4f6", color: "#6b7280" },
  productCard: { borderBottom: `1px solid ${C.borderLight}`, padding: "12px 16px" },
  productName: { fontSize: 16, fontWeight: 700, color: C.textDark, margin: 0 },
  productCode: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  partnerHeader: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    background: "#f8fafc",
    border: "none",
    cursor: "pointer",
    borderBottom: `1px solid ${C.border}`,
    fontFamily: "inherit",
  },
  partnerTitle: { fontSize: 15, fontWeight: 700, color: C.textDark },
  partnerCount: {
    fontSize: 12,
    color: C.textSecondary,
    background: "#e5e7eb",
    borderRadius: 12,
    padding: "2px 8px",
    fontWeight: 600,
  },
  statusDot: { width: 10, height: 10, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  toast: {
    position: "fixed",
    bottom: 72,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#1e293b",
    color: "#fff",
    borderRadius: 8,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    zIndex: 9999,
    whiteSpace: "nowrap",
    boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
    pointerEvents: "none",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    zIndex: 500,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  modalBox: {
    background: "#fff",
    borderRadius: "20px 20px 0 0",
    width: "100%",
    maxWidth: 640,
    maxHeight: "90vh",
    overflow: "auto",
    padding: 20,
    boxSizing: "border-box",
  },
  scannerOverlay: {
    position: "fixed",
    inset: 0,
    background: "#000",
    zIndex: 600,
    display: "flex",
    flexDirection: "column",
  },
  row: { display: "flex", gap: 8, alignItems: "center" },
  rowBetween: { display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" },
  divider: { height: 1, background: C.borderLight, margin: "8px 0" },
  emptyBox: { padding: 32, textAlign: "center", color: C.textSecondary, fontSize: 14 },
  hidden: { display: "none" },
  label: { fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 4, display: "block" },
  infoBox: {
    background: "#eff6ff",
    border: `1px solid #bfdbfe`,
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#1e40af",
    margin: "8px 12px",
  },
  errorBox: {
    background: "#fef2f2",
    border: `1px solid #fecaca`,
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#b91c1c",
    margin: "8px 12px",
  },
  summaryCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "14px 16px",
    flex: "1 1 130px",
    minWidth: 120,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    textAlign: "center",
  },
  summaryCardValue: { fontSize: 26, fontWeight: 800, color: C.textDark, margin: 0 },
  summaryCardLabel: { fontSize: 12, color: C.textSecondary, marginTop: 4 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    background: "#f8fafc",
    padding: "8px 10px",
    textAlign: "left",
    fontSize: 12,
    fontWeight: 700,
    color: C.textSecondary,
    borderBottom: `1px solid ${C.border}`,
  },
  td: {
    padding: "8px 10px",
    borderBottom: `1px solid ${C.borderLight}`,
    color: C.textDark,
    fontSize: 13,
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

// ─── Product Card ─────────────────────────────────────────────────────────────
function ProductCard({ product, jobKey, savedInspection, onSaved, showToast }) {
  const [qty, setQty] = useState(() => String(parseQty(savedInspection?.검품수량 || 0) || ""));
  const [memo, setMemo] = useState(() => String(savedInspection?.불량사유 || ""));
  const [status, setStatus] = useState("idle");
  const [showModal, setShowModal] = useState(false);
  const [photoCount, setPhotoCount] = useState(() => parseQty(savedInspection?.사진개수 || 0));
  const [zoomUrl, setZoomUrl] = useState("");
  const photoInputRef = useRef(null);
  const saveTimerRef = useRef(null);

  const statusColors = {
    idle: C.gray,
    pending: "#f59e0b",
    saving: C.primary,
    saved: C.green,
    error: C.red,
  };

  const cardBorderColor =
    status === "saved" || parseQty(qty) > 0
      ? status === "error"
        ? C.red
        : parseQty(qty) > 0
        ? C.primary
        : C.green
      : C.border;

  const doSave = useCallback(
    async (qtyVal, memoVal) => {
      if (!jobKey) return;
      setStatus("saving");
      try {
        await retryApi(() =>
          postApi({
            action: "saveBatch",
            rows: [
              {
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
                사진파일ID목록: "",
                BRIX최저: "",
                BRIX최고: "",
                BRIX평균: "",
              },
            ],
          })
        );
        setStatus("saved");
        onSaved?.();
      } catch (e) {
        setStatus("error");
        showToast?.(e.message || "저장 실패", "error");
      }
    },
    [jobKey, product, onSaved, showToast]
  );

  const scheduleSave = useCallback(
    (qtyVal, memoVal) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setStatus("pending");
      saveTimerRef.current = setTimeout(() => doSave(qtyVal, memoVal), 1500);
    },
    [doSave]
  );

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const handleQtyChange = (newQty) => {
    const clamped = Math.max(0, parseQty(newQty));
    setQty(String(clamped));
    scheduleSave(clamped, memo);
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !jobKey) return;
    try {
      const photos = await Promise.all(files.map(fileToBase64));
      await retryApi(() =>
        postApi({
          action: "uploadPhotos",
          payload: {
            작업기준일또는CSV식별값: jobKey,
            상품코드: product.productCode,
            상품명: product.productName,
            협력사명: product.partner,
            사진들: photos,
          },
        })
      );
      setPhotoCount((p) => p + files.length);
      showToast?.(`사진 ${files.length}장 업로드 완료`, "success");
    } catch (err) {
      showToast?.(err.message || "사진 업로드 실패", "error");
    } finally {
      e.target.value = "";
    }
  };

  const statusLabel = { idle: "", pending: "입력 중", saving: "저장 중", saved: "저장됨", error: "오류" };

  return (
    <div
      style={{
        ...S.productCard,
        borderLeft: `4px solid ${cardBorderColor}`,
        transition: "border-color 0.3s",
      }}
    >
      {/* Product header */}
      <div style={S.rowBetween}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...S.row, gap: 6, marginBottom: 2 }}>
            <StatusDot status={status} />
            <p style={{ ...S.productName, fontSize: 15 }}>{product.productName}</p>
          </div>
          <p style={S.productCode}>
            {product.productCode}
            {product.partner ? ` · ${product.partner}` : ""}
          </p>
          <div style={{ ...S.row, gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ ...S.badge, ...S.badgeGray }}>
              발주 {(product.totalQty || 0).toLocaleString()}개
            </span>
            {photoCount > 0 && (
              <span style={{ ...S.badge, ...S.badgeBlue }}>📷 {photoCount}</span>
            )}
            {status !== "idle" && statusLabel[status] && (
              <span
                style={{
                  ...S.badge,
                  background: "transparent",
                  color: statusColors[status],
                  padding: 0,
                  fontSize: 11,
                }}
              >
                {statusLabel[status]}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Qty stepper */}
      <div style={{ ...S.row, marginTop: 10, gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => handleQtyChange(parseQty(qty) - 1)}
          style={S.btnStepper}
        >
          －
        </button>
        <input
          type="number"
          min="0"
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
            scheduleSave(e.target.value, memo);
          }}
          style={S.qtyInput}
          placeholder="0"
        />
        <button
          onClick={() => handleQtyChange(parseQty(qty) + 1)}
          style={S.btnStepper}
        >
          ＋
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            onClick={() => setShowModal(true)}
            style={{ ...S.btnDanger, fontSize: 12, padding: "8px 10px", minHeight: 40 }}
          >
            회송/교환
          </button>
          <button
            onClick={() => photoInputRef.current?.click()}
            style={{ ...S.btnSecondary, padding: "8px 10px", fontSize: 13, minHeight: 40 }}
          >
            📷
          </button>
        </div>
      </div>

      {/* Memo */}
      <input
        type="text"
        value={memo}
        onChange={(e) => {
          setMemo(e.target.value);
          scheduleSave(qty, e.target.value);
        }}
        style={{ ...S.inputSmall, marginTop: 8 }}
        placeholder="불량사유 / 메모 (선택)"
      />

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handlePhotoUpload}
        style={S.hidden}
      />

      {showModal && (
        <ReturnExchangeModal
          product={product}
          jobKey={jobKey}
          onClose={() => setShowModal(false)}
          onSaved={onSaved}
          showToast={showToast}
        />
      )}

      {zoomUrl && <PhotoZoom url={zoomUrl} onClose={() => setZoomUrl("")} />}
    </div>
  );
}

// ─── Partner Group ─────────────────────────────────────────────────────────────
function PartnerGroup({
  partnerName,
  products,
  jobKey,
  inspectionRows,
  onSaved,
  showToast,
  defaultOpen,
}) {
  const [open, setOpen] = useState(defaultOpen || false);

  const savedMap = useMemo(() => {
    const map = {};
    (inspectionRows || []).forEach((r) => {
      const k = `${normalizeText(r.협력사명 || "")}||${normalizeProductCode(r.상품코드 || "")}`;
      map[k] = r;
    });
    return map;
  }, [inspectionRows]);

  return (
    <div style={S.cardNoPad}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={S.partnerHeader}
      >
        <span style={S.partnerTitle}>{partnerName}</span>
        <div style={S.row}>
          <span style={S.partnerCount}>{products.length}건</span>
          <span style={{ fontSize: 14, marginLeft: 4, color: C.textSecondary }}>
            {open ? "▲" : "▼"}
          </span>
        </div>
      </button>
      {open &&
        products.map((p) => {
          const savedKey = `${normalizeText(p.partner || "")}||${normalizeProductCode(p.productCode || "")}`;
          return (
            <ProductCard
              key={`${p.partner}||${p.productCode}`}
              product={p}
              jobKey={jobKey}
              savedInspection={savedMap[savedKey] || null}
              onSaved={onSaved}
              showToast={showToast}
            />
          );
        })}
    </div>
  );
}

// ─── Inspection Tab ───────────────────────────────────────────────────────────
function InspectionTab({
  jobKey,
  jobRows,
  inspectionRows,
  worksheetUrl,
  showToast,
  onCsvUpload,
  onRefresh,
}) {
  const [search, setSearch] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const csvInputRef = useRef(null);

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

      if (!map.has(partner)) map.set(partner, new Map());
      const pMap = map.get(partner);

      if (!pMap.has(code)) {
        pMap.set(code, {
          productCode: code,
          productName: name,
          partner,
          totalQty: 0,
          centers: [],
        });
      }
      const prod = pMap.get(code);
      prod.totalQty += qty;

      const cIdx = prod.centers.findIndex((c) => c.center === center);
      if (cIdx < 0) prod.centers.push({ center, qty });
      else prod.centers[cIdx].qty += qty;
    });

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([partner, pMap]) => ({
        partner,
        products: Array.from(pMap.values()),
      }));
  }, [jobRows, search]);

  const totalProducts = groupedProducts.reduce((s, g) => s + g.products.length, 0);

  const handleScanResult = useCallback((text) => {
    setSearch(text);
    setShowScanner(false);
  }, []);

  return (
    <div>
      {/* CSV upload row */}
      <div style={{ ...S.card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={S.sectionTitle}>검품 작업</div>
          <div
            style={{
              ...S.metaText,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 200,
            }}
          >
            {jobKey ? `작업: ${jobKey.slice(4, 14)}…` : "업로드된 작업 없음"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => csvInputRef.current?.click()}
            style={{ ...S.btnPrimary, fontSize: 13, padding: "8px 12px" }}
          >
            CSV 업로드
          </button>
          <button
            onClick={onRefresh}
            style={{ ...S.btnSecondary, padding: "8px 10px", minWidth: 44 }}
            title="새로고침"
          >
            🔄
          </button>
        </div>
        <input ref={csvInputRef} type="file" accept=".csv" onChange={onCsvUpload} style={S.hidden} />
      </div>

      {/* Worksheet link */}
      {worksheetUrl && (
        <div style={{ margin: "0 12px 8px" }}>
          <a
            href={worksheetUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 13, color: C.primary, fontWeight: 600 }}
          >
            📊 워크시트 열기 ↗
          </a>
        </div>
      )}

      {/* Search bar */}
      <div style={S.searchRow}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="상품명 / 상품코드 / 협력사 검색"
          style={{ ...S.input, flex: 1 }}
        />
        <button
          onClick={() => setShowScanner(true)}
          style={{ ...S.btnPrimary, minWidth: 52, padding: "10px 12px" }}
          title="바코드 스캔"
        >
          📷
        </button>
        {search && (
          <button onClick={() => setSearch("")} style={{ ...S.btnIcon, color: C.textSecondary }}>
            ✕
          </button>
        )}
      </div>

      {/* Count */}
      <div style={{ padding: "4px 12px 8px", fontSize: 13, color: C.textSecondary }}>
        총 {totalProducts}건
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
            onSaved={() => setRefreshTick((t) => t + 1)}
            showToast={showToast}
            defaultOpen={groupedProducts.length === 1}
          />
        ))
      )}

      {/* Barcode scanner */}
      {showScanner && (
        <BarcodeScanner onResult={handleScanResult} onClose={() => setShowScanner(false)} />
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

// ─── Main App ─────────────────────────────────────────────────────────────────
const TABS = [
  { key: "inspection", label: "검품", icon: "🔍" },
  { key: "records", label: "기록", icon: "📋" },
  { key: "summary", label: "요약", icon: "📊" },
];

function App() {
  const [tab, setTab] = useState("inspection");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [jobKey, setJobKey] = useState("");
  const [jobRows, setJobRows] = useState([]);
  const [inspectionRows, setInspectionRows] = useState([]);
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState({});
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
      setSummary(d.summary || {});
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={S.headerTitle}>검품 시스템</p>
          {currentFileName && (
            <p style={S.headerSub}>
              {currentFileName.length > 35
                ? currentFileName.slice(0, 35) + "…"
                : currentFileName}
            </p>
          )}
        </div>
        <div style={S.headerRight}>
          {worksheetUrl && (
            <a
              href={worksheetUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "rgba(255,255,255,0.9)",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
                padding: "6px 10px",
                background: "rgba(255,255,255,0.15)",
                borderRadius: 6,
              }}
            >
              시트
            </a>
          )}
          <button
            onClick={loadBootstrap}
            style={{ ...S.btnIcon, color: "#fff", fontSize: 18 }}
            title="새로고침"
          >
            🔄
          </button>
        </div>
      </header>

      {/* Content */}
      <main style={S.content}>
        {loading && <div style={S.infoBox}>⏳ 초기 데이터를 불러오는 중...</div>}
        {loadError && <div style={S.errorBox}>⚠️ {loadError}</div>}

        {tab === "inspection" && (
          <InspectionTab
            jobKey={jobKey}
            jobRows={jobRows}
            inspectionRows={inspectionRows}
            worksheetUrl={worksheetUrl}
            showToast={showToast}
            onCsvUpload={handleCsvUpload}
            onRefresh={loadBootstrap}
          />
        )}
        {tab === "records" && <RecordsTab showToast={showToast} />}
        {tab === "summary" && (
          <SummaryTab
            summary={summary}
            worksheetUrl={worksheetUrl}
            inspectionRows={inspectionRows}
            records={records}
            showToast={showToast}
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
            <span style={S.tabIcon}>{t.icon}</span>
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
"""

with open(target, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Written {len(content)} chars to {target}")
