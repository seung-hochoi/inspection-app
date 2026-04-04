import React from "react";

const palette = {
  card: "#ffffff",
  border: "#dce6f2",
  text: "#14213d",
  muted: "#6b7a90",
  primary: "#2563eb",
  primarySoft: "#edf4ff",
  shadow: "0 18px 40px rgba(36, 81, 181, 0.08)",
};

function InspectionWebLayout({
  activeTab = "inspection",
  onTabChange,
  currentFileName,
  currentFileModifiedAt,
  uploadingCsv,
  uploadingHappycallCsv,
  onCsvUploadClick,
  onHappycallUploadClick,
  onImageRegisterOpen,
  onAdminResetOpen,
  search,
  onSearchChange,
  onScannerOpen,
  infoMessage,
  errorMessage,
  groupedPartners,
  expandedPartner,
  onTogglePartner,
  totalVisibleProducts,
  mode,
  onModeChange,
  zipDownloading,
  onDownloadPhotoZip,
  saveQueueItems,
  renderProductRow,
}) {
  const fileMeta = [currentFileName, currentFileModifiedAt].filter(Boolean).join(" · ");

  return (
    <div style={styles.page}>
      <section style={styles.heroCard}>
        <div>
          <div style={styles.heroTitleRow}>
            <h1 style={styles.heroTitle}>검품 시스템</h1>
            <span style={styles.heroBadge}>개선 설계도</span>
          </div>
          <p style={styles.heroSub}>
            현장 작업자와 관리자 모두 같은 흐름으로 사용할 수 있도록 설계한 라이트 테마 검품 대시보드
          </p>
          {fileMeta ? <div style={styles.heroMeta}>현재 작업 파일: {fileMeta}</div> : null}
        </div>

        <div style={styles.flowPanel}>
          {[
            { no: 1, label: "CSV 업로드", active: Boolean(currentFileName) },
            { no: 2, label: mode === "inspection" ? "검품 입력" : "회송·교환 입력", active: true },
            { no: 3, label: "내역 조회", active: false },
            { no: 4, label: "통계", active: false },
          ].map((step) => (
            <div
              key={step.label}
              style={{
                ...styles.flowCard,
                ...(step.active ? styles.flowCardActive : null),
              }}
            >
              <div style={styles.flowNo}>{step.no}</div>
              <div style={styles.flowLabel}>{step.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={styles.toolbarCard}>
        <div style={styles.toolbarLeft}>
          <div style={styles.tabRow}>
            {[
              { key: "inspection", label: "검품" },
              { key: "records", label: "내역" },
              { key: "analytics", label: "통계" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onTabChange?.(tab.key)}
                style={{
                  ...styles.tabButton,
                  ...(activeTab === tab.key ? styles.tabButtonActive : null),
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={styles.modeRow}>
            <button
              type="button"
              onClick={() => onModeChange("inspection")}
              style={{
                ...styles.modeButton,
                ...(mode === "inspection" ? styles.modeButtonActive : null),
              }}
            >
              검품 입력
            </button>
            <button
              type="button"
              onClick={() => onModeChange("return")}
              style={{
                ...styles.modeButton,
                ...(mode === "return" ? styles.modeButtonActive : null),
              }}
            >
              회송·교환 입력
            </button>
          </div>
        </div>

        <div style={styles.toolbarActions}>
          <button type="button" onClick={onCsvUploadClick} style={styles.primaryButton}>
            {uploadingCsv ? "CSV 처리 중..." : "CSV 업로드"}
          </button>
          <button type="button" onClick={onHappycallUploadClick} style={styles.secondaryButton}>
            {uploadingHappycallCsv ? "해피콜 업로드 중..." : "해피콜 업로드"}
          </button>
          <button type="button" onClick={onImageRegisterOpen} style={styles.secondaryButton}>
            상품 이미지
          </button>
          <button type="button" onClick={onAdminResetOpen} style={styles.ghostButton}>
            관리자 초기화
          </button>
        </div>
      </section>

      <section style={styles.searchCard}>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="상품명 / 상품코드 / 협력사 / 바코드 검색"
          style={styles.searchInput}
        />
        <button type="button" onClick={onScannerOpen} style={styles.secondaryButton}>
          스캔
        </button>
        <button type="button" onClick={onDownloadPhotoZip} style={styles.secondaryButton}>
          {zipDownloading ? "ZIP 생성 중..." : "사진 ZIP"}
        </button>
      </section>

      {errorMessage ? <div style={{ ...styles.notice, ...styles.errorNotice }}>{errorMessage}</div> : null}
      {infoMessage ? <div style={{ ...styles.notice, ...styles.infoNotice }}>{infoMessage}</div> : null}

      <div style={styles.contentGrid}>
        <section style={styles.mainPanel}>
          <div style={styles.mainHeader}>
            <div>
              <div style={styles.sectionTitle}>검품 대상 상품</div>
              <div style={styles.sectionMeta}>협력사별로 펼쳐서 작업하고 상태와 사진을 한 줄에서 관리합니다.</div>
            </div>
            <span style={styles.countPill}>총 {totalVisibleProducts}건</span>
          </div>

          <div style={styles.tableHeader}>
            <span>상품 정보</span>
            <span style={{ textAlign: "center" }}>수량</span>
            <span style={{ textAlign: "center" }}>입력</span>
            <span style={{ textAlign: "center" }}>사진</span>
            <span style={{ textAlign: "center" }}>상태</span>
          </div>

          <div style={styles.partnerList}>
            {groupedPartners.length ? (
              groupedPartners.map((partnerGroup) => {
                const isOpen = expandedPartner === partnerGroup.partner;
                return (
                  <div key={partnerGroup.partner} style={styles.partnerCard}>
                    <button
                      type="button"
                      onClick={() => onTogglePartner(partnerGroup.partner)}
                      style={styles.partnerHeader}
                    >
                      <div>
                        <div style={styles.partnerName}>{partnerGroup.partner}</div>
                        <div style={styles.partnerMeta}>상품 {partnerGroup.products.length}개</div>
                      </div>
                      <div style={styles.partnerHeaderRight}>
                        <span style={styles.countPill}>{partnerGroup.products.length}</span>
                        <span
                          style={{
                            ...styles.chevron,
                            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                          }}
                        >
                          ▾
                        </span>
                      </div>
                    </button>

                    {isOpen ? (
                      <div style={styles.partnerBody}>
                        {partnerGroup.products.map((product) =>
                          renderProductRow(partnerGroup, product, "web")
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div style={styles.emptyBox}>표시할 상품이 없습니다.</div>
            )}
          </div>
        </section>

        <aside style={styles.sidePanel}>
          <div style={styles.mainHeader}>
            <div>
              <div style={styles.sectionTitle}>저장 큐</div>
              <div style={styles.sectionMeta}>변경된 항목은 순차 저장되며 상태는 상품별로 유지됩니다.</div>
            </div>
            <span style={styles.countPill}>{saveQueueItems.length}건</span>
          </div>

          {saveQueueItems.length ? (
            <div style={styles.queueList}>
              {saveQueueItems.slice(0, 8).map((item) => (
                <div key={item.key} style={styles.queueItem}>
                  <div style={styles.queueTitle}>{item.title}</div>
                  <div style={styles.queueMeta}>{item.status || "저장대기"}</div>
                  <div style={styles.queueTrack}>
                    <div
                      style={{
                        ...styles.queueFill,
                        width: `${Math.max(10, Number(item.progress || 0))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.emptyBox}>현재 저장 대기 중인 작업이 없습니다.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 20,
  },
  heroCard: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.15fr) minmax(420px, 0.85fr)",
    gap: 20,
    padding: 28,
    borderRadius: 28,
    border: `1px solid ${palette.border}`,
    background: palette.card,
    boxShadow: palette.shadow,
  },
  heroTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  heroTitle: {
    margin: 0,
    fontSize: 40,
    lineHeight: 1.05,
    color: palette.text,
    fontWeight: 800,
    letterSpacing: "-0.04em",
  },
  heroBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 14px",
    borderRadius: 999,
    background: palette.primarySoft,
    color: palette.primary,
    fontSize: 13,
    fontWeight: 800,
  },
  heroSub: {
    margin: 0,
    color: palette.muted,
    fontSize: 15,
    lineHeight: 1.7,
  },
  heroMeta: {
    marginTop: 16,
    fontSize: 13,
    color: palette.muted,
  },
  flowPanel: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
  },
  flowCard: {
    borderRadius: 18,
    border: `1px solid ${palette.border}`,
    background: "#f8fbff",
    padding: 16,
    display: "grid",
    gap: 8,
  },
  flowCardActive: {
    background: palette.primarySoft,
    borderColor: "#bfd2fb",
  },
  flowNo: {
    width: 28,
    height: 28,
    borderRadius: 999,
    background: palette.primary,
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 800,
  },
  flowLabel: {
    fontSize: 14,
    fontWeight: 700,
    color: palette.text,
  },
  toolbarCard: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    padding: 20,
    borderRadius: 24,
    border: `1px solid ${palette.border}`,
    background: palette.card,
    boxShadow: palette.shadow,
  },
  toolbarLeft: {
    display: "grid",
    gap: 14,
    flex: 1,
  },
  tabRow: {
    display: "flex",
    gap: 10,
  },
  tabButton: {
    height: 46,
    minWidth: 108,
    borderRadius: 14,
    border: `1px solid ${palette.border}`,
    background: "#fff",
    color: palette.text,
    fontSize: 15,
    fontWeight: 800,
  },
  tabButtonActive: {
    background: palette.primary,
    color: "#fff",
    borderColor: palette.primary,
  },
  modeRow: {
    display: "flex",
    gap: 10,
  },
  modeButton: {
    height: 44,
    minWidth: 140,
    borderRadius: 14,
    border: `1px solid ${palette.border}`,
    background: "#f8fbff",
    color: palette.text,
    fontSize: 14,
    fontWeight: 700,
  },
  modeButtonActive: {
    background: palette.primarySoft,
    color: palette.primary,
    borderColor: "#bfd2fb",
  },
  toolbarActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "flex-end",
    alignItems: "flex-start",
    maxWidth: 560,
  },
  primaryButton: {
    height: 48,
    padding: "0 18px",
    borderRadius: 14,
    border: "none",
    background: palette.primary,
    color: "#fff",
    fontSize: 14,
    fontWeight: 800,
  },
  secondaryButton: {
    height: 48,
    padding: "0 18px",
    borderRadius: 14,
    border: `1px solid ${palette.border}`,
    background: "#fff",
    color: palette.primary,
    fontSize: 14,
    fontWeight: 700,
  },
  ghostButton: {
    height: 48,
    padding: "0 18px",
    borderRadius: 14,
    border: `1px dashed ${palette.border}`,
    background: "#f8fbff",
    color: palette.muted,
    fontSize: 14,
    fontWeight: 700,
  },
  searchCard: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    gap: 12,
    padding: 18,
    borderRadius: 22,
    border: `1px solid ${palette.border}`,
    background: palette.card,
    boxShadow: palette.shadow,
  },
  searchInput: {
    width: "100%",
    height: 52,
    borderRadius: 14,
    border: `1px solid ${palette.border}`,
    padding: "0 16px",
    outline: "none",
    fontSize: 15,
    color: palette.text,
    boxSizing: "border-box",
  },
  notice: {
    padding: "14px 16px",
    borderRadius: 18,
    border: "1px solid",
    fontSize: 14,
    fontWeight: 700,
  },
  errorNotice: {
    borderColor: "#f8cbcb",
    background: "#fff4f4",
    color: "#b42318",
  },
  infoNotice: {
    borderColor: "#d6e2ff",
    background: "#f3f7ff",
    color: "#2156d9",
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 320px",
    gap: 20,
    alignItems: "start",
  },
  mainPanel: {
    padding: 22,
    borderRadius: 24,
    border: `1px solid ${palette.border}`,
    background: palette.card,
    boxShadow: palette.shadow,
  },
  sidePanel: {
    position: "sticky",
    top: 20,
    padding: 20,
    borderRadius: 24,
    border: `1px solid ${palette.border}`,
    background: palette.card,
    boxShadow: palette.shadow,
  },
  mainHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 22,
    color: palette.text,
    fontWeight: 800,
    marginBottom: 4,
  },
  sectionMeta: {
    fontSize: 13,
    color: palette.muted,
    lineHeight: 1.5,
  },
  countPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 48,
    height: 30,
    padding: "0 12px",
    borderRadius: 999,
    background: "#eef4fb",
    color: "#34506f",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  tableHeader: {
    display: "grid",
    gridTemplateColumns: "minmax(320px, 2.2fr) 112px 220px 180px 180px",
    gap: 12,
    padding: "0 14px 12px",
    color: "#76859b",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.02em",
  },
  partnerList: {
    display: "grid",
    gap: 18,
  },
  partnerCard: {
    borderRadius: 20,
    border: `1px solid ${palette.border}`,
    background: "#fbfdff",
    overflow: "hidden",
  },
  partnerHeader: {
    width: "100%",
    border: "none",
    background: "linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 18px",
    textAlign: "left",
  },
  partnerName: {
    fontSize: 18,
    fontWeight: 800,
    color: palette.text,
    marginBottom: 4,
  },
  partnerMeta: {
    fontSize: 12,
    color: palette.muted,
  },
  partnerHeaderRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  chevron: {
    fontSize: 18,
    color: palette.muted,
    transition: "transform 0.2s ease",
  },
  partnerBody: {
    display: "grid",
    gap: 8,
    padding: "10px 12px 12px",
  },
  queueList: {
    display: "grid",
    gap: 10,
  },
  queueItem: {
    display: "grid",
    gap: 8,
    borderRadius: 16,
    border: `1px solid ${palette.border}`,
    background: "#fbfdff",
    padding: "12px 14px",
  },
  queueTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: palette.text,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  queueMeta: {
    fontSize: 12,
    color: palette.muted,
  },
  queueTrack: {
    width: "100%",
    height: 8,
    borderRadius: 999,
    background: "#e7eef8",
    overflow: "hidden",
  },
  queueFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #2563eb 0%, #5a8bff 100%)",
  },
  emptyBox: {
    borderRadius: 18,
    border: `1px dashed ${palette.border}`,
    background: "#fff",
    padding: "24px 16px",
    textAlign: "center",
    color: palette.muted,
    fontSize: 14,
  },
};

export default InspectionWebLayout;
