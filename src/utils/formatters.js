export const normalizeProductCode = (value) => {
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

export const parseQty = (value) => {
  const num = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isNaN(num) ? 0 : num;
};

export const clampText = (value, maxLength = 4000) => {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 7))}...(생략)`;
};

export const formatPercent = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : "-";
};

export const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ko-KR");
};

export const formatDashboardValue = (label, value) => {
  if (value == null || value === "") return "-";

  const labelText = String(label || "");
  if (labelText.includes("률") || labelText.includes("비중") || labelText.includes("불량률")) {
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

export const formatDateForFileName = () => new Date().toLocaleDateString("sv-SE");
