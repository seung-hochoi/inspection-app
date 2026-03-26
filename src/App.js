
import React, { useMemo, useState, useDeferredValue } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

function App() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState("search");

  const [productMap, setProductMap] = useState({});
  const [supplierSummary, setSupplierSummary] = useState({});
  const [selectedProductCode, setSelectedProductCode] = useState("");
  const [selectedCenter, setSelectedCenter] = useState("");

  const [returnInputs, setReturnInputs] = useState({});
  const [memoInputs, setMemoInputs] = useState({});

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
        summary[partner].productMap[productKey].event = "행사";
      }
    });

    return summary;
  };

  const loadMainCsv = async (file) => {
    setError("");

    try {
      const { text } = await decodeCsvFile(file);

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        worker: true,
        complete: (parsed) => {
          const normalizedRows = buildNormalizedRows(parsed.data || []);
          const nextProductMap = buildProductMap(normalizedRows);
          const nextSupplierSummary = buildSupplierSummary(normalizedRows);

          setRows(normalizedRows);
          setProductMap(nextProductMap);
          setSupplierSummary(nextSupplierSummary);

          const firstProductCode = Object.keys(nextProductMap)[0] || "";
          setSelectedProductCode(firstProductCode);

          if (firstProductCode) {
            const firstCenters = Object.keys(nextProductMap[firstProductCode].centers || {});
            setSelectedCenter(firstCenters[0] || "");
          } else {
            setSelectedCenter("");
          }
        },
        error: () => {
          setError("CSV 파싱 중 오류가 발생했어");
        },
      });
    } catch (err) {
      setError("CSV 읽기 중 오류가 발생했어");
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRows([]);
    setQuery("");
    setFileName(file.name);
    setProductMap({});
    setSupplierSummary({});
    setSelectedProductCode("");
    setSelectedCenter("");
    setReturnInputs({});
    setMemoInputs({});
    setEventEdits({});
    setPreorderMap({});
    setUnmatchedPreorderRows([]);

    await loadMainCsv(file);
  };

  const handleExcludeUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const workbook = XLSX.read(buffer, { type: "array" });

      const codeSheet = workbook.Sheets["코드제외"] || workbook.Sheets[workbook.SheetNames[0]];
      const partnerSheet = workbook.Sheets["협력사제외"] || workbook.Sheets[workbook.SheetNames[1]];

      const codeRows = XLSX.utils.sheet_to_json(codeSheet, { defval: "", raw: false });
      const partnerRows = partnerSheet ? XLSX.utils.sheet_to_json(partnerSheet, { defval: "", raw: false }) : [];

      const nextCodeSet = new Set(
        codeRows
          .map((row) => cleanCode(getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])))
          .filter(Boolean)
      );

      const nextPartnerSet = new Set(
        partnerRows
          .map((row) => normalizeText(getValue(row, ["협력사명", "협력사", "거래처명", "거래처명(구매조건명)"])))
          .filter(Boolean)
      );

      setExcludeCodeSet(nextCodeSet);
      setExcludePartnerSet(nextPartnerSet);
      setExcludeFileName(file.name);
      setError("");
    } catch (err) {
      setError("제외목록 파일 읽기 실패");
    }
  };

  const handleEventUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { rows: eventRows } = await parseWorkbookRows(file);
      const nextSet = new Set(
        eventRows
          .map((row) => cleanCode(getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])))
          .filter(Boolean)
      );

      setEventCodeSet(nextSet);
      setEventFileName(file.name);
      setError("");
    } catch (err) {
      setError("행사표 파일 읽기 실패");
    }
  };

  const stripCenterNoise = (value) => {
    return normalizeText(value)
      .replace(/[()]/g, "")
      .replace(/1차식품\+대형/g, "")
      .replace(/1차식품/g, "")
      .replace(/대형/g, "")
      .replace(/주식회사/g, "")
      .replace(/㈜/g, "")
      .replace(/\(주\)/g, "")
      .replace(/지에스리테일/g, "")
      .replace(/gs리테일/g, "")
      .replace(/gs25/g, "")
      .replace(/우리동네gs/g, "")
      .replace(/편의점/g, "")
      .replace(/센터/g, "")
      .replace(/일배/g, "")
      .replace(/저온/g, "")
      .replace(/벤더/g, "")
      .replace(/[.\-_,]/g, "")
      .replace(/\s+/g, "")
      .trim();
  };

  const centerAliasOverride = {
    "광주": ["신광주"],
    "광주1": ["신광주"],
    "포천": ["포천"],
    "포천1": ["포천"],
    "고양": ["고양1", "고양"],
    "고양1": ["고양1", "고양"],
    "고양2": ["고양2"],
    "신오산": ["신오산1"],
    "신오산1": ["신오산1"],
    "신오산2": ["신오산2"],
    "도화1": ["인천", "도화1"],
    "도화2": ["인천2", "도화2"],
    "인천도화1": ["인천", "도화1"],
    "인천도화2": ["인천2", "도화2"],
    "김포": ["김포2", "김포3"],
    "김포2": ["김포2"],
    "김포3": ["김포3"],
    "송파": ["송파"],
    "송파1": ["송파"],
    "송파2": ["송파2"],
    "김해": ["김해"],
    "김해1": ["김해"],
    "김해2": ["김해2"],
    "발안": ["발안"],
    "청주": ["청주"],
    "경산": ["경산"],
    "익산": ["익산"],
    "원주": ["원주"],
    "강릉": ["강릉"],
    "아신": ["아신"],
    "해인": ["해인"],
    "진주": ["진주"],
  };

  const resolveCenterName = (rawCenterName, availableCenters) => {
    const source = stripCenterNoise(rawCenterName);
    if (!source || availableCenters.length === 0) return "";

    const candidates = availableCenters.map((center) => {
      const cleaned = stripCenterNoise(center);

      return {
        original: center,
        cleaned,
      };
    });

    const exact = candidates.find((item) => item.cleaned === source);
    if (exact) return exact.original;

    const aliasList = centerAliasOverride[source] || [];
    for (const alias of aliasList) {
      const cleanedAlias = stripCenterNoise(alias);
      const aliasExact = candidates.find(
        (item) =>
          item.cleaned === cleanedAlias ||
          item.cleaned.startsWith(cleanedAlias) ||
          cleanedAlias.startsWith(item.cleaned)
      );

      if (aliasExact) return aliasExact.original;
    }

    const samePrefixOne = candidates.find((item) => {
      const base = `${source}1`;
      return item.cleaned.startsWith(base);
    });
    if (samePrefixOne) return samePrefixOne.original;

    const includeMatch = candidates.find(
      (item) => item.cleaned.includes(source) || source.includes(item.cleaned)
    );
    if (includeMatch) return includeMatch.original;

    let best = { original: "", score: 0 };
    candidates.forEach((item) => {
      let score = 0;

      if (item.cleaned.startsWith(source)) score += 80;
      if (source.startsWith(item.cleaned)) score += 75;

      const overlap = source
        .split("")
        .filter((char) => item.cleaned.includes(char)).length;

      score += overlap;

      if (score > best.score) {
        best = { original: item.original, score };
      }
    });

    return best.score >= Math.max(3, Math.floor(source.length / 2)) ? best.original : "";
  };

  const handlePreorderUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { rows: preorderRows } = await parseWorkbookRows(file);
      const availableCenters = Array.from(
        new Set(
          rows
            .map((row) => row.__center)
            .filter(Boolean)
        )
      );

      const nextMap = {};
      const unmatched = [];

      preorderRows.forEach((row) => {
        const productCode = cleanCode(getValue(row, ["상품코드", "상품 코드", "코드", "바코드"]));
        const rawCenter =
          getValue(row, ["배송처명", "센터명", "센터", "배송처", "DC/TC"]) || "";
        const qty = parseQty(getValue(row, ["주문수량", "수량", "발주수량", "총 발주수량"]));

        if (!productCode || qty <= 0) return;

        const matchedCenter = resolveCenterName(rawCenter, availableCenters);

        if (!matchedCenter) {
          unmatched.push({
            상품코드: productCode,
            상품명: getValue(row, ["상품명", "상품 명", "품목명", "품명"]),
            원본센터명: rawCenter,
            주문수량: qty,
          });
          return;
        }

        const pairKey = makePairKey(productCode, matchedCenter);
        nextMap[pairKey] = (nextMap[pairKey] || 0) + qty;
      });

      setPreorderMap(nextMap);
      setUnmatchedPreorderRows(unmatched);
      setPreorderFileName(file.name);
      setError("");
    } catch (err) {
      setError("사전예약 파일 읽기 실패");
    }
  };

  const manualExcludeList = useMemo(() => {
    return excludeText
      .split("\n")
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }, [excludeText]);

  const isExcluded = (productCode, productName, partner) => {
    const code = cleanCode(productCode);
    const codeDigits = digitsOnly(code);
    const nameNormalized = normalizeText(productName);
    const partnerNormalized = normalizeText(partner);

    const manualExcluded = manualExcludeList.some((keyword) => {
      const normalizedKeyword = normalizeText(keyword);
      const keywordDigits = digitsOnly(keyword);

      return (
        nameNormalized.includes(normalizedKeyword) ||
        normalizeText(code).includes(normalizedKeyword) ||
        (keywordDigits && codeDigits.includes(keywordDigits)) ||
        partnerNormalized.includes(normalizedKeyword)
      );
    });

    return (
      excludeCodeSet.has(code) ||
      excludeCodeSet.has(codeDigits) ||
      excludePartnerSet.has(partnerNormalized) ||
      manualExcluded
    );
  };

  const getPreorderQty = (productCode, center) => {
    return preorderMap[makePairKey(productCode, center)] || 0;
  };

  const getEventValueForProduct = (productCode, partner, productName, baseValue = "") => {
    const key = `${partner}||${productCode}||${productName}`;
    if (eventEdits[key] !== undefined) {
      return eventEdits[key];
    }

    return eventCodeSet.has(cleanCode(productCode)) || baseValue ? "행사" : "";
  };

  const filteredProducts = useMemo(() => {
    const keyword = deferredQuery.trim();
    const products = Object.values(productMap);

    const visibleProducts = products.filter((product) => !isExcluded(product.productCode, product.productName, ""));

    if (!keyword) {
      return visibleProducts.slice(0, 100);
    }

    const keywordNormalized = normalizeText(keyword);
    const keywordDigits = digitsOnly(keyword);

    return visibleProducts
      .map((product) => {
        let score = 0;

        const code = String(product.productCode || "");
        const codeDigits = digitsOnly(code);
        const nameNormalized = normalizeText(product.productName || "");
        const partnerKeywords = (product.partnerKeywords || []).map((item) => normalizeText(item)).join(" ");

        if (keywordDigits) {
          if (code === keyword) score += 120;
          if (codeDigits === keywordDigits) score += 115;
          if (code.startsWith(keyword)) score += 100;
          if (codeDigits.startsWith(keywordDigits)) score += 95;
          if (code.endsWith(keyword)) score += 85;
          if (codeDigits.endsWith(keywordDigits)) score += 80;
          if (code.includes(keyword)) score += 60;
          if (codeDigits.includes(keywordDigits)) score += 55;
        }

        if (nameNormalized === keywordNormalized) score += 110;
        if (nameNormalized.startsWith(keywordNormalized)) score += 90;
        if (nameNormalized.includes(keywordNormalized)) score += 70;

        if (partnerKeywords.includes(keywordNormalized)) score += 65;
        if (normalizeText(Object.keys(product.centers || {}).join(" ")).includes(keywordNormalized)) score += 45;

        return { product, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.product);
  }, [productMap, deferredQuery, excludeCodeSet, excludePartnerSet, manualExcludeList]);

  const selectedProduct = useMemo(() => {
    if (!selectedProductCode) return null;
    return productMap[selectedProductCode] || null;
  }, [productMap, selectedProductCode]);

  const selectedProductCenters = useMemo(() => {
    if (!selectedProduct) return [];
    return Object.keys(selectedProduct.centers || {}).sort((a, b) => a.localeCompare(b, "ko"));
  }, [selectedProduct]);

  const selectedCenterInfo = useMemo(() => {
    if (!selectedProduct || !selectedCenter) return null;

    const baseCenterInfo = selectedProduct.centers[selectedCenter] || null;
    if (!baseCenterInfo) return null;

    const preorderQty = getPreorderQty(selectedProduct.productCode, selectedCenter);

    return {
      ...baseCenterInfo,
      preorderQty,
      mergedQty: (baseCenterInfo.qty || 0) + preorderQty,
    };
  }, [selectedProduct, selectedCenter, preorderMap]);

  const selectedCenterPartners = useMemo(() => {
    if (!selectedCenterInfo) return [];

    return Object.values(selectedCenterInfo.partners || {})
      .filter((partnerInfo) => !isExcluded(selectedProduct?.productCode, selectedProduct?.productName, partnerInfo.partner))
      .sort((a, b) => b.qty - a.qty);
  }, [selectedCenterInfo, selectedProduct, excludeCodeSet, excludePartnerSet, manualExcludeList]);

  const supplierList = useMemo(() => {
    return Object.values(supplierSummary)
      .filter((supplier) => !excludePartnerSet.has(normalizeText(supplier.partner)))
      .map((supplier) => {
        const products = Object.values(supplier.productMap || {})
          .filter((product) => !isExcluded(product.productCode, product.productName, supplier.partner))
          .map((product) => ({
            ...product,
            event: getEventValueForProduct(product.productCode, supplier.partner, product.productName, product.event || ""),
          }))
          .sort((a, b) => b.totalQty - a.totalQty);

        const totalQty = products.reduce((sum, item) => sum + item.totalQty, 0);
        const totalRows = products.reduce((sum, item) => sum + item.totalRows, 0);

        return {
          ...supplier,
          totalQty,
          totalRows,
          products,
        };
      })
      .filter((supplier) => supplier.products.length > 0)
      .sort((a, b) => b.totalQty - a.totalQty);
  }, [supplierSummary, excludePartnerSet, excludeCodeSet, manualExcludeList, eventEdits, eventCodeSet]);

  const processedCenterRows = useMemo(() => {
    const result = [];

    Object.values(productMap).forEach((product) => {
      Object.values(product.centers || {}).forEach((centerInfo) => {
        const visiblePartners = Object.values(centerInfo.partners || {}).filter(
          (partnerInfo) => !isExcluded(product.productCode, product.productName, partnerInfo.partner)
        );

        const inboundQty = visiblePartners.reduce((sum, item) => sum + item.qty, 0);
        const preorderQty = getPreorderQty(product.productCode, centerInfo.center);

        result.push({
          상품코드: product.productCode,
          상품명: product.productName,
          센터: centerInfo.center,
          입고수량: inboundQty,
          사전예약수량: preorderQty,
          합산수량: inboundQty + preorderQty,
          행사여부: eventCodeSet.has(cleanCode(product.productCode)) ? "행사" : "",
          협력사목록: visiblePartners.map((item) => item.partner).join(", "),
          협력사수: visiblePartners.length,
          제외코드여부: excludeCodeSet.has(cleanCode(product.productCode)) ? "제외" : "",
        });
      });
    });

    return result.sort((a, b) => {
      if (a.상품코드 === b.상품코드) return a.센터.localeCompare(b.센터, "ko");
      return String(a.상품코드).localeCompare(String(b.상품코드), "ko");
    });
  }, [productMap, preorderMap, eventCodeSet, excludeCodeSet, excludePartnerSet, manualExcludeList]);

  const returnRows = useMemo(() => {
    const result = [];

    Object.keys(returnInputs).forEach((key) => {
      const qty = parseQty(returnInputs[key]);
      if (qty <= 0) return;

      const memo = memoInputs[key] || "";
      const [productCode, center, partner] = key.split("||");
      const product = productMap[productCode];

      if (!product || isExcluded(productCode, product.productName, partner)) return;

      const centerInfo = product.centers[center];
      if (!centerInfo) return;

      const partnerInfo = centerInfo.partners[partner];
      const inboundQty = partnerInfo?.qty || 0;

      result.push({
        상품코드: productCode,
        상품명: product.productName || "",
        센터: center,
        협력사: partner,
        입고수량: inboundQty,
        사전예약수량: getPreorderQty(productCode, center),
        회송수량: qty,
        비고: memo,
        작성시간: new Date().toLocaleString("ko-KR"),
      });
    });

    return result;
  }, [returnInputs, memoInputs, productMap, preorderMap, excludeCodeSet, excludePartnerSet, manualExcludeList]);

  const handleSelectProduct = (productCode) => {
    setSelectedProductCode(productCode);

    const nextProduct = productMap[productCode];
    const centers = Object.keys(nextProduct?.centers || {});
    setSelectedCenter(centers[0] || "");
  };

  const resetSearch = () => {
    setQuery("");
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

  const setEventValue = (partner, productCode, productName, value) => {
    const key = `${partner}||${productCode}||${productName}`;
    const cleaned = String(value || "").trim();

    setEventEdits((prev) => ({
      ...prev,
      [key]: cleaned ? "행사" : "",
    }));
  };

  const exportReturnExcel = () => {
    if (returnRows.length === 0) {
      alert("회송수량 입력된 데이터가 없어");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(returnRows);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "회송내역");
    XLSX.writeFile(workbook, `회송내역_${new Date().getTime()}.xlsx`);
  };

  const exportProcessedExcel = () => {
    if (processedCenterRows.length === 0) {
      alert("가공할 데이터가 없어");
      return;
    }

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(processedCenterRows),
      "가공데이터"
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        supplierList.flatMap((supplier) =>
          supplier.products.map((product) => ({
            협력사: supplier.partner,
            상품코드: product.productCode,
            상품명: product.productName,
            총수량: product.totalQty,
            행수: product.totalRows,
            행사여부: product.event || "",
          }))
        )
      ),
      "협력사집계"
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(returnRows.length > 0 ? returnRows : [{ 안내: "회송 입력 데이터 없음" }]),
      "회송내역"
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        unmatchedPreorderRows.length > 0
          ? unmatchedPreorderRows
          : [{ 안내: "미매칭 사전예약 데이터 없음" }]
      ),
      "사전예약미매칭"
    );

    XLSX.writeFile(workbook, `검품가공데이터_${new Date().getTime()}.xlsx`);
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>검품 / 회송 관리 앱</h1>

        <div style={styles.section}>
          <div style={styles.uploadGrid}>
            <div style={styles.uploadCard}>
              <label style={styles.label}>원본 CSV</label>
              <input type="file" accept=".csv" onChange={handleFileUpload} />
              <p style={styles.fileHint}>{fileName || "미업로드"}</p>
            </div>

            <div style={styles.uploadCard}>
              <label style={styles.label}>제외목록.xlsx</label>
              <input type="file" accept=".xlsx,.xls" onChange={handleExcludeUpload} />
              <p style={styles.fileHint}>{excludeFileName || "미업로드"}</p>
            </div>

            <div style={styles.uploadCard}>
              <label style={styles.label}>행사표.xlsx</label>
              <input type="file" accept=".xlsx,.xls" onChange={handleEventUpload} />
              <p style={styles.fileHint}>{eventFileName || "미업로드"}</p>
            </div>

            <div style={styles.uploadCard}>
              <label style={styles.label}>사전예약.xlsx</label>
              <input type="file" accept=".xlsx,.xls" onChange={handlePreorderUpload} />
              <p style={styles.fileHint}>{preorderFileName || "미업로드"}</p>
            </div>
          </div>
        </div>

        <div style={styles.section}>
          <input
            placeholder="상품코드 / 끝자리 / 상품명 / 거래처명 / 센터명 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={styles.input}
          />

          <div style={styles.buttonRow}>
            <button onClick={resetSearch} style={styles.subButton}>
              검색 초기화
            </button>
            <button onClick={exportProcessedExcel} style={styles.mainButton}>
              가공데이터 엑셀 다운로드
            </button>
            <button onClick={exportReturnExcel} style={styles.subButton}>
              회송 엑셀 다운로드
            </button>
          </div>
        </div>

        <div style={styles.result}>
          <div style={styles.summaryBox}>
            <p><strong>원본 CSV:</strong> {fileName || "-"}</p>
            <p><strong>제외 코드 수:</strong> {excludeCodeSet.size}</p>
            <p><strong>제외 협력사 수:</strong> {excludePartnerSet.size}</p>
            <p><strong>행사 코드 수:</strong> {eventCodeSet.size}</p>
            <p><strong>업로드 행 수:</strong> {rows.length}</p>
            <p><strong>상품 수:</strong> {Object.keys(productMap).length}</p>
            <p><strong>협력사 수:</strong> {Object.keys(supplierSummary).length}</p>
            <p><strong>사전예약 매칭 수:</strong> {Object.keys(preorderMap).length}</p>
            <p><strong>사전예약 미매칭 행 수:</strong> {unmatchedPreorderRows.length}</p>
            <p><strong>회송 입력 건수:</strong> {returnRows.length}</p>
          </div>

          {!!error && <div style={styles.errorBox}>{error}</div>}

          <div style={styles.tabRow}>
            <button
              onClick={() => setActiveTab("search")}
              style={{
                ...styles.tabButton,
                ...(activeTab === "search" ? styles.tabButtonActive : {}),
              }}
            >
              상품 검색
            </button>

            <button
              onClick={() => setActiveTab("supplier")}
              style={{
                ...styles.tabButton,
                ...(activeTab === "supplier" ? styles.tabButtonActive : {}),
              }}
            >
              협력사 집계
            </button>
          </div>

          {activeTab === "search" && (
            <div style={styles.grid}>
              <div style={styles.leftPane}>
                <div style={styles.sectionTitle}>검색된 상품 목록</div>

                {filteredProducts.length === 0 && (
                  <div style={styles.emptyBox}>
                    검색 결과 없음
                  </div>
                )}

                {filteredProducts.slice(0, 80).map((product) => {
                  const centerCount = Object.keys(product.centers || {}).length;
                  const preorderTotal = Object.keys(product.centers || {}).reduce(
                    (sum, centerName) => sum + getPreorderQty(product.productCode, centerName),
                    0
                  );
                  const isSelected = selectedProductCode === product.productCode;

                  return (
                    <button
                      key={product.productCode}
                      onClick={() => handleSelectProduct(product.productCode)}
                      style={{
                        ...styles.productButton,
                        ...(isSelected ? styles.productButtonActive : {}),
                      }}
                    >
                      <div style={styles.productButtonName}>
                        {product.productName || "(상품명 없음)"}
                      </div>
                      <div style={styles.productButtonText}>
                        상품코드: {product.productCode}
                      </div>
                      <div style={styles.productButtonText}>
                        원본 입고수량: {product.totalQty}
                      </div>
                      <div style={styles.productButtonText}>
                        사전예약수량: {preorderTotal}
                      </div>
                      <div style={styles.productButtonText}>
                        센터 수: {centerCount}
                      </div>
                      <div style={styles.productButtonText}>
                        거래처: {(product.partnerKeywords || []).slice(0, 3).join(", ")}
                        {(product.partnerKeywords || []).length > 3 ? " 외" : ""}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={styles.rightPane}>
                <div style={styles.sectionTitle}>선택 상품 상세</div>

                {!selectedProduct && (
                  <div style={styles.emptyBox}>
                    상품을 선택해줘
                  </div>
                )}

                {selectedProduct && (
                  <div style={styles.detailBox}>
                    <p><strong>상품명:</strong> {selectedProduct.productName || "-"}</p>
                    <p><strong>상품코드:</strong> {selectedProduct.productCode}</p>
                    <p><strong>원본 총 입고수량:</strong> {selectedProduct.totalQty}</p>
                    <p><strong>센터 수:</strong> {selectedProductCenters.length}</p>
                    <p><strong>행사:</strong> {eventCodeSet.has(cleanCode(selectedProduct.productCode)) ? "행사" : "-"}</p>

                    <div style={{ marginTop: "14px" }}>
                      <label style={styles.label}>센터 선택</label>
                      <select
                        value={selectedCenter}
                        onChange={(e) => setSelectedCenter(e.target.value)}
                        style={styles.select}
                      >
                        {selectedProductCenters.map((centerName) => (
                          <option key={centerName} value={centerName}>
                            {centerName}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedCenterInfo && (
                      <div style={styles.centerBox}>
                        <p><strong>선택 센터:</strong> {selectedCenterInfo.center}</p>
                        <p><strong>센터 입고수량:</strong> {selectedCenterInfo.qty}</p>
                        <p><strong>사전예약수량:</strong> {selectedCenterInfo.preorderQty}</p>
                        <p><strong>합산수량:</strong> {selectedCenterInfo.mergedQty}</p>
                        <p><strong>센터 내 행 수:</strong> {selectedCenterInfo.rowCount}</p>

                        <div style={{ marginTop: "12px" }}>
                          <p style={styles.subTitle}><strong>센터 내 협력사 목록</strong></p>

                          {selectedCenterPartners.length === 0 && (
                            <p>협력사 정보 없음</p>
                          )}

                          {selectedCenterPartners.map((partnerItem, idx) => {
                            const inputKey = `${selectedProduct.productCode}||${selectedCenterInfo.center}||${partnerItem.partner}`;
                            const currentReturnQty = parseQty(returnInputs[inputKey]);
                            const currentMemo = memoInputs[inputKey] || "";

                            return (
                              <div key={`${partnerItem.partner}-${idx}`} style={styles.partnerItem}>
                                <p><strong>협력사:</strong> {partnerItem.partner}</p>
                                <p><strong>입고수량:</strong> {partnerItem.qty}</p>
                                <p><strong>행 수:</strong> {partnerItem.rows.length}</p>

                                <div style={styles.inlineInputRow}>
                                  <input
                                    type="number"
                                    min="0"
                                    value={returnInputs[inputKey] || ""}
                                    onChange={(e) =>
                                      setReturnQty(
                                        selectedProduct.productCode,
                                        selectedCenterInfo.center,
                                        partnerItem.partner,
                                        e.target.value
                                      )
                                    }
                                    placeholder="회송수량"
                                    style={styles.smallInput}
                                  />

                                  <input
                                    type="text"
                                    value={currentMemo}
                                    onChange={(e) =>
                                      setReturnMemo(
                                        selectedProduct.productCode,
                                        selectedCenterInfo.center,
                                        partnerItem.partner,
                                        e.target.value
                                      )
                                    }
                                    placeholder="불량사유 / 비고"
                                    style={styles.memoInput}
                                  />

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReturnQty(
                                        selectedProduct.productCode,
                                        selectedCenterInfo.center,
                                        partnerItem.partner,
                                        ""
                                      );
                                      setReturnMemo(
                                        selectedProduct.productCode,
                                        selectedCenterInfo.center,
                                        partnerItem.partner,
                                        ""
                                      );
                                    }}
                                    style={styles.clearButton}
                                  >
                                    초기화
                                  </button>
                                </div>

                                {currentReturnQty > 0 && (
                                  <div style={styles.returnBadge}>
                                    입력된 회송: {currentReturnQty}
                                    {currentMemo ? ` / 사유: ${currentMemo}` : ""}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <div style={styles.returnHistoryBox}>
                          <p style={styles.subTitle}><strong>회송 내역</strong></p>

                          {returnRows.length === 0 && <p>아직 입력된 회송 내역 없음</p>}

                          {returnRows.length > 0 && (
                            <>
                              <div style={styles.returnSummaryRow}>
                                <div style={styles.returnSummaryChip}>
                                  전체 회송 건수: {returnRows.length}
                                </div>
                                <div style={styles.returnSummaryChip}>
                                  전체 회송수량: {returnRows.reduce((sum, row) => sum + parseQty(row.회송수량), 0)}
                                </div>
                              </div>

                              {returnRows
                                .filter((row) => row.상품코드 === selectedProduct.productCode)
                                .sort((a, b) => b.작성시간.localeCompare(a.작성시간))
                                .map((row, idx) => (
                                  <div key={`return-history-${idx}`} style={styles.returnHistoryCard}>
                                    <p><strong>상품명:</strong> {row.상품명}</p>
                                    <p><strong>상품코드:</strong> {row.상품코드}</p>
                                    <p><strong>센터:</strong> {row.센터}</p>
                                    <p><strong>협력사:</strong> {row.협력사}</p>
                                    <p><strong>입고수량:</strong> {row.입고수량}</p>
                                    <p><strong>사전예약수량:</strong> {row.사전예약수량}</p>
                                    <p><strong>회송수량:</strong> {row.회송수량}</p>
                                    <p><strong>비고:</strong> {row.비고 || "-"}</p>
                                  </div>
                                ))}

                              {returnRows.filter((row) => row.상품코드 === selectedProduct.productCode).length === 0 && (
                                <p>현재 선택 상품에는 아직 회송 입력 없음</p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "supplier" && (
            <div>
              <div style={styles.sectionTitle}>협력사별 집계</div>

              <div style={styles.filterBox}>
                <label style={styles.label}>추가 제외목록</label>
                <textarea
                  value={excludeText}
                  onChange={(e) => setExcludeText(e.target.value)}
                  placeholder={"줄바꿈으로 입력\n상품코드 / 상품명 / 협력사명 일부 입력 가능"}
                  style={styles.textarea}
                />
              </div>

              {supplierList.length === 0 && (
                <div style={styles.emptyBox}>
                  협력사 데이터 없음
                </div>
              )}

              {supplierList.map((supplier) => (
                <div key={supplier.partner} style={styles.supplierCard}>
                  <p style={styles.supplierTitle}>{supplier.partner}</p>
                  <p><strong>총 수량:</strong> {supplier.totalQty}</p>
                  <p><strong>총 행 수:</strong> {supplier.totalRows}</p>
                  <p><strong>상품 수:</strong> {supplier.products.length}</p>

                  <div style={{ marginTop: "12px" }}>
                    {supplier.products.slice(0, 80).map((product) => {
                      const eventKey = `${supplier.partner}||${product.productCode}||${product.productName}`;
                      const displayEvent =
                        eventEdits[eventKey] !== undefined
                          ? eventEdits[eventKey]
                          : getEventValueForProduct(product.productCode, supplier.partner, product.productName, product.event || "");

                      return (
                        <div
                          key={`${supplier.partner}-${product.productCode}-${product.productName}`}
                          style={styles.supplierProductItem}
                        >
                          <p><strong>상품명:</strong> {product.productName}</p>
                          <p><strong>상품코드:</strong> {product.productCode}</p>
                          <p><strong>총 수량:</strong> {product.totalQty}</p>

                          <div style={{ marginTop: "8px" }}>
                            <label style={styles.label}>행사 여부</label>
                            <input
                              type="text"
                              value={displayEvent}
                              onChange={(e) =>
                                setEventValue(
                                  supplier.partner,
                                  product.productCode,
                                  product.productName,
                                  e.target.value
                                )
                              }
                              placeholder="행사면 아무 글자나 입력, 없으면 비움"
                              style={styles.smallInput}
                            />
                          </div>

                          <p style={{ marginTop: "8px" }}>
                            <strong>최종 표시:</strong> {displayEvent || ""}
                          </p>
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
    background: "#f1f5f9",
    padding: "24px",
    boxSizing: "border-box",
  },
  card: {
    maxWidth: "1400px",
    margin: "0 auto",
    background: "#ffffff",
    borderRadius: "18px",
    padding: "24px",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
  },
  title: {
    fontSize: "28px",
    fontWeight: "800",
    marginBottom: "18px",
  },
  section: {
    marginBottom: "16px",
  },
  uploadGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "12px",
  },
  uploadCard: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "12px",
  },
  fileHint: {
    marginTop: "8px",
    fontSize: "13px",
    color: "#475569",
    wordBreak: "break-all",
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    border: "1px solid #cbd5e1",
    borderRadius: "12px",
    boxSizing: "border-box",
    fontSize: "15px",
    marginBottom: "12px",
  },
  buttonRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  subButton: {
    padding: "10px 14px",
    backgroundColor: "#e2e8f0",
    color: "#0f172a",
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
  },
  mainButton: {
    padding: "10px 14px",
    backgroundColor: "#111827",
    color: "#ffffff",
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
  },
  result: {
    marginTop: "20px",
  },
  summaryBox: {
    background: "#eff6ff",
    border: "1px solid #93c5fd",
    padding: "12px",
    borderRadius: "10px",
    marginBottom: "12px",
  },
  errorBox: {
    background: "#fef2f2",
    border: "1px solid #fca5a5",
    color: "#991b1b",
    padding: "12px",
    borderRadius: "10px",
    marginBottom: "12px",
  },
  tabRow: {
    display: "flex",
    gap: "8px",
    marginBottom: "16px",
    flexWrap: "wrap",
  },
  tabButton: {
    padding: "10px 14px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    cursor: "pointer",
  },
  tabButtonActive: {
    background: "#111827",
    color: "#ffffff",
    border: "1px solid #111827",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "16px",
    alignItems: "start",
  },
  leftPane: {
    minWidth: 0,
  },
  rightPane: {
    minWidth: 0,
  },
  sectionTitle: {
    fontSize: "18px",
    fontWeight: "700",
    marginBottom: "10px",
  },
  emptyBox: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "14px",
  },
  productButton: {
    width: "100%",
    textAlign: "left",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "12px",
    marginBottom: "10px",
    cursor: "pointer",
  },
  productButtonActive: {
    background: "#eef2ff",
    border: "1px solid #818cf8",
  },
  productButtonName: {
    fontWeight: "700",
    marginBottom: "8px",
  },
  productButtonText: {
    fontSize: "14px",
    marginBottom: "4px",
  },
  detailBox: {
    background: "#eef2ff",
    border: "1px solid #a5b4fc",
    padding: "14px",
    borderRadius: "12px",
  },
  label: {
    display: "block",
    marginBottom: "6px",
    fontWeight: "600",
  },
  select: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    fontSize: "15px",
    backgroundColor: "#fff",
    boxSizing: "border-box",
  },
  centerBox: {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    padding: "12px",
    marginTop: "14px",
  },
  subTitle: {
    marginBottom: "8px",
  },
  partnerItem: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "10px",
    marginBottom: "8px",
  },
  rowPreview: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "10px",
    marginBottom: "8px",
  },
  supplierCard: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "14px",
    marginBottom: "14px",
  },
  supplierTitle: {
    fontSize: "18px",
    fontWeight: "700",
    marginBottom: "8px",
  },
  supplierProductItem: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "10px",
    marginBottom: "8px",
  },
  returnCard: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "14px",
    marginBottom: "14px",
  },
  returnTitle: {
    fontSize: "17px",
    fontWeight: "700",
    marginBottom: "8px",
  },
  centerBlock: {
    background: "#ffffff",
    border: "1px solid #dbeafe",
    borderRadius: "10px",
    padding: "12px",
    marginTop: "12px",
  },
  centerBlockTitle: {
    fontWeight: "700",
    marginBottom: "8px",
  },
  returnRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    alignItems: "center",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "10px",
    marginBottom: "8px",
  },
  returnInfo: {
    minWidth: 0,
  },
  returnControls: {
    display: "grid",
    gap: "8px",
  },
  smallInput: {
    width: "100%",
    padding: "10px",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    boxSizing: "border-box",
  },
  memoInput: {
    width: "100%",
    padding: "10px",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    minHeight: "120px",
    padding: "10px",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    boxSizing: "border-box",
    resize: "vertical",
    fontSize: "14px",
  },
  filterBox: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    padding: "12px",
    borderRadius: "10px",
    marginBottom: "12px",
  },
  exportPreviewBox: {
    background: "#eff6ff",
    border: "1px solid #93c5fd",
    padding: "12px",
    borderRadius: "10px",
    marginTop: "16px",
  },

  inlineInputRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginTop: "10px",
    alignItems: "center",
  },
  clearButton: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    borderRadius: "10px",
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: "700",
  },
  returnBadge: {
    marginTop: "10px",
    background: "#eef2ff",
    border: "1px solid #c7d2fe",
    color: "#3730a3",
    borderRadius: "10px",
    padding: "10px 12px",
    fontSize: "14px",
    fontWeight: "700",
  },
  returnHistoryBox: {
    marginTop: "16px",
    background: "#f8fafc",
    border: "1px solid #dbeafe",
    borderRadius: "14px",
    padding: "14px",
  },
  returnSummaryRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginBottom: "12px",
  },
  returnSummaryChip: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: "999px",
    padding: "8px 12px",
    fontSize: "13px",
    fontWeight: "700",
    color: "#1d4ed8",
  },
  returnHistoryCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "12px",
    marginTop: "10px",
  },
};

export default App;
