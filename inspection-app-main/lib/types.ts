// lib/types.ts

export interface InspectionItem {
    id: string;
    name: string;
    description: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface ZipFile {
    fileName: string;
    size: number;
    lastModified: Date;
}

export interface AnalyticsSummary {
    totalInspections: number;
    passed: number;
    failed: number;
    inProgress: number;
}