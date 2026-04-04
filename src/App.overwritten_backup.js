import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserCodeReader, BrowserMultiFormatReader } from "@zxing/browser";
import Papa from "papaparse";
import ReferenceFunctionalApp from "./components/ReferenceFunctionalApp";

const SHEET_URL =
  process.env.REACT_APP_TEST_SHEET_URL ||
  "https://docs.google.com/spreadsheets/d/1_U2ruKLFTtlyg4bTMF7TAemTPkb0nY9XLiQ2VlOl14g/edit?gid=218388868#gid=218388868";
const SCRIPT_URL =
  process.env.REACT_APP_TEST_SCRIPT_URL ||
  process.env.REACT_APP_GOOGLE_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbyEr-lJEFQ1YMcPX1ZVO7wAUQRfCG4DnkVnBqrTd-e5JQf35KuPAzIV11JXckyOsq76gg/exec";
const GS25_LOGO_SRC =
  'data:image/svg+xml;utf8,%3Csvg%20width%3D%22132%22%20height%3D%2242%22%20viewBox%3D%220%200%20132%2042%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20clip-path%3D%22url(%23clip0)%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20clip-rule%3D%22evenodd%22%20d%3D%22M34.3313%2037.7147V18.0093H17.564L18.7396%2025.4541H25.6881V32.6606C24.0683%2033.552%2022.4966%2033.9598%2020.2934%2033.9598C13.3896%2033.9598%209.91804%2028.6135%209.91804%2020.9991C9.91804%2013.3847%2013.2718%208.26576%2020.1828%208.26576C24.3073%208.26576%2027.8395%209.79044%2030.849%2011.7247L32.187%202.98801C28.9919%201.16742%2024.8746%200%2019.9438%200C7.58821%200%20-0.0078125%208.49491%20-0.0078125%2021.055C-0.0078125%2033.6152%207.012%2042%2019.7137%2042C25.2243%2042%2030.1551%2040.4771%2034.3331%2037.7165L34.3313%2037.7147Z%22%20fill%3D%22%23007AFF%22/%3E%3Cpath%20fill-rule%3D%22evenodd%22%20clip-rule%3D%22evenodd%22%20d%3D%22M66.9404%2029.0303C66.9404%2022.5815%2063.4689%2019.5303%2054.7704%2016.3005C49.7771%2014.3699%2048.6693%2013.372%2048.6693%2011.3061C48.6693%209.43133%2050.1214%208.15926%2053.147%208.15926C56.1726%208.15926%2059.9848%209.32127%2063.5777%2011.4306L65.0869%202.98978C61.5993%201.29008%2058.2437%200.290466%2053.0221%200.290466C45.3708%200.290466%2039.3411%204.4459%2039.3411%2012.2552C39.3411%2018.9403%2042.8162%2021.5855%2050.8207%2024.689C56.4509%2026.8668%2057.6068%2027.9278%2057.6068%2030.2085C57.6068%2032.6119%2055.6356%2033.8461%2052.7884%2033.8461C48.7906%2033.8461%2044.2148%2032.3178%2040.0921%2030.0966L38.6436%2038.6565C42.7074%2040.5312%2047.2279%2041.6968%2052.6136%2041.6968C60.5664%2041.6968%2066.9422%2037.8337%2066.9422%2029.0321L66.9404%2029.0303Z%22%20fill%3D%22%23007AFF%22/%3E%3Cpath%20d%3D%22M87.1773%2027.1322C91.7941%2024.0612%2098.0665%2020.0663%2098.0665%2012.4628C98.0665%204.1122%2091.0716%200.310425%2084.5727%200.310425C74.877%200.310425%2070.9684%208.10524%2070.4189%209.32138L77.899%2012.8615C78.3646%2012.0171%2080.4465%208.65016%2083.9252%208.65016C86.1729%208.65016%2088.3672%2010.5177%2088.3672%2013.4209C88.3672%2015.7593%2085.7626%2017.524%2082.5212%2019.7578C77.3817%2023.2997%2070.9862%2027.7078%2070.9862%2036.7674C70.9862%2037.9547%2071.1183%2039.2755%2071.4019%2040.9102H98.0736V32.796H81.6221C81.6221%2031.0188%2084.1731%2029.1278%2087.1773%2027.1322Z%22%20fill%3D%22%232FCCEF%22/%3E%3Cpath%20d%3D%22M121.229%2012.6414C120.715%2012.4718%20119.807%2012.2209%20118.888%2012.2209C116.339%2012.2209%20114.275%2014.3104%20114.275%2016.887C114.275%2018.639%20115.194%2020.1367%20116.642%2020.9631C117.281%2021.3275%20118.903%2021.8201%20119.359%2022.0673C121.299%2023.1156%20122.617%2025.1834%20122.617%2027.5634C122.617%2031.0043%20119.859%2033.7956%20116.455%2033.7956C113.228%2033.7956%20110.581%2031.284%20110.317%2028.0867L102.061%2029.9018C103.406%2036.7963%20109.414%2041.9964%20116.626%2041.9964C124.827%2041.9964%20131.476%2035.2734%20131.476%2026.977C131.476%2020.3045%20127.178%2014.5937%20121.227%2012.6378L121.229%2012.6414ZM118.888%2019.9923C117.196%2019.9923%20115.82%2018.5993%20115.82%2016.887C115.82%2015.1747%20117.197%2013.7835%20118.888%2013.7835C120.58%2013.7835%20121.957%2015.1765%20121.957%2016.887C121.957%2018.5975%20120.58%2019.9923%20118.888%2019.9923Z%22%20fill%3D%22%232FCCEF%22/%3E%3Cpath%20d%3D%22M104.634%200.865845L103.007%2019.6131H111.311L112.371%208.96019H121.909C127.552%208.96019%20129.604%204.33382%20129.604%200.865845H104.634Z%22%20fill%3D%22%232FCCEF%22/%3E%3C/g%3E%3Cdefs%3E%3CclipPath%20id%3D%22clip0%22%3E%3Crect%20width%3D%22131.478%22%20height%3D%2242%22%20fill%3D%22white%22/%3E%3C/clipPath%3E%3C/defs%3E%3C/svg%3E';
const SAVE_DEBOUNCE_MS = 700;
const POST_SYNC_DEBOUNCE_MS = 1800;
const STATUS_LABELS = {
  editing: "입력중",
  uploading: "업로드중",
  pending: "저장대기",
  saving: "저장중",
  saved: "저장완료",
  conflict: "충돌",
  failed: "실패",
};

const STATUS_TONE = {
  editing: { bg: "#f2f5f9", color: "#516274" },
  uploading: { bg: "#edf4ff", color: "#1473ff" },
  pending: { bg: "#edf4ff", color: "#1473ff" },
  saving: { bg: "#edf4ff", color: "#1473ff" },
  saved: { bg: "#eef9ef", color: "#24a148" },
  conflict: { bg: "#fff4e8", color: "#f08a00" },
  failed: { bg: "#fff6f6", color: "#e44747" },
};

const parseQty = (value) => {
  const num = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : 0;
};

const normalizeCode = (value) =>
  String(value ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/^"+|"+$/g, "")
    .replace(/^=T\("(.+)"\)$/i, "$1")
    .replace(/\.0+$/, "")
    .trim();

const readField = (row, keys) => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
};

const makeProductKey = (product) => `${product.partner}||${product.productCode}`;
const makeMovementKey = (movementType, product, centerName = "") =>
  `${movementType}||${product.partner}||${product.productCode}||${centerName}`;
const createOperationId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const createLocalPhotoId = () => `photo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const encodeBase64Utf8 = (value) => {
  const utf8 = new TextEncoder().encode(String(value ?? ""));
  let binary = "";
  utf8.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const postAction = async (action, payload) => {
  const response = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) {
    throw new Error(result.message || `${action} 실패`);
  }
  return result;
};

const buildNormalizedRows = (rows) => {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const cleanText = (value) =>
    String(value ?? "")
      .replace(/\uFEFF/g, "")
      .replace(/^"+|"+$/g, "")
      .trim();

  const parseSafeNumber = (value) => {
    const raw = cleanText(value).replace(/,/g, "").replace(/\s+/g, "");
    if (!raw) return 0;
    const num = Number(raw);
    return Number.isFinite(num) ? num : 0;
  };

  const normalized = sourceRows
    .map((row, index) => {
      const partnerName = cleanText(
        readField(row, ["거래처명(구매조건명)", "거래처명", "협력사", "partner", "supplier", "vendor"])
      );
      const productName = cleanText(readField(row, ["상품명", "품목명", "productName", "product_name", "name"]));
      const productCode = normalizeCode(
        readField(row, ["상품코드", "품목코드", "바코드", "productCode", "product_code", "barcode", "sku"])
      );
      const centerName = cleanText(readField(row, ["센터명", "센터", "center", "centerName", "center_name"]));
      const orderQtyRaw = readField(row, ["총 발주수량", "발주수량", "수량", "orderQty", "order_qty", "qty", "quantity"]);
      const unitCostRaw = readField(row, ["입고원가", "원가", "unitCost", "unitPrice", "unit_price", "price"]);
      const orderQty = parseSafeNumber(orderQtyRaw);
      const unitCost = parseSafeNumber(unitCostRaw);

      console.log("[buildNormalizedRows] row candidate", {
        index,
        partnerName,
        productName,
        productCode,
        orderQty,
        unitCost,
        centerName,
      });

      if (!partnerName) {
        console.log("[buildNormalizedRows] dropped row", { index, reason: "partnerName missing", row });
        return null;
      }
      if (!productName) {
        console.log("[buildNormalizedRows] dropped row", { index, reason: "productName missing", row });
        return null;
      }
      if (!productCode) {
        console.log("[buildNormalizedRows] dropped row", { index, reason: "productCode missing", row });
        return null;
      }

      return {
        partner: partnerName,
        productName,
        productCode,
        center: centerName,
        orderQty,
        unitPrice: unitCost,
        inspectionQty: 0,
        returnQty: 0,
        exchangeQty: 0,
      };
    })
    .filter(Boolean);

  if (normalized.length === 0) {
    const sampleKeys = sourceRows.length > 0 ? Object.keys(sourceRows[0] || {}) : [];
    console.log("[buildNormalizedRows] 0 rows generated", {
      inputCount: sourceRows.length,
      sampleKeys,
      firstRow: sourceRows.length > 0 ? sourceRows[0] : null,
    });
  } else {
    console.log("[buildNormalizedRows] rows generated", {
      inputCount: sourceRows.length,
      outputCount: normalized.length,
      firstRawRow: sourceRows[0] || null,
      firstNormalizedRow: normalized[0] || null,
      firstThree: normalized.slice(0, 3).map((row) => ({
        partner: row.partner,
        productName: row.productName,
        productCode: row.productCode,
        orderQty: row.orderQty,
      })),
    });
  }

  return normalized;
};

const buildGroupedPartners = (rows, search) => {
  const keyword = String(search || "").trim().toLowerCase();
  const partnerMap = new Map();

  rows.forEach((row) => {
    if (keyword) {
      const haystack = `${row.productName} ${row.productCode} ${row.partner} ${row.center}`.toLowerCase();
      if (!haystack.includes(keyword)) return;
    }

    if (!partnerMap.has(row.partner)) partnerMap.set(row.partner, new Map());
    const productMap = partnerMap.get(row.partner);
    const key = `${row.partner}||${row.productCode}`;
    const existing = productMap.get(key) || {
      partner: row.partner,
      productCode: row.productCode,
      productName: row.productName,
      totalQty: 0,
      inspectionQty: 0,
      returnQty: 0,
      exchangeQty: 0,
      centers: [],
    };
    existing.totalQty += row.orderQty;
    existing.inspectionQty = Math.max(existing.inspectionQty, parseQty(row.inspectionQty));
    existing.returnQty = Math.max(existing.returnQty, parseQty(row.returnQty));
    existing.exchangeQty = Math.max(existing.exchangeQty, parseQty(row.exchangeQty));
    if (row.center) {
      const found = existing.centers.find((item) => item.center === row.center);
      if (found) {
        found.totalQty += row.orderQty;
      } else {
        existing.centers.push({ center: row.center, totalQty: row.orderQty });
      }
    }
    productMap.set(key, existing);
  });

  return Array.from(partnerMap.entries())
    .map(([partner, productMap]) => ({
      partner,
      products: Array.from(productMap.values()).sort((a, b) => a.productName.localeCompare(b.productName, "ko")),
    }))
    .sort((a, b) => a.partner.localeCompare(b.partner, "ko"));
};

const buildAnalyticsKpis = (rows) => {
  const totalInboundQty = rows.reduce((sum, row) => sum + parseQty(row.orderQty), 0);
  const totalInboundAmount = rows.reduce((sum, row) => sum + parseQty(row.orderQty) * parseQty(row.unitPrice), 0);
  const totalInspectionQty = rows.reduce((sum, row) => sum + parseQty(row.inspectionQty), 0);
  const totalDefectQty =
    rows.reduce((sum, row) => sum + parseQty(row.returnQty), 0) +
    rows.reduce((sum, row) => sum + parseQty(row.exchangeQty), 0);

  const allSkuKeys = new Set(rows.map((row) => `${row.partner}||${row.productCode}`));
  const inspectedSkuKeys = new Set(
    rows.filter((row) => parseQty(row.inspectionQty) > 0).map((row) => `${row.partner}||${row.productCode}`)
  );
  const totalSku = allSkuKeys.size;
  const inspectedSku = inspectedSkuKeys.size;

  const fmtPct = (num, den) => (den > 0 ? ((num / den) * 100).toFixed(1) + "%" : "0.0%");

  return [
    { label: "총입고금액", value: totalInboundAmount.toLocaleString("ko-KR") },
    { label: "총입고수량", value: totalInboundQty.toLocaleString("ko-KR") },
    { label: "검품수량", value: totalInspectionQty.toLocaleString("ko-KR") },
    { label: "검품SKU", value: String(totalSku), subLabel: "검품 대상 품목 SKU 수" },
    { label: "불량률", value: fmtPct(totalDefectQty, totalInspectionQty) },
    { label: "검품률", value: fmtPct(totalInspectionQty, totalInboundQty) },
    { label: "실검품률", value: fmtPct(inspectedSku, totalSku) },
    { label: "SKU 커버리지", value: fmtPct(inspectedSku, totalSku) },
  ];
};

const productCardStyle = {
  border: "1px solid #d8e2ef",
  borderRadius: 16,
  background: "#ffffff",
  padding: "16px 18px",
  boxShadow: "0 14px 30px rgba(41, 73, 129, 0.08)",
};

function ProductPlaceholder({ src, alt }) {
  return (
    <div
      style={{
        width: 46,
        height: 46,
        borderRadius: 12,
        background: "#eef4ff",
        border: "1px solid #d8e2ef",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <img
        src={src || GS25_LOGO_SRC}
        alt={alt || "GS25"}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        onError={(event) => {
          event.currentTarget.onerror = null;
          event.currentTarget.src = GS25_LOGO_SRC;
        }}
      />
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.5 6.5 10 4h4l1.5 2.5H19A2.5 2.5 0 0 1 21.5 9v8a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 17V9A2.5 2.5 0 0 1 5 6.5h3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.25" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function QtyBox({ label, value, tone = "blue" }) {
  const tones = {
    blue: { border: "#d8e2ef", bg: "#f8fbff", color: "#22324a" },
    green: { border: "#9dd8a9", bg: "#eef9ef", color: "#24a148" },
    red: { border: "#ffb8b8", bg: "#fff6f6", color: "#e44747" },
    neutral: { border: "#d8e2ef", bg: "#ffffff", color: "#15253e" },
  };
  const current = tones[tone] || tones.blue;
  return (
    <div
      style={{
        border: `1px solid ${current.border}`,
        borderRadius: 12,
        background: current.bg,
        height: 64,
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: 11, color: "#708095", marginBottom: 6, lineHeight: 1 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: current.color, lineHeight: 1 }}>
        {parseQty(value).toLocaleString("ko-KR")}
      </div>
    </div>
  );
}

export default function App() {
  const csvInputRef = useRef(null);
  const happycallInputRef = useRef(null);
  const photoInputRef = useRef(null);
  const scannerVideoRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const hasRestoredRef = useRef(false);
  const scannerIntervalRef = useRef(null);
  const scannerControlsRef = useRef(null);
  const saveQueueRef = useRef(new Map());
  const saveTimerRef = useRef(new Map());
  const postSyncTimerRef = useRef(null);
  const flushInFlightRef = useRef(false);
  const photoQueueRef = useRef([]);
  const photoUploadingRef = useRef(0);

  const [activeTab, setActiveTab] = useState("inspection");
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [uploadingHappycallCsv, setUploadingHappycallCsv] = useState(false);
  const [currentFileName, setCurrentFileName] = useState("");
  const [happycallFileName, setHappycallFileName] = useState("");
  const [message, setMessage] = useState("CSV 파일 업로드를 준비해주세요.");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [expandedPartner, setExpandedPartner] = useState("");
  const [selectedHappycallPeriod, setSelectedHappycallPeriod] = useState("1d");
  const [currentJob, setCurrentJob] = useState(null);
  const [draftMap, setDraftMap] = useState({});
  const [itemStatusMap, setItemStatusMap] = useState({});
  const [selectedCenterMap, setSelectedCenterMap] = useState({});
  const [saveQueueItems, setSaveQueueItems] = useState([]);
  const [photoMap, setPhotoMap] = useState({});
  const [photoTargetProduct, setPhotoTargetProduct] = useState(null);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const [inspectionRows, setInspectionRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [recordDetailKey, setRecordDetailKey] = useState("");
  const [recordDetailDraft, setRecordDetailDraft] = useState(null);
  const [recordDetailSaving, setRecordDetailSaving] = useState(false);
  const [statusMeta, setStatusMeta] = useState({
    lastActionAt: "",
    restored: false,
  });
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [zipDownloading, setZipDownloading] = useState("");
  const [scannerStatus, setScannerStatus] = useState("바코드를 화면 중앙에 맞춰주세요.");
  const [scannerManualCode, setScannerManualCode] = useState("");
  const [productImageMap] = useState({});

  const groupedPartners = useMemo(() => buildGroupedPartners(rows, search), [rows, search]);
  const analyticsKpis = useMemo(() => buildAnalyticsKpis(rows), [rows]);
  const totalVisibleProducts = useMemo(
    () => groupedPartners.reduce((sum, group) => sum + group.products.length, 0),
    [groupedPartners]
  );

  useEffect(() => {
    document.body.style.fontFamily =
      '"Pretendard","Pretendard Variable",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  }, []);

  const productLookupMap = useMemo(() => {
    const map = new Map();
    groupedPartners.forEach((group) => {
      group.products.forEach((product) => {
        map.set(makeHistoryProductKey(group.partner, product.productCode), {
          ...product,
          partner: group.partner,
        });
      });
    });
    return map;
  }, [groupedPartners]);

  const loadServerSnapshot = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch(`${SCRIPT_URL}?action=bootstrap`);
      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "서버 데이터를 불러오지 못했습니다.");
      }
      const data = result.data || {};
      setHistoryRows(Array.isArray(data.records) ? data.records : []);
      setInspectionRows(Array.isArray(data.rows) ? data.rows : []);

      // Auto-restore latest CSV job on first load (page refresh / initial mount)
      if (!hasRestoredRef.current) {
        hasRestoredRef.current = true;
        const job = data.current_job;
        if (job && job.job_key && Array.isArray(job.rows) && job.rows.length > 0) {
          const normalized = buildNormalizedRows(job.rows);
          if (normalized.length > 0) {
            setRows(normalized);
            setCurrentJob({ job_key: job.job_key, source_file_name: job.source_file_name, source_file_modified: job.source_file_modified });
            setCurrentFileName(job.source_file_name || "");
            setExpandedPartner(normalized[0]?.partner || "");
            setStatusMeta({ lastActionAt: job.created_at || new Date().toISOString(), restored: true });
            setMessage(`자동 복원 완료 (${normalized.length.toLocaleString("ko-KR")}건)`);
          }
        }
      }
    } catch (err) {
      setError(err.message || "서버 데이터를 불러오지 못했습니다.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServerSnapshot();
  }, [loadServerSnapshot]);

  const decodeCsvText = async (file) => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const countReplacement = (text) => (String(text).match(/\uFFFD/g) || []).length;
    const hasExpectedHeaders = (text) =>
      /(센터명|상품명|상품코드|총 발주수량|입고원가|거래처명|구매조건명|협력사)/.test(String(text || ""));

    const decodeWith = (encoding) => {
      try {
        return new TextDecoder(encoding, { fatal: false }).decode(bytes);
      } catch (_err) {
        return "";
      }
    };

    const eucKrText = decodeWith("euc-kr");
    if (eucKrText && (hasExpectedHeaders(eucKrText) || countReplacement(eucKrText) === 0)) {
      return eucKrText;
    }

    const utf8Text = decodeWith("utf-8");
    if (!utf8Text) return eucKrText;
    if (hasExpectedHeaders(utf8Text)) return utf8Text;

    return countReplacement(utf8Text) <= countReplacement(eucKrText) ? utf8Text : eucKrText;
  };

  const syncQueueItems = () => {
    setSaveQueueItems(Array.from(saveQueueRef.current.values()));
  };

  const getPhotoItems = (product) => photoMap[makeProductKey(product)] || [];
  const getProductImageSrc = (product) => {
    const productCode = normalizeCode(product?.productCode || "");
    return productImageMap[productCode] || GS25_LOGO_SRC;
  };

  const getPhotoSrc = (photoItem) => photoItem.previewUrl || photoItem.driveUrl || "";

  const handleCsvUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadingCsv(true);
    setError("");
    setMessage("CSV 파일을 불러오는 중...");
    setCurrentFileName(file.name);

    try {
      const decodedText = await decodeCsvText(file);
      Papa.parse(decodedText, {
        header: true,
        skipEmptyLines: true,
        complete: async (result) => {
          try {
            const parsedRows = Array.isArray(result.data) ? result.data : [];
            const headerKeys = parsedRows[0] ? Object.keys(parsedRows[0]) : [];
            console.log("[handleCsvUpload] decoded header 목록", headerKeys);
            const normalized = buildNormalizedRows(parsedRows);
            console.log("[handleCsvUpload] rows 생성 건수", normalized.length);
            console.log("[handleCsvUpload] 첫 row 샘플", normalized[0] || null);

            const fallbackJob = {
              job_key: `job_${Date.now()}`,
              source_file_name: file.name,
              source_file_modified: new Date(file.lastModified || Date.now()).toISOString(),
              rows: parsedRows,
            };

            try {
              const cacheResult = await postAction("cacheCsv", {
                payload: {
                  job_key: fallbackJob.job_key,
                  source_file_name: fallbackJob.source_file_name,
                  source_file_modified: fallbackJob.source_file_modified,
                  parsed_rows_base64: encodeBase64Utf8(JSON.stringify(parsedRows)),
                },
              });
              setCurrentJob(cacheResult.job || fallbackJob);
            } catch (cacheErr) {
              console.error("[handleCsvUpload] cacheCsv fallback", cacheErr);
              setCurrentJob(fallbackJob);
            }

            setRows(normalized);
            setDraftMap({});
            setItemStatusMap({});
            setSelectedCenterMap({});
            setPhotoMap({});
            setPhotoTargetProduct(null);
            saveQueueRef.current.clear();
            syncQueueItems();
            setExpandedPartner(normalized[0]?.partner || "");
            setStatusMeta({
              lastActionAt: new Date().toISOString(),
              restored: false,
            });
            setMessage(`CSV 업로드 완료 (${normalized.length.toLocaleString("ko-KR")}건)`);
            setUploadingCsv(false);
          } catch (err) {
            setError(err.message || "CSV 처리 실패");
            setUploadingCsv(false);
          }
        },
        error: (err) => {
          setError(err.message || "CSV 처리 실패");
          setUploadingCsv(false);
        },
      });
    } catch (err) {
      setError(err.message || "CSV 처리 실패");
      setUploadingCsv(false);
    }
  };

  const handleHappycallUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setHappycallFileName(file.name);
    setUploadingHappycallCsv(true);
    setError("");
    setMessage("해피콜 CSV를 불러오는 중...");
    setStatusMeta((prev) => ({ ...prev, lastActionAt: new Date().toISOString() }));
    try {
      const decodedText = await decodeCsvText(file);
      Papa.parse(decodedText, {
        header: true,
        skipEmptyLines: true,
        complete: async (result) => {
          try {
            const parsedRows = Array.isArray(result.data) ? result.data : [];
            const importResult = await postAction("importHappycallCsv", { rows: parsedRows });
            const data = importResult.data || {};
            setMessage(
              `해피콜 CSV 업로드 완료 — ${data.inserted || 0}건 등록, ${data.updated || 0}건 업데이트`
            );
          } catch (err) {
            setError(err.message || "해피콜 CSV 업로드 실패");
          } finally {
            setUploadingHappycallCsv(false);
          }
        },
        error: (err) => {
          setError(err.message || "해피콜 CSV 파싱 실패");
          setUploadingHappycallCsv(false);
        },
      });
    } catch (err) {
      setError(err.message || "해피콜 CSV 읽기 실패");
      setUploadingHappycallCsv(false);
    }
  };

  const stopScanner = useCallback(() => {
    if (scannerIntervalRef.current) {
      clearInterval(scannerIntervalRef.current);
      scannerIntervalRef.current = null;
    }

    try {
      scannerControlsRef.current?.stop?.();
    } catch (_err) {}

    try {
      const stream = scannerStreamRef.current;
      stream?.getTracks?.().forEach((track) => track.stop());
    } catch (_err) {}

    scannerControlsRef.current = null;
    scannerStreamRef.current = null;

    if (scannerVideoRef.current) {
      scannerVideoRef.current.srcObject = null;
    }
  }, []);

  const closeScanner = useCallback(() => {
    stopScanner();
    setScannerOpen(false);
    setScannerError("");
    setScannerManualCode("");
    setScannerStatus("바코드를 화면 중앙에 맞춰주세요.");
  }, [stopScanner]);

  const applyScannedCode = useCallback((value) => {
    const code = normalizeCode(value || "");
    if (!code) return;

    setSearch(code);
    const foundGroup = groupedPartners.find((group) =>
      group.products.some((product) => normalizeCode(product.productCode) === code)
    );
    if (foundGroup) {
      setExpandedPartner(foundGroup.partner);
    }
    setMessage(`바코드 검색 완료: ${code}`);
    closeScanner();
  }, [closeScanner, groupedPartners]);

  const startScanner = useCallback(async () => {
    try {
      setScannerError("");
      setScannerStatus("카메라를 준비하고 있습니다.");

      const devices = await BrowserCodeReader.listVideoInputDevices();
      const targetDevice =
        devices.find((device) => /back|rear|environment/i.test(String(device.label || ""))) || devices[0];

      const stream = await navigator.mediaDevices.getUserMedia({
        video: targetDevice?.deviceId
          ? { deviceId: { exact: targetDevice.deviceId } }
          : { facingMode: { ideal: "environment" } },
        audio: false,
      });

      scannerStreamRef.current = stream;
      if (scannerVideoRef.current) {
        scannerVideoRef.current.srcObject = stream;
        await scannerVideoRef.current.play();
      }

      if (typeof window !== "undefined" && "BarcodeDetector" in window) {
        const detector = new window.BarcodeDetector({
          formats: ["ean_13", "ean_8", "code_128", "upc_a", "upc_e"],
        });

        scannerIntervalRef.current = setInterval(async () => {
          try {
            if (!scannerVideoRef.current) return;
            const barcodes = await detector.detect(scannerVideoRef.current);
            const first = barcodes?.[0]?.rawValue || "";
            if (first) {
              applyScannedCode(first);
            }
          } catch (_err) {}
        }, 350);
      } else {
        const reader = new BrowserMultiFormatReader();
        scannerControlsRef.current = await reader.decodeFromVideoDevice(
          targetDevice?.deviceId,
          scannerVideoRef.current,
          (result, err, controls) => {
            if (controls) {
              scannerControlsRef.current = controls;
            }
            const text = String(result?.getText?.() || "").trim();
            if (text) {
              applyScannedCode(text);
              return;
            }
            if (err && err.name && err.name !== "NotFoundException") {
              setScannerError(err.message || "바코드 스캔 중 오류가 발생했습니다.");
            }
          }
        );
      }

      setScannerStatus("바코드를 화면 중앙에 맞춰주세요.");
    } catch (err) {
      setScannerError(err.message || "카메라를 시작할 수 없습니다.");
      setScannerStatus("카메라를 사용할 수 없습니다.");
    }
  }, [applyScannedCode]);

  useEffect(() => {
    if (!scannerOpen) return undefined;
    startScanner();
    return () => stopScanner();
  }, [scannerOpen, rows.length, startScanner, stopScanner]);

  const filteredInspectionRows = useMemo(() => {
    if (!currentJob?.job_key) return inspectionRows;
    return inspectionRows.filter((row) => String(row["작업기준일또는CSV식별값"] || row.jobKey || "") === currentJob.job_key);
  }, [currentJob?.job_key, inspectionRows]);

  const filteredHistoryRows = useMemo(() => {
    if (!currentJob?.job_key) return historyRows;
    return historyRows.filter((row) => String(row["작업기준일또는CSV식별값"] || row.jobKey || "") === currentJob.job_key);
  }, [currentJob?.job_key, historyRows]);

  const recordItems = useMemo(() => {
    const map = new Map();

    filteredInspectionRows.forEach((row) => {
      const partnerName = row["협력사명"] || row.partnerName || "";
      const productCode = normalizeCode(row["상품코드"] || row.productCode || "");
      const key = makeHistoryProductKey(partnerName, productCode);
      if (!key) return;
      const existing = map.get(key) || {
        key,
        partnerName,
        productCode,
        productName: row["상품명"] || row.productName || "",
        inspectionQty: 0,
        returnQty: 0,
        exchangeQty: 0,
        latestTime: "",
      };
      existing.inspectionQty = parseQty(row["검품수량"] || row.inspectionQty);
      existing.latestTime = String(row["수정일시"] || row["작성일시"] || existing.latestTime || "");
      map.set(key, existing);
    });

    filteredHistoryRows.forEach((row) => {
      const partnerName = row["협력사명"] || row.partnerName || "";
      const productCode = normalizeCode(row["상품코드"] || row.productCode || "");
      const key = makeHistoryProductKey(partnerName, productCode);
      if (!key) return;
      const existing = map.get(key) || {
        key,
        partnerName,
        productCode,
        productName: row["상품명"] || row.productName || "",
        inspectionQty: 0,
        returnQty: 0,
        exchangeQty: 0,
        latestTime: "",
      };
      existing.returnQty += parseQty(row["회송수량"] || row.returnQty);
      existing.exchangeQty += parseQty(row["교환수량"] || row.exchangeQty);
      const nextTime = String(row["수정일시"] || row["작성일시"] || "");
      if (nextTime && nextTime > existing.latestTime) existing.latestTime = nextTime;
      if (!existing.productName) existing.productName = row["상품명"] || row.productName || "";
      map.set(key, existing);
    });

    return Array.from(map.values()).sort((a, b) => {
      const partnerDiff = String(a.partnerName || "").localeCompare(String(b.partnerName || ""), "ko");
      if (partnerDiff !== 0) return partnerDiff;
      return String(a.productName || "").localeCompare(String(b.productName || ""), "ko");
    });
  }, [filteredHistoryRows, filteredInspectionRows]);

  const buildRecordDetailDraft = useCallback((item) => {
    if (!item) return null;

    const lookupProduct = productLookupMap.get(item.key);
    const partnerName = item.partnerName || lookupProduct?.partner || "";
    const productCode = item.productCode || lookupProduct?.productCode || "";
    const inspectionRow =
      filteredInspectionRows.find(
        (row) =>
          makeHistoryProductKey(row["협력사명"] || row.partnerName || "", row["상품코드"] || row.productCode || "") === item.key
      ) || null;
    const movementRows = filteredHistoryRows.filter(
      (row) =>
        makeHistoryProductKey(row["협력사명"] || row.partnerName || "", row["상품코드"] || row.productCode || "") === item.key
    );
    const centerOptions = Array.from(
      new Set(
        [
          ...(lookupProduct?.centers || []).map((center) => center.center),
          ...movementRows.map((row) => String(row["센터명"] || row.centerName || "").trim()).filter(Boolean),
        ].filter(Boolean)
      )
    );
    const selectedCenter =
      movementRows[0]?.["센터명"] ||
      movementRows[0]?.centerName ||
      lookupProduct?.centers?.[0]?.center ||
      centerOptions[0] ||
      "";
    const selectedCenterRows = movementRows.filter(
      (row) => String(row["센터명"] || row.centerName || "").trim() === String(selectedCenter || "").trim()
    );
    const returnRow =
      selectedCenterRows.find((row) => String(row["처리유형"] || row.typeName || "").trim() === "회송") || null;
    const exchangeRow =
      selectedCenterRows.find((row) => String(row["처리유형"] || row.typeName || "").trim() === "교환") || null;
    const inspectionPhotoMap = inspectionRow?.photoAssetMap || {};
    const returnPhotoMap = returnRow?.photoAssetMap || {};
    const exchangePhotoMap = exchangeRow?.photoAssetMap || {};
    const brixMinText = formatBrixValue(inspectionRow?.brixMin ?? inspectionRow?.["BRIX최저"] ?? "");
    const brixMaxText = formatBrixValue(inspectionRow?.brixMax ?? inspectionRow?.["BRIX최고"] ?? "");
    const brixMin = parseBrixInput(brixMinText);
    const brixMax = parseBrixInput(brixMaxText);

    return {
      key: item.key,
      partnerName,
      productCode,
      productName: item.productName || lookupProduct?.productName || "",
      product: lookupProduct || null,
      inspectionRowNumber: Number(inspectionRow?.__rowNumber || 0),
      returnRowNumber: Number(returnRow?.__rowNumber || 0),
      exchangeRowNumber: Number(exchangeRow?.__rowNumber || 0),
      selectedCenter,
      centerOptions,
      inspectionQty: String(parseQty(inspectionRow?.["검품수량"] || inspectionRow?.inspectionQty || item.inspectionQty || 0)),
      returnQty: String(parseQty(returnRow?.["회송수량"] || returnRow?.returnQty || 0)),
      exchangeQty: String(parseQty(exchangeRow?.["교환수량"] || exchangeRow?.exchangeQty || 0)),
      memo: String(
        inspectionRow?.["불량사유"] ||
          inspectionRow?.["비고"] ||
          returnRow?.["비고"] ||
          exchangeRow?.["비고"] ||
          inspectionRow?.memo ||
          ""
      ),
      brixMin: brixMinText,
      brixMax: brixMaxText,
      brixAvg: computeBrixAvg(brixMin, brixMax),
      weightNote: String(inspectionRow?.weightNote || inspectionRow?.["중량메모"] || ""),
      photoGroups: {
        inspection: toPhotoItemsFromUrls(inspectionPhotoMap.inspection?.sources || [], "inspection"),
        return: toPhotoItemsFromUrls(returnPhotoMap.return?.sources || [], "return"),
        exchange: toPhotoItemsFromUrls(exchangePhotoMap.exchange?.sources || [], "exchange"),
        sugar: toPhotoItemsFromUrls(inspectionPhotoMap.sugar?.sources || [], "sugar"),
        weight: toPhotoItemsFromUrls(inspectionPhotoMap.weight?.sources || [], "weight"),
      },
      existingRows: {
        inspection: inspectionRow,
        movements: movementRows,
      },
    };
  }, [filteredHistoryRows, filteredInspectionRows, productLookupMap]);

  const openRecordDetail = useCallback((itemKey) => {
    const item = recordItems.find((entry) => entry.key === itemKey);
    if (!item) return;
    setRecordDetailKey(itemKey);
    setRecordDetailDraft(buildRecordDetailDraft(item));
  }, [buildRecordDetailDraft, recordItems]);

  const closeRecordDetail = useCallback(() => {
    setRecordDetailKey("");
    setRecordDetailDraft(null);
  }, []);

  const updateRecordDetailDraft = useCallback((patch) => {
    setRecordDetailDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      const min = parseBrixInput(next.brixMin);
      const max = parseBrixInput(next.brixMax);
      next.brixAvg = computeBrixAvg(min, max);
      return next;
    });
  }, []);

  const rebuildRecordDetailForCenter = useCallback((draft, centerName) => {
    if (!draft) return draft;
    const nextDraft = buildRecordDetailDraft({
      key: draft.key,
      partnerName: draft.partnerName,
      productCode: draft.productCode,
      productName: draft.productName,
      inspectionQty: draft.inspectionQty,
    });
    if (!nextDraft) return draft;
    nextDraft.selectedCenter = centerName;
    const centerRows = nextDraft.existingRows.movements.filter(
      (row) => String(row["센터명"] || row.centerName || "").trim() === String(centerName || "").trim()
    );
    const returnRow = centerRows.find((row) => String(row["처리유형"] || "").trim() === "회송");
    const exchangeRow = centerRows.find((row) => String(row["처리유형"] || "").trim() === "교환");
    nextDraft.returnRowNumber = Number(returnRow?.__rowNumber || 0);
    nextDraft.exchangeRowNumber = Number(exchangeRow?.__rowNumber || 0);
    nextDraft.returnQty = String(parseQty(returnRow?.["회송수량"] || 0));
    nextDraft.exchangeQty = String(parseQty(exchangeRow?.["교환수량"] || 0));
    nextDraft.memo = String(returnRow?.["비고"] || exchangeRow?.["비고"] || draft.memo || "");
    nextDraft.photoGroups.return = toPhotoItemsFromUrls(returnRow?.photoAssetMap?.return?.sources || [], "return");
    nextDraft.photoGroups.exchange = toPhotoItemsFromUrls(exchangeRow?.photoAssetMap?.exchange?.sources || [], "exchange");
    nextDraft.photoGroups.inspection = draft.photoGroups.inspection;
    nextDraft.photoGroups.sugar = draft.photoGroups.sugar;
    nextDraft.photoGroups.weight = draft.photoGroups.weight;
    nextDraft.brixMin = draft.brixMin;
    nextDraft.brixMax = draft.brixMax;
    nextDraft.brixAvg = draft.brixAvg;
    nextDraft.weightNote = draft.weightNote;
    nextDraft.inspectionQty = draft.inspectionQty;
    return nextDraft;
  }, [buildRecordDetailDraft]);

  const updateRecordPhotoGroup = useCallback((photoType, updater) => {
    setRecordDetailDraft((prev) => {
      if (!prev) return prev;
      const currentItems = Array.isArray(prev.photoGroups?.[photoType]) ? prev.photoGroups[photoType] : [];
      return {
        ...prev,
        photoGroups: {
          ...prev.photoGroups,
          [photoType]: updater(currentItems),
        },
      };
    });
  }, []);

  const handleRecordPhotoSelect = useCallback((photoType, files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    updateRecordPhotoGroup(photoType, (currentItems) => [
      ...currentItems,
      ...list.map((file, index) => ({
        id: `${photoType}_local_${Date.now()}_${index}`,
        file,
        fileName: file.name,
        previewUrl: URL.createObjectURL(file),
        status: "pending",
        isExisting: false,
      })),
    ]);
  }, [updateRecordPhotoGroup]);

  const removeRecordPhoto = useCallback((photoType, photoId) => {
    updateRecordPhotoGroup(photoType, (currentItems) =>
      currentItems.filter((item) => {
        const keep = item.id !== photoId;
        if (!keep && item.previewUrl && !item.isExisting) {
          URL.revokeObjectURL(item.previewUrl);
        }
        return keep;
      })
    );
  }, [updateRecordPhotoGroup]);

  const uploadDetailPhotos = useCallback(async (draft) => {
    const uploadedMap = {};

    for (const photoType of Object.keys(draft.photoGroups || {})) {
      const items = Array.isArray(draft.photoGroups[photoType]) ? draft.photoGroups[photoType] : [];
      const existingItems = items.filter((item) => item.isExisting && item.fileId);
      const newItems = items.filter((item) => !item.isExisting && item.file);

      let uploadedItems = [];
      if (newItems.length > 0) {
        const encodedPhotos = await Promise.all(
          newItems.map(
            (item) =>
              new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const result = String(reader.result || "");
                  resolve({
                    imageBase64: result.split(",")[1] || "",
                    mimeType: item.file.type || "image/jpeg",
                    fileName: item.file.name,
                  });
                };
                reader.onerror = () => reject(new Error(`${PHOTO_TYPE_LABEL_MAP[photoType]} 업로드용 파일 읽기에 실패했습니다.`));
                reader.readAsDataURL(item.file);
              })
          )
        );

        const uploadResult = await postAction("uploadPhotos", {
          payload: {
            itemKey: draft.key,
            productName: draft.productName,
            partnerName: draft.partnerName,
            photoKind: photoType,
            photos: encodedPhotos,
          },
        });

        uploadedItems = (Array.isArray(uploadResult.data?.photos) ? uploadResult.data.photos : []).map((item, index) => ({
          id: `${photoType}_uploaded_${item.fileId || index}`,
          fileId: item.fileId || "",
          fileName: item.fileName || `${PHOTO_TYPE_LABEL_MAP[photoType]}_${index + 1}`,
          previewUrl: item.previewUrl || item.url || item.viewUrl || item.driveUrl || "",
          driveUrl: item.driveUrl || item.url || item.viewUrl || "",
          status: "saved",
          isExisting: true,
        }));
      }

      uploadedMap[photoType] = [...existingItems, ...uploadedItems];
    }

    return uploadedMap;
  }, []);

  const buildPhotoTypeFileIdsMap = useCallback((photoGroups, target) => {
    const entries = Object.entries(photoGroups || {}).filter(
      ([photoType]) => PHOTO_TYPE_TARGET_MAP[photoType] === target
    );
    return entries.reduce((acc, [photoType, items]) => {
      acc[photoType] = (Array.isArray(items) ? items : [])
        .map((item) => item.fileId)
        .filter(Boolean);
      return acc;
    }, {});
  }, []);

  const validateRecordDetail = useCallback((draft) => {
    const brixMin = parseBrixInput(draft.brixMin);
    const brixMax = parseBrixInput(draft.brixMax);
    if (Number.isNaN(brixMin) || Number.isNaN(brixMax)) {
      return "BRIX는 숫자만 입력할 수 있습니다.";
    }
    if (Number.isFinite(brixMin) && Number.isFinite(brixMax) && brixMin > brixMax) {
      return "최저 BRIX가 최고 BRIX보다 클 수 없습니다.";
    }
    if ((parseQty(draft.returnQty) > 0 || parseQty(draft.exchangeQty) > 0) && !draft.selectedCenter) {
      return "회송/교환 저장에는 센터 선택이 필요합니다.";
    }
    return "";
  }, []);

  const getDraftForProduct = (product) => {
    const key = makeProductKey(product);
    const draft = draftMap[key] || {};
    return {
      inspectionQty: draft.inspectionQty !== undefined ? draft.inspectionQty : parseQty(product.inspectionQty),
      returnQty: draft.returnQty !== undefined ? draft.returnQty : parseQty(product.returnQty),
      exchangeQty: draft.exchangeQty !== undefined ? draft.exchangeQty : parseQty(product.exchangeQty),
      centerName: draft.centerName || selectedCenterMap[key] || product.centers?.[0]?.center || "",
      inspectionTouched: !!draft.inspectionTouched,
      returnTouched: !!draft.returnTouched,
      exchangeTouched: !!draft.exchangeTouched,
    };
  };

  const updateProductDraft = (product, patch) => {
    const key = makeProductKey(product);
    setDraftMap((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        ...patch,
      },
    }));
    setItemStatusMap((prev) => ({ ...prev, [key]: "editing" }));
  };

  const buildSaveRowsForProduct = (product) => {
    if (!currentJob?.job_key) {
      throw new Error("CSV 작업 정보가 없습니다.");
    }

    const itemKey = makeProductKey(product);
    const draft = getDraftForProduct(product);
    const rowsToSave = [];

    if (draft.inspectionTouched || parseQty(draft.inspectionQty) > 0) {
      rowsToSave.push({
        type: "inspection",
        operationId: createOperationId(),
        key: itemKey,
        jobKey: currentJob.job_key,
        작업기준일또는CSV식별값: currentJob.job_key,
        productCode: product.productCode,
        상품코드: product.productCode,
        productName: product.productName,
        상품명: product.productName,
        partnerName: product.partner,
        협력사명: product.partner,
        totalQty: product.totalQty || 0,
        전체발주수량: product.totalQty || 0,
        orderQty: product.totalQty || 0,
        발주수량: product.totalQty || 0,
        inspectionQty: parseQty(draft.inspectionQty),
        검품수량: parseQty(draft.inspectionQty),
        returnQty: 0,
        회송수량: 0,
        exchangeQty: 0,
        교환수량: 0,
      });
    }

    if (draft.returnTouched) {
      if (parseQty(draft.returnQty) > 0 && !draft.centerName) {
        throw new Error("회송은 센터 선택이 필요합니다.");
      }
      rowsToSave.push({
        type: "movement",
        movementType: "RETURN",
        처리유형: "회송",
        replaceQtyMode: true,
        operationId: createOperationId(),
        key: makeMovementKey("RETURN", product, draft.centerName || ""),
        jobKey: currentJob.job_key,
        작업기준일또는CSV식별값: currentJob.job_key,
        productCode: product.productCode,
        상품코드: product.productCode,
        productName: product.productName,
        상품명: product.productName,
        partnerName: product.partner,
        협력사명: product.partner,
        centerName: draft.centerName || "",
        센터명: draft.centerName || "",
        totalQty: product.totalQty || 0,
        전체발주수량: product.totalQty || 0,
        orderQty: product.centers?.find((item) => item.center === draft.centerName)?.totalQty || 0,
        발주수량: product.centers?.find((item) => item.center === draft.centerName)?.totalQty || 0,
        qty: parseQty(draft.returnQty),
        returnQty: parseQty(draft.returnQty),
        회송수량: parseQty(draft.returnQty),
        exchangeQty: 0,
        교환수량: 0,
      });
    }

    if (draft.exchangeTouched) {
      rowsToSave.push({
        type: "movement",
        movementType: "EXCHANGE",
        처리유형: "교환",
        replaceQtyMode: true,
        operationId: createOperationId(),
        key: makeMovementKey("EXCHANGE", product, ""),
        jobKey: currentJob.job_key,
        작업기준일또는CSV식별값: currentJob.job_key,
        productCode: product.productCode,
        상품코드: product.productCode,
        productName: product.productName,
        상품명: product.productName,
        partnerName: product.partner,
        협력사명: product.partner,
        centerName: "",
        센터명: "",
        totalQty: product.totalQty || 0,
        전체발주수량: product.totalQty || 0,
        orderQty: product.totalQty || 0,
        발주수량: product.totalQty || 0,
        qty: parseQty(draft.exchangeQty),
        returnQty: 0,
        회송수량: 0,
        exchangeQty: parseQty(draft.exchangeQty),
        교환수량: parseQty(draft.exchangeQty),
      });
    }

    return rowsToSave;
  };

  const schedulePostSaveSync = (flags) => {
    if (postSyncTimerRef.current) {
      clearTimeout(postSyncTimerRef.current);
    }
    postSyncTimerRef.current = setTimeout(async () => {
      try {
        await postAction("postSaveSync", {
          payload: {
            hasInspection: !!flags.hasInspection,
            hasMovement: !!flags.hasMovement,
          },
        });
      } catch (err) {
        console.error("[postSaveSync] failed", err);
      }
    }, POST_SYNC_DEBOUNCE_MS);
  };

  const flushDraftIntoQueue = (product) => {
    const itemKey = makeProductKey(product);
    const rowsToSave = buildSaveRowsForProduct(product);
    if (rowsToSave.length === 0) {
      return false;
    }
    saveQueueRef.current.set(itemKey, { itemKey, rows: rowsToSave });
    syncQueueItems();
    return true;
  };

  const flushSaveQueue = async () => {
    if (flushInFlightRef.current) return;
    if (saveQueueRef.current.size === 0) return;

    flushInFlightRef.current = true;
    try {
      while (saveQueueRef.current.size > 0) {
        const [itemKey, item] = saveQueueRef.current.entries().next().value;
        setItemStatusMap((prev) => ({ ...prev, [itemKey]: "saving" }));
        try {
          const result = await postAction("saveBatch", { rows: item.rows });
          const data = result.data || {};
          const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];

          saveQueueRef.current.delete(itemKey);
          syncQueueItems();
          if (conflicts.length > 0) {
            setItemStatusMap((prev) => ({ ...prev, [itemKey]: "conflict" }));
          } else {
            setItemStatusMap((prev) => ({ ...prev, [itemKey]: "saved" }));
            setStatusMeta((prev) => ({
              ...prev,
              lastActionAt: new Date().toISOString(),
            }));
            setDraftMap((prev) => ({
              ...prev,
              [itemKey]: {
                ...(prev[itemKey] || {}),
                inspectionTouched: false,
                returnTouched: false,
                exchangeTouched: false,
              },
            }));
            if (data.hasInspection || data.hasMovement) {
              schedulePostSaveSync({
                hasInspection: data.hasInspection,
                hasMovement: data.hasMovement,
              });
            }
          }
        } catch (err) {
          console.error("[flushSaveQueue] failed", itemKey, err);
          saveQueueRef.current.delete(itemKey);
          syncQueueItems();
          setItemStatusMap((prev) => ({ ...prev, [itemKey]: "failed" }));
        }
      }
    } finally {
      flushInFlightRef.current = false;
    }
  };

  const handleDownloadZip = useCallback(async (mode) => {
    setZipDownloading(mode);
    setError("");
    try {
      const result = await postAction("downloadPhotoZip", { payload: { mode } });
      const data = result.data || result;
      const files = Array.isArray(data.zipFiles) && data.zipFiles.length ? data.zipFiles : [data];
      const hasUrl = files.some((file) => file.downloadUrl || file.driveUrl);
      if (!hasUrl) {
        setMessage("다운로드할 사진이 없습니다.");
        return;
      }
      files.forEach((file) => {
        const url = file.downloadUrl || file.driveUrl || "";
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      });
      setMessage(`ZIP 다운로드 준비 완료 (${data.addedCount || 0}장)`);
    } catch (err) {
      setError(err.message || "ZIP 다운로드 실패");
    } finally {
      setZipDownloading("");
    }
  }, []);

  const handleFlushPending = () => {
    let prepared = false;
    groupedPartners.forEach((group) => {
      group.products.forEach((product) => {
        const itemKey = makeProductKey(product);
        const timer = saveTimerRef.current.get(itemKey);
        if (timer) {
          clearTimeout(timer);
          saveTimerRef.current.delete(itemKey);
        }
        try {
          prepared = flushDraftIntoQueue(product) || prepared;
        } catch (err) {
          setError(err.message || "저장 준비 실패");
          setItemStatusMap((prev) => ({ ...prev, [itemKey]: "failed" }));
        }
      });
    });

    if (!prepared && saveQueueRef.current.size === 0) {
      setMessage("저장할 변경사항이 없습니다.");
      return;
    }

    setMessage("저장(일괄)을 실행합니다.");
    flushSaveQueue();
  };

  const scheduleItemSave = (product) => {
    const itemKey = makeProductKey(product);
    const prevTimer = saveTimerRef.current.get(itemKey);
    if (prevTimer) clearTimeout(prevTimer);

    setItemStatusMap((prev) => ({ ...prev, [itemKey]: "pending" }));
    const nextTimer = setTimeout(() => {
      try {
        if (!flushDraftIntoQueue(product)) {
          setItemStatusMap((prev) => ({ ...prev, [itemKey]: "editing" }));
          return;
        }
        flushSaveQueue();
      } catch (err) {
        setError(err.message || "저장 준비 실패");
        setItemStatusMap((prev) => ({ ...prev, [itemKey]: "failed" }));
      }
    }, SAVE_DEBOUNCE_MS);

    saveTimerRef.current.set(itemKey, nextTimer);
  };

  const processPhotoQueue = async () => {
    while (photoUploadingRef.current < 2 && photoQueueRef.current.length > 0) {
      const nextTask = photoQueueRef.current.shift();
      photoUploadingRef.current += 1;

      (async () => {
        const { product, photoItem } = nextTask;
        const itemKey = makeProductKey(product);
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("사진 읽기 실패"));
            reader.readAsDataURL(photoItem.file);
          });

          const imageBase64 = String(dataUrl).split(",")[1] || "";
          const uploadOperationId = photoItem.operationId || createOperationId();
          const uploadResult = await postAction("uploadPhotos", {
            payload: {
              operationId: uploadOperationId,
              itemKey,
              productName: product.productName,
              partnerName: product.partner,
              photoKind: "inspection",
              photos: [
                {
                  imageBase64,
                  mimeType: photoItem.file.type || "image/jpeg",
                  fileName: photoItem.file.name,
                },
              ],
            },
          });

          const uploadedPhoto = Array.isArray(uploadResult.data?.photos) ? uploadResult.data.photos[0] : null;
          if (!uploadedPhoto?.fileId) {
            throw new Error("사진 업로드 실패");
          }

          await postAction("savePhotoMeta", {
            payload: {
              operationId: createOperationId(),
              type: "inspection",
              key: itemKey,
              jobKey: currentJob?.job_key || "",
              작업기준일또는CSV식별값: currentJob?.job_key || "",
              productCode: product.productCode,
              상품코드: product.productCode,
              partnerName: product.partner,
              협력사명: product.partner,
              productName: product.productName,
              상품명: product.productName,
              photoKind: "inspection",
              photoAction: "append",
              photoItem: uploadedPhoto,
            },
          });

          setPhotoMap((prev) => ({
            ...prev,
            [itemKey]: (prev[itemKey] || []).map((item) =>
              item.id === photoItem.id
                ? {
                    ...item,
                    status: "saved",
                    fileId: uploadedPhoto.fileId,
                    driveUrl: uploadedPhoto.url || uploadedPhoto.previewUrl || item.previewUrl,
                    fileName: uploadedPhoto.fileName || item.fileName,
                  }
                : item
            ),
          }));
          setItemStatusMap((prev) => ({ ...prev, [itemKey]: "saved" }));
        } catch (err) {
          console.error("[photoUpload] failed", err);
          setPhotoMap((prev) => ({
            ...prev,
            [itemKey]: (prev[itemKey] || []).map((item) =>
              item.id === photoItem.id ? { ...item, status: "failed", error: err.message || "사진 업로드 실패" } : item
            ),
          }));
        } finally {
          photoUploadingRef.current -= 1;
          processPhotoQueue();
        }
      })();
    }
  };

  const enqueuePhotoUpload = (product, photoItem) => {
    photoQueueRef.current.push({ product, photoItem });
    processPhotoQueue();
  };

  const openPhotoPicker = (product) => {
    setPhotoTargetProduct(product);
    photoInputRef.current?.click();
  };

  const handlePhotoSelect = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!photoTargetProduct || files.length === 0) return;

    const product = photoTargetProduct;
    const itemKey = makeProductKey(product);
    const existingKeys = new Set(
      (photoMap[itemKey] || []).map((item) => item.duplicateKey || `${item.fileName || ""}||${item.fileSize || 0}`)
    );

    const nextItems = files
      .map((file) => {
        const duplicateKey = `${file.name}||${file.size}||${file.lastModified}`;
        if (existingKeys.has(duplicateKey)) return null;
        existingKeys.add(duplicateKey);
        return {
          id: createLocalPhotoId(),
          operationId: createOperationId(),
          file,
          fileName: file.name,
          fileSize: file.size,
          duplicateKey,
          previewUrl: URL.createObjectURL(file),
          status: "uploading",
        };
      })
      .filter(Boolean);

    if (nextItems.length === 0) return;

    setPhotoMap((prev) => ({
      ...prev,
      [itemKey]: [...(prev[itemKey] || []), ...nextItems],
    }));
    setItemStatusMap((prev) => ({ ...prev, [itemKey]: "uploading" }));
    nextItems.forEach((item) => enqueuePhotoUpload(product, item));
  };

  const deletePhotoItem = async (product, photoItem) => {
    const itemKey = makeProductKey(product);
    if (!photoItem.fileId) {
      if (photoItem.previewUrl) URL.revokeObjectURL(photoItem.previewUrl);
      setPhotoMap((prev) => ({
        ...prev,
        [itemKey]: (prev[itemKey] || []).filter((item) => item.id !== photoItem.id),
      }));
      return;
    }

    try {
      await postAction("savePhotoMeta", {
        payload: {
          operationId: createOperationId(),
          type: "inspection",
          key: itemKey,
          jobKey: currentJob?.job_key || "",
          작업기준일또는CSV식별값: currentJob?.job_key || "",
          productCode: product.productCode,
          상품코드: product.productCode,
          partnerName: product.partner,
          협력사명: product.partner,
          productName: product.productName,
          상품명: product.productName,
          photoKind: "inspection",
          photoAction: "delete",
          photoFileId: photoItem.fileId,
        },
      });
      if (photoItem.previewUrl) URL.revokeObjectURL(photoItem.previewUrl);
      setPhotoMap((prev) => ({
        ...prev,
        [itemKey]: (prev[itemKey] || []).filter((item) => item.id !== photoItem.id),
      }));
    } catch (err) {
      setError(err.message || "사진 삭제 실패");
    }
  };

  const retryPhotoUpload = (product, photoItem) => {
    const itemKey = makeProductKey(product);
    setPhotoMap((prev) => ({
      ...prev,
      [itemKey]: (prev[itemKey] || []).map((item) =>
        item.id === photoItem.id ? { ...item, status: "uploading", error: "" } : item
      ),
    }));
    enqueuePhotoUpload(product, { ...photoItem, operationId: photoItem.operationId || createOperationId() });
  };

  const saveRecordDetail = useCallback(async () => {
    if (!recordDetailDraft) return;

    const validationError = validateRecordDetail(recordDetailDraft);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!currentJob?.job_key) {
      setError("현재 작업 기준 CSV 정보가 없습니다.");
      return;
    }

    setRecordDetailSaving(true);
    setError("");

    try {
      const uploadedPhotoGroups = await uploadDetailPhotos(recordDetailDraft);
      const inspectionPhotoTypeFileIdsMap = buildPhotoTypeFileIdsMap(uploadedPhotoGroups, "inspection");
      const movementPhotoTypeFileIdsMap = buildPhotoTypeFileIdsMap(uploadedPhotoGroups, "movement");
      const brixMin = parseBrixInput(recordDetailDraft.brixMin);
      const brixMax = parseBrixInput(recordDetailDraft.brixMax);
      const inspectionPayload = {
        type: "inspection",
        operationId: createOperationId(),
        key: `${recordDetailDraft.partnerName}||${recordDetailDraft.productCode}||inspection-detail`,
        jobKey: currentJob.job_key,
        작업기준일또는CSV식별값: currentJob.job_key,
        productCode: recordDetailDraft.productCode,
        상품코드: recordDetailDraft.productCode,
        productName: recordDetailDraft.productName,
        상품명: recordDetailDraft.productName,
        partnerName: recordDetailDraft.partnerName,
        협력사명: recordDetailDraft.partnerName,
        totalQty: recordDetailDraft.product?.totalQty || 0,
        전체발주수량: recordDetailDraft.product?.totalQty || 0,
        orderQty: recordDetailDraft.product?.totalQty || 0,
        발주수량: recordDetailDraft.product?.totalQty || 0,
        inspectionQty: parseQty(recordDetailDraft.inspectionQty),
        검품수량: parseQty(recordDetailDraft.inspectionQty),
        memo: recordDetailDraft.memo,
        비고: recordDetailDraft.memo,
        brixMin: Number.isFinite(brixMin) ? Number(formatBrixValue(brixMin)) : "",
        brixMax: Number.isFinite(brixMax) ? Number(formatBrixValue(brixMax)) : "",
        brixAvg: recordDetailDraft.brixAvg ? Number(recordDetailDraft.brixAvg) : "",
        weightNote: recordDetailDraft.weightNote || "",
        expectedVersion: recordDetailDraft.existingRows.inspection?.["버전"] || 0,
        expectedUpdatedAt: recordDetailDraft.existingRows.inspection?.["수정일시"] || "",
        photoTypeFileIdsMap: inspectionPhotoTypeFileIdsMap,
      };

      const rowsToSave = [inspectionPayload];
      const selectedCenterInfo =
        recordDetailDraft.product?.centers?.find((item) => item.center === recordDetailDraft.selectedCenter) || null;
      const selectedCenterQty = selectedCenterInfo?.totalQty || recordDetailDraft.product?.totalQty || 0;

      rowsToSave.push({
        type: "movement",
        movementType: "RETURN",
        처리유형: "회송",
        replaceQtyMode: true,
        operationId: createOperationId(),
        key: `${recordDetailDraft.partnerName}||${recordDetailDraft.productCode}||RETURN||${recordDetailDraft.selectedCenter}`,
        jobKey: currentJob.job_key,
        작업기준일또는CSV식별값: currentJob.job_key,
        productCode: recordDetailDraft.productCode,
        상품코드: recordDetailDraft.productCode,
        productName: recordDetailDraft.productName,
        상품명: recordDetailDraft.productName,
        partnerName: recordDetailDraft.partnerName,
        협력사명: recordDetailDraft.partnerName,
        centerName: recordDetailDraft.selectedCenter,
        센터명: recordDetailDraft.selectedCenter,
        totalQty: recordDetailDraft.product?.totalQty || 0,
        전체발주수량: recordDetailDraft.product?.totalQty || 0,
        orderQty: selectedCenterQty,
        발주수량: selectedCenterQty,
        qty: parseQty(recordDetailDraft.returnQty),
        returnQty: parseQty(recordDetailDraft.returnQty),
        회송수량: parseQty(recordDetailDraft.returnQty),
        exchangeQty: 0,
        교환수량: 0,
        memo: recordDetailDraft.memo,
        비고: recordDetailDraft.memo,
        expectedVersion: recordDetailDraft.existingRows.movements.find(
          (row) =>
            String(row["처리유형"] || "").trim() === "회송" &&
            String(row["센터명"] || "").trim() === String(recordDetailDraft.selectedCenter || "").trim()
        )?.["버전"] || 0,
        expectedUpdatedAt: recordDetailDraft.existingRows.movements.find(
          (row) =>
            String(row["처리유형"] || "").trim() === "회송" &&
            String(row["센터명"] || "").trim() === String(recordDetailDraft.selectedCenter || "").trim()
        )?.["수정일시"] || "",
        photoTypeFileIdsMap: { return: movementPhotoTypeFileIdsMap.return || [] },
      });

      rowsToSave.push({
        type: "movement",
        movementType: "EXCHANGE",
        처리유형: "교환",
        replaceQtyMode: true,
        operationId: createOperationId(),
        key: `${recordDetailDraft.partnerName}||${recordDetailDraft.productCode}||EXCHANGE||${recordDetailDraft.selectedCenter}`,
        jobKey: currentJob.job_key,
        작업기준일또는CSV식별값: currentJob.job_key,
        productCode: recordDetailDraft.productCode,
        상품코드: recordDetailDraft.productCode,
        productName: recordDetailDraft.productName,
        상품명: recordDetailDraft.productName,
        partnerName: recordDetailDraft.partnerName,
        협력사명: recordDetailDraft.partnerName,
        centerName: recordDetailDraft.selectedCenter,
        센터명: recordDetailDraft.selectedCenter,
        totalQty: recordDetailDraft.product?.totalQty || 0,
        전체발주수량: recordDetailDraft.product?.totalQty || 0,
        orderQty: selectedCenterQty,
        발주수량: selectedCenterQty,
        qty: parseQty(recordDetailDraft.exchangeQty),
        returnQty: 0,
        회송수량: 0,
        exchangeQty: parseQty(recordDetailDraft.exchangeQty),
        교환수량: parseQty(recordDetailDraft.exchangeQty),
        memo: recordDetailDraft.memo,
        비고: recordDetailDraft.memo,
        expectedVersion: recordDetailDraft.existingRows.movements.find(
          (row) =>
            String(row["처리유형"] || "").trim() === "교환" &&
            String(row["센터명"] || "").trim() === String(recordDetailDraft.selectedCenter || "").trim()
        )?.["버전"] || 0,
        expectedUpdatedAt: recordDetailDraft.existingRows.movements.find(
          (row) =>
            String(row["처리유형"] || "").trim() === "교환" &&
            String(row["센터명"] || "").trim() === String(recordDetailDraft.selectedCenter || "").trim()
        )?.["수정일시"] || "",
        photoTypeFileIdsMap: { exchange: movementPhotoTypeFileIdsMap.exchange || [] },
      });

      await postAction("saveBatch", { rows: rowsToSave });
      await postAction("postSaveSync", {
        payload: {
          hasInspection: true,
          hasMovement: true,
        },
      });

      await loadServerSnapshot();
      setRecordDetailDraft((prev) =>
        prev
          ? {
              ...prev,
              photoGroups: uploadedPhotoGroups,
            }
          : prev
      );
      setStatusMeta((prev) => ({
        ...prev,
        lastActionAt: new Date().toISOString(),
      }));
      setMessage("내역 상세 수정이 저장되었습니다.");
      closeRecordDetail();
    } catch (err) {
      setError(err.message || "내역 상세 저장에 실패했습니다.");
    } finally {
      setRecordDetailSaving(false);
    }
  }, [
    buildPhotoTypeFileIdsMap,
    closeRecordDetail,
    currentJob?.job_key,
    loadServerSnapshot,
    recordDetailDraft,
    uploadDetailPhotos,
    validateRecordDetail,
  ]);

  const renderRecordPhotoSection = useCallback(
    (photoType) => {
      const items = recordDetailDraft?.photoGroups?.[photoType] || [];
      return (
        <div key={photoType} style={{ border: "1px solid #d8e2ef", borderRadius: 14, padding: 12, background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#15253e" }}>
              {PHOTO_TYPE_LABEL_MAP[photoType]}
              {items.length > 0 ? <span style={{ fontSize: 12, fontWeight: 600, color: "#708095", marginLeft: 4 }}>({items.length})</span> : null}
            </div>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 34,
                padding: "0 12px",
                borderRadius: 10,
                border: "1px solid #9ec4ff",
                background: "#fff",
                color: "#1473ff",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              사진 추가
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) => {
                  handleRecordPhotoSelect(photoType, event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {items.length === 0 ? (
            <div style={{ fontSize: 12, color: "#708095" }}>등록된 사진이 없습니다.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(86px, 1fr))", gap: 8 }}>
              {items.map((item) => (
                <div key={item.id} style={{ position: "relative" }}>
                  <img
                    src={item.previewUrl || item.driveUrl}
                    alt={item.fileName || PHOTO_TYPE_LABEL_MAP[photoType]}
                    style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 10, border: "1px solid #d8e2ef" }}
                  />
                  <button
                    type="button"
                    onClick={() => removeRecordPhoto(photoType, item.id)}
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      border: "1px solid #ffd6d6",
                      background: "#fff",
                      color: "#e44747",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    },
    [handleRecordPhotoSelect, recordDetailDraft?.photoGroups, removeRecordPhoto]
  );

  const renderRecordsView = useCallback(() => (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: recordDetailDraft ? "minmax(0, 1.05fr) minmax(360px, 0.95fr)" : "minmax(0, 1fr)",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              background: "#fff",
              border: "1px solid #d8e2ef",
              borderRadius: 18,
              padding: 14,
              boxShadow: "0 14px 30px rgba(41, 73, 129, 0.08)",
            }}
          >
            <div style={{ fontSize: 14, color: "#516274", lineHeight: 1.6 }}>
              저장된 검품 / 회송 / 교환 내역을 상품 단위로 열어서 직접 수정할 수 있습니다.
              <br />
              카드 클릭 후 센터, 수량, 메모, BRIX, 사진을 한 화면에서 편집하세요.
            </div>
            <button
              type="button"
              onClick={loadServerSnapshot}
              style={{
                height: 40,
                padding: "0 14px",
                borderRadius: 12,
                border: "1px solid #d8e2ef",
                background: "#fff",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              새로고침
            </button>
          </div>

          {historyLoading ? (
            <div style={{ background: "#fff", border: "1px solid #d8e2ef", borderRadius: 18, padding: 24 }}>내역을 불러오는 중입니다.</div>
          ) : recordItems.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #d8e2ef", borderRadius: 18, padding: 24 }}>수정 가능한 내역이 없습니다.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {recordItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => openRecordDetail(item.key)}
                  style={{
                    border: item.key === recordDetailKey ? "1px solid #a9ccff" : "1px solid #d8e2ef",
                    borderRadius: 18,
                    background: "#fff",
                    padding: 14,
                    textAlign: "left",
                    boxShadow: "0 14px 30px rgba(41, 73, 129, 0.08)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#15253e", marginBottom: 6 }}>{item.productName || "상품명 없음"}</div>
                  <div style={{ fontSize: 13, color: "#516274", marginBottom: 4 }}>코드 {item.productCode || "-"}</div>
                  <div style={{ fontSize: 13, color: "#516274", marginBottom: 10 }}>{item.partnerName || "-"}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ background: "#eef9ef", color: "#24a148", borderRadius: 999, padding: "4px 9px", fontSize: 12, fontWeight: 700 }}>
                      검품 {parseQty(item.inspectionQty)}
                    </span>
                    <span style={{ background: "#fff4e8", color: "#f08a00", borderRadius: 999, padding: "4px 9px", fontSize: 12, fontWeight: 700 }}>
                      회송 {parseQty(item.returnQty)}
                    </span>
                    <span style={{ background: "#fff6f6", color: "#e44747", borderRadius: 999, padding: "4px 9px", fontSize: 12, fontWeight: 700 }}>
                      교환 {parseQty(item.exchangeQty)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {recordDetailDraft ? (
          <div
            style={{
              background: "#fff",
              border: "1px solid #d8e2ef",
              borderRadius: 18,
              padding: 16,
              boxShadow: "0 14px 30px rgba(41, 73, 129, 0.08)",
              display: "grid",
              gap: 14,
              position: "sticky",
              top: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#15253e", marginBottom: 4 }}>{recordDetailDraft.productName}</div>
                <div style={{ fontSize: 13, color: "#516274" }}>코드 {recordDetailDraft.productCode}</div>
                <div style={{ fontSize: 13, color: "#516274" }}>{recordDetailDraft.partnerName}</div>
              </div>
              <button
                type="button"
                onClick={closeRecordDetail}
                style={{ width: 34, height: 34, borderRadius: 999, border: "1px solid #d8e2ef", background: "#fff", cursor: "pointer" }}
              >
                ×
              </button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#516274" }}>기존 처리 내역</div>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#516274" }}>
                  검품: {parseQty(recordDetailDraft.existingRows.inspection?.["검품수량"] || 0)} / 최근 수정 {recordDetailDraft.existingRows.inspection?.["수정일시"] || "-"}
                </div>
                {(recordDetailDraft.existingRows.movements || []).length === 0 ? (
                  <div style={{ fontSize: 12, color: "#708095" }}>회송/교환 내역이 없습니다.</div>
                ) : (
                  recordDetailDraft.existingRows.movements.map((row) => (
                    <div key={`${row.__rowNumber}_${row["처리유형"]}`} style={{ fontSize: 12, color: "#516274" }}>
                      {row["처리유형"]} / 센터 {row["센터명"] || "-"} / 수량 {parseQty(row["회송수량"] || row["교환수량"] || 0)} / {row["작성일시"] || "-"}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: "#708095", marginBottom: 6 }}>센터명</div>
                <select
                  value={recordDetailDraft.selectedCenter}
                  onChange={(event) => {
                    const nextCenter = event.target.value;
                    setRecordDetailDraft((prev) => rebuildRecordDetailForCenter(prev, nextCenter));
                  }}
                  style={{ width: "100%", height: 40, borderRadius: 12, border: "1px solid #d8e2ef", padding: "0 12px" }}
                >
                  <option value="">센터 선택</option>
                  {recordDetailDraft.centerOptions.map((center) => (
                    <option key={center} value={center}>
                      {center}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#708095", marginBottom: 6 }}>검품수량</div>
                <input
                  value={recordDetailDraft.inspectionQty}
                  onChange={(event) => updateRecordDetailDraft({ inspectionQty: event.target.value.replace(/[^\d]/g, "") })}
                  style={{ width: "100%", height: 40, borderRadius: 12, border: "1px solid #d8e2ef", padding: "0 12px" }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#708095", marginBottom: 6 }}>회송수량</div>
                <input
                  value={recordDetailDraft.returnQty}
                  onChange={(event) => updateRecordDetailDraft({ returnQty: event.target.value.replace(/[^\d]/g, "") })}
                  style={{ width: "100%", height: 40, borderRadius: 12, border: "1px solid #d8e2ef", padding: "0 12px" }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#708095", marginBottom: 6 }}>교환수량</div>
                <input
                  value={recordDetailDraft.exchangeQty}
                  onChange={(event) => updateRecordDetailDraft({ exchangeQty: event.target.value.replace(/[^\d]/g, "") })}
                  style={{ width: "100%", height: 40, borderRadius: 12, border: "1px solid #d8e2ef", padding: "0 12px" }}
                />
              </div>
            </div>


            <div>
              <div style={{ fontSize: 12, color: "#708095", marginBottom: 6 }}>불량사유</div>
              <textarea
                value={recordDetailDraft.memo}
                onChange={(event) => updateRecordDetailDraft({ memo: event.target.value })}
                rows={3}
                style={{ width: "100%", borderRadius: 12, border: "1px solid #d8e2ef", padding: 12, boxSizing: "border-box", resize: "vertical" }}
              />
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#15253e", marginBottom: 8 }}>사진 관리</div>
              <div style={{ display: "grid", gap: 10 }}>
                {renderRecordPhotoSection("inspection")}

                {/* 불량사진 — return + exchange merged */}
                {(() => {
                  const returnItems = recordDetailDraft?.photoGroups?.return || [];
                  const exchangeItems = recordDetailDraft?.photoGroups?.exchange || [];
                  const total = returnItems.length + exchangeItems.length;
                  return (
                    <div style={{ border: "1px solid #d8e2ef", borderRadius: 14, padding: 12, background: "#fff" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#15253e" }}>
                          불량사진{total > 0 ? <span style={{ fontSize: 12, fontWeight: 600, color: "#708095", marginLeft: 4 }}>({total})</span> : null}
                        </div>
                        <label style={{ display: "inline-flex", alignItems: "center", height: 34, padding: "0 12px", borderRadius: 10, border: "1px solid #9ec4ff", background: "#fff", color: "#1473ff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          사진 추가
                          <input type="file" accept="image/*" multiple hidden onChange={(e) => { handleRecordPhotoSelect("return", e.target.files); e.target.value = ""; }} />
                        </label>
                      </div>
                      {total === 0 ? (
                        <div style={{ fontSize: 12, color: "#708095" }}>등록된 사진이 없습니다.</div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(86px, 1fr))", gap: 8 }}>
                          {returnItems.map((item) => (
                            <div key={item.id} style={{ position: "relative" }}>
                              <img src={item.previewUrl || item.driveUrl} alt={item.fileName || "불량사진"} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 10, border: "1px solid #d8e2ef" }} />
                              <button type="button" onClick={() => removeRecordPhoto("return", item.id)} style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 999, border: "1px solid #ffd6d6", background: "#fff", color: "#e44747", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>×</button>
                            </div>
                          ))}
                          {exchangeItems.map((item) => (
                            <div key={item.id} style={{ position: "relative" }}>
                              <img src={item.previewUrl || item.driveUrl} alt={item.fileName || "불량사진(교환)"} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 10, border: "1px solid #ffd4a8" }} />
                              <span style={{ position: "absolute", bottom: 4, left: 4, fontSize: 9, fontWeight: 700, background: "#f59e0b", color: "#fff", borderRadius: 4, padding: "1px 4px" }}>교환</span>
                              <button type="button" onClick={() => removeRecordPhoto("exchange", item.id)} style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 999, border: "1px solid #ffd6d6", background: "#fff", color: "#e44747", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>×</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {renderRecordPhotoSection("weight")}

                {/* 당도사진 + BRIX inputs */}
                {(() => {
                  const items = recordDetailDraft?.photoGroups?.sugar || [];
                  return (
                    <div style={{ border: "1px solid #d8e2ef", borderRadius: 14, padding: 12, background: "#fff" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#15253e" }}>
                          당도사진{items.length > 0 ? <span style={{ fontSize: 12, fontWeight: 600, color: "#708095", marginLeft: 4 }}>({items.length})</span> : null}
                        </div>
                        <label style={{ display: "inline-flex", alignItems: "center", height: 34, padding: "0 12px", borderRadius: 10, border: "1px solid #9ec4ff", background: "#fff", color: "#1473ff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                          사진 추가
                          <input type="file" accept="image/*" multiple hidden onChange={(e) => { handleRecordPhotoSelect("sugar", e.target.files); e.target.value = ""; }} />
                        </label>
                      </div>
                      {items.length > 0 ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(86px, 1fr))", gap: 8, marginBottom: 10 }}>
                          {items.map((item) => (
                            <div key={item.id} style={{ position: "relative" }}>
                              <img src={item.previewUrl || item.driveUrl} alt={item.fileName || "당도사진"} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 10, border: "1px solid #d8e2ef" }} />
                              <button type="button" onClick={() => removeRecordPhoto("sugar", item.id)} style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 999, border: "1px solid #ffd6d6", background: "#fff", color: "#e44747", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>×</button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 11, color: "#708095", marginBottom: 4 }}>최저 BRIX</div>
                          <input value={recordDetailDraft.brixMin} onChange={(e) => updateRecordDetailDraft({ brixMin: e.target.value.replace(/[^\d.]/g, "") })} style={{ width: "100%", height: 36, borderRadius: 10, border: "1px solid #d8e2ef", padding: "0 10px", boxSizing: "border-box" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "#708095", marginBottom: 4 }}>최고 BRIX</div>
                          <input value={recordDetailDraft.brixMax} onChange={(e) => updateRecordDetailDraft({ brixMax: e.target.value.replace(/[^\d.]/g, "") })} style={{ width: "100%", height: 36, borderRadius: 10, border: "1px solid #d8e2ef", padding: "0 10px", boxSizing: "border-box" }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "#708095", marginBottom: 4 }}>평균 BRIX</div>
                          <div style={{ height: 36, borderRadius: 10, border: "1px solid #d8e2ef", padding: "0 10px", display: "flex", alignItems: "center", background: "#f8fbff", fontWeight: 700, fontSize: 14 }}>{recordDetailDraft.brixAvg || "-"}</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            <button
              type="button"
              onClick={saveRecordDetail}
              disabled={recordDetailSaving}
              style={{
                height: 48,
                borderRadius: 14,
                border: "none",
                background: "#2563eb",
                color: "#fff",
                fontSize: 16,
                fontWeight: 800,
                cursor: recordDetailSaving ? "default" : "pointer",
                opacity: recordDetailSaving ? 0.7 : 1,
              }}
            >
              {recordDetailSaving ? "저장 중..." : "상세 저장"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  ), [
    closeRecordDetail,
    historyLoading,
    loadServerSnapshot,
    openRecordDetail,
    recordDetailDraft,
    recordDetailKey,
    recordDetailSaving,
    recordItems,
    rebuildRecordDetailForCenter,
    renderRecordPhotoSection,
    saveRecordDetail,
    updateRecordDetailDraft,
  ]);

  const renderProductRow = (_group, product) => {
    const itemKey = makeProductKey(product);
    const draft = getDraftForProduct(product);
    const eventBadge = product.eventInfo?.eventName || product.eventLabel || "";
    const topBadge = product.topLabel || (product.topRank ? `해피콜 TOP${product.topRank}` : "");
    const sortedCenters = [...(product.centers || [])].sort((a, b) => parseQty(b.totalQty) - parseQty(a.totalQty));
    const inspectionQty = parseQty(draft.inspectionQty);
    const returnQty = parseQty(draft.returnQty);
    const exchangeQty = parseQty(draft.exchangeQty);
    const photoItems = getPhotoItems(product);
    const photoCount = photoItems.length || parseQty(product.photoCount || product.photosCount || 0);
    const baseStatusKey = itemStatusMap[itemKey] || "";
    const hasUploadingPhoto = photoItems.some((item) => item.status === "uploading");
    const hasFailedPhoto = photoItems.some((item) => item.status === "failed");
    const statusKey = hasUploadingPhoto
      ? "uploading"
      : hasFailedPhoto && !["editing", "pending", "saving", "conflict"].includes(baseStatusKey)
      ? "failed"
      : baseStatusKey;
    const statusLabel = STATUS_LABELS[statusKey] || "";
    const statusTone = STATUS_TONE[statusKey] || STATUS_TONE.pending;

    return (
      <div key={itemKey} style={productCardStyle}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "56px minmax(200px,1fr) 96px 88px 88px 156px 88px 118px",
            alignItems: "center",
            columnGap: 10,
          }}
        >
          <ProductPlaceholder src={getProductImageSrc(product)} alt={product.productName} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#15253e" }}>{product.productName}</div>
              {eventBadge ? (
                <span
                  style={{
                    height: 24,
                    padding: "0 9px",
                    borderRadius: 999,
                    background: "#fff4e8",
                    color: "#f08a00",
                    display: "inline-flex",
                    alignItems: "center",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  행사
                </span>
              ) : null}
              {topBadge ? (
                <span
                  style={{
                    height: 24,
                    padding: "0 9px",
                    borderRadius: 999,
                    background: "#eef9ef",
                    color: "#24a148",
                    display: "inline-flex",
                    alignItems: "center",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {topBadge}
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: 13, color: "#708095", lineHeight: 1.4 }}>
              코드 {product.productCode}
            </div>
            {statusLabel ? (
              <div
                style={{
                  marginTop: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  height: 22,
                  padding: "0 10px",
                  borderRadius: 999,
                  background: statusTone.bg,
                  color: statusTone.color,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {statusLabel}
              </div>
            ) : null}
          </div>
          <QtyBox label="발주수량" value={product.totalQty} />
          <div>
            <div style={{ fontSize: 11, color: "#708095", marginBottom: 6, lineHeight: 1 }}>교환수량</div>
            <input
              value={draft.exchangeQty}
              onChange={(e) => {
                updateProductDraft(product, { exchangeQty: parseQty(e.target.value), exchangeTouched: true });
                scheduleItemSave(product);
              }}
              style={{
                width: "100%",
                height: 40,
                borderRadius: 12,
                border: `1px solid ${exchangeQty > 0 ? "#ffb8b8" : "#d8e2ef"}`,
                background: exchangeQty > 0 ? "#fff6f6" : "#ffffff",
                padding: "0 10px",
                fontSize: 15,
                fontWeight: 700,
                color: exchangeQty > 0 ? "#e44747" : "#15253e",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#708095", marginBottom: 6, lineHeight: 1 }}>회송수량</div>
            <input
              value={draft.returnQty}
              onChange={(e) => {
                updateProductDraft(product, { returnQty: parseQty(e.target.value), returnTouched: true });
                scheduleItemSave(product);
              }}
              style={{
                width: "100%",
                height: 40,
                borderRadius: 12,
                border: `1px solid ${returnQty > 0 ? "#ffb8b8" : "#d8e2ef"}`,
                background: returnQty > 0 ? "#fff6f6" : "#ffffff",
                padding: "0 10px",
                fontSize: 15,
                fontWeight: 700,
                color: returnQty > 0 ? "#e44747" : "#15253e",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#708095", marginBottom: 6, lineHeight: 1 }}>회송센터</div>
            <select
              value={draft.centerName}
              onChange={(e) => {
                setSelectedCenterMap((prev) => ({ ...prev, [itemKey]: e.target.value }));
                updateProductDraft(product, { centerName: e.target.value, returnTouched: true });
                if (parseQty(draft.returnQty) > 0) {
                  scheduleItemSave(product);
                }
              }}
              style={{
                width: "100%",
                height: 40,
                borderRadius: 12,
                border: "1px solid #d8e2ef",
                background: "#fff",
                padding: "0 12px",
                fontSize: 12,
                color: "#22324a",
                boxSizing: "border-box",
              }}
            >
              <option value="">센터 선택</option>
              {sortedCenters.map((item) => (
                <option key={item.center} value={item.center}>
                  {`${item.center}(${parseQty(item.totalQty).toLocaleString("ko-KR")}개)`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#708095", marginBottom: 6, lineHeight: 1 }}>검품수량</div>
            <input
              value={draft.inspectionQty}
              onChange={(e) => {
                updateProductDraft(product, { inspectionQty: parseQty(e.target.value), inspectionTouched: true });
                scheduleItemSave(product);
              }}
              style={{
                width: "100%",
                height: 40,
                borderRadius: 12,
                border: `1px solid ${inspectionQty > 0 ? "#9dd8a9" : "#d8e2ef"}`,
                background: inspectionQty > 0 ? "#eef9ef" : "#ffffff",
                padding: "0 10px",
                fontSize: 15,
                fontWeight: 700,
                color: inspectionQty > 0 ? "#24a148" : "#15253e",
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => openPhotoPicker(product)}
            style={{
              height: 40,
              borderRadius: 12,
              border: `1px solid ${photoCount > 0 ? "#8fc3ff" : "#9ec4ff"}`,
              background: photoCount > 0 ? "#eaf4ff" : "#fff",
              color: "#1473ff",
              fontSize: 13,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "0 12px",
              boxSizing: "border-box",
            }}
          >
            <CameraIcon />
            검품사진
          </button>
        </div>
        {photoItems.length > 0 ? (
          <div
            style={{
              marginTop: 12,
              marginLeft: 66,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {photoItems.map((photoItem) => (
              <div
                key={photoItem.id}
                style={{
                  position: "relative",
                  width: 64,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 10,
                    overflow: "hidden",
                    border: `1px solid ${photoItem.status === "failed" ? "#ffb8b8" : "#d8e2ef"}`,
                    background: "#f5f7fb",
                  }}
                >
                  {getPhotoSrc(photoItem) ? (
                    <img
                      src={getPhotoSrc(photoItem)}
                      alt={photoItem.fileName || "검품사진"}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => deletePhotoItem(product, photoItem)}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    border: "1px solid #ffd6d6",
                    background: "#fff",
                    color: "#e44747",
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: "18px",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
                {photoItem.status === "uploading" ? (
                  <div style={{ fontSize: 10, color: "#1473ff", fontWeight: 700, textAlign: "center" }}>업로드중</div>
                ) : null}
                {photoItem.status === "failed" ? (
                  <button
                    type="button"
                    onClick={() => retryPhotoUpload(product, photoItem)}
                    style={{
                      height: 22,
                      borderRadius: 999,
                      border: "1px solid #ffb8b8",
                      background: "#fff6f6",
                      color: "#e44747",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    재시도
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <input ref={csvInputRef} type="file" accept=".csv" hidden onChange={handleCsvUpload} />
      <input ref={happycallInputRef} type="file" accept=".csv" hidden onChange={handleHappycallUpload} />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handlePhotoSelect}
      />
      <div style={{ position: "relative" }}>
        <ReferenceFunctionalApp
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onCsvUploadClick={() => csvInputRef.current?.click()}
          onHappycallUploadClick={() => happycallInputRef.current?.click()}
          onOpenSheet={() => window.open(SHEET_URL, "_blank", "noopener,noreferrer")}
          onSummaryAction={() => setActiveTab("analytics")}
          sheetUrl={SHEET_URL}
          uploadingCsv={uploadingCsv}
          uploadingHappycallCsv={uploadingHappycallCsv}
          currentFileName={currentFileName}
          happycallFileName={happycallFileName}
          message={message}
          error={error}
          search={search}
          onScannerOpen={() => setScannerOpen(true)}
          onRefreshRecords={loadServerSnapshot}
          onFlushPending={handleFlushPending}
          onSearchChange={setSearch}
          groupedPartners={groupedPartners}
          expandedPartner={expandedPartner}
          onTogglePartner={(partner) => setExpandedPartner((prev) => (prev === partner ? "" : partner))}
          renderProductRow={renderProductRow}
          saveQueueItems={saveQueueItems}
          totalVisibleProducts={totalVisibleProducts}
          historyRows={historyRows}
          historyLoading={historyLoading}
          renderRecordsView={renderRecordsView}
          analyticsKpis={analyticsKpis}
          selectedHappycallPeriod={selectedHappycallPeriod}
          onSelectPeriod={setSelectedHappycallPeriod}
          onDownloadInspectionZip={() => handleDownloadZip("inspection")}
          onDownloadMovementZip={() => handleDownloadZip("movement")}
          happycallHeroCard={null}
          happycallMiniCards={[]}
          zipDownloading={zipDownloading}
        />
      </div>
      {scannerOpen ? (
        <div
          onClick={closeScanner}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            background: "rgba(15,23,42,0.82)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 520,
              borderRadius: 24,
              background: "#111827",
              color: "#fff",
              padding: 18,
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>바코드 스캔</div>
              <button
                type="button"
                onClick={closeScanner}
                style={{ width: 38, height: 38, borderRadius: 999, border: "none", background: "rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer", fontSize: 20 }}
              >
                ×
              </button>
            </div>
            <div
              style={{
                width: "100%",
                aspectRatio: "4 / 3",
                borderRadius: 18,
                overflow: "hidden",
                background: "#000",
                border: "1px solid rgba(255,255,255,0.16)",
              }}
            >
              <video ref={scannerVideoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div style={{ marginTop: 12, fontSize: 14, color: "rgba(255,255,255,0.88)", textAlign: "center" }}>{scannerStatus}</div>
            {scannerError ? <div style={{ marginTop: 10, color: "#fecaca", fontSize: 13, textAlign: "center" }}>{scannerError}</div> : null}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <input
                value={scannerManualCode}
                onChange={(e) => setScannerManualCode(e.target.value)}
                placeholder="상품코드를 직접 입력"
                style={{
                  flex: 1,
                  height: 42,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  padding: "0 12px",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={() => applyScannedCode(scannerManualCode)}
                style={{
                  height: 42,
                  borderRadius: 12,
                  border: "none",
                  background: "#2563eb",
                  color: "#fff",
                  padding: "0 16px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                적용
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const PHOTO_TYPE_OPTIONS = [
  { key: "inspection", label: "검품사진", target: "inspection" },
  { key: "return", label: "불량사진", target: "movement" },
  { key: "weight", label: "중량사진", target: "inspection" },
  { key: "sugar", label: "당도사진", target: "inspection" },
  // "exchange" is intentionally merged under "return"/"불량사진" visually but kept as a separate key internally
  { key: "exchange", label: "불량사진(교환)", target: "movement" },
];

const PHOTO_TYPE_LABEL_MAP = PHOTO_TYPE_OPTIONS.reduce((acc, item) => {
  acc[item.key] = item.label;
  return acc;
}, {});

const PHOTO_TYPE_TARGET_MAP = PHOTO_TYPE_OPTIONS.reduce((acc, item) => {
  acc[item.key] = item.target;
  return acc;
}, {});

const formatBrixValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return Number.isInteger(num) ? String(num) : String(Number(num.toFixed(2)));
};

const parseBrixInput = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return Number.NaN;
  const num = Number(text);
  return Number.isFinite(num) ? num : Number.NaN;
};

const computeBrixAvg = (min, max) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "";
  return formatBrixValue((min + max) / 2);
};

const makeHistoryProductKey = (partnerName, productCode) => `${partnerName || ""}||${normalizeCode(productCode || "")}`;

const toPhotoItemsFromUrls = (sources, photoType) =>
  (Array.isArray(sources) ? sources : []).map((item, index) => ({
    id: `${photoType}_${item.fileId || index}`,
    fileId: item.fileId || "",
    fileName: item.fileName || `${PHOTO_TYPE_LABEL_MAP[photoType] || "사진"}_${index + 1}`,
    previewUrl: item.url || "",
    driveUrl: item.url || "",
    status: "saved",
    isExisting: true,
  }));



