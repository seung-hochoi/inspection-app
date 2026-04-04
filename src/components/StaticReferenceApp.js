import React, { useEffect, useMemo, useRef, useState } from "react";

const colors = {
  bg: "linear-gradient(180deg, #f7faff 0%, #edf3fb 100%)",
  card: "#ffffff",
  border: "#d8e2ef",
  borderStrong: "#c5d4e6",
  text: "#15253e",
  muted: "#708095",
  blue: "#1473ff",
  blueSoft: "#edf4ff",
  green: "#24a148",
  greenSoft: "#eef9ef",
  orange: "#f59e0b",
  orangeSoft: "#fff6e4",
  red: "#e44747",
  redSoft: "#fff2f2",
  purple: "#8c63dd",
  purpleSoft: "#f3edff",
  shadow: "0 14px 30px rgba(41, 73, 129, 0.08)",
};

const inspectionGroups = [
  {
    supplier: "농협",
    total: "3/3",
    complete: true,
    items: [
      { name: "애호박", code: "A1001", orderQty: 50, exchangeQty: "", returnQty: "", inspectionQty: 30, photoReady: true },
      { name: "완숙토마토", code: "A1002", orderQty: 40, exchangeQty: "", returnQty: "", inspectionQty: 25, photoReady: true },
      { name: "양배추", code: "A1003", orderQty: 60, exchangeQty: "", returnQty: "", inspectionQty: 60, photoReady: false },
    ],
  },
  {
    supplier: "남도농산",
    total: "2/2",
    complete: true,
    items: [
      { name: "감자", code: "B2001", orderQty: 100, exchangeQty: "", returnQty: "", inspectionQty: 80, photoReady: true },
      { name: "당근", code: "B2002", orderQty: 70, exchangeQty: "", returnQty: "", inspectionQty: 70, photoReady: true },
    ],
  },
  {
    supplier: "한우마을",
    total: "0/1",
    complete: false,
    items: [{ name: "한우 등심 600g", code: "D4001", orderQty: 30, exchangeQty: "", returnQty: "", inspectionQty: 0, photoReady: false }],
  },
  {
    supplier: "바다수산",
    total: "0/1",
    complete: false,
    items: [{ name: "노르웨이 연어 500g", code: "E5001", orderQty: 40, exchangeQty: "", returnQty: "", inspectionQty: 0, photoReady: false }],
  },
];

const recordCards = [
  { id: "aehobak", name: "애호박", supplier: "농협", eventLabel: "1+1행사", topLabel: "TOP3", inspectionQty: 30, returnQty: 2, exchangeQty: 1, time: "2024.04.24 10:30", tags: ["검품(3)", "불량(1)", "중량(4)", "당도(0)"] },
  { id: "tomato", name: "완숙토마토", supplier: "농협", eventLabel: "", topLabel: "TOP2", inspectionQty: 25, returnQty: 1, exchangeQty: 0, time: "2024.04.23 16:10", tags: ["검품(4)", "불량(2)", "중량(4)", "당도(2)"] },
  { id: "potato", name: "감자", supplier: "남도농산", eventLabel: "행사", topLabel: "", inspectionQty: 80, returnQty: 0, exchangeQty: 0, time: "2024.04.24 09:20", tags: ["검품(2)", "불량(0)", "중량(4)", "당도(1)"] },
  { id: "carrot", name: "당근", supplier: "남도농산", eventLabel: "", topLabel: "", inspectionQty: 70, returnQty: 0, exchangeQty: 0, time: "2024.04.23 11:40", tags: ["검품(2)", "불량(0)", "중량(4)", "당도(1)"] },
];

const happycallTop = {
  daily: [
    { rank: 1, label: "프리미엄바나나(델몬트)", count: 10 },
    { rank: 2, label: "클래식바나나(델몬트)", count: 8 },
    { rank: 3, label: "애호박(농협)", count: 7 },
    { rank: 4, label: "감자(남도농산)", count: 5 },
    { rank: 5, label: "완숙토마토(농협)", count: 4 },
  ],
  weekly: [
    { rank: 1, label: "프리미엄바나나(델몬트)", count: 100 },
    { rank: 2, label: "클래식바나나(델몬트)", count: 82 },
    { rank: 3, label: "애호박(농협)", count: 76 },
    { rank: 4, label: "감자(남도농산)", count: 54 },
    { rank: 5, label: "완숙토마토(농협)", count: 41 },
  ],
  monthly: [
    { rank: 1, label: "프리미엄바나나(델몬트)", count: 320 },
    { rank: 2, label: "클래식바나나(델몬트)", count: 286 },
    { rank: 3, label: "애호박(농협)", count: 241 },
    { rank: 4, label: "감자(남도농산)", count: 198 },
    { rank: 5, label: "완숙토마토(농협)", count: 164 },
  ],
};

const zipFiles = [
  ["검품상품_1.zip", "19.8MB"],
  ["검품상품_2.zip", "19.7MB"],
  ["불량상품_1.zip", "8.2MB"],
  ["불량상품_2.zip", "7.1MB"],
  ["중량사진_1.zip", "11.4MB"],
  ["중량사진_2.zip", "9.8MB"],
  ["당도사진_1.zip", "6.3MB"],
  ["당도사진_2.zip", "5.4MB"],
];

const menuItemStyle = {
  height: 36,
  borderRadius: 10,
  border: "none",
  background: "#fff",
  textAlign: "left",
  padding: "0 10px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const topStepButtons = [
  { key: "csv", label: "CSV 업로드", action: "csv" },
  { key: "local", label: "로컬 데이터 생성", action: "inspection" },
  { key: "inspection", label: "검품 입력", action: "inspection" },
  { key: "server", label: "서버 Batch 저장", action: "records" },
  { key: "sheet", label: "Sheets 기록", action: "sheet" },
  { key: "summary", label: "요약 계산", action: "analytics" },
];

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function BarcodeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 5v14" />
      <path d="M8 7v10" />
      <path d="M11 5v14" />
      <path d="M14 7v10" />
      <path d="M18 5v14" />
      <path d="M21 7v10" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 19 5 8h6l2 2h8l-2 9H3Z" />
      <path d="M5 8V6h5l2 2" />
    </svg>
  );
}

function FolderClosedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10Z" />
    </svg>
  );
}

function FilterListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 7h16" />
      <path d="M7 12h10" />
      <path d="M10 17h4" />
    </svg>
  );
}

function ImageOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 3 18 18" />
      <path d="M10 10h.01" />
      <path d="M6.5 6H18a2 2 0 0 1 2 2v9.5" />
      <path d="M4 8v10a2 2 0 0 0 2 2h12" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l1.5-2h7L17 8h3v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 20 9-9-3-3-9 9-1 4 4-1Z" />
      <path d="m15 8 3 3" />
    </svg>
  );
}

function HeaderIcon({ type, active }) {
  const color = active ? colors.blue : "#7f8ea5";
  const bg = active ? colors.blueSoft : "#fff";
  return (
    <div style={{ width: 54, height: 54, borderRadius: 14, border: `1px solid ${active ? "#a9ccff" : colors.border}`, background: bg, display: "flex", alignItems: "center", justifyContent: "center", color }}>
      {type === "csv" ? <FolderOpenIcon /> : null}
      {type === "local" ? <FolderClosedIcon /> : null}
      {type === "inspection" ? <CameraIcon /> : null}
      {type === "server" ? <FilterListIcon /> : null}
      {type === "sheet" ? <SearchIcon /> : null}
      {type === "summary" ? <BarcodeIcon /> : null}
    </div>
  );
}

function SectionTitle({ title }) {
  return <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{title}</h2>;
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
    <div style={{ minHeight: 106, borderRadius: 16, border: `1px solid ${colors.border}`, background: current.bg, padding: "18px 18px 16px", display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: colors.muted, marginBottom: 14 }}>{title}</div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div style={{ fontSize: 34, lineHeight: 1, fontWeight: 900, color: current.color }}>{value}</div>
        {sub ? <div style={{ marginTop: 8, fontSize: 15, fontWeight: 700, color: current.color }}>{sub}</div> : null}
      </div>
    </div>
  );
}

function StatBox({ label, value, tone }) {
  const toneMap = {
    blue: { border: "#8bb8ff", bg: "#f4f9ff", color: colors.blue },
    neutral: { border: colors.borderStrong, bg: "#fff", color: colors.text },
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

function PhotoManageCard({ title, danger = false }) {
  return (
    <div style={{ border: `1px solid ${danger ? "#f1b8bd" : colors.border}`, borderRadius: 16, padding: 12, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 800 }}>{title}</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>+ 사진추가</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: 10, background: "#eff2f5", border: `1px solid ${colors.border}` }}>
            <span style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: 999, background: "#d91f35", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>×</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrixCard() {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 16, padding: 12, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 800 }}>당도 (브릭스)</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>+ 사진추가</span>
      </div>
      {["최저값", "최고값"].map((label) => (
        <div key={label} style={{ display: "grid", gridTemplateColumns: "56px 1fr 34px", gap: 10, alignItems: "center", marginTop: 10 }}>
          <span style={{ fontSize: 13, color: colors.muted }}>{label}</span>
          <div style={{ height: 32, borderRadius: 10, border: `1px solid ${colors.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>0.0</div>
          <span style={{ fontSize: 13, color: colors.muted }}>°Bx</span>
        </div>
      ))}
    </div>
  );
}

function StaticInput({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>{label}</div>
      <div style={{ height: 36, borderRadius: 10, border: `1px solid ${colors.border}`, background: "#fff", padding: "0 12px", display: "flex", alignItems: "center", fontSize: 14, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function ProductThumb({ text = "GS25" }) {
  return (
    <div style={{ width: 46, height: 46, borderRadius: 12, border: `1px solid ${colors.border}`, background: "#f7fafb", display: "flex", alignItems: "center", justifyContent: "center", color: colors.blue, fontSize: 11, fontWeight: 800 }}>{text}</div>
  );
}

export default function StaticReferenceApp({ activeTab, onTabChange, sheetUrl }) {
  const fileRef = useRef(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [range, setRange] = useState("daily");
  const [selectedRecordId, setSelectedRecordId] = useState("aehobak");
  const [isDesktop, setIsDesktop] = useState(() => (typeof window === "undefined" ? true : window.innerWidth >= 1100));

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1100);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const selectedRecord = useMemo(() => recordCards.find((item) => item.id === selectedRecordId) || recordCards[0], [selectedRecordId]);

  const runTopAction = (action) => {
    if (action === "csv") {
      fileRef.current?.click();
      return;
    }
    if (action === "sheet") {
      window.open(sheetUrl, "_blank", "noopener,noreferrer");
      return;
    }
    onTabChange(action);
  };

  const tabButton = (key, num, label, sub = "") => (
    <button key={key} type="button" onClick={() => onTabChange(key)} style={{ height: 40, padding: "0 16px", borderRadius: 12, border: activeTab === key ? "1px solid #a9ccff" : "1px solid transparent", background: activeTab === key ? colors.blueSoft : "transparent", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: activeTab === key ? colors.blue : colors.text, cursor: "pointer" }}>
      <span style={{ width: 22, height: 22, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", background: activeTab === key ? colors.blue : "#eef2f7", color: activeTab === key ? "#fff" : "#7d8ea3", fontSize: 12, fontWeight: 800 }}>{num}</span>
      <span>{label}</span>
      {sub ? <span style={{ color: colors.muted, fontWeight: 600 }}>{sub}</span> : null}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, padding: isDesktop ? 16 : 10, width: isDesktop ? "min(1520px, calc(100vw - 32px))" : "calc(100vw - 12px)", margin: "0 auto", color: colors.text, fontFamily: '"Pretendard", sans-serif', boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 24, background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 18, padding: "15px 18px 14px", boxShadow: colors.shadow, marginBottom: 12, flexWrap: isDesktop ? "nowrap" : "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>GS25 검품</h1>
            <a href={sheetUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", height: 26, padding: "0 12px", borderRadius: 999, background: "#dff4dc", color: "#4f8f4b", textDecoration: "none", fontSize: 12, fontWeight: 700 }}>워크시트 링크</a>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>MADE IN SEUNG-HO</p>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {topStepButtons.map((item, index) => {
            const active = (item.action === "inspection" && activeTab === "inspection") || (item.action === "records" && activeTab === "records") || (item.action === "analytics" && activeTab === "analytics");
            return (
              <React.Fragment key={item.key}>
                <button type="button" onClick={() => runTopAction(item.action)} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", color: colors.text }}>
                  <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
                    <HeaderIcon type={item.key} active={active} />
                    <span style={{ fontSize: 12, fontWeight: 700, textAlign: "center", lineHeight: 1.3 }}>{item.label}</span>
                  </div>
                </button>
                {index < topStepButtons.length - 1 ? <span style={{ color: "#9eb0c8", fontWeight: 800, marginTop: -10 }}>→</span> : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 12, boxShadow: colors.shadow, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {tabButton("inspection", "1", "검품", "(입력용)")}
          {tabButton("records", "2", "내역", "(조회용)")}
          {tabButton("analytics", "3", "통계")}
        </div>
      </div>
      {activeTab === "inspection" ? (
        <div style={{ display: "grid", gap: 14 }}>
          <SectionTitle title="검품 목록" />
          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr auto" : "1fr", gap: 12, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 14, boxShadow: colors.shadow }}>
            <div style={{ height: 42, display: "flex", alignItems: "center", gap: 10, borderRadius: 12, background: "#f3f6fa", border: `1px solid ${colors.border}`, padding: "0 14px" }}><SearchIcon /><input readOnly placeholder="상품명/바코드 검색..." style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14 }} /></div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={{ height: 40, padding: "0 16px", borderRadius: 12, border: "1px solid #9ec4ff", background: "#fff", color: colors.blue, fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}><BarcodeIcon />바코드 스캔</button>
              <div style={{ position: "relative" }}>
                <button type="button" onClick={() => setSortOpen((prev) => !prev)} style={{ height: 40, padding: "0 14px", borderRadius: 12, border: `1px solid ${colors.borderStrong}`, background: "#fff", color: colors.text, fontSize: 14, fontWeight: 700 }}>협력사별 정렬 ▾</button>
                {sortOpen ? <div style={{ position: "absolute", top: 46, left: 0, width: 164, borderRadius: 14, border: `1px solid ${colors.border}`, background: "#fff", boxShadow: colors.shadow, padding: 8, display: "grid", gap: 4, zIndex: 10 }}><button type="button" style={menuItemStyle}>전체</button><button type="button" style={menuItemStyle}>미입력만</button><button type="button" style={menuItemStyle}>사진 없음</button></div> : null}
              </div>
              <button type="button" style={{ height: 40, padding: "0 18px", borderRadius: 12, border: "none", background: colors.blue, color: "#fff", fontSize: 14, fontWeight: 800 }}>저장(일괄)</button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 12, boxShadow: colors.shadow, flexWrap: "wrap" }}>
            <button type="button" style={{ height: 36, padding: "0 14px", borderRadius: 11, border: `1px solid ${colors.borderStrong}`, background: "#fff", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}><FolderOpenIcon />전체 펼치기</button>
            <button type="button" style={{ height: 36, padding: "0 14px", borderRadius: 11, border: `1px solid ${colors.borderStrong}`, background: "#fff", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}><FolderClosedIcon />전체 접기</button>
            <div style={{ width: 1, height: 20, background: colors.borderStrong }} />
            <button type="button" style={{ height: 36, padding: "0 14px", borderRadius: 11, border: `1px solid ${colors.borderStrong}`, background: "#fff", fontSize: 13, fontWeight: 700 }}>전체</button>
            <button type="button" style={{ height: 36, padding: "0 14px", borderRadius: 11, border: `1px solid ${colors.borderStrong}`, background: "#fff", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}><FilterListIcon />미입력만</button>
            <button type="button" style={{ height: 36, padding: "0 14px", borderRadius: 11, border: `1px solid ${colors.borderStrong}`, background: "#fff", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}><ImageOffIcon />사진 없음</button>
          </div>
          {inspectionGroups.map((group) => (
            <div key={group.supplier} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, boxShadow: colors.shadow, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "linear-gradient(180deg, #f7fbff 0%, #f5fbff 100%)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ color: colors.muted }}>⌄</span><span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: colors.blueSoft, color: colors.blue, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 700 }}>{group.supplier}</span><span style={{ color: colors.muted, fontSize: 13, fontWeight: 700 }}>({group.total})</span></div>
                {group.complete ? <span style={{ height: 26, minWidth: 48, padding: "0 12px", borderRadius: 999, background: colors.greenSoft, color: colors.green, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>완료</span> : null}
              </div>
              {isDesktop ? (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "58px 1.7fr 1fr .9fr .9fr .9fr 1fr 1fr", gap: 18, padding: "10px 16px", fontSize: 12, fontWeight: 700, color: "#8091a8" }}><span /><span>상품명</span><span>상품코드</span><span>발주수량</span><span>교환수량</span><span>회송수량</span><span>검품수량</span><span>사진</span></div>
                  {group.items.map((item) => (
                    <div key={item.code} style={{ display: "grid", gridTemplateColumns: "58px 1.7fr 1fr .9fr .9fr .9fr 1fr 1fr", gap: 18, alignItems: "center", padding: "12px 16px", borderTop: `1px solid ${colors.border}`, background: group.complete ? "#f7fff5" : "#fff" }}>
                      <ProductThumb />
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#239e3f" }}>{item.name}</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#5c6e85" }}>{item.code}</div>
                      <div style={{ height: 40, borderRadius: 10, border: "1px solid #d7e2f0", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 800 }}>{item.orderQty}</div>
                      <div style={{ height: 40, borderRadius: 10, border: "1px solid #d7e2f0", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: colors.muted, fontSize: 16, fontWeight: 700 }}>{item.exchangeQty}</div>
                      <div style={{ height: 40, borderRadius: 10, border: "1px solid #d7e2f0", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: colors.muted, fontSize: 16, fontWeight: 700 }}>{item.returnQty}</div>
                      <div style={{ height: 40, borderRadius: 10, border: item.inspectionQty ? "1px solid #9ad79e" : "1px solid #a7caff", background: item.inspectionQty ? "#ecfaed" : "#f7fbff", display: "flex", alignItems: "center", justifyContent: "center", color: item.inspectionQty ? colors.green : colors.blue, fontSize: 17, fontWeight: 800 }}>{item.inspectionQty}</div>
                      <button type="button" style={{ height: 40, borderRadius: 10, border: item.photoReady ? "1px solid #97d39c" : "1px solid #9fc5ff", background: item.photoReady ? "#eefbef" : "#f7fbff", color: item.photoReady ? colors.green : colors.blue, fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>검품사진 <CameraIcon /></button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, background: "linear-gradient(180deg, #e7f7f4 0%, #eaf8f8 100%)", border: `1px solid ${colors.border}`, borderRadius: 18, padding: "12px 16px", boxShadow: colors.shadow, flexWrap: "wrap" }}><div style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "10px 16px" }}><span style={{ fontSize: 14, color: colors.muted }}>검품SKU</span><span style={{ height: 30, padding: "0 12px", borderRadius: 10, background: "#f1f4f8", display: "inline-flex", alignItems: "center", fontSize: 13, fontWeight: 700 }}>전체 8건</span><span style={{ width: 1, height: 22, background: colors.borderStrong }} /><span style={{ fontSize: 14, color: colors.muted }}>검품수량</span><span style={{ fontSize: 18, fontWeight: 800, color: colors.blue }}>383</span></div><div style={{ color: colors.green, fontSize: 13, lineHeight: 1.7, textAlign: isDesktop ? "right" : "left" }}><div>수량 입력 시 자동 로컬저장 (서버 저장 X)</div><div>사진 촬영/업로드 시 자동 업로드 & 저장</div></div></div>
        </div>
      ) : null}
      {activeTab === "records" ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr auto" : "1fr", gap: 12, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 18, padding: 14, boxShadow: colors.shadow }}>
            <div style={{ height: 42, display: "flex", alignItems: "center", gap: 10, borderRadius: 12, background: "#f3f6fa", border: `1px solid ${colors.border}`, padding: "0 14px" }}><SearchIcon /><input readOnly placeholder="상품명/협력사 검색..." style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14 }} /></div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><button type="button" style={{ height: 40, padding: "0 16px", borderRadius: 12, border: "1px solid #9ec4ff", background: "#fff", color: colors.blue, fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}><BarcodeIcon />바코드</button><button type="button" style={{ height: 40, padding: "0 14px", borderRadius: 12, border: `1px solid ${colors.borderStrong}`, background: "#fff", color: colors.text, fontSize: 14, fontWeight: 700 }}>새로고침</button></div>
          </div>
          <SectionTitle title="검품 내역" />
          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "minmax(0, 1.46fr) 430px" : "1fr", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr 1fr" : "1fr", gap: 12, alignContent: "start" }}>
              {recordCards.map((card) => (
                <button key={card.id} type="button" onClick={() => setSelectedRecordId(card.id)} style={{ border: selectedRecord.id === card.id ? "1px solid #b5cbed" : `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", padding: 12, textAlign: "left", boxShadow: colors.shadow, cursor: "pointer", minHeight: 156 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 5 }}>{card.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: colors.blueSoft, color: colors.blue, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 700 }}>{card.supplier}</span>{card.eventLabel ? <span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: "#fff6e8", color: colors.orange, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 700 }}>{card.eventLabel}</span> : null}{card.topLabel ? <span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: "#eef9ef", color: colors.green, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 700 }}>{card.topLabel}</span> : null}</div>
                    </div>
                    <span style={{ color: colors.muted, fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><PencilIcon />수정</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}><span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: "#f6f8fb", color: colors.text, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 800 }}>검품 {card.inspectionQty}</span><span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: "#f6f8fb", color: colors.text, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 800 }}>회송 {card.returnQty}</span><span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: "#f6f8fb", color: colors.text, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 800 }}>교환 {card.exchangeQty}</span></div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>{card.tags.map((tag) => <span key={tag} style={{ height: 20, padding: "0 7px", borderRadius: 999, background: "#f2f5f8", color: "#4f6176", display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 700 }}>{tag}</span>)}</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>{Array.from({ length: 4 }).map((_, index) => <div key={index} style={{ width: 32, height: 32, borderRadius: 8, background: "#eff2f5", border: `1px solid ${colors.border}` }} />)}</div>
                  <div style={{ fontSize: 13, color: colors.muted }}>{card.time}</div>
                </button>
              ))}
            </div>
            <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", boxShadow: colors.shadow, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}><span style={{ fontSize: 14, fontWeight: 700 }}>← 목록으로</span><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ fontSize: 18, fontWeight: 800 }}>{selectedRecord.name}</div><span style={{ height: 24, padding: "0 9px", borderRadius: 999, background: "#e8f6e8", color: colors.green, display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 700 }}>{selectedRecord.supplier}</span></div><span style={{ color: colors.muted, fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><PencilIcon />수정</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 18 }}><StatBox label="검품수량" value={selectedRecord.inspectionQty} tone="blue" /><StatBox label="회송수량" value={selectedRecord.returnQty} tone="neutral" /><StatBox label="교환수량" value={selectedRecord.exchangeQty} tone="red" /></div>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>사진 관리</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}><PhotoManageCard title="검품사진 (4)" /><PhotoManageCard title="불량사진 (2)" danger /><PhotoManageCard title="중량사진 (4)" /><BrixCard /></div>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>수량 수정</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}><StaticInput label="검품수량" value={String(selectedRecord.inspectionQty)} /><StaticInput label="회송수량" value={String(selectedRecord.returnQty)} /><StaticInput label="교환수량" value={String(selectedRecord.exchangeQty)} /></div>
              <button type="button" style={{ width: "100%", height: 44, borderRadius: 12, border: "none", background: colors.blue, color: "#fff", fontSize: 16, fontWeight: 800 }}>수정 저장</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "analytics" ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: 16 }}>
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", padding: 16, boxShadow: colors.shadow }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><span style={{ width: 28, height: 28, borderRadius: 8, background: "#e6f0ff", color: colors.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800 }}>4</span><span style={{ fontSize: 16, fontWeight: 800 }}>통계 탭</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><KpiCard title="총 입고수량" value="510" tone="blue" /><KpiCard title="검품 수량" value="383" tone="green" /><KpiCard title="검품률" value="75.1%" tone="orange" /><KpiCard title="검품SKU" value="5" sub="검품 대상 품목 SKU 수" tone="purple" /><KpiCard title="불량률" value="8.4%" tone="red" /><KpiCard title="SKU 커버리지" value="62.5%" sub="5/8 SKU" tone="purple" /></div>
              </div>
              <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", padding: 16, boxShadow: colors.shadow }}><button type="button" style={{ width: "100%", height: 50, borderRadius: 12, border: "none", background: colors.green, color: "#fff", fontSize: 16, fontWeight: 800, marginBottom: 12 }}>요약 계산</button><button type="button" style={{ width: "100%", height: 50, borderRadius: 12, border: "1px solid #efbe66", background: "#fff", color: colors.orange, fontSize: 16, fontWeight: 800 }}>해피콜 분석</button><div style={{ color: colors.muted, fontSize: 14, lineHeight: 1.5, textAlign: "center", marginTop: 12 }}>버튼 클릭 시에만 전체 계산 수행 (자동 계산 제거)</div></div>
            </div>
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", padding: 16, boxShadow: colors.shadow }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><span style={{ width: 28, height: 28, borderRadius: 8, background: "#ffe5eb", color: "#cc5977", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800 }}>5</span><span style={{ fontSize: 16, fontWeight: 800 }}>ZIP 다운로드</span><span style={{ fontSize: 14, color: colors.muted }}>(20MB 분할)</span></div>
                <div style={{ display: "grid", gap: 10, maxHeight: 320, overflowY: "auto", paddingRight: 4 }}>
                  {zipFiles.map(([name, size]) => (
                    <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 16px" }}><div><div style={{ fontSize: 15, fontWeight: 800 }}>{name}</div><div style={{ marginTop: 4, color: colors.muted, fontSize: 13 }}>{size}</div></div><button type="button" style={{ height: 40, padding: "0 14px", borderRadius: 12, border: `1px solid ${colors.borderStrong}`, background: "#fff", color: colors.text, fontSize: 14, fontWeight: 700 }}>다운로드</button></div>
                  ))}
                </div>
              </div>
              <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: "#fff", padding: 16, boxShadow: colors.shadow }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>{[["daily", "일별"], ["weekly", "주별"], ["monthly", "월별"]].map(([key, label]) => <button key={key} type="button" onClick={() => setRange(key)} style={{ height: 34, padding: "0 13px", borderRadius: 10, border: range === key ? "1px solid #a9ccff" : `1px solid ${colors.borderStrong}`, background: range === key ? colors.blueSoft : "#fff", color: range === key ? colors.blue : colors.muted, fontSize: 13, fontWeight: 700 }}>{label}</button>)}</div>
                <div style={{ display: "grid", gap: 10 }}>{happycallTop[range].map((entry) => { const medalColor = entry.rank === 1 ? "#c9971a" : entry.rank === 2 ? "#73839b" : entry.rank === 3 ? "#ad6b3b" : colors.text; const medalBg = entry.rank === 1 ? "#fff4cf" : entry.rank === 2 ? "#eef3f8" : entry.rank === 3 ? "#f8eadf" : "#fbfdff"; return <div key={`${range}-${entry.rank}`} style={{ border: `1px solid ${colors.border}`, borderRadius: 14, background: "#fbfdff", padding: "12px 14px", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}><span style={{ minWidth: 62, height: 30, padding: "0 10px", borderRadius: 999, background: medalBg, color: medalColor, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>TOP.{entry.rank}</span><span style={{ flex: 1 }}>{entry.label}</span><span style={{ fontWeight: 800 }}>{entry.count}건</span></div>; })}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
