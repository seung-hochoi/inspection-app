const fs = require('fs');
const content = `import React, { useState, useEffect, useCallback } from 'react';
import Toast from './components/Toast';
import InspectionPage from './components/InspectionPage';
import RecordsPage from './components/RecordsPage';
import SummaryPage from './components/SummaryPage';
import CsvUploader from './components/CsvUploader';
import { fetchBootstrap } from './api';
import { C, font, radius, shadow } from './components/styles';

const TABS = [
  { key: 'inspection', label: '검품', icon: '🔍' },
  { key: 'records',    label: '내역', icon: '📋' },
  { key: 'summary',    label: '통계', icon: '📊' },
];

export default function App() {
  const [tab, setTab] = useState('inspection');

  // Bootstrap data
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState('');
  const [jobKey, setJobKey]         = useState('');
  const [rows, setRows]             = useState([]);       // inspection product rows
  const [records, setRecords]       = useState([]);       // movement records
  const [summary, setSummary]       = useState({});
  const [happycall, setHappycall]   = useState({});
  const [worksheetUrl, setWorksheetUrl] = useState('');

  // Toast
  const [toast, setToast] = useState({ message: '', type: 'info' });
  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
  }, []);
  const dismissToast = useCallback(() => setToast({ message: '', type: 'info' }), []);

  // Bootstrap load
  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await fetchBootstrap();
      const job = data.current_job || {};
      setJobKey(job.job_key || '');
      setRows(job.rows || data.rows || []);
      setRecords(data.records || []);
      setSummary(data.summary || {});
      setHappycall(data.happycall || {});
      setWorksheetUrl(data.worksheet_url || '');
    } catch (err) {
      setLoadError(err.message || '데이터 로드 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBootstrap(); }, [loadBootstrap]);

  const handleCsvLoaded = useCallback(({ jobKey: newKey, rows: newRows }) => {
    setJobKey(newKey);
    setRows(newRows);
  }, []);

  const handleRefresh = useCallback(() => loadBootstrap(), [loadBootstrap]);

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      fontFamily: font.base,
      display: 'flex',
      flexDirection: 'column',
      maxWidth: 720,
      margin: '0 auto',
      position: 'relative',
    }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 200,
        background: C.primary, color: '#fff',
        padding: '0 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 52,
        boxShadow: shadow.md,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>📦</span>
          <div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>검품 시스템</p>
            {jobKey && (
              <p style={{ margin: 0, fontSize: 10, opacity: 0.8, lineHeight: 1.2 }}>
                {jobKey.length > 30 ? jobKey.slice(0, 30) + '…' : jobKey}
              </p>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CsvUploader onJobLoaded={handleCsvLoaded} onToast={showToast} />
          {worksheetUrl && (
            <a
              href={worksheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                height: 36, padding: '0 12px',
                background: 'rgba(255,255,255,0.15)',
                color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: radius.md, fontSize: 12, fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              시트 열기
            </a>
          )}
          <button
            onClick={handleRefresh}
            style={{
              width: 36, height: 36, border: 'none',
              background: 'rgba(255,255,255,0.15)', color: '#fff',
              borderRadius: radius.md, fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title="새로고침"
          >
            🔄
          </button>
        </div>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, overflowY: 'auto', paddingBottom: 60 }}>
        {loading ? (
          <LoadingScreen />
        ) : loadError ? (
          <ErrorScreen error={loadError} onRetry={loadBootstrap} />
        ) : (
          <>
            {tab === 'inspection' && (
              <InspectionPage
                jobKey={jobKey}
                rows={rows}
                onError={(msg) => showToast(msg, 'error')}
                onToast={showToast}
              />
            )}
            {tab === 'records' && (
              <RecordsPage
                records={records}
                jobKey={jobKey}
                onToast={showToast}
                onRefresh={handleRefresh}
              />
            )}
            {tab === 'summary' && (
              <SummaryPage
                summary={summary}
                happycall={happycall}
                onToast={showToast}
                onRefresh={handleRefresh}
              />
            )}
          </>
        )}
      </main>

      {/* Bottom tab bar */}
      <nav style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 720,
        background: C.card, borderTop: \`1px solid \${C.border}\`,
        display: 'flex', zIndex: 200,
        boxShadow: '0 -2px 12px rgba(0,0,0,0.06)',
      }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '8px 0', border: 'none',
              background: 'none', cursor: 'pointer', fontFamily: font.base,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              borderTop: tab === t.key ? \`2px solid \${C.primary}\` : '2px solid transparent',
            }}
          >
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            <span style={{
              fontSize: 11, fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? C.primary : C.muted,
            }}>{t.label}</span>
          </button>
        ))}
      </nav>

      <Toast message={toast.message} type={toast.type} onDismiss={dismissToast} />

      {/* Global animation */}
      <style>{\`
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        * { box-sizing: border-box; }
        body { margin: 0; background: \${C.bg}; }
      \`}</style>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', color: C.muted, fontFamily: font.base }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
      <p style={{ fontSize: 16, fontWeight: 600 }}>데이터 로딩 중...</p>
    </div>
  );
}

function ErrorScreen({ error, onRetry }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', fontFamily: font.base }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
      <p style={{ fontSize: 15, fontWeight: 600, color: C.red, marginBottom: 8 }}>로드 실패</p>
      <p style={{ fontSize: 13, color: C.muted, marginBottom: 20, textAlign: 'center' }}>{error}</p>
      <button onClick={onRetry} style={{
        height: 44, padding: '0 24px',
        background: C.primary, color: '#fff', border: 'none',
        borderRadius: radius.md, fontSize: 14, fontWeight: 600,
        cursor: 'pointer', fontFamily: font.base,
      }}>
        다시 시도
      </button>
    </div>
  );
}`;

fs.writeFileSync('C:/inspection-app-main (1)/inspection-app-main/src/App.js', content);
console.log('Done - wrote ' + content.length + ' bytes');
