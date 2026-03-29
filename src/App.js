import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { BrowserCodeReader, BrowserMultiFormatReader } from "@zxing/browser";
import * as XLSX from "xlsx";

const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzrPgqH8RoyY-7q2ZaDOZJqJo4aIJumTLtwmGSm-NgFnUzWyHavTi__CrwWbnwa5763wA/exec";

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
  return `${text.slice(0, Math.max(0, maxLength - 7))}...(생략)`;
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

// 새 상품 이미지를 추가할 때:
// 1) public/assets/products 에 파일을 넣고
// 2) 아래 목록에 partnerKeywords / productKeywords / src 를 한 줄 추가하면 됩니다.
// 애매한 상품은 억지로 넣지 말고 비워두는 편이 오매칭을 줄입니다.
const PRODUCT_IMAGE_MAP = [
  {
    match: buildImageMatcher({
      partnerKeywords: ["델몬트"],
      productKeywords: ["킹사이즈", "바나나"],
    }),
    src: "/assets/products/delmonte-king-banana.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["돌코리아", "dole"],
      productKeywords: ["스위티오", "바나나", "2입"],
      excludeKeywords: ["파인애플"],
    }),
    src: "/assets/products/dole-sweetio-banana-2.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["돌코리아", "dole"],
      productKeywords: ["스위티오", "바나나"],
      excludeKeywords: ["파인애플", "2입"],
    }),
    src: "/assets/products/dole-sweetio-banana-scene.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["델몬트"],
      productKeywords: ["프리미엄", "바나나"],
      excludeKeywords: ["클래식"],
    }),
    src: "/assets/products/delmonte-banana-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["델몬트"],
      productKeywords: ["클래식", "바나나"],
    }),
    src: "/assets/products/delmonte-banana-pack.png",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["바나나"],
      excludeKeywords: ["파인애플"],
    }),
    src: "/assets/products/banana-generic.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["오이맛고추"],
    }),
    src: "/assets/products/cucumber-spicy.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["청양고추"],
    }),
    src: "/assets/products/green-chili-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["매운고추"],
    }),
    src: "/assets/products/pepper-hot-pack.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      if (productText.includes(normalizeImageToken("오이맛고추"))) return false;
      return [
        "천안오이",
        "한끼딱오이",
        "오이1입",
        "오이2입",
        "오이",
      ].some((keyword) => productText.includes(normalizeImageToken(keyword)));
    },
    src: "/assets/products/cucumber-plain.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["애호박"],
      excludeKeywords: ["못난이"],
    }),
    src: "/assets/products/aehobak-single.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["손질대파"],
    }),
    src: "/assets/products/green-onion-bundle.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["부추"],
    }),
    src: "/assets/products/chives-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["달래"],
    }),
    src: "/assets/products/dalrae-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["냉이"],
    }),
    src: "/assets/products/shepherds-purse-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["참나물"],
    }),
    src: "/assets/products/chamnamul-bag.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return productText.includes(normalizeImageToken("깻잎"));
    },
    src: "/assets/products/perilla-pack.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return productText.includes(normalizeImageToken("쌈채소")) || productText.includes(normalizeImageToken("상추"));
    },
    src: "/assets/products/ssam-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["꽃상추"],
    }),
    src: "/assets/products/red-lettuce-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["시금치"],
    }),
    src: "/assets/products/spinach-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["브로콜리"],
    }),
    src: "/assets/products/broccoli.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["양배추"],
    }),
    src: "/assets/products/cabbage-half.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["양파"],
    }),
    src: "/assets/products/onion-single.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return productText.includes(normalizeImageToken("깐마늘")) || productText.includes(normalizeImageToken("마늘"));
    },
    src: "/assets/products/garlic-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["새송이버섯"],
    }),
    src: "/assets/products/mushroom-king-oyster.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return productText.includes(normalizeImageToken("참타리버섯")) || productText.includes(normalizeImageToken("참타리"));
    },
    src: "/assets/products/mushroom-king-oyster-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["팽이버섯"],
    }),
    src: "/assets/products/enoki-pack.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return (
        productText.includes(normalizeImageToken("고구마")) ||
        productText.includes(normalizeImageToken("꿀밤고구마")) ||
        productText.includes(normalizeImageToken("호박고구마"))
      );
    },
    src: "/assets/products/sweetpotato-pink-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["연어"],
    }),
    src: "/assets/products/salmon-pack.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return (
        productText.includes(normalizeImageToken("목심")) ||
        productText.includes(normalizeImageToken("삼겹")) ||
        productText.includes(normalizeImageToken("한돈")) ||
        productText.includes(normalizeImageToken("돼지"))
      );
    },
    src: "/assets/products/pork-neck-pack.jpeg",
  },
];

const getProductImageSrc = (product, customImageMap = {}) => {
  const productText = normalizeImageToken(product?.productName || "");
  if (!productText) return "";

  if (productText.includes(normalizeImageToken("파인애플"))) {
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
      setProductImageMap(
        (Array.isArray(data.product_images) ? data.product_images : []).reduce((acc, item) => {
          const key = String(item?.맵키 || "").trim();
          const url = String(item?.이미지URL || "").trim();
          if (key && url) acc[key] = url;
          return acc;
        }, {})
      );
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
      throw new Error(result.message || "내역 삭제 실패");
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
      setError("등록 대상 상품을 찾지 못했습니다.");
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
        throw new Error(result.message || "이미지 등록 실패");
      }

      const nextMap = (Array.isArray(result.product_images) ? result.product_images : []).reduce((acc, item) => {
        const key = String(item?.맵키 || "").trim();
        const url = String(item?.이미지URL || "").trim();
        if (key && url) acc[key] = url;
        return acc;
      }, {});
      setProductImageMap(nextMap);
      setToast("이미지 등록 완료");
      setMessage("상품 이미지가 등록되었습니다.");
    } catch (err) {
      setError(err.message || "이미지 등록 실패");
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

      const parsedRows = await parseHappycallSourceFile(file);

      const rawRows = (parsedRows || [])
        .map((row) => ({
          제목: clampText(row["제목"] || row["subject"] || "", 300),
          본문: clampText(row["본문"] || row["body"] || row["내용(암호화)"] || "", 8000),
          메일ID: clampText(row["인터넷 메시지 ID"] || row["메일ID"] || row["접수번호"] || "", 200),
          보낸사람: clampText(row["보낸사람:(이름)"] || row["senderName"] || "", 200),
          접수일시: clampText(row["접수일시"] || row["receivedAt"] || "", 100),
          파트너사: clampText(row["처리파트너사"] || row["파트너사"] || row["협력사명"] || "", 200),
          장애유형: clampText(
            row["장애유형(소)"] || row["장애유형(중)"] || row["장애유형(대)"] || row["장애유형"] || "",
            200
          ),
        }))
        .filter((row) => String(row.제목 || "").trim() || String(row.본문 || "").trim());

      const dedupedMap = new Map();
      rawRows.forEach((row) => {
        const dedupeKey = [
          String(row.메일ID || "").trim(),
          String(row.파트너사 || "").trim(),
          String(row.접수일시 || "").trim(),
          String(row.제목 || "").trim(),
          String(row.본문 || "").trim().slice(0, 300),
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
              <img src="/assets/gs-logo.svg" alt="GS 로고" style={styles.brandLogo} />
              <h1 style={styles.title}>GS신선강화지원팀 검품 시스템</h1>
            </div>
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
              {uploadingCsv ? "처리 중..." : "📄 검품 CSV 업로드"}
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
              {uploadingHappycallCsv ? "처리 중..." : "🗂 해피콜 업로드"}
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
              🖼 이미지 등록
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
              👤 관리자 초기화
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
            <div style={styles.sectionTitle}>전일 해피콜 TOP 5 {totalVisibleProducts ? `(${totalVisibleProducts}건)` : ""}</div>
            <div style={styles.heroSubtext}>전일 접수 해피콜 기준</div>
          </div>
        </div>

        {previousDayHappycallTopList.length === 0 ? (
          <div style={styles.emptyBox}>전일 해피콜 데이터가 없습니다.</div>
        ) : (
          <div style={styles.happycallShowcase}>
            {happycallHeroCard ? (
              <div style={styles.heroTopCard}>
                <div style={styles.heroTopCopy}>
                  <div style={styles.heroTopBadge}>
                    <span style={styles.heroTopMedal}>{getTopMedal(happycallHeroCard.rank)}</span>
                    <span style={styles.heroTopBadgeText}>TOP {happycallHeroCard.rank}</span>
                  </div>
                  <div style={styles.heroTopName}>{happycallHeroCard.productName}</div>
                  <div style={styles.heroTopMeta}>
                    {happycallHeroCard.count.toLocaleString("ko-KR")}건 · {formatPercent(happycallHeroCard.share)}
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
                <div style={styles.heroImageFrame}>
                  {happycallHeroCard.imageSrc ? (
                    <img
                      src={happycallHeroCard.imageSrc}
                      alt={happycallHeroCard.productName}
                      style={styles.heroImage}
                    />
                  ) : (
                    <div style={styles.heroFallbackImage}>📦</div>
                  )}
                </div>
              </div>
            ) : null}

            {happycallMiniCards.length ? (
              <div style={styles.heroMiniGrid}>
                {happycallMiniCards.map((card) => (
                  <div
                    key={`happycall-top-${card.rank}`}
                    style={{
                      ...styles.heroMiniCard,
                      borderColor:
                        card.rank === 2 ? "#93c5fd" : card.rank === 3 ? "#86efac" : "#dbe3f0",
                    }}
                  >
                    <div style={styles.heroMiniLabel}>
                      <span>{getTopMedal(card.rank) || "•"}</span>
                      <span>{card.rank <= 3 ? `TOP ${card.rank}` : ""}</span>
                    </div>
                    <div style={styles.heroMiniContent}>
                      <div style={styles.heroMiniCopy}>
                        <div style={styles.heroMiniName}>{card.productName}</div>
                        <div style={styles.heroMiniMeta}>
                          {card.count.toLocaleString("ko-KR")}건 · {formatPercent(card.share)}
                        </div>
                      </div>
                      {card.imageSrc ? (
                        <div style={styles.heroMiniThumbFrame}>
                          <img src={card.imageSrc} alt={card.productName} style={styles.heroMiniThumbImage} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div style={styles.heroActionRow}>
              <button
                type="button"
                onClick={() => downloadPhotoZip("movement")}
                style={styles.heroActionButton}
              >
                {zipDownloading === "movement" ? "ZIP 생성 중..." : "📷 불량사진"}
              </button>
              <button
                type="button"
                onClick={() => downloadPhotoZip("inspection")}
                style={styles.heroActionButton}
              >
                {zipDownloading === "inspection" ? "ZIP 생성 중..." : "🧾 검품사진"}
              </button>
              <button
                type="button"
                onClick={() => downloadPhotoZip("photoOnly")}
                style={styles.heroActionButton}
              >
                {zipDownloading === "photoOnly" ? "ZIP 생성 중..." : "🔗 참고사진"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={styles.partnerPanel}>
        <div style={styles.partnerSectionHeader}>
          <div style={styles.sectionTitle}>협력사 목록</div>
          <div style={styles.partnerSectionCount}>총 {totalVisibleProducts}건</div>
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
                <div style={styles.partnerHeaderRight}>
                  <div style={styles.partnerCount}>{partnerGroup.products.length}건</div>
                  <div style={styles.partnerChevron}>›</div>
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
                          label: stats.rank <= 3 ? `${label} 해피콜 TOP${stats.rank}` : `${label} 해피콜`,
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
                                    <div style={styles.cardTitle}>{product.productName || "상품명 없음"}</div>
                                    {product.eventInfo?.행사여부 ? (
                                      <span style={styles.eventBadge}>
                                        {product.eventInfo.행사명 || "행사"}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div style={styles.cardMeta}>코드 {product.productCode}</div>
                                  <div style={styles.qtyRow}>
                                    <span style={styles.qtyChip}>총 발주 {product.totalQty}개</span>
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
                              </div>
                              <div style={styles.cardContentRow}>
                                <div style={styles.cardMainCopy}>
                                  <div style={styles.cardTitleRow}>
                                    <div style={styles.cardTitle}>{product.productName || "상품명 없음"}</div>
                                    {product.eventInfo?.행사여부 ? (
                                      <span style={styles.eventBadge}>
                                        {product.eventInfo.행사명 || "행사"}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div style={styles.cardMeta}>코드 {product.productCode}</div>
                                  <div style={styles.qtyRow}>
                                    <span style={styles.qtyChip}>총 발주 {product.totalQty}개</span>
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

      {showImageRegister && (
        <div style={styles.sheetOverlay} onClick={() => !uploadingImageKey && setShowImageRegister(false)}>
          <div style={styles.bottomSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} />
            <div style={styles.sheetHeader}>
              <h2 style={styles.sheetTitle}>상품 이미지 등록</h2>
              <button
                type="button"
                onClick={() => !uploadingImageKey && setShowImageRegister(false)}
                style={styles.sheetClose}
              >
                닫기
              </button>
            </div>

            <div style={styles.infoBox}>
              현재 CSV 기준 상품에 대해 이미지를 등록하거나 교체할 수 있습니다. 등록한 이미지는 같은 협력사/상품에 계속 자동 적용됩니다.
            </div>

            <div style={styles.searchRow}>
              <input
                value={imageRegisterSearch}
                onChange={(e) => setImageRegisterSearch(e.target.value)}
                placeholder="상품명 / 상품코드 / 협력사 검색"
                style={styles.searchInput}
              />
            </div>

                {imageRegistryProducts.length === 0 ? (
              <div style={styles.emptyState}>표시할 상품이 없습니다.</div>
            ) : (
              <div style={styles.imageRegisterList}>
                {imageRegistryProducts.map((product) => (
                  <div key={product.imageKey} style={styles.imageRegisterCard}>
                    <div style={styles.imageRegisterInfo}>
                      <div style={styles.imageRegisterName}>{product.productName}</div>
                      <div style={styles.metaText}>코드 {product.productCode || "-"}</div>
                      <div style={styles.metaText}>협력사 {product.partner || "-"}</div>
                      <div style={styles.metaText}>총 발주 {parseQty(product.totalQty).toLocaleString("ko-KR")}개</div>
                      <div style={styles.metaText}>{product.imageSrc ? "현재 이미지 있음" : "현재 이미지 없음"}</div>
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
                      {uploadingImageKey === product.imageKey ? "등록 중..." : product.imageSrc ? "이미지 교체" : "이미지 등록"}
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

