import React from 'react';

const InspectionTabHeader = ({ onSearch, onFilter, onSave }) => {
  const handleSearch = (event) => {
    onSearch(event.target.value);
  };

  const handleFilter = (event) => {
    onFilter(event.target.value);
  };

  const handleSave = () => {
    onSave();
  };

  return (
    <div className="inspection-tab-header">
      <input
        type="text"
        placeholder="Search..."
        onChange={handleSearch}
      />
      <select onChange={handleFilter}>
        <option value="">Select Filter</option>
        <option value="filter1">Filter 1</option>
        <option value="filter2">Filter 2</option>
      </select>
      <button onClick={handleSave}>Save</button>
    </div>
  );
};

export default InspectionTabHeader;
