# System Overview

Practical reference for developers maintaining this app.

---

## Stack

- **Frontend**: React (CRA), deployed via Vercel.
- **Backend**: Google Apps Script (`Code.gs`), deployed as a Web App.
- **Data**: Google Sheets (inspection data, history, product mapping).
- **Criteria**: Google Drive folder tree (PPT/image slides per product).

---

## Criteria Search

### Flow

1. User types a product name in `CriteriaPage.jsx`.
2. `resolveSearchQuery()` normalises the raw name:
   - Names with `)` separators (brand prefix like `FCS)`, `신선특별시)`) go through
     `getBroadCriteriaKeyword` / `extractCriteriaKeyword`.
   - Plain names use `normalizeCriteriaKeyword`.
3. The cleaned keyword is passed to `useCriteriaSearch` hook → `search(keyword, rawName)`.
4. Hook POSTs `{ action:'searchCriteria', keyword, productName }` to the GAS backend.
5. GAS `searchInspectionCriteriaFolders_(keyword, rawName)` runs:
   - **Step 1**: detect category (`getCriteriaCategory_` → 매핑 sheet, then `detectCriteriaCategory_` heuristic).
   - **Step 2**: open Drive root, find the category folder.
   - **Step 3**: recursively collect leaf product folders via `collectProductFolders_()`.
   - **Step 4**: score each folder against `buildCriteriaQueryVariants_(rawName, keyword)`.
   - **Step 5**: fallback if no score > 0 — livestock shows 종합/한돈/한우, seafood shows 종합, produce returns all leaves tagged `isCategoryFallback: true`.
6. Frontend displays results; clicking a result calls `loadImages(folder)` to fetch slides.

### Key utilities (`src/utils/useCriteriaSearch.js`)

| Function | Purpose |
|---|---|
| `normalizeCriteriaKeyword(raw)` | Strip origin prefixes, weight/unit suffixes |
| `extractCriteriaKeyword(raw)` | Extract core word after last `)` prefix |
| `getBroadCriteriaKeyword(raw)` | Return broad category keyword from known brand-tagged names |
| `useCriteriaSearch()` | React hook managing search/image loading state |

---

## Recursive Folder Traversal (`Code.gs`)

### `collectProductFolders_(folder, groupName)`

Depth-first traversal that returns only **leaf folders** (no sub-folders).
Used by `searchInspectionCriteriaFolders_` to handle Drive structures of any depth:

```
채소/마늘/          ← leaf, no sub-folders
축산/품질관리팀_.../한돈/목살/  ← leaf after 2 container layers
```

### `buildFolderTree_(folder)`

Recursively builds `{ id, name, children }` tree for the category browser.
Children are sorted alphabetically.
Result is cached 10 min by `getCriteriaTree_` (cache key `criteriaTree_v3`).

---

## Criteria Browser UI (`CriteriaPage.jsx`)

`CriteriaBrowser` loads the folder tree once on mount via `fetchCriteriaTree()`.
Renders top-level categories as accordion sections.

Each category's children are rendered by `FolderNode` (recursive):
- **Leaf node** (`children === []`): renders as a button → calls `loadImages()`.
- **Container node**: renders as an expand/collapse accordion.
- **Auto-expand**: a container node whose direct children are ALL leaves opens
  automatically (avoids clicking through a single-name wrapper layer like
  `품질관리팀_상품검수기준표_축산`).

Navigation model: `category → (0..n container layers) → leaf → image viewer`

---

## Partner Accordion Scroll Stabilisation (`InspectionPage.jsx`)

### Problem

When a partner section opens, framer-motion animates height from `0 → auto`.
A fixed timeout (previous approach: `setTimeout(300ms)`) caused scroll to fire
before layout finished, leaving the view at a wrong position.

### Solution — ResizeObserver

When `openPartner` changes, a `ResizeObserver` is attached to the active
partner's card wrapper div.  The observer fires every time framer-motion updates
the element's height.  A 50 ms debounce on the *last* resize event scrolls the
element into view with `behavior: 'instant'` (smooth conflicts with the
in-progress CSS animation on iOS Safari).

```
openPartner changes
  → attach ResizeObserver to partnerCardRefs.current[openPartner]
  → debounce 50 ms after last resize callback
  → scrollIntoView({ behavior: 'instant', block: 'start' })
  → disconnect observer
```

---

## Code.gs Sections

| Section header | Functions |
|---|---|
| `INSPECTION CRITERIA SEARCH` | `buildCriteriaQueryVariants_`, `matchesCriteriaFolder_`, `detectCriteriaCategory_`, `getLivestockSpecialCandidates_`, `getCriteriaCategory_`, `collectProductFolders_`, `buildFolderTree_`, `searchInspectionCriteriaFolders_`, `getCriteriaTree_` |
| `INSPECTION DATA` | save/load inspection rows, history sync |
| `PHOTO HANDLING` | Drive image fetch, thumbnail generation |
| `UTILITIES` | sheet helpers, cache wrappers |
