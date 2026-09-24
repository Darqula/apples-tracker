export const DEFAULT_API_BASE_URL = "http://127.0.0.1:3001";

export function resolveApiBaseUrl(): string {
  return process.env.APPLES_API_URL ?? DEFAULT_API_BASE_URL;
}

export class ApiCallError extends Error {
  constructor(
    readonly status: number = 500,
    readonly code: string = "UNEXPECTED",
    message: string = "",
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export interface ApiClient {
  request<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
}

export type Method = "GET" | "PUT" | "POST" | "PATCH" | "DELETE";

function formatQuery(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.append(key, String(value));
  }
  const encoded = params.toString();
  return encoded.length > 0 ? `?${encoded}` : "";
}

export function unreachableMessage(baseUrl: string): string {
  return `Cannot reach the Apples Tracker API at ${baseUrl}. Start it with \`npm run dev\` (or \`npm start\`).`;
}

export function createApiClient(baseUrl: string): ApiClient {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  return {
    async request<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
      const url = `${trimmed}${path}${options?.query ? formatQuery(options.query) : ""}`;

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
          headers: options?.body !== undefined ? { "content-type": "application/json" } : undefined,
        });
      } catch (cause) {
        throw new ApiCallError(503, "UNREACHABLE", unreachableMessage(trimmed), { cause });
      }

      if (!response.ok) {
        let code = `HTTP_${response.status}`;
        let message = response.statusText || `HTTP ${response.status}`;

        try {
          const payload = (await response.json()) as { error?: { code?: string; message?: string } };
          if (payload.error) {
            code = payload.error.code ?? code;
            message = payload.error.message ?? message;
          }
        } catch {
          // Response body wasn't JSON — keep the default code/message.
        }

        throw new ApiCallError(response.status, code, message);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const raw = await response.text();
      if (raw.length === 0) {
        return undefined as T;
      }

      return JSON.parse(raw) as T;
    },
  };
}
