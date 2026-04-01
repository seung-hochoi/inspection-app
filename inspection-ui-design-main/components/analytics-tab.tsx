"use client"

import { useState } from "react"
import { Package, CheckCircle2, Percent, Layers, Calculator, Phone, Download, FileArchive, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { InspectionItem, ZipFile } from "@/lib/types"
import { mockZipFiles } from "@/lib/mock-data"

interface AnalyticsTabProps {
  items: InspectionItem[]
}

export function AnalyticsTab({ items }: AnalyticsTabProps) {
  const [isCalculating, setIsCalculating] = useState(false)
  const [showSummary, setShowSummary] = useState(false)

  const totalInbound = items.reduce((sum, item) => sum + item.orderQuantity, 0)
  const inspectedQuantity = items.reduce((sum, item) => sum + item.inspectedQuantity, 0)
  const inspectionRate = totalInbound > 0 ? ((inspectedQuantity / totalInbound) * 100).toFixed(1) : "0"
  const completedItems = items.filter((item) => item.isCompleted).length
  const skuCoverage = items.length > 0 ? ((completedItems / items.length) * 100).toFixed(1) : "0"

  const handleSummaryCalculation = async () => {
    setIsCalculating(true)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setShowSummary(true)
    setIsCalculating(false)
  }

  const handleHappyCallAnalysis = async () => {
    setIsCalculating(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    alert("해피콜 분석이 완료되었습니다.")
    setIsCalculating(false)
  }

  const handleDownloadZip = (file: ZipFile) => {
    alert(`${file.name} 다운로드 시작`)
  }

  return (
    <div className="h-full overflow-auto">
      <div className="grid gap-6 p-4 lg:grid-cols-2">
        {/* Left Column - Stats */}
        <div className="space-y-6">
          {/* Stats Header */}
          <Card className="p-4">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-primary/20 text-xs font-bold text-primary">4</span>
              <h2 className="text-base font-semibold text-card-foreground">통계 탭</h2>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={<Package className="h-4 w-4" />}
                label="총 입고수량"
                value={totalInbound.toLocaleString()}
                color="blue"
              />
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="검품 수량"
                value={inspectedQuantity.toLocaleString()}
                color="green"
              />
              <StatCard
                icon={<Percent className="h-4 w-4" />}
                label="검품율"
                value={`${inspectionRate}%`}
                color="yellow"
              />
              <StatCard
                icon={<Layers className="h-4 w-4" />}
                label="SKU 커버리지"
                value={`${skuCoverage}%`}
                subtitle={`${completedItems}/${items.length} SKU`}
                color="purple"
              />
            </div>
          </Card>

          {/* Action Buttons */}
          <Card className="p-4">
            <div className="flex flex-col gap-3">
              <Button
                onClick={handleSummaryCalculation}
                disabled={isCalculating}
                className="h-12 bg-success text-success-foreground hover:bg-success/90"
              >
                <Calculator className="mr-2 h-5 w-5" />
                {isCalculating ? "계산 중..." : "요약 계산"}
              </Button>
              <Button
                onClick={handleHappyCallAnalysis}
                disabled={isCalculating}
                variant="outline"
                className="h-12 border-warning text-warning hover:bg-warning/10"
              >
                <Phone className="mr-2 h-5 w-5" />
                {isCalculating ? "분석 중..." : "해피콜 분석"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                버튼 클릭 시에만<br />전체 계산 수행<br />(자동 계산 제거)
              </p>
            </div>
          </Card>
        </div>

        {/* Right Column - ZIP Downloads & Info */}
        <div className="space-y-6">
          {/* ZIP Download Section */}
          <Card className="p-4">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-destructive/20 text-xs font-bold text-destructive">5</span>
              <h2 className="text-base font-semibold text-card-foreground">ZIP 다운로드</h2>
              <span className="text-xs text-muted-foreground">(20MB 분할)</span>
            </div>

            <div className="space-y-2">
              {mockZipFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3 transition-colors hover:bg-secondary/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-card text-muted-foreground">
                      <FileArchive className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-card-foreground">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{file.size}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownloadZip(file)}
                    className="gap-1.5"
                  >
                    <Download className="h-4 w-4" />
                    다운로드
                  </Button>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-xs text-success">
              <Check className="h-4 w-4 shrink-0" />
              <span>20MB 초과 시 새 ZIP 파일로 분할</span>
            </div>
          </Card>

          {/* Data Structure Info */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-card-foreground">데이터 구조</h3>
            
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-medium text-card-foreground">inspection_rows 시트</p>
                <div className="flex flex-wrap gap-1">
                  {["상품코드", "상품명", "협력사", "센터", "발주수량", "검품수량", "회송수량", "교환수량"].map((field) => (
                    <span key={field} className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                      {field}
                    </span>
                  ))}
                </div>
              </div>
              
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-medium text-card-foreground">photo_records 시트</p>
                <div className="flex flex-wrap gap-1">
                  {["상품코드", "협력사", "사진타입", "파일URL", "업로드시간"].map((field) => (
                    <span key={field} className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                      {field}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* Key Changes & Benefits */}
          <Card className="border-primary/20 bg-primary/5 p-4">
            <h3 className="mb-3 text-sm font-semibold text-primary">주요 변경점 & 기대효과</h3>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>수량 입력 : 자동저장 → 로컬저장 후 일괄저장</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>사진 : 촬영/업로드 즉시 자동저장</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Summary/Happycall : 버튼 클릭 시에만 계산</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>ZIP 다운로드 : 20MB 초과 시 자동 분할</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>내역 : 각 카드 삭제(X), 수정 가능</span>
              </li>
            </ul>
            <p className="mt-3 text-xs font-medium text-success">→ 속도 10배 향상, UI 단순화, 안정성 증가</p>
          </Card>
        </div>
      </div>
    </div>
  )
}

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string
  subtitle?: string
  color: "blue" | "green" | "yellow" | "purple"
}

function StatCard({ icon, label, value, subtitle, color }: StatCardProps) {
  const colorClasses = {
    blue: "bg-primary/10 text-primary border-primary/20",
    green: "bg-success/10 text-success border-success/20",
    yellow: "bg-warning/10 text-warning border-warning/20",
    purple: "bg-chart-4/10 text-chart-4 border-chart-4/20",
  }

  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 ${colorClasses[color]}`}>
      <div className="shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs opacity-80">{label}</p>
        <p className="text-lg font-bold">{value}</p>
        {subtitle && <p className="text-xs opacity-70">{subtitle}</p>}
      </div>
    </div>
  )
}
