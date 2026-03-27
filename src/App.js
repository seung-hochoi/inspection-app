import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { BrowserCodeReader, BrowserMultiFormatReader } from "@zxing/browser";

const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbw3NOxnqL__-bibyaJiXtH_VUoiKHLAGwqsLz7B9NVGA-cYyqz_odzXqTb87-5PqYU_Jg/exec";

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
  return ["false", "n", "no", "0", "미사용"].includes(text);
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
      getValue(row, ["거래처명(구매조건명)", "거래처명", "협력사"]) || ""
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
        센터: row.__center,
        협력사: row.__partner,
        수량: row.__qty,
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

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ko-KR");
};

const getRecordType = (record) => {
  const type = String(record.처리유형 || "").trim();
  if (type) return type;
  if (parseQty(record.회송수량) > 0) return "회송";
  if (parseQty(record.교환수량) > 0) return "교환";
  return "기타";
};

const getRecordQtyText = (record) => {
  const type = getRecordType(record);
  if (type === "회송") return `${parseQty(record.회송수량)}개`;
  if (type === "교환") return `${parseQty(record.교환수량)}개`;

  const returnQty = parseQty(record.회송수량);
  const exchangeQty = parseQty(record.교환수량);
  if (returnQty > 0 && exchangeQty > 0) {
    return `회송 ${returnQty}개 / 교환 ${exchangeQty}개`;
  }
  return `${Math.max(returnQty, exchangeQty, 0)}개`;
};

function App() {
  const [rows, setRows] = useState([]);
  const [currentJob, setCurrentJob] = useState(null);
  const [currentFileName, setCurrentFileName] = useState("");
  const [currentFileModifiedAt, setCurrentFileModifiedAt] = useState("");
  const [mode, setMode] = useState("return");
  const [search, setSearch] = useState("");
  const [expandedProductCode, setExpandedProductCode] = useState("");
  const [expandedPartner, setExpandedPartner] = useState("");
  const [selectedCenterByProduct, setSelectedCenterByProduct] = useState({});
  const [drafts, setDrafts] = useState({});
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
  const [zoomPhotoUrl, setZoomPhotoUrl] = useState("");

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerStatus, setScannerStatus] = useState("카메라를 준비하고 있습니다...");
  const [scannerReady, setScannerReady] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const fileInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const scannerVideoRef = useRef(null);
  const scannerControlsRef = useRef(null);
  const scannerTrackRef = useRef(null);
  const scannerStatusTimerRef = useRef(null);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

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
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
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
      const devices = await BrowserCodeReader.listVideoInputDevices();
      const backCamera =
        devices.find((device) =>
          /back|rear|environment|후면|외부/i.test(String(device.label || ""))
        ) || devices[0];

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

        if (!scannerReady) setScannerReady(true);

        if (!err || err.name === "NotFoundException") {
          return;
        }

        setScannerError("바코드 인식 중 오류가 발생했습니다.");
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
            ? "바코드를 화면 중앙에 맞춰주세요"
            : "바코드 인식 중..."
        );
      }, 2200);

      setScannerStatus("바코드 인식 중...");
    } catch (err) {
      setScannerError(err.message || "카메라를 시작할 수 없습니다.");
      setScannerStatus("카메라를 사용할 수 없습니다.");
      stopScanner();
    }
  };
  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
  
    try {
      setUploadingCsv(true);
      setError("");
  
      const { text } = await decodeCsvFile(file);
  
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
      });
  
      const normalized = buildNormalizedRows(parsed.data);
  
      const jobKey = computeJobKey(normalized);
  
      setRows(normalized);
      setCurrentJob({ job_key: jobKey, rows: normalized });
      setCurrentFileName(file.name);
      setCurrentFileModifiedAt(file.lastModified);
  
      setMessage("CSV 업로드 완료");
    } catch (err) {
      setError("CSV 처리 실패");
    } finally {
      setUploadingCsv(false);
    }
  };
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

      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "초기 데이터 불러오기 실패");
      }

      const data = result.data || {};
      const config = data.config || {};
      const job = data.current_job || null;

      const nextExcludedProductCodes = new Set();
      const nextExcludedPairKeys = new Set();

      (config.exclude_rows || []).forEach((row) => {
        const productCode = normalizeProductCode(
          getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])
        );
        const partner = String(getValue(row, ["협력사"]) || "").trim();
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
      setCurrentJob(job);
      setRows(Array.isArray(job?.rows) ? job.rows : []);
      setCurrentFileName(job?.source_file_name || "");
      setCurrentFileModifiedAt(job?.source_file_modified || "");
      setMessage(job ? "최근 작업을 불러왔습니다." : "CSV를 업로드해주세요.");
    } catch (err) {
      setError(err.message || "초기 데이터 불러오기 실패");
    } finally {
      setBootLoading(false);
    }
  };

  const loadHistoryRows = async () => {
    try {
      setHistoryLoading(true);
      setError("");

      const response = await fetch(`${SCRIPT_URL}?action=getRecords`);
      const result = await response.json();

      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "내역 불러오기 실패");
      }

      const nextRows = Array.isArray(result.records) ? result.records : [];
      nextRows.sort((a, b) =>
        String(b.작성일시 || "").localeCompare(String(a.작성일시 || ""), "ko")
      );
      setHistoryRows(nextRows);
    } catch (err) {
      setError(err.message || "내역 불러오기 실패");
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadBootstrap();
  }, []);

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
      const partner = row.__partner || "협력사없음";
      const center = row.__center || "센터없음";
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
          centers: product.centers.sort((a, b) => (b.totalQty || 0) - (a.totalQty || 0)),
        })),
      }));
  }, [filteredRows, search, eventMap]);

  const updateDraft = (key, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value,
      },
    }));
  };

  const ensureHistoryRowsLoaded = async () => {
    if (historyRows.length > 0) return historyRows;

    const response = await fetch(`${SCRIPT_URL}?action=getRecords`);
    const result = await response.json();

    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "내역 불러오기 실패");
    }

    const nextRows = Array.isArray(result.records) ? result.records : [];
    nextRows.sort((a, b) =>
      String(b.작성일시 || "").localeCompare(String(a.작성일시 || ""), "ko")
    );
    setHistoryRows(nextRows);
    return nextRows;
  };

  const saveSingleRecord = async (payload) => {
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "saveRecord",
        payload,
      }),
    });

    const result = await response.json();
    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "기록 저장 실패");
    }

    return result.record || null;
  };

  const deleteSingleRecordByRow = async (rowNumber) => {
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "deleteRecord",
        payload: { rowNumber },
      }),
    });

    const result = await response.json();
    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "내역 삭제 실패");
    }
  };

  const saveInspectionQty = async (product, centerName) => {
    const centerInfo = product.centers.find((item) => item.center === centerName);
    if (!centerInfo) {
      setError("센터를 선택해줘.");
      return;
    }

    const draftKey = `inspection||${product.productCode}||${centerName}`;
    const qty = parseQty(drafts[draftKey]?.inspectionQty);

    if (qty <= 0) {
      setError("검품수량을 입력해줘.");
      return;
    }

    try {
      setSavingKey(draftKey);
      setError("");
      setMessage("");

      const response = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "saveInspectionQty",
          payload: {
            작성일시: new Date().toISOString(),
            작업기준일또는CSV식별값: currentJob?.job_key || "",
            상품명: product.productName,
            상품코드: product.productCode,
            협력사명: product.partner,
            센터명: centerName,
            발주수량: centerInfo.totalQty || 0,
            검품수량: qty,
            전체발주수량: product.totalQty || 0,
          },
        }),
      });

      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "검품수량 저장 실패");
      }

      setDrafts((prev) => ({
        ...prev,
        [draftKey]: {
          inspectionQty: "",
        },
      }));
      setToast("저장 완료");
    } catch (err) {
      setError(err.message || "검품수량 저장 실패");
    } finally {
      setSavingKey("");
    }
  };

  const saveReturnExchange = async (product, centerName) => {
    const centerInfo = product.centers.find((item) => item.center === centerName);
    if (!centerInfo) {
      setError("센터를 선택해줘.");
      return;
    }

    const draftKey = `return||${product.productCode}||${centerName}`;
    const draft = drafts[draftKey] || {};
    const returnQty = parseQty(draft.returnQty);
    const exchangeQty = parseQty(draft.exchangeQty);
    const memo = String(draft.memo || "").trim();
    const photoFile = draft.photoFile || null;

    if (!currentJob?.job_key) {
      setError("저장 가능한 작업 기준 CSV가 없습니다.");
      return;
    }

    if (returnQty <= 0 && exchangeQty <= 0 && !memo && !photoFile) {
      setError("회송수량, 교환수량, 비고, 사진 중 하나 이상 입력해줘.");
      return;
    }

    try {
      setSavingKey(draftKey);
      setError("");
      setMessage("");

      const photoPayload = await fileToBase64(photoFile);
      const loadedHistory = await ensureHistoryRowsLoaded();
      const partnerName = product.partner;

      const tasks = [];

      if (returnQty > 0) {
        const match = loadedHistory.find((row) => {
          return (
            getRecordType(row) === "회송" &&
            normalizeProductCode(row.상품코드) === product.productCode &&
            String(row.상품명 || "") === product.productName &&
            String(row.센터명 || "") === centerName &&
            String(row.협력사명 || "") === partnerName
          );
        });

        let nextQty = returnQty;
        if (match) {
          nextQty += parseQty(match.회송수량);
          await deleteSingleRecordByRow(Number(match.__rowNumber));
        }

        tasks.push({
          작성일시: new Date().toISOString(),
          작업기준일또는CSV식별값: currentJob.job_key,
          상품명: product.productName,
          상품코드: product.productCode,
          센터명: centerName,
          협력사명: partnerName,
          발주수량: centerInfo.totalQty || 0,
          행사여부: product.eventInfo?.행사여부 || "",
          행사명: product.eventInfo?.행사명 || "",
          처리유형: "회송",
          회송수량: nextQty,
          교환수량: 0,
          비고: memo,
          사진: photoPayload,
          전체발주수량: product.totalQty || 0,
        });
      }

      if (exchangeQty > 0) {
        const match = loadedHistory.find((row) => {
          return (
            getRecordType(row) === "교환" &&
            normalizeProductCode(row.상품코드) === product.productCode &&
            String(row.상품명 || "") === product.productName &&
            String(row.센터명 || "") === "" &&
            String(row.협력사명 || "") === partnerName
          );
        });

        let nextQty = exchangeQty;
        if (match) {
          nextQty += parseQty(match.교환수량);
          await deleteSingleRecordByRow(Number(match.__rowNumber));
        }

        tasks.push({
          작성일시: new Date().toISOString(),
          작업기준일또는CSV식별값: currentJob.job_key,
          상품명: product.productName,
          상품코드: product.productCode,
          센터명: "",
          협력사명: partnerName,
          발주수량: product.totalQty || 0,
          행사여부: product.eventInfo?.행사여부 || "",
          행사명: product.eventInfo?.행사명 || "",
          처리유형: "교환",
          회송수량: 0,
          교환수량: nextQty,
          비고: memo,
          사진: photoPayload,
          전체발주수량: product.totalQty || 0,
        });
      }

      const savedRecords = [];
      for (const payload of tasks) {
        const saved = await saveSingleRecord(payload);
        if (saved) savedRecords.push(saved);
      }

      if (savedRecords.length > 0) {
        const reloaded = await (async () => {
          const response = await fetch(`${SCRIPT_URL}?action=getRecords`);
          const result = await response.json();
          if (!response.ok || result.ok === false) {
            throw new Error(result.message || "내역 불러오기 실패");
          }
          return Array.isArray(result.records) ? result.records : [];
        })();

        reloaded.sort((a, b) =>
          String(b.작성일시 || "").localeCompare(String(a.작성일시 || ""), "ko")
        );
        setHistoryRows(reloaded);
      }

      setDrafts((prev) => ({
        ...prev,
        [draftKey]: {
          returnQty: "",
          exchangeQty: "",
          memo: "",
          photoFile: null,
          photoName: "",
        },
      }));

      setToast("저장 완료");
    } catch (err) {
      setError(err.message || "기록 저장 실패");
    } finally {
      setSavingKey("");
    }
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
      await deleteSingleRecordByRow(rowNumber);
      setHistoryRows((prev) => prev.filter((item) => Number(item.__rowNumber) !== rowNumber));
      setToast("삭제 완료");
    } catch (err) {
      setError(err.message || "내역 삭제 실패");
    } finally {
      setDeletingRowNumber(null);
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

      <div style={styles.headerCard}>
        <h1 style={styles.title}>GS신선강화지원팀</h1>
        <p style={styles.subtitle}>승호</p>
      </div>

      <div style={styles.tabRow}>
        <button
          type="button"
          onClick={() => setMode("return")}
          style={{ ...styles.tabButton, ...(mode === "return" ? styles.tabButtonActive : {}) }}
        >
          회송 / 교환
        </button>
        <button
          type="button"
          onClick={() => setMode("inspection")}
          style={{ ...styles.tabButton, ...(mode === "inspection" ? styles.tabButtonActive : {}) }}
        >
          검품수량
        </button>
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
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={styles.primaryButton}
          >
            {uploadingCsv ? "처리 중..." : "CSV 선택"}
          </button>
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
          <button type="button" onClick={() => setIsScannerOpen(true)} style={styles.scanButton}>
            바코드
          </button>
        </div>
      </div>

      {(bootLoading || uploadingCsv || error || message) && (
        <div style={error ? styles.errorBox : styles.infoBox}>
          {bootLoading
            ? "초기 데이터 불러오는 중..."
            : uploadingCsv
            ? "CSV 처리 중..."
            : error || message}
        </div>
      )}

      <div style={styles.countRow}>
        <div style={styles.countText}>총 {groupedPartners.reduce((sum, item) => sum + item.products.length, 0)}건</div>
        <button
          type="button"
          onClick={async () => {
            const next = !showHistory;
            setShowHistory(next);
            if (next) {
              await loadHistoryRows();
            }
          }}
          style={styles.historyButton}
        >
          {showHistory ? "내역 닫기" : "내역 보기"}
        </button>
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
                    const isOpen = expandedProductCode === `${partnerGroup.partner}__${product.productCode}`;
                    const selectedCenter =
                      selectedCenterByProduct[product.productCode] || product.centers[0]?.center || "";
                    const selectedCenterInfo =
                      product.centers.find((item) => item.center === selectedCenter) || null;

                    const draftKey =
                      mode === "inspection"
                        ? `inspection||${product.productCode}||${selectedCenter}`
                        : `return||${product.productCode}||${selectedCenter}`;
                    const draft = drafts[draftKey] || {};

                    return (
                      <div key={`${partnerGroup.partner}-${product.productCode}`} style={styles.card}>
                        <button
                          type="button"
                          style={styles.cardButton}
                          onClick={() => {
                            const nextKey = `${partnerGroup.partner}__${product.productCode}`;
                            setExpandedProductCode((prev) => (prev === nextKey ? "" : nextKey));
                            setSelectedCenterByProduct((prev) => ({
                              ...prev,
                              [product.productCode]:
                                prev[product.productCode] || product.centers[0]?.center || "",
                            }));
                          }}
                        >
                          <div style={styles.cardTopRow}>
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
                                    [product.productCode]: e.target.value,
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

                            {mode === "inspection" ? (
                              <>
                                <div style={styles.formGroup}>
                                  <label style={styles.label}>검품수량</label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={draft.inspectionQty || ""}
                                    onChange={(e) =>
                                      updateDraft(draftKey, "inspectionQty", e.target.value)
                                    }
                                    style={styles.input}
                                  />
                                </div>

                                <button
                                  type="button"
                                  onClick={() => saveInspectionQty(product, selectedCenter)}
                                  disabled={savingKey === draftKey}
                                  style={styles.saveButton}
                                >
                                  {savingKey === draftKey ? "저장 중..." : "저장"}
                                </button>
                              </>
                            ) : (
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
                                    onChange={(e) => {
                                      const file = e.target.files?.[0] || null;
                                      updateDraft(draftKey, "photoFile", file);
                                      updateDraft(draftKey, "photoName", file?.name || "");
                                    }}
                                    style={styles.fileInput}
                                  />
                                  <div style={styles.metaText}>{draft.photoName || "선택된 사진 없음"}</div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => saveReturnExchange(product, selectedCenter)}
                                  disabled={savingKey === draftKey}
                                  style={styles.saveButton}
                                >
                                  {savingKey === draftKey ? "저장 중..." : "저장"}
                                </button>
                              </>
                            )}
                          </div>
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
              <div style={styles.emptyBox}>저장된 내역이 없습니다.</div>
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

                    {record.사진URL ? (
                      <div style={styles.photoWrap}>
                        <img
                          src={record.사진URL}
                          alt="첨부사진"
                          style={styles.photoPreview}
                          onClick={() => setZoomPhotoUrl(record.사진URL)}
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {zoomPhotoUrl && (
        <div style={styles.photoOverlay} onClick={() => setZoomPhotoUrl("")}>
          <img src={zoomPhotoUrl} alt="확대사진" style={styles.photoZoom} />
        </div>
      )}

      {isScannerOpen && (
        <div style={styles.scannerOverlay} onClick={closeScanner}>
          <div style={styles.scannerModal} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={closeScanner} style={styles.scannerCloseBtn}>
              ×
            </button>

            <div style={styles.scannerTopText}>{scannerReady ? scannerStatus : "바코드 인식 중..."}</div>

            <div style={styles.scannerViewport}>
              <video ref={scannerVideoRef} style={styles.scannerVideo} muted playsInline />
              <div style={styles.scannerGuideBox} />
            </div>

            <div style={styles.scannerHelperText}>바코드를 화면 중앙에 맞춰주세요</div>

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
  csvHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
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
    minWidth: 88,
    minHeight: 48,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
    flexShrink: 0,
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
  cardTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    paddingRight: 28,
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
