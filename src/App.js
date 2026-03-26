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

  if (tMatch) {
    text = tMatch[1];
  }

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
  if (isBrokenText(text)) {
    text = tryDecode("euc-kr");
  }

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
  const returnQty = parseQty(record.회송수량);
  const exchangeQty = parseQty(record.교환수량);

  if (returnQty > 0 && exchangeQty > 0) return "회송 / 교환";
  if (returnQty > 0) return "회송";
  if (exchangeQty > 0) return "교환";
  return "기타";
};

const getRecordQtyText = (record) => {
  const returnQty = parseQty(record.회송수량);
  const exchangeQty = parseQty(record.교환수량);

  if (returnQty > 0 && exchangeQty > 0) {
    return `회송 ${returnQty}개 / 교환 ${exchangeQty}개`;
  }
  if (returnQty > 0) return `${returnQty}개`;
  if (exchangeQty > 0) return `${exchangeQty}개`;
  return "0개";
};

function App() {
  const [rows, setRows] = useState([]);
  const [currentJob, setCurrentJob] = useState(null);
  const [currentFileName, setCurrentFileName] = useState("");
  const [currentFileModifiedAt, setCurrentFileModifiedAt] = useState("");
  const [search, setSearch] = useState("");
  const [expandedProductCode, setExpandedProductCode] = useState("");
  const [selectedCenterByProduct, setSelectedCenterByProduct] = useState({});
  const [drafts, setDrafts] = useState({});
  const [bootLoading, setBootLoading] = useState(true);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [deletingRowNumber, setDeletingRowNumber] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [excludedProductCodes, setExcludedProductCodes] = useState(new Set());
  const [excludedPairKeys, setExcludedPairKeys] = useState(new Set());
  const [eventMap, setEventMap] = useState({});

  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerReady, setScannerReady] = useState(false);

  const fileInputRef = useRef(null);
  const scannerVideoRef = useRef(null);
  const scannerReaderRef = useRef(null);
  const scannerControlsRef = useRef(null);

  const stopScanner = () => {
    try {
      if (scannerControlsRef.current) {
        scannerControlsRef.current.stop();
      }
    } catch (_) {}
    scannerControlsRef.current = null;
    scannerReaderRef.current = null;
    setScannerReady(false);
  };

  const startScanner = async () => {
    try {
      setScannerError("");
      setScannerReady(false);

      const reader = new BrowserMultiFormatReader();
      scannerReaderRef.current = reader;

      const devices = await BrowserCodeReader.listVideoInputDevices();
      const backCamera =
        devices.find((device) =>
          /back|rear|environment|후면|외부/i.test(String(device.label || ""))
        ) || devices[0];

      const callback = (result, err, controls) => {
        if (controls) {
          scannerControlsRef.current = controls;
        }

        if (result) {
          const scanned = String(
            typeof result.getText === "function" ? result.getText() : result.text || result
          )
            .replace(/\s+/g, "")
            .trim();

          if (scanned) {
            setSearch(scanned);
            stopScanner();
            setIsScannerOpen(false);
          }
        }

        if (!scannerReady) {
          setScannerReady(true);
        }

        if (err && err.name && err.name !== "NotFoundException") {
          setScannerError("바코드 인식 중 오류가 발생했습니다.");
        }
      };

      if (backCamera?.deviceId) {
        const controls = await reader.decodeFromVideoDevice(
          backCamera.deviceId,
          scannerVideoRef.current,
          callback
        );
        scannerControlsRef.current = controls;
      } else {
        const controls = await reader.decodeFromConstraints(
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
        scannerControlsRef.current = controls;
      }
    } catch (err) {
      setScannerError(err.message || "카메라를 시작할 수 없습니다.");
      stopScanner();
    }
  };

  useEffect(() => {
    if (!isScannerOpen) {
      stopScanner();
      return undefined;
    }

    startScanner();

    return () => {
      stopScanner();
    };
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
        const startDate = String(getValue(row, ["시작일"]) || "").trim();
        const endDate = String(getValue(row, ["종료일"]) || "").trim();
        const useFlag = getValue(row, ["사용여부"]);

        if (!productCode) return;
        if (isExplicitFalseUsage(useFlag)) return;

        nextEventMap[productCode] = {
          행사여부: "행사",
          행사명: eventName,
          시작일: startDate,
          종료일: endDate,
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
      console.log("historyRows length:", nextRows.length);
    } catch (err) {
      setError(err.message || "내역 불러오기 실패");
      setHistoryRows([]);
      console.log("historyRows length:", 0);
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

  const productCards = useMemo(() => {
    const keyword = normalizeText(search);
    const grouped = {};

    filteredRows.forEach((row) => {
      const productCode = normalizeProductCode(row.__productCode);
      const productName = row.__productName || "상품명 없음";
      const partner = row.__partner || "협력사없음";
      const center = row.__center || "센터없음";
      const qty = row.__qty || 0;

      if (!grouped[productCode]) {
        grouped[productCode] = {
          productCode,
          productName,
          totalQty: 0,
          partners: new Set(),
          centers: {},
          eventInfo: eventMap[productCode] || null,
        };
      }

      grouped[productCode].totalQty += qty;
      grouped[productCode].partners.add(partner);

      if (!grouped[productCode].centers[center]) {
        grouped[productCode].centers[center] = {
          center,
          totalQty: 0,
          rows: [],
        };
      }

      grouped[productCode].centers[center].totalQty += qty;
      grouped[productCode].centers[center].rows.push(row);
    });

    return Object.values(grouped)
      .map((product) => ({
        ...product,
        centerList: Object.values(product.centers).sort(
          (a, b) => (b.totalQty || 0) - (a.totalQty || 0)
        ),
        partnerText: Array.from(product.partners).join(", "),
      }))
      .filter((product) => {
        if (!keyword) return true;
        return (
          normalizeText(product.productName).includes(keyword) ||
          normalizeText(product.partnerText).includes(keyword) ||
          String(product.productCode || "").includes(search.trim())
        );
      })
      .sort(
        (a, b) =>
          (b.totalQty || 0) - (a.totalQty || 0) ||
          a.productName.localeCompare(b.productName, "ko")
      );
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

  const cacheCsvJob = async (normalizedRows, file) => {
    const nextJobKey = computeJobKey(normalizedRows);

    if (currentJob?.job_key === nextJobKey) {
      setRows(normalizedRows);
      setCurrentFileName(file.name);
      setCurrentFileModifiedAt(new Date(file.lastModified).toISOString());
      setMessage("같은 CSV 작업으로 인식되어 기존 작업을 유지합니다.");
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
    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "CSV 작업 캐시 저장 실패");
    }

    const nextJob = result.job || null;
    setCurrentJob(nextJob);
    setRows(normalizedRows);
    setCurrentFileName(file.name);
    setCurrentFileModifiedAt(new Date(file.lastModified).toISOString());
    setDrafts({});
    setExpandedProductCode("");
    setSelectedCenterByProduct({});
    setMessage("새 CSV 작업이 저장되었습니다.");
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
              const normalizedRows = buildNormalizedRows(result.data || []);
              await cacheCsvJob(normalizedRows, file);
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          error: () => reject(new Error("CSV 파싱 중 오류 발생")),
        });
      });
    } catch (err) {
      setError(err.message || "CSV 업로드 실패");
    } finally {
      setUploadingCsv(false);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const saveRecord = async (product, centerName) => {
    const centerInfo = product.centerList.find((item) => item.center === centerName);
    if (!centerInfo) {
      setError("센터를 선택해줘.");
      return;
    }

    const draftKey = `${product.productCode}||${centerName}`;
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

    const partnerNames = Array.from(
      new Set(centerInfo.rows.map((row) => row.__partner).filter(Boolean))
    ).join(", ");

    try {
      setSavingKey(draftKey);
      setError("");
      setMessage("");

      const photoPayload = await fileToBase64(photoFile);

      const response = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "saveRecord",
          payload: {
            작성일시: new Date().toISOString(),
            작업기준일또는CSV식별값: currentJob.job_key,
            상품명: product.productName,
            상품코드: product.productCode,
            센터명: centerName,
            협력사명: partnerNames,
            발주수량: centerInfo.totalQty || 0,
            행사여부: product.eventInfo?.행사여부 || "",
            행사명: product.eventInfo?.행사명 || "",
            회송수량: returnQty,
            교환수량: exchangeQty,
            비고: memo,
            사진: photoPayload,
          },
        }),
      });

      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "기록 저장 실패");
      }

      const savedRecord = result.record || null;

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

      if (savedRecord) {
        setHistoryRows((prev) =>
          [savedRecord, ...prev].sort((a, b) =>
            String(b.작성일시 || "").localeCompare(String(a.작성일시 || ""), "ko")
          )
        );
      }

      setMessage("기록이 저장되었습니다.");
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
      setError("");
      setMessage("");

      const response = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "deleteRecord",
          payload: {
            rowNumber,
          },
        }),
      });

      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "내역 삭제 실패");
      }

      setHistoryRows((prev) => prev.filter((item) => Number(item.__rowNumber) !== rowNumber));
      setMessage("내역이 삭제되었습니다.");
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품명 / 상품코드 / 협력사 검색"
            style={styles.searchInput}
          />
          <button
            type="button"
            onClick={() => {
              setScannerError("");
              setIsScannerOpen(true);
            }}
            style={styles.scanButton}
          >
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
        <div style={styles.countText}>총 {productCards.length}건</div>
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
        {productCards.length === 0 ? (
          <div style={styles.emptyBox}>표시할 상품이 없습니다.</div>
        ) : (
          productCards.map((product) => {
            const isOpen = expandedProductCode === product.productCode;
            const selectedCenter =
              selectedCenterByProduct[product.productCode] || product.centerList[0]?.center || "";
            const selectedCenterInfo =
              product.centerList.find((item) => item.center === selectedCenter) || null;
            const draftKey = `${product.productCode}||${selectedCenter}`;
            const draft = drafts[draftKey] || {};

            return (
              <div key={product.productCode} style={styles.card}>
                <button
                  type="button"
                  style={styles.cardButton}
                  onClick={() => {
                    setExpandedProductCode((prev) =>
                      prev === product.productCode ? "" : product.productCode
                    );
                    setSelectedCenterByProduct((prev) => ({
                      ...prev,
                      [product.productCode]:
                        prev[product.productCode] || product.centerList[0]?.center || "",
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
                  <div style={styles.cardMeta}>협력사 {product.partnerText || "-"}</div>
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
                        {product.centerList.map((center) => (
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
                          협력사:{" "}
                          {Array.from(
                            new Set(
                              selectedCenterInfo.rows.map((row) => row.__partner).filter(Boolean)
                            )
                          ).join(", ") || "-"}
                        </div>
                        <div style={styles.metaText}>
                          행사: {product.eventInfo?.행사여부 || ""}
                          {product.eventInfo?.행사명 ? ` (${product.eventInfo.행사명})` : ""}
                        </div>
                      </div>
                    )}

                    <div style={styles.grid2}>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>회송수량</label>
                        <input
                          type="number"
                          min="0"
                          value={draft.returnQty || ""}
                          onChange={(e) => updateDraft(draftKey, "returnQty", e.target.value)}
                          style={styles.input}
                        />
                      </div>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>교환수량</label>
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
                      onClick={() => saveRecord(product, selectedCenter)}
                      disabled={savingKey === draftKey}
                      style={styles.saveButton}
                    >
                      {savingKey === draftKey ? "저장 중..." : "저장"}
                    </button>
                  </div>
                )}
              </div>
            );
          })
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
                        <img src={record.사진URL} alt="첨부사진" style={styles.photoPreview} />
                        <a
                          href={record.사진URL}
                          target="_blank"
                          rel="noreferrer"
                          style={styles.photoLink}
                        >
                          사진 열기
                        </a>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {isScannerOpen && (
        <div style={styles.sheetOverlay} onClick={() => setIsScannerOpen(false)}>
          <div style={styles.scannerSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} />
            <div style={styles.sheetHeader}>
              <h2 style={styles.sheetTitle}>바코드 스캔</h2>
              <button type="button" onClick={() => setIsScannerOpen(false)} style={styles.sheetClose}>
                닫기
              </button>
            </div>

            <div style={styles.scannerFrame}>
              <video ref={scannerVideoRef} style={styles.scannerVideo} muted playsInline />
              <div style={styles.scannerGuide} />
            </div>

            <div style={styles.metaText}>
              {scannerReady
                ? "바코드를 화면 중앙에 맞춰주세요."
                : "후면 카메라를 준비하고 있습니다..."}
            </div>

            {scannerError ? <div style={styles.errorBox}>{scannerError}</div> : null}
          </div>
        </div>
      )}
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
    lineHeight: 1.5,
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
    whiteSpace: "nowrap",
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
    marginTop: 2,
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
    padding: 0,
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
  scannerSheet: {
    width: "100%",
    maxWidth: 760,
    background: "#fff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: "10px 14px 20px",
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
  },
  photoLink: {
    display: "inline-block",
    marginTop: 8,
    fontSize: 13,
    color: "#2563eb",
    textDecoration: "none",
    fontWeight: 700,
  },
  scannerFrame: {
    position: "relative",
    width: "100%",
    aspectRatio: "3 / 4",
    borderRadius: 18,
    overflow: "hidden",
    background: "#111827",
  },
  scannerVideo: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  scannerGuide: {
    position: "absolute",
    inset: "18% 10%",
    border: "2px solid rgba(255,255,255,0.9)",
    borderRadius: 20,
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.18)",
    pointerEvents: "none",
  },
};

export default App;
