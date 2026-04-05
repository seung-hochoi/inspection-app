import React from 'react';

const HeaderSection = ({ onOpenHistory, onOpenAdminReset, worksheetUrl }) => {
    const styles = {
        header: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: '1px solid #e5e7eb',
        },
        title: {
            fontSize: 24,
            fontWeight: 900,
            color: '#1f2937',
            margin: 0,
        },
        buttonGroup: {
            display: 'flex',
            gap: 6,
        },
        iconButton: {
            width: 40,
            height: 40,
            borderRadius: 10,
            border: 'none',
            background: '#f3f4f6',
            color: '#1f2937',
            fontSize: 18,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        },
    };

    return (
        <div style={styles.header}>
            <h1 style={styles.title}>검품</h1>
            <div style={styles.buttonGroup}>
                {worksheetUrl && (
                    <a href={worksheetUrl} target="_blank" rel="noopener noreferrer" style={{ ...styles.iconButton, textDecoration: 'none', }} title="스프레드시트 보기">
                        📊
                    </a>
                )}
                <button onClick={onOpenHistory} style={styles.iconButton} title="검품 기록">
                    📋
                </button>
                <button onClick={onOpenAdminReset} style={styles.iconButton} title="관리자 메뉴">
                    ⚙️
                </button>
            </div>
        </div>
    );
};

export default HeaderSection;