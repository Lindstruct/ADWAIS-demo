import { analytics } from './analytics';
import { invalid, problem, type Handler } from './http';
import { advanceJobs, operations, resolveActor } from './operations';
import { resources } from './resources';
import { demoAdmin, loadDemoState, saveDemoState } from './state';

export const demoHandlers: Record<string, Handler> = { ...analytics, ...resources, ...operations };
const routes = Object.entries(demoHandlers).map(([key, handler]) => {
  const [method, path] = key.split(' ');
  const names = (path.match(/\{\w+\}/g) ?? []).map(match => match.slice(1, -1));
  const pattern = new RegExp(`^${path.replace(/\./g, '\\.').replace(/\{\w+\}/g, '([^/]+)')}/?$`, 'i');
  return { key, method, handler, names, pattern };
}).sort((a, b) => a.names.length - b.names.length);

const anonymous = new Set([
  'GET /api/demo/token', 'POST /api/kiosk/register', 'GET /api/kiosk/token', 'POST /api/kiosk/swagger-admin-token',
  'GET /api/intranet/calendar/feed.ics', 'DELETE /api/dashboard-session', 'POST /api/webhooks/bulletin-posts',
  'POST /api/webhooks/motastic/{tenantId}', 'GET /health/live', 'GET /health/ready',
]);

export async function demoFetch(request: Request, now = Date.now()): Promise<Response> {
  if (request.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  const url = new URL(request.url);
  const route = routes.find(candidate => candidate.method === request.method && candidate.pattern.test(url.pathname));
  if (!route) {
    console.error(`Unhandled demo API operation: ${request.method} ${url.pathname}`);
    return problem(501, 'Unhandled demo API operation');
  }

  let rawBody: unknown;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      const text = await request.text();
      if (text) rawBody = JSON.parse(text) as unknown;
    } catch {
      return invalid('Invalid JSON request body.');
    }
  }
  if (request.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  const state = loadDemoState();
  const actor = resolveActor({ request, state, now });
  if (!actor && !anonymous.has(route.key)) return problem(401, 'Local demo session expired');
  if (actor && !actor.isPlatformAdmin && !anonymous.has(route.key) && (
    request.method !== 'GET' || /\/api\/platform\/diagnostics|^\/api\/system\/health$|\/api\/intranet\/calendar\/token/i.test(url.pathname)
  )) return problem(403, 'This operation requires demo staff access');

  const selectedOrg = actor?.organizationId ?? request.headers.get('X-ADWAIS-ORG-ID');
  const organizationId = state.organizations.some(org => org.id === selectedOrg) ? selectedOrg : null;
  const samples = route.pattern.exec(url.pathname)?.slice(1) ?? [];
  let params: Record<string, string>;
  try {
    params = Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(samples[i])]));
  } catch {
    return invalid('Invalid path parameter.');
  }
  const query = new URLSearchParams();
  url.searchParams.forEach((value, key) => query.append(key.toLowerCase(), value));
  const jobsChanged = advanceJobs(state, now);
  const response = route.handler({
    state, request, now, organizationId, contentOrg: organizationId ?? state.organizations[0].id,
    actor: actor ?? { id: demoAdmin.id, name: demoAdmin.name, role: 'Viewer', isPlatformAdmin: false },
    params, query: key => query.get(key.toLowerCase()), values: key => query.getAll(key.toLowerCase()),
    body: rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody as Record<string, unknown> : {}, rawBody,
  });
  if (jobsChanged || (request.method !== 'GET' && response.ok)) saveDemoState(state);
  return response;
}
