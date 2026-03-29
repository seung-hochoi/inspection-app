import React from "react";
import { getHappycallRankStyle } from "../utils/helpers";

function ProductCard({
  mode,
  product,
  happycallBadges,
  historySummary,
  styles,
  onToggleOpen,
  isOpen,
  renderExpandedContent,
  inspectionContent,
  showEventBadge,
  eventBadgeText,
  emptyProductNameText,
}) {
  const title = product.productName || emptyProductNameText;

  if (mode === "inspection") {
    return (
      <div style={styles.card}>
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
              <div style={styles.cardTitle}>{title}</div>
              {showEventBadge ? <span style={styles.eventBadge}>{eventBadgeText}</span> : null}
            </div>
            <div style={styles.cardMeta}>코드 {product.productCode}</div>
            <div style={styles.cardMeta}>협력사 {product.partner}</div>
            <div style={styles.qtyRow}>
              <span style={styles.qtyChip}>총 발주 {product.totalQty}개</span>
              {historySummary ? <span style={styles.qtyChip}>{historySummary}</span> : null}
            </div>
          </div>

          {inspectionContent}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <button type="button" style={styles.cardButton} onClick={onToggleOpen}>
        <div style={styles.cardContentRow}>
          <div style={styles.cardMainCopy}>
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
              <div style={styles.cardTitle}>{title}</div>
              {showEventBadge ? <span style={styles.eventBadge}>{eventBadgeText}</span> : null}
            </div>
            <div style={styles.cardMeta}>코드 {product.productCode}</div>
            <div style={styles.qtyRow}>
              <span style={styles.qtyChip}>총 발주 {product.totalQty}개</span>
              {historySummary ? <span style={styles.qtyChip}>{historySummary}</span> : null}
            </div>
          </div>
          {product.imageSrc ? (
            <div style={styles.cardThumbFrame}>
              <img src={product.imageSrc} alt={title} style={styles.cardThumbImage} />
            </div>
          ) : null}
        </div>
      </button>

      {isOpen ? renderExpandedContent?.() : null}
    </div>
  );
}

export default ProductCard;
