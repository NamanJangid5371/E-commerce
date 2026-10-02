export type RingSizeSystem = "INDIA" | "US" | "UK" | "EU";

export type RingSizeRow = {
  india: string;
  us: string;
  uk: string;
  eu: string;
  diameterMm: number;
  circumferenceMm: number;
};

export const RING_SIZE_TABLE: RingSizeRow[] = [
  { india: "6", us: "3.5", uk: "F", eu: "46", diameterMm: 14.9, circumferenceMm: 46.8 },
  { india: "7", us: "4", uk: "G", eu: "48", diameterMm: 15.3, circumferenceMm: 48.0 },
  { india: "8", us: "4.5", uk: "H", eu: "49", diameterMm: 15.7, circumferenceMm: 49.3 },
  { india: "9", us: "5", uk: "I", eu: "50", diameterMm: 16.1, circumferenceMm: 50.6 },
  { india: "10", us: "5.5", uk: "J", eu: "52", diameterMm: 16.5, circumferenceMm: 51.9 },
  { india: "11", us: "6", uk: "K", eu: "53", diameterMm: 16.9, circumferenceMm: 53.1 },
  { india: "12", us: "6.5", uk: "L", eu: "54", diameterMm: 17.3, circumferenceMm: 54.4 },
  { india: "13", us: "7", uk: "M", eu: "55", diameterMm: 17.7, circumferenceMm: 55.7 },
  { india: "14", us: "7.5", uk: "N", eu: "57", diameterMm: 18.1, circumferenceMm: 57.0 },
  { india: "15", us: "8", uk: "O", eu: "58", diameterMm: 18.5, circumferenceMm: 58.3 },
  { india: "16", us: "8.5", uk: "P", eu: "59", diameterMm: 18.9, circumferenceMm: 59.5 },
  { india: "17", us: "9", uk: "Q", eu: "60", diameterMm: 19.4, circumferenceMm: 60.8 },
  { india: "18", us: "9.5", uk: "R", eu: "62", diameterMm: 19.8, circumferenceMm: 62.1 },
  { india: "19", us: "10", uk: "S", eu: "63", diameterMm: 20.2, circumferenceMm: 63.4 },
  { india: "20", us: "10.5", uk: "T", eu: "64", diameterMm: 20.6, circumferenceMm: 64.6 },
];

type RingSizeKey = "india" | "us" | "uk" | "eu";

const SYSTEM_KEY: Record<RingSizeSystem, RingSizeKey> = {
  INDIA: "india",
  US: "us",
  UK: "uk",
  EU: "eu",
};

function normalizeValue(system: RingSizeSystem, value: string | number): string {
  const raw = String(value).trim();
  if (system === "US") {
    return raw.replace(/\s+/g, "");
  }
  if (system === "UK") {
    return raw.toUpperCase();
  }
  return raw;
}

function findRowBySystem(system: RingSizeSystem, value: string | number): RingSizeRow | null {
  const key = SYSTEM_KEY[system];
  const normalized = normalizeValue(system, value);
  return RING_SIZE_TABLE.find((row) => row[key] === normalized) ?? null;
}

export function convertRingSize(
  from: RingSizeSystem,
  to: RingSizeSystem,
  value: string | number,
): string | null {
  if (from === to) {
    return normalizeValue(from, value);
  }

  const row = findRowBySystem(from, value);
  if (!row) {
    return null;
  }

  return row[SYSTEM_KEY[to]];
}

export function recommendIndiaSize(fingerCircumferenceMm: number): string | null {
  if (!Number.isFinite(fingerCircumferenceMm) || fingerCircumferenceMm <= 0) {
    return null;
  }

  let closest = RING_SIZE_TABLE[0];
  let smallestDelta = Math.abs(fingerCircumferenceMm - closest.circumferenceMm);

  for (const row of RING_SIZE_TABLE) {
    const delta = Math.abs(fingerCircumferenceMm - row.circumferenceMm);
    if (delta < smallestDelta) {
      smallestDelta = delta;
      closest = row;
    }
  }

  return closest.india;
}

export function getRingSizeRow(
  system: RingSizeSystem,
  value: string | number,
): RingSizeRow | null {
  return findRowBySystem(system, value);
}
