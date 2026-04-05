import React from 'react';

const AnalyticsTab = ({ inspectionData }) => {
    // Process the inspectionData to calculate statistics and KPIs
    const totalInspections = inspectionData.length;
    const passedInspections = inspectionData.filter(item => item.status === 'passed').length;
    const failedInspections = totalInspections - passedInspections;
    const passRate = totalInspections ? ((passedInspections / totalInspections) * 100).toFixed(2) : 0;

    return (
        <div>
            <h2>Inspection Statistics</h2>
            <p>Total Inspections: {totalInspections}</p>
            <p>Passed Inspections: {passedInspections}</p>
            <p>Failed Inspections: {failedInspections}</p>
            <p>Pass Rate: {passRate}%</p>
        </div>
    );
};

export default AnalyticsTab;
