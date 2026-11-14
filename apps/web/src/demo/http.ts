import type { DemoState } from './state';

export interface DemoRequest {
  state: DemoState;
  request: Request;
  now: number;
  organizationId: string | null;
  contentOrg: string;
  actor: { name: string; id: string; role: string; isPlatformAdmin: boolean };
  params: Record<string, string>;
  query: (key: string) => string | null;
  values: (key: string) => string[];
  body: Record<string, unknown>;
  rawBody: unknown;
}

export type Handler = (context: DemoRequest) => Response;

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function problem(status: number, title: string) {
  return new Response(JSON.stringify({ title, status }), {
    status, headers: { 'Content-Type': 'application/problem+json' },
  });
}

export const ok = () => new Response(null);
export const noContent = () => new Response(null, { status: 204 });
export const missing = () => problem(404, 'Item not found');
export const invalid = (title: string) => problem(400, title);
export const id = () => crypto.randomUUID();
export const created = (data: unknown, location: string) => json(data, 201, { Location: location });

export function withoutScope<T extends { organizationId: string }>(row: T) {
  const { organizationId, ...dto } = row;
  void organizationId;
  return dto;
}

export function scoped<T extends { organizationId?: string | null }>(rows: T[], organizationId: string | null) {
  return rows.filter(row => !organizationId || row.organizationId === organizationId);
}

export function pick(record: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter(key => record[key] !== undefined).map(key => [key, record[key]]));
}
