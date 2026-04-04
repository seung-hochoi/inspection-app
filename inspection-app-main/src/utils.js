// ─── Pure utility functions ────────────────────────────────────────────────

export const normalizeKey = (key) => String(key || "").replace(/\uFEFF/g, "").trim();

export const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\uFEFF/g, "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const normalizeProductCode = (value) => {
  if (value == null) return "";
  let text = String(value).replace(/\uFEFF/g, "").trim();
  const tMatch = text.match(/^=T\("(.+)"\)$/i);
  if (tMatch) text = tMatch[1];
  text = text.replace(/^"+|"+$/g, "").trim();
  const numericText = text.replace(/,/g, "").trim();
  if (/^\d+(\.0+)?$/.test(numericText)) return numericText.replace(/\.0+$/, "");
  return text;
};

export const parseQty = (value) => {
  const num = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isNaN(num) ? 0 : num;
};

export const clampText = (value, maxLength = 4000) => {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 7)}...(생략)`;
};

export const getValue = (row, candidates) => {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return "";
};

export const isTruthyUsage = (value) => {
  if (value === true) return true;
  const text = normalizeText(value);
  return ["true", "y", "yes", "1", "사용", "활성"].includes(text);
};

export const isExplicitFalseUsage = (value) => {
  if (value === false) return true;
  const text = normalizeText(value);
  return ["false", "n", "no", "0"].includes(text);
};

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

export const decodeCsvFile = async (file) => {
  const buffer = await file.arrayBuffer();
  const tryDecode = (encoding) => new TextDecoder(encoding).decode(buffer);
  const isBrokenText = (text) => (text.match(/占/g) || []).length > 5;
  let text = tryDecode("utf-8");
  if (isBrokenText(text)) text = tryDecode("euc-kr");
  return { text };
};

export const buildNormalizedRows = (parsedRows) =>
  parsedRows.map((rawRow, index) => {
    const row = {};
    Object.keys(rawRow || {}).forEach((key) => { row[normalizeKey(key)] = rawRow[key]; });

    const productCode = normalizeProductCode(
      getValue(row, ["상품코드", "상품 코드", "바코드", "코드"]) || row.__productCode || ""
    );
    const productName = String(
      getValue(row, ["상품명", "상품 명", "품목명", "품명"]) || row.__productName || ""
    ).trim();
    const partner = String(
      getValue(row, ["협력사명(구매조건명)", "협력사명", "거래처명", "협력사"]) || row.__partner || ""
    ).trim();
    const center = String(getValue(row, ["센터명", "센터"]) || row.__center || "").trim();
    const qty = parseQty(getValue(row, ["발주수량", "수량"]) || row.__qty || 0);

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
    Object.keys(rawRow || {}).forEach((key) => { row[normalizeKey(key)] = rawRow[key]; });
    const productCode = normalizeProductCode(getValue(row, ["상품코드", "상품 코드", "바코드", "코드"]));
    const productName = String(getValue(row, ["상품명", "상품 명", "품목명", "품명"]) || "").trim();
    const partner = String(getValue(row, ["협력사명", "협력사", "거래처명"]) || "").trim();
    const center = String(getValue(row, ["센터명", "센터"]) || "").trim();
    const qty = parseQty(getValue(row, ["수량", "발주수량"]));
    return {
      ...row,
      __id: `reservation-${productCode || "empty"}-${center}-${partner}-${index}`,
      __index: index,
      __productCode: productCode,
      __productName: productName,
      __partner: partner,
      __center: center,
      __qty: qty,
      __reservationRow: true,
      __productNameNormalized: normalizeText(productName),
      __partnerNormalized: normalizeText(partner),
    };
  });

export const mergeRowsWithReservation = (baseRows, reservationRows) => {
  const mergedMap = new Map();
  (baseRows || []).forEach((row) => {
    const key = [row.__center || "", row.__partner || "", row.__productCode || ""].join("||");
    mergedMap.set(key, { ...row });
  });
  (reservationRows || []).forEach((row) => {
    const key = [row.__center || "", row.__partner || "", row.__productCode || ""].join("||");
    const existing = mergedMap.get(key);
    if (existing) {
      mergedMap.set(key, { ...existing, ...row, __id: existing.__id, __index: existing.__index, __qty: parseQty(existing.__qty) + parseQty(row.__qty) });
      return;
    }
    mergedMap.set(key, { ...row });
  });
  return Array.from(mergedMap.values());
};

export const mergeJobRowsWithReservation = (jobRows, reservationRows) =>
  mergeRowsWithReservation((jobRows || []).filter((r) => !r.__reservationRow), reservationRows);

// Photo utilities
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

export const splitPhotoSourceText = (value) =>
  String(value || "")
    .split(/\r?\n|[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const buildPhotoCandidates = (record) => {
  const rawItems = [
    record?.사진URL,
    record?.사진링크,
    ...splitPhotoSourceText(record?.사진링크목록),
    ...splitPhotoSourceText(record?.사진파일ID목록),
  ];
  const seen = {};
  const candidates = [];
  rawItems.forEach((item) => {
    const text = String(item || "").trim();
    if (!text) return;
    const driveId = extractGoogleDriveId(text);
    if (driveId) {
      if (seen[driveId]) return;
      seen[driveId] = true;
      candidates.push({ key: driveId, previewUrl: `https://drive.google.com/thumbnail?id=${driveId}&sz=w1200` });
    } else if (/^https?:\/\//i.test(text)) {
      if (seen[text]) return;
      seen[text] = true;
      candidates.push({ key: text, previewUrl: text });
    }
  });
  return candidates;
};

export const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve({ fileName: file.name, mimeType: file.type || "application/octet-stream", imageBase64: base64 });
    };
    reader.onerror = () => reject(new Error("파일 읽기 실패"));
    reader.readAsDataURL(file);
  });

export const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ko-KR");
};

export const delay = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

// Make entity key for pending/save tracking
export const makeEntityKey = (jobKey, productCode, partnerName) =>
  [jobKey || "", productCode || "", partnerName || ""].join("||");
