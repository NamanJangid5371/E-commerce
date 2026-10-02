type ApiPayload<T> = {
  ok?: boolean;
  data?: T;
  error?: string;
};

export type FetchJsonResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number; offline?: boolean };

export function isApiOffline<T>(res: FetchJsonResult<T>): boolean {
  return !res.ok && (res.status === 503 || res.status === 0);
}

export async function fetchJson<T = unknown>(
  url: string,
  options: RequestInit = {},
): Promise<FetchJsonResult<T>> {
  try {
    const res = await fetch(url, {
      ...options,
      cache: options.cache ?? "no-store",
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
    });

    let payload: ApiPayload<T> = {};
    try {
      payload = (await res.json()) as ApiPayload<T>;
    } catch {
      /* non-JSON body */
    }

    if (res.status === 503) {
      return {
        ok: false,
        error: payload.error ?? "Service temporarily unavailable.",
        status: 503,
        offline: true,
      };
    }

    if (!res.ok || payload.ok === false) {
      return {
        ok: false,
        error: payload.error ?? res.statusText ?? "Request failed.",
        status: res.status,
      };
    }

    return { ok: true, data: payload.data as T, status: res.status };
  } catch {
    return {
      ok: false,
      error: "Could not reach the server.",
      status: 0,
      offline: true,
    };
  }
}
