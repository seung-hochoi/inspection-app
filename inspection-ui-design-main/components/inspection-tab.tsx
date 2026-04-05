"use client"

import { useState, useMemo } from "react"
import { Search, ScanBarcode, Camera, ChevronDown, ChevronUp, ChevronRight, Filter, FolderOpen, FolderClosed, ImageOff, ListFilter } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { InspectionItem } from "@/lib/types"

interface InspectionTabProps {
  items: InspectionItem[]
  onUpdateQuantity: (id: string, quantity: number) => void
  onSaveAll: () => void
}

type FilterMode = "all" | "not-entered" | "no-photo"

export function InspectionTab({ items, onUpdateQuantity, onSaveAll }: InspectionTabProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set())
  const [filterMode, setFilterMode] = useState<FilterMode>("all")
  const [allExpanded, setAllExpanded] = useState(false)

  // Group items by supplier
  const groupedItems = useMemo(() => {
    let filtered = items.filter(
      (item) =>
        item.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.supplier.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.productCode?.toLowerCase().includes(searchQuery.toLowerCase())
    )

    // Apply filter mode
    if (filterMode === "not-entered") {
      filtered = filtered.filter((item) => !item.inspectedQuantity || item.inspectedQuantity === 0)
    } else if (filterMode === "no-photo") {
      filtered = filtered.filter((item) => !item.hasPhoto)
    }

    const grouped = filtered.reduce((acc, item) => {
      if (!acc[item.supplier]) {
        acc[item.supplier] = []
      }
      acc[item.supplier].push(item)
      return acc
    }, {} as Record<string, InspectionItem[]>)

    return grouped
  }, [items, searchQuery, filterMode])

  const toggleSupplier = (supplier: string) => {
    setExpandedSuppliers((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(supplier)) {
        newSet.delete(supplier)
      } else {
        newSet.add(supplier)
      }
      return newSet
    })
  }

  const expandAll = () => {
    setExpandedSuppliers(new Set())
    setAllExpanded(false)
  }

  const collapseAll = () => {
    setExpandedSuppliers(new Set(Object.keys(groupedItems)))
    setAllExpanded(true)
  }

  const totalProducts = items.length
  const totalInspected = items.reduce((sum, item) => sum + item.inspectedQuantity, 0)
  const enteredCount = items.filter((item) => item.inspectedQuantity > 0).length

  const handleBarcodeScan = () => {
    alert("바코드 스캔 기능")
  }

  const handlePhotoUpload = (id: string) => {
    alert(`상품 ${id} 사진 업로드`)
  }

  const isItemComplete = (item: InspectionItem) => item.inspectedQuantity > 0

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header Section */}
      <div className="border-b border-border bg-card shadow-sm">
        {/* Title */}
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">검품 목록</h2>
        </div>
        
        {/* Search Bar and Actions */}
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="상품명/바코드 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-input pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBarcodeScan}
                className="h-10 gap-2 border-primary/30 text-primary hover:bg-primary/5"
              >
                <ScanBarcode className="h-4 w-4" />
                <span className="hidden sm:inline">바코드 스캔</span>
              </Button>
              <select className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground">
                <option>협력사별 정렬</option>
                <option>상품명 정렬</option>
                <option>미검품 우선</option>
              </select>
              <Button onClick={onSaveAll} className="h-10 shrink-0 bg-primary px-6 text-primary-foreground hover:bg-primary/90">
                저장(일괄)
              </Button>
            </div>
          </div>

          {/* Filter Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-border bg-secondary/30 p-1">
              <Button
                variant={allExpanded ? "ghost" : "secondary"}
                size="sm"
                onClick={expandAll}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                전체 펼치기
              </Button>
              <Button
                variant={allExpanded ? "secondary" : "ghost"}
                size="sm"
                onClick={collapseAll}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <FolderClosed className="h-3.5 w-3.5" />
                전체 접기
              </Button>
            </div>
            
            <div className="h-4 w-px bg-border" />
            
            <div className="flex items-center gap-1 rounded-md border border-border bg-secondary/30 p-1">
              <Button
                variant={filterMode === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFilterMode("all")}
                className="h-7 px-2 text-xs"
              >
                전체
              </Button>
              <Button
                variant={filterMode === "not-entered" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFilterMode("not-entered")}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <ListFilter className="h-3.5 w-3.5" />
                미입력만
              </Button>
              <Button
                variant={filterMode === "no-photo" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFilterMode("no-photo")}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <ImageOff className="h-3.5 w-3.5" />
                사진 없음
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Item List */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-4">
          {Object.entries(groupedItems).map(([supplier, supplierItems]) => {
            const isCollapsed = expandedSuppliers.has(supplier)
            const supplierInspectedCount = supplierItems.filter((item) => item.inspectedQuantity > 0).length
            
            return (
              <div key={supplier} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                {/* Supplier Header */}
                <button
                  onClick={() => toggleSupplier(supplier)}
                  className="flex w-full items-center justify-between bg-gradient-to-r from-secondary/80 to-secondary/40 px-4 py-3 text-left transition-colors hover:from-secondary hover:to-secondary/60"
                >
                  <div className="flex items-center gap-3">
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${!isCollapsed ? "rotate-90" : ""}`} />
                    <Badge variant="outline" className="border-primary/30 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary">
                      {supplier}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      ({supplierInspectedCount}/{supplierItems.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {supplierInspectedCount === supplierItems.length && supplierItems.length > 0 && (
                      <Badge className="bg-success/10 text-success border-0 text-xs">완료</Badge>
                    )}
                  </div>
                </button>

                {/* Table Header */}
                {!isCollapsed && (
                  <>
                    <div className="hidden border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[56px_1fr_90px_80px_120px_100px]">
                      <div></div>
                      <div className="flex items-center gap-6">
                        <span>상품명</span>
                        <span className="text-muted-foreground/70">상품코드</span>
                        <span className="text-muted-foreground/70">협력사</span>
                      </div>
                      <div className="text-center">발주수량</div>
                      <div></div>
                      <div className="text-center">검품수량</div>
                      <div className="text-center">사진</div>
                    </div>

                    {/* Items */}
                    <div className="divide-y divide-border/50">
                      {supplierItems.map((item) => {
                        const isComplete = isItemComplete(item)
                        
                        return (
                          <div
                            key={item.id}
                            className={`flex flex-col gap-3 p-3 transition-colors sm:grid sm:grid-cols-[56px_1fr_90px_80px_120px_100px] sm:items-center sm:gap-4 sm:px-4 sm:py-3 ${
                              isComplete ? "bg-success/5" : "hover:bg-muted/30"
                            }`}
                          >
                            {/* Product Image */}
                            <div className="flex items-start gap-3 sm:contents">
                              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted sm:h-12 sm:w-12">
                                <img
                                  src={item.productImage}
                                  alt={item.productName}
                                  className="h-full w-full object-cover"
                                />
                                {isComplete && (
                                  <div className="absolute inset-0 flex items-center justify-center bg-success/20">
                                    <div className="h-2 w-2 rounded-full bg-success" />
                                  </div>
                                )}
                              </div>

                              {/* Product Info */}
                              <div className="flex flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-6">
                                <p className={`text-sm font-medium sm:flex-1 ${isComplete ? "text-success" : "text-foreground"}`}>
                                  {item.productName}
                                </p>
                                <span className="text-xs text-muted-foreground sm:w-20">
                                  {item.productCode || "-"}
                                </span>
                                <Badge variant="secondary" className="w-fit text-xs sm:hidden">
                                  {supplier}
                                </Badge>
                              </div>
                            </div>

                            {/* Quantities and Actions Row */}
                            <div className="flex items-center justify-between gap-3 sm:contents">
                              {/* Order Quantity */}
                              <div className="flex items-center gap-2 sm:justify-center">
                                <span className="text-xs text-muted-foreground sm:hidden">발주:</span>
                                <span className="text-sm font-semibold text-foreground">
                                  {item.orderQuantity}
                                </span>
                              </div>

                              {/* Arrow indicator */}
                              <div className="hidden text-center text-muted-foreground sm:block">
                                <ChevronRight className="mx-auto h-4 w-4" />
                              </div>

                              {/* Inspection Quantity Input */}
                              <div className="flex items-center gap-2 sm:justify-center">
                                <span className="text-xs text-muted-foreground sm:hidden">검품:</span>
                                <Input
                                  type="number"
                                  value={item.inspectedQuantity || ""}
                                  onChange={(e) => onUpdateQuantity(item.id, parseInt(e.target.value) || 0)}
                                  className={`h-10 w-24 text-center text-base font-medium ${
                                    isComplete 
                                      ? "border-success/50 bg-success/10 text-success" 
                                      : "border-primary/30 bg-card"
                                  }`}
                                  placeholder="0"
                                  min={0}
                                />
                              </div>

                              {/* Photo Button */}
                              <Button
                                variant="outline"
                                onClick={() => handlePhotoUpload(item.id)}
                                className={`h-10 gap-2 px-3 ${
                                  item.hasPhoto
                                    ? "border-success/50 bg-success/10 text-success hover:bg-success/20"
                                    : "border-primary/30 text-primary hover:bg-primary/5"
                                }`}
                              >
                                <Camera className="h-4 w-4" />
                                <span className="text-xs font-medium">검품사진</span>
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          })}

          {Object.keys(groupedItems).length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-16 text-muted-foreground">
              <Search className="mb-3 h-10 w-10 opacity-50" />
              <p className="text-sm">검색 결과가 없습니다</p>
              <p className="mt-1 text-xs text-muted-foreground/70">다른 검색어를 입력해 보세요</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer Summary - Fixed */}
      <div className="border-t border-border bg-gradient-to-r from-success/10 to-primary/5 p-4 shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">입력 중 합계</span>
                <Badge variant="secondary" className="font-medium">
                  전체 {totalProducts}건
                </Badge>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">검품수량</span>
                <span className="text-lg font-bold text-primary">{totalInspected}</span>
              </div>
            </div>
            <Button onClick={onSaveAll} size="lg" className="bg-primary px-8 text-primary-foreground hover:bg-primary/90 sm:hidden">
              저장(일괄)
            </Button>
          </div>
          <div className="space-y-0.5 text-xs text-success">
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
              수량 입력 시 자동 로컬저장 (서버 저장 X)
            </p>
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
              사진 촬영/업로드 시 자동 업로드 & 저장
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
