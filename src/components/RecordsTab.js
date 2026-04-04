import React from "react";

function RecordsTab({ styles, historyLoading, historyRows, onRefresh, renderHistoryCard }) {
  return (
    <div style={styles.panel}>
      <div style={styles.compactHeader}>
        <div style={styles.sectionTitle}>{"\uB0B4\uC5ED \uD0ED"}</div>
        <button type="button" onClick={onRefresh} style={styles.toolPillButton}>
          {"\uC0C8\uB85C\uACE0\uCE68"}
        </button>
      </div>

      {historyLoading ? (
        <div style={styles.infoBox}>{"\uB0B4\uC5ED\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4."}</div>
      ) : historyRows.length === 0 ? (
        <div style={styles.emptyBox}>{"\uC870\uD68C\uB41C \uB0B4\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</div>
      ) : (
        <div style={styles.sheetList}>
          {historyRows.map((record, index) => renderHistoryCard(record, index))}
        </div>
      )}
    </div>
  );
}

export default RecordsTab;
