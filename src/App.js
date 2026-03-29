import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { BrowserCodeReader, BrowserMultiFormatReader } from "@zxing/browser";
import * as XLSX from "xlsx";

const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzIR8srYEDBgHOUKGfs0J3nk2BY4fsDPiw0J5cHfXUU7t77cEPWYw15mdUcW0T7oCw7Xg/exec";

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

const clampText = (value, maxLength = 4000) => {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 7))}...(??嶺뚮ㅎ???`;
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

const BarcodeScanIcon = ({ size = 24, color = "currentColor" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M8 18C8 12.4772 12.4772 8 18 8H46C51.5228 8 56 12.4772 56 18V22H50V18C50 15.7909 48.2091 14 46 14H18C15.7909 14 14 15.7909 14 18V22H8V18Z"
      fill={color}
    />
    <rect x="16" y="20" width="4" height="22" rx="1.5" fill={color} />
    <rect x="24" y="20" width="6" height="18" rx="1.5" fill={color} />
    <rect x="34" y="20" width="3" height="24" rx="1.5" fill={color} />
    <rect x="41" y="20" width="7" height="16" rx="1.5" fill={color} />
    <path
      d="M36.8 44.4C40.6953 44.4 43.8511 47.5557 43.8511 51.4511V53.6C43.8511 54.9255 42.7766 56 41.4511 56H32.1489C30.8234 56 29.7489 54.9255 29.7489 53.6V51.4511C29.7489 47.5557 32.9047 44.4 36.8 44.4Z"
      fill={color}
    />
    <path
      d="M21 43C26.5228 43 31 47.4772 31 53H25C25 50.7909 23.2091 49 21 49H18V43H21Z"
      fill={color}
    />
    <path
      d="M10.5 42.5C15.7467 42.5 20 46.7533 20 52H16C16 48.9624 13.5376 46.5 10.5 46.5H8V42.5H10.5Z"
      fill={color}
      opacity="0.75"
    />
  </svg>
);

const FlashlightIcon = ({ size = 20, color = "currentColor", active = false }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M9 2H15L13.4 8H17L9.8 22L11.2 13H7L9 2Z"
      fill={active ? "#f8c84b" : color}
      stroke={active ? "#f8c84b" : color}
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

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

const isClassifiedHappycallProduct = (item) => {
  const name = String(item?.productName || "").trim();
  return !!name && name !== "미분류상품";
};

const buildVisibleHappycallRanks = (analytics) => {
  const periods = analytics?.periods || {};
  const rankMap = {};

  Object.entries(periods).forEach(([periodKey, periodValue]) => {
    (periodValue?.topProducts || [])
      .filter(isClassifiedHappycallProduct)
      .slice(0, 10)
      .forEach((item, index) => {
        const payload = {
          rank: index + 1,
          count: parseQty(item?.count || 0),
          share: Number(item?.share || 0),
        };
        rankMap[`${item?.partnerName || ""}||${item?.productCode || ""}`] = {
          ...(rankMap[`${item?.partnerName || ""}||${item?.productCode || ""}`] || {}),
          [periodKey]: payload,
        };
      });
  });

  return rankMap;
};

const normalizeImageMapLookupText = (value) => normalizeHappycallLookupText(value || "");

const makeProductImageMapKey = ({ productCode, partner, productName }) => {
  const code = normalizeProductCode(productCode || "");
  const partnerText = String(partner || "").trim();
  if (code || partnerText) {
    return `sku::${code}||${partnerText}`;
  }
  return `name::${normalizeImageMapLookupText(productName || "")}||${normalizeImageMapLookupText(partner || "")}`;
};

const normalizeImageToken = (value) => normalizeHappycallLookupText(value || "");

const buildImageMatcher = ({ partnerKeywords = [], productKeywords = [], excludeKeywords = [] }) => {
  const normalizedPartners = partnerKeywords.map(normalizeImageToken).filter(Boolean);
  const normalizedProducts = productKeywords.map(normalizeImageToken).filter(Boolean);
  const normalizedExcludes = excludeKeywords.map(normalizeImageToken).filter(Boolean);

  return (product) => {
    const partnerText = normalizeImageToken(product?.partner || "");
    const productText = normalizeImageToken(product?.productName || "");
    const lookupText = `${partnerText} ${productText}`;

    if (normalizedExcludes.some((keyword) => lookupText.includes(keyword))) {
      return false;
    }

    if (normalizedPartners.length && !normalizedPartners.some((keyword) => partnerText.includes(keyword))) {
      return false;
    }

    return normalizedProducts.every((keyword) => productText.includes(keyword));
  };
};

// ??????브컯? ?????꿔꺂????????ㅻ쿋??????
// 1) public/assets/products ?????????鶯ㅺ동????궰?
// 2) ????썹땟???꿔꺂??袁ㅻ븶筌믠뫀萸??partnerKeywords / productKeywords / src ????嚥????ㅻ쿋??????????嶺뚮ㅎ????
// ????リ뭡???????브컯??? ??????鶯ㅺ동?? ?꿔꺂????????????????癲ル슢???뼘??????욧쉥????嚥싳쉶瑗ч뇡癒?낟??????딅젩.
const PRODUCT_IMAGE_MAP = [
  {
    match: buildImageMatcher({
      partnerKeywords: ["델몬트", "delmonte"],
      productKeywords: ["프리미엄", "바나나"],
      excludeKeywords: ["파인애플", "스위티오파인애플", "클래식", "킹사이즈"],
    }),
    src: "/assets/products/delmonte-banana-pack.png",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["델몬트", "delmonte"],
      productKeywords: ["클래식", "바나나"],
      excludeKeywords: ["파인애플"],
    }),
    src: "/assets/products/delmonte-banana-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["델몬트", "delmonte"],
      productKeywords: ["킹사이즈", "바나나"],
    }),
    src: "/assets/products/delmonte-king-banana.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["돌", "dole", "스위티오"],
      productKeywords: ["바나나", "2입"],
      excludeKeywords: ["파인애플"],
    }),
    src: "/assets/products/dole-sweetio-banana-2.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["돌", "dole", "스위티오"],
      productKeywords: ["바나나"],
      excludeKeywords: ["파인애플", "2입"],
    }),
    src: "/assets/products/dole-sweetio-banana-scene.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["파인애플"],
    }),
    src: "",
  },
  {
    match: buildImageMatcher({ productKeywords: ["오이맛고추"] }),
    src: "/assets/products/cucumber-spicy.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["청양고추"] }),
    src: "/assets/products/pepper-hot-pack.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["고추"] }),
    src: "/assets/products/green-chili-pack.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["오이"] }),
    src: "/assets/products/cucumber-plain.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["애호박"] }),
    src: "/assets/products/aehobak-single.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["마늘"] }),
    src: "/assets/products/garlic-bowl.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["양파"] }),
    src: "/assets/products/onion-single.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["새송이버섯"] }),
    src: "/assets/products/mushroom-king-oyster.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["팽이버섯"] }),
    src: "/assets/products/enoki-pack.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["꽃상추"] }),
    src: "/assets/products/red-lettuce-pack.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["상추"] }),
    src: "/assets/products/lettuce-green.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["부추"] }),
    src: "/assets/products/chives-bag.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["시금치"] }),
    src: "/assets/products/spinach-bag.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["깻잎"] }),
    src: "/assets/products/perilla-pack.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["참나물"] }),
    src: "/assets/products/chamnamul-bag.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["달래"] }),
    src: "/assets/products/dalrae-bag.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["냉이"] }),
    src: "/assets/products/shepherds-purse-bag.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["브로콜리"] }),
    src: "/assets/products/broccoli.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["양배추"] }),
    src: "/assets/products/cabbage-half.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["고구마"] }),
    src: "/assets/products/sweetpotato-pink-bag.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["연어"] }),
    src: "/assets/products/salmon-pack.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["목심"] }),
    src: "/assets/products/pork-neck-pack.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["삼겹"] }),
    src: "/assets/products/pork-neck-pack.jpeg",
  },
  {
    match: buildImageMatcher({ productKeywords: ["바나나"] }),
    src: "/assets/products/banana-generic.jpeg",
  },
];

const getProductImageSrc = (product, customImageMap = {}) => {
  const productText = normalizeImageToken(product?.productName || "");
  if (!productText) return "";

  if (productText.includes(normalizeImageToken("미분류상품"))) {
    return "";
  }

  const customKey = makeProductImageMapKey({
    productCode: product?.productCode || "",
    partner: product?.partner || "",
    productName: product?.productName || "",
  });

  if (customKey && customImageMap[customKey]) {
    return customImageMap[customKey];
  }

  const matched = PRODUCT_IMAGE_MAP.find((entry) => entry.match(product || {}));
  return matched?.src || "";
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
  return ["true", "y", "yes", "1", "예", "사용"].includes(text);
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

  const isBrokenText = (text) => (String(text || "").match(/�/g) || []).length > 5;

  let text = tryDecode("utf-8");
  if (isBrokenText(text)) text = tryDecode("euc-kr");
  return { text };
};

const parseHappycallSourceFile = async (file) => {
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

const buildNormalizedRows = (parsedRows) =>
  parsedRows.map((rawRow, index) => {
    const row = {};

    Object.keys(rawRow || {}).forEach((key) => {
      row[normalizeKey(key)] = rawRow[key];
    });

    const productCode = normalizeProductCode(
      getValue(row, ["상품코드", "상품 코드", "소분류코드", "코드"])
    );
    const productName = String(
      getValue(row, ["상품명", "상품 명", "소분류", "품목명", "상품"]) || ""
    ).trim();
    const partner = String(
      getValue(row, ["협력사", "파트너", "파트너사", "거래처", "처리파트너사", "파트너명"]) || ""
    ).trim();
    const center = String(getValue(row, ["센터", "물류센터", "점포명", "점포"]) || "").trim();
    const qty = parseQty(getValue(row, ["입고량", "수주수량", "발주수량", "검품수량", "수량", "미출수량"]));

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
      getValue(row, ["상품코드", "상품 코드", "소분류코드", "코드"])
    );
    const productName = String(getValue(row, ["상품명", "상품 명", "소분류", "품목명", "상품"]) || "").trim();
    const partner = String(getValue(row, ["협력사", "파트너", "파트너사", "거래처", "처리파트너사", "파트너명"]) || "").trim();
    const center = String(getValue(row, ["센터", "물류센터", "점포명", "점포"]) || "").trim();
    const qty = parseQty(getValue(row, ["입고량", "수주수량", "발주수량", "검품수량", "수량", "미출수량"]));
    const incomingCost = parseQty(getValue(row, ["입고가", "원가", "매입가", "비용"]));

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
    reader.onerror = () => reject(new Error("??傭????ш끽諭욥??????곌숯"));
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
  if (
    String(label).includes("%") ||
    String(label).includes("율") ||
    String(label).includes("비중")
  ) {
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
  const type = String(record["기록유형"] || record["유형"] || "").trim();
  if (type) return type;
  if (parseQty(record["회송량"]) > 0) return "RETURN";
  if (parseQty(record["교환량"]) > 0) return "EXCHANGE";
  return "UNKNOWN";
};

const getRecordQtyText = (record) => {
  const type = getRecordType(record);
  if (type === "회송" || type === "RETURN") return `${parseQty(record["회송량"])}개`;
  if (type === "교환" || type === "EXCHANGE") return `${parseQty(record["교환량"])}개`;

  const returnQty = parseQty(record["회송량"]);
  const exchangeQty = parseQty(record["교환량"]);
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
    record?.["사진URL"],
    record?.["사진파일ID"],
    ...splitPhotoSourceText(record?.["사진목록"]),
    ...splitPhotoSourceText(record?.["사진파일IDs"]),
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
    return <div style={styles.photoThumbEmpty}>사진을 불러오지 못했습니다.</div>;
  }

  return (
    <img
      src={candidate.previewUrl}
      alt={`등록 이미지 ${index + 1}`}
      style={styles.photoThumb}
      onClick={() => onOpen(candidate.previewUrl)}
      onError={() => setFailed(true)}
    />
  );
}

function HistoryPhotoPreview({ record, onOpen, styles }) {
  const candidates = useMemo(() => getPhotoCandidatesFromRecord(record), [record]);

  if (!candidates.length) {
    return <div style={styles.photoEmpty}>등록된 사진이 없습니다.</div>;
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
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );
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
  const [scannerStatus, setScannerStatus] = useState("카메라를 준비하고 있습니다...");
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

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleResize = () => setViewportWidth(window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isPhoneLayout = viewportWidth <= 430;
  const isVeryNarrowPhone = viewportWidth <= 390;

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
          merged["회송량"] = prevEntry["회송량"] || 0;
          merged["교환량"] = prevEntry["교환량"] || 0;
          merged["센터"] = prevEntry["센터"] || merged["센터"] || "";
          merged["비고"] = prevEntry["비고"] || merged["비고"] || "";
          merged.photoFiles =
            (Array.isArray(entry.photoFiles) && entry.photoFiles.length
              ? entry.photoFiles
              : prevEntry.photoFiles) || [];
        }

        if (entry.type === "return" || entry.type === "exchange") {
          merged["수량"] = prevEntry["수량"] || merged["수량"] || 0;
        }

        if (entry.type === "movement") {
          merged.qty = parseQty(prevEntry.qty) + parseQty(entry.qty);
          merged["회송량"] = parseQty(prevEntry["회송량"]) + parseQty(entry["회송량"]);
          merged["교환량"] = parseQty(prevEntry["교환량"]) + parseQty(entry["교환량"]);
          merged["비고"] = entry["비고"] || prevEntry["비고"] || "";
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

  const openRearCameraStream = async (reader, callback) => {
    const videoElement = scannerVideoRef.current;
    if (!videoElement) {
      throw new Error("카메라 화면을 찾을 수 없습니다.");
    }

    try {
      return await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        videoElement,
        callback
      );
    } catch (_) {
      try {
        return await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          videoElement,
          callback
        );
      } catch (_) {
        const devices = await BrowserCodeReader.listVideoInputDevices();
        const backCamera = devices.find((device) =>
          /back|rear|environment|후면|뒤/i.test(String(device.label || ""))
        );
        if (backCamera?.deviceId) {
          return await reader.decodeFromVideoDevice(backCamera.deviceId, videoElement, callback);
        }
        throw new Error("후면 카메라를 찾을 수 없습니다.");
      }
    }
  };
const startScanner = useCallback(async () => {
    try {
      setScannerError("");
      setScannerReady(false);
      setScannerStatus("카메라를 준비하고 있습니다...");

      const reader = new BrowserMultiFormatReader();

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
      };

      scannerControlsRef.current = await openRearCameraStream(reader, callback);

      scannerStatusTimerRef.current = setInterval(() => {
        setScannerStatus((prev) =>
          prev === "바코드를 찾고 있습니다..."
            ? "바코드를 화면 중앙에 맞춰 주세요."
            : "바코드를 찾고 있습니다..."
        );
      }, 2200);

      setScannerStatus("바코드를 찾고 있습니다...");
    } catch (err) {
      setScannerError(err.message || "카메라를 시작하지 못했습니다.");
      setScannerStatus("카메라를 사용할 수 없습니다.");
      stopScanner();
    }
  }, [closeScanner, openRearCameraStream, stopScanner]);
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
        throw new Error(result.message || "CSV ??????????????곌숯");
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
  
      setMessage("CSV ????寃??????썹땟??);
    } catch (err) {
      setError(err.message || "CSV ?꿔꺂??節뉖き???????곌숯");
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
      setError("REACT_APP_GOOGLE_SCRIPT_URL ?????ъ졒??⑤슢堉???? ????썹땟???嶺뚮ㅎ????");
      return;
    }

    try {
      setBootLoading(true);
      setError("");

      const response = await fetch(`${SCRIPT_URL}?action=bootstrap`);
      const result = await response.json();

      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "?潁??용끏???????????? ???곗뵯????? ?꿔꺂??쭫?묒쒜?壤??????");
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
          getValue(row, ["???ㅺ강??熬곣뫀???, "???ㅺ강? ?熬곣뫀???, "?熬곣뫀???, "?袁⑸즴????])
        );
        const partner = String(getValue(row, ["???쑩???, "???쑩???嶺?]) || "").trim();
        const useFlag = getValue(row, ["??????"]);

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
          getValue(row, ["???ㅺ강??熬곣뫀???, "???ㅺ강? ?熬곣뫀???, "?熬곣뫀???, "?袁⑸즴????])
        );
        const eventName = String(getValue(row, ["??繹먭퍗?э┼?]) || "").trim();
        const useFlag = getValue(row, ["??????"]);

        if (!productCode) return;
        if (isExplicitFalseUsage(useFlag)) return;

        nextEventMap[productCode] = {
          ??繹먭퍗????: "??繹먭퍗??,
          ??繹먭퍗?э┼? eventName,
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
          const key = String(item?.["癲ル슢???⑸눀??] || "").trim();
          const fileId = String(item?.["????얠큸D"] || "").trim();
          const url = fileId
            ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`
            : String(item?.["????癲ル슣??URL"] || "").trim();
          if (key && url) acc[key] = url;
          return acc;
        }, {})
      );
      setMessage(job ? "?꿔꺂????쭍????????????곗뵯?????됰Ŋ?좂뜏?????딅젩." : "CSV??????寃?????琉????녿뮝???ル튉??");
    } catch (err) {
      setError(err.message || "?潁??용끏???????????? ???곗뵯????? ?꿔꺂??쭫?묒쒜?壤??????");
    } finally {
      setBootLoading(false);
    }
  }, []);

  const fetchHistoryRowsData = useCallback(async () => {
    const response = await fetch(`${SCRIPT_URL}?action=getRecords`);
    const result = await response.json();

    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "????ㅿ폎?????곗뵯??????곗뵚???????곌숯");
    }

    return (Array.isArray(result.records) ? result.records : []).sort((a, b) =>
      String(b["??獄쏅똻???繹먮굝六?] || "").localeCompare(String(a["??獄쏅똻???繹먮굝六?] || ""), "ko")
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
      setError(err.message || "????ㅿ폎??????곗뵯????? ?꿔꺂??쭫?묒쒜?壤??????");
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
      const productName = row.__productName || "????브컯???????ㅼ굡??;
      const partner = row.__partner || "???????????ㅼ굡??;
      const center = row.__center || "????ル∥??????ㅼ굡??;
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

    const visibleHappycallRankMap = buildVisibleHappycallRanks(happycallAnalytics);

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
      const key = `${record["???쑩???嶺?] || record["???쑩???] || ""}||${record["???ㅺ강??熬곣뫀???] || ""}`;
      if (!map[key]) {
        map[key] = { returnCount: 0, exchangeCount: 0 };
      }

      if (parseQty(record["??????嚥???]) > 0) {
        map[key].returnCount += 1;
      }

      if (parseQty(record["???????嚥???]) > 0) {
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
          imageSrc: getProductImageSrc({
            productName: item?.productName || "",
            partner: item?.partnerName || "",
            productCode: item?.productCode || "",
          }, productImageMap),
        })),
    [happycallAnalytics, productImageMap]
  );

  const happycallHeroCard = previousDayHappycallTopList[0] || null;
  const happycallMiniCards = previousDayHappycallTopList.slice(1, 5);
  const totalVisibleProducts = groupedPartners.reduce((sum, item) => sum + item.products.length, 0);
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
      throw new Error(result.message || "????ㅿ폎???????????곌숯");
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

    const targetProduct = imageRegistryProducts.find((item) => item.imageKey === selectedImageTargetKey) ||
      groupedPartners.flatMap((group) => group.products.map((product) => ({
        partner: group.partner,
        productCode: product.productCode,
        productName: product.productName,
        imageKey: makeProductImageMapKey({
          productCode: product.productCode,
          partner: group.partner,
          productName: product.productName,
        }),
      }))).find((item) => item.imageKey === selectedImageTargetKey);

    if (!targetProduct) {
      setError("?嚥싲갭큔?댁쉩??????????브컯????꿔꺂????? ?꿔꺂??쭫?묒쒜?壤??????");
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
        throw new Error(result.message || "?????꿔꺂??? ?嚥싲갭큔?댁쉩???????곌숯");
      }

      const nextMap = (Array.isArray(result.product_images) ? result.product_images : []).reduce((acc, item) => {
        const key = String(item?.["癲ル슢???⑸눀??] || "").trim();
        const fileId = String(item?.["????얠큸D"] || "").trim();
        const url = fileId
          ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`
          : String(item?.["????癲ル슣??URL"] || "").trim();
        if (key && url) acc[key] = url;
        return acc;
      }, {});
      setProductImageMap(nextMap);
      setToast("?????꿔꺂??? ?嚥싲갭큔?댁쉩??????썹땟??);
      setMessage("????브컯? ?????꿔꺂?????醫딆쓧? ?嚥싲갭큔?댁쉩???嶺???????");
    } catch (err) {
      setError(err.message || "?????꿔꺂??? ?嚥싲갭큔?댁쉩???????곌숯");
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
          ??鶯?? photosPayload,
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
        throw new Error(result.message || "?熬곣뫖利????????????곌숯");
      }

      removePendingKeys(targetKeys);
      setItemStatuses(targetKeys, "saved");

      if (Array.isArray(result.records)) {
        const nextRows = [...result.records].sort((a, b) =>
          String(b["??獄쏅똻???繹먮굝六?] || "").localeCompare(String(a["??獄쏅똻???繹먮굝六?] || ""), "ko")
        );
        setHistoryRows(nextRows);
      }

      if (result.summary) {
        setDashboardSummary(result.summary);
      }

      setToast("????????썹땟??);
    } catch (err) {
      setItemStatuses(targetKeys, "failed");
      setError(err.message || "?熬곣뫖利????????????곌숯");
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
      setError("?嚥▲굧??????⑤베臾??濚밸Ŧ?뤸뤃?????怨몄７?????녿뮝???ル튉??");
      return;
    }

    setError("");
    setMessage("");
    upsertPendingEntries([
      {
        key: entityKey,
        type: "inspection",
        ??????먮섀饔낅챸???? currentJob?.job_key || "",
        ??獄쏅똻???繹먮굝六? new Date().toISOString(),
        ???ㅺ강??熬곣뫀??? product.productCode,
        ???ㅺ강?癲? product.productName,
        ???쑩???嶺? product.partner,
        ??ш끽維?管???우툔櫻??嚥??? product.totalQty || 0,
        ?袁⑸즵獒뺣뎿爾??嚥??? product.totalQty || 0,
        ?濡ろ떟????怨뺣묄?? qty,
        ??????嚥??? pendingMap[entityKey]?.["??????嚥???] || 0,
        ???????嚥??? pendingMap[entityKey]?.["???????嚥???] || 0,
        ???醫롫뙃癲? pendingMap[entityKey]?.["???醫롫뙃癲?] || "",
        ????? pendingMap[entityKey]?.["?????] || "",
        ??繹먭퍗????: product.eventInfo?.["??繹먭퍗????"] || "",
        ??繹먭퍗?э┼? product.eventInfo?.["??繹먭퍗?э┼?] || "",
        photoFiles: photoFiles.length ? photoFiles : pendingMap[entityKey]?.photoFiles || [],
      },
    ]);
    setToast("???逆곷틳源얗??????????딅젩.");
  };

  const saveReturnExchange = async (product, centerName) => {
    const centerInfo = product.centers.find((item) => item.center === centerName);
    if (!centerInfo) {
      setError("????ル∥???????ｋ??????녿뮝???ル튉??");
      return;
    }

    const draftKey = `return||${product.partner}||${product.productCode}||${centerName}`;
    const draft = drafts[draftKey] || {};
    const returnQty = parseQty(draft.returnQty);
    const exchangeQty = parseQty(draft.exchangeQty);
    const memo = String(draft.memo || "").trim();
    const photoFiles = Array.isArray(draft.photoFiles) ? draft.photoFiles : [];

    if (!currentJob?.job_key) {
      setError("??????醫딆쓧??嚥싳쇎紐???????????뚯??? CSV??醫딆쓧? ????ㅿ폍??????딅젩.");
      return;
    }

    if (returnQty <= 0 && exchangeQty <= 0 && !memo && photoFiles.length === 0) {
      setError("?????????? ??????????? ????? ??傭?嚥????β뼯援η뙴??????壤?????怨몄７?????녿뮝???ル튉??");
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
        ??????먮섀饔낅챸???? currentJob?.job_key || "",
        ??獄쏅똻???繹먮굝六? new Date().toISOString(),
        ???ㅺ강?癲? product.productName,
        ???ㅺ강??熬곣뫀??? product.productCode,
        ???醫롫뙃癲? centerName,
        ???쑩???嶺? product.partner,
        ?袁⑸즵獒뺣뎿爾??嚥??? centerInfo.totalQty || 0,
        ??繹먭퍗????: product.eventInfo?.["??繹먭퍗????"] || "",
        ??繹먭퍗?э┼? product.eventInfo?.["??繹먭퍗?э┼?] || "",
        癲ル슪?ｇ몭????レ챺?? "?????,
        ??????嚥??? returnQty,
        ???????嚥??? 0,
        qty: returnQty,
        ????? memo,
        photoFiles,
        ??ш끽維?管???우툔櫻??嚥??? product.totalQty || 0,
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
        ??????먮섀饔낅챸???? currentJob?.job_key || "",
        ??獄쏅똻???繹먮굝六? new Date().toISOString(),
        ???ㅺ강?癲? product.productName,
        ???ㅺ강??熬곣뫀??? product.productCode,
        ???醫롫뙃癲? "",
        ???쑩???嶺? product.partner,
        ?袁⑸즵獒뺣뎿爾??嚥??? product.totalQty || 0,
        ??繹먭퍗????: product.eventInfo?.["??繹먭퍗????"] || "",
        ??繹먭퍗?э┼? product.eventInfo?.["??繹먭퍗?э┼?] || "",
        癲ル슪?ｇ몭????レ챺?? "??????,
        ??????嚥??? 0,
        ???????嚥??? exchangeQty,
        qty: exchangeQty,
        ????? memo,
        photoFiles,
        ??ш끽維?管???우툔櫻??嚥??? product.totalQty || 0,
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
    setToast("???逆곷틳源얗??????????딅젩.");
  };

  const deleteHistoryRecord = async (record) => {
    const rowNumber = Number(record.__rowNumber || 0);
    if (!rowNumber) {
      setError("????????癲ル슢???ъ쒜???꿔꺂????? ?꿔꺂??쭫?묒쒜?壤??????");
      return;
    }

    const ok = window.confirm("??????ㅿ폎??????????ャ렑???");
    if (!ok) return;

    try {
      setDeletingRowNumber(rowNumber);
      await cancelMovementEventByRow(rowNumber);
      setHistoryRows((prev) => prev.filter((item) => Number(item.__rowNumber) !== rowNumber));
      setToast("????????썹땟??);
    } catch (err) {
      setError(err.message || "????ㅿ폎???????????곌숯");
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
        throw new Error(result.message || "ZIP ???繹먮굝??汝??吏??좉텣??????곌숯");
      }

      if (!result.zipBase64) {
        setToast("???繹먮굝??汝??吏??좉텣???醫딆쓧??嚥싳쇎紐????傭??????ㅿ폍??????딅젩.");
        return;
      }

      const blob = base64ToBlob(result.zipBase64, result.mimeType || "application/zip");
      const link = document.createElement("a");
      const href = URL.createObjectURL(blob);
      const fileName = result.fileName ||
        (mode === "movement"
          ? `?????????????傭?${formatDateForFileName()}.zip`
          : mode === "inspection"
          ? `?嚥▲굧??????????${formatDateForFileName()}.zip`
          : `?꿔꺂??癰귥빖????傭?${formatDateForFileName()}.zip`);

      link.href = href;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setToast("ZIP ???繹먮굝??汝??吏??좉텣?????썹땟??);
    } catch (err) {
      setError(err.message || "ZIP ???繹먮굝??汝??吏??좉텣??????곌숯");
    } finally {
      setZipDownloading("");
    }
  };

  const resetCurrentJobInputs = async () => {
    if (!currentJob?.job_key) {
      setError("?潁??용끏????????????썹땟?????????????ㅿ폍??????딅젩.");
      return;
    }

    if (!adminPassword.trim()) {
      setError("???援온??잙갭큔????????筌?????沃섃뮧嫄?????怨몄７?????녿뮝???ル튉??");
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
        throw new Error(result.message || "?潁??용끏????????곌숯");
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
      setToast("????썹땟????????????怨몄７ ??????????潁??용끏???????썹땟??);
    } catch (err) {
      setError(err.message || "?潁??용끏????????곌숯");
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
          ??筌먯룄肄? clampText(row["??筌먯룄肄?] || row["subject"] || "", 300),
          ?怨뚮옖筌?쑜猷? clampText(row["?怨뚮옖筌?쑜猷?] || row["body"] || row["???⑤챶裕????????"] || "", 8000),
          癲ル슢???筌≪퓦: clampText(row["?嶺뚮ㅏ援???癲ル슢??????? ID"] || row["癲ル슢???筌≪퓦"] || row["??????묐탶?⑤베???] || "", 200),
          ?怨뚮옖?雅???? clampText(row["?怨뚮옖?雅????(?????"] || row["senderName"] || "", 200),
          ???????繹먮굝六? clampText(row["???????繹먮굝六?] || row["receivedAt"] || "", 100),
          ???⑤베肄?????? clampText(row["癲ル슪?ｇ몭????⑤베肄??????] || row["???⑤베肄??????] || row["???쑩???嶺?] || "", 200),
          ???믩눀???レ챺?? clampText(
            row["???믩눀???レ챺????)"] || row["???믩눀???レ챺??濚?"] || row["???믩눀???レ챺????"] || row["???믩눀???レ챺??] || "",
            200
          ),
        }))
        .filter((row) => String(row.??筌먯룄肄?|| "").trim() || String(row.?怨뚮옖筌?쑜猷?|| "").trim());

      const dedupedMap = new Map();
      rawRows.forEach((row) => {
        const dedupeKey = [
          String(row.癲ル슢???筌≪퓦 || "").trim(),
          String(row.???⑤베肄??????|| "").trim(),
          String(row.???????繹먮굝六?|| "").trim(),
          String(row.??筌먯룄肄?|| "").trim(),
          String(row.?怨뚮옖筌?쑜猷?|| "").trim().slice(0, 300),
        ].join("||");
        dedupedMap.set(dedupeKey, row);
      });

      const rows = Array.from(dedupedMap.values());
      const skippedCount = Math.max(0, rawRows.length - rows.length);

      if (!rows.length) {
        throw new Error("???ш끽維???CSV???????醫딆쓧??癲ル슢???몄쒜????????됲닓 ??濚밸Ŧ???????ㅿ폍??????딅젩.");
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
          `???ш끽維???CSV ?꿔꺂??節뉖き??嚥?.. ${batchNumber}/${totalBatches} ?熬곣뫖利???(${processedCount} / ${rows.length})`
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
            result.message || `???ш끽維???CSV ??醫딆쓧??癲ル슢???몄쒜嚥▲룗?耀붾굝梨?影?뉖뜦??????곌숯??????????딅젩. (${batchNumber}/${totalBatches} ?熬곣뫖利???`
          );
        }

        lastResult = result;
        insertedTotal += Number(result?.data?.inserted || 0);
        updatedTotal += Number(result?.data?.updated || 0);
      }

      setHappycallAnalytics(lastResult?.happycall || {});
      setMessage("");
      setToast(
        `??熬곣뫀猷??CSV ?袁⑸즵?????ш끽維??勇????ル㎦??${insertedTotal}癲?勇???좊즲???${updatedTotal}癲?{
          skippedCount > 0 ? ` 勇?濚욌꼬?댄꺇????筌믨퀡??${skippedCount}癲? : ""
        }`
      );
    } catch (err) {
      setError(
        `${err.message || "??熬곣뫀猷??CSV ??좊읈??嶺뚮ㅎ?닸쾮濡㏓섀饔낅챸?節덇덩?????됰꽡???怨?????덊렡."} ??좊즵?? CSV?????怨뺣빰 ????⑥궡異????⑤９苑???袁⑸즵????筌뤾퍓???`
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
          <div style={styles.brandBlock}>
            <div style={styles.brandRow}>
              <img src="/assets/gs-logo.svg" alt="GS ?汝??吏?? style={styles.brandLogo} />
              <h1 style={styles.title}>GS???モ??⑸쨬??낃뭣?筌먦룂????? ?濡ろ떟?????筌?痢??/h1>
            </div>
            <div style={styles.headerLinkRow}>
              <a href={worksheetUrl || "#"} target="_blank" rel="noreferrer" style={styles.headerLink}>
                {worksheetUrl || "????ㅼ뒩??????ъ뎽 URL ????ㅼ굡??}
              </a>
              <button
                type="button"
                onClick={async () => {
                  if (!worksheetUrl) return;
                  try {
                    await navigator.clipboard.writeText(worksheetUrl);
                    setToast("????ㅼ뒩??????ъ뎽 ?꿔꺂???疫뀀９臾???⑤슢?뽫뵓怨???????썹땟??);
                  } catch (_) {
                    setError("????ㅼ뒩??????ъ뎽 ?꿔꺂???疫뀀９臾???⑤슢?뽫뵓怨????????곌숯");
                  }
                }}
                style={styles.copyButton}
              >
                ??⑤슢?뽫뵓怨???
              </button>
            </div>
          </div>
          <div style={styles.headerModeBadge}>{mode === "inspection" ? "?濡ろ떟???癲ル슢?꾤땟??? : "???????????癲ル슢?꾤땟???}</div>
        </div>
        <div style={styles.quickActionGrid}>
          <button
            type="button"
            onClick={() => setMode("inspection")}
            style={{ ...styles.quickActionCard, ...(mode === "inspection" ? styles.quickActionCardActive : {}) }}
          >
            <span style={styles.quickActionIcon}>???/span>
            <span style={styles.quickActionText}>?濡ろ떟???/span>
          </button>
          <button
            type="button"
            onClick={() => setMode("return")}
            style={{ ...styles.quickActionCard, ...(mode === "return" ? styles.quickActionCardActive : {}) }}
          >
            <span style={styles.quickActionIcon}>??類?퐲?</span>
            <span style={styles.quickActionText}>?????/span>
          </button>
          <button
            type="button"
            onClick={async () => {
              setShowHistory(true);
              await loadHistoryRows();
            }}
            style={styles.quickActionCard}
          >
            <span style={styles.quickActionIcon}>???/span>
            <span style={styles.quickActionText}>????ㅿ폎??/span>
          </button>
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.csvHeaderRow}>
          <div>
            <div style={styles.sectionTitle}>CSV ????겾??/div>
            <div style={styles.metaText}>
              ????썹땟???????? {currentFileName || "????寃??嶺뚮㉡?ｇ빊??????????ㅼ굡??}
            </div>
            <div style={styles.metaText}>
              ?????????볥궚???濚밸Ŧ?긷칰? {currentFileModifiedAt ? formatDateTime(currentFileModifiedAt) : "-"}
            </div>
          </div>
          <div style={styles.csvActionRow}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={styles.primaryButton}
            >
              {uploadingCsv ? "癲ル슪?ｇ몭??濚?.." : "?濡ろ떟???CSV ????겾??}
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
              {uploadingHappycallCsv ? "癲ル슪?ｇ몭??濚?.." : "??熬곣뫀猷??????겾??}
            </button>
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
              이미지 등록            </button>
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
        <div
          style={{
            ...styles.searchRow,
            gap: isVeryNarrowPhone ? 8 : styles.searchRow.gap,
          }}
        >
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품명 / 상품코드 / 협력사 검색"
            style={{
              ...styles.searchInput,
              fontSize: isPhoneLayout ? 15 : styles.searchInput.fontSize,
              padding: isPhoneLayout ? 10 : styles.searchInput.padding,
            }}
          />
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            style={{
              ...styles.scanButton,
              minWidth: isVeryNarrowPhone ? 52 : styles.scanButton.minWidth,
              minHeight: isPhoneLayout ? 46 : styles.scanButton.minHeight,
              fontSize: isPhoneLayout ? 17 : styles.scanButton.fontSize,
            }}
            aria-label="바코드 스캔"
          >
            <span style={styles.scanIcon}><BarcodeScanIcon size={26} /></span>
          </button>
        </div>
      </div>

      {(bootLoading || uploadingCsv || error || message) && (
        <div style={error ? styles.errorBox : styles.infoBox}>
          {bootLoading
            ? "?潁??용끏???????????? ???곗뵯??????紐꾪닓 嚥?.."
            : uploadingCsv
            ? "CSV ?꿔꺂??節뉖き??嚥?.."
            : error || message}
        </div>
      )}

      <div style={styles.panel}>
        <div style={styles.happycallHeader}>
          <div>
            <div style={styles.sectionTitle}>????썹땟?㈑????ш끽維???TOP 5 {totalVisibleProducts ? `(${totalVisibleProducts}??` : ""}</div>
            <div style={styles.heroSubtext}>????썹땟?㈑??????????ш끽維??????뚯???</div>
          </div>
        </div>

        {previousDayHappycallTopList.length === 0 ? (
          <div style={styles.emptyBox}>????썹땟?㈑????ш끽維????????????? ????ㅿ폍??????딅젩.</div>
        ) : (
          <div style={styles.happycallShowcase}>
            {happycallHeroCard ? (
              <div
                style={{
                  ...styles.heroTopCard,
                  gridTemplateColumns: isVeryNarrowPhone ? "minmax(0, 1fr) 92px" : styles.heroTopCard.gridTemplateColumns,
                  padding: isPhoneLayout ? 14 : styles.heroTopCard.padding,
                  gap: isPhoneLayout ? 10 : styles.heroTopCard.gap,
                }}
              >
                <div style={styles.heroTopCopy}>
                  <div style={styles.heroTopBadge}>
                    <span style={styles.heroTopMedal}>{getTopMedal(happycallHeroCard.rank)}</span>
                    <span style={styles.heroTopBadgeText}>TOP {happycallHeroCard.rank}</span>
                  </div>
                  <div
                    style={{
                      ...styles.heroTopName,
                      fontSize: isVeryNarrowPhone ? 15 : isPhoneLayout ? 17 : styles.heroTopName.fontSize,
                    }}
                  >
                    {happycallHeroCard.productName}
                  </div>
                  <div style={styles.heroTopMeta}>
                    {happycallHeroCard.count.toLocaleString("ko-KR")}????{formatPercent(happycallHeroCard.share)}
                  </div>
                  <div style={styles.heroProgressRow}>
                    <div style={styles.heroProgressTrack}>
                      <div
                        style={{
                          ...styles.heroProgressFill,
                          width: `${Math.max(14, Math.min(100, happycallHeroCard.share * 100))}%`,
                        }}
                      />
                    </div>
                    <div style={styles.heroProgressValue}>{formatPercent(happycallHeroCard.share)}</div>
                  </div>
                </div>
                <div
                  style={{
                    ...styles.heroImageFrame,
                    height: isVeryNarrowPhone ? 90 : isPhoneLayout ? 96 : styles.heroImageFrame.height,
                  }}
                >
                  {happycallHeroCard.imageSrc ? (
                    <img
                      src={happycallHeroCard.imageSrc}
                      alt={happycallHeroCard.productName}
                      style={styles.heroImage}
                    />
                  ) : (
                    <div style={styles.heroFallbackImage}>??類?퐲?</div>
                  )}
                </div>
              </div>
            ) : null}

            {happycallMiniCards.length ? (
              <div
                style={{
                  ...styles.heroMiniGrid,
                  gap: isPhoneLayout ? 8 : styles.heroMiniGrid.gap,
                }}
              >
                {happycallMiniCards.map((card) => (
                  <div
                    key={`happycall-top-${card.rank}`}
                    style={{
                      ...styles.heroMiniCard,
                      padding: isPhoneLayout ? 12 : styles.heroMiniCard.padding,
                      minHeight: isVeryNarrowPhone ? 136 : isPhoneLayout ? 144 : styles.heroMiniCard.minHeight,
                      borderColor:
                        card.rank === 2 ? "#93c5fd" : card.rank === 3 ? "#86efac" : "#dbe3f0",
                    }}
                  >
                    <div style={styles.heroMiniLabel}>
                      <span>{getTopMedal(card.rank) || "??}</span>
                      <span>{card.rank <= 3 ? `TOP ${card.rank}` : ""}</span>
                    </div>
                    <div
                      style={{
                        ...styles.heroMiniContent,
                        gridTemplateColumns:
                          card.imageSrc && !isVeryNarrowPhone ? "minmax(0, 1fr) 46px" : "minmax(0, 1fr)",
                        alignItems: "start",
                      }}
                    >
                      <div style={styles.heroMiniCopy}>
                        <div
                          style={{
                            ...styles.heroMiniName,
                            fontSize: isVeryNarrowPhone ? 12 : 14,
                            lineHeight: 1.28,
                            display: "-webkit-box",
                            WebkitLineClamp: isVeryNarrowPhone ? 3 : 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {card.productName}
                        </div>
                        <div style={styles.heroMiniMeta}>
                          {card.count.toLocaleString("ko-KR")}????{formatPercent(card.share)}
                        </div>
                      </div>
                      {card.imageSrc ? (
                        <div
                          style={{
                            ...styles.heroMiniThumbFrame,
                            width: isVeryNarrowPhone ? 40 : 46,
                            height: isVeryNarrowPhone ? 40 : 46,
                            justifySelf: "end",
                            alignSelf: "center",
                          }}
                        >
                          <img src={card.imageSrc} alt={card.productName} style={styles.heroMiniThumbImage} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div
              style={{
                ...styles.heroActionRow,
                gap: isPhoneLayout ? 6 : styles.heroActionRow.gap,
              }}
            >
              <button
                type="button"
                onClick={() => downloadPhotoZip("movement")}
                style={{
                  ...styles.heroActionButton,
                  minHeight: isPhoneLayout ? 38 : styles.heroActionButton.minHeight,
                  fontSize: isVeryNarrowPhone ? 11 : isPhoneLayout ? 12 : styles.heroActionButton.fontSize,
                  gap: isPhoneLayout ? 4 : styles.heroActionButton.gap,
                  padding: isPhoneLayout ? "0 8px" : "0 10px",
                }}
              >
                {zipDownloading === "movement" ? "ZIP ??獄쏅똻??濚?.." : "??됰씭????鶯?}
              </button>
              <button
                type="button"
                onClick={() => downloadPhotoZip("inspection")}
                style={{
                  ...styles.heroActionButton,
                  minHeight: isPhoneLayout ? 38 : styles.heroActionButton.minHeight,
                  fontSize: isVeryNarrowPhone ? 11 : isPhoneLayout ? 12 : styles.heroActionButton.fontSize,
                  gap: isPhoneLayout ? 4 : styles.heroActionButton.gap,
                  padding: isPhoneLayout ? "0 8px" : "0 10px",
                }}
              >
                {zipDownloading === "inspection" ? "ZIP ??獄쏅똻??濚?.." : "?濡ろ떟??????э┼?}
              </button>
              <button
                type="button"
                onClick={() => downloadPhotoZip("photoOnly")}
                style={{
                  ...styles.heroActionButton,
                  minHeight: isPhoneLayout ? 38 : styles.heroActionButton.minHeight,
                  fontSize: isVeryNarrowPhone ? 11 : isPhoneLayout ? 12 : styles.heroActionButton.fontSize,
                  gap: isPhoneLayout ? 4 : styles.heroActionButton.gap,
                  padding: isPhoneLayout ? "0 8px" : "0 10px",
                }}
              >
                {zipDownloading === "photoOnly" ? "ZIP ??獄쏅똻??濚?.." : "癲ル슔?蹂앸듋???鶯?}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={styles.partnerPanel}>
        <div style={styles.partnerSectionHeader}>
          <div style={styles.sectionTitle}>???쑩???癲ル슢?꾤땟戮⑤뭄?/div>
          <div style={styles.partnerSectionCount}>??{totalVisibleProducts}癲?/div>
        </div>

        <div style={styles.list}>
        {groupedPartners.length === 0 ? (
          <div style={styles.emptyBox}>??嶺?筌??????브컯???????ㅿ폍??????딅젩.</div>
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
                <div style={styles.partnerHeaderRight}>
                  <div style={styles.partnerCount}>{partnerGroup.products.length}癲?/div>
                  <div style={styles.partnerChevron}>??/div>
                </div>
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
                      historyCounts.returnCount > 0 ? `?????${historyCounts.returnCount}` : "",
                      historyCounts.exchangeCount > 0 ? `??????${historyCounts.exchangeCount}` : "",
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
                      ["1d", "??ш끽維쀩?],
                      ["7d", "??繹먮엨猷??],
                      ["30d", "??筌먲퐢??],
                    ]
                      .map(([periodKey, label]) => {
                        const stats = product.happycallStats?.[periodKey];
                        if (!stats?.rank || stats.rank > 5) return null;
                        return {
                          key: periodKey,
                          rank: stats.rank,
                          label: stats.rank <= 3 ? `${label} ??熬곣뫀猷??TOP${stats.rank}` : `${label} ??熬곣뫀猷??,
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
                              </div>
                              <div style={styles.cardContentRow}>
                                <div style={styles.cardMainCopy}>
                                  <div style={styles.cardTitleRow}>
                                    <div style={styles.cardTitle}>{product.productName || "???ㅺ강?癲????⑤챶苡?}</div>
                                    {product.eventInfo?.??繹먭퍗???? ? (
                                      <span style={styles.eventBadge}>
                                        {product.eventInfo.??繹먭퍗?э┼?|| "??繹먭퍗??}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div style={styles.cardMeta}>?熬곣뫀???{product.productCode}</div>
                                  <div style={styles.qtyRow}>
                                    <span style={styles.qtyChip}>???袁⑸즵獒뺣뎿爾?{product.totalQty}??/span>
                                    {historySummary ? <span style={styles.qtyChip}>{historySummary}</span> : null}
                                  </div>
                                </div>
                                {product.imageSrc ? (
                                  <div style={styles.cardThumbFrame}>
                                    <img src={product.imageSrc} alt={product.productName} style={styles.cardThumbImage} />
                                  </div>
                                ) : null}
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
                                        ??????먮섀饔낅챸???? currentJob?.job_key || "",
                                        ??獄쏅똻???繹먮굝六? new Date().toISOString(),
                                        ???ㅺ강??熬곣뫀??? product.productCode,
                                        ???ㅺ강?癲? product.productName,
                                        ???쑩???嶺? product.partner,
                                        ??ш끽維?管???우툔櫻??嚥??? product.totalQty || 0,
                                        ?袁⑸즵獒뺣뎿爾??嚥??? product.totalQty || 0,
                                        ?濡ろ떟????怨뺣묄?? qty,
                                        ??????嚥??? 0,
                                        ???????嚥??? 0,
                                      },
                                    ]);
                                  } else {
                                    removePendingKeys([entityKey]);
                                  }
                                }}
                                style={styles.inlineQtyInput}
                                placeholder="?濡ろ떟????怨뺣묄??
                              />
                            </div>
                            <div style={styles.formGroup}>
                              <label style={styles.label}>?濡ろ떟??????э┼?/label>
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
                                        ??????먮섀饔낅챸???? currentJob?.job_key || "",
                                        ??獄쏅똻???繹먮굝六? new Date().toISOString(),
                                        ???ㅺ강??熬곣뫀??? product.productCode,
                                        ???ㅺ강?癲? product.productName,
                                        ???쑩???嶺? product.partner,
                                        ??ш끽維?管???우툔櫻??嚥??? product.totalQty || 0,
                                        ?袁⑸즵獒뺣뎿爾??嚥??? product.totalQty || 0,
                                        ?濡ろ떟????怨뺣묄?? parseQty(draft.inspectionQty),
                                        ??????嚥??? 0,
                                        ???????嚥??? 0,
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
                                  : "???ャ뀕?????鶯????⑤챶苡?}
                              </div>
                            </div>
                            <button
                              type="button"
                            onClick={() => saveInspectionQtySimple(product)}
                            style={styles.saveButton}
                          >
                              {inspectionStatus === "saving" ? "?????롢뀋?.." : "????}
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
                              </div>
                              <div style={styles.cardContentRow}>
                                <div style={styles.cardMainCopy}>
                                  <div style={styles.cardTitleRow}>
                                    <div style={styles.cardTitle}>{product.productName || "???ㅺ강?癲????⑤챶苡?}</div>
                                    {product.eventInfo?.??繹먭퍗???? ? (
                                      <span style={styles.eventBadge}>
                                        {product.eventInfo.??繹먭퍗?э┼?|| "??繹먭퍗??}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div style={styles.cardMeta}>?熬곣뫀???{product.productCode}</div>
                                  <div style={styles.qtyRow}>
                                    <span style={styles.qtyChip}>???袁⑸즵獒뺣뎿爾?{product.totalQty}??/span>
                                    {historySummary ? <span style={styles.qtyChip}>{historySummary}</span> : null}
                                  </div>
                                </div>
                                {product.imageSrc ? (
                                  <div style={styles.cardThumbFrame}>
                                    <img src={product.imageSrc} alt={product.productName} style={styles.cardThumbImage} />
                                  </div>
                                ) : null}
                              </div>
                            </button>

                            {isOpen && (
                          <div style={styles.editorBox}>
                            <div style={styles.formGroup}>
                              <label style={styles.label}>???醫롫뙃 ???ャ뀕??/label>
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
                                    {center.center} / {center.totalQty}??                                  </option>
                                ))}
                              </select>
                            </div>

                            {selectedCenterInfo && (
                              <div style={styles.detailBlock}>
                                <div style={styles.metaText}>
                                  ???ャ뀕?????醫롫뙃 ?袁⑸즵獒뺣뎿爾??嚥??? {selectedCenterInfo.totalQty}??                                </div>
                                <div style={styles.metaText}>
                                  ??繹먭퍗?? {product.eventInfo?.??繹먭퍗???? || ""}
                                  {product.eventInfo?.??繹먭퍗?э┼?? ` (${product.eventInfo.??繹먭퍗?э┼?)` : ""}
                                </div>
                              </div>
                            )}

                              <>
                                <div style={styles.grid2}>
                                  <div style={styles.formGroup}>
                                    <label style={styles.label}>??????嚥???/label>
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
                                    <label style={styles.label}>???????嚥???/label>
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
                                  <label style={styles.label}>?????/label>
                                  <textarea
                                    value={draft.memo || ""}
                                    onChange={(e) => updateDraft(draftKey, "memo", e.target.value)}
                                    style={styles.textarea}
                                    rows={3}
                                    placeholder="??됰씭??????? / ??ш끽維??????
                                  />
                                </div>

                                <div style={styles.formGroup}>
                                  <label style={styles.label}>??鶯?癲ル슪?섊땟??</label>
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
                                      : "???ャ뀕?????鶯????⑤챶苡?}
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => saveReturnExchange(product, selectedCenter)}
                                  style={styles.saveButton}
                                >
                                  {actionStatus === "saving" ? "?????롢뀋?.." : "????}
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
      </div>

      {showHistory && (
        <div style={styles.sheetOverlay} onClick={() => setShowHistory(false)}>
          <div style={styles.bottomSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} />
            <div style={styles.sheetHeader}>
              <h2 style={styles.sheetTitle}>???潁뺛꺈彛????⑤９肉?/h2>
              <button type="button" onClick={() => setShowHistory(false)} style={styles.sheetClose}>
                ?????탿
              </button>
            </div>

            {historyLoading ? (
              <div style={styles.infoBox}>???⑤９肉???됰씭??????몄툗 濚?..</div>
            ) : historyRows.length === 0 ? (
              <div style={styles.emptyBox}>??筌?六?????⑤９肉?????⑤８?????덊렡.</div>
            ) : (
              <div style={styles.sheetList}>
                {historyRows.map((record, index) => (
                  <div
                    key={`${record.__rowNumber || "row"}-${record.??獄쏅똻???繹먮굝六?|| "time"}-${index}`}
                    style={styles.historyCard}
                  >
                    <button
                      type="button"
                      onClick={() => deleteHistoryRecord(record)}
                      style={styles.deleteBtn}
                      disabled={deletingRowNumber === Number(record.__rowNumber)}
                    >
                      {deletingRowNumber === Number(record.__rowNumber) ? "..." : "??}
                    </button>

                    <div style={styles.cardTopRow}>
                    <div style={styles.cardTitle}>{record.???ㅺ강?癲?|| "???ㅺ강?癲????⑤챶苡?}</div>
                      <span style={styles.typeBadge}>{getRecordType(record)}</span>
                    </div>
                    <div style={styles.cardMeta}>?熬곣뫀???{record.???ㅺ강??熬곣뫀???|| "-"}</div>
                    <div style={styles.cardMeta}>???醫롫뙃 {record.???醫롫뙃癲?|| "-"}</div>
                    <div style={styles.cardMeta}>???쑩???{record.???쑩???嶺?|| "-"}</div>
                    <div style={styles.qtyRow}>
                      <span style={styles.qtyChip}>癲ル슪?ｇ몭???嚥???{getRecordQtyText(record)}</span>
                      <span style={styles.qtyChip}>{formatDateTime(record.??獄쏅똻???繹먮굝六?}</span>
                    </div>
                    <div style={styles.historyMemo}>{record.?????|| "-"}</div>

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
          <img src={zoomPhotoUrl} alt="?嶺? ??鶯? style={styles.photoZoom} />
        </div>
      )}

      {showAdminReset && (
        <div style={styles.sheetOverlay} onClick={() => !adminResetting && setShowAdminReset(false)}>
          <div style={styles.bottomSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} />
            <div style={styles.sheetHeader}>
              <h2 style={styles.sheetTitle}>???굿?域밸Ŧ遊???縕?猿녿뎨??/h2>
              <button
                type="button"
                onClick={() => !adminResetting && setShowAdminReset(false)}
                style={styles.sheetClose}
              >
                ?????탿
              </button>
            </div>

            <div style={styles.infoBox}>
              ??ш끽維??????????濡ろ떟????怨뺣묄?? ??????????????⑤９肉? ???ㅼ뒦?????鶯ㅼ룆?????筌먦끇?????????亦낆떓萸먪솒??? 癲ル슢?꾤땟?嶺???癰귙끋源??筌뤾퍓???
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>???굿?域밸Ŧ遊???????類????/label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                style={styles.input}
                placeholder="?????類????????곸죷"
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
              {adminResetting ? "?縕?猿녿뎨??濚?.." : "??ш끽維????????????곸죷 ???Β?????縕?猿녿뎨??}
            </button>
          </div>
        </div>
      )}

      {showImageRegister && (
        <div style={styles.sheetOverlay} onClick={() => !uploadingImageKey && setShowImageRegister(false)}>
          <div style={styles.bottomSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} />
            <div style={styles.sheetHeader}>
              <h2 style={styles.sheetTitle}>???ㅺ강? ????癲ル슣?? ?濚밸Ŧ援욃ㅇ?/h2>
              <button
                type="button"
                onClick={() => !uploadingImageKey && setShowImageRegister(false)}
                style={styles.sheetClose}
              >
                ?????탿
              </button>
            </div>

            <div style={styles.infoBox}>
              ??ш끽維??CSV ??れ삀?? ???ㅺ강???????????癲ル슣?????濚밸Ŧ援욃ㅇ????듦뭅??????????????怨?????덊렡. ?濚밸Ŧ援욃ㅇ??????癲ル슣??????좊즵?? ???쑩???? ???ㅺ강?????節뚮쳮?????筌????ㅼ굣???筌뤾퍓???
            </div>

            <div style={styles.searchRow}>
              <input
                value={imageRegisterSearch}
                onChange={(e) => setImageRegisterSearch(e.target.value)}
                placeholder="???ㅺ강?癲?/ ???ㅺ강??熬곣뫀???/ ???쑩????濡ろ떟???
                style={styles.searchInput}
              />
            </div>

            {imageRegistryProducts.length === 0 ? (
              <div style={styles.emptyState}>??筌?六?????ㅺ강??????⑤８?????덊렡.</div>
            ) : (
              <div style={styles.imageRegisterList}>
                {imageRegistryProducts.map((product) => (
                  <div key={product.imageKey} style={styles.imageRegisterCard}>
                    <div style={styles.imageRegisterInfo}>
                      <div style={styles.imageRegisterName}>{product.productName}</div>
                      <div style={styles.metaText}>?熬곣뫀???{product.productCode || "-"}</div>
                      <div style={styles.metaText}>???쑩???{product.partner || "-"}</div>
                      <div style={styles.metaText}>???袁⑸즵獒뺣뎿爾?{parseQty(product.totalQty).toLocaleString("ko-KR")}??/div>
                      <div style={styles.metaText}>{product.imageSrc ? "??ш끽維??????癲ル슣?? ???源낆쓱" : "??ш끽維??????癲ル슣?? ???⑤챶苡?}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openImageRegisterPicker(product)}
                      disabled={uploadingImageKey === product.imageKey}
                      style={{
                        ...styles.primaryButton,
                        minHeight: 42,
                        padding: "0 14px",
                        opacity: uploadingImageKey === product.imageKey ? 0.7 : 1,
                      }}
                    >
                      {uploadingImageKey === product.imageKey ? "저장 중..." : product.imageSrc ? "이미지 교체" : "이미지 등록"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {isScannerOpen && (
        <div style={styles.scannerOverlay} onClick={closeScanner}>
          <div style={styles.scannerModal} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={closeScanner} style={styles.scannerCloseBtn}>×</button>

            <div style={styles.scannerTopText}>{scannerReady ? scannerStatus : "카메라를 시작하고 있습니다..."}</div>

            <div style={styles.scannerViewport}>
              <video ref={scannerVideoRef} style={styles.scannerVideo} muted playsInline />
              <div style={styles.scannerGuideBox} />
            </div>

            <div style={styles.scannerHelperText}>바코드를 화면 중앙에 맞춰 주세요.</div>

            {scannerError ? <div style={styles.errorBox}>{scannerError}</div> : null}

            <div style={styles.scannerActions}>
              {torchSupported ? (
                <button
                  type="button"
                  onClick={toggleTorch}
                  style={{ ...styles.secondaryButton, width: 52, minWidth: 52, padding: 0 }}
                  aria-label={torchOn ? "플래시 끄기" : "플래시 켜기"}
                >
                  <FlashlightIcon size={20} active={torchOn} />
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
    background: "linear-gradient(180deg, #f8fbff 0%, #eef3fb 100%)",
    padding: "16px 14px 24px",
    color: "#1f2937",
    fontFamily: "\"Pretendard\", -apple-system, BlinkMacSystemFont, sans-serif",
    boxSizing: "border-box",
    maxWidth: 460,
    margin: "0 auto",
  },
  hiddenInput: {
    display: "none",
  },
  brandBlock: {
    minWidth: 0,
    flex: 1,
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  brandLogo: {
    width: 34,
    height: "auto",
    flexShrink: 0,
  },
  headerCard: {
    background: "linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(250,252,255,0.94) 100%)",
    backdropFilter: "blur(14px)",
    borderRadius: 26,
    padding: 18,
    marginBottom: 14,
    border: "1px solid #dfe7f5",
    boxShadow: "0 14px 40px rgba(101, 130, 184, 0.14)",
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
    fontSize: 18,
    fontWeight: 800,
    lineHeight: 1.25,
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
    color: "#8b98b8",
    fontSize: 12,
    textDecoration: "none",
    wordBreak: "break-all",
  },
  copyButton: {
    minHeight: 34,
    padding: "0 12px",
    borderRadius: 999,
    border: "1px solid #d7deec",
    background: "#ffffff",
    color: "#2d4ea1",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 4px 10px rgba(37, 99, 235, 0.06)",
  },
  headerModeBadge: {
    background: "#eef3ff",
    color: "#6377b9",
    borderRadius: 999,
    padding: "8px 14px",
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
    minHeight: 72,
    borderRadius: 18,
    border: "1px solid #e2e8f5",
    background: "#ffffff",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    cursor: "pointer",
    color: "#405074",
    fontWeight: 800,
    boxShadow: "0 8px 20px rgba(106, 132, 179, 0.08)",
  },
  quickActionCardActive: {
    background: "linear-gradient(135deg, #3c6fdc 0%, #2454c3 100%)",
    color: "#fff",
    borderColor: "#2454c3",
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
    background: "linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(249,251,255,0.94) 100%)",
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    border: "1px solid #e4eaf5",
    boxShadow: "0 12px 30px rgba(101, 130, 184, 0.08)",
  },
  happycallHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: 10,
  },
  heroSubtext: {
    marginTop: 4,
    fontSize: 12,
    color: "#8391b1",
  },
  happycallBadge: {
    borderRadius: 999,
    padding: "7px 11px",
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
    background: "linear-gradient(135deg, #3c6fdc 0%, #2454c3 100%)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 10px 20px rgba(50, 95, 203, 0.18)",
  },
  secondaryButton: {
    minHeight: 48,
    padding: "0 16px",
    borderRadius: 14,
    border: "1px solid #dbe4f3",
    background: "#ffffff",
    color: "#34486f",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 8px 16px rgba(106, 132, 179, 0.06)",
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
    color: "#8b98b8",
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
  happycallShowcase: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  heroTopCard: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 116px",
    gap: 12,
    padding: 16,
    borderRadius: 22,
    background: "linear-gradient(180deg, #fff8e7 0%, #ffe8b5 100%)",
    border: "1px solid #f2ddb0",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 12px 24px rgba(214, 167, 72, 0.12)",
    alignItems: "center",
  },
  heroTopCopy: {
    minWidth: 0,
  },
  heroTopBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "#d18a00",
    fontSize: 13,
    fontWeight: 800,
    marginBottom: 6,
  },
  heroTopMedal: {
    fontSize: 20,
    lineHeight: 1,
  },
  heroTopBadgeText: {
    letterSpacing: 0.2,
  },
  heroTopName: {
    fontSize: 20,
    lineHeight: 1.2,
    fontWeight: 900,
    color: "#24324d",
    wordBreak: "keep-all",
  },
  heroTopMeta: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: 700,
    color: "#495976",
  },
  heroProgressRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  heroProgressTrack: {
    height: 12,
    borderRadius: 999,
    background: "rgba(37, 84, 195, 0.12)",
    overflow: "hidden",
  },
  heroProgressFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #3f73e6 0%, #2454c3 100%)",
  },
  heroProgressValue: {
    fontSize: 14,
    fontWeight: 800,
    color: "#50607f",
  },
  heroImageFrame: {
    height: 104,
    borderRadius: 18,
    background: "rgba(255,255,255,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  heroImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    mixBlendMode: "multiply",
  },
  heroFallbackImage: {
    fontSize: 48,
  },
  heroMiniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
  },
  heroMiniCard: {
    background: "linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)",
    border: "1px solid #e4eaf5",
    borderRadius: 18,
    padding: 14,
    minHeight: 120,
    boxShadow: "0 8px 20px rgba(106, 132, 179, 0.06)",
  },
  heroMiniContent: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 58px",
    gap: 10,
    alignItems: "end",
  },
  heroMiniCopy: {
    minWidth: 0,
  },
  heroMiniLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "#6377b9",
    fontSize: 12,
    fontWeight: 800,
    marginBottom: 8,
  },
  heroMiniName: {
    fontSize: 17,
    lineHeight: 1.24,
    fontWeight: 900,
    color: "#22314b",
    wordBreak: "keep-all",
  },
  heroMiniMeta: {
    marginTop: 8,
    fontSize: 13,
    color: "#687694",
    fontWeight: 700,
  },
  heroMiniThumbFrame: {
    width: 58,
    height: 58,
    borderRadius: 14,
    background: "#f8fbff",
    border: "1px solid #e4eaf5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  heroMiniThumbImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    mixBlendMode: "multiply",
  },
  heroActionRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
  },
  heroActionButton: {
    minHeight: 42,
    border: "1px solid #dce4f4",
    borderRadius: 14,
    background: "#f8fbff",
    color: "#3e5a98",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 6px 14px rgba(106, 132, 179, 0.05)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
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
    paddingBottom: 6,
  },
  partnerPanel: {
    background: "linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(248,251,255,0.94) 100%)",
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    border: "1px solid #e4eaf5",
    boxShadow: "0 12px 30px rgba(101, 130, 184, 0.08)",
  },
  partnerSectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  partnerSectionCount: {
    fontSize: 13,
    color: "#6f7fa4",
    fontWeight: 700,
  },
  partnerGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  partnerHeader: {
    border: "1px solid #dfe7f5",
    background: "linear-gradient(180deg, #f7f9ff 0%, #eff4ff 100%)",
    borderRadius: 16,
    padding: "14px 16px",
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    textAlign: "left",
  },
  partnerHeaderRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
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
  partnerChevron: {
    fontSize: 20,
    lineHeight: 1,
    color: "#9aa8c7",
    fontWeight: 700,
  },
  partnerBody: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  card: {
    background: "linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)",
    borderRadius: 20,
    border: "1px solid #e4eaf5",
    overflow: "hidden",
    boxShadow: "0 10px 24px rgba(101, 130, 184, 0.08)",
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
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 8,
  },
  cardTopRowInline: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 8,
  },
  cardTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  cardContentRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 84px",
    gap: 12,
    alignItems: "center",
  },
  cardMainCopy: {
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: 800,
    lineHeight: 1.45,
    color: "#16233d",
    wordBreak: "keep-all",
    flex: 1,
  },
  cardThumbFrame: {
    width: 84,
    height: 84,
    borderRadius: 16,
    background: "#f8fbff",
    border: "1px solid #e4eaf5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    boxShadow: "0 8px 16px rgba(106, 132, 179, 0.08)",
  },
  cardThumbImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    mixBlendMode: "multiply",
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
  imageRegisterList: {
      display: "grid",
      gap: 10,
      marginTop: 12,
    },
  imageRegisterCard: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      padding: 14,
      borderRadius: 18,
      border: "1px solid #e5eaf5",
      background: "#ffffff",
      boxShadow: "0 8px 18px rgba(101, 130, 184, 0.06)",
    },
  imageRegisterInfo: {
      minWidth: 0,
      flex: 1,
    },
  imageRegisterName: {
      fontSize: 15,
      fontWeight: 800,
      color: "#1f2f53",
      marginBottom: 4,
      wordBreak: "keep-all",
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




