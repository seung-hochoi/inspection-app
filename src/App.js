<div className="inspection-ui-design">
  <header>
    <h1>검품 시스템</h1>
    <nav>
      <ul>
        <li>검품</li>
        <li>내역</li>
        <li>통계</li>
      </ul>
    </nav>
  </header>

  <div className="collapsible-sections">
    <CollapsibleSection title="Group 1">
      <ProductRow order={...} inspection={...} />
    </CollapsibleSection>
    <CollapsibleSection title="Group 2">
      <ProductRow order={...} inspection={...} />
    </CollapsibleSection>
  </div>

  <div className="search-filter-controls">
    <SearchFilter />
  </div>

  <BatchSaveBar />
</div>