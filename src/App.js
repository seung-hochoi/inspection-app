import React, { useEffect, useMemo, useState, useDeferredValue } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

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

  const [excludeText, setExcludeText] = useState("");
  const [eventEdits, setEventEdits] = useState({});

  const [excludeFileName, setExcludeFileName] = useState("");
  const [eventFileName, setEventFileName] = useState("");
  const [preorderFileName, setPreorderFileName] = useState("");

  const [excludeCodeSet, setExcludeCodeSet] = useState(new Set());
  const [excludePartnerSet, setExcludePartnerSet] = useState(new Set());
  const [eventCodeSet, setEventCodeSet] = useState(new Set());
  const [preorderMap, setPreorderMap] = useState({});
  const [unmatchedPreorderRows, setUnmatchedPreorderRows] = useState([]);

  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== "undefined") {
        setIsMobileView(window.innerWidth <= 768);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const normalizeKey = (key) => String(key || "").replace(/\uFEFF/g, "").trim();

  const normalizeText = (value) => {
    return String(value ?? "")
      .replace(/\uFEFF/g, "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  };

  const cleanCode = (value) => {
    if (value == null) return "";

    let text = String(value).replace(/\uFEFF/g, "").trim();
    const tMatch = text.match(/^=T\("(.+)"\)$/i);

    if (tMatch) {
      text = tMatch[1];
    }

    text = text.replace(/^"+|"+$/g, "").trim();
    return text;
  };

  const digitsOnly = (value) => String(value || "").replace(/\D/g, "");

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

  const makePairKey = (productCode, center) => `${productCode}||${center}`;

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

    const isBrokenText = (text) => {
      const brokenCharCount = (text.match(/�/g) || []).length;
      return brokenCharCount > 5;
    };

    let text = tryDecode("utf-8");

    if (isBrokenText(text)) {
      text = tryDecode("euc-kr");
    }

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

    return {
      sheetName: firstSheetName,
      rows: json.map((row) => {
        const normalizedRow = {};
        Object.keys(row || {}).forEach((key) => {
          normalizedRow[normalizeKey(key)] = row[key];
        });
        return normalizedRow;
      }),
    };
  };

  const buildNormalizedRows = (parsedRows) => {
    return parsedRows.map((rawRow, index) => {
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
      const productCodeDigits = digitsOnly(productCode);
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
        __productCodeDigits: productCodeDigits,
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
  };

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
      product.partnerKeywords = Array.from(product.partnerSet || []).sort((a, b) => a.localeCompare(b, "ko"));
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

    if (stripped) {
      tokens.add(stripped);
    }

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
      const aliasTarget = centerAliasOverrides[token] || centerAliasOverrides[normalizeText(token)] || "";
      if (aliasTarget && availableCenterNames.includes(aliasTarget)) {
        return aliasTarget;
      }
    }

    for (const token of rawTokens) {
      const found = normalizedMap[normalizeText(token)];
      if (found) return found;
    }

    for (const center of availableCenterNames) {
      const centerNorm = normalizeText(center);
      const rawNorm = normalizeText(raw);
      if (centerNorm.includes(rawNorm) || rawNorm.includes(centerNorm)) {
        return center;
      }
    }

    return "";
  };

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
      const totalQty = centerValues.reduce((sum, item) => sum + (item.qty || 0), 0);
      const preorderQty = centerValues.reduce((sum, item) => sum + (item.preorderQty || 0), 0);
      const totalRowCount = centerValues.reduce((sum, item) => sum + (item.rowCount || 0), 0);

      if (centerValues.length === 0) return;

      nextProductMap[productCode] = {
        ...product,
        centers: nextCenters,
        totalQty,
        preorderQty,
        totalRowCount,
        event: eventCodeSet.has(productCode) ? "행사" : product.__event || "",
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

    return {
      nextProductMap,
      nextSupplierSummary,
    };
  };

  const rebuildData = (normalizedRows) => {
    const baseProductMap = buildProductMap(normalizedRows);
    const baseSupplierSummary = buildSupplierSummary(normalizedRows);
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

    const centers = nextSelectedProductCode ? Object.keys(nextProductMap[nextSelectedProductCode]?.centers || {}) : [];
    const keepCenter = selectedCenter && centers.includes(selectedCenter);
    setSelectedCenter(keepCenter ? selectedCenter : centers[0] || "");
  };

  useEffect(() => {
    rebuildData(rows);
  }, [rows, excludeCodeSet, excludePartnerSet, eventCodeSet, preorderMap]);

  useEffect(() => {
    setShowAllReturnHistory(false);
  }, [selectedProductCode, fileName]);

  const handleCsvUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setFileName(file.name);
      setError("");
      setShowAllReturnHistory(false);
      const { text } = await decodeCsvFile(file);

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          const normalizedRows = buildNormalizedRows(result.data || []);
          setRows(normalizedRows);
        },
        error: () => {
          setError("CSV 파싱 중 오류 발생");
        },
      });
    } catch (e) {
      setError("CSV 읽기 실패");
    }
  };

  const handleExcludeFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const workbook = XLSX.read(await readFileAsArrayBuffer(file), { type: "array" });
      const codeSheet = workbook.Sheets["코드제외"];
      const partnerSheet = workbook.Sheets["협력사제외"];

      const codeRows = codeSheet
        ? XLSX.utils.sheet_to_json(codeSheet, { defval: "", raw: false }).map((row) => {
            const normalizedRow = {};
            Object.keys(row || {}).forEach((key) => {
              normalizedRow[normalizeKey(key)] = row[key];
            });
            return normalizedRow;
          })
        : [];

      const partnerRows = partnerSheet
        ? XLSX.utils.sheet_to_json(partnerSheet, { defval: "", raw: false }).map((row) => {
            const normalizedRow = {};
            Object.keys(row || {}).forEach((key) => {
              normalizedRow[normalizeKey(key)] = row[key];
            });
            return normalizedRow;
          })
        : [];

      const nextExcludeCodeSet = new Set(
        codeRows
          .map((row) => cleanCode(getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])))
          .filter(Boolean)
      );

      const nextExcludePartnerSet = new Set(
        partnerRows
          .map((row) => String(getValue(row, ["협력사", "거래처명", "거래처명(구매조건명)"]) || "").trim())
          .filter(Boolean)
      );

      setExcludeFileName(file.name);
      setExcludeCodeSet(nextExcludeCodeSet);
      setExcludePartnerSet(nextExcludePartnerSet);
      setExcludeText(
        [
          `코드제외 ${nextExcludeCodeSet.size}건`,
          `협력사제외 ${nextExcludePartnerSet.size}건`,
        ].join(" / ")
      );
    } catch (e) {
      setError("제외목록 업로드 실패");
    }
  };

  const handleEventFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const { rows: eventRows } = await parseWorkbookRows(file);
      const nextEventCodeSet = new Set(
        eventRows
          .map((row) => cleanCode(getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])))
          .filter(Boolean)
      );

      setEventFileName(file.name);
      setEventCodeSet(nextEventCodeSet);
    } catch (e) {
      setError("행사표 업로드 실패");
    }
  };

  const handlePreorderFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const { rows: preorderRows } = await parseWorkbookRows(file);
      const currentProductMap = buildProductMap(rows);
      const nextPreorderMap = {};
      const nextUnmatchedRows = [];

      preorderRows.forEach((row) => {
        const productCode = cleanCode(getValue(row, ["상품코드", "상품 코드", "코드", "바코드"]));
        const deliveryName = String(getValue(row, ["배송처명", "배송처", "센터명", "센터"]) || "").trim();
        const qty = parseQty(getValue(row, ["수량", "주문수량", "예약수량", "합계"]));

        if (!productCode || !deliveryName || !qty) return;

        const availableCenters = Object.keys(currentProductMap[productCode]?.centers || {});
        const matchedCenter = resolveCenterName(deliveryName, availableCenters);

        if (!matchedCenter) {
          nextUnmatchedRows.push({
            상품코드: productCode,
            배송처명: deliveryName,
            수량: qty,
          });
          return;
        }

        const pairKey = makePairKey(productCode, matchedCenter);
        nextPreorderMap[pairKey] = (nextPreorderMap[pairKey] || 0) + qty;
      });

      setPreorderFileName(file.name);
      setPreorderMap(nextPreorderMap);
      setUnmatchedPreorderRows(nextUnmatchedRows);
    } catch (e) {
      setError("사전예약 업로드 실패");
    }
  };

  const filteredProducts = useMemo(() => {
    const keyword = deferredQuery.trim();
    const products = Object.values(productMap);

    if (!keyword) {
      return products.sort((a, b) => (b.totalQty || 0) - (a.totalQty || 0));
    }

    const keywordNormalized = normalizeText(keyword);
    const keywordDigits = digitsOnly(keyword);

    return products
      .map((product) => {
        const code = String(product.productCode || "");
        const name = String(product.productName || "");
        const partnerText = Array.isArray(product.partnerKeywords) ? product.partnerKeywords.join(" ") : "";
        const centerText = Object.keys(product.centers || {}).join(" ");
        let score = 0;

        if (normalizeText(name).includes(keywordNormalized)) score += 100;
        if (normalizeText(partnerText).includes(keywordNormalized)) score += 90;
        if (normalizeText(centerText).includes(keywordNormalized)) score += 70;
        if (code.includes(keyword)) score += 110;
        if (keywordDigits && digitsOnly(code).includes(keywordDigits)) score += 120;

        return {
          product,
          score,
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || (b.product.totalQty || 0) - (a.product.totalQty || 0))
      .map((item) => item.product);
  }, [productMap, deferredQuery]);

  const selectedProduct = useMemo(() => {
    return selectedProductCode ? productMap[selectedProductCode] || null : null;
  }, [productMap, selectedProductCode]);

  const selectedCenterInfo = useMemo(() => {
    if (!selectedProduct || !selectedCenter) return null;
    return selectedProduct.centers[selectedCenter] || null;
  }, [selectedProduct, selectedCenter]);

  const selectedCenterPartners = useMemo(() => {
    return Object.values(selectedCenterInfo?.partners || {}).sort((a, b) => (b.qty || 0) - (a.qty || 0));
  }, [selectedCenterInfo]);

  const supplierList = useMemo(() => {
    return Object.values(supplierSummary)
      .map((supplier) => {
        const products = Object.values(supplier.productMap || {})
          .map((product) => {
            const key = `${supplier.partner}||${product.productCode}`;
            return {
              ...product,
              event: eventEdits[key] ?? product.event ?? "",
            };
          })
          .sort((a, b) => (b.totalQty || 0) - (a.totalQty || 0));

        return {
          ...supplier,
          products,
        };
      })
      .sort((a, b) => (b.totalQty || 0) - (a.totalQty || 0));
  }, [supplierSummary, eventEdits]);

  const returnRows = useMemo(() => {
    const result = [];

    Object.entries(returnInputs).forEach(([key, value]) => {
      const qty = parseQty(value);
      if (qty <= 0) return;

      const [productCode, center, partner] = key.split("||");
      const product = productMap[productCode];
      const centerInfo = product?.centers?.[center];
      const partnerInfo = centerInfo?.partners?.[partner];

      if (!product || !centerInfo || !partnerInfo) return;

      result.push({
        상품명: product.productName || "",
        상품코드: productCode,
        센터: center,
        협력사: partner,
        입고수량: partnerInfo.qty || 0,
        사전예약수량: centerInfo.preorderQty || 0,
        회송수량: qty,
        비고: memoInputs[key] || "",
        작성시간: new Date().toLocaleString("ko-KR"),
      });
    });

    return result;
  }, [returnInputs, memoInputs, productMap]);

  const totalReturnQty = useMemo(() => {
    return returnRows.reduce((sum, row) => sum + parseQty(row.회송수량), 0);
  }, [returnRows]);

  const exportProcessedExcel = () => {
    const processedRows = [];

    Object.values(productMap).forEach((product) => {
      Object.values(product.centers || {}).forEach((centerInfo) => {
        const partners = Object.values(centerInfo.partners || {});

        if (partners.length === 0) {
          processedRows.push({
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
          processedRows.push({
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

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(processedRows.length > 0 ? processedRows : [{ 안내: "가공 데이터 없음" }]),
      "가공데이터"
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(returnRows.length > 0 ? returnRows : [{ 안내: "회송 입력 데이터 없음" }]),
      "회송내역"
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        unmatchedPreorderRows.length > 0 ? unmatchedPreorderRows : [{ 안내: "사전예약 미매칭 없음" }]
      ),
      "사전예약미매칭"
    );

    const supplierExportRows = [];
    supplierList.forEach((supplier) => {
      supplier.products.forEach((product) => {
        supplierExportRows.push({
          협력사: supplier.partner,
          상품코드: product.productCode,
          상품명: product.productName,
          수량: product.totalQty || 0,
          행사: product.event || "",
        });
      });
    });

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(supplierExportRows.length > 0 ? supplierExportRows : [{ 안내: "협력사 집계 없음" }]),
      "협력사집계"
    );

    XLSX.writeFile(workbook, `가공데이터_${Date.now()}.xlsx`);
  };

  const handleSelectProduct = (productCode) => {
    const product = productMap[productCode];
    const firstCenter = Object.keys(product?.centers || {})[0] || "";
    setSelectedProductCode(productCode);
    setSelectedCenter(firstCenter);
  };

  const setReturnQty = (productCode, center, partner, value) => {
    const key = `${productCode}||${center}||${partner}`;
    setReturnInputs((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const setReturnMemo = (productCode, center, partner, value) => {
    const key = `${productCode}||${center}||${partner}`;
    setMemoInputs((prev) => ({
      ...prev,
      [key]: value,
    }));
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
  };

  const renderProductDetail = (product) => {
    if (!product) {
      return <div style={styles.emptyBox}>상품을 선택해줘</div>;
    }

    const centerNames = Object.keys(product.centers || {});
    const currentCenter = selectedCenter && product.centers[selectedCenter] ? selectedCenter : centerNames[0] || "";
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
              <option key={centerName} value={centerName}>
                {centerName}
              </option>
            ))}
          </select>
        </div>

        {currentCenterInfo && (
          <div style={styles.centerBox}>
            <p><strong>선택 센터:</strong> {currentCenterInfo.center}</p>
            <p><strong>센터 입고수량:</strong> {currentCenterInfo.qty || 0}</p>
            <p><strong>사전예약수량:</strong> {currentCenterInfo.preorderQty || 0}</p>
            <p><strong>합산수량:</strong> {(currentCenterInfo.qty || 0) + (currentCenterInfo.preorderQty || 0)}</p>
            <p><strong>센터 내 행 수:</strong> {currentCenterInfo.rowCount || 0}</p>

            <div style={{ marginTop: 16 }}>
              <p style={styles.subTitle}><strong>센터 내 협력사 목록</strong></p>

              {currentCenterPartners.length === 0 && <p>협력사 정보 없음</p>}

              {currentCenterPartners.map((partnerItem, idx) => {
                const inputKey = `${product.productCode}||${currentCenterInfo.center}||${partnerItem.partner}`;

                return (
                  <div key={`${partnerItem.partner}-${idx}`} style={styles.partnerItem}>
                    <p><strong>협력사:</strong> {partnerItem.partner}</p>
                    <p><strong>입고수량:</strong> {partnerItem.qty}</p>
                    <p><strong>행 수:</strong> {partnerItem.rows.length}</p>

                    <div style={styles.returnInputRow}>
                      <input
                        type="number"
                        min="0"
                        value={returnInputs[inputKey] || ""}
                        onChange={(e) =>
                          setReturnQty(product.productCode, currentCenterInfo.center, partnerItem.partner, e.target.value)
                        }
                        placeholder="회송수량"
                        style={styles.smallInput}
                      />

                      <input
                        type="text"
                        value={memoInputs[inputKey] || ""}
                        onChange={(e) =>
                          setReturnMemo(product.productCode, currentCenterInfo.center, partnerItem.partner, e.target.value)
                        }
                        placeholder="불량사유 / 비고"
                        style={styles.memoInput}
                      />

                      <button
                        type="button"
                        onClick={() => resetReturnInput(product.productCode, currentCenterInfo.center, partnerItem.partner)}
                        style={styles.subButton}
                      >
                        초기화
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={styles.returnHistoryBox}>
              <p style={styles.sectionTitle}>회송 내역</p>

              {returnRows.length === 0 && <p>아직 입력된 회송 내역 없음</p>}

              {returnRows.length > 0 && (
                <>
                  <div style={styles.returnSummaryRow}>
                    <button
                      type="button"
                      onClick={() => setShowAllReturnHistory((prev) => !prev)}
                      style={styles.summaryChipButton}
                    >
                      전체 회송 건수: {returnRows.length}
                    </button>

                    <div style={styles.summaryChip}>
                      전체 회송수량: {returnRows.reduce((sum, row) => sum + parseQty(row.회송수량), 0)}
                    </div>
                  </div>

                  {showAllReturnHistory && (
                    <div style={styles.allReturnHistoryBox}>
                      <p style={styles.subTitle}><strong>전체 회송 내역</strong></p>

                      {returnRows
                        .slice()
                        .reverse()
                        .map((row, idx) => (
                          <div key={`${row.상품코드}-${row.센터}-${row.협력사}-${idx}`} style={styles.returnHistoryItem}>
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
                        ))}
                    </div>
                  )}
                </>
              )}

              {productReturnRows.length > 0 ? (
                productReturnRows.map((row, idx) => (
                  <div key={`${row.상품코드}-${row.센터}-${row.협력사}-${idx}`} style={styles.returnHistoryItem}>
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
                ))
              ) : (
                <p>
                  현재 선택 상품에는 아직 회송 입력 없음
                  {returnRows.length > 0 ? " / 위 전체 회송 건수 눌러서 전체 내역 확인 가능" : ""}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>검품 / 회송 관리 앱</h1>

        <div style={styles.uploadGrid}>
          <div style={styles.uploadItem}>
            <label style={styles.label}>기본 CSV</label>
            <input type="file" accept=".csv" onChange={handleCsvUpload} />
            <p style={styles.fileHint}>{fileName || "미업로드"}</p>
          </div>

          <div style={styles.uploadItem}>
            <label style={styles.label}>제외목록.xlsx</label>
            <input type="file" accept=".xlsx,.xls" onChange={handleExcludeFileUpload} />
            <p style={styles.fileHint}>{excludeFileName || "미업로드"}</p>
          </div>

          <div style={styles.uploadItem}>
            <label style={styles.label}>행사표.xlsx</label>
            <input type="file" accept=".xlsx,.xls" onChange={handleEventFileUpload} />
            <p style={styles.fileHint}>{eventFileName || "미업로드"}</p>
          </div>

          <div style={styles.uploadItem}>
            <label style={styles.label}>사전예약.xlsx</label>
            <input type="file" accept=".xlsx,.xls" onChange={handlePreorderFileUpload} />
            <p style={styles.fileHint}>{preorderFileName || "미업로드"}</p>
          </div>
        </div>

        <div style={styles.section}>
          <input
            placeholder="상품명, 상품코드, 거래처명, 센터명 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={styles.input}
          />

          <div style={styles.buttonRow}>
            <button onClick={() => setQuery("")} style={styles.subButton}>검색 초기화</button>
            <button onClick={exportProcessedExcel} style={styles.mainButton}>가공데이터 다운로드</button>
          </div>

          {excludeText && <p style={styles.fileHint}>{excludeText}</p>}
        </div>

        <div style={styles.result}>
          <div style={styles.summaryBox}>
            <p><strong>업로드 행 수:</strong> {rows.length}</p>
            <p><strong>상품 수:</strong> {Object.keys(productMap).length}</p>
            <p><strong>협력사 수:</strong> {Object.keys(supplierSummary).length}</p>
            <p><strong>제외 상품 수:</strong> {excludeCodeSet.size}</p>
            <p><strong>제외 협력사 수:</strong> {excludePartnerSet.size}</p>
            <p><strong>행사 코드 수:</strong> {eventCodeSet.size}</p>
            <p><strong>사전예약 매칭 수:</strong> {Object.keys(preorderMap).length}</p>
            <p><strong>사전예약 미매칭 수:</strong> {unmatchedPreorderRows.length}</p>
            <p><strong>회송 입력 건수:</strong> {returnRows.length}</p>
            <p><strong>총 회송수량:</strong> {totalReturnQty}</p>
          </div>

          {!!error && <div style={styles.errorBox}>{error}</div>}

          <div style={styles.tabRow}>
            <button
              onClick={() => setActiveTab("search")}
              style={{ ...styles.tabButton, ...(activeTab === "search" ? styles.tabButtonActive : {}) }}
            >
              상품 검색
            </button>
            <button
              onClick={() => setActiveTab("supplier")}
              style={{ ...styles.tabButton, ...(activeTab === "supplier" ? styles.tabButtonActive : {}) }}
            >
              협력사 집계
            </button>
          </div>

          {activeTab === "search" && (
            <div style={styles.grid}>
              <div style={styles.leftPane}>
                <div style={styles.sectionTitle}>검색된 상품 목록</div>

                {filteredProducts.length === 0 && <div style={styles.emptyBox}>검색 결과 없음</div>}

                {filteredProducts.map((product) => {
                  const centerCount = Object.keys(product.centers || {}).length;
                  const isSelected = selectedProductCode === product.productCode;

                  return (
                    <div key={product.productCode}>
                      <button
                        onClick={() => handleSelectProduct(product.productCode)}
                        style={{ ...styles.productButton, ...(isSelected ? styles.productButtonActive : {}) }}
                      >
                        <div style={styles.productButtonName}>{product.productName || "(상품명 없음)"}</div>
                        <div style={styles.productButtonText}>상품코드: {product.productCode}</div>
                        <div style={styles.productButtonText}>원본 입고수량: {product.totalQty || 0}</div>
                        <div style={styles.productButtonText}>사전예약수량: {product.preorderQty || 0}</div>
                        <div style={styles.productButtonText}>센터 수: {centerCount}</div>
                        <div style={styles.productButtonText}>거래처: {(product.partnerKeywords || []).slice(0, 2).join(", ")}</div>
                      </button>

                      {isMobileView && isSelected && (
                        <div style={styles.mobileDetailWrap}>
                          {renderProductDetail(product)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {!isMobileView && (
                <div style={styles.rightPane}>
                  <div style={styles.sectionTitle}>선택 상품 상세</div>
                  {renderProductDetail(selectedProduct)}
                </div>
              )}
            </div>
          )}

          {activeTab === "supplier" && (
            <div>
              <div style={styles.sectionTitle}>협력사 집계</div>

              {supplierList.length === 0 && <div style={styles.emptyBox}>협력사 데이터 없음</div>}

              {supplierList.map((supplier) => (
                <div key={supplier.partner} style={styles.supplierCard}>
                  <p style={styles.supplierTitle}>{supplier.partner}</p>
                  <p><strong>총 수량:</strong> {supplier.totalQty}</p>
                  <p><strong>총 행 수:</strong> {supplier.totalRows}</p>
                  <p><strong>상품 수:</strong> {supplier.products.length}</p>

                  <div style={{ marginTop: 12 }}>
                    {supplier.products.slice(0, 50).map((product) => {
                      const eventKey = `${supplier.partner}||${product.productCode}`;
                      return (
                        <div key={`${supplier.partner}-${product.productCode}`} style={styles.supplierProductItem}>
                          <p><strong>상품명:</strong> {product.productName}</p>
                          <p><strong>상품코드:</strong> {product.productCode}</p>
                          <p><strong>총 수량:</strong> {product.totalQty}</p>

                          <div style={{ marginTop: 8 }}>
                            <label style={styles.label}>행사 여부</label>
                            <input
                              type="text"
                              value={eventEdits[eventKey] !== undefined ? eventEdits[eventKey] : product.event || ""}
                              onChange={(e) =>
                                setEventEdits((prev) => ({
                                  ...prev,
                                  [eventKey]: e.target.value,
                                }))
                              }
                              placeholder="행사 입력 가능"
                              style={styles.smallInput}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f5f7fb",
    padding: "20px",
    boxSizing: "border-box",
    fontFamily: "Arial, sans-serif",
  },
  card: {
    maxWidth: "1400px",
    margin: "0 auto",
    background: "#ffffff",
    borderRadius: "20px",
    padding: "24px",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
    boxSizing: "border-box",
  },
  title: {
    margin: "0 0 20px",
    fontSize: "28px",
    fontWeight: 800,
  },
  uploadGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
    marginBottom: "16px",
  },
  uploadItem: {
    border: "1px solid #d7deea",
    borderRadius: "14px",
    padding: "12px",
    background: "#f8fbff",
  },
  label: {
    display: "block",
    fontSize: "14px",
    fontWeight: 700,
    marginBottom: "8px",
  },
  fileHint: {
    margin: "8px 0 0",
    fontSize: "13px",
    color: "#475569",
    wordBreak: "break-all",
  },
  section: {
    border: "1px solid #d7deea",
    borderRadius: "14px",
    padding: "14px",
    marginBottom: "16px",
    background: "#f8fbff",
  },
  input: {
    width: "100%",
    height: "46px",
    borderRadius: "12px",
    border: "1px solid #c8d1e1",
    padding: "0 14px",
    fontSize: "16px",
    boxSizing: "border-box",
  },
  smallInput: {
    width: "100%",
    minWidth: "120px",
    height: "44px",
    borderRadius: "12px",
    border: "1px solid #c8d1e1",
    padding: "0 14px",
    fontSize: "16px",
    boxSizing: "border-box",
    background: "#fff",
  },
  memoInput: {
    flex: 1,
    minWidth: "180px",
    height: "44px",
    borderRadius: "12px",
    border: "1px solid #c8d1e1",
    padding: "0 14px",
    fontSize: "16px",
    boxSizing: "border-box",
    background: "#fff",
  },
  select: {
    width: "100%",
    height: "46px",
    borderRadius: "12px",
    border: "1px solid #c8d1e1",
    padding: "0 14px",
    fontSize: "16px",
    boxSizing: "border-box",
    background: "#fff",
  },
  buttonRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "12px",
  },
  mainButton: {
    height: "42px",
    padding: "0 16px",
    borderRadius: "12px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  subButton: {
    height: "42px",
    padding: "0 16px",
    borderRadius: "12px",
    border: "1px solid #c8d1e1",
    background: "#fff",
    color: "#334155",
    fontWeight: 700,
    cursor: "pointer",
  },
  result: {
    marginTop: "8px",
  },
  summaryBox: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "8px",
    padding: "14px",
    border: "1px solid #d7deea",
    borderRadius: "14px",
    background: "#f8fbff",
    marginBottom: "16px",
  },
  errorBox: {
    marginBottom: "16px",
    padding: "12px 14px",
    borderRadius: "12px",
    background: "#fee2e2",
    color: "#b91c1c",
    fontWeight: 700,
  },
  tabRow: {
    display: "flex",
    gap: "8px",
    marginBottom: "16px",
  },
  tabButton: {
    height: "40px",
    padding: "0 16px",
    borderRadius: "12px",
    border: "1px solid #c8d1e1",
    background: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  tabButtonActive: {
    background: "#0f172a",
    color: "#fff",
    borderColor: "#0f172a",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
  },
  leftPane: {
    minWidth: 0,
  },
  rightPane: {
    minWidth: 0,
  },
  sectionTitle: {
    fontSize: "18px",
    fontWeight: 800,
    marginBottom: "12px",
  },
  subTitle: {
    fontSize: "16px",
    marginBottom: "10px",
  },
  emptyBox: {
    border: "1px dashed #c8d1e1",
    borderRadius: "14px",
    padding: "18px",
    color: "#64748b",
    background: "#fff",
  },
  productButton: {
    width: "100%",
    textAlign: "left",
    border: "1px solid #d7deea",
    borderRadius: "16px",
    background: "#fff",
    padding: "14px",
    marginBottom: "12px",
    cursor: "pointer",
  },
  productButtonActive: {
    borderColor: "#8aa4ff",
    background: "#f6f8ff",
  },
  productButtonName: {
    fontWeight: 800,
    fontSize: "18px",
    marginBottom: "8px",
  },
  productButtonText: {
    fontSize: "15px",
    lineHeight: 1.7,
  },
  mobileDetailWrap: {
    marginBottom: "16px",
  },
  detailBox: {
    border: "1px solid #cfd8ff",
    borderRadius: "18px",
    padding: "16px",
    background: "#f7f9ff",
  },
  centerBox: {
    marginTop: "14px",
    border: "1px solid #d7deea",
    borderRadius: "16px",
    padding: "14px",
    background: "#fff",
  },
  partnerItem: {
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    padding: "14px",
    background: "#f8fafc",
    marginBottom: "12px",
  },
  returnInputRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "12px",
  },
  returnHistoryBox: {
    marginTop: "18px",
    border: "1px solid #d7deea",
    borderRadius: "16px",
    padding: "14px",
    background: "#f8fbff",
  },
  returnSummaryRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginBottom: "14px",
  },
  summaryChipButton: {
    height: "42px",
    padding: "0 16px",
    borderRadius: "999px",
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontWeight: 800,
    cursor: "pointer",
  },
  summaryChip: {
    display: "inline-flex",
    alignItems: "center",
    height: "42px",
    padding: "0 16px",
    borderRadius: "999px",
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontWeight: 800,
  },
  allReturnHistoryBox: {
    marginBottom: "14px",
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid #dbeafe",
    background: "#ffffff",
  },
  returnHistoryItem: {
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    padding: "12px",
    background: "#fff",
    marginBottom: "10px",
  },
  supplierCard: {
    border: "1px solid #d7deea",
    borderRadius: "16px",
    background: "#fff",
    padding: "14px",
    marginBottom: "14px",
  },
  supplierTitle: {
    fontSize: "18px",
    fontWeight: 800,
    margin: "0 0 10px",
  },
  supplierProductItem: {
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    padding: "12px",
    background: "#f8fafc",
    marginBottom: "10px",
  },
};

export default App;
