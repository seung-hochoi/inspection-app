import React, { useMemo, useState } from "react";

const colors = {
  bg: "linear-gradient(180deg, #f7faff 0%, #edf3fb 100%)",
  card: "#ffffff",
  border: "#d8e2ef",
  text: "#15253e",
  muted: "#708095",
  blue: "#1473ff",
  blueSoft: "#edf4ff",
  green: "#24a148",
  orange: "#f59e0b",
  red: "#e44747",
  purple: "#8c63dd",
  shadow: "0 14px 30px rgba(41, 73, 129, 0.08)",
};

const topSteps = [
  { key: "csv", label: "CSV 업로드" },
  { key: "happycall", label: "해피콜 업로드" },
  { key: "inspection", label: "검품입력" },
  { key: "records", label: "내역조회" },
  { key: "analytics", label: "통계" },
  { key: "summary", label: "계산" },
];

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M4 20h16" />
    </svg>
  );
}

function CsvIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v5h5" />
      <path d="M8 13h8" />
      <path d="M8 17h8" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="3" width="8" height="4" rx="1.5" />
      <path d="M8 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20v-4" />
    </svg>
  );
}

function CalculatorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 12h2" />
      <path d="M14 12h2" />
      <path d="M8 16h2" />
      <path d="M14 16h2" />
    </svg>
  );
}

function BarcodeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 5v14" />
      <path d="M8 7v10" />
      <path d="M11 5v14" />
      <path d="M14 7v10" />
      <path d="M18 5v14" />
      <path d="M21 7v10" />
    </svg>
  );
}

function StepIcon({ type }) {
  if (type === "csv") return <CsvIcon />;
  if (type === "happycall") return <UploadIcon />;
  if (type === "inspection") return <ClipboardIcon />;
  if (type === "records") return <SearchIcon />;
  if (type === "analytics") return <ChartIcon />;
  return <CalculatorIcon />;
}

function parseQty(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatCount(value) {
  return `${parseQty(value).toLocaleString("ko-KR")}건`;
}

function buildRecordCards(historyRows) {
  const map = new Map();
  (historyRows || []).forEach((record, index) => {
    const productName = String(record.productName || "상품명 없음");
    const productCode = String(record.productCode || "");
    const partnerName = String(record.partnerName || "협력사 없음");
    const time = String(record.createdAt || "");
    const key = `${partnerName}||${productCode}`;
    const current = map.get(key) || {
      id: key || `record-${index}`,
      name: productName,
      code: productCode,
      supplier: partnerName,
      inspectionQty: 0,
      returnQty: 0,
      exchangeQty: 0,
      latestTime: time,
    };
    current.inspectionQty = Math.max(current.inspectionQty, parseQty(record.inspectionQty));
    current.returnQty = Math.max(current.returnQty, parseQty(record.returnQty));
    current.exchangeQty = Math.max(current.exchangeQty, parseQty(record.exchangeQty));
    if (time && (!current.latestTime || time > current.latestTime)) current.latestTime = time;
    map.set(key, current);
  });
  return Array.from(map.values()).sort((a, b) => a.supplier.localeCompare(b.supplier, "ko"));
}

function KpiCard({ title, value, sub, tone }) {
  const toneMap = {
    blue: { bg: "#eef6ff", color: colors.blue },
    green: { bg: "#eff8ef", color: colors.green },
    orange: { bg: "#fff8e8", color: colors.orange },
    purple: { bg: "#f6f0ff", color: colors.purple },
    red: { bg: "#fff2f2", color: colors.red },
  };
  const current = toneMap[tone] || toneMap.blue;
  return (
    <div style={{ minHeight: 112, borderRadius: 16, border: `1px solid ${colors.border}`, background: current.bg, padding: "18px 18px 16px", display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: colors.muted, marginBottom: 12 }}>{title}</div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div style={{ fontSize: 36, lineHeight: 1, fontWeight: 900, color: current.color }}>{value}</div>
        {sub ? <div style={{ marginTop: 8, fontSize: 15, fontWeight: 700, color: current.color }}>{sub}</div> : null}
      </div>
    </div>
  );
}

function StatBox({ label, value, tone }) {
  const toneMap = {
    blue: { border: "#8bb8ff", bg: "#f4f9ff", color: colors.blue },
    neutral: { border: colors.border, bg: "#fff", color: colors.text },
    red: { border: "#ffb8b8", bg: "#fff6f6", color: colors.red },
  };
  const current = toneMap[tone] || toneMap.neutral;
  return (
    <div style={{ border: `1px solid ${current.border}`, borderRadius: 14, background: current.bg, padding: "14px 10px", textAlign: "center" }}>
      <div style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: current.color }}>{value}</div>
    </div>
  );
}

const zipButtonStyle = {
  height: 44,
  borderRadius: 12,
  border: `1px solid ${colors.border}`,
  background: "#fff",
  color: colors.text,
  fontSize: 14,
  fontWeight: 700,
};

export default function ReferenceFunctionalApp(props) {
  const {
    activeTab,
    onTabChange,
    onCsvUploadClick,
    onHappycallUploadClick,
    onOpenSheet,
    onSummaryAction,
    sheetUrl,
    uploadingCsv,
    uploadingHappycallCsv,
    currentFileName,
    happycallFileName,
    message,
    error,
    search,
    onSearchChange,
    onScannerOpen,
    onRefreshRecords,
    onFlushPending,
    groupedPartners,
    expandedPartner,
    onTogglePartner,
    renderProductRow,
    saveQueueItems,
    totalVisibleProducts,
    historyRows,
    historyLoading,
    renderRecordsView,
    analyticsKpis,
    selectedHappycallPeriod,
    onSelectPeriod,
    happycallHeroCard,
    happycallMiniCards,
    onDownloadInspectionZip,
    onDownloadReturnZip,
    onDownloadSugarZip,
    onDownloadWeightZip,
    zipDownloading,
    zipFiles,
    isSavingAny,
    cumulativeReturnQty,
    cumulativeExchangeQty,
    onManualRecalc,
    statusPanelOpen,
    onToggleStatusPanel,
    statusMeta,
    currentJob,
  } = props;

  const [selectedRecordId, setSelectedRecordId] = useState("");
  const recordCards = useMemo(() => buildRecordCards(historyRows), [historyRows]);
  const selectedRecord = useMemo(
    () => recordCards.find((item) => item.id === selectedRecordId) || recordCards[0] || null,
    [recordCards, selectedRecordId]
  );

  const isBusy = uploadingCsv || uploadingHappycallCsv || !!isSavingAny;
  const statusText = error || message || "";

  const activeTop = (key) => {
    if (key === "inspection") return activeTab === "inspection";
    if (key === "records") return activeTab === "records";
    if (key === "analytics" || key === "summary") return activeTab === "analytics";
    return false;
  };

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, padding: 16, color: colors.text }}>
      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        {/* ── Header card ── */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 18, padding: "15px 18px 14px", boxShadow: colors.shadow, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>GS25 검품시스템</h1>
              <a href={sheetUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", height: 26, padding: "0 12px", borderRadius: 999, background: "#dff4dc", color: "#4f8f4b", textDecoration: "none", fontSize: 12, fontWeight: 700 }}>워크시트 링크</a>
              <button
                type="button"
                onClick={onToggleStatusPanel}
                style={{ height: 26, padding: "0 10px", borderRadius: 8, border: `1px solid ${colors.border}`, background: "#f8fafc", fontSize: 12, fontWeight: 700, color: colors.muted, cursor: "pointer", marginLeft: "auto" }}
              >
                {statusPanelOpen ? "상태 접기" : "상태 펼치기"}
              </button>
            </div>
            {/* ── Status panel (inline in header) ── */}
            {statusPanelOpen ? (
              <div style={{ marginBottom: 8, padding: "8px 12px", borderRadius: 12, background: error ? "#fff6f6" : "#f7faff", border: `1px solid ${error ? "#f2b8b8" : colors.border}` }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", marginBottom: (isBusy || statusText) ? 6 : 0 }}>
                  {currentFileName ? (
                    <span style={{ fontSize: 11, color: colors.muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={currentFileName}>
                      CSV: {currentFileName}
                    </span>
                  ) : null}
                  {happycallFileName ? (
                    <span style={{ fontSize: 11, color: colors.muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={happycallFileName}>
                      해피콜: {happycallFileName}
                    </span>
                  ) : null}
                  {currentJob?.job_key ? (
                    <span style={{ fontSize: 11, color: colors.muted }}>JOB: {currentJob.job_key}</span>
                  ) : null}
                  {statusMeta?.lastActionAt ? (
                    <span style={{ fontSize: 11, color: colors.muted }}>최근: {new Date(statusMeta.lastActionAt).toLocaleTimeString("ko-KR")}</span>
                  ) : null}
                  {statusMeta?.restored ? (
                    <span style={{ fontSize: 11, color: colors.green, fontWeight: 700 }}>복원됨</span>
                  ) : null}
                </div>
                {(isBusy || statusText) ? (
                  <>
                    <div style={{ height: 6, borderRadius: 999, background: "#edf2f8", overflow: "hidden", marginBottom: 4 }}>
                      <div style={{ width: isBusy ? "45%" : "100%", height: "100%", borderRadius: 999, background: error ? "#f08c8c" : "linear-gradient(90deg, #2f6df6 0%, #68a4ff 100%)", transition: "width 0.3s" }} />
                    </div>
                    <div style={{ fontSize: 12, color: error ? colors.red : colors.muted, fontWeight: error ? 700 : 400 }}>{statusText}</div>
                  </>
                ) : null}
              </div>
            ) : (
              // Collapsed: show file names inline
              (currentFileName || happycallFileName) ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                  {currentFileName ? (
                    <span style={{ fontSize: 11, color: colors.muted, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: `1px solid ${colors.border}`, borderRadius: 6, padding: "2px 8px", background: "#f8fbff" }} title={currentFileName}>
                      CSV: {currentFileName}
                    </span>
                  ) : null}
                  {happycallFileName ? (
                    <span style={{ fontSize: 11, color: colors.muted, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: `1px solid ${colors.border}`, borderRadius: 6, padding: "2px 8px", background: "#f8fbff" }} title={happycallFileName}>
                      해피콜: {happycallFileName}
                    </span>
                  ) : null}
                </div>
              ) : null
            )}
            <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>MADE BY SEUNG-HO</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            {topSteps.map((item, index) => (
              <React.Fragment key={item.key}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.key === "csv") onCsvUploadClick();
                    else if (item.key === "happycall") onHappycallUploadClick();
                    else if (item.key === "summary") onSummaryAction();
                    else if (item.key === "inspection" || item.key === "records" || item.key === "analytics") onTabChange(item.key);
                    else onOpenSheet();
                  }}
                  style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", color: colors.text }}
                >
                  <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
                    <div style={{ width: 54, height: 54, borderRadius: 14, border: `1px solid ${activeTop(item.key) ? "#a9ccff" : colors.border}`, background: activeTop(item.key) ? colors.blueSoft : "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: activeTop(item.key) ? colors.blue : "#7f8ea5" }}>
                      <StepIcon type={item.key} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, textAlign: "center", lineHeight: 1.3 }}>{item.label}</span>
                  </div>
                </button>
                {index < topSteps.length - 1 ? <span style={{ color: "#9eb0c8", fontWeight: 800 }}>→</span> : null}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 18, padding: 12, boxShadow: colors.shadow, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              ["inspection", "1", "검품", "(입력용)"],
              ["records", "2", "내역", "(조회용)"],
              ["analytics", "3", "통계", ""],
            ].map(([key, num, label, sub]) => (
              <button key={key} type="button" onClick={() => onTabChange(key)} style={{ height: 40, padding: "0 16px", borderRadius: 12, border: activeTab === key ? "1px solid #111827" : "1px solid transparent", background: activeTab === key ? colors.blueSoft : "transparent", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: activeTab === key ? colors.blue : colors.text, cursor: "pointer" }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", background: activeTab === key ? colors.blue : "#eef2f7", color: activeTab === key ? "#fff" : "#7d8ea3", fontSize: 12, fontWeight: 800 }}>{num}</span>
                <span>{label}</span>
                {sub ? <span style={{ color: colors.muted, fontWeight: 600 }}>{sub}</span> : null}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "inspection" ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>검품 목록</h2>
              <div style={{ display: "flex", gap: 10 }}>
                {(cumulativeExchangeQty > 0 || cumulativeReturnQty > 0) ? (
                  <>
                    <span style={{ fontSize: 12, color: "#e44747", fontWeight: 700 }}>교환 (누적 {cumulativeExchangeQty}개)</span>
                    <span style={{ fontSize: 12, color: "#708095", fontWeight: 700 }}>회송 (누적 {cumulativeReturnQty}개)</span>
                  </>
                ) : null}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 14, boxShadow: colors.shadow }}>
              <div style={{ height: 42, display: "flex", alignItems: "center", gap: 10, borderRadius: 12, background: "#f3f6fa", border: `1px solid ${colors.border}`, padding: "0 14px" }}>
                <SearchIcon />
                <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="상품명/바코드 검색..." style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14 }} />
              </div>
              <button type="button" onClick={onScannerOpen} style={{ height: 40, padding: "0 16px", borderRadius: 12, border: "1px solid #9ec4ff", background: "#fff", color: colors.blue, fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}><BarcodeIcon />바코드 스캔</button>
              <button type="button" onClick={onFlushPending} style={{ height: 40, padding: "0 18px", borderRadius: 12, border: "none", background: colors.blue, color: "#fff", fontSize: 14, fontWeight: 800 }}>저장(일괄)</button>
            </div>
            {groupedPartners.length === 0 ? <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 24, boxShadow: colors.shadow }}>표시할 상품이 없습니다.</div> : null}
            {groupedPartners.map((group) => (
              <div key={group.partner} style={{ border: `1px solid ${colors.border}`, borderRadius: 18, overflow: "hidden", background: "#fff", boxShadow: colors.shadow }}>
                <button type="button" onClick={() => onTogglePartner(group.partner)} style={{ width: "100%", border: "none", background: "linear-gradient(180deg, #f7fbff 0%, #f5fbff 100%)", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: colors.muted }}>{expandedPartner === group.partner ? "∨" : ">"}</span>
                    <span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: colors.blueSoft, color: colors.blue, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 700 }}>{group.partner}</span>
                    <span style={{ color: colors.muted, fontSize: 13, fontWeight: 700 }}>({group.products.length})</span>
                  </div>
                  <span style={{ fontSize: 12, color: colors.muted }}>{group.products.length ? "진행 중" : "대기"}</span>
                </button>
                {expandedPartner === group.partner ? <div style={{ padding: 12, display: "grid", gap: 12 }}>{group.products.map((product) => renderProductRow(group, product, "web"))}</div> : null}
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, background: "linear-gradient(180deg, #e7f7f4 0%, #eaf8f8 100%)", border: `1px solid ${colors.border}`, borderRadius: 18, padding: "12px 16px", boxShadow: colors.shadow, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, color: colors.muted }}>검품SKU</span>
                <span style={{ height: 30, padding: "0 12px", borderRadius: 10, background: "#f1f4f8", display: "inline-flex", alignItems: "center", fontSize: 13, fontWeight: 700 }}>{`전체 ${totalVisibleProducts}건`}</span>
                <span style={{ width: 1, height: 22, background: colors.border }} />
                <span style={{ fontSize: 14, color: colors.muted }}>저장 대기</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: colors.blue }}>{saveQueueItems.length}</span>
              </div>
              <div style={{ fontSize: 13, color: colors.muted }}>실시간 저장 대기 상태 반영</div>
            </div>
          </div>
        ) : null}

        {activeTab === "records" && typeof renderRecordsView === "function" ? renderRecordsView() : null}

        {activeTab === "records" && typeof renderRecordsView !== "function" ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 14, boxShadow: colors.shadow }}>
              <div style={{ height: 42, display: "flex", alignItems: "center", gap: 10, borderRadius: 12, background: "#f3f6fa", border: `1px solid ${colors.border}`, padding: "0 14px" }}>
                <SearchIcon />
                <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="상품명/협력사 검색..." style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14 }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" onClick={onRefreshRecords} style={{ height: 40, padding: "0 14px", borderRadius: 12, border: `1px solid ${colors.border}`, background: "#fff", fontSize: 14, fontWeight: 700 }}>새로고침</button>
              </div>
            </div>
            {historyLoading ? <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 24, boxShadow: colors.shadow }}>내역을 불러오는 중입니다.</div> : null}
            {!historyLoading ? (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.46fr) 430px", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignContent: "start" }}>
                  {recordCards.map((card) => (
                    <button key={card.id} type="button" onClick={() => setSelectedRecordId(card.id)} style={{ border: selectedRecord?.id === card.id ? "1px solid #b5cbed" : `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", padding: 12, textAlign: "left", boxShadow: colors.shadow, cursor: "pointer", minHeight: 156 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 5 }}>{card.name}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: colors.blueSoft, color: colors.blue, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 700 }}>{card.supplier}</span>
                          </div>
                        </div>
                        <span style={{ color: colors.muted, fontSize: 13, fontWeight: 700 }}>수정</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                        <span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: "#f6f8fb", color: colors.text, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 800 }}>검품 {card.inspectionQty}</span>
                        <span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: "#f6f8fb", color: colors.text, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 800 }}>회송 {card.returnQty}</span>
                        <span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: "#f6f8fb", color: colors.text, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 800 }}>교환 {card.exchangeQty}</span>
                      </div>
                      <div style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>코드 {card.code || "-"}</div>
                      <div style={{ fontSize: 13, color: colors.muted }}>{card.latestTime || "-"}</div>
                    </button>
                  ))}
                </div>
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", boxShadow: colors.shadow, padding: 16 }}>
                  {selectedRecord ? (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>← 목록으로</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ fontSize: 18, fontWeight: 800 }}>{selectedRecord.name}</div>
                          <span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: "#e8f6e8", color: colors.green, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 700 }}>{selectedRecord.supplier}</span>
                        </div>
                        <span style={{ color: colors.muted, fontSize: 13, fontWeight: 700 }}>수정</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 18 }}>
                        <StatBox label="검품수량" value={selectedRecord.inspectionQty} tone="blue" />
                        <StatBox label="회송수량" value={selectedRecord.returnQty} tone="neutral" />
                        <StatBox label="교환수량" value={selectedRecord.exchangeQty} tone="red" />
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>사진 관리</div>
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 14, padding: 12 }}>상품코드 {selectedRecord.code || "-"}</div>
                        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 14, padding: 12 }}>최근 수정 {selectedRecord.latestTime || "-"}</div>
                        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 14, padding: 12 }}>검품 내역 {recordCards.length}건</div>
                      </div>
                    </div>
                  ) : (
                    <div>선택된 내역이 없습니다.</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "analytics" ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", padding: 16, boxShadow: colors.shadow, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {analyticsKpis.map((item) => (
                      <KpiCard
                        key={item.label}
                        title={item.label}
                        value={item.value}
                        sub={item.subLabel || ""}
                        tone={
                          item.label.includes("불량")
                            ? "red"
                            : item.label.includes("검품")
                            ? "green"
                            : item.label.includes("SKU")
                            ? "purple"
                            : item.label.includes("율") || item.label.includes("률")
                            ? "orange"
                            : "blue"
                        }
                      />
                    ))}
                  </div>
                </div>
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", padding: 16, boxShadow: colors.shadow }}>
                  <button type="button" onClick={onSummaryAction} style={{ width: "100%", height: 50, borderRadius: 12, border: "none", background: colors.green, color: "#fff", fontSize: 16, fontWeight: 800, marginBottom: 12 }}>요약 계산</button>
                  <button type="button" onClick={onHappycallUploadClick} style={{ width: "100%", height: 50, borderRadius: 12, border: `1px solid ${colors.orange}`, background: "#fff", color: colors.orange, fontSize: 16, fontWeight: 800, marginBottom: 12 }}>해피콜 업로드</button>
                  <button type="button" onClick={onFlushPending} style={{ width: "100%", height: 50, borderRadius: 12, border: `1px solid ${colors.blue}`, background: "#fff", color: colors.blue, fontSize: 16, fontWeight: 800, marginBottom: 12 }}>저장(일괄)</button>
                  <button type="button" onClick={onManualRecalc} style={{ width: "100%", height: 50, borderRadius: 12, border: `1px solid ${colors.border}`, background: "#f8fafc", color: colors.muted, fontSize: 14, fontWeight: 800 }}>대시보드 재계산</button>
                </div>
              </div>
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", padding: 16, boxShadow: colors.shadow }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 16, fontWeight: 800 }}>ZIP 다운로드</span>
                    <span style={{ fontSize: 14, color: colors.muted }}>(20MB 분할)</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                    <button type="button" onClick={onDownloadInspectionZip} style={zipButtonStyle}>{zipDownloading === "inspection" ? "ZIP 생성 중..." : "검품사진 저장"}</button>
                    <button type="button" onClick={onDownloadReturnZip} style={zipButtonStyle}>{zipDownloading === "movement" ? "ZIP 생성 중..." : "불량사진 저장"}</button>
                    <button type="button" onClick={onDownloadSugarZip} style={zipButtonStyle}>{zipDownloading === "sugar" ? "ZIP 생성 중..." : "당도사진 저장"}</button>
                    <button type="button" onClick={onDownloadWeightZip} style={zipButtonStyle}>{zipDownloading === "weight" ? "ZIP 생성 중..." : "중량사진 저장"}</button>
                  </div>
                  {Array.isArray(zipFiles) && zipFiles.length > 0 ? (
                    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 16, padding: 16, background: "#fbfdff", marginTop: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>생성된 ZIP 파일</div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {zipFiles.map((file, idx) => {
                          const url = file.downloadUrl || file.driveUrl || file.url || "";
                          const name = file.name || file.fileName || `photo_${idx + 1}.zip`;
                          const size = file.size || file.fileSize || "";
                          return (
                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, border: `1px solid ${colors.border}`, background: "#fff" }}>
                              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }} title={name}>{name}</span>
                              {size ? <span style={{ fontSize: 12, color: colors.muted, flexShrink: 0 }}>{size}</span> : null}
                              {url ? (
                                <a href={url} target="_blank" rel="noreferrer" style={{ height: 30, padding: "0 12px", borderRadius: 8, border: `1px solid ${colors.blue}`, background: colors.blueSoft, color: colors.blue, fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", textDecoration: "none", flexShrink: 0 }}>다운로드</a>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ border: `1px dashed ${colors.border}`, borderRadius: 16, minHeight: 410, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, background: "#fbfdff", marginTop: 8 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>생성된 ZIP 파일이 없습니다.</div>
                      <div style={{ fontSize: 13, color: colors.muted, lineHeight: 1.7, maxWidth: 360 }}>
                        검품사진, 불량사진, 중량사진, 당도사진이 누적되면 다운로드 시점에 ZIP이 생성됩니다.
                        <br />
                        20MB를 초과하면 자동으로 분할 ZIP이 추가 생성됩니다.
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", padding: 16, boxShadow: colors.shadow }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 15, fontWeight: 800 }}>해피콜 TOP 상품</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      {[["1d", "일별"], ["7d", "주별"], ["30d", "월별"]].map(([key, label]) => (
                        <button key={key} type="button" onClick={() => onSelectPeriod(key)} style={{ height: 30, padding: "0 10px", borderRadius: 8, border: selectedHappycallPeriod === key ? "1px solid #a9ccff" : `1px solid ${colors.border}`, background: selectedHappycallPeriod === key ? colors.blueSoft : "#fff", color: selectedHappycallPeriod === key ? colors.blue : colors.muted, fontSize: 12, fontWeight: 700 }}>{label}</button>
                      ))}
                    </div>
                  </div>
                  {[happycallHeroCard, ...happycallMiniCards].filter(Boolean).length === 0 ? (
                    <div style={{ color: colors.muted, fontSize: 13, textAlign: "center", padding: "24px 0" }}>해피콜 데이터가 없습니다.<br />해피콜 CSV를 업로드해주세요.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {[happycallHeroCard, ...happycallMiniCards].filter(Boolean).map((entry) => {
                        const medalColor = entry.rank === 1 ? "#c9971a" : entry.rank === 2 ? "#73839b" : entry.rank === 3 ? "#ad6b3b" : colors.muted;
                        const medalBg = entry.rank === 1 ? "#fff4cf" : entry.rank === 2 ? "#eef3f8" : entry.rank === 3 ? "#f8eadf" : "#f8fafc";
                        return (
                          <div key={`top-${entry.rank}-${entry.productCode || entry.productName}`} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, background: entry.rank <= 3 ? medalBg : "#fbfdff", padding: "10px 14px", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ minWidth: 50, height: 26, padding: "0 8px", borderRadius: 999, background: entry.rank <= 3 ? medalBg : "#f0f4f8", color: medalColor, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12 }}>{`#${entry.rank}`}</span>
                            <span style={{ flex: 1 }}>{entry.productName}{entry.partnerName ? <span style={{ fontWeight: 600, color: colors.muted, fontSize: 12 }}> ({entry.partnerName})</span> : null}</span>
                            <span style={{ fontWeight: 800, color: entry.rank === 1 ? colors.red : colors.text }}>{formatCount(entry.count)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
