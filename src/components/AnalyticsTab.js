import React from "react";

function AnalyticsTab({
  styles,
  kpis,
  selectedHappycallPeriod,
  onSelectPeriod,
  selectedHappycallPeriodMeta,
  selectedHappycallPeriodCount,
  happycallHeroCard,
  happycallMiniCards,
  ProductImage,
  getTopMedal,
  formatPercent,
  saveQueueItems,
}) {
  return (
    <>
      <div style={styles.panel}>
        <div style={styles.compactHeader}>
          <div style={styles.sectionTitle}>{"\uD1B5\uACC4 / KPI"}</div>
        </div>
        <div style={styles.kpiGrid}>
          {kpis.map((item) => (
            <div key={item.label} style={styles.kpiCard}>
              <div style={styles.kpiLabel}>{item.label}</div>
              <div style={styles.kpiValue}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {saveQueueItems.length > 0 ? (
        <div style={styles.panel}>
          <div style={styles.sectionTitle}>{"\uC800\uC7A5 \uD604\uD669"}</div>
          <div style={styles.saveQueueList}>
            {saveQueueItems.map((item) => (
              <div key={item.key} style={styles.saveQueueCard}>
                <div style={styles.saveQueueTitle}>{item.title}</div>
                <div style={styles.saveQueueMeta}>
                  <span>{item.status}</span>
                  <span>{item.progress}%</span>
                </div>
                <div style={styles.saveQueueTrack}>
                  <div style={{ ...styles.saveQueueFill, width: `${item.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={styles.panel}>
        <div style={styles.happycallHeader}>
          <div>
            <div style={styles.sectionTitle}>
              {selectedHappycallPeriodMeta.title} {selectedHappycallPeriodCount ? `(${selectedHappycallPeriodCount}\uAC74)` : ""}
            </div>
          </div>
          <div style={styles.happycallPeriodRow}>
            {["1d", "7d", "30d"].map((periodKey) => (
              <button
                key={periodKey}
                type="button"
                onClick={() => onSelectPeriod(periodKey)}
                style={{
                  ...styles.happycallPeriodButton,
                  ...(selectedHappycallPeriod === periodKey ? styles.happycallPeriodButtonActive : {}),
                }}
              >
                {periodKey === "1d" ? "\uC804\uC77C" : periodKey === "7d" ? "\uC8FC\uAC04" : "\uC6D4\uAC04"}
              </button>
            ))}
          </div>
        </div>

        {!happycallHeroCard ? (
          <div style={styles.emptyBox}>{"\uD574\uD53C\uCF5C \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."}</div>
        ) : (
          <div style={styles.happycallShowcase}>
            <div style={styles.heroTopCard}>
              <div style={styles.heroTopCopy}>
                <div style={styles.heroTopBadge}>
                  <span style={styles.heroTopMedal}>{getTopMedal(happycallHeroCard.rank)}</span>
                  <span style={styles.heroTopBadgeText}>TOP {happycallHeroCard.rank}</span>
                </div>
                <div style={styles.heroTopName}>{happycallHeroCard.productName}</div>
                <div style={styles.heroTopMeta}>
                  {happycallHeroCard.count.toLocaleString("ko-KR")}\uAC74 · {formatPercent(happycallHeroCard.share)}
                  {happycallHeroCard.partnerName ? ` · ${happycallHeroCard.partnerName}` : ""}
                </div>
              </div>
              {happycallHeroCard.imageSrc ? (
                <div style={styles.heroImageFrame}>
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
                </div>
              ) : null}
            </div>

            {happycallMiniCards.length ? (
              <div style={styles.heroMiniGrid}>
                {happycallMiniCards.map((card) => (
                  <div key={`happycall-top-${card.rank}`} style={styles.heroMiniCard}>
                    <div style={styles.heroMiniLabel}>
                      <span>{getTopMedal(card.rank) || "-"}</span>
                      <span>{`TOP ${card.rank}`}</span>
                    </div>
                    <div style={styles.heroMiniName}>{card.productName}</div>
                    <div style={styles.heroMiniMeta}>
                      {card.count.toLocaleString("ko-KR")}\uAC74 · {formatPercent(card.share)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}

export default AnalyticsTab;
