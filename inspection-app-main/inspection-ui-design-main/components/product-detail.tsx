"use client"

import { useState } from "react"
import { Plus, X, Camera, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { InspectionItem } from "@/lib/types"

interface ProductDetailProps {
  item: InspectionItem
  onSave: (item: InspectionItem) => void
  onClose: () => void
}

export function ProductDetail({ item, onSave, onClose }: ProductDetailProps) {
  const [formData, setFormData] = useState<InspectionItem>({ ...item })

  const handleInputChange = (field: keyof InspectionItem, value: number | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const sweetnessAverage =
    formData.sweetnessMin !== null && formData.sweetnessMax !== null
      ? ((formData.sweetnessMin + formData.sweetnessMax) / 2).toFixed(1)
      : null

  const handleSave = () => {
    onSave(formData)
  }

  const handleAddPhoto = (type: "inspectionPhotos" | "defectPhotos" | "weightPhotos" | "sweetnessPhotos") => {
    const newPhoto = "/placeholder.svg?height=100&width=100"
    setFormData((prev) => ({
      ...prev,
      [type]: [...prev[type], newPhoto],
    }))
  }

  const handleRemovePhoto = (
    type: "inspectionPhotos" | "defectPhotos" | "weightPhotos" | "sweetnessPhotos",
    index: number
  ) => {
    setFormData((prev) => ({
      ...prev,
      [type]: prev[type].filter((_, i) => i !== index),
    }))
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Quantity Stats */}
      <div className="grid grid-cols-3 gap-3 border-b border-border bg-card p-4">
        <div className="rounded-lg border border-primary bg-primary/5 p-3 text-center">
          <p className="text-xs text-muted-foreground">검품수량</p>
          <p className="text-2xl font-bold text-primary">{formData.inspectedQuantity}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <p className="text-xs text-muted-foreground">회송수량</p>
          <p className="text-2xl font-bold text-card-foreground">{formData.returnQuantity}</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-center">
          <p className="text-xs text-muted-foreground">교환수량</p>
          <p className="text-2xl font-bold text-destructive">{formData.exchangeQuantity}</p>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-auto p-4">
        {/* Photo Management Section */}
        <div>
          <h3 className="mb-4 text-sm font-semibold text-foreground">사진 관리</h3>
          
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Inspection Photos */}
            <PhotoSection
              title="검품사진"
              count={formData.inspectionPhotos.length}
              photos={formData.inspectionPhotos}
              onAdd={() => handleAddPhoto("inspectionPhotos")}
              onRemove={(index) => handleRemovePhoto("inspectionPhotos", index)}
            />
            
            {/* Defect Photos */}
            <PhotoSection
              title="불량사진"
              count={formData.defectPhotos.length}
              photos={formData.defectPhotos}
              onAdd={() => handleAddPhoto("defectPhotos")}
              onRemove={(index) => handleRemovePhoto("defectPhotos", index)}
              variant="destructive"
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {/* Weight Photos */}
            <PhotoSection
              title="중량사진"
              count={formData.weightPhotos.length}
              photos={formData.weightPhotos}
              onAdd={() => handleAddPhoto("weightPhotos")}
              onRemove={(index) => handleRemovePhoto("weightPhotos", index)}
              maxPhotos={4}
            />
            
            {/* Sweetness Section */}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-medium text-card-foreground">당도 (브릭스)</h4>
                <Button variant="ghost" size="sm" onClick={() => handleAddPhoto("sweetnessPhotos")} className="h-7 text-xs">
                  + 사진추가
                </Button>
              </div>
              
              {/* Sweetness Photos */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {formData.sweetnessPhotos.map((photo, index) => (
                  <div
                    key={index}
                    className="group relative h-10 w-10 overflow-hidden rounded border border-border"
                  >
                    <img src={photo} alt={`Sweetness ${index + 1}`} className="h-full w-full object-cover" />
                    <button
                      onClick={() => handleRemovePhoto("sweetnessPhotos", index)}
                      className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px]"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Sweetness Inputs */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="w-14 text-xs text-muted-foreground">최저값</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={formData.sweetnessMin ?? ""}
                    onChange={(e) =>
                      handleInputChange("sweetnessMin", e.target.value ? parseFloat(e.target.value) : null)
                    }
                    className="h-8 flex-1"
                    placeholder="0.0"
                  />
                  <span className="text-xs text-muted-foreground">°Bx</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-14 text-xs text-muted-foreground">최고값</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={formData.sweetnessMax ?? ""}
                    onChange={(e) =>
                      handleInputChange("sweetnessMax", e.target.value ? parseFloat(e.target.value) : null)
                    }
                    className="h-8 flex-1"
                    placeholder="0.0"
                  />
                  <span className="text-xs text-muted-foreground">°Bx</span>
                </div>
                
                {sweetnessAverage && (
                  <div className="mt-2 flex items-center justify-center gap-2 rounded-md bg-success/10 p-2">
                    <AlertCircle className="h-4 w-4 text-success" />
                    <span className="text-sm font-semibold text-success">
                      평균 {sweetnessAverage} °Bx
                    </span>
                    <span className="text-xs text-success/80">(자동계산)</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Edit Quantities */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="mb-3 text-sm font-medium text-card-foreground">수량 수정</h4>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="inspected" className="text-xs text-muted-foreground">
                검품수량
              </Label>
              <Input
                id="inspected"
                type="number"
                value={formData.inspectedQuantity || ""}
                onChange={(e) => handleInputChange("inspectedQuantity", parseInt(e.target.value) || 0)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="return" className="text-xs text-muted-foreground">
                회송수량
              </Label>
              <Input
                id="return"
                type="number"
                value={formData.returnQuantity || ""}
                onChange={(e) => handleInputChange("returnQuantity", parseInt(e.target.value) || 0)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exchange" className="text-xs text-muted-foreground">
                교환수량
              </Label>
              <Input
                id="exchange"
                type="number"
                value={formData.exchangeQuantity || ""}
                onChange={(e) => handleInputChange("exchangeQuantity", parseInt(e.target.value) || 0)}
                className="h-9"
              />
            </div>
          </div>
        </div>

        {/* Info Notes */}
        <div className="rounded-lg bg-success/10 p-3 text-xs text-success">
          <p>✓ 사진 업로드 시 자동저장 & 중복 자동정리</p>
          <p>✓ 각 사진 우측 상단 X로 삭제 가능</p>
          <p>✓ 수정 버튼으로 모든 정보 수정 가능</p>
        </div>
      </div>

      {/* Save Button */}
      <div className="border-t border-border bg-card p-4">
        <Button onClick={handleSave} className="w-full">
          수정 저장
        </Button>
      </div>
    </div>
  )
}

interface PhotoSectionProps {
  title: string
  count: number
  photos: string[]
  onAdd: () => void
  onRemove: (index: number) => void
  maxPhotos?: number
  variant?: "default" | "destructive"
}

function PhotoSection({ title, count, photos, onAdd, onRemove, maxPhotos, variant = "default" }: PhotoSectionProps) {
  const canAddMore = maxPhotos === undefined || photos.length < maxPhotos
  const borderClass = variant === "destructive" ? "border-destructive/30" : "border-border"

  return (
    <div className={`rounded-lg border ${borderClass} bg-card p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium text-card-foreground">
          {title} ({count})
        </h4>
        {canAddMore && (
          <Button variant="ghost" size="sm" onClick={onAdd} className="h-7 text-xs">
            + 사진추가
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {photos.map((photo, index) => (
          <div
            key={index}
            className="group relative h-14 w-14 overflow-hidden rounded-md border border-border"
          >
            <img src={photo} alt={`${title} ${index + 1}`} className="h-full w-full object-cover" />
            <button
              onClick={() => onRemove(index)}
              className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
        {photos.length === 0 && (
          <button
            onClick={onAdd}
            className="flex h-14 w-14 items-center justify-center rounded-md border border-dashed border-border bg-muted/50 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <Camera className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  )
}
