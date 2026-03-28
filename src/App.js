import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { BrowserCodeReader, BrowserMultiFormatReader } from "@zxing/browser";

const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwd0PlXVGFpf3q3BZT995-YK1O2S5nAjvFVlhqlIonLI5hWifMqXBQVDnpaFpZEdJ04Nw/exec";

const normalizeKey = (key) => String(key || "").replace(/\uFEFF/g, "").trim();

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\uFEFF/g, "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const normalizeHappycallLookupText = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\u3131-\uD79Da-z0-9]/gi, "")
    .trim();

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

const makeSkuKey = (productCode, partnerName) =>
  `${normalizeProductCode(productCode || "")}||${String(partnerName || "").trim()}`;

const getHappycallProductMetrics = (analytics, product) => {
  const periods = analytics?.periods || {};
  const keys = [
    `sku::${makeSkuKey(product?.productCode, product?.partner)}`,
    `name::${normalizeHappycallLookupText(product?.productName)}||${normalizeHappycallLookupText(product?.partner)}`,
    `code::${normalizeProductCode(product?.productCode || "")}`,
    `nameOnly::${normalizeHappycallLookupText(product?.productName)}`,
  ];

  const result = {};

  for (const [periodKey, periodValue] of Object.entries(periods)) {
    const metricsMap = periodValue?.productMetrics || {};
    for (const key of keys) {
      if (key && metricsMap[key]) {
        result[periodKey] = metricsMap[key];
        break;
      }
    }
  }

  return result;
};

const formatPercent = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : "-";
};

const getHappycallRankStyle = (rank) => {
  if (rank === 1) {
    return { background: "#fee2e2", color: "#b91c1c" };
  }
  if (rank === 2) {
    return { background: "#dbeafe", color: "#1d4ed8" };
  }
  if (rank === 3) {
    return { background: "#dcfce7", color: "#15803d" };
  }
  return { background: "#f3f4f6", color: "#374151" };
};

const getTopMedal = (rank) => {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return null;
};

const getValue = (row, candidates) => {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return "";
};

const isTruthyUsage = (value) => {
  if (value === true) return true;
  const text = normalizeText(value);
  return ["true", "y", "yes", "1", "사용", "활성"].includes(text);
};

const isExplicitFalseUsage = (value) => {
  if (value === false) return true;
  const text = normalizeText(value);
  return ["false", "n", "no", "0"].includes(text);
};

const decodeCsvFile = async (file) => {
  const buffer = await file.arrayBuffer();

  const tryDecode = (encoding) => {
    const decoder = new TextDecoder(encoding);
    return decoder.decode(buffer);
  };

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

    const productCode = normalizeProductCode(
      getValue(row, ["상품코드", "상품 코드", "바코드", "코드"])
    );
    const productName = String(
      getValue(row, ["상품명", "상품 명", "품목명", "품명"]) || ""
    ).trim();
    const partner = String(
      getValue(row, ["거래처명(구매조건명)", "거래처명", "협력사명", "협력사"]) || ""
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

const buildReservationRows = (reservationRows) =>
  (reservationRows || []).map((rawRow, index) => {
    const row = {};

    Object.keys(rawRow || {}).forEach((key) => {
      row[normalizeKey(key)] = rawRow[key];
    });

    const productCode = normalizeProductCode(
      getValue(row, ["상품코드", "상품 코드", "바코드", "코드"])
    );
    const productName = String(getValue(row, ["상품명", "상품 명", "품목명", "품명"]) || "").trim();
    const partner = String(getValue(row, ["협력사명", "협력사", "거래처명"]) || "").trim();
    const center = String(getValue(row, ["센터명", "센터"]) || "").trim();
    const qty = parseQty(getValue(row, ["발주수량", "수량"]));
    const incomingCost = parseQty(getValue(row, ["입고원가", "원가"]));

    return {
      ...row,
      __id: `reservation-${productCode || "empty"}-${center || "nocenter"}-${partner || "nopartner"}-${index}`,
      __index: index,
      __productCode: productCode,
      __productName: productName,
      __partner: partner,
      __center: center,
      __qty: qty,
      __incomingCost: incomingCost,
      __reservationRow: true,
      __productNameNormalized: normalizeText(productName),
      __partnerNormalized: normalizeText(partner),
    };
  });

const mergeRowsWithReservation = (baseRows, reservationRows) => {
  const mergedMap = new Map();

  (baseRows || []).forEach((row) => {
    const key = [row.__center || "", row.__partner || "", row.__productCode || ""].join("||");
    mergedMap.set(key, {
      ...row,
      __incomingCost: parseQty(row.__incomingCost || 0),
    });
  });

  (reservationRows || []).forEach((row) => {
    const key = [row.__center || "", row.__partner || "", row.__productCode || ""].join("||");
    const existing = mergedMap.get(key);

    if (existing) {
      mergedMap.set(key, {
        ...existing,
        ...row,
        __id: existing.__id,
        __index: existing.__index,
        __qty: parseQty(existing.__qty) + parseQty(row.__qty),
        __incomingCost: parseQty(row.__incomingCost || existing.__incomingCost || 0),
      });
      return;
    }

    mergedMap.set(key, {
      ...row,
      __incomingCost: parseQty(row.__incomingCost || 0),
    });
  });

  return Array.from(mergedMap.values());
};

const mergeJobRowsWithReservation = (jobRows, reservationRows) =>
  mergeRowsWithReservation(
    (jobRows || []).filter((row) => !row.__reservationRow),
    reservationRows
  );

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
        productCode: row.__productCode,
        productName: row.__productName,
        center: row.__center,
        partner: row.__partner,
        qty: row.__qty,
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
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        imageBase64: base64,
      });
    };
    reader.onerror = () => reject(new Error("사진 읽기 실패"));
    reader.readAsDataURL(file);
  });

const filesToBase64 = async (files) => {
  const list = Array.isArray(files) ? files : [];
  const results = [];

  for (const file of list) {
    const encoded = await fileToBase64(file);
    if (encoded) {
      results.push(encoded);
    }
  }

  return results;
};

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ko-KR");
};

const formatDashboardValue = (label, value) => {
  if (value == null || value === "") return "-";
  if (String(label).includes("율") || String(label).includes("률") || String(label).includes("커버리지")) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : String(value);
  }
  if (typeof value === "number") {
    return value.toLocaleString("ko-KR");
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== "") {
    return numeric.toLocaleString("ko-KR");
  }
  return String(value);
};

void formatDashboardValue;

const getRecordType = (record) => {
  const type = String(record.처리유형 || "").trim();
  if (type) return type;
  if (parseQty(record.회송수량) > 0) return "회송";
  if (parseQty(record.교환수량) > 0) return "교환";
  return "기타";
};

const getRecordQtyText = (record) => {
  const type = getRecordType(record);
  if (type === "회송" || type === "RETURN") return `${parseQty(record.회송수량)}개`;
  if (type === "교환" || type === "EXCHANGE") return `${parseQty(record.교환수량)}개`;

  const returnQty = parseQty(record.회송수량);
  const exchangeQty = parseQty(record.교환수량);
  if (returnQty > 0 && exchangeQty > 0) {
    return `회송 ${returnQty}개 / 교환 ${exchangeQty}개`;
  }
  return `${Math.max(returnQty, exchangeQty, 0)}개`;
};

const formatDateForFileName = () => new Date().toLocaleDateString("sv-SE");

const base64ToBlob = (base64, mimeType = "application/octet-stream") => {
  const binary = window.atob(String(base64 || ""));
  const chunkSize = 1024;
  const bytes = [];

  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const array = new Uint8Array(slice.length);

    for (let i = 0; i < slice.length; i += 1) {
      array[i] = slice.charCodeAt(i);
    }

    bytes.push(array);
  }

  return new Blob(bytes, { type: mimeType });
};

const extractImageFormulaUrl = (value) => {
  const text = String(value || "").trim();
  const match = text.match(/^=IMAGE\("(.+)"\)$/i);
  return match ? match[1] : text;
};

const extractGoogleDriveId = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";

  const directId = text.match(/^[a-zA-Z0-9_-]{20,}$/);
  if (directId) return directId[0];

  const fileMatch = text.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];

  const openMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];

  const ucMatch = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (ucMatch) return ucMatch[1];

  return "";
};

const buildPhotoCandidate = (rawValue) => {
  const normalized = extractImageFormulaUrl(rawValue);
  const text = String(normalized || "").trim();
  if (!text) return null;

  const driveId = extractGoogleDriveId(text);
  if (driveId) {
    return {
      key: driveId,
      previewUrl: `https://drive.google.com/thumbnail?id=${driveId}&sz=w1200`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${driveId}`,
    };
  }

  if (/^https?:\/\//i.test(text)) {
    return {
      key: text,
      previewUrl: text,
      downloadUrl: text,
    };
  }

  return null;
};

const splitPhotoSourceText = (value) =>
  String(value || "")
    .split(/\r?\n|[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const getPhotoCandidatesFromRecord = (record) => {
  const rawItems = [
    record?.사진URL,
    record?.사진링크,
    ...splitPhotoSourceText(record?.사진링크목록),
    ...splitPhotoSourceText(record?.사진파일ID목록),
  ];

  const seen = {};
  const candidates = [];

  rawItems.forEach((item) => {
    const candidate = buildPhotoCandidate(item);
    if (!candidate || seen[candidate.key]) return;
    seen[candidate.key] = true;
    candidates.push(candidate);
  });

  return candidates;
};

function HistoryPhotoItem({ candidate, index, onOpen, styles }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div style={styles.photoThumbEmpty}>미리보기 불가</div>;
  }

  return (
    <img
      src={candidate.previewUrl}
      alt={`첨부 사진 ${index + 1}`}
      style={styles.photoThumb}
      onClick={() => onOpen(candidate.previewUrl)}
      onError={() => setFailed(true)}
    />
  );
}

function HistoryPhotoPreview({ record, onOpen, styles }) {
  const candidates = useMemo(() => getPhotoCandidatesFromRecord(record), [record]);

  if (!candidates.length) {
    return <div style={styles.photoEmpty}>사진 없음</div>;
  }

  return (
    <div style={styles.photoGrid}>
      {candidates.map((candidate, index) => (
        <HistoryPhotoItem
          key={candidate.key || `${record.__rowNumber || "row"}-${index}`}
          candidate={candidate}
          index={index}
          onOpen={onOpen}
          styles={styles}
        />
      ))}
    </div>
  );
}

function App() {
  const [rows, setRows] = useState([]);
  const [currentJob, setCurrentJob] = useState(null);
  const [currentFileName, setCurrentFileName] = useState("");
  const [currentFileModifiedAt, setCurrentFileModifiedAt] = useState("");
  const [worksheetUrl, setWorksheetUrl] = useState("");
  const [mode, setMode] = useState("return");
  const [search, setSearch] = useState("");
  const [expandedProductCode, setExpandedProductCode] = useState("");
  const [expandedPartner, setExpandedPartner] = useState("");
  const [selectedCenterByProduct, setSelectedCenterByProduct] = useState({});
  const [drafts, setDrafts] = useState({});
  const [bootLoading, setBootLoading] = useState(true);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [deletingRowNumber, setDeletingRowNumber] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pendingMap, setPendingMap] = useState({});
  const [saving, setSaving] = useState(false);
  const [itemStatusMap, setItemStatusMap] = useState({});

  const [excludedProductCodes, setExcludedProductCodes] = useState(new Set());
  const [excludedPairKeys, setExcludedPairKeys] = useState(new Set());
  const [eventMap, setEventMap] = useState({});
  const [reservationRows, setReservationRows] = useState([]);
  const [, setDashboardSummary] = useState({});
  const [happycallAnalytics, setHappycallAnalytics] = useState({});

  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const [zoomPhotoUrl, setZoomPhotoUrl] = useState("");
  const [zipDownloading, setZipDownloading] = useState("");
  const [showAdminReset, setShowAdminReset] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminResetting, setAdminResetting] = useState(false);
  const [uploadingHappycallCsv, setUploadingHappycallCsv] = useState(false);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerStatus, setScannerStatus] = useState("카메라를 준비하고 있습니다...");
  const [scannerReady, setScannerReady] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const fileInputRef = useRef(null);
  const happycallFileInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const scannerVideoRef = useRef(null);
  const scannerControlsRef = useRef(null);
  const scannerTrackRef = useRef(null);
  const scannerStatusTimerRef = useRef(null);
  const pendingRef = useRef({});
  const savingRef = useRef(false);
  const flushTimerRef = useRef(null);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearFlushTimer(), [clearFlushTimer]);

  const makeEntityKey = (jobKey, productCode, partnerName) =>
    [jobKey || "", productCode || "", partnerName || ""].join("||");

  const makeMovementPendingKey = (movementType, jobKey, productCode, partnerName, centerName) =>
    [
      "movement",
      movementType || "",
      jobKey || "",
      productCode || "",
      partnerName || "",
      centerName || "",
    ].join("||");

  const setItemStatuses = (keys, status) => {
    if (!keys.length) return;
    setItemStatusMap((prev) => {
      const next = { ...prev };
      keys.forEach((key) => {
        next[key] = status;
      });
      return next;
    });
  };

  const removePendingKeys = (keys) => {
    if (!keys.length) return;
    setPendingMap((prev) => {
      const next = { ...prev };
      keys.forEach((key) => {
        delete next[key];
      });
      pendingRef.current = next;
      return next;
    });
  };

  const upsertPendingEntries = (entries) => {
    if (!entries.length) return;
    setPendingMap((prev) => {
      const next = { ...prev };
      entries.forEach((entry) => {
        const prevEntry = next[entry.key] || {};
        const merged = {
          ...prevEntry,
          ...entry,
        };

        if (entry.type === "inspection") {
          merged.회송수량 = prevEntry.회송수량 || 0;
          merged.교환수량 = prevEntry.교환수량 || 0;
          merged.센터명 = prevEntry.센터명 || merged.센터명 || "";
          merged.비고 = prevEntry.비고 || merged.비고 || "";
          merged.photoFiles =
            (Array.isArray(entry.photoFiles) && entry.photoFiles.length
              ? entry.photoFiles
              : prevEntry.photoFiles) || [];
        }

        if (entry.type === "return" || entry.type === "exchange") {
          merged.검품수량 = prevEntry.검품수량 || merged.검품수량 || 0;
        }

        if (entry.type === "movement") {
          merged.qty = parseQty(prevEntry.qty) + parseQty(entry.qty);
          merged.회송수량 = parseQty(prevEntry.회송수량) + parseQty(entry.회송수량);
          merged.교환수량 = parseQty(prevEntry.교환수량) + parseQty(entry.교환수량);
          merged.비고 = entry.비고 || prevEntry.비고 || "";
          merged.photoFiles = [
            ...(Array.isArray(prevEntry.photoFiles) ? prevEntry.photoFiles : []),
            ...(Array.isArray(entry.photoFiles) ? entry.photoFiles : []),
          ];
        }

        next[entry.key] = merged;
      });
      pendingRef.current = next;
      return next;
    });
    setItemStatuses(
      entries.map((entry) => entry.key),
      "pending"
    );
  };

  const stopScanner = useCallback(() => {
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
    scannerTrackRef.current = null;
    setScannerReady(false);
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  const closeScanner = useCallback(() => {
    stopScanner();
    setIsScannerOpen(false);
  }, [stopScanner]);

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
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (_) {
      setTorchSupported(false);
      setTorchOn(false);
    }
  };

  const startScanner = useCallback(async () => {
    try {
      setScannerError("");
      setScannerReady(false);
      setScannerStatus("카메라를 준비하고 있습니다...");

      const reader = new BrowserMultiFormatReader();
      const devices = await BrowserCodeReader.listVideoInputDevices();
      const backCamera =
        devices.find((device) => /back|rear|environment/i.test(String(device.label || ""))) || devices[0];

      const callback = (result, err, controls) => {
        if (controls) {
          scannerControlsRef.current = controls;

          try {
            const stream = scannerVideoRef.current?.srcObject;
            const track = stream?.getVideoTracks?.()?.[0] || null;
            scannerTrackRef.current = track || scannerTrackRef.current;

            const capabilities =
              track && typeof track.getCapabilities === "function"
                ? track.getCapabilities()
                : null;

            if (capabilities && "torch" in capabilities) {
              setTorchSupported(true);
            }
          } catch (_) {}
        }

        if (result) {
          const scanned = String(
            typeof result.getText === "function" ? result.getText() : result.text || result
          )
            .replace(/\s+/g, "")
            .trim();

          if (scanned) {
            if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
              navigator.vibrate(100);
            }
            setSearch(scanned);
            closeScanner();
          }
          return;
        }

        if (!err || err.name === "NotFoundException") {
          setScannerReady((prev) => prev || true);
          return;
        }

        return;
      };

      if (backCamera?.deviceId) {
        scannerControlsRef.current = await reader.decodeFromVideoDevice(
          backCamera.deviceId,
          scannerVideoRef.current,
          callback
        );
      } else {
        scannerControlsRef.current = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          scannerVideoRef.current,
          callback
        );
      }

      scannerStatusTimerRef.current = setInterval(() => {
        setScannerStatus((prev) =>
          prev === "바코드 인식 중..."
            ? "바코드를 화면 중앙에 맞춰주세요."
            : "바코드 인식 중..."
        );
      }, 2200);

      setScannerStatus("바코드 인식 중...");
    } catch (err) {
      setScannerError(err.message || "카메라를 시작할 수 없습니다.");
      setScannerStatus("카메라를 사용할 수 없습니다.");
      stopScanner();
    }
  }, [closeScanner, stopScanner]);
  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
  
    try {
      setUploadingCsv(true);
      setError("");
      setMessage("");
  
      const { text } = await decodeCsvFile(file);
  
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
      });
  
      const normalized = buildNormalizedRows(parsed.data);
      const mergedRows = mergeRowsWithReservation(normalized, reservationRows);
      const jobKey = computeJobKey(normalized);

      const response = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "cacheCsv",
          payload: {
            job_key: jobKey,
            source_file_name: file.name,
            source_file_modified: new Date(file.lastModified).toISOString(),
            parsed_rows: normalized,
          },
        }),
      });

      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "CSV 캐시 저장 실패");
      }

      const nextJob = result.job || {
        job_key: jobKey,
        rows: normalized,
        source_file_name: file.name,
        source_file_modified: new Date(file.lastModified).toISOString(),
      };

      setRows(Array.isArray(nextJob.rows) ? mergeJobRowsWithReservation(nextJob.rows, reservationRows) : mergedRows);
      setCurrentJob(nextJob);
      setCurrentFileName(file.name);
      setCurrentFileModifiedAt(new Date(file.lastModified).toISOString());
      setDashboardSummary(result.summary || {});
  
      setMessage("CSV 업로드 완료");
    } catch (err) {
      setError(err.message || "CSV 처리 실패");
    } finally {
      setUploadingCsv(false);
      if (e.target) {
        e.target.value = "";
      }
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
  }, [isScannerOpen, startScanner, stopScanner]);

  const loadBootstrap = useCallback(async () => {
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

      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "초기 데이터를 불러오지 못했습니다.");
      }

      const data = result.data || {};
      const config = data.config || {};
      const job = data.current_job || null;
      setWorksheetUrl(data.worksheet_url || "");
      const normalizedReservationRows = buildReservationRows(config.reservation_rows || []);

      const nextExcludedProductCodes = new Set();
      const nextExcludedPairKeys = new Set();

      (config.exclude_rows || []).forEach((row) => {
        const productCode = normalizeProductCode(
          getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])
        );
        const partner = String(getValue(row, ["협력사", "협력사명"]) || "").trim();
        const useFlag = getValue(row, ["사용여부"]);

        if (!isTruthyUsage(useFlag)) return;
        if (!productCode) return;

        if (partner) {
          nextExcludedPairKeys.add(`${productCode}||${partner}`);
        } else {
          nextExcludedProductCodes.add(productCode);
        }
      });

      const nextEventMap = {};
      (config.event_rows || []).forEach((row) => {
        const productCode = normalizeProductCode(
          getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])
        );
        const eventName = String(getValue(row, ["행사명"]) || "").trim();
        const useFlag = getValue(row, ["사용여부"]);

        if (!productCode) return;
        if (isExplicitFalseUsage(useFlag)) return;

        nextEventMap[productCode] = {
          행사여부: "행사",
          행사명: eventName,
        };
      });

      setExcludedProductCodes(nextExcludedProductCodes);
      setExcludedPairKeys(nextExcludedPairKeys);
      setEventMap(nextEventMap);
      setReservationRows(normalizedReservationRows);
      setCurrentJob(job);
      setRows(Array.isArray(job?.rows) ? mergeJobRowsWithReservation(job.rows, normalizedReservationRows) : []);
      setCurrentFileName(job?.source_file_name || "");
      setCurrentFileModifiedAt(job?.source_file_modified || "");
      setDashboardSummary(data.summary || {});
      setHappycallAnalytics(data.happycall || {});
      setMessage(job ? "최근 작업을 불러왔습니다." : "CSV를 업로드해 주세요.");
    } catch (err) {
      setError(err.message || "초기 데이터를 불러오지 못했습니다.");
    } finally {
      setBootLoading(false);
    }
  }, []);

  const fetchHistoryRowsData = useCallback(async () => {
    const response = await fetch(`${SCRIPT_URL}?action=getRecords`);
    const result = await response.json();

    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "내역 불러오기 실패");
    }

    return (Array.isArray(result.records) ? result.records : []).sort((a, b) =>
      String(b.작성일시 || "").localeCompare(String(a.작성일시 || ""), "ko")
    );
  }, []);

  const loadHistoryRows = useCallback(async () => {
    try {
      setHistoryLoading(true);
      setError("");
      const nextRows = await fetchHistoryRowsData();
      setHistoryRows(nextRows);
      return nextRows;
    } catch (err) {
      setError(err.message || "내역을 불러오지 못했습니다.");
      setHistoryRows([]);
      return [];
    } finally {
      setHistoryLoading(false);
    }
  }, [fetchHistoryRowsData]);

  useEffect(() => {
    loadBootstrap();
    loadHistoryRows();
  }, [loadBootstrap, loadHistoryRows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const code = normalizeProductCode(row.__productCode);
      const partner = String(row.__partner || "").trim();

      if (!code) return false;
      if (excludedProductCodes.has(code)) return false;
      if (excludedPairKeys.has(`${code}||${partner}`)) return false;

      return true;
    });
  }, [rows, excludedProductCodes, excludedPairKeys]);

  const groupedPartners = useMemo(() => {
    const keyword = normalizeText(search);
    const map = new Map();

    filteredRows.forEach((row) => {
      const productCode = row.__productCode;
      const productName = row.__productName || "상품명 없음";
      const partner = row.__partner || "협력사 없음";
      const center = row.__center || "센터 없음";
      const qty = row.__qty || 0;

      const matched =
        !keyword ||
        normalizeText(productName).includes(keyword) ||
        normalizeText(partner).includes(keyword) ||
        String(productCode || "").includes(search.trim());

      if (!matched) return;

      if (!map.has(partner)) {
        map.set(partner, []);
      }

      const partnerProducts = map.get(partner);
      let product = partnerProducts.find((item) => item.productCode === productCode);

      if (!product) {
        product = {
          productCode,
          productName,
          partner,
          totalQty: 0,
          centers: [],
          eventInfo: eventMap[productCode] || null,
          happycallMetrics: getHappycallProductMetrics(happycallAnalytics, {
            productCode,
            productName,
            partner,
          }),
        };
        partnerProducts.push(product);
      }

      product.totalQty += qty;

      let centerInfo = product.centers.find((item) => item.center === center);
      if (!centerInfo) {
        centerInfo = {
          center,
          totalQty: 0,
          rows: [],
        };
        product.centers.push(centerInfo);
      }

      centerInfo.totalQty += qty;
      centerInfo.rows.push(row);
    });

    const allProducts = Array.from(map.values()).flat();
    const rankMaps = {
      "1d": {},
      "7d": {},
      "30d": {},
    };

    Object.keys(rankMaps).forEach((periodKey) => {
      allProducts
        .filter((product) => parseQty(product.happycallMetrics?.[periodKey]?.count) > 0)
        .sort((a, b) => {
          const countDiff =
            parseQty(b.happycallMetrics?.[periodKey]?.count) - parseQty(a.happycallMetrics?.[periodKey]?.count);
          if (countDiff !== 0) return countDiff;
          return String(a.productName || "").localeCompare(String(b.productName || ""), "ko");
        })
        .slice(0, 5)
        .forEach((product, index) => {
          rankMaps[periodKey][`${product.partner}||${product.productCode}`] = {
            rank: index + 1,
            count: parseQty(product.happycallMetrics?.[periodKey]?.count),
            share: Number(product.happycallMetrics?.[periodKey]?.share || 0),
          };
        });
    });

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([partner, products]) => ({
        partner,
        products: products.map((product) => ({
          ...product,
          happycallStats: {
            "1d": rankMaps["1d"][`${product.partner}||${product.productCode}`] || null,
            "7d": rankMaps["7d"][`${product.partner}||${product.productCode}`] || null,
            "30d": rankMaps["30d"][`${product.partner}||${product.productCode}`] || null,
          },
          centers: product.centers.sort((a, b) => (b.totalQty || 0) - (a.totalQty || 0)),
        })),
      }));
  }, [filteredRows, search, eventMap, happycallAnalytics]);

  const historyCountMap = useMemo(() => {
    const map = {};

    (historyRows || []).forEach((record) => {
      const key = `${record.협력사명 || ""}||${record.상품코드 || ""}`;
      if (!map[key]) {
        map[key] = { returnCount: 0, exchangeCount: 0 };
      }

      if (parseQty(record.회송수량) > 0) {
        map[key].returnCount += 1;
      }

      if (parseQty(record.교환수량) > 0) {
        map[key].exchangeCount += 1;
      }
    });

    return map;
  }, [historyRows]);

  const previousDayHappycallTopList = useMemo(
    () =>
      (happycallAnalytics?.periods?.["1d"]?.topProducts || [])
        .slice(0, 10)
        .map((item, index) => ({
          rank: index + 1,
          productName: item?.productName || "-",
          count: parseQty(item?.count || 0),
          share: Number(item?.share || 0),
        })),
    [happycallAnalytics]
  );

  const updateDraft = (key, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value,
      },
    }));
  };

  const cancelMovementEventByRow = async (rowNumber) => {
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "cancelMovementEvent",
        payload: { rowNumber },
      }),
    });

    const result = await response.json();
    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "내역 삭제 실패");
    }
  };

  const flushPending = useCallback(async () => {
    const rows = Object.values(pendingRef.current || {});
    if (!rows.length || savingRef.current) return;

    const targetKeys = rows.map((row) => row.key);

    clearFlushTimer();
    savingRef.current = true;
    setSaving(true);
    setItemStatuses(targetKeys, "saving");

    try {
      const requestRows = [];

      for (const row of rows) {
        const { key, photoFile, photoFiles, ...rest } = row;
        let photosPayload = [];

        if (Array.isArray(photoFiles) && photoFiles.length) {
          photosPayload = await filesToBase64(photoFiles);
        } else if (photoFile) {
          const singlePhoto = await fileToBase64(photoFile);
          photosPayload = singlePhoto ? [singlePhoto] : [];
        }

        requestRows.push({
          ...rest,
          사진들: photosPayload,
        });
      }

      const response = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "saveBatch",
          rows: requestRows,
        }),
      });

      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "배치 저장 실패");
      }

      removePendingKeys(targetKeys);
      setItemStatuses(targetKeys, "saved");

      if (Array.isArray(result.records)) {
        const nextRows = [...result.records].sort((a, b) =>
          String(b.작성일시 || "").localeCompare(String(a.작성일시 || ""), "ko")
        );
        setHistoryRows(nextRows);
      }

      if (result.summary) {
        setDashboardSummary(result.summary);
      }

      setToast("저장 완료");
    } catch (err) {
      setItemStatuses(targetKeys, "failed");
      setError(err.message || "배치 저장 실패");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [clearFlushTimer]);

  useEffect(() => {
    pendingRef.current = pendingMap;
  }, [pendingMap]);

  useEffect(() => {
    if (!Object.keys(pendingMap).length) {
      clearFlushTimer();
      return undefined;
    }

    if (saving) {
      return undefined;
    }

    if (Object.keys(pendingMap).length >= 5) {
      flushPending();
      return undefined;
    }

    clearFlushTimer();
    flushTimerRef.current = setTimeout(() => {
      flushPending();
    }, 2000);

    return () => clearFlushTimer();
  }, [pendingMap, saving, clearFlushTimer, flushPending]);

  const saveInspectionQtySimple = async (product) => {
    const draftKey = `inspection||${product.partner}||${product.productCode}`;
    const qty = parseQty(drafts[draftKey]?.inspectionQty);
    const photoFiles = Array.isArray(drafts[draftKey]?.photoFiles) ? drafts[draftKey].photoFiles : [];
    const entityKey = makeEntityKey(currentJob?.job_key, product.productCode, product.partner);

    if (qty <= 0) {
      setError("검품수량을 입력해 주세요.");
      return;
    }

    setError("");
    setMessage("");
    upsertPendingEntries([
      {
        key: entityKey,
        type: "inspection",
        작업기준일또는CSV식별값: currentJob?.job_key || "",
        작성일시: new Date().toISOString(),
        상품코드: product.productCode,
        상품명: product.productName,
        협력사명: product.partner,
        전체발주수량: product.totalQty || 0,
        발주수량: product.totalQty || 0,
        검품수량: qty,
        회송수량: pendingMap[entityKey]?.회송수량 || 0,
        교환수량: pendingMap[entityKey]?.교환수량 || 0,
        센터명: pendingMap[entityKey]?.센터명 || "",
        비고: pendingMap[entityKey]?.비고 || "",
        행사여부: product.eventInfo?.행사여부 || "",
        행사명: product.eventInfo?.행사명 || "",
        photoFiles: photoFiles.length ? photoFiles : pendingMap[entityKey]?.photoFiles || [],
      },
    ]);
    setToast("저장되었습니다.");
  };

  const saveReturnExchange = async (product, centerName) => {
    const centerInfo = product.centers.find((item) => item.center === centerName);
    if (!centerInfo) {
      setError("센터를 선택해 주세요.");
      return;
    }

    const draftKey = `return||${product.partner}||${product.productCode}||${centerName}`;
    const draft = drafts[draftKey] || {};
    const returnQty = parseQty(draft.returnQty);
    const exchangeQty = parseQty(draft.exchangeQty);
    const memo = String(draft.memo || "").trim();
    const photoFiles = Array.isArray(draft.photoFiles) ? draft.photoFiles : [];

    if (!currentJob?.job_key) {
      setError("저장 가능한 작업 기준 CSV가 없습니다.");
      return;
    }

    if (returnQty <= 0 && exchangeQty <= 0 && !memo && photoFiles.length === 0) {
      setError("회송수량, 교환수량, 비고, 사진 중 하나 이상 입력해 주세요.");
      return;
    }

    setError("");
    setMessage("");

    const movementEntries = [];

    if (returnQty > 0) {
      movementEntries.push({
        key: makeMovementPendingKey(
          "RETURN",
          currentJob?.job_key,
          product.productCode,
          product.partner,
          centerName
        ),
        type: "movement",
        movementType: "RETURN",
        작업기준일또는CSV식별값: currentJob?.job_key || "",
        작성일시: new Date().toISOString(),
        상품명: product.productName,
        상품코드: product.productCode,
        센터명: centerName,
        협력사명: product.partner,
        발주수량: centerInfo.totalQty || 0,
        행사여부: product.eventInfo?.행사여부 || "",
        행사명: product.eventInfo?.행사명 || "",
        처리유형: "회송",
        회송수량: returnQty,
        교환수량: 0,
        qty: returnQty,
        비고: memo,
        photoFiles,
        전체발주수량: product.totalQty || 0,
      });
    }

    if (exchangeQty > 0) {
      movementEntries.push({
        key: makeMovementPendingKey(
          "EXCHANGE",
          currentJob?.job_key,
          product.productCode,
          product.partner,
          ""
        ),
        type: "movement",
        movementType: "EXCHANGE",
        작업기준일또는CSV식별값: currentJob?.job_key || "",
        작성일시: new Date().toISOString(),
        상품명: product.productName,
        상품코드: product.productCode,
        센터명: "",
        협력사명: product.partner,
        발주수량: product.totalQty || 0,
        행사여부: product.eventInfo?.행사여부 || "",
        행사명: product.eventInfo?.행사명 || "",
        처리유형: "교환",
        회송수량: 0,
        교환수량: exchangeQty,
        qty: exchangeQty,
        비고: memo,
        photoFiles,
        전체발주수량: product.totalQty || 0,
      });
    }

    upsertPendingEntries(movementEntries);
    setDrafts((prev) => ({
      ...prev,
      [draftKey]: {
        returnQty: "",
        exchangeQty: "",
        memo: "",
        photoFiles: [],
        photoNames: [],
      },
    }));
    setToast("저장되었습니다.");
  };

  const deleteHistoryRecord = async (record) => {
    const rowNumber = Number(record.__rowNumber || 0);
    if (!rowNumber) {
      setError("삭제할 행 정보를 찾지 못했습니다.");
      return;
    }

    const ok = window.confirm("이 내역을 삭제할까요?");
    if (!ok) return;

    try {
      setDeletingRowNumber(rowNumber);
      await cancelMovementEventByRow(rowNumber);
      setHistoryRows((prev) => prev.filter((item) => Number(item.__rowNumber) !== rowNumber));
      setToast("삭제 완료");
    } catch (err) {
      setError(err.message || "내역 삭제 실패");
    } finally {
      setDeletingRowNumber(null);
    }
  };

  const downloadPhotoZip = async (mode) => {
    try {
      setZipDownloading(mode);
      setError("");
      setMessage("");

      const response = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "downloadPhotoZip",
          payload: { mode },
        }),
      });

      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "ZIP 다운로드 실패");
      }

      if (!result.zipBase64) {
        setToast("다운로드 가능한 사진이 없습니다.");
        return;
      }

      const blob = base64ToBlob(result.zipBase64, result.mimeType || "application/zip");
      const link = document.createElement("a");
      const href = URL.createObjectURL(blob);
      const fileName = result.fileName ||
        (mode === "movement"
          ? `회송_교환_사진_${formatDateForFileName()}.zip`
          : mode === "inspection"
          ? `검품사진_${formatDateForFileName()}.zip`
          : `참고사진_${formatDateForFileName()}.zip`);

      link.href = href;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setToast("ZIP 다운로드 완료");
    } catch (err) {
      setError(err.message || "ZIP 다운로드 실패");
    } finally {
      setZipDownloading("");
    }
  };

  const resetCurrentJobInputs = async () => {
    if (!currentJob?.job_key) {
      setError("초기화할 현재 작업이 없습니다.");
      return;
    }

    if (!adminPassword.trim()) {
      setError("관리자 비밀번호를 입력해 주세요.");
      return;
    }

    try {
      setAdminResetting(true);
      setError("");
      setMessage("");

      const response = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "resetCurrentJobInputData",
          payload: {
            jobKey: currentJob.job_key,
            password: adminPassword.trim(),
          },
        }),
      });

      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "초기화 실패");
      }

      clearFlushTimer();
      savingRef.current = false;
      pendingRef.current = {};
      setSaving(false);
      setPendingMap({});
      setItemStatusMap({});
      setDrafts({});
      setHistoryRows(Array.isArray(result.records) ? result.records : []);
      setShowAdminReset(false);
      setAdminPassword("");
      await loadBootstrap();
      if (result.summary) {
        setDashboardSummary(result.summary);
      }
      setToast("현재 작업 입력 데이터 초기화 완료");
    } catch (err) {
      setError(err.message || "초기화 실패");
    } finally {
      setAdminResetting(false);
    }
  };

  const handleHappycallCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadingHappycallCsv(true);
      setError("");
      setMessage("");

      const { text } = await decodeCsvFile(file);
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
      });

      const rawRows = (Array.isArray(parsed.data) ? parsed.data : [])
        .map((row) => ({
          제목: row["제목"] || row["subject"] || "",
          본문: row["본문"] || row["body"] || "",
          메일ID: row["인터넷 메시지 ID"] || row["메일ID"] || "",
          보낸사람: row["보낸사람:(이름)"] || row["senderName"] || "",
        }))
        .filter((row) => String(row.제목 || "").trim() || String(row.본문 || "").trim());

      const dedupedMap = new Map();
      rawRows.forEach((row) => {
        const dedupeKey = [
          String(row.메일ID || "").trim(),
          String(row.제목 || "").trim(),
          String(row.본문 || "").trim(),
        ].join("||");
        dedupedMap.set(dedupeKey, row);
      });

      const rows = Array.from(dedupedMap.values());
      const skippedCount = Math.max(0, rawRows.length - rows.length);

      if (!rows.length) {
        throw new Error("해피콜 CSV에서 가져올 수 있는 행이 없습니다.");
      }

      const batchSize = rows.length >= 1500 ? 500 : 300;
      const totalBatches = Math.ceil(rows.length / batchSize);
      let lastResult = null;
      let insertedTotal = 0;
      let updatedTotal = 0;

      for (let index = 0; index < rows.length; index += batchSize) {
        const batchRows = rows.slice(index, index + batchSize);
        const batchNumber = Math.floor(index / batchSize) + 1;
        const processedCount = Math.min(index + batchRows.length, rows.length);
        setMessage(
          `해피콜 CSV 처리 중... ${batchNumber}/${totalBatches} 배치 (${processedCount} / ${rows.length})`
        );

        const response = await fetch(SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            action: "importHappycallCsv",
            rows: batchRows,
          }),
        });

        const result = await response.json();
        if (!response.ok || result.ok === false) {
          throw new Error(
            result.message || `해피콜 CSV 가져오기에 실패했습니다. (${batchNumber}/${totalBatches} 배치)`
          );
        }

        lastResult = result;
        insertedTotal += Number(result?.data?.inserted || 0);
        updatedTotal += Number(result?.data?.updated || 0);
      }

      setHappycallAnalytics(lastResult?.happycall || {});
      setMessage("");
      setToast(
        `해피콜 CSV 반영 완료 · 신규 ${insertedTotal}건 · 갱신 ${updatedTotal}건${
          skippedCount > 0 ? ` · 중복 제외 ${skippedCount}건` : ""
        }`
      );
    } catch (err) {
      setError(
        `${err.message || "해피콜 CSV 가져오기에 실패했습니다."} 같은 CSV를 다시 올리면 이어서 반영됩니다.`
      );
    } finally {
      setUploadingHappycallCsv(false);
      if (e.target) {
        e.target.value = "";
      }
    }
  };

  return (
    <div style={styles.app}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleCsvUpload}
        style={styles.hiddenInput}
      />
      <input
        ref={happycallFileInputRef}
        type="file"
        accept=".csv"
        onChange={handleHappycallCsvUpload}
        style={styles.hiddenInput}
      />

      <div style={styles.headerCard}>
        <div style={styles.headerTopRow}>
          <div>
            <h1 style={styles.title}>GS신선강화지원팀</h1>
            <div style={styles.headerLinkRow}>
              <a href={worksheetUrl || "#"} target="_blank" rel="noreferrer" style={styles.headerLink}>
                {worksheetUrl || "워크시트 URL 없음"}
              </a>
              <button
                type="button"
                onClick={async () => {
                  if (!worksheetUrl) return;
                  try {
                    await navigator.clipboard.writeText(worksheetUrl);
                    setToast("워크시트 링크 복사 완료");
                  } catch (_) {
                    setError("워크시트 링크 복사 실패");
                  }
                }}
                style={styles.copyButton}
              >
                복사
              </button>
            </div>
          </div>
          <div style={styles.headerModeBadge}>{mode === "inspection" ? "검품 모드" : "회송/교환 모드"}</div>
        </div>
        <div style={styles.quickActionGrid}>
          <button
            type="button"
            onClick={() => setMode("inspection")}
            style={{ ...styles.quickActionCard, ...(mode === "inspection" ? styles.quickActionCardActive : {}) }}
          >
            <span style={styles.quickActionIcon}>🔎</span>
            <span style={styles.quickActionText}>검품</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("return")}
            style={{ ...styles.quickActionCard, ...(mode === "return" ? styles.quickActionCardActive : {}) }}
          >
            <span style={styles.quickActionIcon}>📦</span>
            <span style={styles.quickActionText}>회송</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              setShowHistory(true);
              await loadHistoryRows();
            }}
            style={styles.quickActionCard}
          >
            <span style={styles.quickActionIcon}>📄</span>
            <span style={styles.quickActionText}>내역</span>
          </button>
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.csvHeaderRow}>
          <div>
            <div style={styles.sectionTitle}>CSV 업로드</div>
            <div style={styles.metaText}>
              현재 작업: {currentFileName || "업로드된 파일 없음"}
            </div>
            <div style={styles.metaText}>
              파일 수정일자: {currentFileModifiedAt ? formatDateTime(currentFileModifiedAt) : "-"}
            </div>
          </div>
          <div style={styles.csvActionRow}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={styles.primaryButton}
            >
              {uploadingCsv ? "처리 중..." : "검품 CSV 선택"}
            </button>
            <button
              type="button"
              onClick={() => happycallFileInputRef.current?.click()}
              disabled={uploadingHappycallCsv}
              style={{
                ...styles.secondaryButton,
                opacity: uploadingHappycallCsv ? 0.7 : 1,
              }}
            >
              {uploadingHappycallCsv ? "처리 중..." : "해피콜 CSV 선택"}
            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                setAdminPassword("");
                setShowAdminReset(true);
              }}
              style={styles.secondaryButton}
            >
              관리자 초기화
            </button>
          </div>
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.searchRow}>
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품명 / 상품코드 / 협력사 검색"
            style={styles.searchInput}
          />
          <button type="button" onClick={() => setIsScannerOpen(true)} style={styles.scanButton} aria-label="바코드 스캔">
            <span style={styles.scanIcon}>스캔</span>
          </button>
        </div>
      </div>

      {(bootLoading || uploadingCsv || error || message) && (
        <div style={error ? styles.errorBox : styles.infoBox}>
          {bootLoading
            ? "초기 데이터를 불러오는 중..."
            : uploadingCsv
            ? "CSV 처리 중..."
            : error || message}
        </div>
      )}

      <div style={styles.panel}>
        <div style={styles.happycallHeader}>
          <div>
            <div style={styles.sectionTitle}>전일 해피콜 최다 TOP10</div>
            <div style={styles.metaText}>전일 접수 해피콜 기준</div>
          </div>
        </div>

        {previousDayHappycallTopList.length === 0 ? (
          <div style={styles.emptyBox}>전일 해피콜 데이터가 없습니다.</div>
        ) : (
          <div style={styles.kpiGrid}>
            {previousDayHappycallTopList.map((card) => (
              <div
                key={`happycall-top-${card.rank}`}
                style={{
                  ...styles.kpiCard,
                  borderColor:
                    card.rank === 1 ? "#fca5a5" : card.rank === 2 ? "#93c5fd" : card.rank === 3 ? "#86efac" : "#e5e7eb",
                }}
              >
                <div style={styles.topRankRow}>
                  {getTopMedal(card.rank) ? (
                    <span style={styles.topMedal}>{getTopMedal(card.rank)}</span>
                  ) : (
                    <span style={styles.topMedalPlaceholder} />
                  )}
                  <div
                    style={{
                      ...styles.kpiLabel,
                      marginBottom: 0,
                      fontWeight: 900,
                      color:
                        card.rank === 1 ? "#b91c1c" : card.rank === 2 ? "#1d4ed8" : card.rank === 3 ? "#15803d" : "#64748b",
                    }}
                  >
                    {`TOP.${card.rank}`}
                  </div>
                </div>
                <div
                  style={{
                    ...styles.kpiValue,
                    fontSize: 18,
                    fontWeight: 900,
                    color:
                      card.rank === 1 ? "#b91c1c" : card.rank === 2 ? "#1d4ed8" : card.rank === 3 ? "#15803d" : "#0f172a",
                  }}
                >
                  {card.productName}
                </div>
                <div style={styles.topCardMeta}>
                  {card.count.toLocaleString("ko-KR")}건 · {formatPercent(card.share)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.countRow}>
        <div style={styles.countText}>총 {groupedPartners.reduce((sum, item) => sum + item.products.length, 0)}건</div>
        <div style={styles.countActions}>
          <button
            type="button"
            onClick={() => downloadPhotoZip("movement")}
            style={styles.historyButton}
          >
            {zipDownloading === "movement" ? "ZIP 생성 중..." : "불량사진 저장"}
          </button>
          <button
            type="button"
            onClick={() => downloadPhotoZip("inspection")}
            style={styles.historyButton}
          >
            {zipDownloading === "inspection" ? "ZIP 생성 중..." : "검품사진 저장"}
          </button>
          <button
            type="button"
            onClick={() => downloadPhotoZip("photoOnly")}
            style={styles.historyButton}
          >
            {zipDownloading === "photoOnly" ? "ZIP 생성 중..." : "참고사진 저장"}
          </button>
        </div>
      </div>

      <div style={styles.list}>
        {groupedPartners.length === 0 ? (
          <div style={styles.emptyBox}>표시할 상품이 없습니다.</div>
        ) : (
          groupedPartners.map((partnerGroup) => (
            <div key={partnerGroup.partner} style={styles.partnerGroup}>
              <button
                type="button"
                style={styles.partnerHeader}
                onClick={() =>
                  setExpandedPartner((prev) => (prev === partnerGroup.partner ? "" : partnerGroup.partner))
                }
              >
                <div style={styles.partnerTitle}>{partnerGroup.partner}</div>
                <div style={styles.partnerCount}>{partnerGroup.products.length}건</div>
              </button>

              {expandedPartner === partnerGroup.partner && (
                <div style={styles.partnerBody}>
                  {partnerGroup.products.map((product) => {
                    const productStateKey = `${product.partner}||${product.productCode}`;
                    const historyCounts = historyCountMap[`${product.partner}||${product.productCode}`] || {
                      returnCount: 0,
                      exchangeCount: 0,
                    };
                    const historySummary = [
                      historyCounts.returnCount > 0 ? `회송 ${historyCounts.returnCount}` : "",
                      historyCounts.exchangeCount > 0 ? `교환 ${historyCounts.exchangeCount}` : "",
                    ]
                      .filter(Boolean)
                      .join(" / ");
                    const isOpen = expandedProductCode === productStateKey;
                    const selectedCenter =
                      selectedCenterByProduct[productStateKey] || product.centers[0]?.center || "";
                    const selectedCenterInfo =
                      product.centers.find((item) => item.center === selectedCenter) || null;

                    const draftKey =
                      mode === "inspection"
                        ? `inspection||${product.partner}||${product.productCode}`
                        : `return||${product.partner}||${product.productCode}||${selectedCenter}`;
                    const draft = drafts[draftKey] || {};
                    const entityKey = makeEntityKey(currentJob?.job_key, product.productCode, product.partner);
                    const inspectionStatus = itemStatusMap[entityKey];
                    const returnStatus = itemStatusMap[entityKey];
                    const exchangeStatus = itemStatusMap[entityKey];
                    const actionStatus = mode === "inspection"
                      ? inspectionStatus
                      : returnStatus || exchangeStatus;
                    const happycallBadges = [
                      ["1d", "전일"],
                      ["7d", "일주일"],
                      ["30d", "한달"],
                    ]
                      .map(([periodKey, label]) => {
                        const stats = product.happycallStats?.[periodKey];
                        if (!stats?.rank || stats.rank > 5) return null;
                        return {
                          key: periodKey,
                          rank: stats.rank,
                          label: `${label} 해피콜 TOP${stats.rank}`,
                        };
                      })
                      .filter(Boolean);

                    return (
                      <div key={`${partnerGroup.partner}-${product.productCode}`} style={styles.card}>
                        {mode === "inspection" ? (
                          <div style={styles.cardInlineInspection}>
                            <div style={styles.cardInlineInfo}>
                              <div style={styles.cardTopRowInline}>
                                {happycallBadges.length ? (
                                  <div style={styles.happycallBadgeRow}>
                                    {happycallBadges.map((badge) => (
                                      <span key={badge.key} style={{ ...styles.happycallBadge, ...getHappycallRankStyle(badge.rank) }}>
                                        {badge.label}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                <div style={styles.cardTitle}>{product.productName || "상품명 없음"}</div>
                                {product.eventInfo?.행사여부 ? (
                                  <span style={styles.eventBadge}>
                                    {product.eventInfo.행사명 || "행사"}
                                  </span>
                                ) : null}
                              </div>
                              <div style={styles.cardMeta}>코드 {product.productCode}</div>
                              <div style={styles.cardMeta}>협력사 {product.partner}</div>
                              <div style={styles.qtyRow}>
                                <span style={styles.qtyChip}>총 발주 {product.totalQty}개</span>
                                {historySummary ? <span style={styles.qtyChip}>{historySummary}</span> : null}
                              </div>
                            </div>

                            <div style={styles.inlineInspectionRow}>
                              <input
                                type="number"
                                min="0"
                                value={draft.inspectionQty || ""}
                                onChange={(e) => {
                                  const nextValue = e.target.value;
                                  updateDraft(draftKey, "inspectionQty", nextValue);

                                  const qty = parseQty(nextValue);
                                  if (qty > 0) {
                                    upsertPendingEntries([
                                      {
                                        key: entityKey,
                                        type: "inspection",
                                        작업기준일또는CSV식별값: currentJob?.job_key || "",
                                        작성일시: new Date().toISOString(),
                                        상품코드: product.productCode,
                                        상품명: product.productName,
                                        협력사명: product.partner,
                                        전체발주수량: product.totalQty || 0,
                                        발주수량: product.totalQty || 0,
                                        검품수량: qty,
                                        회송수량: 0,
                                        교환수량: 0,
                                      },
                                    ]);
                                  } else {
                                    removePendingKeys([entityKey]);
                                  }
                                }}
                                style={styles.inlineQtyInput}
                                placeholder="검품수량"
                              />
                            </div>
                            <div style={styles.formGroup}>
                              <label style={styles.label}>검품 사진</label>
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(e) => {
                                  const files = Array.from(e.target.files || []);
                                  updateDraft(draftKey, "photoFiles", files);
                                  updateDraft(
                                    draftKey,
                                    "photoNames",
                                    files.map((file) => file.name)
                                  );

                                  if (files.length) {
                                    upsertPendingEntries([
                                      {
                                        key: entityKey,
                                        type: "inspection",
                                        작업기준일또는CSV식별값: currentJob?.job_key || "",
                                        작성일시: new Date().toISOString(),
                                        상품코드: product.productCode,
                                        상품명: product.productName,
                                        협력사명: product.partner,
                                        전체발주수량: product.totalQty || 0,
                                        발주수량: product.totalQty || 0,
                                        검품수량: parseQty(draft.inspectionQty),
                                        회송수량: 0,
                                        교환수량: 0,
                                        photoFiles: files,
                                      },
                                    ]);
                                  }
                                }}
                                style={styles.fileInput}
                              />
                              <div style={styles.metaText}>
                                {Array.isArray(draft.photoNames) && draft.photoNames.length
                                  ? draft.photoNames.join(", ")
                                  : "선택된 사진 없음"}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => saveInspectionQtySimple(product)}
                              style={styles.saveButton}
                            >
                              {inspectionStatus === "saving" ? "저장중..." : "저장"}
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              style={styles.cardButton}
                              onClick={() => {
                                const nextKey = productStateKey;
                                setExpandedProductCode((prev) => (prev === nextKey ? "" : nextKey));
                                setSelectedCenterByProduct((prev) => ({
                                  ...prev,
                                  [productStateKey]:
                                    prev[productStateKey] || product.centers[0]?.center || "",
                                }));
                              }}
                            >
                              <div style={styles.cardTopRow}>
                                {happycallBadges.length ? (
                                  <div style={styles.happycallBadgeRow}>
                                    {happycallBadges.map((badge) => (
                                      <span key={badge.key} style={{ ...styles.happycallBadge, ...getHappycallRankStyle(badge.rank) }}>
                                        {badge.label}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                <div style={styles.cardTitle}>{product.productName || "상품명 없음"}</div>
                                {product.eventInfo?.행사여부 ? (
                                  <span style={styles.eventBadge}>
                                    {product.eventInfo.행사명 || "행사"}
                                  </span>
                                ) : null}
                              </div>
                              <div style={styles.cardMeta}>코드 {product.productCode}</div>
                              <div style={styles.cardMeta}>협력사 {product.partner}</div>
                              <div style={styles.qtyRow}>
                                <span style={styles.qtyChip}>총 발주 {product.totalQty}개</span>
                                {historySummary ? <span style={styles.qtyChip}>{historySummary}</span> : null}
                              </div>
                            </button>

                            {isOpen && (
                          <div style={styles.editorBox}>
                            <div style={styles.formGroup}>
                              <label style={styles.label}>센터 선택</label>
                              <select
                                value={selectedCenter}
                                onChange={(e) =>
                                  setSelectedCenterByProduct((prev) => ({
                                    ...prev,
                                    [productStateKey]: e.target.value,
                                  }))
                                }
                                style={styles.input}
                              >
                                {product.centers.map((center) => (
                                  <option key={center.center} value={center.center}>
                                    {center.center} / {center.totalQty}개
                                  </option>
                                ))}
                              </select>
                            </div>

                            {selectedCenterInfo && (
                              <div style={styles.detailBlock}>
                                <div style={styles.metaText}>
                                  선택 센터 발주수량: {selectedCenterInfo.totalQty}개
                                </div>
                                <div style={styles.metaText}>
                                  행사: {product.eventInfo?.행사여부 || ""}
                                  {product.eventInfo?.행사명 ? ` (${product.eventInfo.행사명})` : ""}
                                </div>
                              </div>
                            )}

                              <>
                                <div style={styles.grid2}>
                                  <div style={styles.formGroup}>
                                    <label style={styles.label}>회송수량</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={draft.returnQty || ""}
                                      onChange={(e) =>
                                        updateDraft(draftKey, "returnQty", e.target.value)
                                      }
                                      style={styles.input}
                                    />
                                  </div>
                                  <div style={styles.formGroup}>
                                    <label style={styles.label}>교환수량</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={draft.exchangeQty || ""}
                                      onChange={(e) =>
                                        updateDraft(draftKey, "exchangeQty", e.target.value)
                                      }
                                      style={styles.input}
                                    />
                                  </div>
                                </div>

                                <div style={styles.formGroup}>
                                  <label style={styles.label}>비고</label>
                                  <textarea
                                    value={draft.memo || ""}
                                    onChange={(e) => updateDraft(draftKey, "memo", e.target.value)}
                                    style={styles.textarea}
                                    rows={3}
                                    placeholder="불량 사유 / 전달 사항"
                                  />
                                </div>

                                <div style={styles.formGroup}>
                                  <label style={styles.label}>사진 첨부</label>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={(e) => {
                                      const files = Array.from(e.target.files || []);
                                      updateDraft(draftKey, "photoFiles", files);
                                      updateDraft(
                                        draftKey,
                                        "photoNames",
                                        files.map((file) => file.name)
                                      );
                                    }}
                                    style={styles.fileInput}
                                  />
                                  <div style={styles.metaText}>
                                    {Array.isArray(draft.photoNames) && draft.photoNames.length
                                      ? draft.photoNames.join(", ")
                                      : "선택된 사진 없음"}
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => saveReturnExchange(product, selectedCenter)}
                                  style={styles.saveButton}
                                >
                                  {actionStatus === "saving" ? "저장중..." : "저장"}
                                </button>
                              </>
                          </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showHistory && (
        <div style={styles.sheetOverlay} onClick={() => setShowHistory(false)}>
          <div style={styles.bottomSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} />
            <div style={styles.sheetHeader}>
              <h2 style={styles.sheetTitle}>저장 내역</h2>
              <button type="button" onClick={() => setShowHistory(false)} style={styles.sheetClose}>
                닫기
              </button>
            </div>

            {historyLoading ? (
              <div style={styles.infoBox}>내역 불러오는 중...</div>
            ) : historyRows.length === 0 ? (
              <div style={styles.emptyBox}>표시할 내역이 없습니다.</div>
            ) : (
              <div style={styles.sheetList}>
                {historyRows.map((record, index) => (
                  <div
                    key={`${record.__rowNumber || "row"}-${record.작성일시 || "time"}-${index}`}
                    style={styles.historyCard}
                  >
                    <button
                      type="button"
                      onClick={() => deleteHistoryRecord(record)}
                      style={styles.deleteBtn}
                      disabled={deletingRowNumber === Number(record.__rowNumber)}
                    >
                      {deletingRowNumber === Number(record.__rowNumber) ? "..." : "×"}
                    </button>

                    <div style={styles.cardTopRow}>
                      <div style={styles.cardTitle}>{record.상품명 || "상품명 없음"}</div>
                      <span style={styles.typeBadge}>{getRecordType(record)}</span>
                    </div>
                    <div style={styles.cardMeta}>코드 {record.상품코드 || "-"}</div>
                    <div style={styles.cardMeta}>센터 {record.센터명 || "-"}</div>
                    <div style={styles.cardMeta}>협력사 {record.협력사명 || "-"}</div>
                    <div style={styles.qtyRow}>
                      <span style={styles.qtyChip}>처리수량 {getRecordQtyText(record)}</span>
                      <span style={styles.qtyChip}>{formatDateTime(record.작성일시)}</span>
                    </div>
                    <div style={styles.historyMemo}>{record.비고 || "-"}</div>

                    <div style={styles.photoWrap}>
                      <HistoryPhotoPreview
                        record={record}
                        onOpen={(url) => setZoomPhotoUrl(url)}
                        styles={styles}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {zoomPhotoUrl && (
        <div style={styles.photoOverlay} onClick={() => setZoomPhotoUrl("")}>
          <img src={zoomPhotoUrl} alt="확대 사진" style={styles.photoZoom} />
        </div>
      )}

      {showAdminReset && (
        <div style={styles.sheetOverlay} onClick={() => !adminResetting && setShowAdminReset(false)}>
          <div style={styles.bottomSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} />
            <div style={styles.sheetHeader}>
              <h2 style={styles.sheetTitle}>관리자 초기화</h2>
              <button
                type="button"
                onClick={() => !adminResetting && setShowAdminReset(false)}
                style={styles.sheetClose}
              >
                닫기
              </button>
            </div>

            <div style={styles.infoBox}>
              현재 작업의 검품수량, 회송/교환 내역, 연결된 사진과 드라이브 원본까지 삭제됩니다.
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>관리자 비밀번호</label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                style={styles.input}
                placeholder="비밀번호 입력"
                disabled={adminResetting}
              />
            </div>

            <button
              type="button"
              onClick={resetCurrentJobInputs}
              disabled={adminResetting}
              style={{
                ...styles.saveButton,
                background: "#dc2626",
                marginTop: 4,
              }}
            >
              {adminResetting ? "초기화 중..." : "현재 작업 입력 데이터 초기화"}
            </button>
          </div>
        </div>
      )}

      {isScannerOpen && (
        <div style={styles.scannerOverlay} onClick={closeScanner}>
          <div style={styles.scannerModal} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={closeScanner} style={styles.scannerCloseBtn}>
              횞
            </button>

            <div style={styles.scannerTopText}>{scannerReady ? scannerStatus : "바코드 인식 중..."}</div>

            <div style={styles.scannerViewport}>
              <video ref={scannerVideoRef} style={styles.scannerVideo} muted playsInline />
              <div style={styles.scannerGuideBox} />
            </div>

            <div style={styles.scannerHelperText}>바코드를 화면 중앙에 맞춰주세요.</div>

            {scannerError ? <div style={styles.errorBox}>{scannerError}</div> : null}

            <div style={styles.scannerActions}>
              {torchSupported ? (
                <button type="button" onClick={toggleTorch} style={styles.secondaryButton}>
                  {torchOn ? "플래시 끄기" : "플래시 켜기"}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  closeScanner();
                  focusSearchInput();
                }}
                style={styles.primaryButton}
              >
                직접 입력
              </button>
            </div>
          </div>
        </div>
      )}

      {toast ? <div style={styles.toast}>{toast}</div> : null}
    </div>
  );
}

const styles = {
  app: {
    minHeight: "100vh",
    background: "#f4f6fb",
    padding: 14,
    color: "#1f2937",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    boxSizing: "border-box",
    maxWidth: 760,
    margin: "0 auto",
  },
  hiddenInput: {
    display: "none",
  },
  headerCard: {
    background: "#ffffff",
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    border: "1px solid #e5e7eb",
  },
  headerTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 800,
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 0,
    color: "#6b7280",
    fontSize: 14,
  },
  headerLinkRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    flexWrap: "wrap",
  },
  headerLink: {
    color: "#2563eb",
    fontSize: 13,
    textDecoration: "none",
    wordBreak: "break-all",
  },
  copyButton: {
    minHeight: 32,
    padding: "0 10px",
    borderRadius: 999,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#0f172a",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  },
  headerModeBadge: {
    background: "#e0e7ff",
    color: "#3730a3",
    borderRadius: 999,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 800,
    flexShrink: 0,
  },
  quickActionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10,
  },
  quickActionCard: {
    minHeight: 74,
    borderRadius: 16,
    border: "1px solid #dbe3f0",
    background: "#f8fafc",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    cursor: "pointer",
    color: "#0f172a",
    fontWeight: 800,
  },
  quickActionCardActive: {
    background: "#111827",
    color: "#fff",
    borderColor: "#111827",
  },
  quickActionIcon: {
    fontSize: 20,
    lineHeight: 1,
  },
  quickActionText: {
    fontSize: 13,
  },
  tabRow: {
    display: "flex",
    gap: 8,
    marginBottom: 12,
  },
  tabButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
  tabButtonActive: {
    background: "#111827",
    color: "#fff",
    borderColor: "#111827",
  },
  panel: {
    background: "#ffffff",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    border: "1px solid #e5e7eb",
  },
  happycallHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  happycallBadge: {
    borderRadius: 999,
    padding: "6px 10px",
    background: "#fee2e2",
    color: "#b91c1c",
    fontSize: 11,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  happycallBadgeRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  csvHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  csvActionRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 800,
    marginBottom: 4,
  },
  primaryButton: {
    minHeight: 48,
    padding: "0 16px",
    borderRadius: 14,
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
  },
  secondaryButton: {
    minHeight: 48,
    padding: "0 16px",
    borderRadius: 14,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
  },
  label: {
    display: "block",
    marginBottom: 8,
    fontSize: 13,
    fontWeight: 700,
  },
  input: {
    width: "100%",
    minHeight: 48,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #d1d5db",
    boxSizing: "border-box",
    fontSize: 16,
    background: "#fff",
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #d1d5db",
    boxSizing: "border-box",
    fontSize: 16,
    background: "#fff",
    minWidth: 0,
  },
  textarea: {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "1px solid #d1d5db",
    boxSizing: "border-box",
    fontSize: 16,
    resize: "vertical",
  },
  fileInput: {
    width: "100%",
    fontSize: 14,
    minHeight: 40,
  },
  searchRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  scanButton: {
    minWidth: 56,
    minHeight: 48,
    padding: 0,
    borderRadius: 12,
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    fontSize: 18,
    fontWeight: 800,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  scanIcon: {
    fontSize: 22,
    lineHeight: 1,
  },
  formGroup: {
    marginBottom: 12,
  },
  detailBlock: {
    marginBottom: 12,
  },
  metaText: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280",
    wordBreak: "break-all",
    lineHeight: 1.5,
  },
  infoBox: {
    padding: 12,
    borderRadius: 14,
    background: "#eff6ff",
    color: "#1d4ed8",
    marginBottom: 12,
    border: "1px solid #bfdbfe",
    fontSize: 14,
  },
  errorBox: {
    padding: 12,
    borderRadius: 14,
    background: "#fee2e2",
    color: "#b91c1c",
    marginBottom: 12,
    border: "1px solid #fecaca",
    fontSize: 14,
  },
  countRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
    paddingLeft: 4,
  },
  countText: {
    fontSize: 13,
    color: "#6b7280",
  },
  countActions: {
    display: "flex",
    gap: 8,
    flexWrap: "nowrap",
    justifyContent: "flex-end",
    overflowX: "auto",
    paddingBottom: 2,
    whiteSpace: "nowrap",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 10,
    marginBottom: 12,
  },
  kpiCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 4px 14px rgba(15,23,42,0.04)",
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#64748b",
    marginBottom: 8,
  },
  kpiValue: {
    fontSize: 22,
    lineHeight: 1.2,
    fontWeight: 800,
    color: "#0f172a",
    wordBreak: "break-word",
  },
  topRankRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  topMedal: {
    fontSize: 18,
    lineHeight: 1,
  },
  topMedalPlaceholder: {
    width: 18,
    height: 18,
    display: "inline-block",
  },
  topCardMeta: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: 700,
    color: "#64748b",
  },
  historyButton: {
    border: "1px solid #d1d5db",
    background: "#fff",
    borderRadius: 999,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    color: "#374151",
    minHeight: 40,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingBottom: 18,
  },
  partnerGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  partnerHeader: {
    border: "1px solid #dbe3f0",
    background: "#eef4ff",
    borderRadius: 16,
    padding: "14px 16px",
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    textAlign: "left",
  },
  partnerTitle: {
    fontSize: 16,
    fontWeight: 800,
  },
  partnerCount: {
    fontSize: 13,
    color: "#475569",
    fontWeight: 700,
  },
  partnerBody: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  card: {
    background: "#fff",
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    overflow: "hidden",
    boxShadow: "0 6px 20px rgba(15,23,42,0.04)",
  },
  cardButton: {
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "#fff",
    padding: 14,
    cursor: "pointer",
  },
  cardInlineInspection: {
    padding: 14,
  },
  cardInlineInfo: {
    marginBottom: 12,
  },
  inlineInspectionRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  inlineQtyInput: {
    flex: 1,
    minHeight: 42,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    fontSize: 15,
    minWidth: 0,
  },
  cardTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    paddingRight: 28,
  },
  cardTopRowInline: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: 800,
    lineHeight: 1.45,
  },
  cardMeta: {
    marginTop: 6,
    fontSize: 13,
    color: "#4b5563",
    lineHeight: 1.45,
  },
  qtyRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 10,
  },
  qtyChip: {
    background: "#f3f4f6",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    color: "#374151",
  },
  eventBadge: {
    display: "inline-block",
    background: "#dc2626",
    color: "#fff",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  typeBadge: {
    display: "inline-block",
    background: "#111827",
    color: "#fff",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  editorBox: {
    borderTop: "1px solid #e5e7eb",
    padding: 14,
    background: "#fafafa",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  saveButton: {
    width: "100%",
    minHeight: 50,
    border: "none",
    borderRadius: 14,
    padding: "14px 16px",
    background: "#2563eb",
    color: "#fff",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
    marginTop: 12,
  },
  emptyBox: {
    padding: 24,
    borderRadius: 16,
    border: "1px dashed #d1d5db",
    background: "#fff",
    color: "#6b7280",
    textAlign: "center",
  },
  sheetOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.32)",
    zIndex: 40,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  bottomSheet: {
    width: "100%",
    maxWidth: 760,
    maxHeight: "78vh",
    background: "#fff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: "10px 14px 20px",
    overflow: "auto",
    boxSizing: "border-box",
  },
  sheetHandle: {
    width: 54,
    height: 6,
    borderRadius: 999,
    background: "#d1d5db",
    margin: "0 auto 12px",
  },
  sheetHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  sheetTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 800,
  },
  sheetClose: {
    minHeight: 40,
    padding: "0 12px",
    border: "1px solid #d1d5db",
    borderRadius: 999,
    background: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  sheetList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingBottom: 12,
  },
  historyCard: {
    position: "relative",
    background: "#fff",
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    padding: 14,
  },
  deleteBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 999,
    border: "none",
    background: "#ef4444",
    color: "#fff",
    fontSize: 18,
    fontWeight: 700,
    lineHeight: "32px",
    cursor: "pointer",
  },
  historyMemo: {
    marginTop: 10,
    fontSize: 14,
    color: "#374151",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  photoWrap: {
    marginTop: 12,
  },
  photoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
    gap: 8,
  },
  photoEmpty: {
    border: "1px dashed #d1d5db",
    borderRadius: 14,
    background: "#f9fafb",
    color: "#6b7280",
    fontSize: 13,
    padding: "18px 12px",
    textAlign: "center",
  },
  photoThumb: {
    width: "100%",
    aspectRatio: "1 / 1",
    objectFit: "cover",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#fff",
    display: "block",
    cursor: "pointer",
  },
  photoThumbEmpty: {
    minHeight: 92,
    border: "1px dashed #d1d5db",
    borderRadius: 12,
    background: "#f9fafb",
    color: "#9ca3af",
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: 8,
  },
  photoPreview: {
    width: "100%",
    maxHeight: 220,
    objectFit: "cover",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#fff",
    display: "block",
    cursor: "pointer",
  },
  photoOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 70,
    background: "rgba(0,0,0,0.88)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  photoZoom: {
    maxWidth: "100%",
    maxHeight: "100%",
    borderRadius: 18,
  },
  scannerOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    background: "rgba(0,0,0,0.88)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  scannerModal: {
    width: "100%",
    maxWidth: 560,
    height: "100%",
    maxHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    position: "relative",
    color: "#fff",
  },
  scannerCloseBtn: {
    position: "absolute",
    top: 8,
    right: 0,
    width: 48,
    height: 48,
    borderRadius: 999,
    border: "none",
    background: "rgba(255,255,255,0.14)",
    color: "#fff",
    fontSize: 28,
    cursor: "pointer",
    zIndex: 2,
  },
  scannerTopText: {
    textAlign: "center",
    fontSize: 16,
    fontWeight: 800,
    marginBottom: 14,
    padding: "0 52px",
  },
  scannerViewport: {
    position: "relative",
    width: "100%",
    aspectRatio: "3 / 4",
    borderRadius: 24,
    overflow: "hidden",
    background: "#111827",
    border: "1px solid rgba(255,255,255,0.12)",
  },
  scannerVideo: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  scannerGuideBox: {
    position: "absolute",
    inset: "24% 10%",
    border: "2px solid rgba(255,255,255,0.95)",
    borderRadius: 22,
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.22)",
    pointerEvents: "none",
  },
  scannerHelperText: {
    textAlign: "center",
    fontSize: 14,
    color: "rgba(255,255,255,0.9)",
    marginTop: 14,
    lineHeight: 1.5,
  },
  scannerActions: {
    display: "flex",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
    flexWrap: "wrap",
  },
  toast: {
    position: "fixed",
    left: "50%",
    bottom: 24,
    transform: "translateX(-50%)",
    zIndex: 80,
    background: "#111827",
    color: "#fff",
    padding: "12px 16px",
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 700,
    boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
  },
};

export default App;

