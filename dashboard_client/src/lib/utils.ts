import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function maskPhoneNumber(num: string | null | undefined): string {
  if (!num) return "—";
  const cleaned = num.trim();
  if (cleaned.length <= 4) return cleaned;
  return cleaned.substring(0, cleaned.length - 4).replace(/\d/g, "•") + cleaned.substring(cleaned.length - 4);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

