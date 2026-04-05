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
  return `${text.slice(0, Math.max(0, maxLength - 7))}...(?앸왂)`;
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
  if (rank === 1) return "?쪍";
  if (rank === 2) return "?쪎";
  if (rank === 3) return "?쪏";
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

// ???곹뭹 ?대?吏瑜?異붽?????
// 1) public/assets/products ???뚯씪???ｊ퀬
// 2) ?꾨옒 紐⑸줉??partnerKeywords / productKeywords / src 瑜???以?異붽??섎㈃ ?⑸땲??
// ?좊ℓ???곹뭹? ?듭?濡??ｌ? 留먭퀬 鍮꾩썙?먮뒗 ?몄씠 ?ㅻℓ移?쓣 以꾩엯?덈떎.
const PRODUCT_IMAGE_MAP = [
  {
    match: buildImageMatcher({
      productKeywords: ["?꾨낫移대룄"],
    }),
    src: "/assets/products/avocado.png",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["泥쒖븞?ㅼ씠"],
    }),
    src: "/assets/products/cucumber-cheonan-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?쒕겮?깆삤??],
    }),
    src: "/assets/products/cucumber-single-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?ㅼ씠1??],
    }),
    src: "/assets/products/cucumber-single-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?ㅼ씠2??],
    }),
    src: "/assets/products/cucumber-plate-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?ㅼ씠留쏄퀬異?],
    }),
    src: "/assets/products/cucumber-spicy-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["泥?뼇怨좎텛"],
    }),
    src: "/assets/products/green-chili-pack-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["怨좎텛"],
      excludeKeywords: ["?ㅼ씠留쏄퀬異?],
    }),
    src: "/assets/products/green-chili-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?좏샇諛?],
    }),
    src: "/assets/products/aehobak-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["二쇳궎??],
    }),
    src: "/assets/products/zucchini-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?먯쭏???],
    }),
    src: "/assets/products/green-onion-pack-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["???],
    }),
    src: "/assets/products/green-onion-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?됱씠"],
    }),
    src: "/assets/products/naengi-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?щ옒"],
    }),
    src: "/assets/products/dalrae-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["李몃굹臾?],
    }),
    src: "/assets/products/chamnamul-bag-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["異붾?源살옂"],
    }),
    src: "/assets/products/perilla-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["源살옂"],
    }),
    src: "/assets/products/perilla-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?덉콈??],
    }),
    src: "/assets/products/ssam-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?곸텛"],
    }),
    src: "/assets/products/lettuce-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?쒕겮?깆뼇??],
    }),
    src: "/assets/products/onion-single-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?묓뙆"],
    }),
    src: "/assets/products/onion-single-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?묐같異?],
    }),
    src: "/assets/products/cabbage-half-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["留덈뒛1??],
    }),
    src: "/assets/products/garlic-single-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["源먮쭏??],
    }),
    src: "/assets/products/garlic-single-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["留덈뒛"],
    }),
    src: "/assets/products/garlic-bowl-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["二쇰땲?댁깉?≪씠踰꾩꽢"],
    }),
    src: "/assets/products/junior-king-oyster-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?덉넚?대쾭??],
    }),
    src: "/assets/products/king-oyster-clean-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["李명?由щ쾭??],
    }),
    src: "/assets/products/oyster-mushroom-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["李명?由?],
    }),
    src: "/assets/products/oyster-mushroom-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?먰?由щ쾭??],
    }),
    src: "/assets/products/mushroom-oyster-tray-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?먰?由?],
    }),
    src: "/assets/products/mushroom-oyster-tray-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["轅諛ㅺ퀬援щ쭏"],
    }),
    src: "/assets/products/sweetpotato-mini-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?몃컯怨좉뎄留?],
    }),
    src: "/assets/products/sweetpotato-pumpkin-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["怨좉뎄留?],
    }),
    src: "/assets/products/sweetpotato-mini-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?⑦샇諛?],
    }),
    src: "/assets/products/pumpkin-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["諛ㅽ샇諛?],
    }),
    src: "/assets/products/pumpkin-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?곗뼱"],
    }),
    src: "/assets/products/salmon-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["遺梨꾩궡"],
    }),
    src: "/assets/products/beef-striploin-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["遺덇퀬湲?],
    }),
    src: "/assets/products/beef-bulgogi-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["紐⑹떖"],
    }),
    src: "/assets/products/pork-neck-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?쇨껸"],
    }),
    src: "/assets/products/samgyeopsal-user.jpg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?쒕룉"],
      excludeKeywords: ["?쇨껸", "紐⑹떖"],
    }),
    src: "/assets/products/pork-tray-green-user.jpg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["?몃が??],
      productKeywords: ["?뱀궗?댁쫰", "諛붾굹??],
    }),
    src: "/assets/products/delmonte-king-banana.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["?뚯퐫由ъ븘", "dole"],
      productKeywords: ["?ㅼ쐞?곗삤", "諛붾굹??, "2??],
      excludeKeywords: ["?뚯씤?좏뵆"],
    }),
    src: "/assets/products/dole-sweetio-banana-2.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["?뚯퐫由ъ븘", "dole"],
      productKeywords: ["?ㅼ쐞?곗삤", "諛붾굹??],
      excludeKeywords: ["?뚯씤?좏뵆", "2??],
    }),
    src: "/assets/products/dole-sweetio-banana-scene.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["?몃が??],
      productKeywords: ["?꾨━誘몄뾼", "諛붾굹??],
      excludeKeywords: ["?대옒??],
    }),
    src: "/assets/products/delmonte-banana-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["?몃が??],
      productKeywords: ["?대옒??, "諛붾굹??],
    }),
    src: "/assets/products/delmonte-banana-pack.png",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["諛붾굹??],
      excludeKeywords: ["?뚯씤?좏뵆"],
    }),
    src: "/assets/products/banana-generic.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?ㅼ씠留쏄퀬異?],
    }),
    src: "/assets/products/cucumber-spicy.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["泥?뼇怨좎텛"],
    }),
    src: "/assets/products/green-chili-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["留ㅼ슫怨좎텛"],
    }),
    src: "/assets/products/pepper-hot-pack.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      if (productText.includes(normalizeImageToken("?ㅼ씠留쏄퀬異?))) return false;
      return [
        "泥쒖븞?ㅼ씠",
        "?쒕겮?깆삤??,
        "?ㅼ씠1??,
        "?ㅼ씠2??,
        "?ㅼ씠",
      ].some((keyword) => productText.includes(normalizeImageToken(keyword)));
    },
    src: "/assets/products/cucumber-plain.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?좏샇諛?],
      excludeKeywords: ["紐삳궃??],
    }),
    src: "/assets/products/aehobak-single.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?먯쭏???],
    }),
    src: "/assets/products/green-onion-bundle.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["遺異?],
    }),
    src: "/assets/products/chives-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?щ옒"],
    }),
    src: "/assets/products/dalrae-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?됱씠"],
    }),
    src: "/assets/products/shepherds-purse-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["李몃굹臾?],
    }),
    src: "/assets/products/chamnamul-bag.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return productText.includes(normalizeImageToken("源살옂"));
    },
    src: "/assets/products/perilla-pack.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return productText.includes(normalizeImageToken("?덉콈??)) || productText.includes(normalizeImageToken("?곸텛"));
    },
    src: "/assets/products/ssam-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["苑껋긽異?],
    }),
    src: "/assets/products/red-lettuce-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?쒓툑移?],
    }),
    src: "/assets/products/spinach-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["釉뚮줈肄쒕━"],
    }),
    src: "/assets/products/broccoli.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?묐같異?],
    }),
    src: "/assets/products/cabbage-half.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?묓뙆"],
    }),
    src: "/assets/products/onion-single.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return productText.includes(normalizeImageToken("源먮쭏??)) || productText.includes(normalizeImageToken("留덈뒛"));
    },
    src: "/assets/products/garlic-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?덉넚?대쾭??],
    }),
    src: "/assets/products/mushroom-king-oyster.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return productText.includes(normalizeImageToken("李명?由щ쾭??)) || productText.includes(normalizeImageToken("李명?由?));
    },
    src: "/assets/products/mushroom-king-oyster-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?쎌씠踰꾩꽢"],
    }),
    src: "/assets/products/enoki-pack.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return (
        productText.includes(normalizeImageToken("怨좉뎄留?)) ||
        productText.includes(normalizeImageToken("轅諛ㅺ퀬援щ쭏")) ||
        productText.includes(normalizeImageToken("?몃컯怨좉뎄留?))
      );
    },
    src: "/assets/products/sweetpotato-pink-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["?곗뼱"],
    }),
    src: "/assets/products/salmon-pack.jpeg",
  },
  {
    match: (product) => {
      const productText = normalizeImageToken(product?.productName || "");
      return (
        productText.includes(normalizeImageToken("紐⑹떖")) ||
        productText.includes(normalizeImageToken("?쇨껸")) ||
        productText.includes(normalizeImageToken("?쒕룉")) ||
        productText.includes(normalizeImageToken("?쇱?"))
      );
    },
    src: "/assets/products/pork-neck-pack.jpeg",
  },
];

const DEFAULT_PRODUCT_IMAGE_SRC = "/assets/products/gs25-logo.svg";
const SECONDARY_PRODUCT_IMAGE_SRC = "/assets/gs-logo.svg";

const getDefaultProductImageSrc = (product) => {
  const productText = normalizeImageToken(product?.productName || "");
  if (!productText) return "";

  if (productText.includes(normalizeImageToken("?뚯씤?좏뵆"))) {
    return DEFAULT_PRODUCT_IMAGE_SRC;
  }

  const matched = PRODUCT_IMAGE_MAP.find((entry) => entry.match(product || {}));
  return matched?.src || DEFAULT_PRODUCT_IMAGE_SRC;
};

const getProductImageSrc = (product, customImageMap = {}) => {
  const productText = normalizeImageToken(product?.productName || "");
  if (!productText) return "";

  if (productText.includes(normalizeImageToken("?뚯씤?좏뵆"))) {
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

  return getDefaultProductImageSrc(product);
};

const buildProductImageMapFromRows = (rows) =>
  (Array.isArray(rows) ? rows : []).reduce((acc, item) => {
    const key = String(
      item?.["?대?吏留ㅽ븨??] ||
      item?.["留듯궎"] ||
      ""
    ).trim();
    const fileId = String(
      item?.["?쒕씪?대툕?뚯씪ID"] ||
      item?.["?뚯씪ID"] ||
      ""
    ).trim();
    const url = fileId
      ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`
      : String(item?.["?대?吏URL"] || "").trim();

    if (key && url) {
      acc[key] = url;
    }
    return acc;
  }, {});

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
  return ["true", "y", "yes", "1", "?ъ슜", "?쒖꽦"].includes(text);
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

  const isBrokenText = (text) => (text.match(/占?g) || []).length > 5;

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
      getValue(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "諛붿퐫??, "肄붾뱶"])
    );
    const productName = String(
      getValue(row, ["?곹뭹紐?, "?곹뭹 紐?, "?덈ぉ紐?, "?덈챸"]) || ""
    ).trim();
    const partner = String(
      getValue(row, ["嫄곕옒泥섎챸(援щℓ議곌굔紐?", "嫄곕옒泥섎챸", "?묐젰?щ챸", "?묐젰??]) || ""
    ).trim();
    const center = String(getValue(row, ["?쇳꽣紐?, "?쇳꽣"]) || "").trim();
    const qty = parseQty(getValue(row, ["珥?諛쒖＜?섎웾", "諛쒖＜?섎웾", "?섎웾"]));

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
      getValue(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "諛붿퐫??, "肄붾뱶"])
    );
    const productName = String(getValue(row, ["?곹뭹紐?, "?곹뭹 紐?, "?덈ぉ紐?, "?덈챸"]) || "").trim();
    const partner = String(getValue(row, ["?묐젰?щ챸", "?묐젰??, "嫄곕옒泥섎챸"]) || "").trim();
    const center = String(getValue(row, ["?쇳꽣紐?, "?쇳꽣"]) || "").trim();
    const qty = parseQty(getValue(row, ["諛쒖＜?섎웾", "?섎웾"]));
    const incomingCost = parseQty(getValue(row, ["?낃퀬?먭?", "?먭?"]));

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

const PENDING_STORAGE_KEY = "inspection_pending_v2";
const DRAFT_STORAGE_KEY = "inspection_drafts_v2";
const MAX_SAVE_PARALLEL = 2;
const RETRY_DELAYS_MS = [800, 2000, 4000];

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
    reader.onerror = () => reject(new Error("?ъ쭊 ?쎄린 ?ㅽ뙣"));
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

const delay = (ms) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const createUploadedPhotoItem = (item) => ({
  __uploaded: true,
  fileId: String(item?.fileId || "").trim(),
  viewUrl: String(item?.viewUrl || "").trim(),
  driveUrl: String(item?.driveUrl || "").trim(),
  fileName: String(item?.fileName || "").trim(),
  name: String(item?.fileName || item?.name || "").trim(),
});

const isUploadedPhotoItem = (item) =>
  !!item && typeof item === "object" && item.__uploaded === true && !!item.fileId;

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ko-KR");
};

const formatDashboardValue = (label, value) => {
  if (value == null || value === "") return "-";
  if (String(label).includes("??) || String(label).includes("瑜?) || String(label).includes("而ㅻ쾭由ъ?")) {
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
  const type = String(record.泥섎━?좏삎 || "").trim();
  if (type) return type;
  if (parseQty(record.?뚯넚?섎웾) > 0) return "?뚯넚";
  if (parseQty(record.援먰솚?섎웾) > 0) return "援먰솚";
  return "湲고?";
};

const getRecordQtyText = (record) => {
  const type = getRecordType(record);
  if (type === "?뚯넚" || type === "RETURN") return `${parseQty(record.?뚯넚?섎웾)}媛?;
  if (type === "援먰솚" || type === "EXCHANGE") return `${parseQty(record.援먰솚?섎웾)}媛?;

  const returnQty = parseQty(record.?뚯넚?섎웾);
  const exchangeQty = parseQty(record.援먰솚?섎웾);
  if (returnQty > 0 && exchangeQty > 0) {
    return `?뚯넚 ${returnQty}媛?/ 援먰솚 ${exchangeQty}媛?;
  }
  return `${Math.max(returnQty, exchangeQty, 0)}媛?;
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
    record?.?ъ쭊URL,
    record?.?ъ쭊留곹겕,
    ...splitPhotoSourceText(record?.?ъ쭊留곹겕紐⑸줉),
    ...splitPhotoSourceText(record?.?ъ쭊?뚯씪ID紐⑸줉),
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

function DraftPhotoPreviewItem({ file, index, onRemove, styles }) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return undefined;
    }

    if (isUploadedPhotoItem(file)) {
      setPreviewUrl(file.viewUrl || "");
      return undefined;
    }

    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [file]);

  return (
    <div style={styles.draftPhotoCard}>
      {previewUrl ? (
        <img src={previewUrl} alt={file?.fileName || file?.name || `?좏깮 ?ъ쭊 ${index + 1}`} style={styles.draftPhotoImage} />
      ) : (
        <div style={styles.photoThumbEmpty}>誘몃━蹂닿린 遺덇?</div>
      )}
      <button
        type="button"
        onClick={() => onRemove(index)}
        style={styles.draftPhotoRemoveButton}
        aria-label={`?좏깮 ?ъ쭊 ${index + 1} ??젣`}
      >
        횞
      </button>
    </div>
  );
}

function DraftPhotoPreviewList({ files, onRemove, styles }) {
  if (!Array.isArray(files) || files.length === 0) {
    return <div style={styles.draftPhotoEmpty}>?좏깮???ъ쭊 ?놁쓬</div>;
  }

  return (
    <div style={styles.draftPhotoGrid}>
      {files.map((file, index) => (
        <DraftPhotoPreviewItem
          key={`${file?.name || "photo"}-${file?.lastModified || index}-${index}`}
          file={file}
          index={index}
          onRemove={onRemove}
          styles={styles}
        />
      ))}
    </div>
  );
}

function ProductImage({ product, src, alt, style }) {
  const [currentSrc, setCurrentSrc] = useState(src || getDefaultProductImageSrc(product) || DEFAULT_PRODUCT_IMAGE_SRC);

  useEffect(() => {
    setCurrentSrc(src || getDefaultProductImageSrc(product) || DEFAULT_PRODUCT_IMAGE_SRC);
  }, [product, src]);

  return (
    <img
      src={currentSrc}
      alt={alt}
      style={style}
      onError={() => {
        const fallbackSrc = getDefaultProductImageSrc(product);
        if (fallbackSrc && fallbackSrc !== currentSrc) {
          setCurrentSrc(fallbackSrc);
          return;
        }
        if (currentSrc !== DEFAULT_PRODUCT_IMAGE_SRC) {
          setCurrentSrc(DEFAULT_PRODUCT_IMAGE_SRC);
          return;
        }
        if (currentSrc !== SECONDARY_PRODUCT_IMAGE_SRC) {
          setCurrentSrc(SECONDARY_PRODUCT_IMAGE_SRC);
        }
      }}
    />
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
  const [inspectionRows, setInspectionRows] = useState([]);
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
  const draftsRef = useRef({});
  const pendingRef = useRef({});
  const saveQueueRef = useRef({});
  const uploadQueueRef = useRef({});
  const retryMapRef = useRef({});
  const activeSaveCountRef = useRef(0);
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

  const getStatusLabel = (status) => {
    if (status === "pending") return "??λ?湲?;
    if (status === "uploading") return "?낅줈?쒖쨷";
    if (status === "saving") return "??ν솗?몄쨷";
    if (status === "retrying") return "?ъ쟾?≪쨷";
    if (status === "saved") return "??μ셿猷?;
    if (status === "failed") return "?뺤씤?꾩슂";
    return "";
  };

  const serializePhotoItems = useCallback(
    (items) =>
      (Array.isArray(items) ? items : [])
        .filter(isUploadedPhotoItem)
        .map((item) => createUploadedPhotoItem(item)),
    []
  );

  const persistDrafts = useCallback((nextDrafts) => {
    try {
      const serializable = Object.fromEntries(
        Object.entries(nextDrafts || {}).map(([key, value]) => [
          key,
          {
            ...value,
            photoFiles: serializePhotoItems(value?.photoFiles),
            photoNames: Array.isArray(value?.photoNames) ? value.photoNames : [],
          },
        ])
      );
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(serializable));
    } catch (_) {}
  }, [serializePhotoItems]);

  const persistPending = useCallback((nextPending) => {
    try {
      const serializable = Object.fromEntries(
        Object.entries(nextPending || {}).map(([key, value]) => [
          key,
          {
            ...value,
            photoFiles: undefined,
            photoItems: serializePhotoItems(value?.photoItems || value?.photoFiles),
          },
        ])
      );
      window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(serializable));
    } catch (_) {}
  }, [serializePhotoItems]);

  const restoreLocalState = useCallback(() => {
    try {
      const rawDrafts = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (rawDrafts) {
        const parsedDrafts = JSON.parse(rawDrafts);
        setDrafts(parsedDrafts || {});
      }
    } catch (_) {}

    try {
      const rawPending = window.localStorage.getItem(PENDING_STORAGE_KEY);
      if (rawPending) {
        const parsedPending = JSON.parse(rawPending) || {};
        setPendingMap(parsedPending);
        pendingRef.current = parsedPending;
        setItemStatusMap((prev) => {
          const next = { ...prev };
          Object.keys(parsedPending).forEach((key) => {
            next[key] = "pending";
          });
          return next;
        });
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    persistDrafts(drafts);
    draftsRef.current = drafts;
  }, [drafts, persistDrafts]);

  const runQueuedTask = useCallback((queueRef, itemKey, task) => {
    const previous = queueRef.current[itemKey] || Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    queueRef.current[itemKey] = next.finally(() => {
      if (queueRef.current[itemKey] === next) {
        delete queueRef.current[itemKey];
      }
    });
    return queueRef.current[itemKey];
  }, []);

  const runWithSaveSlot = useCallback(async (task) => {
    while (activeSaveCountRef.current >= MAX_SAVE_PARALLEL) {
      await delay(120);
    }
    activeSaveCountRef.current += 1;
    try {
      return await task();
    } finally {
      activeSaveCountRef.current = Math.max(0, activeSaveCountRef.current - 1);
    }
  }, []);

  const runWithRetry = useCallback(async (task, onRetry) => {
    let lastError = null;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await task(attempt);
      } catch (error) {
        lastError = error;
        if (attempt === RETRY_DELAYS_MS.length - 1) break;
        if (typeof onRetry === "function") {
          await onRetry(attempt + 1, error);
        }
        await delay(RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError || new Error("request failed");
  }, []);

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

  const removePendingKeys = useCallback((keys) => {
    if (!keys.length) return;
    setPendingMap((prev) => {
      const next = { ...prev };
      keys.forEach((key) => {
        delete next[key];
      });
      pendingRef.current = next;
      persistPending(next);
      return next;
    });
  }, [persistPending]);

  const upsertPendingEntries = useCallback((entries) => {
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
          merged.?뚯넚?섎웾 = prevEntry.?뚯넚?섎웾 || 0;
          merged.援먰솚?섎웾 = prevEntry.援먰솚?섎웾 || 0;
          merged.?쇳꽣紐?= prevEntry.?쇳꽣紐?|| merged.?쇳꽣紐?|| "";
          merged.鍮꾧퀬 = prevEntry.鍮꾧퀬 || merged.鍮꾧퀬 || "";
          merged.photoItems =
            (Array.isArray(entry.photoItems) && entry.photoItems.length
              ? entry.photoItems
              : prevEntry.photoItems) || [];
        }

        if (entry.type === "return" || entry.type === "exchange") {
          merged.寃?덉닔??= prevEntry.寃?덉닔??|| merged.寃?덉닔??|| 0;
        }

        if (entry.type === "movement") {
          merged.qty = parseQty(entry.qty);
          merged.?뚯넚?섎웾 = parseQty(entry.?뚯넚?섎웾);
          merged.援먰솚?섎웾 = parseQty(entry.援먰솚?섎웾);
          merged.鍮꾧퀬 = entry.鍮꾧퀬 || prevEntry.鍮꾧퀬 || "";
          merged.photoItems = serializePhotoItems(
            [
              ...(Array.isArray(prevEntry.photoItems) ? prevEntry.photoItems : []),
              ...(Array.isArray(entry.photoItems) ? entry.photoItems : []),
            ]
          );
        }

        next[entry.key] = merged;
      });
      pendingRef.current = next;
      persistPending(next);
      return next;
    });
    setItemStatuses(
      entries.map((entry) => entry.key),
      "pending"
    );
  }, [persistPending, serializePhotoItems]);

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
          getValue(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "肄붾뱶", "諛붿퐫??])
        );
        const partner = String(getValue(row, ["?묐젰??, "?묐젰?щ챸"]) || "").trim();
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
          getValue(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "肄붾뱶", "諛붿퐫??])
        );
        const eventName = String(getValue(row, ["?됱궗紐?]) || "").trim();
        const useFlag = getValue(row, ["?ъ슜?щ?"]);

        if (!productCode) return;
        if (isExplicitFalseUsage(useFlag)) return;

        nextEventMap[productCode] = {
          ?됱궗?щ?: "?됱궗",
          ?됱궗紐? eventName,
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
      setProductImageMap(buildProductImageMapFromRows(data.product_images));
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
      String(b.?묒꽦?쇱떆 || "").localeCompare(String(a.?묒꽦?쇱떆 || ""), "ko")
    );
  }, []);

  const fetchInspectionRowsData = useCallback(async () => {
    const response = await fetch(`${SCRIPT_URL}?action=getInspectionRows`);
    const result = await response.json();

    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "寃???곗씠??遺덈윭?ㅺ린 ?ㅽ뙣");
    }

    return Array.isArray(result.rows) ? result.rows : [];
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

  const loadInspectionRows = useCallback(async () => {
    try {
      const nextRows = await fetchInspectionRowsData();
      setInspectionRows(nextRows);
      return nextRows;
    } catch (err) {
      setError(err.message || "寃???곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲??");
      setInspectionRows([]);
      return [];
    }
  }, [fetchInspectionRowsData]);

  useEffect(() => {
    loadBootstrap();
    loadHistoryRows();
    loadInspectionRows();
  }, [loadBootstrap, loadHistoryRows, loadInspectionRows]);

  useEffect(() => {
    restoreLocalState();
  }, [restoreLocalState]);

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
      const key = `${record.?묐젰?щ챸 || ""}||${record.?곹뭹肄붾뱶 || ""}`;
      if (!map[key]) {
        map[key] = { returnCount: 0, exchangeCount: 0 };
      }

      if (parseQty(record.?뚯넚?섎웾) > 0) {
        map[key].returnCount += 1;
      }

      if (parseQty(record.援먰솚?섎웾) > 0) {
        map[key].exchangeCount += 1;
      }
    });

    return map;
  }, [historyRows]);

  const inspectionSavedMap = useMemo(() => {
    const map = {};

    (inspectionRows || []).forEach((row) => {
      const key = makeEntityKey(
        row.?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?
        row.?곹뭹肄붾뱶,
        row.?묐젰?щ챸
      );
      map[key] = {
        inspectionQty: parseQty(row.寃?덉닔??,
        returnQty: parseQty(row.?뚯넚?섎웾),
        exchangeQty: parseQty(row.援먰솚?섎웾),
      };
    });

    return map;
  }, [inspectionRows]);

  const movementSavedMap = useMemo(() => {
    const map = {};

    (historyRows || []).forEach((row) => {
      const typeName = String(row.泥섎━?좏삎 || "").trim();
      const key = makeMovementPendingKey(
        typeName === "援먰솚" ? "EXCHANGE" : typeName === "?뚯넚" ? "RETURN" : typeName,
        row.?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?
        row.?곹뭹肄붾뱶,
        row.?묐젰?щ챸,
        row.?쇳꽣紐?
      );

      if (!map[key]) {
        map[key] = {
          returnQty: 0,
          exchangeQty: 0,
        };
      }

      map[key].returnQty += parseQty(row.?뚯넚?섎웾);
      map[key].exchangeQty += parseQty(row.援먰솚?섎웾);
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
      group.products.map((product) => {
        const imageKey = makeProductImageMapKey({
          productCode: product.productCode,
          partner: group.partner,
          productName: product.productName,
        });
        const customImageSrc = imageKey ? productImageMap[imageKey] || "" : "";

        return {
          partner: group.partner,
          productCode: product.productCode,
          productName: product.productName,
          imageSrc: product.imageSrc || "",
          customImageSrc,
          hasCustomImage: !!customImageSrc,
          hasVisibleImage: !!(product.imageSrc || ""),
          totalQty: product.totalQty || 0,
          imageKey,
        };
      })
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
  }, [groupedPartners, imageRegisterSearch, productImageMap]);

  const buildInspectionPendingEntry = useCallback((product, nextDraft = {}) => {
    const entityKey = makeEntityKey(currentJob?.job_key, product.productCode, product.partner);
    const draftKey = `inspection||${product.partner}||${product.productCode}`;
    const photoItems = serializePhotoItems(nextDraft.photoFiles);

    return {
      key: entityKey,
      draftKey,
      type: "inspection",
      ?묒뾽湲곗??쇰삉?봀SV?앸퀎媛? currentJob?.job_key || "",
      ?묒꽦?쇱떆: new Date().toISOString(),
      ?곹뭹肄붾뱶: product.productCode,
      ?곹뭹紐? product.productName,
      ?묐젰?щ챸: product.partner,
      ?꾩껜諛쒖＜?섎웾: product.totalQty || 0,
      諛쒖＜?섎웾: product.totalQty || 0,
      寃?덉닔?? parseQty(nextDraft.inspectionQty),
      ?뚯넚?섎웾: pendingMap[entityKey]?.?뚯넚?섎웾 || 0,
      援먰솚?섎웾: pendingMap[entityKey]?.援먰솚?섎웾 || 0,
      ?쇳꽣紐? pendingMap[entityKey]?.?쇳꽣紐?|| "",
      鍮꾧퀬: pendingMap[entityKey]?.鍮꾧퀬 || "",
      ?됱궗?щ?: product.eventInfo?.?됱궗?щ? || "",
      ?됱궗紐? product.eventInfo?.?됱궗紐?|| "",
      photoItems,
      ?ъ쭊?뚯씪ID紐⑸줉: photoItems.map((item) => item.fileId).join("\n"),
      photoNames: photoItems.map((item) => item.fileName || item.name),
    };
  }, [currentJob?.job_key, pendingMap, serializePhotoItems]);

  const buildMovementEntries = useCallback((product, centerName, nextDraft = {}) => {
    const centerInfo = product.centers.find((item) => item.center === centerName);
    if (!centerInfo || !currentJob?.job_key) {
      return [];
    }

    const returnQty = parseQty(nextDraft.returnQty);
    const exchangeQty = parseQty(nextDraft.exchangeQty);
    const memo = String(nextDraft.memo || "").trim();
    const photoItems = serializePhotoItems(nextDraft.photoFiles);
    const entries = [];

    if (returnQty > 0) {
      entries.push({
        key: makeMovementPendingKey("RETURN", currentJob.job_key, product.productCode, product.partner, centerName),
        draftKey: `return||${product.partner}||${product.productCode}||${centerName}`,
        type: "movement",
        movementType: "RETURN",
        ?묒뾽湲곗??쇰삉?봀SV?앸퀎媛? currentJob.job_key,
        ?묒꽦?쇱떆: new Date().toISOString(),
        ?곹뭹紐? product.productName,
        ?곹뭹肄붾뱶: product.productCode,
        ?쇳꽣紐? centerName,
        ?묐젰?щ챸: product.partner,
        諛쒖＜?섎웾: centerInfo.totalQty || 0,
        ?됱궗?щ?: product.eventInfo?.?됱궗?щ? || "",
        ?됱궗紐? product.eventInfo?.?됱궗紐?|| "",
        泥섎━?좏삎: "?뚯넚",
        ?뚯넚?섎웾: returnQty,
        援먰솚?섎웾: 0,
        qty: returnQty,
        鍮꾧퀬: memo,
        photoItems,
        ?ъ쭊?뚯씪ID紐⑸줉: photoItems.map((item) => item.fileId).join("\n"),
        photoNames: photoItems.map((item) => item.fileName || item.name),
        ?꾩껜諛쒖＜?섎웾: product.totalQty || 0,
      });
    }

    if (exchangeQty > 0) {
      entries.push({
        key: makeMovementPendingKey("EXCHANGE", currentJob.job_key, product.productCode, product.partner, centerName),
        draftKey: `return||${product.partner}||${product.productCode}||${centerName}`,
        type: "movement",
        movementType: "EXCHANGE",
        ?묒뾽湲곗??쇰삉?봀SV?앸퀎媛? currentJob.job_key,
        ?묒꽦?쇱떆: new Date().toISOString(),
        ?곹뭹紐? product.productName,
        ?곹뭹肄붾뱶: product.productCode,
        ?쇳꽣紐? centerName,
        ?묐젰?щ챸: product.partner,
        諛쒖＜?섎웾: centerInfo.totalQty || 0,
        ?됱궗?щ?: product.eventInfo?.?됱궗?щ? || "",
        ?됱궗紐? product.eventInfo?.?됱궗紐?|| "",
        泥섎━?좏삎: "援먰솚",
        ?뚯넚?섎웾: 0,
        援먰솚?섎웾: exchangeQty,
        qty: exchangeQty,
        鍮꾧퀬: memo,
        photoItems,
        ?ъ쭊?뚯씪ID紐⑸줉: photoItems.map((item) => item.fileId).join("\n"),
        photoNames: photoItems.map((item) => item.fileName || item.name),
        ?꾩껜諛쒖＜?섎웾: product.totalQty || 0,
      });
    }

    return entries;
  }, [currentJob?.job_key, serializePhotoItems]);

  const removeDraftPhoto = useCallback((draftKey, index) => {
    const currentDraft = drafts[draftKey] || {};
    const currentFiles = Array.isArray(currentDraft.photoFiles) ? currentDraft.photoFiles : [];
    const currentNames = Array.isArray(currentDraft.photoNames) ? currentDraft.photoNames : [];
    const nextPhotoFiles = currentFiles.filter((_, fileIndex) => fileIndex !== index);
    const nextPhotoNames = currentNames.filter((_, fileIndex) => fileIndex !== index);
    const nextDraft = {
      ...currentDraft,
      photoFiles: nextPhotoFiles,
      photoNames: nextPhotoNames,
    };

    setDrafts((prev) => ({
      ...prev,
      [draftKey]: nextDraft,
    }));
  }, [drafts]);

  const uploadDraftPhotos = useCallback(async ({ draftKey, itemKey, baseName, files }) => {
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return;

    await runQueuedTask(uploadQueueRef, itemKey, async () => {
      setItemStatuses([itemKey], "uploading");

      try {
        const encodedPhotos = await filesToBase64(list);
        const result = await runWithRetry(
          async () => {
            const response = await fetch(SCRIPT_URL, {
              method: "POST",
              headers: { "Content-Type": "text/plain;charset=utf-8" },
              body: JSON.stringify({
                action: "uploadPhotos",
                payload: {
                  itemKey,
                  productName: baseName,
                  photos: encodedPhotos,
                },
              }),
            });
            const payload = await response.json();
            if (!response.ok || payload.ok === false) {
              throw new Error(payload.message || "?ъ쭊 ?낅줈???ㅽ뙣");
            }
            return payload;
          },
          async () => {
            setItemStatuses([itemKey], "retrying");
          }
        );

        const uploadedPhotos = (Array.isArray(result?.data?.photos) ? result.data.photos : []).map(createUploadedPhotoItem);
        setDrafts((prev) => {
          const currentDraft = prev[draftKey] || {};
          const previousPhotos = serializePhotoItems(currentDraft.photoFiles);
          const nextPhotos = [...previousPhotos, ...uploadedPhotos];
          const nextDraft = {
            ...currentDraft,
            photoFiles: nextPhotos,
            photoNames: nextPhotos.map((photo) => photo.fileName || photo.name),
          };
          return {
            ...prev,
            [draftKey]: nextDraft,
          };
        });
        setItemStatuses([itemKey], "pending");
      } catch (err) {
        retryMapRef.current[itemKey] = {
          kind: "upload",
          draftKey,
          itemKey,
          baseName,
        };
        setItemStatuses([itemKey], "failed");
        setError(err.message || "?ъ쭊 ?낅줈???ㅽ뙣");
      }
    });
  }, [runQueuedTask, runWithRetry, serializePhotoItems]);

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

    return result;
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
      setError("?깅줉 ????곹뭹??李얠? 紐삵뻽?듬땲??");
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
        throw new Error(result.message || "?대?吏 ?깅줉 ?ㅽ뙣");
      }

      const nextMap = buildProductImageMapFromRows(result.product_images);
      setProductImageMap(nextMap);
      setToast("?대?吏 ?깅줉 ?꾨즺");
      setMessage("?곹뭹 ?대?吏媛 ?깅줉?섏뿀?듬땲??");
    } catch (err) {
      setError(err.message || "?대?吏 ?깅줉 ?ㅽ뙣");
    } finally {
      setUploadingImageKey("");
      setSelectedImageTargetKey("");
      if (e.target) e.target.value = "";
    }
  };

  const flushPending = useCallback(async () => {
    const rows = Object.values(pendingRef.current || {});
    if (!rows.length || savingRef.current) return;

    clearFlushTimer();
    savingRef.current = true;
    setSaving(true);

    try {
      const tasks = rows.map((row) =>
        runQueuedTask(saveQueueRef, row.key, () =>
          runWithSaveSlot(async () => {
            const { key, draftKey, photoItems, ...rest } = row;
            const statusKeys = [key, draftKey].filter(Boolean);

            try {
              if (draftKey && uploadQueueRef.current[draftKey]) {
                await uploadQueueRef.current[draftKey];
              }
              const latestDraft = draftKey ? draftsRef.current[draftKey] || {} : {};
              const latestPhotoItems = serializePhotoItems(latestDraft.photoFiles);
              setItemStatuses(statusKeys, "saving");
              const response = await runWithRetry(
                async () => {
                  const saveResponse = await fetch(SCRIPT_URL, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({
                      action: "saveBatch",
                      rows: [
                        {
                          ...rest,
                          ?ъ쭊?뚯씪ID紐⑸줉: (latestPhotoItems.length ? latestPhotoItems : Array.isArray(photoItems) ? photoItems : [])
                            .map((item) => item.fileId)
                            .join("\n")
                            || rest.?ъ쭊?뚯씪ID紐⑸줉
                            || "",
                          photoItems: latestPhotoItems.length ? latestPhotoItems : photoItems,
                          photoNames: (latestPhotoItems.length ? latestPhotoItems : Array.isArray(photoItems) ? photoItems : [])
                            .map((item) => item.fileName || item.name),
                        },
                      ],
                    }),
                  });
                  const payload = await saveResponse.json();
                  if (!saveResponse.ok || payload.ok === false) {
                    throw new Error(payload.message || "????ㅽ뙣");
                  }
                  return payload;
                },
                async () => {
                  setItemStatuses(statusKeys, "retrying");
                }
              );

              removePendingKeys([key]);
              retryMapRef.current[key] = null;
              setItemStatuses(statusKeys, "saved");
              if (draftKey) {
                setDrafts((prev) => ({
                  ...prev,
                  [draftKey]: {
                    ...(prev[draftKey] || {}),
                    photoFiles: [],
                    photoNames: [],
                  },
                }));
              }

              if (Array.isArray(response.records)) {
                const nextRows = [...response.records].sort((a, b) =>
                  String(b.?묒꽦?쇱떆 || "").localeCompare(String(a.?묒꽦?쇱떆 || ""), "ko")
                );
                setHistoryRows(nextRows);
              }

              if (Array.isArray(response.inspectionRowsSnapshot)) {
                setInspectionRows(response.inspectionRowsSnapshot);
              } else if (Array.isArray(response.inspectionRows)) {
                setInspectionRows(response.inspectionRows);
              }

              if (response.summary) {
                setDashboardSummary(response.summary);
              }

              setToast("????꾨즺");
            } catch (err) {
              retryMapRef.current[key] = row;
              setItemStatuses(statusKeys, "failed");
              setError(err.message || "????ㅽ뙣");
            }
          })
        )
      );

      await Promise.allSettled(tasks);
    } catch (err) {
      setError(err.message || "???泥섎━ ?ㅽ뙣");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [clearFlushTimer, removePendingKeys, runQueuedTask, runWithRetry, runWithSaveSlot, serializePhotoItems]);

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

    if (qty <= 0 && !photoFiles.length) {
      setError("寃?덉닔???먮뒗 ?ъ쭊???낅젰??二쇱꽭??");
      return;
    }

    setError("");
    setMessage("");
    const nextEntry = buildInspectionPendingEntry(product, drafts[draftKey] || {});

    console.log("[saveInspectionQtySimple] pending entry", {
      jobKey: nextEntry.?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?
      productCode: nextEntry.?곹뭹肄붾뱶,
      partnerName: nextEntry.?묐젰?щ챸,
      centerName: nextEntry.?쇳꽣紐?
      inspectionQty: nextEntry.寃?덉닔??
      returnQty: nextEntry.?뚯넚?섎웾,
      exchangeQty: nextEntry.援먰솚?섎웾,
      totalQty: nextEntry.?꾩껜諛쒖＜?섎웾,
      orderQty: nextEntry.諛쒖＜?섎웾,
      photosCount: Array.isArray(nextEntry.photoItems) ? nextEntry.photoItems.length : 0,
    });

    upsertPendingEntries([nextEntry]);
    flushPending();
    setToast("??λ릺?덉뒿?덈떎.");
  };

  const saveReturnExchange = async (product, centerName) => {
    if (!product.centers.find((item) => item.center === centerName)) {
      setError("?쇳꽣瑜??좏깮??二쇱꽭??");
      return;
    }

    const draftKey = `return||${product.partner}||${product.productCode}||${centerName}`;
    const draft = drafts[draftKey] || {};
    const returnQty = parseQty(draft.returnQty);
    const exchangeQty = parseQty(draft.exchangeQty);

    if (!currentJob?.job_key) {
      setError("???媛?ν븳 ?묒뾽 湲곗? CSV媛 ?놁뒿?덈떎.");
      return;
    }

    if (returnQty <= 0 && exchangeQty <= 0) {
      setError("?뚯넚?섎웾 ?먮뒗 援먰솚?섎웾???낅젰??二쇱꽭??");
      return;
    }

    setError("");
    setMessage("");

    const movementEntries = buildMovementEntries(product, centerName, draft);

    console.log(
      "[saveReturnExchange] pending entries",
      movementEntries.map((entry) => ({
        movementType: entry.movementType,
        jobKey: entry.?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?
        productCode: entry.?곹뭹肄붾뱶,
        partnerName: entry.?묐젰?щ챸,
        centerName: entry.?쇳꽣紐?
        returnQty: entry.?뚯넚?섎웾,
        exchangeQty: entry.援먰솚?섎웾,
        totalQty: entry.?꾩껜諛쒖＜?섎웾,
        orderQty: entry.諛쒖＜?섎웾,
        photosCount: Array.isArray(entry.photoItems) ? entry.photoItems.length : 0,
      }))
    );

    upsertPendingEntries(movementEntries);
    flushPending();
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
      const result = await cancelMovementEventByRow(rowNumber);
      if (Array.isArray(result?.records)) {
        setHistoryRows(result.records);
      } else {
        setHistoryRows((prev) => prev.filter((item) => Number(item.__rowNumber) !== rowNumber));
      }
      if (Array.isArray(result?.inspectionRows)) {
        setInspectionRows(result.inspectionRows);
      }
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

      if (result.downloadUrl) {
        const link = document.createElement("a");
        link.href = result.downloadUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.download = result.fileName || "";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setToast("ZIP ?ㅼ슫濡쒕뱶 以鍮??꾨즺");
        return;
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
      setInspectionRows(Array.isArray(result.inspectionRows) ? result.inspectionRows : []);
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
          ?쒕ぉ: clampText(row["?쒕ぉ"] || row["subject"] || "", 300),
          蹂몃Ц: clampText(row["蹂몃Ц"] || row["body"] || row["?댁슜(?뷀샇??"] || "", 8000),
          硫붿씪ID: clampText(row["?명꽣??硫붿떆吏 ID"] || row["硫붿씪ID"] || row["?묒닔踰덊샇"] || "", 200),
          蹂대궦?щ엺: clampText(row["蹂대궦?щ엺:(?대쫫)"] || row["senderName"] || "", 200),
          ?묒닔?쇱떆: clampText(row["?묒닔?쇱떆"] || row["receivedAt"] || "", 100),
          ?뚰듃?덉궗: clampText(row["泥섎━?뚰듃?덉궗"] || row["?뚰듃?덉궗"] || row["?묐젰?щ챸"] || "", 200),
          ?μ븷?좏삎: clampText(
            row["?μ븷?좏삎(??"] || row["?μ븷?좏삎(以?"] || row["?μ븷?좏삎(?)"] || row["?μ븷?좏삎"] || "",
            200
          ),
        }))
        .filter((row) => String(row.?쒕ぉ || "").trim() || String(row.蹂몃Ц || "").trim());

      const dedupedMap = new Map();
      rawRows.forEach((row) => {
        const dedupeKey = [
          String(row.硫붿씪ID || "").trim(),
          String(row.?뚰듃?덉궗 || "").trim(),
          String(row.?묒닔?쇱떆 || "").trim(),
          String(row.?쒕ぉ || "").trim(),
          String(row.蹂몃Ц || "").trim().slice(0, 300),
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
        `?댄뵾肄?CSV 諛섏쁺 ?꾨즺 쨌 ?좉퇋 ${insertedTotal}嫄?쨌 媛깆떊 ${updatedTotal}嫄?{
          skippedCount > 0 ? ` 쨌 以묐났 ?쒖쇅 ${skippedCount}嫄? : ""
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
          <div style={styles.brandBlock}>
            <div style={styles.brandRow}>
              <img src="/assets/gs-logo.svg" alt="GS 濡쒓퀬" style={styles.brandLogo} />
              <h1 style={styles.title}>?좎꽑媛뺥솕吏?먰? 寃???쒖뒪??/h1>
            </div>
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
            <span style={styles.quickActionText}>寃??/span>
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
            <div style={styles.sectionTitle}>CSV ?낅줈??/div>
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
              {uploadingCsv ? "泥섎━ 以?.." : "?뱞 寃??CSV ?낅줈??}
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
              {uploadingHappycallCsv ? "泥섎━ 以?.." : "?뾺 ?댄뵾肄??낅줈??}
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
              ?뼹 ?대?吏 ?깅줉
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
              ?뫀 愿由ъ옄 珥덇린??
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
            placeholder="?곹뭹紐?/ ?곹뭹肄붾뱶 / ?묐젰??寃??
            style={styles.searchInput}
          />
          <button type="button" onClick={() => setIsScannerOpen(true)} style={styles.scanButton} aria-label="諛붿퐫???ㅼ틪">
            <span style={styles.scanIcon}>?ㅼ틪</span>
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
            <div style={styles.sectionTitle}>?꾩씪 ?댄뵾肄?TOP 5 {totalVisibleProducts ? `(${totalVisibleProducts}嫄?` : ""}</div>
            <div style={styles.heroSubtext}>?꾩씪 ?묒닔 ?댄뵾肄?湲곗?</div>
          </div>
        </div>

        {previousDayHappycallTopList.length === 0 ? (
          <div style={styles.emptyBox}>?꾩씪 ?댄뵾肄??곗씠?곌? ?놁뒿?덈떎.</div>
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
                    {happycallHeroCard.count.toLocaleString("ko-KR")}嫄?쨌 {formatPercent(happycallHeroCard.share)}
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
                    <ProductImage
                      product={{
                        productName: happycallHeroCard.productName,
                        partner: happycallHeroCard.partnerName,
                        productCode: happycallHeroCard.productCode,
                      }}
                      src={happycallHeroCard.imageSrc}
                      alt={happycallHeroCard.productName}
                      style={styles.heroImage}
                    />
                  ) : (
                    <div style={styles.heroFallbackImage}>?벀</div>
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
                      <span>{getTopMedal(card.rank) || "??}</span>
                      <span>{card.rank <= 3 ? `TOP ${card.rank}` : ""}</span>
                    </div>
                    <div style={styles.heroMiniContent}>
                      <div style={styles.heroMiniCopy}>
                        <div style={styles.heroMiniName}>{card.productName}</div>
                        <div style={styles.heroMiniMeta}>
                          {card.count.toLocaleString("ko-KR")}嫄?쨌 {formatPercent(card.share)}
                        </div>
                      </div>
                      {card.imageSrc ? (
                        <div style={styles.heroMiniThumbFrame}>
                          <ProductImage
                            product={{
                              productName: card.productName,
                              partner: card.partnerName,
                              productCode: card.productCode,
                            }}
                            src={card.imageSrc}
                            alt={card.productName}
                            style={styles.heroMiniThumbImage}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

          </div>
        )}
      </div>

      <div style={styles.partnerPanel}>
        <div style={styles.partnerSectionHeader}>
          <div style={styles.sectionTitle}>?묐젰??紐⑸줉</div>
          <div style={styles.partnerSectionCount}>珥?{totalVisibleProducts}嫄?/div>
        </div>
        <div style={styles.partnerDownloadRow}>
          {mode === "inspection" ? (
            <button
              type="button"
              onClick={() => downloadPhotoZip("inspection")}
              style={{
                ...styles.historyButton,
                ...styles.partnerDownloadButtonActive,
              }}
            >
              {zipDownloading === "inspection" ? "ZIP ?앹꽦 以?.." : "寃?덉궗吏????}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => downloadPhotoZip("movement")}
              style={{
                ...styles.historyButton,
                ...styles.partnerDownloadButtonActive,
              }}
            >
              {zipDownloading === "movement" ? "ZIP ?앹꽦 以?.." : "遺덈웾?ъ쭊 ???}
            </button>
          )}
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
                <div style={styles.partnerHeaderRight}>
                  <div style={styles.partnerCount}>{partnerGroup.products.length}嫄?/div>
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
                    const inspectionSaved = inspectionSavedMap[entityKey] || {
                      inspectionQty: 0,
                      returnQty: 0,
                      exchangeQty: 0,
                    };
                    const returnSavedKey = makeMovementPendingKey(
                      "RETURN",
                      currentJob?.job_key,
                      product.productCode,
                      product.partner,
                      selectedCenter
                    );
                    const exchangeSavedKey = makeMovementPendingKey(
                      "EXCHANGE",
                      currentJob?.job_key,
                      product.productCode,
                      product.partner,
                      selectedCenter
                    );
                    const returnSavedQty = parseQty(movementSavedMap[returnSavedKey]?.returnQty);
                    const exchangeSavedQty = parseQty(movementSavedMap[exchangeSavedKey]?.exchangeQty);
                    const inspectionInputQty = parseQty(draft.inspectionQty);
                    const returnInputQty = parseQty(draft.returnQty);
                    const exchangeInputQty = parseQty(draft.exchangeQty);
                    const inspectionPreviewText = `?꾩옱 ${inspectionSaved.inspectionQty}媛? ?낅젰 ${inspectionInputQty}媛? ?????${inspectionInputQty || inspectionSaved.inspectionQty}媛?;
                    const returnPreviewText = `?꾩옱 ${returnSavedQty}媛? ?낅젰 ${returnInputQty}媛? ??????꾩쟻 ${returnSavedQty + returnInputQty}媛?;
                    const exchangePreviewText = `?꾩옱 ${exchangeSavedQty}媛? ?낅젰 ${exchangeInputQty}媛? ??????꾩쟻 ${exchangeSavedQty + exchangeInputQty}媛?;
                    const inspectionStatus = itemStatusMap[draftKey] || itemStatusMap[entityKey];
                    const movementStatus = itemStatusMap[draftKey];
                    const actionStatus = mode === "inspection"
                      ? inspectionStatus
                      : movementStatus;
                    const actionStatusLabel = getStatusLabel(actionStatus);
                    const happycallBadges = [
                      ["1d", "?꾩씪"],
                      ["7d", "?쇱＜??],
                      ["30d", "?쒕떖"],
                    ]
                      .map(([periodKey, label]) => {
                        const stats = product.happycallStats?.[periodKey];
                        if (!stats?.rank || stats.rank > 5) return null;
                        return {
                          key: periodKey,
                          rank: stats.rank,
                          label: stats.rank <= 3 ? `${label} ?댄뵾肄?TOP${stats.rank}` : `${label} ?댄뵾肄?,
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
                                    <div style={styles.cardTitle}>{product.productName || "?곹뭹紐??놁쓬"}</div>
                                    {product.eventInfo?.?됱궗?щ? ? (
                                      <span style={styles.eventBadge}>
                                        {product.eventInfo.?됱궗紐?|| "?됱궗"}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div style={styles.cardMeta}>肄붾뱶 {product.productCode}</div>
                                  <div style={styles.qtyRow}>
                                    <span style={styles.qtyChip}>珥?諛쒖＜ {product.totalQty}媛?/span>
                                    {historySummary ? <span style={styles.qtyChip}>{historySummary}</span> : null}
                                  </div>
                                </div>
                                {product.imageSrc ? (
                                  <div style={styles.cardThumbFrame}>
                                    <ProductImage
                                      product={product}
                                      src={product.imageSrc}
                                      alt={product.productName}
                                      style={styles.cardThumbImage}
                                    />
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
                                  const nextDraft = {
                                    ...draft,
                                    inspectionQty: nextValue,
                                  };
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [draftKey]: nextDraft,
                                  }));
                                }}
                                style={styles.inlineQtyInput}
                                placeholder="寃?덉닔??
                              />
                            </div>
                            <div style={styles.inputHintText}>{inspectionPreviewText}</div>
                            <div style={styles.formGroup}>
                              <label style={styles.label}>寃???ъ쭊</label>
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(e) => {
                                  const files = Array.from(e.target.files || []);
                                  uploadDraftPhotos({
                                    draftKey,
                                    itemKey: entityKey,
                                    baseName: product.productName || "寃??,
                                    files,
                                  });
                                  e.target.value = "";
                                }}
                                style={styles.fileInput}
                              />
                              <DraftPhotoPreviewList
                                files={draft.photoFiles}
                                onRemove={(index) =>
                                  removeDraftPhoto(draftKey, index)
                                }
                                styles={styles}
                              />
                              {actionStatusLabel ? (
                                <div style={styles.inputHintText}>{actionStatusLabel}</div>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => saveInspectionQtySimple(product)}
                              style={styles.saveButton}
                            >
                              {inspectionStatus === "saving" ? "??μ쨷..." : "???}
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
                                    <div style={styles.cardTitle}>{product.productName || "?곹뭹紐??놁쓬"}</div>
                                    {product.eventInfo?.?됱궗?щ? ? (
                                      <span style={styles.eventBadge}>
                                        {product.eventInfo.?됱궗紐?|| "?됱궗"}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div style={styles.cardMeta}>肄붾뱶 {product.productCode}</div>
                                  <div style={styles.qtyRow}>
                                    <span style={styles.qtyChip}>珥?諛쒖＜ {product.totalQty}媛?/span>
                                    {historySummary ? <span style={styles.qtyChip}>{historySummary}</span> : null}
                                  </div>
                                </div>
                                {product.imageSrc ? (
                                  <div style={styles.cardThumbFrame}>
                                    <ProductImage
                                      product={product}
                                      src={product.imageSrc}
                                      alt={product.productName}
                                      style={styles.cardThumbImage}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            </button>

                            {isOpen && (
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
                                  ?됱궗: {product.eventInfo?.?됱궗?щ? || ""}
                                  {product.eventInfo?.?됱궗紐?? ` (${product.eventInfo.?됱궗紐?)` : ""}
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
                                      onChange={(e) => {
                                        const nextDraft = {
                                          ...draft,
                                          returnQty: e.target.value,
                                        };
                                        setDrafts((prev) => ({
                                          ...prev,
                                          [draftKey]: nextDraft,
                                        }));
                                      }}
                                      style={styles.input}
                                    />
                                    <div style={styles.inputHintText}>{returnPreviewText}</div>
                                  </div>
                                  <div style={styles.formGroup}>
                                    <label style={styles.label}>援먰솚?섎웾</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={draft.exchangeQty || ""}
                                      onChange={(e) => {
                                        const nextDraft = {
                                          ...draft,
                                          exchangeQty: e.target.value,
                                        };
                                        setDrafts((prev) => ({
                                          ...prev,
                                          [draftKey]: nextDraft,
                                        }));
                                      }}
                                      style={styles.input}
                                    />
                                    <div style={styles.inputHintText}>{exchangePreviewText}</div>
                                  </div>
                                </div>

                                <div style={styles.formGroup}>
                                  <label style={styles.label}>鍮꾧퀬</label>
                                  <textarea
                                    value={draft.memo || ""}
                                    onChange={(e) => {
                                      const nextDraft = {
                                        ...draft,
                                        memo: e.target.value,
                                      };
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [draftKey]: nextDraft,
                                      }));
                                    }}
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
                                      uploadDraftPhotos({
                                        draftKey,
                                        itemKey: draftKey,
                                        baseName: product.productName || "遺덈웾",
                                        files,
                                      });
                                      e.target.value = "";
                                    }}
                                    style={styles.fileInput}
                                  />
                                  <DraftPhotoPreviewList
                                    files={draft.photoFiles}
                                    onRemove={(index) =>
                                      removeDraftPhoto(draftKey, index)
                                    }
                                    styles={styles}
                                  />
                                  {actionStatusLabel ? (
                                    <div style={styles.inputHintText}>{actionStatusLabel}</div>
                                  ) : null}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => saveReturnExchange(product, selectedCenter)}
                                  style={styles.saveButton}
                                >
                                  {actionStatus === "saving" ? "??μ쨷..." : "???}
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
                    key={`${record.__rowNumber || "row"}-${record.?묒꽦?쇱떆 || "time"}-${index}`}
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
                      <div style={styles.cardTitle}>{record.?곹뭹紐?|| "?곹뭹紐??놁쓬"}</div>
                      <span style={styles.typeBadge}>{getRecordType(record)}</span>
                    </div>
                    <div style={styles.cardMeta}>肄붾뱶 {record.?곹뭹肄붾뱶 || "-"}</div>
                    <div style={styles.cardMeta}>?쇳꽣 {record.?쇳꽣紐?|| "-"}</div>
                    <div style={styles.cardMeta}>?묐젰??{record.?묐젰?щ챸 || "-"}</div>
                    <div style={styles.qtyRow}>
                      <span style={styles.qtyChip}>泥섎━?섎웾 {getRecordQtyText(record)}</span>
                      <span style={styles.qtyChip}>{formatDateTime(record.?묒꽦?쇱떆)}</span>
                    </div>
                    <div style={styles.historyMemo}>{record.鍮꾧퀬 || "-"}</div>

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
              <h2 style={styles.sheetTitle}>愿由ъ옄 珥덇린??/h2>
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
              {adminResetting ? "珥덇린??以?.." : "?꾩옱 ?묒뾽 ?낅젰 ?곗씠??珥덇린??}
            </button>
          </div>
        </div>
      )}

      {showImageRegister && (
        <div style={styles.sheetOverlay} onClick={() => !uploadingImageKey && setShowImageRegister(false)}>
          <div style={styles.bottomSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} />
            <div style={styles.sheetHeader}>
              <h2 style={styles.sheetTitle}>?곹뭹 ?대?吏 ?깅줉</h2>
              <button
                type="button"
                onClick={() => !uploadingImageKey && setShowImageRegister(false)}
                style={styles.sheetClose}
              >
                ?リ린
              </button>
            </div>

            <div style={styles.infoBox}>
              ?꾩옱 CSV 湲곗? ?곹뭹??????대?吏瑜??깅줉?섍굅??援먯껜?????덉뒿?덈떎. ?깅줉???대?吏??媛숈? ?묐젰???곹뭹??怨꾩냽 ?먮룞 ?곸슜?⑸땲??
            </div>

            <div style={styles.searchRow}>
              <input
                value={imageRegisterSearch}
                onChange={(e) => setImageRegisterSearch(e.target.value)}
                placeholder="?곹뭹紐?/ ?곹뭹肄붾뱶 / ?묐젰??寃??
                style={styles.searchInput}
              />
            </div>

                {imageRegistryProducts.length === 0 ? (
              <div style={styles.emptyState}>?쒖떆???곹뭹???놁뒿?덈떎.</div>
            ) : (
              <div style={styles.imageRegisterList}>
                {imageRegistryProducts.map((product) => (
                  <div key={product.imageKey} style={styles.imageRegisterCard}>
                    <div style={styles.imageRegisterInfo}>
                      <div style={styles.imageRegisterName}>{product.productName}</div>
                      <div style={styles.metaText}>肄붾뱶 {product.productCode || "-"}</div>
                      <div style={styles.metaText}>?묐젰??{product.partner || "-"}</div>
                      <div style={styles.metaText}>珥?諛쒖＜ {parseQty(product.totalQty).toLocaleString("ko-KR")}媛?/div>
                      <div style={styles.metaText}>{product.hasVisibleImage ? "현재 이미지 있음" : "현재 이미지 없음"}</div>
                    </div>
                    {product.imageSrc ? (
                      <div style={{ ...styles.cardThumbFrame, width: 64, height: 64 }}>
                        <ProductImage product={product} src={product.imageSrc} alt={product.productName} style={styles.cardThumbImage} />
                      </div>
                    ) : null}
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
                      {uploadingImageKey === product.imageKey ? "등록 중..." : product.hasVisibleImage ? "이미지 교체" : "이미지 등록"}
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

            <div style={styles.scannerTopText}>{scannerReady ? scannerStatus : "諛붿퐫???몄떇 以?.."}</div>

            <div style={styles.scannerViewport}>
              <video ref={scannerVideoRef} style={styles.scannerVideo} muted playsInline />
              <div style={styles.scannerGuideBox} />
            </div>

            <div style={styles.scannerHelperText}>諛붿퐫?쒕? ?붾㈃ 以묒븰??留욎떠二쇱꽭??</div>

            {scannerError ? <div style={styles.errorBox}>{scannerError}</div> : null}

            <div style={styles.scannerActions}>
              {torchSupported ? (
                <button type="button" onClick={toggleTorch} style={styles.secondaryButton}>
                  {torchOn ? "?뚮옒???꾧린" : "?뚮옒??耳쒓린"}
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
                吏곸젒 ?낅젰
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
  draftPhotoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
    gap: 8,
    marginTop: 10,
  },
  draftPhotoCard: {
    position: "relative",
    borderRadius: 14,
    overflow: "hidden",
    border: "1px solid #dbe4f3",
    background: "#fff",
    aspectRatio: "1 / 1",
  },
  draftPhotoImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  draftPhotoRemoveButton: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 999,
    border: "none",
    background: "rgba(15,23,42,0.82)",
    color: "#fff",
    fontSize: 16,
    lineHeight: "24px",
    cursor: "pointer",
    padding: 0,
  },
  draftPhotoEmpty: {
    marginTop: 10,
    border: "1px dashed #d1d5db",
    borderRadius: 14,
    background: "#f9fafb",
    color: "#6b7280",
    fontSize: 13,
    padding: "16px 12px",
    textAlign: "center",
  },
  inputHintText: {
    marginTop: 6,
    fontSize: 12,
    color: "#64748b",
    lineHeight: 1.45,
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
    wordBreak: "break-word",
    overflowWrap: "anywhere",
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
    wordBreak: "break-word",
    overflowWrap: "anywhere",
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
  partnerDownloadRow: {
    display: "flex",
    gap: 8,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  partnerDownloadButtonActive: {
    background: "#eef4ff",
    borderColor: "#bcd0ff",
    color: "#2d4ea1",
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


