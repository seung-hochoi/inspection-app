
import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { BrowserCodeReader, BrowserMultiFormatReader } from "@zxing/browser";

const SCRIPT_URL =
  process.env.REACT_APP_GOOGLE_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbw3NOxnqL__-bibyaJiXtH_VUoiKHLAGwqsLz7B9NVGA-cYyqz_odzXqTb87-5PqYU_Jg/exec";

const CSV_FIELD_CANDIDATES = {
  productCode: ["상품코드", "상품 코드", "코드", "바코드", "EAN", "SKU코드", "SKU 코드"],
  productName: ["상품명", "상품 명", "품명", "상품"],
  partner: ["협력사명(정산처명)", "협력사명", "협력사", "정산처명", "협력사 명"],
  center: ["센터명", "센터", "물류센터", "센터 명"],
  orderQty: ["발주수량", "총 발주수량", "총수량", "총 수량", "수량", "발주 수량"],
  missingQty: ["미출수량", "미출 수량", "미출고수량", "미출고 수량", "미출"],
  amount: ["총 금액", "발주금액", "총발주금액", "입고금액", "금액"],
};

const CONFIG_FIELD_CANDIDATES = {
  productCode: ["상품코드", "상품 코드", "코드"],
  partner: ["협력사명", "협력사", "협력사명(정산처명)"],
  useFlag: ["사용여부", "사용 여부", "사용", "활성여부", "활성 여부"],
  eventName: ["행사명", "행사 명", "이벤트명", "이벤트 명"],
  startDate: ["시작일", "시작 일", "행사시작일"],
  endDate: ["종료일", "종료 일", "행사종료일"],
};

const RECORD_FIELD_CANDIDATES = {
  createdAt: ["생성일시", "등록일시", "생성시간", "작성일시"],
  productName: ["상품명", "품명"],
  productCode: ["상품코드", "상품 코드", "코드"],
  centerName: ["센터명", "센터", "물류센터"],
  partnerName: ["협력사명", "협력사", "협력사명(정산처명)"],
  eventType: ["행사구분", "행사 구분"],
  eventName: ["행사명", "행사 명"],
  returnQty: ["회송수량", "회송 수량"],
  exchangeQty: ["교환수량", "교환 수량"],
  memo: ["비고", "메모"],
  photoUrl: ["사진URL", "사진 URL", "이미지URL", "이미지 URL"],
};

const INSPECTION_STORAGE_PREFIX = "inspectionDrafts";

const normalizeKey = (key) => String(key || "").replace(/\uFEFF/g, "").trim();

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\uFEFF/g, "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const normalizeProductCode = (value) => {
  if (value == null) return "";

  let text = String(value).replace(/\uFEFF/g, "").trim();
  const tMatch = text.match(/^=T\("(.+)"\)$/i);
  if (tMatch) text = tMatch[1];

  text = text.replace(/^"+|"+$/g, "").trim();

  const numericText = text.replace(/,/g, "").trim();
  if (/^\d+(\.0+)?$/.test(numericText)) {
    return numericText.replace(/\.0+$/, "");
  }

  return text;
};

const parseQty = (value) => {
  const num = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isNaN(num) ? 0 : num;
};

const getValue = (row, candidates) => {
  for (const key of candidates) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") {
      return row[key];
    }
  }
  return "";
};

const isTruthyUsage = (value) => {
  if (value === true) return true;
  return ["true", "y", "yes", "1", "사용", "활성"].includes(normalizeText(value));
};

const isExplicitFalseUsage = (value) => {
  if (value === false) return true;
  return ["false", "n", "no", "0", "미사용", "비활성"].includes(normalizeText(value));
};

const decodeCsvFile = async (file) => {
  const buffer = await file.arrayBuffer();
  const tryDecode = (encoding) => new TextDecoder(encoding).decode(buffer);
  const isBrokenText = (text) => (text.match(/�/g) || []).length > 5;
  let text = tryDecode("utf-8");
  if (isBrokenText(text)) text = tryDecode("euc-kr");
  return { text };
};

const buildNormalizedRows = (parsedRows) =>
  parsedRows.map((rawRow, index) => {
    const row = {};
    Object.keys(rawRow || {}).forEach((key) => {
      row[normalizeKey(key)] = rawRow[key];
    });

    const productCode = normalizeProductCode(getValue(row, CSV_FIELD_CANDIDATES.productCode));
    const productName = String(getValue(row, CSV_FIELD_CANDIDATES.productName) || "").trim();
    const partner = String(getValue(row, CSV_FIELD_CANDIDATES.partner) || "").trim();
    const center = String(getValue(row, CSV_FIELD_CANDIDATES.center) || "").trim();

    return {
      ...row,
      __id: `${productCode || "empty"}-${center || "nocenter"}-${partner || "nopartner"}-${index}`,
      __index: index,
      __productCode: productCode,
      __productName: productName,
      __partner: partner,
      __center: center,
      __qty: parseQty(getValue(row, CSV_FIELD_CANDIDATES.orderQty)),
      __missingQty: parseQty(getValue(row, CSV_FIELD_CANDIDATES.missingQty)),
      __amount: parseQty(getValue(row, CSV_FIELD_CANDIDATES.amount)),
      __productNameNormalized: normalizeText(productName),
      __partnerNormalized: normalizeText(partner),
      __centerNormalized: normalizeText(center),
    };
  });

const hashString = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return String(hash);
};

const computeJobKey = (rows) =>
  `job_${hashString(
    JSON.stringify(
      (rows || []).map((row) => ({
        상품코드: row.__productCode,
        상품명: row.__productName,
        센터명: row.__center,
        협력사명: row.__partner,
        발주수량: row.__qty,
      }))
    )
  )}`;

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        imageBase64: result.includes(",") ? result.split(",")[1] : result,
      });
    };
    reader.onerror = () => reject(new Error("사진 파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });

const urlToBase64 = async (url) => {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error("기존 사진을 불러오지 못했습니다.");
  const blob = await response.blob();
  const extension = blob.type?.split("/")?.[1] || "jpg";
  return fileToBase64(new File([blob], `history-photo.${extension}`, { type: blob.type || "image/jpeg" }));
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ko-KR");
};

const formatNumber = (value) => Number(parseQty(value) || 0).toLocaleString("ko-KR");
const formatPercent = (value, fractionDigits = 1) =>
  value == null || Number.isNaN(Number(value)) ? "-" : `${Number(value).toFixed(fractionDigits)}%`;

const getRecordField = (record, field) => getValue(record, RECORD_FIELD_CANDIDATES[field] || []);
const getRecordReturnQty = (record) => parseQty(getRecordField(record, "returnQty"));
const getRecordExchangeQty = (record) => parseQty(getRecordField(record, "exchangeQty"));
const getRecordPhotoUrl = (record) => String(getRecordField(record, "photoUrl") || "").trim();
const getRecordCenterName = (record) => String(getRecordField(record, "centerName") || "").trim();
const getRecordMemo = (record) => String(getRecordField(record, "memo") || "").trim();
const getRecordProductCode = (record) => normalizeProductCode(getRecordField(record, "productCode"));
const getRecordProductName = (record) => String(getRecordField(record, "productName") || "").trim();

const getRecordTypeKey = (record) => {
  const returnQty = getRecordReturnQty(record);
  const exchangeQty = getRecordExchangeQty(record);
  if (returnQty > 0 && exchangeQty > 0) return "mixed";
  if (returnQty > 0) return "return";
  if (exchangeQty > 0) return "exchange";
  return "other";
};

const getRecordTypeLabel = (record) => {
  const type = getRecordTypeKey(record);
  if (type === "return") return "회송";
  if (type === "exchange") return "교환";
  if (type === "mixed") return "회송 / 교환";
  return "기타";
};

const getRecordQtyText = (record) => {
  const returnQty = getRecordReturnQty(record);
  const exchangeQty = getRecordExchangeQty(record);
  if (returnQty > 0 && exchangeQty > 0) return `회송 ${formatNumber(returnQty)}개 / 교환 ${formatNumber(exchangeQty)}개`;
  if (returnQty > 0) return `${formatNumber(returnQty)}개`;
  if (exchangeQty > 0) return `${formatNumber(exchangeQty)}개`;
  return "0개";
};

const getDefectStatus = (rate) => {
  if (rate > 7) return { label: "경고", color: "#dc2626", background: "#fee2e2" };
  if (rate > 3) return { label: "주의", color: "#2563eb", background: "#dbeafe" };
  return { label: "정상", color: "#374151", background: "#f3f4f6" };
};

const buildInspectionStorageKey = (jobKey) => `${INSPECTION_STORAGE_PREFIX}:${jobKey || "default"}`;
const appendMemo = (oldMemo, newMemo) =>
  Array.from(new Set([String(oldMemo || "").trim(), String(newMemo || "").trim()].filter(Boolean))).join(" / ");

function App() {
  const [rows, setRows] = useState([]);
  const [currentJob, setCurrentJob] = useState(null);
  const [currentFileName, setCurrentFileName] = useState("");
  const [currentFileModifiedAt, setCurrentFileModifiedAt] = useState("");
  const [search, setSearch] = useState("");
  const [inspectionSearch, setInspectionSearch] = useState("");
  const [summarySearch, setSummarySearch] = useState("");
  const [activeTab, setActiveTab] = useState("search");
  const [expandedPartner, setExpandedPartner] = useState("");
  const [expandedProductCode, setExpandedProductCode] = useState("");
  const [selectedCenterByProduct, setSelectedCenterByProduct] = useState({});
  const [drafts, setDrafts] = useState({});
  const [inspectionDrafts, setInspectionDrafts] = useState({});
  const [showInspectionKpi, setShowInspectionKpi] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [deletingRowNumber, setDeletingRowNumber] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [excludedProductCodes, setExcludedProductCodes] = useState(new Set());
  const [excludedPairKeys, setExcludedPairKeys] = useState(new Set());
  const [eventMap, setEventMap] = useState({});
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerStatus, setScannerStatus] = useState("카메라를 준비하고 있습니다...");
  const [scannerReady, setScannerReady] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const fileInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const scannerVideoRef = useRef(null);
  const scannerReaderRef = useRef(null);
  const scannerControlsRef = useRef(null);
  const scannerTrackRef = useRef(null);
  const scannerStatusTimerRef = useRef(null);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const storageKey = buildInspectionStorageKey(currentJob?.job_key);
    try {
      const saved = window.localStorage.getItem(storageKey);
      setInspectionDrafts(saved ? JSON.parse(saved) : {});
    } catch (_) {
      setInspectionDrafts({});
    }
  }, [currentJob?.job_key]);

  useEffect(() => {
    const storageKey = buildInspectionStorageKey(currentJob?.job_key);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(inspectionDrafts));
    } catch (_) {}
  }, [inspectionDrafts, currentJob?.job_key]);

  const stopScanner = () => {
    if (scannerStatusTimerRef.current) {
      clearInterval(scannerStatusTimerRef.current);
      scannerStatusTimerRef.current = null;
    }
    try {
      scannerControlsRef.current?.stop();
    } catch (_) {}
    try {
      scannerTrackRef.current?.stop();
    } catch (_) {}
    scannerControlsRef.current = null;
    scannerReaderRef.current = null;
    scannerTrackRef.current = null;
    setScannerReady(false);
    setTorchSupported(false);
    setTorchOn(false);
  };

  const closeScanner = () => {
    stopScanner();
    setIsScannerOpen(false);
  };

  const focusSearchInput = () => {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const toggleTorch = async () => {
    try {
      const track = scannerTrackRef.current;
      if (!track) return;
      const nextTorch = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: nextTorch }] });
      setTorchOn(nextTorch);
    } catch (_) {
      setTorchSupported(false);
      setTorchOn(false);
    }
  };

  const startScanner = async () => {
    try {
      setScannerError("");
      setScannerReady(false);
      setScannerStatus("카메라를 준비하고 있습니다...");

      const reader = new BrowserMultiFormatReader();
      scannerReaderRef.current = reader;
      const devices = await BrowserCodeReader.listVideoInputDevices();
      const backCamera =
        devices.find((device) => /back|rear|environment|후면|뒤/i.test(String(device.label || ""))) || devices[0];

      let lastDetectedAt = Date.now();

      const callback = (result, err, controls) => {
        if (controls) {
          scannerControlsRef.current = controls;
          try {
            const stream = scannerVideoRef.current?.srcObject;
            const track = stream?.getVideoTracks?.()?.[0] || null;
            scannerTrackRef.current = track || scannerTrackRef.current;
            const capabilities = track && typeof track.getCapabilities === "function" ? track.getCapabilities() : null;
            if (capabilities && "torch" in capabilities) setTorchSupported(true);
          } catch (_) {}
        }

        if (result) {
          const scanned = String(typeof result.getText === "function" ? result.getText() : result.text || result)
            .replace(/\s+/g, "")
            .trim();
          if (scanned) {
            if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(100);
            setSearch(scanned);
            setActiveTab("search");
            closeScanner();
          }
          return;
        }

        if (!scannerReady) setScannerReady(true);

        if (!err || err.name === "NotFoundException") {
          const now = Date.now();
          setScannerStatus(now - lastDetectedAt > 2000 ? "바코드를 찾는 중입니다. 화면 안에 맞춰주세요." : "바코드를 인식하는 중입니다...");
          return;
        }

        lastDetectedAt = Date.now();
        setScannerStatus("바코드를 인식하는 중입니다...");
      };

      if (backCamera?.deviceId) {
        scannerControlsRef.current = await reader.decodeFromVideoDevice(backCamera.deviceId, scannerVideoRef.current, callback);
      } else {
        scannerControlsRef.current = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          scannerVideoRef.current,
          callback
        );
      }

      scannerStatusTimerRef.current = setInterval(() => {
        setScannerStatus((prev) =>
          prev === "바코드를 찾는 중입니다. 화면 안에 맞춰주세요."
            ? "바코드를 인식하는 중입니다..."
            : "바코드를 찾는 중입니다. 화면 안에 맞춰주세요."
        );
      }, 2200);
    } catch (err) {
      setScannerError(err.message || "카메라를 시작하지 못했습니다.");
      setScannerStatus("카메라를 사용할 수 없습니다.");
      stopScanner();
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isScannerOpen) {
      stopScanner();
      return undefined;
    }
    startScanner();
    return () => stopScanner();
  }, [isScannerOpen]);

  const loadBootstrap = async () => {
    if (!SCRIPT_URL.trim()) {
      setBootLoading(false);
      setError("REACT_APP_GOOGLE_SCRIPT_URL 환경변수가 필요합니다.");
      return;
    }

    try {
      setBootLoading(true);
      setError("");
      const response = await fetch(`${SCRIPT_URL}?action=bootstrap`);
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.message || "초기 데이터를 불러오지 못했습니다.");

      const data = result.data || {};
      const config = data.config || {};
      const job = data.current_job || null;
      const nextExcludedProductCodes = new Set();
      const nextExcludedPairKeys = new Set();

      (config.exclude_rows || []).forEach((row) => {
        const productCode = normalizeProductCode(getValue(row, CONFIG_FIELD_CANDIDATES.productCode));
        const partner = String(getValue(row, CONFIG_FIELD_CANDIDATES.partner) || "").trim();
        const useFlag = getValue(row, CONFIG_FIELD_CANDIDATES.useFlag);
        if (!isTruthyUsage(useFlag) || !productCode) return;
        if (partner) nextExcludedPairKeys.add(`${productCode}||${partner}`);
        else nextExcludedProductCodes.add(productCode);
      });

      const nextEventMap = {};
      (config.event_rows || []).forEach((row) => {
        const productCode = normalizeProductCode(getValue(row, CONFIG_FIELD_CANDIDATES.productCode));
        if (!productCode || isExplicitFalseUsage(getValue(row, CONFIG_FIELD_CANDIDATES.useFlag))) return;
        nextEventMap[productCode] = {
          eventType: "행사",
          eventName: String(getValue(row, CONFIG_FIELD_CANDIDATES.eventName) || "").trim(),
          startDate: String(getValue(row, CONFIG_FIELD_CANDIDATES.startDate) || "").trim(),
          endDate: String(getValue(row, CONFIG_FIELD_CANDIDATES.endDate) || "").trim(),
        };
      });

      setExcludedProductCodes(nextExcludedProductCodes);
      setExcludedPairKeys(nextExcludedPairKeys);
      setEventMap(nextEventMap);
      setCurrentJob(job);
      setRows(Array.isArray(job?.rows) ? job.rows : []);
      setCurrentFileName(job?.source_file_name || "");
      setCurrentFileModifiedAt(job?.source_file_modified || "");
      setMessage(job ? "최근 업로드한 CSV를 불러왔습니다." : "CSV를 먼저 업로드해주세요.");
    } catch (err) {
      setError(err.message || "초기 데이터를 불러오지 못했습니다.");
    } finally {
      setBootLoading(false);
    }
  };

  const loadHistoryRows = async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setHistoryLoading(true);
        setError("");
      }
      const response = await fetch(`${SCRIPT_URL}?action=getRecords`);
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.message || "저장 내역을 불러오지 못했습니다.");
      const nextRows = Array.isArray(result.records) ? result.records : [];
      nextRows.sort((a, b) =>
        String(getRecordField(b, "createdAt") || "").localeCompare(String(getRecordField(a, "createdAt") || ""), "ko")
      );
      setHistoryRows(nextRows);
      return nextRows;
    } catch (err) {
      if (!silent) {
        setError(err.message || "저장 내역을 불러오지 못했습니다.");
        setHistoryRows([]);
      }
      throw err;
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadBootstrap();
  }, []);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const code = normalizeProductCode(row.__productCode);
        const partner = String(row.__partner || "").trim();
        return code && !excludedProductCodes.has(code) && !excludedPairKeys.has(`${code}||${partner}`);
      }),
    [rows, excludedProductCodes, excludedPairKeys]
  );

  const productCards = useMemo(() => {
    const grouped = {};
    filteredRows.forEach((row) => {
      const productCode = normalizeProductCode(row.__productCode);
      const productName = row.__productName || "상품명 없음";
      const partner = row.__partner || "협력사 없음";
      const center = row.__center || "센터 없음";

      if (!grouped[productCode]) {
        grouped[productCode] = {
          productCode,
          productName,
          totalQty: 0,
          totalMissingQty: 0,
          totalAmount: 0,
          partners: [],
          partnerSet: new Set(),
          centers: {},
          firstIndex: row.__index ?? Number.MAX_SAFE_INTEGER,
          eventInfo: eventMap[productCode] || null,
        };
      }

      const product = grouped[productCode];
      product.totalQty += row.__qty || 0;
      product.totalMissingQty += row.__missingQty || 0;
      product.totalAmount += row.__amount || 0;
      product.firstIndex = Math.min(product.firstIndex, row.__index ?? Number.MAX_SAFE_INTEGER);
      if (!product.partnerSet.has(partner)) {
        product.partnerSet.add(partner);
        product.partners.push(partner);
      }
      if (!product.centers[center]) product.centers[center] = { center, totalQty: 0, totalMissingQty: 0, rows: [] };
      product.centers[center].totalQty += row.__qty || 0;
      product.centers[center].totalMissingQty += row.__missingQty || 0;
      product.centers[center].rows.push(row);
    });

    return Object.values(grouped)
      .map((product) => ({
        ...product,
        primaryPartner: product.partners[0] || "협력사 없음",
        partnerText: product.partners.join(", "),
        centerList: Object.values(product.centers).sort((a, b) => (b.totalQty || 0) - (a.totalQty || 0)),
      }))
      .sort(
        (a, b) =>
          (b.totalQty || 0) - (a.totalQty || 0) ||
          a.productName.localeCompare(b.productName, "ko") ||
          a.firstIndex - b.firstIndex
      );
  }, [filteredRows, eventMap]);

  const searchFilteredProducts = useMemo(() => {
    const keyword = normalizeText(search);
    if (!keyword && !search.trim()) return productCards;
    return productCards.filter(
      (product) =>
        normalizeText(product.productName).includes(keyword) ||
        normalizeText(product.partnerText).includes(keyword) ||
        String(product.productCode || "").includes(search.trim())
    );
  }, [productCards, search]);

  const partnerGroups = useMemo(() => {
    const grouped = {};
    searchFilteredProducts.forEach((product) => {
      const partnerName = product.primaryPartner || "협력사 없음";
      if (!grouped[partnerName]) grouped[partnerName] = { partnerName, items: [], totalQty: 0 };
      grouped[partnerName].items.push(product);
      grouped[partnerName].totalQty += product.totalQty || 0;
    });
    return Object.values(grouped).sort((a, b) => b.partnerName.localeCompare(a.partnerName, "ko") || (b.totalQty || 0) - (a.totalQty || 0));
  }, [searchFilteredProducts]);

  useEffect(() => {
    if (!partnerGroups.length) {
      setExpandedPartner("");
      return;
    }
    if (!expandedPartner || !partnerGroups.some((group) => group.partnerName === expandedPartner)) {
      setExpandedPartner(partnerGroups[0].partnerName);
    }
  }, [partnerGroups, expandedPartner]);
  const inspectionProducts = useMemo(() => {
    const keyword = normalizeText(inspectionSearch);
    if (!keyword && !inspectionSearch.trim()) return productCards;
    return productCards.filter(
      (product) =>
        normalizeText(product.productName).includes(keyword) ||
        normalizeText(product.partnerText).includes(keyword) ||
        String(product.productCode || "").includes(inspectionSearch.trim())
    );
  }, [productCards, inspectionSearch]);

  const summaryProducts = useMemo(() => {
    const keyword = normalizeText(summarySearch);
    if (!keyword && !summarySearch.trim()) return productCards;
    return productCards.filter(
      (product) =>
        normalizeText(product.productName).includes(keyword) ||
        normalizeText(product.partnerText).includes(keyword) ||
        String(product.productCode || "").includes(summarySearch.trim())
    );
  }, [productCards, summarySearch]);

  const inspectionStats = useMemo(() => {
    const totalOrderQty = productCards.reduce((sum, product) => sum + (product.totalQty || 0), 0);
    const totalSku = productCards.length;
    const eventSku = productCards.filter((product) => product.eventInfo?.eventName).length;
    let inspectedQty = 0;
    let defectQty = 0;
    let inspectedSku = 0;
    let activeSku = 0;
    let inspectedEventSku = 0;
    let inspectedCoveredQty = 0;
    let completedCount = 0;
    let inProgressCount = 0;
    let notStartedCount = 0;

    productCards.forEach((product) => {
      const draft = inspectionDrafts[product.productCode] || {};
      const inspected = parseQty(draft.inspectedQty);
      const defect = parseQty(draft.defectQty);
      const totalQty = product.totalQty || 0;
      inspectedQty += inspected;
      defectQty += defect;
      if (totalQty > 0) activeSku += 1;
      if (inspected > 0) {
        inspectedSku += 1;
        inspectedCoveredQty += totalQty;
        if (product.eventInfo?.eventName) inspectedEventSku += 1;
      }
      if (totalQty <= 0 || inspected <= 0) notStartedCount += 1;
      else if (inspected >= totalQty) completedCount += 1;
      else inProgressCount += 1;
    });

    return {
      totalOrderQty,
      inspectedQty,
      inspectionRate: totalOrderQty > 0 ? (inspectedQty / totalOrderQty) * 100 : 0,
      actualInspectionRate: inspectedCoveredQty > 0 ? (inspectedQty / inspectedCoveredQty) * 100 : 0,
      defectQty,
      defectRate: inspectedQty > 0 ? (defectQty / inspectedQty) * 100 : 0,
      totalSku,
      activeSku,
      inspectedSku,
      skuCoverage: totalSku > 0 ? (inspectedSku / totalSku) * 100 : 0,
      actualSkuCoverage: activeSku > 0 ? (inspectedSku / activeSku) * 100 : 0,
      eventSku,
      inspectedEventSku,
      inspectedCoveredQty,
      completedCount,
      inProgressCount,
      notStartedCount,
    };
  }, [productCards, inspectionDrafts]);

  const updateDraft = (key, field, value) => {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const updateInspectionDraft = (productCode, field, value) => {
    setInspectionDrafts((prev) => ({ ...prev, [productCode]: { ...prev[productCode], [field]: value } }));
  };

  const cacheCsvJob = async (normalizedRows, file) => {
    const nextJobKey = computeJobKey(normalizedRows);
    if (currentJob?.job_key === nextJobKey) {
      setRows(normalizedRows);
      setCurrentFileName(file.name);
      setCurrentFileModifiedAt(new Date(file.lastModified).toISOString());
      setMessage("같은 CSV 작업으로 인식되어 기존 작업을 유지했습니다.");
      return;
    }

    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "cacheCsv",
        payload: {
          job_key: nextJobKey,
          source_file_name: file.name,
          source_file_modified: new Date(file.lastModified).toISOString(),
          parsed_rows: normalizedRows,
        },
      }),
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.message || "CSV 작업 캐시에 실패했습니다.");

    setCurrentJob(result.job || null);
    setRows(normalizedRows);
    setCurrentFileName(file.name);
    setCurrentFileModifiedAt(new Date(file.lastModified).toISOString());
    setDrafts({});
    setExpandedPartner("");
    setExpandedProductCode("");
    setSelectedCenterByProduct({});
    setShowInspectionKpi(false);
    setMessage("CSV 작업이 저장되었습니다.");
    setToast("CSV 업로드 완료");
  };

  const handleCsvUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setUploadingCsv(true);
      setError("");
      setMessage("");
      const { text } = await decodeCsvFile(file);
      await new Promise((resolve, reject) => {
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: async (result) => {
            try {
              await cacheCsvJob(buildNormalizedRows(result.data || []), file);
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          error: () => reject(new Error("CSV 파싱 중 오류가 발생했습니다.")),
        });
      });
    } catch (err) {
      setError(err.message || "CSV 업로드에 실패했습니다.");
    } finally {
      setUploadingCsv(false);
      if (event.target) event.target.value = "";
    }
  };

  const saveRecordPayload = async (payload) => {
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "saveRecord", payload }),
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.message || "기록 저장에 실패했습니다.");
    return result.record || null;
  };

  const deleteRecordRow = async (rowNumber) => {
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "deleteRecord", payload: { rowNumber } }),
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.message || "기존 행 삭제에 실패했습니다.");
  };

  const upsertProcessRecord = async ({ product, centerName, orderQty, qty, type, memo, photoFile }) => {
    const latestRows = await loadHistoryRows({ silent: true }).catch(() => historyRows);
    const normalizedCenter = normalizeText(type === "exchange" ? "" : centerName || "");

    const existingRecord = (latestRows || []).find((record) => {
      return (
        getRecordProductCode(record) === normalizeProductCode(product.productCode) &&
        normalizeText(getRecordProductName(record)) === normalizeText(product.productName) &&
        normalizeText(getRecordCenterName(record)) === normalizedCenter &&
        getRecordTypeKey(record) === type
      );
    });

    let photoPayload = null;
    if (photoFile) photoPayload = await fileToBase64(photoFile);
    else if (existingRecord && getRecordPhotoUrl(existingRecord)) photoPayload = await urlToBase64(getRecordPhotoUrl(existingRecord));

    const savedRecord = await saveRecordPayload({
      생성일시: new Date().toISOString(),
      작업키또는CSV식별값: currentJob.job_key,
      상품명: product.productName,
      상품코드: product.productCode,
      센터명: type === "exchange" ? "" : centerName,
      협력사명: product.partnerText,
      발주수량: orderQty || 0,
      행사구분: product.eventInfo?.eventType || "",
      행사명: product.eventInfo?.eventName || "",
      회송수량: type === "return" ? getRecordReturnQty(existingRecord) + qty : 0,
      교환수량: type === "exchange" ? getRecordExchangeQty(existingRecord) + qty : 0,
      비고: appendMemo(existingRecord ? getRecordMemo(existingRecord) : "", memo),
      사진: photoPayload,
    });

    if (existingRecord?.__rowNumber) await deleteRecordRow(Number(existingRecord.__rowNumber));

    setHistoryRows((prev) => {
      const filtered = prev.filter((item) => Number(item.__rowNumber) !== Number(existingRecord?.__rowNumber));
      return savedRecord
        ? [savedRecord, ...filtered].sort((a, b) =>
            String(getRecordField(b, "createdAt") || "").localeCompare(String(getRecordField(a, "createdAt") || ""), "ko")
          )
        : filtered;
    });
  };

  const saveRecord = async (product, centerName) => {
    const selectedCenterInfo = product.centerList.find((item) => item.center === centerName) || null;
    const draftKey = `${product.productCode}||${centerName}`;
    const draft = drafts[draftKey] || {};
    const returnQty = parseQty(draft.returnQty);
    const exchangeQty = parseQty(draft.exchangeQty);
    const memo = String(draft.memo || "").trim();
    const photoFile = draft.photoFile || null;

    if (!currentJob?.job_key) {
      setError("저장 가능한 CSV 작업이 없습니다.");
      return;
    }
    if (returnQty <= 0 && exchangeQty <= 0) {
      setError("회송수량 또는 교환수량을 입력해주세요.");
      return;
    }
    if (returnQty > 0 && !selectedCenterInfo) {
      setError("회송 저장 시 센터를 선택해주세요.");
      return;
    }

    try {
      setSavingKey(draftKey);
      setError("");
      setMessage("");
      if (returnQty > 0) {
        await upsertProcessRecord({ product, centerName, orderQty: selectedCenterInfo?.totalQty || 0, qty: returnQty, type: "return", memo, photoFile });
      }
      if (exchangeQty > 0) {
        await upsertProcessRecord({ product, centerName: "", orderQty: product.totalQty || 0, qty: exchangeQty, type: "exchange", memo, photoFile });
      }
      setDrafts((prev) => ({ ...prev, [draftKey]: { returnQty: "", exchangeQty: "", memo: "", photoFile: null, photoName: "" } }));
      setMessage("기록이 저장되었습니다.");
      setToast("저장 완료");
    } catch (err) {
      setError(err.message || "기록 저장에 실패했습니다.");
    } finally {
      setSavingKey("");
    }
  };

  const deleteHistoryRecord = async (record) => {
    const rowNumber = Number(record.__rowNumber || 0);
    if (!rowNumber) {
      setError("삭제할 행 번호를 찾지 못했습니다.");
      return;
    }
    if (!window.confirm("이 저장 내역을 삭제할까요?")) return;
    try {
      setDeletingRowNumber(rowNumber);
      setError("");
      setMessage("");
      await deleteRecordRow(rowNumber);
      setHistoryRows((prev) => prev.filter((item) => Number(item.__rowNumber) !== rowNumber));
      setMessage("저장 내역을 삭제했습니다.");
      setToast("삭제 완료");
    } catch (err) {
      setError(err.message || "저장 내역 삭제에 실패했습니다.");
    } finally {
      setDeletingRowNumber(null);
    }
  };

  const renderSearchTab = () => (
    <>
      <div style={styles.panel}>
        <div style={styles.searchRow}>
          <input ref={searchInputRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="상품명 / 상품코드 / 협력사 검색" style={styles.searchInput} />
          <button type="button" onClick={() => setIsScannerOpen(true)} style={styles.scanButton}>바코드</button>
        </div>
      </div>

      <div style={styles.countRow}>
        <div style={styles.countText}>협력사 {partnerGroups.length}개 / 상품 {searchFilteredProducts.length}개</div>
        <button
          type="button"
          onClick={async () => {
            const next = !showHistory;
            setShowHistory(next);
            if (next) await loadHistoryRows();
          }}
          style={styles.historyButton}
        >
          {showHistory ? "내역 닫기" : "내역 보기"}
        </button>
      </div>
      <div style={styles.list}>
        {partnerGroups.length === 0 ? (
          <div style={styles.emptyBox}>표시할 상품이 없습니다.</div>
        ) : (
          partnerGroups.map((group) => {
            const isPartnerOpen = expandedPartner === group.partnerName;
            return (
              <div key={group.partnerName} style={styles.partnerCard}>
                <button type="button" style={styles.partnerButton} onClick={() => setExpandedPartner((prev) => (prev === group.partnerName ? "" : group.partnerName))}>
                  <div>
                    <div style={styles.partnerTitle}>{group.partnerName}</div>
                    <div style={styles.partnerMeta}>상품 {group.items.length}개 · 총 발주 {formatNumber(group.totalQty)}개</div>
                  </div>
                  <div style={styles.partnerToggle}>{isPartnerOpen ? "접기" : "펼치기"}</div>
                </button>

                {isPartnerOpen && (
                  <div style={styles.partnerBody}>
                    {group.items.map((product) => {
                      const isOpen = expandedProductCode === product.productCode;
                      const selectedCenter = selectedCenterByProduct[product.productCode] || product.centerList[0]?.center || "";
                      const selectedCenterInfo = product.centerList.find((item) => item.center === selectedCenter) || null;
                      const draftKey = `${product.productCode}||${selectedCenter}`;
                      const draft = drafts[draftKey] || {};
                      const isExchangeOnly = parseQty(draft.exchangeQty) > 0 && parseQty(draft.returnQty) <= 0;

                      return (
                        <div key={product.productCode} style={styles.card}>
                          <button
                            type="button"
                            style={styles.cardButton}
                            onClick={() => {
                              setExpandedProductCode((prev) => (prev === product.productCode ? "" : product.productCode));
                              setSelectedCenterByProduct((prev) => ({ ...prev, [product.productCode]: prev[product.productCode] || product.centerList[0]?.center || "" }));
                            }}
                          >
                            <div style={styles.cardTopRow}>
                              <div style={styles.cardTitle}>{product.productName || "상품명 없음"}</div>
                              {product.eventInfo?.eventName ? <span style={styles.eventBadge}>{product.eventInfo.eventName}</span> : null}
                            </div>
                            <div style={styles.cardMeta}>코드 {product.productCode}</div>
                            <div style={styles.cardMeta}>협력사 {product.partnerText || "-"}</div>
                            <div style={styles.qtyRow}>
                              <span style={styles.qtyChip}>총 발주 {formatNumber(product.totalQty)}개</span>
                              <span style={styles.qtyChip}>미출 {formatNumber(product.totalMissingQty)}개</span>
                            </div>
                          </button>

                          {isOpen && (
                            <div style={styles.editorBox}>
                              {!isExchangeOnly && (
                                <div style={styles.formGroup}>
                                  <label style={styles.label}>센터 선택</label>
                                  <select value={selectedCenter} onChange={(e) => setSelectedCenterByProduct((prev) => ({ ...prev, [product.productCode]: e.target.value }))} style={styles.input}>
                                    {product.centerList.map((center) => (
                                      <option key={center.center} value={center.center}>{center.center} / {formatNumber(center.totalQty)}개</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              {isExchangeOnly ? <div style={styles.tipBox}>교환 저장은 센터 선택 없이 처리됩니다.</div> : null}
                              {selectedCenterInfo && !isExchangeOnly ? (
                                <div style={styles.detailBlock}>
                                  <div style={styles.metaText}>선택 센터 발주수량: {formatNumber(selectedCenterInfo.totalQty)}개</div>
                                  <div style={styles.metaText}>선택 센터 협력사: {Array.from(new Set(selectedCenterInfo.rows.map((row) => row.__partner).filter(Boolean))).join(", ") || "-"}</div>
                                </div>
                              ) : null}
                              <div style={styles.grid2}>
                                <div style={styles.formGroup}><label style={styles.label}>회송수량</label><input type="number" min="0" value={draft.returnQty || ""} onChange={(e) => updateDraft(draftKey, "returnQty", e.target.value)} style={styles.input} /></div>
                                <div style={styles.formGroup}><label style={styles.label}>교환수량</label><input type="number" min="0" value={draft.exchangeQty || ""} onChange={(e) => updateDraft(draftKey, "exchangeQty", e.target.value)} style={styles.input} /></div>
                              </div>
                              <div style={styles.formGroup}><label style={styles.label}>비고</label><textarea value={draft.memo || ""} onChange={(e) => updateDraft(draftKey, "memo", e.target.value)} style={styles.textarea} rows={3} placeholder="불량 사유 / 전달 사항" /></div>
                              <div style={styles.formGroup}><label style={styles.label}>사진 첨부</label><input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0] || null; updateDraft(draftKey, "photoFile", file); updateDraft(draftKey, "photoName", file?.name || ""); }} style={styles.fileInput} /><div style={styles.metaText}>{draft.photoName || "선택된 사진 없음"}</div></div>
                              <button type="button" onClick={() => saveRecord(product, selectedCenter)} disabled={savingKey === draftKey} style={styles.saveButton}>{savingKey === draftKey ? "저장 중..." : "저장"}</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );

  const renderInspectionTab = () => {
    const defectStatus = getDefectStatus(inspectionStats.defectRate);
    const kpiCards = [
      { label: "총 발주수량", value: `${formatNumber(inspectionStats.totalOrderQty)}개` },
      { label: "검품 수량", value: `${formatNumber(inspectionStats.inspectedQty)}개` },
      { label: "검품률", value: formatPercent(inspectionStats.inspectionRate) },
      { label: "실검품률", value: formatPercent(inspectionStats.actualInspectionRate) },
      { label: "입고 SKU", value: `${formatNumber(inspectionStats.totalSku)}개` },
      { label: "검품 SKU", value: `${formatNumber(inspectionStats.inspectedSku)}개` },
      { label: "SKU 커버리지", value: formatPercent(inspectionStats.skuCoverage) },
      { label: "실제 SKU 커버리지", value: formatPercent(inspectionStats.actualSkuCoverage) },
      { label: "행사 SKU", value: `${formatNumber(inspectionStats.eventSku)}개` },
      { label: "검품행사 SKU", value: `${formatNumber(inspectionStats.inspectedEventSku)}개` },
      { label: "검품 입고수량", value: `${formatNumber(inspectionStats.inspectedCoveredQty)}개` },
      { label: "검품완료", value: `${formatNumber(inspectionStats.completedCount)}개` },
      { label: "검품 진행중", value: `${formatNumber(inspectionStats.inProgressCount)}개` },
      { label: "미검품", value: `${formatNumber(inspectionStats.notStartedCount)}개` },
      { label: "불량률", value: inspectionStats.inspectedQty > 0 ? formatPercent(inspectionStats.defectRate) : "-", accent: defectStatus },
      { label: "불량수량", value: `${formatNumber(inspectionStats.defectQty)}개` },
    ];

    return (
      <>
        <div style={styles.panel}>
          <button type="button" onClick={() => setShowInspectionKpi((prev) => !prev)} style={styles.kpiToggleButton}>
            <div>
              <div style={styles.sectionTitle}>검품 현황</div>
              <div style={styles.partnerMeta}>검품률 {formatPercent(inspectionStats.inspectionRate)} · 불량률 {inspectionStats.inspectedQty > 0 ? formatPercent(inspectionStats.defectRate) : "-"} · SKU 커버리지 {formatPercent(inspectionStats.skuCoverage)}</div>
            </div>
            <div style={styles.partnerToggle}>{showInspectionKpi ? "접기" : "KPI 보기"}</div>
          </button>
          {showInspectionKpi ? <div style={styles.kpiGrid}>{kpiCards.map((item) => <div key={item.label} style={{ ...styles.kpiCard, background: item.accent?.background || "#f8fafc", color: item.accent?.color || "#111827", borderColor: item.accent ? "transparent" : "#e5e7eb" }}><div style={styles.kpiLabel}>{item.label}</div><div style={styles.kpiValue}>{item.value}</div>{item.accent ? <div style={styles.kpiState}>{item.accent.label}</div> : null}</div>)}</div> : null}
        </div>
        <div style={styles.panel}><input value={inspectionSearch} onChange={(e) => setInspectionSearch(e.target.value)} placeholder="검품 대상 상품 검색" style={styles.searchInput} /></div>
        <div style={styles.list}>
          {inspectionProducts.length === 0 ? <div style={styles.emptyBox}>검품 대상 상품이 없습니다.</div> : inspectionProducts.map((product) => {
            const draft = inspectionDrafts[product.productCode] || {};
            const inspectedQty = parseQty(draft.inspectedQty);
            const defectQty = parseQty(draft.defectQty);
            const productInspectionRate = product.totalQty > 0 ? (inspectedQty / product.totalQty) * 100 : 0;
            const productDefectRate = inspectedQty > 0 ? (defectQty / inspectedQty) * 100 : 0;
            const rowDefectStatus = getDefectStatus(productDefectRate);
            return <div key={product.productCode} style={styles.card}><div style={styles.editorBoxAlt}><div style={styles.cardTopRow}><div style={styles.cardTitle}>{product.productName}</div><span style={styles.qtyChip}>전체 발주 {formatNumber(product.totalQty)}개</span></div><div style={styles.cardMeta}>코드 {product.productCode}</div><div style={styles.cardMeta}>협력사 {product.partnerText || "-"}</div><div style={styles.cardMeta}>미출수량 {formatNumber(product.totalMissingQty)}개</div><div style={styles.grid2}><div style={styles.formGroup}><label style={styles.label}>검품수량</label><input type="number" min="0" value={draft.inspectedQty || ""} onChange={(e) => updateInspectionDraft(product.productCode, "inspectedQty", e.target.value)} style={styles.input} /></div><div style={styles.formGroup}><label style={styles.label}>불량수량</label><input type="number" min="0" value={draft.defectQty || ""} onChange={(e) => updateInspectionDraft(product.productCode, "defectQty", e.target.value)} style={styles.input} /></div></div><div style={styles.qtyRow}><span style={styles.qtyChip}>검품률 {product.totalQty > 0 ? formatPercent(productInspectionRate) : "-"}</span><span style={{ ...styles.qtyChip, background: rowDefectStatus.background, color: rowDefectStatus.color }}>불량률 {inspectedQty > 0 ? formatPercent(productDefectRate) : "-"}</span></div>{defectQty > inspectedQty ? <div style={styles.errorMiniBox}>불량수량이 검품수량보다 큽니다.</div> : null}</div></div>;
          })}
        </div>
      </>
    );
  };

  const renderSummaryTab = () => (
    <>
      <div style={styles.panel}><input value={summarySearch} onChange={(e) => setSummarySearch(e.target.value)} placeholder="상품 기준 전체 발주수량 검색" style={styles.searchInput} /><div style={styles.metaText}>센터별 보기와 별도로, 동일 상품코드 기준 전체 발주수량 합계를 보여줍니다.</div></div>
      <div style={styles.list}>{summaryProducts.length === 0 ? <div style={styles.emptyBox}>표시할 상품이 없습니다.</div> : summaryProducts.map((product) => <div key={product.productCode} style={styles.card}><div style={styles.editorBoxAlt}><div style={styles.cardTopRow}><div style={styles.cardTitle}>{product.productName}</div><span style={styles.qtyChip}>전체 발주 {formatNumber(product.totalQty)}개</span></div><div style={styles.cardMeta}>코드 {product.productCode}</div><div style={styles.cardMeta}>협력사 {product.partnerText || "-"}</div><div style={styles.qtyRow}><span style={styles.qtyChip}>미출수량 {formatNumber(product.totalMissingQty)}개</span><span style={styles.qtyChip}>센터 수 {formatNumber(product.centerList.length)}개</span></div></div></div>)}</div>
    </>
  );

  return (
    <div style={styles.app}>
      <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsvUpload} style={styles.hiddenInput} />
      <div style={styles.headerCard}><h1 style={styles.title}>상품 검색 / 검품 앱</h1><p style={styles.subtitle}>기존 상품 검색과 회송·교환 흐름은 유지하면서, 협력사 그룹 보기와 검품수량 입력을 함께 처리합니다.</p></div>
      <div style={styles.panel}><div style={styles.csvHeaderRow}><div><div style={styles.sectionTitle}>CSV 업로드</div><div style={styles.metaText}>현재 파일: {currentFileName || "업로드된 파일 없음"}</div><div style={styles.metaText}>수정 시각: {currentFileModifiedAt ? formatDateTime(currentFileModifiedAt) : "-"}</div></div><button type="button" onClick={() => fileInputRef.current?.click()} style={styles.primaryButton}>{uploadingCsv ? "업로드 중..." : "CSV 선택"}</button></div></div>
      <div style={styles.tabRow}><button type="button" onClick={() => setActiveTab("search")} style={{ ...styles.tabButton, ...(activeTab === "search" ? styles.tabButtonActive : null) }}>상품 검색</button><button type="button" onClick={() => setActiveTab("inspection")} style={{ ...styles.tabButton, ...(activeTab === "inspection" ? styles.tabButtonActive : null) }}>검품수량</button><button type="button" onClick={() => setActiveTab("summary")} style={{ ...styles.tabButton, ...(activeTab === "summary" ? styles.tabButtonActive : null) }}>전체 발주수량</button></div>
      {(bootLoading || uploadingCsv || error || message) ? <div style={error ? styles.errorBox : styles.infoBox}>{bootLoading ? "초기 데이터를 불러오는 중입니다..." : uploadingCsv ? "CSV를 업로드하는 중입니다..." : error || message}</div> : null}
      {activeTab === "search" ? renderSearchTab() : null}
      {activeTab === "inspection" ? renderInspectionTab() : null}
      {activeTab === "summary" ? renderSummaryTab() : null}
      {showHistory ? <div style={styles.sheetOverlay} onClick={() => setShowHistory(false)}><div style={styles.bottomSheet} onClick={(e) => e.stopPropagation()}><div style={styles.sheetHandle} /><div style={styles.sheetHeader}><h2 style={styles.sheetTitle}>저장 내역</h2><button type="button" onClick={() => setShowHistory(false)} style={styles.sheetClose}>닫기</button></div>{historyLoading ? <div style={styles.infoBox}>저장 내역을 불러오는 중입니다...</div> : historyRows.length === 0 ? <div style={styles.emptyBox}>저장된 내역이 없습니다.</div> : <div style={styles.sheetList}>{historyRows.map((record, index) => <div key={`${record.__rowNumber || "row"}-${getRecordField(record, "createdAt") || "time"}-${index}`} style={styles.historyCard}><button type="button" onClick={() => deleteHistoryRecord(record)} style={styles.deleteBtn} disabled={deletingRowNumber === Number(record.__rowNumber)}>{deletingRowNumber === Number(record.__rowNumber) ? "..." : "×"}</button><div style={styles.cardTopRow}><div style={styles.cardTitle}>{getRecordProductName(record) || "상품명 없음"}</div><span style={styles.typeBadge}>{getRecordTypeLabel(record)}</span></div><div style={styles.cardMeta}>코드 {getRecordProductCode(record) || "-"}</div><div style={styles.cardMeta}>센터 {getRecordCenterName(record) || "-"}</div><div style={styles.cardMeta}>협력사 {getRecordField(record, "partnerName") || "-"}</div><div style={styles.qtyRow}><span style={styles.qtyChip}>처리수량 {getRecordQtyText(record)}</span><span style={styles.qtyChip}>{formatDateTime(getRecordField(record, "createdAt"))}</span></div><div style={styles.historyMemo}>{getRecordMemo(record) || "-"}</div>{getRecordPhotoUrl(record) ? <div style={styles.photoWrap}><img src={getRecordPhotoUrl(record)} alt="첨부사진" style={styles.photoPreview} onClick={() => setPreviewImageUrl(getRecordPhotoUrl(record))} /><button type="button" onClick={() => setPreviewImageUrl(getRecordPhotoUrl(record))} style={styles.photoLinkButton}>사진 크게 보기</button></div> : null}</div>)}</div>}</div></div> : null}
      {previewImageUrl ? <div style={styles.previewOverlay} onClick={() => setPreviewImageUrl("")}><div style={styles.previewModal} onClick={(e) => e.stopPropagation()}><button type="button" onClick={() => setPreviewImageUrl("")} style={styles.previewClose}>닫기</button><img src={previewImageUrl} alt="확대 이미지" style={styles.previewImage} /></div></div> : null}
      {isScannerOpen ? <div style={styles.scannerOverlay} onClick={closeScanner}><div style={styles.scannerModal} onClick={(e) => e.stopPropagation()}><button type="button" onClick={closeScanner} style={styles.scannerCloseBtn}>×</button><div style={styles.scannerTopText}>{scannerReady ? scannerStatus : "바코드 인식 준비 중..."}</div><div style={styles.scannerViewport}><video ref={scannerVideoRef} style={styles.scannerVideo} muted playsInline /><div style={styles.scannerGuideBox} /></div><div style={styles.scannerHelperText}>바코드를 화면 중앙에 맞추면 자동으로 검색됩니다.</div>{scannerError ? <div style={styles.errorBox}>{scannerError}</div> : null}<div style={styles.scannerActions}>{torchSupported ? <button type="button" onClick={toggleTorch} style={styles.secondaryButton}>{torchOn ? "플래시 끄기" : "플래시 켜기"}</button> : null}<button type="button" onClick={() => { closeScanner(); focusSearchInput(); }} style={styles.primaryButton}>직접 검색</button></div></div></div> : null}
      {toast ? <div style={styles.toast}>{toast}</div> : null}
    </div>
  );
}

const styles = {
  app: { minHeight: "100vh", background: "#f4f6fb", padding: 14, color: "#1f2937", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif", boxSizing: "border-box", maxWidth: 760, margin: "0 auto" },
  hiddenInput: { display: "none" },
  headerCard: { background: "#ffffff", borderRadius: 18, padding: 16, marginBottom: 12, border: "1px solid #e5e7eb" },
  title: { margin: 0, fontSize: 24, fontWeight: 800 }, subtitle: { marginTop: 8, marginBottom: 0, color: "#6b7280", fontSize: 14, lineHeight: 1.5 },
  panel: { background: "#ffffff", borderRadius: 16, padding: 14, marginBottom: 12, border: "1px solid #e5e7eb" },
  csvHeaderRow: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" },
  tabRow: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 12 },
  tabButton: { minHeight: 46, borderRadius: 14, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: 14, fontWeight: 800, cursor: "pointer" },
  tabButtonActive: { background: "#111827", color: "#fff", borderColor: "#111827" },
  sectionTitle: { fontSize: 15, fontWeight: 800, marginBottom: 4 }, primaryButton: { minHeight: 48, padding: "0 16px", borderRadius: 14, border: "none", background: "#2563eb", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }, secondaryButton: { minHeight: 48, padding: "0 16px", borderRadius: 14, border: "1px solid #d1d5db", background: "#fff", color: "#111827", fontSize: 15, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" },
  label: { display: "block", marginBottom: 8, fontSize: 13, fontWeight: 700 }, input: { width: "100%", minHeight: 48, padding: 12, borderRadius: 12, border: "1px solid #d1d5db", boxSizing: "border-box", fontSize: 16, background: "#fff" }, searchInput: { flex: 1, minHeight: 48, padding: 12, borderRadius: 12, border: "1px solid #d1d5db", boxSizing: "border-box", fontSize: 16, background: "#fff", minWidth: 0, width: "100%" }, textarea: { width: "100%", padding: 12, borderRadius: 12, border: "1px solid #d1d5db", boxSizing: "border-box", fontSize: 16, resize: "vertical", marginTop: 2 }, fileInput: { width: "100%", fontSize: 14, minHeight: 40 },
  searchRow: { display: "flex", gap: 10, alignItems: "center" }, scanButton: { minWidth: 88, minHeight: 48, padding: "0 14px", borderRadius: 12, border: "1px solid #111827", background: "#111827", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", flexShrink: 0 }, formGroup: { marginBottom: 12 }, detailBlock: { marginBottom: 12 }, metaText: { marginTop: 8, fontSize: 12, color: "#6b7280", wordBreak: "break-all", lineHeight: 1.5 }, infoBox: { padding: 12, borderRadius: 14, background: "#eff6ff", color: "#1d4ed8", marginBottom: 12, border: "1px solid #bfdbfe", fontSize: 14 }, errorBox: { padding: 12, borderRadius: 14, background: "#fee2e2", color: "#b91c1c", marginBottom: 12, border: "1px solid #fecaca", fontSize: 14 }, errorMiniBox: { padding: "10px 12px", borderRadius: 12, background: "#fee2e2", color: "#b91c1c", fontSize: 13, fontWeight: 700, marginTop: 10 }, tipBox: { padding: "10px 12px", borderRadius: 12, background: "#eff6ff", color: "#1d4ed8", fontSize: 13, fontWeight: 700, marginBottom: 12, border: "1px solid #bfdbfe" }, countRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10, paddingLeft: 4 }, countText: { fontSize: 13, color: "#6b7280" }, historyButton: { border: "1px solid #d1d5db", background: "#fff", borderRadius: 999, padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#374151", minHeight: 40 },
  list: { display: "flex", flexDirection: "column", gap: 12, paddingBottom: 18 }, partnerCard: { background: "#fff", borderRadius: 18, border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 6px 20px rgba(15,23,42,0.04)" }, partnerButton: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, border: "none", background: "#fff", padding: 16, cursor: "pointer", textAlign: "left" }, partnerTitle: { fontSize: 17, fontWeight: 800 }, partnerMeta: { marginTop: 6, color: "#6b7280", fontSize: 12, lineHeight: 1.45 }, partnerToggle: { fontSize: 13, fontWeight: 800, color: "#2563eb", flexShrink: 0 }, partnerBody: { padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 10 },
  card: { background: "#fff", borderRadius: 18, border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 6px 20px rgba(15,23,42,0.04)" }, cardButton: { width: "100%", textAlign: "left", border: "none", background: "#fff", padding: 14, cursor: "pointer" }, cardTopRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }, cardTitle: { fontSize: 17, fontWeight: 800, lineHeight: 1.45 }, cardMeta: { marginTop: 6, fontSize: 13, color: "#4b5563", lineHeight: 1.45 }, qtyRow: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }, qtyChip: { background: "#f3f4f6", borderRadius: 999, padding: "6px 10px", fontSize: 12, fontWeight: 700, color: "#374151" }, eventBadge: { display: "inline-block", background: "#dc2626", color: "#fff", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700, flexShrink: 0 }, typeBadge: { display: "inline-block", background: "#111827", color: "#fff", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700, flexShrink: 0 }, editorBox: { borderTop: "1px solid #e5e7eb", padding: 14, background: "#fafafa" }, editorBoxAlt: { padding: 14, background: "#fff" }, grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }, saveButton: { width: "100%", minHeight: 50, border: "none", borderRadius: 14, padding: "14px 16px", background: "#2563eb", color: "#fff", fontSize: 16, fontWeight: 800, cursor: "pointer", marginTop: 12 }, emptyBox: { padding: 24, borderRadius: 16, border: "1px dashed #d1d5db", background: "#fff", color: "#6b7280", textAlign: "center" },
  kpiToggleButton: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, border: "none", background: "transparent", padding: 0, cursor: "pointer", textAlign: "left" }, kpiGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 14 }, kpiCard: { borderRadius: 16, border: "1px solid #e5e7eb", padding: 14, minHeight: 88, boxSizing: "border-box" }, kpiLabel: { fontSize: 12, fontWeight: 700, opacity: 0.8 }, kpiValue: { marginTop: 8, fontSize: 18, fontWeight: 800, lineHeight: 1.3 }, kpiState: { marginTop: 6, fontSize: 12, fontWeight: 700 },
  sheetOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.32)", zIndex: 40, display: "flex", alignItems: "flex-end", justifyContent: "center" }, bottomSheet: { width: "100%", maxWidth: 760, maxHeight: "78vh", background: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: "10px 14px 20px", overflow: "auto", boxSizing: "border-box" }, sheetHandle: { width: 54, height: 6, borderRadius: 999, background: "#d1d5db", margin: "0 auto 12px" }, sheetHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }, sheetTitle: { margin: 0, fontSize: 18, fontWeight: 800 }, sheetClose: { minHeight: 40, padding: "0 12px", border: "1px solid #d1d5db", borderRadius: 999, background: "#fff", cursor: "pointer", fontWeight: 700 }, sheetList: { display: "flex", flexDirection: "column", gap: 12, paddingBottom: 12 }, historyCard: { position: "relative", background: "#fff", borderRadius: 18, border: "1px solid #e5e7eb", padding: 14 }, deleteBtn: { position: "absolute", top: 10, right: 10, width: 32, height: 32, borderRadius: 999, border: "none", background: "#ef4444", color: "#fff", fontSize: 18, fontWeight: 700, lineHeight: "32px", cursor: "pointer" }, historyMemo: { marginTop: 10, fontSize: 14, color: "#374151", lineHeight: 1.5, whiteSpace: "pre-wrap" }, photoWrap: { marginTop: 12 }, photoPreview: { width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", display: "block", cursor: "pointer" }, photoLinkButton: { display: "inline-block", marginTop: 8, padding: 0, background: "none", border: "none", fontSize: 13, color: "#2563eb", fontWeight: 700, cursor: "pointer" },
  previewOverlay: { position: "fixed", inset: 0, zIndex: 80, background: "rgba(15,23,42,0.82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }, previewModal: { width: "100%", maxWidth: 720, position: "relative" }, previewClose: { position: "absolute", top: -52, right: 0, minHeight: 40, padding: "0 14px", borderRadius: 999, border: "none", background: "rgba(255,255,255,0.18)", color: "#fff", fontWeight: 700, cursor: "pointer" }, previewImage: { width: "100%", maxHeight: "80vh", objectFit: "contain", borderRadius: 18, background: "#111827" },
  scannerOverlay: { position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }, scannerModal: { width: "100%", maxWidth: 560, height: "100%", maxHeight: "100dvh", display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", color: "#fff" }, scannerCloseBtn: { position: "absolute", top: 8, right: 0, width: 48, height: 48, borderRadius: 999, border: "none", background: "rgba(255,255,255,0.14)", color: "#fff", fontSize: 28, cursor: "pointer", zIndex: 2 }, scannerTopText: { textAlign: "center", fontSize: 16, fontWeight: 800, marginBottom: 14, padding: "0 52px" }, scannerViewport: { position: "relative", width: "100%", aspectRatio: "3 / 4", borderRadius: 24, overflow: "hidden", background: "#111827", border: "1px solid rgba(255,255,255,0.12)" }, scannerVideo: { width: "100%", height: "100%", objectFit: "cover", display: "block" }, scannerGuideBox: { position: "absolute", inset: "24% 10%", border: "2px solid rgba(255,255,255,0.95)", borderRadius: 22, boxShadow: "0 0 0 9999px rgba(0,0,0,0.22)", pointerEvents: "none" }, scannerHelperText: { textAlign: "center", fontSize: 14, color: "rgba(255,255,255,0.9)", marginTop: 14, lineHeight: 1.5 }, scannerActions: { display: "flex", justifyContent: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }, toast: { position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", background: "rgba(17,24,39,0.92)", color: "#fff", padding: "12px 16px", borderRadius: 999, fontSize: 14, fontWeight: 700, zIndex: 90, boxShadow: "0 12px 30px rgba(15,23,42,0.28)" },
};

export default App;
