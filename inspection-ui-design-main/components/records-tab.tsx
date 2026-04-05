"use client"

import { useState } from "react"
import { Pencil, Trash2, X, Search, RefreshCcw, Calculator } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { InspectionItem } from "@/lib/types"
import { ProductDetail } from "@/components/product-detail"

interface RecordsTabProps {
  items: InspectionItem[]
  onUpdateItem: (item: InspectionItem) => void
  onDeleteItem: (id: string) => void
}

export function RecordsTab({ items, onUpdateItem, onDeleteItem }: RecordsTabProps) {
  const [selectedItem, setSelectedItem] = useState<InspectionItem | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  
  const completedItems = items.filter((item) => 
    item.isCompleted && 
    (item.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
     item.supplier.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const handleCardClick = (item: InspectionItem) => {
    setSelectedItem(item)
  }

  const handleCloseDetail = () => {
    setSelectedItem(null)
  }

  const handleSaveDetail = (updatedItem: InspectionItem) => {
    onUpdateItem(updatedItem)
    setSelectedItem(null)
  }

  return (
    <div className="flex h-full">
      {/* Card List */}
      <div className={`flex-1 overflow-auto ${selectedItem ? "hidden lg:block" : ""}`}>
        {/* Search and Actions */}
        <div className="flex flex-col gap-3 border-b border-border bg-card p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="상품명/협력사 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <RefreshCcw className="mr-1.5 h-4 w-4" />
              새로고침
            </Button>
            <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground">
              <Calculator className="mr-1.5 h-4 w-4" />
              요약 계산
            </Button>
          </div>
        </div>

        <div className="p-4">
          <h2 className="mb-4 text-base font-semibold text-foreground">검품 내역</h2>
          
          {completedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-12 text-muted-foreground">
              <p>완료된 검품 내역이 없습니다</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {completedItems.map((item) => (
                <Card
                  key={item.id}
                  className="cursor-pointer overflow-hidden transition-all hover:border-primary/50 hover:shadow-lg"
                  onClick={() => handleCardClick(item)}
                >
                  <div className="p-4">
                    {/* Header with badges */}
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-card-foreground">{item.productName}</h3>
                        <Badge variant="default" className="bg-primary/20 text-primary text-xs">
                          {item.supplier}
                        </Badge>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedItem(item)
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                          수정
                        </Button>
                      </div>
                    </div>

                    {/* Quantities */}
                    <div className="mb-3 flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">검품</span>
                      <span className="font-semibold text-card-foreground">{item.inspectedQuantity}</span>
                      <span className="text-muted-foreground">회송</span>
                      <span className="text-card-foreground">{item.returnQuantity}</span>
                      <span className="text-muted-foreground">/ 교환</span>
                      <span className="text-card-foreground">{item.exchangeQuantity}</span>
                    </div>

                    {/* Photo Category Badges */}
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      <PhotoBadge label="검품" count={item.inspectionPhotos.length} />
                      <PhotoBadge label="불량" count={item.defectPhotos.length} />
                      <PhotoBadge label="중량" count={item.weightPhotos.length} />
                      <PhotoBadge label="당도" count={item.sweetnessPhotos.length} />
                    </div>

                    {/* Photo Previews */}
                    <div className="flex flex-wrap gap-1.5">
                      {[...item.inspectionPhotos, ...item.defectPhotos, ...item.weightPhotos, ...item.sweetnessPhotos]
                        .slice(0, 6)
                        .map((photo, index) => (
                          <div
                            key={index}
                            className="h-12 w-12 overflow-hidden rounded-md border border-border"
                          >
                            <img
                              src={photo}
                              alt={`Photo ${index + 1}`}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ))}
                    </div>

                    {/* Timestamp */}
                    {item.inspectedAt && (
                      <p className="mt-3 text-xs text-muted-foreground">{item.inspectedAt}</p>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Info box */}
          <div className="mt-6 rounded-lg bg-primary/10 p-4">
            <p className="text-sm text-primary">✓ 카드 우측 상단 X : 삭제</p>
            <p className="text-sm text-primary">✓ 카드 우측 하단 수정 : 수정 가능</p>
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex lg:relative lg:inset-auto lg:z-auto lg:w-[480px] lg:border-l lg:border-border">
          {/* Mobile Overlay */}
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm lg:hidden"
            onClick={handleCloseDetail}
          />
          
          {/* Panel Content */}
          <div className="relative ml-auto w-full max-w-md bg-card lg:max-w-none">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-border p-4">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleCloseDetail}>
                    ← 목록으로
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{selectedItem.productName}</span>
                  <Badge className="bg-success/20 text-success text-xs">
                    {selectedItem.supplier}
                  </Badge>
                </div>
                <Button variant="ghost" size="sm">
                  <Pencil className="mr-1 h-3 w-3" />
                  수정
                </Button>
              </div>
              <div className="flex-1 overflow-auto">
                <ProductDetail
                  item={selectedItem}
                  onSave={handleSaveDetail}
                  onClose={handleCloseDetail}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PhotoBadge({ label, count }: { label: string; count: number }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
      count > 0 
        ? "bg-secondary text-secondary-foreground" 
        : "bg-muted/50 text-muted-foreground"
    }`}>
      {label}({count})
    </span>
  )
}
