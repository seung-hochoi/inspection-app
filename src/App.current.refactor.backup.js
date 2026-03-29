import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { BrowserCodeReader, BrowserMultiFormatReader } from "@zxing/browser";
import {
  clampText,
  formatDateForFileName,
  formatDateTime,
  formatPercent,
  normalizeProductCode,
  parseQty,
} from "./utils/formatters";
import {
  base64ToBlob,
  buildNormalizedRows,
  buildReservationRows,
  buildVisibleHappycallRanks,
  computeJobKey,
  decodeCsvFile,
  filesToBase64,
  fileToBase64,
  getHappycallProductMetrics,
  getPhotoCandidatesFromRecord,
  getRecordQtyText,
  getRecordType,
  getValue,
  isClassifiedHappycallProduct,
  isExplicitFalseUsage,
  isTruthyUsage,
  mergeJobRowsWithReservation,
  mergeRowsWithReservation,
  normalizeText,
  parseHappycallSourceFile,
} from "./utils/helpers";
import { getProductImageSrc, makeProductImageMapKey } from "./utils/imageMap";
import TopRankCard from "./components/TopRankCard";
import ProductCard from "./components/ProductCard";
import ScannerModal from "./components/ScannerModal";
import ImageRegisterSheet from "./components/ImageRegisterSheet";

const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzrPgqH8RoyY-7q2ZaDOZJqJo4aIJumTLtwmGSm-NgFnUzWyHavTi__CrwWbnwa5763wA/exec";

const BarcodeScanIcon = ({ size = 24, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="10" y="8" width="44" height="30" rx="4" stroke={color} strokeWidth="4" />
    <path d="M18 14V34" stroke={color} strokeWidth="4" strokeLinecap="round" />
    <path d="M26 14V30" stroke={color} strokeWidth="4" strokeLinecap="round" />
    <path d="M34 14V34" stroke={color} strokeWidth="4" strokeLinecap="round" />
    <path d="M42 14V28" stroke={color} strokeWidth="4" strokeLinecap="round" />
    <path d="M18 46C22 42 31 41 36 46" stroke={color} strokeWidth="4" strokeLinecap="round" />
    <path d="M14 52C20 46 34 45 42 52" stroke={color} strokeWidth="4" strokeLinecap="round" />
    <path d="M41 41C47 41 52 46 52 52V56H34V52C34 46 35 41 41 41Z" fill={color} />
  </svg>
);

const FlashlightIcon = ({ size = 20, color = "currentColor", active = false }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      d="M9 2H15L14 8H10L9 2Z"
      fill={active ? "#f59e0b" : color}
      stroke={active ? "#f59e0b" : color}
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M10 8H14V16C14 17.1046 13.1046 18 12 18C10.8954 18 10 17.1046 10 16V8Z"
      fill={active ? "#fde68a" : "none"}
      stroke={active ? "#f59e0b" : color}
      strokeWidth="1.5"
    />
    <path d="M12 18V22" stroke={active ? "#f59e0b" : color} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M6 10L4 12" stroke={active ? "#f59e0b" : color} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M18 10L20 12" stroke={active ? "#f59e0b" : color} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

function HistoryPhotoItem({ candidate, index, onOpen, styles }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div style={styles.photoThumbEmpty}>誘몃━蹂닿린 遺덇?</div>;
  }

  return (
    <img
      src={candidate.previewUrl}
      alt={`泥⑤? ?ъ쭊 ${index + 1}`}
      style={styles.photoThumb}
      onClick={() => onOpen(candidate.previewUrl)}
      onError={() => setFailed(true)}
    />
  );
}

function HistoryPhotoPreview({ record, onOpen, styles }) {
  const candidates = useMemo(() => getPhotoCandidatesFromRecord(record), [record]);

  if (!candidates.length) {
    return <div style={styles.photoEmpty}>?ъ쭊 ?놁쓬</div>;
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
  const [productImageMap, setProductImageMap] = useState({});
  const [showImageRegister, setShowImageRegister] = useState(false);
  const [imageRegisterSearch, setImageRegisterSearch] = useState("");
  const [selectedImageTargetKey, setSelectedImageTargetKey] = useState("");
  const [uploadingImageKey, setUploadingImageKey] = useState("");

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerStatus, setScannerStatus] = useState("移대찓?쇰? 以鍮꾪븯怨??덉뒿?덈떎...");
  const [scannerReady, setScannerReady] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const fileInputRef = useRef(null);
  const happycallFileInputRef = useRef(null);
  const imageRegisterInputRef = useRef(null);
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
          merged["?뚯넚?섎웾"] = prevEntry["?뚯넚?섎웾"] || 0;
          merged["援먰솚?섎웾"] = prevEntry["援먰솚?섎웾"] || 0;
          merged["?쇳꽣紐?"] = prevEntry["?쇳꽣紐?"] || merged["?쇳꽣紐?"] || "";
          merged["鍮꾧퀬"] = prevEntry["鍮꾧퀬"] || merged["鍮꾧퀬"] || "";
          merged.photoFiles =
            (Array.isArray(entry.photoFiles) && entry.photoFiles.length
              ? entry.photoFiles
              : prevEntry.photoFiles) || [];
        }

        if (entry.type === "return" || entry.type === "exchange") {
          merged["寃?덉닔??"] = prevEntry["寃?덉닔??"] || merged["寃?덉닔??"] || 0;
        }

        if (entry.type === "movement") {
          merged.qty = parseQty(prevEntry.qty) + parseQty(entry.qty);
          merged["?뚯넚?섎웾"] = parseQty(prevEntry["?뚯넚?섎웾"]) + parseQty(entry["?뚯넚?섎웾"]);
          merged["援먰솚?섎웾"] = parseQty(prevEntry["援먰솚?섎웾"]) + parseQty(entry["援먰솚?섎웾"]);
          merged.鍮꾧퀬 = entry.鍮꾧퀬 || prevEntry.鍮꾧퀬 || "";
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
      setScannerStatus("移대찓?쇰? 以鍮꾪븯怨??덉뒿?덈떎...");

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
          prev === "諛붿퐫???몄떇 以?.."
            ? "諛붿퐫?쒕? ?붾㈃ 以묒븰??留욎떠二쇱꽭??"
            : "諛붿퐫???몄떇 以?.."
        );
      }, 2200);

      setScannerStatus("諛붿퐫???몄떇 以?..");
    } catch (err) {
      setScannerError(err.message || "移대찓?쇰? ?쒖옉?????놁뒿?덈떎.");
      setScannerStatus("移대찓?쇰? ?ъ슜?????놁뒿?덈떎.");
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
        throw new Error(result.message || "CSV 罹먯떆 ????ㅽ뙣");
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
  
      setMessage("CSV ?낅줈???꾨즺");
    } catch (err) {
      setError(err.message || "CSV 泥섎━ ?ㅽ뙣");
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
      setError("REACT_APP_GOOGLE_SCRIPT_URL ?섍꼍蹂?섍? ?꾩슂?⑸땲??");
      return;
    }

    try {
      setBootLoading(true);
      setError("");

      const response = await fetch(`${SCRIPT_URL}?action=bootstrap`);
      const result = await response.json();

      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "珥덇린 ?곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲??");
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
          getValue(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "肄붾뱶", "諛붿퐫??"])
        );
        const partner = String(getValue(row, ["?묐젰??", "?묐젰?щ챸"]) || "").trim();
        const useFlag = getValue(row, ["?ъ슜?щ?"]);

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
          getValue(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "肄붾뱶", "諛붿퐫??"])
        );
        const eventName = String(getValue(row, ["?됱궗紐?"]) || "").trim();
        const useFlag = getValue(row, ["?ъ슜?щ?"]);

        if (!productCode) return;
        if (isExplicitFalseUsage(useFlag)) return;

        nextEventMap[productCode] = {
          "?됱궗?щ?": "?됱궗",
          "?됱궗紐?": eventName,
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
      setProductImageMap(
        (Array.isArray(data.product_images) ? data.product_images : []).reduce((acc, item) => {
          const key = String(item?.["?대?吏留ㅽ븨??"] || "").trim();
          const fileId = String(item?.["?쒕씪?대툕?뚯씪ID"] || "").trim();
          const url = fileId
            ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`
            : String(item?.["?대?吏URL"] || "").trim();
          if (key && url) acc[key] = url;
          return acc;
        }, {})
      );
      setMessage(job ? "理쒓렐 ?묒뾽??遺덈윭?붿뒿?덈떎." : "CSV瑜??낅줈?쒗빐 二쇱꽭??");
    } catch (err) {
      setError(err.message || "珥덇린 ?곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲??");
    } finally {
      setBootLoading(false);
    }
  }, []);

  const fetchHistoryRowsData = useCallback(async () => {
    const response = await fetch(`${SCRIPT_URL}?action=getRecords`);
    const result = await response.json();

    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "?댁뿭 遺덈윭?ㅺ린 ?ㅽ뙣");
    }

    return (Array.isArray(result.records) ? result.records : []).sort((a, b) =>
      String(b["?묒꽦?쇱떆"] || "").localeCompare(String(a["?묒꽦?쇱떆"] || ""), "ko")
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
      setError(err.message || "?댁뿭??遺덈윭?ㅼ? 紐삵뻽?듬땲??");
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
    const visibleHappycallRankMap = buildVisibleHappycallRanks(happycallAnalytics);

    filteredRows.forEach((row) => {
      const productCode = row.__productCode;
      const productName = row.__productName || "?곹뭹紐??놁쓬";
      const partner = row.__partner || "?묐젰???놁쓬";
      const center = row.__center || "?쇳꽣 ?놁쓬";
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

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "ko"))
      .map(([partner, products]) => ({
        partner,
        products: products.map((product) => ({
          ...product,
          imageSrc: getProductImageSrc(product, productImageMap),
          happycallStats: {
            "1d": visibleHappycallRankMap[`${product.partner}||${product.productCode}`]?.["1d"] || null,
            "7d": visibleHappycallRankMap[`${product.partner}||${product.productCode}`]?.["7d"] || null,
            "30d": visibleHappycallRankMap[`${product.partner}||${product.productCode}`]?.["30d"] || null,
          },
          centers: product.centers.sort((a, b) => (b.totalQty || 0) - (a.totalQty || 0)),
        })),
      }));
  }, [filteredRows, search, eventMap, happycallAnalytics, productImageMap]);

  const historyCountMap = useMemo(() => {
    const map = {};

    (historyRows || []).forEach((record) => {
      const key = `${record["?묐젰?щ챸"] || ""}||${record["?곹뭹肄붾뱶"] || ""}`;
      if (!map[key]) {
        map[key] = { returnCount: 0, exchangeCount: 0 };
      }

      if (parseQty(record["?뚯넚?섎웾"]) > 0) {
        map[key].returnCount += 1;
      }

      if (parseQty(record["援먰솚?섎웾"]) > 0) {
        map[key].exchangeCount += 1;
      }
    });

    return map;
  }, [historyRows]);

  const previousDayHappycallTopList = useMemo(
    () =>
      (happycallAnalytics?.periods?.["1d"]?.topProducts || [])
        .filter(isClassifiedHappycallProduct)
        .slice(0, 10)
        .map((item, index) => ({
          rank: index + 1,
          productName: item?.productName || "-",
          count: parseQty(item?.count || 0),
          share: Number(item?.share || 0),
          partnerName: item?.partnerName || "",
          productCode: item?.productCode || "",
          imageSrc: getProductImageSrc(
            {
              productName: item?.productName || "",
              partner: item?.partnerName || "",
              productCode: item?.productCode || "",
            },
            productImageMap
          ),
        })),
    [happycallAnalytics, productImageMap]
  );

  const imageRegistryProducts = useMemo(() => {
    const keyword = normalizeText(imageRegisterSearch);
    const flatList = groupedPartners.flatMap((group) =>
      group.products.map((product) => ({
        partner: group.partner,
        productCode: product.productCode,
        productName: product.productName,
        imageSrc: product.imageSrc || "",
        totalQty: product.totalQty || 0,
        imageKey: makeProductImageMapKey({
          productCode: product.productCode,
          partner: group.partner,
          productName: product.productName,
        }),
      }))
    );

    return flatList
      .filter((item) => {
        if (!keyword) return true;
        return (
          normalizeText(item.productName).includes(keyword) ||
          normalizeText(item.partner).includes(keyword) ||
          String(item.productCode || "").includes(imageRegisterSearch.trim())
        );
      })
      .sort((a, b) => {
        const partnerDiff = String(a.partner || "").localeCompare(String(b.partner || ""), "ko");
        if (partnerDiff !== 0) return partnerDiff;
        return String(a.productName || "").localeCompare(String(b.productName || ""), "ko");
      });
  }, [groupedPartners, imageRegisterSearch]);

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
      throw new Error(result.message || "?댁뿭 ??젣 ?ㅽ뙣");
    }
  };

  const openImageRegisterPicker = (product) => {
    const imageKey = makeProductImageMapKey({
      productCode: product?.productCode || "",
      partner: product?.partner || "",
      productName: product?.productName || "",
    });
    setSelectedImageTargetKey(imageKey);
    imageRegisterInputRef.current?.click();
  };

  const handleProductImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedImageTargetKey) return;

    const targetProduct = imageRegistryProducts.find((item) => item.imageKey === selectedImageTargetKey);
    if (!targetProduct) {
      setError("?곹뭹 ?뺣낫瑜?李얠? 紐삵뻽?듬땲??");
      if (e.target) e.target.value = "";
      return;
    }

    try {
      setUploadingImageKey(selectedImageTargetKey);
      setError("");
      setMessage("");

      const encoded = await fileToBase64(file);
      const response = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "saveProductImageMapping",
          payload: {
            productCode: targetProduct.productCode || "",
            partnerName: targetProduct.partner || "",
            productName: targetProduct.productName || "",
            photo: encoded,
          },
        }),
      });

      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "?대?吏 ????ㅽ뙣");
      }

      const nextMap = (Array.isArray(result.product_images) ? result.product_images : []).reduce((acc, item) => {
        const key = String(item?.["?대?吏留ㅽ븨??"] || "").trim();
        const fileId = String(item?.["?쒕씪?대툕?뚯씪ID"] || "").trim();
        const url = fileId
          ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`
          : String(item?.["?대?吏URL"] || "").trim();
        if (key && url) acc[key] = url;
        return acc;
      }, {});
      setProductImageMap(nextMap);
      setToast("?대?吏 ????꾨즺");
      setMessage("?곹뭹 ?대?吏媛 ??λ릺?덉뒿?덈떎.");
    } catch (err) {
      setError(err.message || "?대?吏 ????ㅽ뙣");
    } finally {
      setUploadingImageKey("");
      setSelectedImageTargetKey("");
      if (e.target) e.target.value = "";
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
          "?ъ쭊??": photosPayload,
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
        throw new Error(result.message || "諛곗튂 ????ㅽ뙣");
      }

      removePendingKeys(targetKeys);
      setItemStatuses(targetKeys, "saved");

      if (Array.isArray(result.records)) {
        const nextRows = [...result.records].sort((a, b) =>
          String(b["?묒꽦?쇱떆"] || "").localeCompare(String(a["?묒꽦?쇱떆"] || ""), "ko")
        );
        setHistoryRows(nextRows);
      }

      if (result.summary) {
        setDashboardSummary(result.summary);
      }

      setToast("????꾨즺");
    } catch (err) {
      setItemStatuses(targetKeys, "failed");
      setError(err.message || "諛곗튂 ????ㅽ뙣");
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
      setError("寃?덉닔?됱쓣 ?낅젰??二쇱꽭??");
      return;
    }

    setError("");
    setMessage("");
    upsertPendingEntries([
      {
        key: entityKey,
        type: "inspection",
        "?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?": currentJob?.job_key || "",
        "?묒꽦?쇱떆": new Date().toISOString(),
        "?곹뭹肄붾뱶": product.productCode,
        "?곹뭹紐?": product.productName,
        "?묐젰?щ챸": product.partner,
        "?꾩껜諛쒖＜?섎웾": product.totalQty || 0,
        "諛쒖＜?섎웾": product.totalQty || 0,
        "寃?덉닔??": qty,
        "?뚯넚?섎웾": pendingMap[entityKey]?.["?뚯넚?섎웾"] || 0,
        "援먰솚?섎웾": pendingMap[entityKey]?.["援먰솚?섎웾"] || 0,
        "?쇳꽣紐?": pendingMap[entityKey]?.["?쇳꽣紐?"] || "",
        "鍮꾧퀬": pendingMap[entityKey]?.["鍮꾧퀬"] || "",
        "?됱궗?щ?": product.eventInfo?.["?됱궗?щ?"] || "",
        "?됱궗紐?": product.eventInfo?.["?됱궗紐?"] || "",
        photoFiles: photoFiles.length ? photoFiles : pendingMap[entityKey]?.photoFiles || [],
      },
    ]);
    setToast("??λ릺?덉뒿?덈떎.");
  };

  const saveReturnExchange = async (product, centerName) => {
    const centerInfo = product.centers.find((item) => item.center === centerName);
    if (!centerInfo) {
      setError("?쇳꽣瑜??좏깮??二쇱꽭??");
      return;
    }

    const draftKey = `return||${product.partner}||${product.productCode}||${centerName}`;
    const draft = drafts[draftKey] || {};
    const returnQty = parseQty(draft.returnQty);
    const exchangeQty = parseQty(draft.exchangeQty);
    const memo = String(draft.memo || "").trim();
    const photoFiles = Array.isArray(draft.photoFiles) ? draft.photoFiles : [];

    if (!currentJob?.job_key) {
      setError("???媛?ν븳 ?묒뾽 湲곗? CSV媛 ?놁뒿?덈떎.");
      return;
    }

    if (returnQty <= 0 && exchangeQty <= 0 && !memo && photoFiles.length === 0) {
      setError("?뚯넚?섎웾, 援먰솚?섎웾, 鍮꾧퀬, ?ъ쭊 以??섎굹 ?댁긽 ?낅젰??二쇱꽭??");
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
        "?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?": currentJob?.job_key || "",
        "?묒꽦?쇱떆": new Date().toISOString(),
        "?곹뭹紐?": product.productName,
        "?곹뭹肄붾뱶": product.productCode,
        "?쇳꽣紐?": centerName,
        "?묐젰?щ챸": product.partner,
        "諛쒖＜?섎웾": centerInfo.totalQty || 0,
        "?됱궗?щ?": product.eventInfo?.["?됱궗?щ?"] || "",
        "?됱궗紐?": product.eventInfo?.["?됱궗紐?"] || "",
        "泥섎━?좏삎": "?뚯넚",
        "?뚯넚?섎웾": returnQty,
        "援먰솚?섎웾": 0,
        qty: returnQty,
        鍮꾧퀬: memo,
        photoFiles,
        "?꾩껜諛쒖＜?섎웾": product.totalQty || 0,
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
        "?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?": currentJob?.job_key || "",
        "?묒꽦?쇱떆": new Date().toISOString(),
        "?곹뭹紐?": product.productName,
        "?곹뭹肄붾뱶": product.productCode,
        "?쇳꽣紐?": "",
        "?묐젰?щ챸": product.partner,
        "諛쒖＜?섎웾": product.totalQty || 0,
        "?됱궗?щ?": product.eventInfo?.["?됱궗?щ?"] || "",
        "?됱궗紐?": product.eventInfo?.["?됱궗紐?"] || "",
        "泥섎━?좏삎": "援먰솚",
        "?뚯넚?섎웾": 0,
        "援먰솚?섎웾": exchangeQty,
        qty: exchangeQty,
        鍮꾧퀬: memo,
        photoFiles,
        "?꾩껜諛쒖＜?섎웾": product.totalQty || 0,
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
    setToast("??λ릺?덉뒿?덈떎.");
  };

  const deleteHistoryRecord = async (record) => {
    const rowNumber = Number(record.__rowNumber || 0);
    if (!rowNumber) {
      setError("??젣?????뺣낫瑜?李얠? 紐삵뻽?듬땲??");
      return;
    }

    const ok = window.confirm("???댁뿭????젣?좉퉴??");
    if (!ok) return;

    try {
      setDeletingRowNumber(rowNumber);
      await cancelMovementEventByRow(rowNumber);
      setHistoryRows((prev) => prev.filter((item) => Number(item.__rowNumber) !== rowNumber));
      setToast("??젣 ?꾨즺");
    } catch (err) {
      setError(err.message || "?댁뿭 ??젣 ?ㅽ뙣");
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
        throw new Error(result.message || "ZIP ?ㅼ슫濡쒕뱶 ?ㅽ뙣");
      }

      if (!result.zipBase64) {
        setToast("?ㅼ슫濡쒕뱶 媛?ν븳 ?ъ쭊???놁뒿?덈떎.");
        return;
      }

      const blob = base64ToBlob(result.zipBase64, result.mimeType || "application/zip");
      const link = document.createElement("a");
      const href = URL.createObjectURL(blob);
      const fileName = result.fileName ||
        (mode === "movement"
          ? `?뚯넚_援먰솚_?ъ쭊_${formatDateForFileName()}.zip`
          : mode === "inspection"
          ? `寃?덉궗吏?${formatDateForFileName()}.zip`
          : `李멸퀬?ъ쭊_${formatDateForFileName()}.zip`);

      link.href = href;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setToast("ZIP ?ㅼ슫濡쒕뱶 ?꾨즺");
    } catch (err) {
      setError(err.message || "ZIP ?ㅼ슫濡쒕뱶 ?ㅽ뙣");
    } finally {
      setZipDownloading("");
    }
  };

  const resetCurrentJobInputs = async () => {
    if (!currentJob?.job_key) {
      setError("珥덇린?뷀븷 ?꾩옱 ?묒뾽???놁뒿?덈떎.");
      return;
    }

    if (!adminPassword.trim()) {
      setError("愿由ъ옄 鍮꾨?踰덊샇瑜??낅젰??二쇱꽭??");
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
        throw new Error(result.message || "珥덇린???ㅽ뙣");
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
      setToast("?꾩옱 ?묒뾽 ?낅젰 ?곗씠??珥덇린???꾨즺");
    } catch (err) {
      setError(err.message || "珥덇린???ㅽ뙣");
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

      const parsedRows = await parseHappycallSourceFile(file);

      const rawRows = (parsedRows || [])
        .map((row) => ({
          "?쒕ぉ": clampText(row["?쒕ぉ"] || row["subject"] || "", 300),
          "蹂몃Ц": clampText(row["蹂몃Ц"] || row["body"] || row["?댁슜(?뷀샇??"] || "", 8000),
          "硫붿씪ID": clampText(row["?명꽣??硫붿떆吏 ID"] || row["硫붿씪ID"] || row["?묒닔踰덊샇"] || "", 200),
          "蹂대궦?щ엺": clampText(row["蹂대궦?щ엺:(?대쫫)"] || row["senderName"] || "", 200),
          "?묒닔?쇱떆": clampText(row["?묒닔?쇱떆"] || row["receivedAt"] || "", 100),
          "?뚰듃?덉궗": clampText(row["泥섎━?뚰듃?덉궗"] || row["?뚰듃?덉궗"] || row["?묐젰?щ챸"] || "", 200),
          "?μ븷?좏삎": clampText(
            row["?μ븷?좏삎(??"] || row["?μ븷?좏삎(以?"] || row["?μ븷?좏삎(?)"] || row["?μ븷?좏삎"] || "",
            200
          ),
        }))
        .filter((row) => String(row["?쒕ぉ"] || "").trim() || String(row["蹂몃Ц"] || "").trim());

      const dedupedMap = new Map();
      rawRows.forEach((row) => {
        const dedupeKey = [
          String(row["硫붿씪ID"] || "").trim(),
          String(row["?뚰듃?덉궗"] || "").trim(),
          String(row["?묒닔?쇱떆"] || "").trim(),
          String(row["?쒕ぉ"] || "").trim(),
          String(row["蹂몃Ц"] || "").trim().slice(0, 300),
        ].join("||");
        dedupedMap.set(dedupeKey, row);
      });

      const rows = Array.from(dedupedMap.values());
      const skippedCount = Math.max(0, rawRows.length - rows.length);

      if (!rows.length) {
        throw new Error("?댄뵾肄?CSV?먯꽌 媛?몄삱 ???덈뒗 ?됱씠 ?놁뒿?덈떎.");
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
          `?댄뵾肄?CSV 泥섎━ 以?.. ${batchNumber}/${totalBatches} 諛곗튂 (${processedCount} / ${rows.length})`
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
            result.message || `?댄뵾肄?CSV 媛?몄삤湲곗뿉 ?ㅽ뙣?덉뒿?덈떎. (${batchNumber}/${totalBatches} 諛곗튂)`
          );
        }

        lastResult = result;
        insertedTotal += Number(result?.data?.inserted || 0);
        updatedTotal += Number(result?.data?.updated || 0);
      }

      setHappycallAnalytics(lastResult?.happycall || {});
      setMessage("");
      setToast(
        `?댄뵾肄?CSV 諛섏쁺 ?꾨즺 쨌 ?좉퇋 ${insertedTotal}嫄?쨌 媛깆떊 ${updatedTotal}嫄?${
          skippedCount > 0 ? ` 쨌 以묐났 ?쒖쇅 ${skippedCount}嫄?` : ""
        }`
      );
    } catch (err) {
      setError(
        `${err.message || "?댄뵾肄?CSV 媛?몄삤湲곗뿉 ?ㅽ뙣?덉뒿?덈떎."} 媛숈? CSV瑜??ㅼ떆 ?щ━硫??댁뼱??諛섏쁺?⑸땲??`
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
        accept=".csv,.xls,.xlsx"
        onChange={handleHappycallCsvUpload}
        style={styles.hiddenInput}
      />
      <input
        ref={imageRegisterInputRef}
        type="file"
        accept="image/*"
        onChange={handleProductImageUpload}
        style={styles.hiddenInput}
      />

      <div style={styles.headerCard}>
        <div style={styles.headerTopRow}>
          <div>
            <h1 style={styles.title}>GS?좎꽑媛뺥솕吏?먰?</h1>
            <div style={styles.headerLinkRow}>
              <a href={worksheetUrl || "#"} target="_blank" rel="noreferrer" style={styles.headerLink}>
                {worksheetUrl || "?뚰겕?쒗듃 URL ?놁쓬"}
              </a>
              <button
                type="button"
                onClick={async () => {
                  if (!worksheetUrl) return;
                  try {
                    await navigator.clipboard.writeText(worksheetUrl);
                    setToast("?뚰겕?쒗듃 留곹겕 蹂듭궗 ?꾨즺");
                  } catch (_) {
                    setError("?뚰겕?쒗듃 留곹겕 蹂듭궗 ?ㅽ뙣");
                  }
                }}
                style={styles.copyButton}
              >
                蹂듭궗
              </button>
            </div>
          </div>
          <div style={styles.headerModeBadge}>{mode === "inspection" ? "寃??紐⑤뱶" : "?뚯넚/援먰솚 紐⑤뱶"}</div>
        </div>
        <div style={styles.quickActionGrid}>
          <button
            type="button"
            onClick={() => setMode("inspection")}
            style={{ ...styles.quickActionCard, ...(mode === "inspection" ? styles.quickActionCardActive : {}) }}
          >
            <span style={styles.quickActionIcon}>?뵊</span>
            <span style={styles.quickActionText}>寃??</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("return")}
            style={{ ...styles.quickActionCard, ...(mode === "return" ? styles.quickActionCardActive : {}) }}
          >
            <span style={styles.quickActionIcon}>?벀</span>
            <span style={styles.quickActionText}>?뚯넚</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              setShowHistory(true);
              await loadHistoryRows();
            }}
            style={styles.quickActionCard}
          >
            <span style={styles.quickActionIcon}>?뱞</span>
            <span style={styles.quickActionText}>?댁뿭</span>
          </button>
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.csvHeaderRow}>
          <div>
            <div style={styles.sectionTitle}>CSV ?낅줈??</div>
            <div style={styles.metaText}>
              ?꾩옱 ?묒뾽: {currentFileName || "?낅줈?쒕맂 ?뚯씪 ?놁쓬"}
            </div>
            <div style={styles.metaText}>
              ?뚯씪 ?섏젙?쇱옄: {currentFileModifiedAt ? formatDateTime(currentFileModifiedAt) : "-"}
            </div>
          </div>
          <div style={styles.csvActionRow}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={styles.primaryButton}
            >
              {uploadingCsv ? "泥섎━ 以?.." : "寃??CSV ?좏깮"}
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
              {uploadingHappycallCsv ? "泥섎━ 以?.." : "?댄뵾肄??뚯씪 ?좏깮"}
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
              愿由ъ옄 珥덇린??            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                setMessage("");
                setImageRegisterSearch("");
                setShowImageRegister(true);
              }}
              style={styles.secondaryButton}
            >
              ?대?吏 ?깅줉
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
            placeholder="?곹뭹紐?/ ?곹뭹肄붾뱶 / ?묐젰??寃??"
            style={styles.searchInput}
          />
          <button type="button" onClick={() => setIsScannerOpen(true)} style={styles.scanButton} aria-label="諛붿퐫???ㅼ틪">
            <span style={styles.scanIcon}>
              <BarcodeScanIcon size={26} />
            </span>
          </button>
        </div>
      </div>

      {(bootLoading || uploadingCsv || error || message) && (
        <div style={error ? styles.errorBox : styles.infoBox}>
          {bootLoading
            ? "珥덇린 ?곗씠?곕? 遺덈윭?ㅻ뒗 以?.."
            : uploadingCsv
            ? "CSV 泥섎━ 以?.."
            : error || message}
        </div>
      )}

      <div style={styles.panel}>
        <div style={styles.happycallHeader}>
          <div>
            <div style={styles.sectionTitle}>?꾩씪 ?댄뵾肄?理쒕떎 TOP10</div>
            <div style={styles.metaText}>?꾩씪 ?묒닔 ?댄뵾肄?湲곗?</div>
          </div>
        </div>

        {previousDayHappycallTopList.length === 0 ? (
          <div style={styles.emptyBox}>?꾩씪 ?댄뵾肄??곗씠?곌? ?놁뒿?덈떎.</div>
        ) : (
          <div style={styles.kpiGrid}>
            {previousDayHappycallTopList.map((card) => (
              <TopRankCard
                key={`happycall-top-${card.rank}`}
                card={card}
                styles={styles}
                metaText={`${card.count.toLocaleString("ko-KR")}건 · ${formatPercent(card.share)}`}
              />
            ))}
          </div>
        )}
      </div>

      <div style={styles.countRow}>
        <div style={styles.countText}>珥?{groupedPartners.reduce((sum, item) => sum + item.products.length, 0)}嫄?</div>
        <div style={styles.countActions}>
          <button
            type="button"
            onClick={() => downloadPhotoZip("movement")}
            style={styles.historyButton}
          >
            {zipDownloading === "movement" ? "ZIP ?앹꽦 以?.." : "遺덈웾?ъ쭊 ???"}
          </button>
          <button
            type="button"
            onClick={() => downloadPhotoZip("inspection")}
            style={styles.historyButton}
          >
            {zipDownloading === "inspection" ? "ZIP ?앹꽦 以?.." : "寃?덉궗吏????"}
          </button>
          <button
            type="button"
            onClick={() => downloadPhotoZip("photoOnly")}
            style={styles.historyButton}
          >
            {zipDownloading === "photoOnly" ? "ZIP ?앹꽦 以?.." : "李멸퀬?ъ쭊 ???"}
          </button>
        </div>
      </div>

      <div style={styles.list}>
        {groupedPartners.length === 0 ? (
          <div style={styles.emptyBox}>?쒖떆???곹뭹???놁뒿?덈떎.</div>
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
                <div style={styles.partnerCount}>{partnerGroup.products.length}嫄?</div>
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
                      historyCounts.returnCount > 0 ? `?뚯넚 ${historyCounts.returnCount}` : "",
                      historyCounts.exchangeCount > 0 ? `援먰솚 ${historyCounts.exchangeCount}` : "",
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
                      ["1d", "?꾩씪"],
                      ["7d", "?쇱＜??"],
                      ["30d", "?쒕떖"],
                    ]
                      .map(([periodKey, label]) => {
                        const stats = product.happycallStats?.[periodKey];
                        if (!stats?.rank || stats.rank > 5) return null;
                        return {
                          key: periodKey,
                          rank: stats.rank,
                          label: `${label} ?댄뵾肄?TOP${stats.rank}`,
                        };
                      })
                      .filter(Boolean);

                    const showEventBadge = !!product.eventInfo?.["?됱궗?щ?"];
                    const eventBadgeText = product.eventInfo?.["?됱궗紐?"] || "?됱궗";

                    return (
                      <ProductCard
                        key={`${partnerGroup.partner}-${product.productCode}`}
                        mode={mode}
                        product={product}
                        happycallBadges={happycallBadges}
                        historySummary={historySummary}
                        styles={styles}
                        onToggleOpen={() => {
                          const nextKey = productStateKey;
                          setExpandedProductCode((prev) => (prev === nextKey ? "" : nextKey));
                          setSelectedCenterByProduct((prev) => ({
                            ...prev,
                            [productStateKey]: prev[productStateKey] || product.centers[0]?.center || "",
                          }));
                        }}
                        isOpen={isOpen}
                        showEventBadge={showEventBadge}
                        eventBadgeText={eventBadgeText}
                        emptyProductNameText="?곹뭹紐??놁쓬"
                        inspectionContent={
                          <>
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
                                        "?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?": currentJob?.job_key || "",
                                        "?묒꽦?쇱떆": new Date().toISOString(),
                                        "?곹뭹肄붾뱶": product.productCode,
                                        "?곹뭹紐?": product.productName,
                                        "?묐젰?щ챸": product.partner,
                                        "?꾩껜諛쒖＜?섎웾": product.totalQty || 0,
                                        "諛쒖＜?섎웾": product.totalQty || 0,
                                        "寃?덉닔??": qty,
                                        "?뚯넚?섎웾": 0,
                                        "援먰솚?섎웾": 0,
                                      },
                                    ]);
                                  } else {
                                    removePendingKeys([entityKey]);
                                  }
                                }}
                                style={styles.inlineQtyInput}
                                placeholder="寃?덉닔??"
                              />
                            </div>
                            <div style={styles.formGroup}>
                              <label style={styles.label}>寃???ъ쭊</label>
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
                                        "?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?": currentJob?.job_key || "",
                                        "?묒꽦?쇱떆": new Date().toISOString(),
                                        "?곹뭹肄붾뱶": product.productCode,
                                        "?곹뭹紐?": product.productName,
                                        "?묐젰?щ챸": product.partner,
                                        "?꾩껜諛쒖＜?섎웾": product.totalQty || 0,
                                        "諛쒖＜?섎웾": product.totalQty || 0,
                                        "寃?덉닔??": parseQty(draft.inspectionQty),
                                        "?뚯넚?섎웾": 0,
                                        "援먰솚?섎웾": 0,
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
                                  : "?좏깮???ъ쭊 ?놁쓬"}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => saveInspectionQtySimple(product)}
                              style={styles.saveButton}
                            >
                              {inspectionStatus === "saving" ? "??μ쨷..." : "???"}
                            </button>
                          </>
                        }
                        renderExpandedContent={() => (
                          <div style={styles.editorBox}>
                            <div style={styles.formGroup}>
                              <label style={styles.label}>?쇳꽣 ?좏깮</label>
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
                                    {center.center} / {center.totalQty}媛?
                                  </option>
                                ))}
                              </select>
                            </div>

                            {selectedCenterInfo && (
                              <div style={styles.detailBlock}>
                                <div style={styles.metaText}>
                                  ?좏깮 ?쇳꽣 諛쒖＜?섎웾: {selectedCenterInfo.totalQty}媛?
                                </div>
                                <div style={styles.metaText}>
                                  ?됱궗: {product.eventInfo?.["?됱궗?щ?"] || ""}
                                  {product.eventInfo?.["?됱궗紐?"] ? ` (${product.eventInfo["?됱궗紐?"]})` : ""}
                                </div>
                              </div>
                            )}

                            <>
                              <div style={styles.grid2}>
                                <div style={styles.formGroup}>
                                  <label style={styles.label}>?뚯넚?섎웾</label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={draft.returnQty || ""}
                                    onChange={(e) => updateDraft(draftKey, "returnQty", e.target.value)}
                                    style={styles.input}
                                  />
                                </div>
                                <div style={styles.formGroup}>
                                  <label style={styles.label}>援먰솚?섎웾</label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={draft.exchangeQty || ""}
                                    onChange={(e) => updateDraft(draftKey, "exchangeQty", e.target.value)}
                                    style={styles.input}
                                  />
                                </div>
                              </div>

                              <div style={styles.formGroup}>
                                <label style={styles.label}>鍮꾧퀬</label>
                                <textarea
                                  value={draft.memo || ""}
                                  onChange={(e) => updateDraft(draftKey, "memo", e.target.value)}
                                  style={styles.textarea}
                                  rows={3}
                                  placeholder="遺덈웾 ?ъ쑀 / ?꾨떖 ?ы빆"
                                />
                              </div>

                              <div style={styles.formGroup}>
                                <label style={styles.label}>?ъ쭊 泥⑤?</label>
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
                                    : "?좏깮???ъ쭊 ?놁쓬"}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => saveReturnExchange(product, selectedCenter)}
                                style={styles.saveButton}
                              >
                                {actionStatus === "saving" ? "??μ쨷..." : "???"}
                              </button>
                            </>
                          </div>
                        )}
                      />
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
              <h2 style={styles.sheetTitle}>????댁뿭</h2>
              <button type="button" onClick={() => setShowHistory(false)} style={styles.sheetClose}>
                ?リ린
              </button>
            </div>

            {historyLoading ? (
              <div style={styles.infoBox}>?댁뿭 遺덈윭?ㅻ뒗 以?..</div>
            ) : historyRows.length === 0 ? (
              <div style={styles.emptyBox}>?쒖떆???댁뿭???놁뒿?덈떎.</div>
            ) : (
              <div style={styles.sheetList}>
                {historyRows.map((record, index) => (
                  <div
                    key={`${record.__rowNumber || "row"}-${record["?묒꽦?쇱떆"] || "time"}-${index}`}
                    style={styles.historyCard}
                  >
                    <button
                      type="button"
                      onClick={() => deleteHistoryRecord(record)}
                      style={styles.deleteBtn}
                      disabled={deletingRowNumber === Number(record.__rowNumber)}
                    >
                      {deletingRowNumber === Number(record.__rowNumber) ? "..." : "횞"}
                    </button>

                    <div style={styles.cardTopRow}>
                      <div style={styles.cardTitle}>{record["?곹뭹紐?"] || "?곹뭹紐??놁쓬"}</div>
                      <span style={styles.typeBadge}>{getRecordType(record)}</span>
                    </div>
                    <div style={styles.cardMeta}>肄붾뱶 {record["?곹뭹肄붾뱶"] || "-"}</div>
                    <div style={styles.cardMeta}>?쇳꽣 {record["?쇳꽣紐?"] || "-"}</div>
                    <div style={styles.cardMeta}>?묐젰??{record["?묐젰?щ챸"] || "-"}</div>
                    <div style={styles.qtyRow}>
                      <span style={styles.qtyChip}>泥섎━?섎웾 {getRecordQtyText(record)}</span>
                      <span style={styles.qtyChip}>{formatDateTime(record["?묒꽦?쇱떆"])}</span>
                    </div>
                    <div style={styles.historyMemo}>{record["鍮꾧퀬"] || "-"}</div>

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
          <img src={zoomPhotoUrl} alt="?뺣? ?ъ쭊" style={styles.photoZoom} />
        </div>
      )}

      {showAdminReset && (
        <div style={styles.sheetOverlay} onClick={() => !adminResetting && setShowAdminReset(false)}>
          <div style={styles.bottomSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} />
            <div style={styles.sheetHeader}>
              <h2 style={styles.sheetTitle}>愿由ъ옄 珥덇린??</h2>
              <button
                type="button"
                onClick={() => !adminResetting && setShowAdminReset(false)}
                style={styles.sheetClose}
              >
                ?リ린
              </button>
            </div>

            <div style={styles.infoBox}>
              ?꾩옱 ?묒뾽??寃?덉닔?? ?뚯넚/援먰솚 ?댁뿭, ?곌껐???ъ쭊怨??쒕씪?대툕 ?먮낯源뚯? ??젣?⑸땲??
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>愿由ъ옄 鍮꾨?踰덊샇</label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                style={styles.input}
                placeholder="鍮꾨?踰덊샇 ?낅젰"
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
              {adminResetting ? "珥덇린??以?.." : "?꾩옱 ?묒뾽 ?낅젰 ?곗씠??珥덇린??"}
            </button>
          </div>
        </div>
      )}

      <ImageRegisterSheet
        showImageRegister={showImageRegister}
        uploadingImageKey={uploadingImageKey}
        setShowImageRegister={setShowImageRegister}
        styles={styles}
        imageRegisterSearch={imageRegisterSearch}
        setImageRegisterSearch={setImageRegisterSearch}
        imageRegistryProducts={imageRegistryProducts}
        openImageRegisterPicker={openImageRegisterPicker}
      />

      <ScannerModal
        isOpen={isScannerOpen}
        closeScanner={closeScanner}
        scannerReady={scannerReady}
        scannerStatus={scannerStatus}
        scannerVideoRef={scannerVideoRef}
        scannerError={scannerError}
        torchSupported={torchSupported}
        toggleTorch={toggleTorch}
        torchOn={torchOn}
        FlashlightIcon={FlashlightIcon}
        styles={styles}
        focusSearchInput={focusSearchInput}
      />

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
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
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
  cardContentRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 88px",
    gap: 12,
    alignItems: "center",
  },
  cardMainCopy: {
    minWidth: 0,
  },
  cardThumbFrame: {
    width: 88,
    height: 88,
    borderRadius: 16,
    border: "1px solid #dbe3f0",
    background: "#fff",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardThumbImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block",
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
  imageRegisterList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 12,
  },
  imageRegisterCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 12,
    background: "#fff",
  },
  imageRegisterInfo: {
    minWidth: 0,
    flex: 1,
  },
  imageRegisterName: {
    fontSize: 15,
    fontWeight: 800,
    color: "#0f172a",
    lineHeight: 1.4,
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
