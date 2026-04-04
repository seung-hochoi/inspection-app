import React from "react";

const palette = {
  bg: "#f3f6fb",
  card: "#ffffff",
  border: "#dce6f2",
  text: "#14213d",
  muted: "#6b7a90",
  primary: "#2563eb",
  primarySoft: "#ecf3ff",
  success: "#16a34a",
  successSoft: "#eaf7ef",
  warning: "#f59e0b",
  warningSoft: "#fff6dd",
  danger: "#dc2626",
  dangerSoft: "#fdecec",
  shadow: "0 18px 40px rgba(36, 81, 181, 0.08)",
};

function InspectionMobileLayout({
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
  const visibleQueue = Array.isArray(saveQueueItems) ? saveQueueItems.slice(0, 3) : [];

  return (
    <div style={styles.page}>
      <section style={styles.heroCard}>
        <div style={styles.heroTitleRow}>
          <div>
            <h1 style={styles.heroTitle}>검품 시스템</h1>
            <p style={styles.heroSub}>
              CSV 업로드부터 검품 입력, 사진 저장, 내역 조회까지 한 흐름으로 처리하는 현장용 검품 화면
            </p>
          </div>
          <span style={styles.heroBadge}>개선 설계도</span>
        </div>

        <div style={styles.stepFlow}>
          {[
            { no: 1, label: "CSV 업로드", active: Boolean(currentFileName) },
            { no: 2, label: mode === "inspection" ? "검품 입력" : "회송·교환 입력", active: true },
            { no: 3, label: "내역 조회", active: false },
            { no: 4, label: "통계", active: false },
          ].map((step, index) => (
            <React.Fragment key={step.label}>
              <div
                style={{
                  ...styles.stepItem,
                  ...(step.active ? styles.stepItemActive : null),
                }}
              >
                <div style={styles.stepNo}>{step.no}</div>
                <div style={styles.stepLabel}>{step.label}</div>
              </div>
              {index < 3 ? <div style={styles.stepArrow}>→</div> : null}
            </React.Fragment>
          ))}
        </div>

        {fileMeta ? <div style={styles.fileMeta}>현재 작업 파일: {fileMeta}</div> : null}
      </section>

      <section style={styles.tabCard}>
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
      </section>

      <section style={styles.panel}>
        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.sectionTitle}>검품 작업</div>
            <div style={styles.sectionMeta}>큰 버튼과 짧은 동선으로 빠르게 입력할 수 있게 정리했습니다.</div>
          </div>
        </div>

        <div style={styles.actionGrid}>
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

        <div style={styles.modeSwitch}>
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
      </section>

      <section style={styles.searchCard}>
        <div style={styles.searchRow}>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="상품명 / 상품코드 / 협력사 / 바코드 검색"
            style={styles.searchInput}
          />
          <button type="button" onClick={onScannerOpen} style={styles.scanButton}>
            스캔
          </button>
        </div>
        <div style={styles.utilityRow}>
          <button type="button" onClick={onDownloadPhotoZip} style={styles.secondaryButton}>
            {zipDownloading ? "ZIP 생성 중..." : "사진 ZIP"}
          </button>
        </div>
      </section>

      {errorMessage ? <div style={{ ...styles.notice, ...styles.errorNotice }}>{errorMessage}</div> : null}
      {infoMessage ? <div style={{ ...styles.notice, ...styles.infoNotice }}>{infoMessage}</div> : null}

      <section style={styles.queuePanel}>
        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.sectionTitle}>저장 큐</div>
            <div style={styles.sectionMeta}>변경된 항목은 대기열에 쌓이고 순차 전송됩니다.</div>
          </div>
          <span style={styles.countPill}>{saveQueueItems.length}건</span>
        </div>

        {visibleQueue.length ? (
          <div style={styles.queueList}>
            {visibleQueue.map((item) => (
              <div key={item.key} style={styles.queueItem}>
                <div style={styles.queueTitle}>{item.title}</div>
                <div style={styles.queueMeta}>{item.status || "저장대기"}</div>
                <div style={styles.queueTrack}>
                  <div
                    style={{
                      ...styles.queueFill,
                      width: `${Math.max(12, Number(item.progress || 0))}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={styles.emptyBox}>현재 저장 대기 중인 작업이 없습니다.</div>
        )}
      </section>

      <section style={styles.panel}>
        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.sectionTitle}>협력사 목록</div>
            <div style={styles.sectionMeta}>협력사 기준으로 묶어서 상품을 빠르게 확인할 수 있습니다.</div>
          </div>
          <span style={styles.countPill}>총 {totalVisibleProducts}건</span>
        </div>

        {groupedPartners.length ? (
          <div style={styles.partnerList}>
            {groupedPartners.map((partnerGroup) => {
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
                          ...styles.partnerChevron,
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
                        renderProductRow(partnerGroup, product, "mobile")
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={styles.emptyBox}>표시할 상품이 없습니다.</div>
        )}
      </section>

      <div style={styles.bottomBar}>
        <div>
          <div style={styles.bottomLabel}>작업 모드</div>
          <div style={styles.bottomValue}>{mode === "inspection" ? "검품 입력" : "회송·교환 입력"}</div>
        </div>
        <div>
          <div style={styles.bottomLabel}>표시 상품</div>
          <div style={styles.bottomValue}>{totalVisibleProducts}건</div>
        </div>
        <div>
          <div style={styles.bottomLabel}>저장 대기</div>
          <div style={styles.bottomValue}>{saveQueueItems.length}건</div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: 16,
    paddingBottom: 92,
  },
  heroCard: {
    background: palette.card,
    border: `1px solid ${palette.border}`,
    borderRadius: 24,
    padding: 24,
    boxShadow: palette.shadow,
  },
  heroTitleRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 18,
  },
  heroTitle: {
    margin: 0,
    fontSize: 34,
    lineHeight: 1.1,
    fontWeight: 800,
    color: palette.text,
    letterSpacing: "-0.04em",
  },
  heroSub: {
    margin: "8px 0 0",
    color: palette.muted,
    fontSize: 14,
    lineHeight: 1.6,
  },
  heroBadge: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 12px",
    borderRadius: 999,
    background: palette.primarySoft,
    color: palette.primary,
    fontSize: 12,
    fontWeight: 800,
  },
  stepFlow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    overflowX: "auto",
    paddingBottom: 4,
  },
  stepItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 16,
    border: `1px solid ${palette.border}`,
    background: "#fff",
    whiteSpace: "nowrap",
  },
  stepItemActive: {
    background: palette.primarySoft,
    borderColor: "#bfd2fb",
  },
  stepNo: {
    width: 22,
    height: 22,
    borderRadius: 999,
    background: palette.primary,
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 800,
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: palette.text,
  },
  stepArrow: {
    color: "#98a9bf",
    fontSize: 16,
    fontWeight: 800,
  },
  fileMeta: {
    marginTop: 16,
    fontSize: 12,
    color: palette.muted,
  },
  tabCard: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10,
    background: palette.card,
    border: `1px solid ${palette.border}`,
    borderRadius: 20,
    padding: 12,
    boxShadow: palette.shadow,
  },
  tabButton: {
    height: 50,
    borderRadius: 14,
    border: `1px solid ${palette.border}`,
    background: "#fff",
    color: palette.text,
    fontSize: 17,
    fontWeight: 800,
  },
  tabButtonActive: {
    background: palette.primary,
    color: "#fff",
    borderColor: palette.primary,
  },
  panel: {
    background: palette.card,
    border: `1px solid ${palette.border}`,
    borderRadius: 24,
    padding: 20,
    boxShadow: palette.shadow,
  },
  searchCard: {
    background: palette.card,
    border: `1px solid ${palette.border}`,
    borderRadius: 24,
    padding: 18,
    boxShadow: palette.shadow,
    display: "grid",
    gap: 12,
  },
  queuePanel: {
    background: palette.card,
    border: `1px solid ${palette.border}`,
    borderRadius: 24,
    padding: 20,
    boxShadow: palette.shadow,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: palette.text,
    marginBottom: 4,
  },
  sectionMeta: {
    fontSize: 13,
    color: palette.muted,
    lineHeight: 1.5,
  },
  actionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
    marginBottom: 16,
  },
  primaryButton: {
    minHeight: 52,
    border: "none",
    borderRadius: 16,
    background: palette.primary,
    color: "#fff",
    fontSize: 15,
    fontWeight: 800,
    boxShadow: "0 12px 24px rgba(37, 99, 235, 0.22)",
  },
  secondaryButton: {
    minHeight: 52,
    border: `1px solid ${palette.border}`,
    borderRadius: 16,
    background: "#fff",
    color: palette.primary,
    fontSize: 14,
    fontWeight: 700,
  },
  ghostButton: {
    minHeight: 52,
    border: `1px dashed ${palette.border}`,
    borderRadius: 16,
    background: "#f9fbff",
    color: palette.muted,
    fontSize: 14,
    fontWeight: 700,
  },
  modeSwitch: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  modeButton: {
    minHeight: 50,
    border: `1px solid ${palette.border}`,
    borderRadius: 16,
    background: "#f8fbff",
    color: palette.text,
    fontSize: 15,
    fontWeight: 700,
  },
  modeButtonActive: {
    background: palette.primarySoft,
    borderColor: "#bfd2fb",
    color: palette.primary,
  },
  searchRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 10,
  },
  searchInput: {
    width: "100%",
    minHeight: 54,
    borderRadius: 16,
    border: `1px solid ${palette.border}`,
    padding: "0 16px",
    outline: "none",
    fontSize: 15,
    color: palette.text,
    boxSizing: "border-box",
  },
  scanButton: {
    minWidth: 84,
    minHeight: 54,
    border: "none",
    borderRadius: 16,
    background: "#182033",
    color: "#fff",
    fontSize: 18,
    fontWeight: 800,
  },
  utilityRow: {
    display: "flex",
    justifyContent: "flex-end",
  },
  notice: {
    padding: "12px 14px",
    borderRadius: 16,
    border: "1px solid",
    fontSize: 13,
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
  countPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 46,
    height: 30,
    padding: "0 12px",
    borderRadius: 999,
    background: "#eef4fb",
    color: "#34506f",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  queueList: {
    display: "grid",
    gap: 10,
  },
  queueItem: {
    display: "grid",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 16,
    border: `1px solid ${palette.border}`,
    background: "#fbfdff",
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
  partnerList: {
    display: "grid",
    gap: 14,
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
    padding: "16px 18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
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
  partnerChevron: {
    color: palette.muted,
    fontSize: 18,
    transition: "transform 0.2s ease",
  },
  partnerBody: {
    display: "grid",
    gap: 12,
    padding: 14,
  },
  emptyBox: {
    borderRadius: 18,
    border: `1px dashed ${palette.border}`,
    background: "#fff",
    padding: "24px 18px",
    textAlign: "center",
    color: palette.muted,
    fontSize: 14,
  },
  bottomBar: {
    position: "sticky",
    bottom: 12,
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 22,
    border: `1px solid ${palette.border}`,
    background: "rgba(255,255,255,0.95)",
    backdropFilter: "blur(14px)",
    boxShadow: "0 18px 38px rgba(15, 23, 42, 0.12)",
  },
  bottomLabel: {
    fontSize: 11,
    color: palette.muted,
    marginBottom: 4,
  },
  bottomValue: {
    fontSize: 15,
    color: palette.text,
    fontWeight: 800,
  },
};

export default InspectionMobileLayout;
