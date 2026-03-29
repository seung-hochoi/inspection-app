import Papa from "papaparse";
import * as XLSX from "xlsx";
import { normalizeProductCode, parseQty } from "./formatters";

export const normalizeKey = (key) => String(key || "").replace(/\uFEFF/g, "").trim();

export const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\uFEFF/g, "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const normalizeHappycallLookupText = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\u3131-\uD79Da-z0-9]/gi, "")
    .trim();

export const makeSkuKey = (productCode, partnerName) =>
  `${normalizeProductCode(productCode || "")}||${String(partnerName || "").trim()}`;

export const getHappycallProductMetrics = (analytics, product) => {
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

export const getHappycallRankStyle = (rank) => {
  if (rank === 1) return { background: "#fee2e2", color: "#b91c1c" };
  if (rank === 2) return { background: "#dbeafe", color: "#1d4ed8" };
  if (rank === 3) return { background: "#dcfce7", color: "#15803d" };
  return { background: "#f3f4f6", color: "#374151" };
};

export const getTopMedal = (rank) => {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return null;
};

export const isClassifiedHappycallProduct = (item) => {
  const name = String(item?.productName || "").trim();
  return !!name && name !== "미분류상품";
};

export const buildVisibleHappycallRanks = (analytics) => {
  const periods = analytics?.periods || {};
  const rankMap = {};

  Object.entries(periods).forEach(([periodKey, periodValue]) => {
    (periodValue?.topProducts || [])
      .filter(isClassifiedHappycallProduct)
      .slice(0, 10)
      .forEach((item, index) => {
        const key = `${String(item?.partnerName || "").trim()}||${normalizeProductCode(item?.productCode || "")}`;
        if (!key.trim()) return;
        if (!rankMap[key]) rankMap[key] = {};
        rankMap[key][periodKey] = {
          rank: index + 1,
          count: parseQty(item?.count || 0),
          share: Number(item?.share || 0),
        };
      });
  });

  return rankMap;
};

export const getValue = (row, candidates) => {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return "";
};

export const isTruthyUsage = (value) => {
  if (value === true) return true;
  const text = normalizeText(value);
  return ["true", "y", "yes", "1", "사용", "예"].includes(text);
};

export const isExplicitFalseUsage = (value) => {
  if (value === false) return true;
  const text = normalizeText(value);
  return ["false", "n", "no", "0", "미사용", "아니오"].includes(text);
};

export const decodeCsvFile = async (file) => {
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

export const parseHappycallSourceFile = async (file) => {
  const fileName = String(file?.name || "").toLowerCase();

  if (fileName.endsWith(".xls") || fileName.endsWith(".xlsx")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames?.[0];
    if (!firstSheetName) return [];
    const sheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
  }

  const { text } = await decodeCsvFile(file);
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
  });
  return Array.isArray(parsed.data) ? parsed.data : [];
};

export const buildNormalizedRows = (parsedRows) =>
  parsedRows.map((rawRow, index) => {
    const row = {};

    Object.keys(rawRow || {}).forEach((key) => {
      row[normalizeKey(key)] = rawRow[key];
    });

    const productCode = normalizeProductCode(
      getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])
    );
    const productName = String(
      getValue(row, ["상품명", "상품 명", "품목명", "품목"]) || ""
    ).trim();
    const partner = String(
      getValue(row, ["협력사명(거래처)", "협력사명", "파트너사", "파트너"]) || ""
    ).trim();
    const center = String(getValue(row, ["센터명", "센터"]) || "").trim();
    const qty = parseQty(getValue(row, ["입고량", "검품수량", "수량"]));

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

export const buildReservationRows = (reservationRows) =>
  (reservationRows || []).map((rawRow, index) => {
    const row = {};

    Object.keys(rawRow || {}).forEach((key) => {
      row[normalizeKey(key)] = rawRow[key];
    });

    const productCode = normalizeProductCode(
      getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])
    );
    const productName = String(getValue(row, ["상품명", "상품 명", "품목명", "품목"]) || "").trim();
    const partner = String(getValue(row, ["파트너사", "파트너명", "협력사명"]) || "").trim();
    const center = String(getValue(row, ["센터명", "센터"]) || "").trim();
    const qty = parseQty(getValue(row, ["수주수량", "수량"]));
    const incomingCost = parseQty(getValue(row, ["입고단가", "단가"]));

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

export const mergeRowsWithReservation = (baseRows, reservationRows) => {
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

export const mergeJobRowsWithReservation = (jobRows, reservationRows) =>
  mergeRowsWithReservation(
    (jobRows || []).filter((row) => !row.__reservationRow),
    reservationRows
  );

export const hashString = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return String(hash);
};

export const computeJobKey = (rows) =>
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

export const fileToBase64 = (file) =>
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
    reader.onerror = () => reject(new Error("파일을 변환하지 못했습니다."));
    reader.readAsDataURL(file);
  });

export const filesToBase64 = async (files) => {
  const list = Array.isArray(files) ? files : [];
  const results = [];

  for (const file of list) {
    const encoded = await fileToBase64(file);
    if (encoded) results.push(encoded);
  }

  return results;
};

export const getRecordType = (record) => {
  const type = String(record.처리유형 || "").trim();
  if (type) return type;
  if (parseQty(record.반품수량) > 0) return "반품";
  if (parseQty(record.교환수량) > 0) return "교환";
  return "검품";
};

export const getRecordQtyText = (record) => {
  const type = getRecordType(record);
  if (type === "반품" || type === "RETURN") return `${parseQty(record.반품수량)}건`;
  if (type === "교환" || type === "EXCHANGE") return `${parseQty(record.교환수량)}건`;

  const returnQty = parseQty(record.반품수량);
  const exchangeQty = parseQty(record.교환수량);
  if (returnQty > 0 && exchangeQty > 0) {
    return `반품 ${returnQty}건 / 교환 ${exchangeQty}건`;
  }
  return `${Math.max(returnQty, exchangeQty, 0)}건`;
};

export const base64ToBlob = (base64, mimeType = "application/octet-stream") => {
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

export const extractImageFormulaUrl = (value) => {
  const text = String(value || "").trim();
  const match = text.match(/^=IMAGE\("(.+)"\)$/i);
  return match ? match[1] : text;
};

export const extractGoogleDriveId = (value) => {
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

export const buildPhotoCandidate = (rawValue) => {
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

export const splitPhotoSourceText = (value) =>
  String(value || "")
    .split(/\r?\n|[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const getPhotoCandidatesFromRecord = (record) => {
  const rawItems = [
    record?.사진URL,
    record?.사진연결정보,
    ...splitPhotoSourceText(record?.사진연결정보목록),
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
