import React, { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

const DEFAULT_SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbyQTuVHGMwshoNru4MhngK3W3ZPjSkR7e2kBtBTugJL2FDSxFaQODKKsaHRqc6ngLhT/exec";

const normalizeKey = (key) => String(key || "").replace(/\uFEFF/g, "").trim();

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\uFEFF/g, "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const cleanCode = (value) => {
  if (value == null) return "";
  let text = String(value).replace(/\uFEFF/g, "").trim();
  const tMatch = text.match(/^=T\("(.+)"\)$/i);
  if (tMatch) text = tMatch[1];
  return text.replace(/^"+|"+$/g, "").trim();
};

const digitsOnly = (value) => String(value || "").replace(/\D/g, "");

const parseQty = (value) => {
  const num = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isNaN(num) ? 0 : num;
};

const getValue = (row, candidates) => {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return "";
};

const makePairKey = (productCode, center) => `${productCode}||${center}`;

const serializeSet = (setObj) => Array.from(setObj || []);

const readFileAsArrayBuffer = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result);
    reader.onerror = () => reject(new Error("파일 읽기 실패"));
    reader.readAsArrayBuffer(file);
  });

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

const parseWorkbookRows = async (file) => {
  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const json = XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    raw: false,
  });

  return json.map((row) => {
    const normalizedRow = {};
    Object.keys(row || {}).forEach((key) => {
      normalizedRow[normalizeKey(key)] = row[key];
    });
    return normalizedRow;
  });
};

const buildNormalizedRows = (parsedRows) =>
  parsedRows.map((rawRow, index) => {
    const row = {};

    Object.keys(rawRow || {}).forEach((key) => {
      row[normalizeKey(key)] = rawRow[key];
    });

    const productCodeRaw = getValue(row, ["상품코드", "상품 코드", "바코드", "코드"]);
    const productNameRaw = getValue(row, ["상품명", "상품 명", "품목명", "품명"]);
    const partnerRaw = getValue(row, ["거래처명(구매조건명)", "거래처명", "협력사"]);
    const centerRaw = getValue(row, ["센터명", "센터"]);
    const qtyRaw = getValue(row, ["총 발주수량", "발주수량", "수량"]);
    const eventRaw = getValue(row, ["행사여부", "행사 여부", "행사", "프로모션"]);

    const productCode = cleanCode(productCodeRaw);
    const productName = String(productNameRaw || "").trim();
    const partner = String(partnerRaw || "").trim();
    const center = String(centerRaw || "").trim();
    const qty = parseQty(qtyRaw);
    const eventValue = String(eventRaw || "").trim() ? "행사" : "";

    return {
      ...row,
      __id: `${productCode || "empty"}-${center || "nocenter"}-${partner || "nopartner"}-${index}`,
      __index: index,
      __productCode: productCode,
      __productCodeDigits: digitsOnly(productCode),
      __productName: productName,
      __partner: partner,
      __center: center,
      __qty: qty,
      __event: eventValue,
      __productNameNormalized: normalizeText(productName),
      __partnerNormalized: normalizeText(partner),
      __centerNormalized: normalizeText(center),
    };
  });

const buildProductMap = (normalizedRows) => {
  const map = {};

  normalizedRows.forEach((row) => {
    const productCode = row.__productCode;
    const productName = row.__productName;
    const partner = row.__partner || "협력사없음";
    const center = row.__center || "센터없음";
    const qty = row.__qty || 0;

    if (!productCode) return;

    if (!map[productCode]) {
      map[productCode] = {
        productCode,
        productName,
        totalQty: 0,
        totalRowCount: 0,
        centers: {},
        partnerSet: new Set(),
      };
    }

    map[productCode].totalQty += qty;
    map[productCode].totalRowCount += 1;
    map[productCode].partnerSet.add(partner);

    if (!map[productCode].centers[center]) {
      map[productCode].centers[center] = {
        center,
        qty: 0,
        rowCount: 0,
        partners: {},
        rows: [],
      };
    }

    map[productCode].centers[center].qty += qty;
    map[productCode].centers[center].rowCount += 1;
    map[productCode].centers[center].rows.push(row);

    if (!map[productCode].centers[center].partners[partner]) {
      map[productCode].centers[center].partners[partner] = {
        partner,
        qty: 0,
        rows: [],
      };
    }

    map[productCode].centers[center].partners[partner].qty += qty;
    map[productCode].centers[center].partners[partner].rows.push(row);
  });

  Object.values(map).forEach((product) => {
    product.partnerKeywords = Array.from(product.partnerSet || []).sort((a, b) =>
      a.localeCompare(b, "ko")
    );
  });

  return map;
};

const buildSupplierSummary = (normalizedRows) => {
  const summary = {};

  normalizedRows.forEach((row) => {
    const partner = row.__partner || "협력사없음";
    const productCode = row.__productCode || "상품코드없음";
    const productName = row.__productName || "상품명없음";
    const qty = row.__qty || 0;
    const eventValue = row.__event || "";

    if (!summary[partner]) {
      summary[partner] = {
        partner,
        totalQty: 0,
        totalRows: 0,
        productMap: {},
      };
    }

    summary[partner].totalQty += qty;
    summary[partner].totalRows += 1;

    const productKey = `${productCode}__${productName}`;
    if (!summary[partner].productMap[productKey]) {
      summary[partner].productMap[productKey] = {
        productCode,
        productName,
        totalQty: 0,
        totalRows: 0,
        event: eventValue,
      };
    }

    summary[partner].productMap[productKey].totalQty += qty;
    summary[partner].productMap[productKey].totalRows += 1;

    if (!summary[partner].productMap[productKey].event && eventValue) {
      summary[partner].productMap[productKey].event = eventValue;
    }
  });

  return summary;
};

const centerAliasOverrides = {
  고양: "고양1일배센터",
  고양1: "고양1일배센터",
  고양2: "고양2일배센터",
  신오산: "신오산1저온센터",
  신오산1: "신오산1저온센터",
  신오산2: "신오산2저온센터",
  광주: "광주1저온센터",
  광주1: "광주1저온센터",
  광주2: "광주2저온센터",
  포천: "포천1저온센터",
  포천1: "포천1저온센터",
  포천2: "포천2저온센터",
  김포: "김포1저온센터",
  김포1: "김포1저온센터",
  김포2: "김포2일배센터",
  송파: "송파일배센터",
  송파1: "송파일배센터",
  송파2: "송파2일배센터",
  김해: "김해일배센터",
  김해1: "김해일배센터",
  김해2: "김해2일배센터",
  청주: "청주일배센터",
  진주: "진주일배센터",
  해인: "해인벤더",
  발안: "발안일배센터",
  원주: "원주일배센터",
  아신: "아신A벤더",
  아신a: "아신A벤더",
  아신A: "아신A벤더",
  도화: "인천일배센터",
  도화1: "인천일배센터",
  인천: "인천일배센터",
};

const extractCenterTokens = (text) => {
  const source = String(text || "").trim();
  if (!source) return [];

  const compact = source.replace(/\s+/g, "");
  const tokens = new Set([source, compact]);

  const stripped = compact
    .replace(/센터/g, "")
    .replace(/저온/g, "")
    .replace(/상온/g, "")
    .replace(/일배/g, "")
    .replace(/벤더/g, "")
    .replace(/물류/g, "")
    .replace(/배송/g, "")
    .replace(/출하/g, "")
    .replace(/입고/g, "");

  if (stripped) tokens.add(stripped);

  const baseMatch = stripped.match(/^(.+?)(\d+)$/);
  if (baseMatch) {
    tokens.add(baseMatch[1]);
    tokens.add(`${baseMatch[1]}${baseMatch[2]}`);
  }

  return Array.from(tokens).filter(Boolean);
};

const resolveCenterName = (deliveryName, availableCenterNames) => {
  const raw = String(deliveryName || "").trim();
  if (!raw) return "";

  const normalizedMap = {};
  availableCenterNames.forEach((center) => {
    const centerTokens = extractCenterTokens(center);
    centerTokens.forEach((token) => {
      normalizedMap[normalizeText(token)] = center;
    });
    normalizedMap[normalizeText(center)] = center;
  });

  const rawTokens = extractCenterTokens(raw);

  for (const token of rawTokens) {
    const aliasTarget =
      centerAliasOverrides[token] || centerAliasOverrides[normalizeText(token)] || "";
    if (aliasTarget && availableCenterNames.includes(aliasTarget)) return aliasTarget;
  }

  for (const token of rawTokens) {
    const found = normalizedMap[normalizeText(token)];
    if (found) return found;
  }

  for (const center of availableCenterNames) {
    const centerNorm = normalizeText(center);
    const rawNorm = normalizeText(raw);
    if (centerNorm.includes(rawNorm) || rawNorm.includes(centerNorm)) return center;
  }

  return "";
};

const hashString = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return String(hash);
};

const computeRowsSignature = (rows) =>
  hashString(
    JSON.stringify(
      (rows || []).map((row) => ({
        상품코드: row.__productCode,
        상품명: row.__productName,
        센터: row.__center,
        협력사: row.__partner,
        수량: row.__qty,
      }))
    )
  );

function App() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState("search");
  const [isMobileView, setIsMobileView] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );

  const [productMap, setProductMap] = useState({});
  const [supplierSummary, setSupplierSummary] = useState({});
  const [selectedProductCode, setSelectedProductCode] = useState("");
  const [selectedCenter, setSelectedCenter] = useState("");

  const [returnInputs, setReturnInputs] = useState({});
  const [memoInputs, setMemoInputs] = useState({});
  const [showAllReturnHistory, setShowAllReturnHistory] = useState(false);
  const [returnHistory, setReturnHistory] = useState({});

  const [excludeText, setExcludeText] = useState("");
  const [excludeFileName, setExcludeFileName] = useState("");
  const [eventFileName, setEventFileName] = useState("");
  const [preorderFileName, setPreorderFileName] = useState("");

  const [excludeCodeSet, setExcludeCodeSet] = useState(new Set());
  const [excludePartnerSet, setExcludePartnerSet] = useState(new Set());
  const [eventCodeSet, setEventCodeSet] = useState(new Set());
  const [preorderMap, setPreorderMap] = useState({});
  const [unmatchedPreorderRows, setUnmatchedPreorderRows] = useState([]);

  const [scriptUrl, setScriptUrl] = useState(DEFAULT_SCRIPT_URL);
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [csvSignature, setCsvSignature] = useState("");

  const deferredQuery = useDeferredValue(query);
  const hasLoadedRemoteRef = useRef(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== "undefined") setIsMobileView(window.innerWidth <= 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const applyExclusionsAndDecorations = (baseProductMap, baseSupplierSummary) => {
    const nextProductMap = {};

    Object.entries(baseProductMap).forEach(([productCode, product]) => {
      if (excludeCodeSet.has(productCode)) return;

      const nextCenters = {};

      Object.entries(product.centers || {}).forEach(([centerName, centerInfo]) => {
        const nextPartners = {};

        Object.entries(centerInfo.partners || {}).forEach(([partnerName, partnerInfo]) => {
          if (excludePartnerSet.has(partnerName)) return;
          nextPartners[partnerName] = partnerInfo;
        });

        const partnerValues = Object.values(nextPartners);
        const qty = partnerValues.reduce((sum, item) => sum + (item.qty || 0), 0);
        const rowCount = partnerValues.reduce((sum, item) => sum + (item.rows?.length || 0), 0);

        if (partnerValues.length === 0 && !preorderMap[makePairKey(productCode, centerName)]) return;

        nextCenters[centerName] = {
          ...centerInfo,
          partners: nextPartners,
          qty,
          rowCount,
          preorderQty: preorderMap[makePairKey(productCode, centerName)] || 0,
        };
      });

      const centerValues = Object.values(nextCenters);
      if (centerValues.length === 0) return;

      nextProductMap[productCode] = {
        ...product,
        centers: nextCenters,
        totalQty: centerValues.reduce((sum, item) => sum + (item.qty || 0), 0),
        preorderQty: centerValues.reduce((sum, item) => sum + (item.preorderQty || 0), 0),
        totalRowCount: centerValues.reduce((sum, item) => sum + (item.rowCount || 0), 0),
        event: eventCodeSet.has(productCode) ? "행사" : "",
      };
    });

    const nextSupplierSummary = {};
    Object.entries(baseSupplierSummary).forEach(([partnerName, supplier]) => {
      if (excludePartnerSet.has(partnerName)) return;

      const nextProductSummary = {};
      Object.entries(supplier.productMap || {}).forEach(([productKey, product]) => {
        if (excludeCodeSet.has(product.productCode)) return;
        nextProductSummary[productKey] = {
          ...product,
          event: eventCodeSet.has(product.productCode) ? "행사" : product.event || "",
        };
      });

      const products = Object.values(nextProductSummary);
      if (products.length === 0) return;

      nextSupplierSummary[partnerName] = {
        ...supplier,
        productMap: nextProductSummary,
        totalQty: products.reduce((sum, item) => sum + (item.totalQty || 0), 0),
        totalRows: products.reduce((sum, item) => sum + (item.totalRows || 0), 0),
      };
    });

    return { nextProductMap, nextSupplierSummary };
  };

  useEffect(() => {
    const baseProductMap = buildProductMap(rows);
    const baseSupplierSummary = buildSupplierSummary(rows);
    const { nextProductMap, nextSupplierSummary } = applyExclusionsAndDecorations(
      baseProductMap,
      baseSupplierSummary
    );

    setProductMap(nextProductMap);
    setSupplierSummary(nextSupplierSummary);

    const productCodes = Object.keys(nextProductMap);
    const keepCurrent = selectedProductCode && nextProductMap[selectedProductCode];
    const nextSelectedProductCode = keepCurrent ? selectedProductCode : productCodes[0] || "";
    setSelectedProductCode(nextSelectedProductCode);

    const centers = nextSelectedProductCode
      ? Object.keys(nextProductMap[nextSelectedProductCode]?.centers || {})
      : [];
    const keepCenter = selectedCenter && centers.includes(selectedCenter);
    setSelectedCenter(keepCenter ? selectedCenter : centers[0] || "");
  }, [rows, excludeCodeSet, excludePartnerSet, eventCodeSet, preorderMap]);

  const returnRows = useMemo(() => {
    return Object.values(returnHistory)
      .filter((row) => parseQty(row.회송수량) > 0)
      .sort((a, b) => String(b.작성시간).localeCompare(String(a.작성시간), "ko"));
  }, [returnHistory]);

  const totalReturnQty = useMemo(
    () => returnRows.reduce((sum, row) => sum + parseQty(row.회송수량), 0),
    [returnRows]
  );

  const filteredProducts = useMemo(() => {
    const keyword = deferredQuery.trim();
    const products = Object.values(productMap);

    if (!keyword) return products.sort((a, b) => (b.totalQty || 0) - (a.totalQty || 0));

    const keywordNormalized = normalizeText(keyword);
    const keywordDigits = digitsOnly(keyword);

    return products
      .map((product) => {
        const code = String(product.productCode || "");
        const name = String(product.productName || "");
        const partnerText = Array.isArray(product.partnerKeywords)
          ? product.partnerKeywords.join(" ")
          : "";
        const centerText = Object.keys(product.centers || {}).join(" ");

        let score = 0;
        if (normalizeText(name).includes(keywordNormalized)) score += 100;
        if (normalizeText(partnerText).includes(keywordNormalized)) score += 90;
        if (normalizeText(centerText).includes(keywordNormalized)) score += 70;
        if (code.includes(keyword)) score += 110;
        if (keywordDigits && digitsOnly(code).includes(keywordDigits)) score += 120;

        return { product, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || (b.product.totalQty || 0) - (a.product.totalQty || 0))
      .map((item) => item.product);
  }, [productMap, deferredQuery]);

  const supplierList = useMemo(() => {
    return Object.values(supplierSummary)
      .map((supplier) => ({
        ...supplier,
        products: Object.values(supplier.productMap || {}).sort(
          (a, b) => (b.totalQty || 0) - (a.totalQty || 0)
        ),
      }))
      .sort((a, b) => (b.totalQty || 0) - (a.totalQty || 0));
  }, [supplierSummary]);

  const processedRows = useMemo(() => {
    const result = [];

    Object.values(productMap).forEach((product) => {
      Object.values(product.centers || {}).forEach((centerInfo) => {
        const partners = Object.values(centerInfo.partners || {});
        if (partners.length === 0) {
          result.push({
            상품코드: product.productCode,
            상품명: product.productName,
            센터: centerInfo.center,
            협력사: "",
            입고수량: centerInfo.qty || 0,
            사전예약수량: centerInfo.preorderQty || 0,
            합산수량: (centerInfo.qty || 0) + (centerInfo.preorderQty || 0),
            행사: eventCodeSet.has(product.productCode) ? "행사" : "",
          });
        }

        partners.forEach((partner) => {
          result.push({
            상품코드: product.productCode,
            상품명: product.productName,
            센터: centerInfo.center,
            협력사: partner.partner,
            입고수량: partner.qty || 0,
            사전예약수량: centerInfo.preorderQty || 0,
            합산수량: (partner.qty || 0) + (centerInfo.preorderQty || 0),
            행사: eventCodeSet.has(product.productCode) ? "행사" : "",
          });
        });
      });
    });

    return result;
  }, [productMap, eventCodeSet]);

  const buildPayload = () => ({
    meta: {
      active_tab: activeTab,
      query,
      selected_product_code: selectedProductCode,
      selected_center: selectedCenter,
      csv_file_name: fileName,
      exclude_file_name: excludeFileName,
      event_file_name: eventFileName,
      preorder_file_name: preorderFileName,
      csv_signature: csvSignature,
      saved_at: new Date().toISOString(),
    },
    csv_data: rows,
    exclude_codes: serializeSet(excludeCodeSet).map((code) => ({ 상품코드: code })),
    exclude_partners: serializeSet(excludePartnerSet).map((partner) => ({ 협력사: partner })),
    event_codes: serializeSet(eventCodeSet).map((code) => ({ 상품코드: code })),
    preorder_data: Object.entries(preorderMap).map(([key, qty]) => {
      const [상품코드, 센터] = key.split("||");
      return { 상품코드, 센터, 수량: qty };
    }),
    return_history: Object.values(returnHistory),
    unmatched_preorder: unmatchedPreorderRows,
  });

  const loadRemote = async () => {
    if (!scriptUrl.trim()) {
      setError("REACT_APP_GOOGLE_SCRIPT_URL 또는 화면의 Apps Script URL이 필요합니다.");
      setIsBootLoading(false);
      return;
    }

    try {
      setIsBootLoading(true);
      setError("");
      const response = await fetch(`${scriptUrl.trim()}?action=load`);
      const result = await response.json();

      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "불러오기 실패");
      }

      const data = result.data || {};
      const remoteMeta = data.meta || {};
      const remoteRows = Array.isArray(data.csv_data) ? data.csv_data : [];
      const remoteReturnRows = Array.isArray(data.return_history) ? data.return_history : [];
      const remotePreorderRows = Array.isArray(data.preorder_data) ? data.preorder_data : [];
      const remoteExcludeCodes = Array.isArray(data.exclude_codes) ? data.exclude_codes : [];
      const remoteExcludePartners = Array.isArray(data.exclude_partners) ? data.exclude_partners : [];
      const remoteEventCodes = Array.isArray(data.event_codes) ? data.event_codes : [];
      const remoteUnmatched = Array.isArray(data.unmatched_preorder) ? data.unmatched_preorder : [];

      setRows(remoteRows);
      setFileName(remoteMeta.csv_file_name || "");
      setExcludeFileName(remoteMeta.exclude_file_name || "");
      setEventFileName(remoteMeta.event_file_name || "");
      setPreorderFileName(remoteMeta.preorder_file_name || "");
      setQuery(remoteMeta.query || "");
      setActiveTab(remoteMeta.active_tab || "search");
      setSelectedProductCode(remoteMeta.selected_product_code || "");
      setSelectedCenter(remoteMeta.selected_center || "");
      setCsvSignature(remoteMeta.csv_signature || "");

      const excludeCodes = new Set(
        remoteExcludeCodes.map((row) => cleanCode(row.상품코드 || row.code || "")).filter(Boolean)
      );
      const excludePartners = new Set(
        remoteExcludePartners
          .map((row) => String(row.협력사 || row.partner || "").trim())
          .filter(Boolean)
      );
      const eventCodes = new Set(
        remoteEventCodes.map((row) => cleanCode(row.상품코드 || row.code || "")).filter(Boolean)
      );

      const nextPreorderMap = {};
      remotePreorderRows.forEach((row) => {
        const productCode = cleanCode(row.상품코드 || row.product_code || "");
        const center = String(row.센터 || row.center || "").trim();
        const qty = parseQty(row.수량 || row.qty || 0);
        if (productCode && center) nextPreorderMap[makePairKey(productCode, center)] = qty;
      });

      const nextReturnHistory = {};
      remoteReturnRows.forEach((row) => {
        if (row.key) nextReturnHistory[row.key] = row;
      });

      setExcludeCodeSet(excludeCodes);
      setExcludePartnerSet(excludePartners);
      setEventCodeSet(eventCodes);
      setPreorderMap(nextPreorderMap);
      setReturnHistory(nextReturnHistory);
      setUnmatchedPreorderRows(remoteUnmatched);
      setExcludeText(
        [`코드제외 ${excludeCodes.size}건`, `협력사제외 ${excludePartners.size}건`].join(" / ")
      );
      setSyncMessage(remoteMeta.saved_at ? `불러오기 완료 (${remoteMeta.saved_at})` : "불러오기 완료");
    } catch (err) {
      setError(err.message || "Google Sheets 불러오기 실패");
    } finally {
      hasLoadedRemoteRef.current = true;
      setIsBootLoading(false);
    }
  };

  const saveRemote = async () => {
    if (!scriptUrl.trim()) return;
    try {
      setIsSyncing(true);
      setError("");
      setSyncMessage("Google Sheets 저장 중...");

      const response = await fetch(scriptUrl.trim(), {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "save",
          payload: buildPayload(),
        }),
      });

      const result = await response.json();
      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "저장 실패");
      }

      setSyncMessage(`Google Sheets 저장 완료 (${new Date().toLocaleString("ko-KR")})`);
    } catch (err) {
      setError(err.message || "Google Sheets 저장 실패");
      setSyncMessage("저장 실패");
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    loadRemote();
  }, [scriptUrl]);

  useEffect(() => {
    if (!hasLoadedRemoteRef.current) return;
    if (!scriptUrl.trim()) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveRemote();
    }, 1200);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    rows,
    query,
    activeTab,
    selectedProductCode,
    selectedCenter,
    excludeCodeSet,
    excludePartnerSet,
    eventCodeSet,
    preorderMap,
    returnHistory,
    unmatchedPreorderRows,
    fileName,
    excludeFileName,
    eventFileName,
    preorderFileName,
    csvSignature,
    scriptUrl,
  ]);

  const clearReturnDataOnly = () => {
    setReturnInputs({});
    setMemoInputs({});
    setShowAllReturnHistory(false);
    setReturnHistory({});
  };

  const getCurrentReturnSnapshot = (
    productCode,
    center,
    partner,
    qtyValue,
    memoValue,
    existingTime = ""
  ) => {
    const product = productMap[productCode];
    const centerInfo = product?.centers?.[center];
    const partnerInfo = centerInfo?.partners?.[partner];

    return {
      key: `${productCode}||${center}||${partner}`,
      상품명: product?.productName || "",
      상품코드: productCode,
      센터: center,
      협력사: partner,
      입고수량: partnerInfo?.qty || 0,
      사전예약수량: centerInfo?.preorderQty || 0,
      회송수량: parseQty(qtyValue),
      비고: memoValue || "",
      작성시간: existingTime || new Date().toLocaleString("ko-KR"),
    };
  };

  const upsertReturnHistory = (productCode, center, partner, qtyValue, memoValue) => {
    const key = `${productCode}||${center}||${partner}`;
    const qty = parseQty(qtyValue);
    const memo = memoValue || "";

    setReturnHistory((prev) => {
      if (qty <= 0 && !memo) {
        const next = { ...prev };
        delete next[key];
        return next;
      }

      const existing = prev[key];
      return {
        ...prev,
        [key]: getCurrentReturnSnapshot(
          productCode,
          center,
          partner,
          qty,
          memo,
          existing?.작성시간 || ""
        ),
      };
    });
  };

  const handleCsvUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError("");
      const { text } = await decodeCsvFile(file);

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          const normalizedRows = buildNormalizedRows(result.data || []);
          const nextSignature = computeRowsSignature(normalizedRows);
          const isCsvChanged = csvSignature && csvSignature !== nextSignature;

          if (isCsvChanged) clearReturnDataOnly();

          setRows(normalizedRows);
          setFileName(file.name);
          setCsvSignature(nextSignature);
        },
        error: () => setError("CSV 파싱 중 오류 발생"),
      });
    } catch {
      setError("CSV 읽기 실패");
    } finally {
      event.target.value = "";
    }
  };

  const handleExcludeFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError("");
      const workbook = XLSX.read(await readFileAsArrayBuffer(file), { type: "array" });
      const codeSheet = workbook.Sheets["코드제외"];
      const partnerSheet = workbook.Sheets["협력사제외"];

      const codeRows = codeSheet
        ? XLSX.utils.sheet_to_json(codeSheet, { defval: "", raw: false })
        : [];
      const partnerRows = partnerSheet
        ? XLSX.utils.sheet_to_json(partnerSheet, { defval: "", raw: false })
        : [];

      const nextExcludeCodeSet = new Set(
        codeRows
          .map((row) => cleanCode(getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])))
          .filter(Boolean)
      );

      const nextExcludePartnerSet = new Set(
        partnerRows
          .map((row) =>
            String(getValue(row, ["협력사", "거래처명", "거래처명(구매조건명)"]) || "").trim()
          )
          .filter(Boolean)
      );

      setExcludeFileName(file.name);
      setExcludeCodeSet(nextExcludeCodeSet);
      setExcludePartnerSet(nextExcludePartnerSet);
      setExcludeText(
        [`코드제외 ${nextExcludeCodeSet.size}건`, `협력사제외 ${nextExcludePartnerSet.size}건`].join(
          " / "
        )
      );
    } catch {
      setError("제외목록 업로드 실패");
    } finally {
      event.target.value = "";
    }
  };

  const handleEventFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError("");
      const eventRows = await parseWorkbookRows(file);
      const nextEventCodeSet = new Set(
        eventRows
          .map((row) => cleanCode(getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])))
          .filter(Boolean)
      );
      setEventFileName(file.name);
      setEventCodeSet(nextEventCodeSet);
    } catch {
      setError("행사표 업로드 실패");
    } finally {
      event.target.value = "";
    }
  };

  const handlePreorderFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError("");
      const preorderRows = await parseWorkbookRows(file);
      const currentProductMap = buildProductMap(rows);
      const nextPreorderMap = {};
      const nextUnmatchedRows = [];

      preorderRows.forEach((row) => {
        const productCode = cleanCode(getValue(row, ["상품코드", "상품 코드", "코드", "바코드"]));
        const deliveryName = String(
          getValue(row, ["배송처명", "배송처", "센터명", "센터"]) || ""
        ).trim();
        const qty = parseQty(getValue(row, ["수량", "주문수량", "예약수량", "합계"]));

        if (!productCode || !deliveryName || !qty) return;

        const availableCenters = Object.keys(currentProductMap[productCode]?.centers || {});
        const matchedCenter = resolveCenterName(deliveryName, availableCenters);

        if (!matchedCenter) {
          nextUnmatchedRows.push({ 상품코드: productCode, 배송처명: deliveryName, 수량: qty });
          return;
        }

        const pairKey = makePairKey(productCode, matchedCenter);
        nextPreorderMap[pairKey] = (nextPreorderMap[pairKey] || 0) + qty;
      });

      setPreorderFileName(file.name);
      setPreorderMap(nextPreorderMap);
      setUnmatchedPreorderRows(nextUnmatchedRows);
    } catch {
      setError("사전예약 업로드 실패");
    } finally {
      event.target.value = "";
    }
  };

  const setReturnQty = (productCode, center, partner, value) => {
    const key = `${productCode}||${center}||${partner}`;
    setReturnInputs((prev) => ({ ...prev, [key]: value }));
    upsertReturnHistory(productCode, center, partner, value, memoInputs[key] || "");
  };

  const setReturnMemo = (productCode, center, partner, value) => {
    const key = `${productCode}||${center}||${partner}`;
    setMemoInputs((prev) => ({ ...prev, [key]: value }));
    upsertReturnHistory(productCode, center, partner, returnInputs[key] || 0, value);
  };

  const resetReturnInput = (productCode, center, partner) => {
    const key = `${productCode}||${center}||${partner}`;
    setReturnInputs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setMemoInputs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setReturnHistory((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const deleteReturnItem = (key) => {
    setReturnInputs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setMemoInputs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setReturnHistory((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const exportProcessedExcel = () => {
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(processedRows.length ? processedRows : [{ 안내: "가공 데이터 없음" }]),
      "가공데이터"
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(returnRows.length ? returnRows : [{ 안내: "회송 입력 데이터 없음" }]),
      "회송내역"
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        unmatchedPreorderRows.length ? unmatchedPreorderRows : [{ 안내: "사전예약 미매칭 없음" }]
      ),
      "사전예약미매칭"
    );

    XLSX.writeFile(workbook, `가공데이터_${Date.now()}.xlsx`);
  };

  const selectedProduct = selectedProductCode ? productMap[selectedProductCode] || null : null;

  const renderReturnHistoryItem = (row, idx) => (
    <div key={`${row.key}-${idx}`} style={styles.returnHistoryItem}>
      <button type="button" onClick={() => deleteReturnItem(row.key)} style={styles.deleteBtn}>
        ×
      </button>
      <p><strong>상품명:</strong> {row.상품명}</p>
      <p><strong>상품코드:</strong> {row.상품코드}</p>
      <p><strong>센터:</strong> {row.센터}</p>
      <p><strong>협력사:</strong> {row.협력사}</p>
      <p><strong>입고수량:</strong> {row.입고수량}</p>
      <p><strong>사전예약수량:</strong> {row.사전예약수량}</p>
      <p><strong>회송수량:</strong> {row.회송수량}</p>
      <p><strong>비고:</strong> {row.비고 || "-"}</p>
      <p><strong>작성시간:</strong> {row.작성시간}</p>
    </div>
  );

  const renderProductDetail = (product) => {
    if (!product) return <div style={styles.emptyBox}>상품을 선택해줘</div>;

    const centerNames = Object.keys(product.centers || {});
    const currentCenter =
      selectedCenter && product.centers[selectedCenter] ? selectedCenter : centerNames[0] || "";
    const currentCenterInfo = product.centers[currentCenter] || null;
    const currentCenterPartners = Object.values(currentCenterInfo?.partners || {}).sort(
      (a, b) => (b.qty || 0) - (a.qty || 0)
    );

    const productReturnRows = returnRows
      .filter((row) => row.상품코드 === product.productCode)
      .sort((a, b) => String(b.작성시간).localeCompare(String(a.작성시간), "ko"));

    return (
      <div style={styles.detailBox}>
        <p><strong>상품명:</strong> {product.productName || "-"}</p>
        <p><strong>상품코드:</strong> {product.productCode}</p>
        <p><strong>원본 총 입고수량:</strong> {product.totalQty || 0}</p>
        <p><strong>사전예약 총수량:</strong> {product.preorderQty || 0}</p>
        <p><strong>센터 수:</strong> {centerNames.length}</p>
        <p><strong>행사:</strong> {eventCodeSet.has(product.productCode) ? "행사" : "-"}</p>

        <div style={{ marginTop: 16 }}>
          <label style={styles.label}>센터 선택</label>
          <select
            value={currentCenter}
            onChange={(e) => setSelectedCenter(e.target.value)}
            style={styles.select}
          >
            {centerNames.map((centerName) => (
              <option key={centerName} value={centerName}>{centerName}</option>
            ))}
          </select>
        </div>

        {currentCenterInfo && (
          <div style={styles.centerBox}>
            <p><strong>선택 센터:</strong> {currentCenterInfo.center}</p>
            <p><strong>센터 입고수량:</strong> {currentCenterInfo.qty || 0}</p>
            <p><strong>사전예약수량:</strong> {currentCenterInfo.preorderQty || 0}</p>
            <p><strong>합산수량:</strong> {(currentCenterInfo.qty || 0) + (currentCenterInfo.preorderQty || 0)}</p>

            <div style={{ marginTop: 16 }}>
              <p style={styles.subTitle}><strong>센터 내 협력사 목록</strong></p>

              {currentCenterPartners.length === 0 && <p>협력사 정보 없음</p>}

              {currentCenterPartners.map((partnerItem, idx) => {
                const inputKey = `${product.productCode}||${currentCenterInfo.center}||${partnerItem.partner}`;

                return (
                  <div key={`${partnerItem.partner}-${idx}`} style={styles.partnerItem}>
                    <p><strong>협력사:</strong> {partnerItem.partner}</p>
                    <p><strong>입고수량:</strong> {partnerItem.qty}</p>

                    <div style={styles.returnInputRow}>
                      <input
                        type="number"
                        min="0"
                        value={returnInputs[inputKey] || ""}
                        onChange={(e) =>
                          setReturnQty(
                            product.productCode,
                            currentCenterInfo.center,
                            partnerItem.partner,
                            e.target.value
                          )
                        }
                        placeholder="회송수량"
                        style={styles.smallInput}
                      />
                      <input
                        type="text"
                        value={memoInputs[inputKey] || ""}
                        onChange={(e) =>
                          setReturnMemo(
                            product.productCode,
                            currentCenterInfo.center,
                            partnerItem.partner,
                            e.target.value
                          )
                        }
                        placeholder="불량사유 / 비고"
                        style={styles.memoInput}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          resetReturnInput(product.productCode, currentCenterInfo.center, partnerItem.partner)
                        }
                        style={styles.subButton}
                      >
                        초기화
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <p style={styles.subTitle}><strong>회송 입력 내역</strong></p>
          {productReturnRows.length === 0 ? (
            <p>입력된 회송 내역 없음</p>
          ) : (
            <>
              {(showAllReturnHistory ? productReturnRows : productReturnRows.slice(0, 5)).map(
                (row, idx) => renderReturnHistoryItem(row, idx)
              )}
              {productReturnRows.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllReturnHistory((prev) => !prev)}
                  style={styles.subButton}
                >
                  {showAllReturnHistory ? "접기" : `더보기 (${productReturnRows.length - 5}건)`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const tabButton = (key, label) => (
    <button
      type="button"
      onClick={() => setActiveTab(key)}
      style={{
        ...styles.tabBtn,
        ...(activeTab === key ? styles.tabBtnActive : {}),
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <h1 style={styles.title}>검품 / 회송 가공 앱</h1>
        <p style={styles.desc}>
          Google Sheets + Apps Script를 백엔드처럼 사용해서 업로드된 파싱 데이터와 회송내역을 영구 저장합니다.
        </p>
      </div>

      <div style={styles.uploadCard}>
        <label style={styles.label}>Apps Script 웹앱 URL</label>
        <input
          type="text"
          value={scriptUrl}
          onChange={(e) => setScriptUrl(e.target.value)}
          placeholder="https://script.google.com/macros/s/배포URL/exec"
          style={styles.searchInput}
        />
        <div style={styles.helper}>
          브라우저 보안 때문에 로컬 파일 자체는 다시 읽을 수 없어서, 업로드 시 파싱된 데이터 전체를 시트에 저장하는 구조입니다.
        </div>
        <div style={styles.helper}>{syncMessage || "대기 중"}</div>
      </div>

      <div style={{ height: 12 }} />

      <div style={styles.uploadSection}>
        <div style={styles.uploadCard}>
          <label style={styles.label}>원본 CSV</label>
          <input type="file" accept=".csv" onChange={handleCsvUpload} style={styles.fileInput} />
          <div style={styles.fileName}>{fileName || "선택된 파일 없음"}</div>
        </div>

        <div style={styles.uploadCard}>
          <label style={styles.label}>제외목록 엑셀</label>
          <input type="file" accept=".xlsx,.xls" onChange={handleExcludeFileUpload} style={styles.fileInput} />
          <div style={styles.fileName}>{excludeFileName || "선택된 파일 없음"}</div>
          <div style={styles.helper}>{excludeText || "코드제외 / 협력사제외 시트 사용"}</div>
        </div>

        <div style={styles.uploadCard}>
          <label style={styles.label}>행사표 엑셀</label>
          <input type="file" accept=".xlsx,.xls" onChange={handleEventFileUpload} style={styles.fileInput} />
          <div style={styles.fileName}>{eventFileName || "선택된 파일 없음"}</div>
        </div>

        <div style={styles.uploadCard}>
          <label style={styles.label}>사전예약 엑셀</label>
          <input type="file" accept=".xlsx,.xls" onChange={handlePreorderFileUpload} style={styles.fileInput} />
          <div style={styles.fileName}>{preorderFileName || "선택된 파일 없음"}</div>
          <div style={styles.helper}>미매칭 {unmatchedPreorderRows.length}건</div>
        </div>
      </div>

      {(error || isBootLoading || isSyncing) && (
        <div style={styles.errorBox}>
          {error || (isBootLoading ? "Google Sheets에서 불러오는 중..." : "저장 중...")}
        </div>
      )}

      <div style={styles.topActions}>
        <div style={styles.tabRow}>
          {tabButton("search", "상품검색")}
          {tabButton("supplier", "협력사집계")}
          {tabButton("return", "회송내역")}
        </div>

        <div style={styles.actionButtons}>
          <button type="button" onClick={saveRemote} style={styles.subButton}>
            지금 저장
          </button>
          <button type="button" onClick={exportProcessedExcel} style={styles.exportBtn}>
            엑셀 내보내기
          </button>
        </div>
      </div>

      {activeTab === "search" && (
        <div style={styles.mainGrid(isMobileView)}>
          <div style={styles.leftPane}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="상품명 / 상품코드 / 센터 / 협력사 검색"
              style={styles.searchInput}
            />

            <div style={styles.listInfo}>총 {filteredProducts.length}건</div>

            <div style={styles.productList}>
              {filteredProducts.length === 0 ? (
                <div style={styles.emptyBox}>검색 결과 없음</div>
              ) : (
                filteredProducts.map((product) => (
                  <button
                    key={product.productCode}
                    type="button"
                    onClick={() => {
                      setSelectedProductCode(product.productCode);
                      setSelectedCenter(Object.keys(product.centers || {})[0] || "");
                    }}
                    style={{
                      ...styles.productItem,
                      ...(selectedProductCode === product.productCode ? styles.productItemActive : {}),
                    }}
                  >
                    <div style={styles.productItemTop}>
                      <strong>{product.productName || "상품명 없음"}</strong>
                    </div>
                    <div>코드: {product.productCode}</div>
                    <div>입고: {product.totalQty || 0}</div>
                    <div>사전예약: {product.preorderQty || 0}</div>
                    <div>센터수: {Object.keys(product.centers || {}).length}</div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div style={styles.rightPane}>{renderProductDetail(selectedProduct)}</div>
        </div>
      )}

      {activeTab === "supplier" && (
        <div style={styles.sectionBox}>
          <h2 style={styles.sectionTitle}>협력사 집계</h2>

          {supplierList.length === 0 ? (
            <div style={styles.emptyBox}>협력사 집계 없음</div>
          ) : (
            supplierList.map((supplier) => (
              <div key={supplier.partner} style={styles.supplierCard}>
                <div style={styles.supplierHeader}>
                  <strong>{supplier.partner}</strong>
                  <span>총 수량 {supplier.totalQty || 0}, 품목수 {supplier.products.length}</span>
                </div>

                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>상품코드</th>
                        <th style={styles.th}>상품명</th>
                        <th style={styles.th}>수량</th>
                        <th style={styles.th}>행사</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplier.products.map((product) => (
                        <tr key={`${supplier.partner}-${product.productCode}`}>
                          <td style={styles.td}>{product.productCode}</td>
                          <td style={styles.td}>{product.productName}</td>
                          <td style={styles.td}>{product.totalQty || 0}</td>
                          <td style={styles.td}>{product.event || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "return" && (
        <div style={styles.sectionBox}>
          <h2 style={styles.sectionTitle}>회송내역</h2>
          <div style={styles.returnSummary}>총 회송수량: {totalReturnQty}</div>

          {returnRows.length === 0 ? (
            <div style={styles.emptyBox}>회송 입력 데이터 없음</div>
          ) : (
            <div style={styles.returnGrid}>
              {returnRows.map((row, idx) => renderReturnHistoryItem(row, idx))}
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <h3 style={styles.sectionTitle}>사전예약 미매칭</h3>
            {unmatchedPreorderRows.length === 0 ? (
              <div style={styles.emptyBox}>미매칭 없음</div>
            ) : (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>상품코드</th>
                      <th style={styles.th}>배송처명</th>
                      <th style={styles.th}>수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatchedPreorderRows.map((row, idx) => (
                      <tr key={`${row.상품코드}-${row.배송처명}-${idx}`}>
                        <td style={styles.td}>{row.상품코드}</td>
                        <td style={styles.td}>{row.배송처명}</td>
                        <td style={styles.td}>{row.수량}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  app: {
    minHeight: "100vh",
    background: "#f5f7fb",
    padding: 20,
    color: "#1f2937",
    fontFamily: "Arial, sans-serif",
    boxSizing: "border-box",
  },
  header: { marginBottom: 20 },
  title: { margin: 0, fontSize: 28, fontWeight: 800 },
  desc: { marginTop: 8, color: "#6b7280" },
  uploadSection: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    marginBottom: 20,
  },
  uploadCard: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 14,
  },
  label: { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 },
  fileInput: { width: "100%" },
  fileName: { marginTop: 8, fontSize: 12, color: "#374151", wordBreak: "break-all" },
  helper: { marginTop: 6, fontSize: 12, color: "#6b7280", wordBreak: "break-all" },
  errorBox: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 10,
    background: "#fee2e2",
    color: "#991b1b",
    border: "1px solid #fecaca",
  },
  topActions: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  actionButtons: { display: "flex", gap: 8, flexWrap: "wrap" },
  tabRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  tabBtn: {
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#374151",
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },
  tabBtnActive: { background: "#111827", color: "#fff", borderColor: "#111827" },
  exportBtn: {
    border: "none",
    background: "#2563eb",
    color: "#fff",
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },
  mainGrid: (isMobileView) => ({
    display: "grid",
    gridTemplateColumns: isMobileView ? "1fr" : "360px 1fr",
    gap: 16,
    alignItems: "start",
  }),
  leftPane: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 14,
  },
  rightPane: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 14,
    minHeight: 300,
  },
  searchInput: {
    width: "100%",
    padding: 12,
    borderRadius: 10,
    border: "1px solid #d1d5db",
    marginBottom: 10,
    boxSizing: "border-box",
  },
  listInfo: { fontSize: 13, color: "#6b7280", marginBottom: 10 },
  productList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxHeight: "70vh",
    overflow: "auto",
  },
  productItem: {
    textAlign: "left",
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    borderRadius: 10,
    padding: 12,
    cursor: "pointer",
  },
  productItemActive: { border: "1px solid #2563eb", background: "#eff6ff" },
  productItemTop: { marginBottom: 6 },
  detailBox: { display: "flex", flexDirection: "column", gap: 6 },
  centerBox: {
    marginTop: 12,
    padding: 12,
    background: "#f9fafb",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
  },
  subTitle: { margin: "4px 0 10px", fontSize: 15 },
  partnerItem: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    background: "#fff",
  },
  returnInputRow: { display: "grid", gridTemplateColumns: "120px 1fr 90px", gap: 8, marginTop: 10 },
  smallInput: {
    padding: 10,
    borderRadius: 8,
    border: "1px solid #d1d5db",
    width: "100%",
    boxSizing: "border-box",
  },
  memoInput: {
    padding: 10,
    borderRadius: 8,
    border: "1px solid #d1d5db",
    width: "100%",
    boxSizing: "border-box",
  },
  subButton: {
    border: "1px solid #d1d5db",
    background: "#fff",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 700,
    padding: "10px 12px",
  },
  sectionBox: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 16,
  },
  sectionTitle: { marginTop: 0, marginBottom: 12 },
  supplierCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    background: "#f9fafb",
  },
  supplierHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", background: "#fff" },
  th: {
    textAlign: "left",
    padding: 10,
    borderBottom: "1px solid #e5e7eb",
    background: "#f3f4f6",
    fontSize: 13,
  },
  td: {
    padding: 10,
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
    verticalAlign: "top",
  },
  returnSummary: { marginBottom: 12, fontWeight: 700 },
  returnGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 12,
  },
  returnHistoryItem: {
    position: "relative",
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    borderRadius: 12,
    padding: 12,
  },
  deleteBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    border: "none",
    background: "#ef4444",
    color: "#fff",
    width: 24,
    height: 24,
    borderRadius: 999,
    cursor: "pointer",
    fontWeight: 700,
  },
  select: {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    border: "1px solid #d1d5db",
    boxSizing: "border-box",
  },
  emptyBox: {
    padding: 20,
    border: "1px dashed #d1d5db",
    borderRadius: 12,
    color: "#6b7280",
    background: "#fafafa",
  },
};

export default App;
