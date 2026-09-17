"use client";

/** Typed client-side fetch helpers for DukaFlow APIs. */

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
      if (data?.blocked?.reason) message = data.blocked.reason;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: async <T>(path: string): Promise<T> => handle<T>(await fetch(path, { cache: "no-store" })),
  post: async <T>(path: string, body: unknown): Promise<T> =>
    handle<T>(
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ),
  patch: async <T>(path: string, body: unknown): Promise<T> =>
    handle<T>(
      await fetch(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ),
  put: async <T>(path: string, body: unknown): Promise<T> =>
    handle<T>(
      await fetch(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ),
  del: async <T>(path: string): Promise<T> => handle<T>(await fetch(path, { method: "DELETE" })),
};
