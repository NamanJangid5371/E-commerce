export const RING_SIZE_GUIDE = [
  { india: "6", diameter: "14.9", circumference: "46.8" },
  { india: "7", diameter: "15.3", circumference: "48.0" },
  { india: "8", diameter: "15.7", circumference: "49.3" },
  { india: "9", diameter: "16.1", circumference: "50.6" },
  { india: "10", diameter: "16.5", circumference: "51.9" },
  { india: "11", diameter: "16.9", circumference: "53.1" },
  { india: "12", diameter: "17.3", circumference: "54.4" },
  { india: "13", diameter: "17.7", circumference: "55.7" },
  { india: "14", diameter: "18.1", circumference: "57.0" },
  { india: "15", diameter: "18.5", circumference: "58.3" },
  { india: "16", diameter: "18.9", circumference: "59.5" },
  { india: "17", diameter: "19.4", circumference: "60.8" },
  { india: "18", diameter: "19.8", circumference: "62.1" },
  { india: "19", diameter: "20.2", circumference: "63.4" },
  { india: "20", diameter: "20.6", circumference: "64.6" },
] as const;

export const RING_SIZE_OPTIONS = RING_SIZE_GUIDE.map((r) => r.india);
