export interface InspectionItem {
  id: string
  productCode?: string
  productImage: string
  productName: string
  supplier: string
  orderQuantity: number
  inspectedQuantity: number
  returnQuantity: number
  exchangeQuantity: number
  inspectionPhotos: string[]
  defectPhotos: string[]
  weightPhotos: string[]
  sweetnessPhotos: string[]
  sweetnessMin: number | null
  sweetnessMax: number | null
  isCompleted: boolean
  inspectedAt?: string
  hasPhoto?: boolean
}

export interface ZipFile {
  name: string
  size: string
}

export interface AnalyticsSummary {
  totalInbound: number
  inspectedQuantity: number
  inspectionRate: number
  skuCoverage: number
}
