"use client"

import { useState, useEffect } from "react"
import { ClipboardCheck, FileText, BarChart3, FileSpreadsheet, Upload, Save, BookOpen, Calculator } from "lucide-react"
import { InspectionTab } from "@/components/inspection-tab"
import { RecordsTab } from "@/components/records-tab"
import { AnalyticsTab } from "@/components/analytics-tab"
import { mockInspectionItems } from "@/lib/mock-data"
import { InspectionItem } from "@/lib/types"

type Tab = "inspection" | "records" | "analytics"

export default function InspectionSystem() {
  const [activeTab, setActiveTab] = useState<Tab>("inspection")
  const [items, setItems] = useState<InspectionItem[]>(mockInspectionItems)
  const [currentDate, setCurrentDate] = useState<string>("")

  useEffect(() => {
    setCurrentDate(
      new Date().toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    )
  }, [])

  const handleUpdateQuantity = (id: string, quantity: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, inspectedQuantity: quantity } : item
      )
    )
  }

  const handleSaveAll = () => {
    setItems((prev) =>
      prev.map((item) =>
        item.inspectedQuantity > 0 ? { ...item, isCompleted: true } : item
      )
    )
    alert("저장되었습니다")
  }

  const handleUpdateItem = (updatedItem: InspectionItem) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updatedItem.id ? updatedItem : item))
    )
  }

  const handleDeleteItem = (id: string) => {
    if (confirm("정말 삭제하시겠습니까?")) {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, isCompleted: false, inspectedQuantity: 0 }
            : item
        )
      )
    }
  }

  const tabs = [
    { id: "inspection" as Tab, label: "검품", icon: ClipboardCheck, badge: "1" },
    { id: "records" as Tab, label: "내역", icon: FileText, badge: "2" },
    { id: "analytics" as Tab, label: "통계", icon: BarChart3, badge: "3" },
  ]

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="border-b border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-foreground">검품 시스템</h1>
            <span className="rounded-full bg-success/20 px-3 py-0.5 text-xs font-medium text-success">
              개선 설계도
            </span>
          </div>
          
          <div className="hidden items-center gap-1 text-xs text-muted-foreground lg:flex">
            <WorkflowStep icon={<FileSpreadsheet className="h-3.5 w-3.5" />} label="CSV" sublabel="업로드" />
            <span className="text-muted-foreground">→</span>
            <WorkflowStep icon={<Upload className="h-3.5 w-3.5" />} label="로컬" sublabel="데이터 생성" />
            <span className="text-muted-foreground">→</span>
            <WorkflowStep icon={<ClipboardCheck className="h-3.5 w-3.5" />} label="검품 입력" sublabel="(자동저장)" active />
            <span className="text-muted-foreground">→</span>
            <WorkflowStep icon={<Save className="h-3.5 w-3.5" />} label="서버" sublabel="Batch 저장" />
            <span className="text-muted-foreground">→</span>
            <WorkflowStep icon={<BookOpen className="h-3.5 w-3.5" />} label="Sheets" sublabel="기록" />
            <span className="text-muted-foreground">→</span>
            <WorkflowStep icon={<Calculator className="h-3.5 w-3.5" />} label="요약 계산" sublabel="(버튼 클릭)" />
          </div>
        </div>
        
        <p className="mt-2 text-xs text-muted-foreground">
          자동저장 + 수동계산 방식으로 속도 향상, 사진 자동저장, ZIP 20MB 분할, 내역 삭제/수정 기능 포함
        </p>
      </header>

      <nav className="border-b border-border bg-card">
        <div className="flex">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors sm:flex-none ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded text-xs font-bold ${
                  isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}>
                  {tab.badge}
                </span>
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                {tab.id === "inspection" && <span className="hidden text-xs text-muted-foreground sm:inline">(입력용)</span>}
                {tab.id === "records" && <span className="hidden text-xs text-muted-foreground sm:inline">(조회용)</span>}
                {isActive && (
                  <span className="absolute bottom-0 left-0 h-0.5 w-full bg-primary" />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      <main className="flex-1 overflow-hidden">
        {activeTab === "inspection" && (
          <InspectionTab
            items={items}
            onUpdateQuantity={handleUpdateQuantity}
            onSaveAll={handleSaveAll}
          />
        )}
        {activeTab === "records" && (
          <RecordsTab
            items={items}
            onUpdateItem={handleUpdateItem}
            onDeleteItem={handleDeleteItem}
          />
        )}
        {activeTab === "analytics" && <AnalyticsTab items={items} />}
      </main>
    </div>
  )
}

function WorkflowStep({ 
  icon, 
  label, 
  sublabel, 
  active 
}: { 
  icon: React.ReactNode
  label: string
  sublabel: string
  active?: boolean 
}) {
  return (
    <div className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 ${
      active ? "bg-primary/10" : ""
    }`}>
      <div className={`flex h-7 w-7 items-center justify-center rounded-md border ${
        active 
          ? "border-primary bg-primary/20 text-primary" 
          : "border-border bg-card text-muted-foreground"
      }`}>
        {icon}
      </div>
      <span className={`text-[10px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}>
        {label}
      </span>
      <span className="text-[9px] text-muted-foreground">{sublabel}</span>
    </div>
  )
}
