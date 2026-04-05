import React from 'react';
import './RecordsTab.css'; // Assuming you have styles defined in a separate CSS file for grid layout

const RecordsTab = () => {
    const records = [
        // Sample data structure for inspection records
        {
            productCode: 'P001',
            productName: 'Product 1',
            supplier: 'Supplier A',
            center: 'Center 1',
            orderQty: 100,
            inspectionQty: 80,
            returnQty: 5,
            exchangeQty: 3,
            photoCount: 2,
        },
        // Add more records as needed
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', padding: '20px' }}>
            <h2 style={{ textAlign: 'center' }}>Inspection Records</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
                {records.map((record, index) => (
                    <div key={index} style={{ border: '1px solid #ccc', padding: '10px', borderRadius: '5px' }}>
                        <h3>{record.productName}</h3>
                        <p><strong>Product Code:</strong> {record.productCode}</p>
                        <p><strong>Supplier:</strong> {record.supplier}</p>
                        <p><strong>Order Quantity:</strong> {record.orderQty}</p>
                        <p><strong>Inspection Quantity:</strong> {record.inspectionQty}</p>
                        <p><strong>Return Quantity:</strong> {record.returnQty}</p>
                        <p><strong>Exchange Quantity:</strong> {record.exchangeQty}</p>
                        <p><strong>Photo Count:</strong> {record.photoCount}</p>
                    </div>
                ))}
            </div>
            <div style={{ marginTop: '20px', border: '1px solid #ccc', padding: '10px', borderRadius: '5px' }}>
                <h3>Edit Record</h3>
                {/* Implement form for editing a selected record here */}
                <p>Select a record to edit details and preview photos.</p>
            </div>
        </div>
    );
};

export default RecordsTab;