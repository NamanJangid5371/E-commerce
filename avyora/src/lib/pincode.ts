/** Resolve Indian PIN → city/state via India Post public API with local fallback. */

const FALLBACK: Record<string, { city: string; state: string }> = {
  "110001": { city: "New Delhi", state: "Delhi" },
  "400001": { city: "Mumbai", state: "Maharashtra" },
  "560001": { city: "Bengaluru", state: "Karnataka" },
  "600001": { city: "Chennai", state: "Tamil Nadu" },
  "700001": { city: "Kolkata", state: "West Bengal" },
  "500001": { city: "Hyderabad", state: "Telangana" },
  "411001": { city: "Pune", state: "Maharashtra" },
  "380001": { city: "Ahmedabad", state: "Gujarat" },
  "302001": { city: "Jaipur", state: "Rajasthan" },
  "226001": { city: "Lucknow", state: "Uttar Pradesh" },
  "682001": { city: "Kochi", state: "Kerala" },
  "641001": { city: "Coimbatore", state: "Tamil Nadu" },
  "122001": { city: "Gurugram", state: "Haryana" },
  "201301": { city: "Noida", state: "Uttar Pradesh" },
  "751001": { city: "Bhubaneswar", state: "Odisha" },
};

export type PincodeLookup = { city: string; state: string; office?: string };

export async function lookupPincode(pin: string): Promise<PincodeLookup | null> {
  const code = pin.replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) return null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`https://api.postalpincode.in/pincode/${code}`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as {
        Status?: string;
        PostOffice?: { District?: string; State?: string; Name?: string; Block?: string }[];
      }[];
      const row = data?.[0];
      const office = row?.PostOffice?.[0];
      if (row?.Status === "Success" && office?.District && office?.State) {
        return {
          city: office.Block || office.District,
          state: office.State,
          office: office.Name,
        };
      }
    }
  } catch {
    /* fall through */
  }

  return FALLBACK[code] ?? null;
}
