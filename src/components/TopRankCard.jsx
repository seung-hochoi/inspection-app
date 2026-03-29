import React from "react";
import { getTopMedal } from "../utils/helpers";

function TopRankCard({ card, styles, metaText }) {
  return (
    <div
      style={{
        ...styles.kpiCard,
        borderColor:
          card.rank === 1 ? "#fca5a5" : card.rank === 2 ? "#93c5fd" : card.rank === 3 ? "#86efac" : "#e5e7eb",
      }}
    >
      <div style={styles.cardContentRow}>
        <div style={styles.cardMainCopy}>
          <div style={styles.topRankRow}>
            {getTopMedal(card.rank) ? (
              <span style={styles.topMedal}>{getTopMedal(card.rank)}</span>
            ) : (
              <span style={styles.topMedalPlaceholder} />
            )}
            <div
              style={{
                ...styles.kpiLabel,
                marginBottom: 0,
                fontWeight: 900,
                color:
                  card.rank === 1 ? "#b91c1c" : card.rank === 2 ? "#1d4ed8" : card.rank === 3 ? "#15803d" : "#64748b",
              }}
            >
              {`TOP.${card.rank}`}
            </div>
          </div>
          <div
            style={{
              ...styles.kpiValue,
              fontSize: 18,
              fontWeight: 900,
              color:
                card.rank === 1 ? "#b91c1c" : card.rank === 2 ? "#1d4ed8" : card.rank === 3 ? "#15803d" : "#0f172a",
            }}
          >
            {card.productName}
          </div>
          <div style={styles.topCardMeta}>{metaText}</div>
        </div>
        {card.imageSrc ? (
          <div style={styles.cardThumbFrame}>
            <img src={card.imageSrc} alt={card.productName} style={styles.cardThumbImage} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default TopRankCard;
