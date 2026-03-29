import { normalizeProductCode } from "./formatters";
import { normalizeHappycallLookupText } from "./helpers";

export const normalizeImageMapLookupText = (value) => normalizeHappycallLookupText(value || "");

export const makeProductImageMapKey = ({ productCode, partner, productName }) => {
  const code = normalizeProductCode(productCode || "");
  const partnerText = String(partner || "").trim();
  if (code || partnerText) {
    return `sku::${code}||${partnerText}`;
  }
  return `name::${normalizeImageMapLookupText(productName || "")}||${normalizeImageMapLookupText(partner || "")}`;
};

export const normalizeImageToken = (value) => normalizeHappycallLookupText(value || "");

export const buildImageMatcher = ({ partnerKeywords = [], productKeywords = [], excludeKeywords = [] }) => {
  const normalizedPartners = partnerKeywords.map(normalizeImageToken).filter(Boolean);
  const normalizedProducts = productKeywords.map(normalizeImageToken).filter(Boolean);
  const normalizedExcludes = excludeKeywords.map(normalizeImageToken).filter(Boolean);

  return (product) => {
    const partnerText = normalizeImageToken(product?.partner || "");
    const productText = normalizeImageToken(product?.productName || "");
    const lookupText = `${partnerText} ${productText}`;

    if (normalizedExcludes.some((keyword) => lookupText.includes(keyword))) return false;
    if (normalizedPartners.length && !normalizedPartners.some((keyword) => partnerText.includes(keyword))) {
      return false;
    }
    return normalizedProducts.every((keyword) => productText.includes(keyword));
  };
};

export const PRODUCT_IMAGE_MAP = [
  {
    match: buildImageMatcher({
      partnerKeywords: ["델몬트", "delmonte"],
      productKeywords: ["프리미엄", "바나나"],
      excludeKeywords: ["파인애플", "클래식", "킹사이즈"],
    }),
    src: "/assets/products/delmonte-banana-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["델몬트", "delmonte"],
      productKeywords: ["클래식", "바나나"],
      excludeKeywords: ["파인애플"],
    }),
    src: "/assets/products/delmonte-banana-pack.png",
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
      partnerKeywords: ["돌", "dole", "돌코리아"],
      productKeywords: ["스위티오", "바나나", "2입"],
      excludeKeywords: ["파인애플"],
    }),
    src: "/assets/products/dole-sweetio-banana-2.jpeg",
  },
  {
    match: buildImageMatcher({
      partnerKeywords: ["돌", "dole", "돌코리아"],
      productKeywords: ["스위티오", "바나나"],
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
    match: buildImageMatcher({
      productKeywords: ["오이맛고추"],
    }),
    src: "/assets/products/cucumber-spicy.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["청양고추"],
    }),
    src: "/assets/products/pepper-hot-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["매운고추"],
    }),
    src: "/assets/products/green-chili-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["오이"],
      excludeKeywords: ["오이맛고추"],
    }),
    src: "/assets/products/cucumber-plain.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["애호박"],
    }),
    src: "/assets/products/aehobak-single.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["마늘"],
    }),
    src: "/assets/products/garlic-bowl.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["양파"],
    }),
    src: "/assets/products/onion-single.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["새송이버섯"],
    }),
    src: "/assets/products/mushroom-king-oyster.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["참타리버섯"],
    }),
    src: "/assets/products/mushroom-oyster-cluster.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["팽이버섯"],
    }),
    src: "/assets/products/enoki-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["꽃상추"],
    }),
    src: "/assets/products/red-lettuce-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["상추"],
      excludeKeywords: ["꽃상추", "청상추"],
    }),
    src: "/assets/products/lettuce-green.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["부추"],
    }),
    src: "/assets/products/chives-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["시금치"],
    }),
    src: "/assets/products/spinach-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["깻잎"],
      excludeKeywords: ["유기농"],
    }),
    src: "/assets/products/perilla-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["깻잎", "유기농"],
    }),
    src: "/assets/products/perilla-organic.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["참나물"],
    }),
    src: "/assets/products/chamnamul-bag.jpeg",
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
      productKeywords: ["고구마"],
    }),
    src: "/assets/products/sweetpotato-pink-bag.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["연어"],
    }),
    src: "/assets/products/salmon-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["목심"],
    }),
    src: "/assets/products/pork-neck-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["삼겹", "오겹"],
    }),
    src: "/assets/products/pork-belly-pack.jpeg",
  },
  {
    match: buildImageMatcher({
      productKeywords: ["바나나"],
    }),
    src: "/assets/products/banana-generic.jpeg",
  },
];

export const getProductImageSrc = (product, customImageMap = {}) => {
  const productText = normalizeImageToken(product?.productName || "");
  if (!productText) return "";
  if (productText.includes(normalizeImageToken("미분류상품"))) return "";

  const customKey = makeProductImageMapKey({
    productCode: product?.productCode || "",
    partner: product?.partner || "",
    productName: product?.productName || "",
  });

  if (customKey && customImageMap[customKey]) return customImageMap[customKey];
  const matched = PRODUCT_IMAGE_MAP.find((entry) => entry.match(product || {}));
  return matched?.src || "";
};
