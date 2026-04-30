import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string): string {
  const parsed = new Date(date);
  if (!date || Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

export function formatDateTime(date: string): string {
  const parsed = new Date(date);
  if (!date || Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function getDaysUntil(date: string): number {
  const now = new Date();
  const target = new Date(date);
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function parseDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getRentalDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0;
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

export function calculateRentalAmount(dailyRate: number, startDate: string, endDate: string): number {
  return Math.max(0, dailyRate) * getRentalDays(startDate, endDate);
}

export function getRentalOverlapDays(
  startDate: string,
  endDate: string,
  periodStart: string,
  periodEnd: string,
): number {
  if (!startDate || !endDate || !periodStart || !periodEnd) return 0;
  const overlapStart = parseDateOnly(startDate) > parseDateOnly(periodStart)
    ? parseDateOnly(startDate)
    : parseDateOnly(periodStart);
  const overlapEnd = parseDateOnly(endDate) < parseDateOnly(periodEnd)
    ? parseDateOnly(endDate)
    : parseDateOnly(periodEnd);

  if (overlapEnd < overlapStart) return 0;
  return getRentalDays(
    toDateOnlyString(overlapStart),
    toDateOnlyString(overlapEnd),
  );
}
