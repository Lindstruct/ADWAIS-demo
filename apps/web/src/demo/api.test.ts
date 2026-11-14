/// <reference types="node" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import openapi from '../../../../docs/openapi/v1.json';
import { demoFetch, demoHandlers } from './api';
import { demoIds, iso, resetDemoState, saveDemoState, seedDemo } from './state';

const { north, south, viewer, tenant, membership, event, bulletin, subscription, run } = demoIds;
const now = Date.parse('2026-11-14T10:00:00Z');
const org = { 'X-ADWAIS-ORG-ID': north };
const webhook = { 'X-Api-Key': 'demo' };
const methods = ['get', 'post', 'patch', 'put', 'delete', 'head', 'options', 'trace'];
const slots: Record<string, string> = { id: '', tenantId: tenant, organizationId: north, runId: run, jobId: run, deviceId: 'kiosk-contract', membershipId: membership };

interface Example {
  status: number;
  body?: unknown;
  params?: Record<string, string>;
  query?: string;
  headers?: Record<string, string>;
  check?: (body: unknown) => void;
}

const jsonHas = (shape: object) => (body: unknown) => expect(body).toEqual(expect.objectContaining(shape));
const arrayHas = (shape: object) => (body: unknown) => expect(body).toEqual(expect.arrayContaining([expect.objectContaining(shape)]));
const array = (body: unknown) => expect(Array.isArray(body)).toBe(true);
const pathId = (id: string) => ({ id });
const get = (check: Example['check'], params?: Example['params'], query?: string): Example => ({ status: 200, check, params, query });
const put = (status: number, body: unknown, check?: Example['check'], params?: Example['params']): Example => ({ status, body, check, params });
const remove = (id: string): Example => ({ status: 204, params: pathId(id) });
const patch = (id: string, body: object): Example => put(200, body, jsonHas(body), pathId(id));

const examples: Record<string, Example> = {
  'GET /health/live': get(body => expect(body).toBe('Healthy')),
  'GET /health/ready': get(body => expect(body).toBe('Healthy')),
  'GET /api/users/me': get(jsonHas({ id: demoIds.admin, role: 'PlatformAdmin', isPlatformAdmin: true, organizationId: north })),
  'GET /api/users': get(arrayHas({ id: viewer })),
  'POST /api/users': put(201, { email: 'new@example.test', role: 'Employee', organizationId: north }, jsonHas({ email: 'new@example.test', role: 'Employee' })),
  'GET /api/users/{id}': get(jsonHas({ id: viewer }), pathId(viewer)),
  'PATCH /api/users/{id}': patch(viewer, { name: 'Updated viewer' }),
  'DELETE /api/users/{id}': remove(viewer),
  'GET /api/users/{id}/memberships': get(arrayHas({ id: membership, organizationId: north }), pathId(viewer)),
  'POST /api/users/{id}/memberships': put(201, { organizationId: south, role: 'Admin' }, jsonHas({ organizationId: south, role: 'Admin' }), pathId(viewer)),
  'DELETE /api/users/{id}/memberships/{membershipId}': remove(viewer),
  'GET /api/organizations': get(arrayHas({ id: south })),
  'POST /api/organizations': put(201, { name: 'Third organization' }, jsonHas({ name: 'Third organization' })),
  'PATCH /api/organizations/{id}': patch(south, { name: 'New name' }),
  'DELETE /api/organizations/{id}': remove(south),
  'GET /api/organizations/{id}/config': get(jsonHas({ reportingTimeZoneId: 'Europe/Stockholm' }), pathId(north)),
  'PATCH /api/organizations/{id}/config': patch(north, { weatherLocation: 'Malmö' }),
  'GET /api/organizations/me/config': get(jsonHas({ weatherLocation: 'Stockholm' })),
  'PATCH /api/organizations/me/config': put(200, { weatherLocation: 'Malmö' }, jsonHas({ weatherLocation: 'Malmö' })),
  'GET /api/tenants': get(arrayHas({ id: tenant, name: 'W.W. Grainger' }), {}, `id=${tenant}`),
  'POST /api/tenants': put(201, { name: 'New tenant', orderProvider: 'litium', orderFetchingEnabled: false }, jsonHas({ name: 'New tenant' })),
  'PATCH /api/tenants/{id}': patch(tenant, { name: 'Retail' }),
  'DELETE /api/tenants/{id}': remove(tenant),
  'GET /api/monitors': get(arrayHas({ id: 1, tenantId: tenant }), {}, 'tags=storefront&tags=checkout&excludedStatuses=Down'),
  'GET /api/monitors/unassigned': get(array),
  'POST /api/monitors': put(201, { name: 'New monitor', url: 'https://example.test' }, jsonHas({ name: 'New monitor' })),
  'PATCH /api/monitors/{id}': patch('1', { name: 'New monitor name' }),
  'DELETE /api/monitors/{id}': remove('1'),
  'PATCH /api/monitors/{id}/assign/{tenantId}': { status: 200, params: pathId('1') },
  'PATCH /api/monitors/{id}/unassign': { status: 200, params: pathId('1') },
  'POST /api/monitors/{id}/pause': { status: 200, params: pathId('1') },
  'POST /api/monitors/{id}/start': { status: 200, params: pathId('1') },
  'GET /api/monitors/{id}/latency': get(arrayHas({ date: expect.any(String), average: expect.any(Number) }), pathId('1')),
  'GET /api/monitors/analytics': get(jsonHas({ kpis: expect.objectContaining({ averageUptime: expect.any(Number) }), latencyPoints: expect.any(Array) })),
  'GET /api/monitors/availability': get(jsonHas({ points: expect.any(Array), periodStart: expect.any(String) })),
  'GET /api/financial/kpis': get(jsonHas({ transactionVolume: expect.any(Number), activeTenants: 1, currentRevenue: expect.any(Number) }), {}, `tenantId=${tenant}&timeframe=T7`),
  'GET /api/financial/accumulated-revenue': get(arrayHas({ timestamp: expect.any(String), currentAccumulated: expect.any(Number) })),
  'GET /api/financial/revenue-efficiency': get(jsonHas({ globalAverageOrderValue: expect.any(Number), tenants: expect.any(Array) })),
  'GET /api/financial/cross-segment-distribution': get(jsonHas({ cohorts: expect.any(Array), tenants: expect.any(Array) })),
  'GET /api/financial/portfolio-impact': get(jsonHas({ globalGrowthPercentage: expect.any(Number), tenants: expect.any(Array) })),
  'GET /api/financial/daily-revenue-delta': get(arrayHas({ netGrowthAddition: expect.any(Number) })),
  'GET /api/financial/order-distribution': get(arrayHas({ orderCount: expect.any(Number), cumulativePercentage: expect.any(Number) }), {}, `tenantId=${tenant}`),
  'GET /api/financial/transaction-density': get(jsonHas({ requestedPeriod: 'T90', effectivePeriod: 'T90', points: expect.any(Array) }), {}, 'period=T90'),
  'GET /api/financial/cumulative-growth-delta': get(arrayHas({ cumulativeGrowthDelta: expect.any(Number) })),
  'GET /api/financial/orders': get(body => expect(body).toHaveLength(2), {}, 'CeilingCount=2'),
  'GET /api/intranet/events': get(arrayHas({ id: event, recurrence: 'Weekly' })),
  'GET /api/intranet/events/today': get(arrayHas({ id: event })),
  'GET /api/intranet/events/{id}': get(jsonHas({ id: event }), pathId(event)),
  'POST /api/intranet/events': put(201, { title: 'Partner meeting', startTime: iso(now), endTime: iso(now + 3600000) }, jsonHas({ title: 'Partner meeting' })),
  'PATCH /api/intranet/events/{id}': patch(event, { title: 'Rescheduled meeting' }),
  'DELETE /api/intranet/events/{id}': remove(event),
  'GET /api/intranet/bulletin-posts': get(arrayHas({ id: bulletin, author: expect.any(Object) })),
  'GET /api/intranet/bulletin-posts/{id}': get(jsonHas({ id: bulletin }), pathId(bulletin)),
  'POST /api/intranet/bulletin-posts': put(201, { title: 'Release', body: 'Release notes' }, jsonHas({ title: 'Release' })),
  'PATCH /api/intranet/bulletin-posts/{id}': patch(bulletin, { title: 'Updated title' }),
  'DELETE /api/intranet/bulletin-posts/{id}': remove(bulletin),
  'GET /api/intranet/calendar/subscriptions': get(arrayHas({ id: subscription })),
  'GET /api/intranet/calendar/subscriptions/{id}': get(jsonHas({ id: subscription }), pathId(subscription)),
  'POST /api/intranet/calendar/subscriptions': put(201, { name: 'Fixture calendar', url: 'https://calendar.example.test/feed.ics' }, jsonHas({ name: 'Fixture calendar' })),
  'PATCH /api/intranet/calendar/subscriptions/{id}': patch(subscription, { isActive: false }),
  'DELETE /api/intranet/calendar/subscriptions/{id}': remove(subscription),
  'POST /api/intranet/calendar/subscriptions/{id}/sync': { status: 200, params: pathId(subscription) },
  'GET /api/intranet/calendar/token': get(jsonHas({ token: 'static-demo-feed' })),
  'POST /api/intranet/calendar/token/regenerate': put(200, undefined, jsonHas({ token: expect.any(String) })),
  'GET /api/intranet/calendar/feed.ics': get(body => expect(body).toContain('BEGIN:VEVENT\r\n'), {}, 'token=static-demo-feed'),
  'GET /api/intranet/feeds': get(arrayHas({ title: 'W.W. Grainger trading notes' }), {}, 'Page=1&PageSize=1'),
  'GET /api/weather': get(jsonHas({ location: 'Stockholm', temperature: expect.any(Number) })),
  'GET /api/demo/token': get(jsonHas({ token: expect.any(String), expiresInHours: 1 })),
  'POST /api/kiosk/register': put(200, { deviceId: 'second-kiosk' }, jsonHas({ activationCode: expect.stringMatching(/^[A-Z0-9]{6}$/) })),
  'POST /api/kiosk/activate': put(200, { activationCode: 'ABC123' }),
  'GET /api/kiosk/token': get(jsonHas({ token: expect.any(String), expiresInHours: 1 }), {}, 'deviceId=kiosk-contract'),
  'GET /api/kiosk/devices': get(arrayHas({ deviceId: 'kiosk-contract', isAuthorized: true })),
  'DELETE /api/kiosk/devices/{deviceId}': { status: 204 },
  'POST /api/kiosk/swagger-admin-token': put(200, 'demo', jsonHas({ token: expect.any(String), expiresInHours: 1 })),
  'POST /api/dashboard-session': { status: 204 },
  'DELETE /api/dashboard-session': { status: 204 },
  'GET /api/global-config': get(jsonHas({ systemEventRetentionDays: expect.any(Number), visibleRecurringJobs: expect.any(Array) })),
  'PATCH /api/global-config': put(200, { systemEventRetentionDays: 45 }, jsonHas({ systemEventRetentionDays: 45 })),
  'GET /api/global-config/intervals': get(jsonHas({ statusFetchIntervalMinutes: expect.any(Number) })),
  'PATCH /api/global-config/intervals': put(200, { latencyFetchIntervalMinutes: 25 }, jsonHas({ latencyFetchIntervalMinutes: 25 })),
  'POST /api/global-config/feeds/fetch': put(200, undefined, jsonHas({ message: expect.any(String) })),
  'GET /api/integrations/order-providers': get(arrayHas({ id: 'litium', settings: expect.any(Array) })),
  'GET /api/integrations/monitoring-providers': get(arrayHas({ id: 'uptimerobot', settings: expect.any(Array) })),
  'POST /api/job/trigger/monitor-sync': { status: 200 },
  'POST /api/job/trigger/uptime-sync': { status: 200 },
  'POST /api/job/trigger/latency-sync': { status: 200 },
  'POST /api/job/trigger/user-stats-sync': { status: 200 },
  'POST /api/job/trigger/order-sync': { status: 200 },
  'POST /api/job/trigger/refresh-historic-order-data': { status: 200 },
  'POST /api/job/trigger/refresh-monitoring-data': { status: 200 },
  'GET /api/job/recurring': get(arrayHas({ kind: 'OrderFetch', lastJobState: 'Succeeded' })),
  'GET /api/job/status/{jobId}': get(jsonHas({ jobId: run, state: 'Succeeded', history: expect.any(Array) })),
  'POST /api/Ingestion/backfill': { status: 202, query: `TenantId=${tenant}`, check: jsonHas({ jobId: expect.any(String), pipelineRunId: expect.any(String) }) },
  'GET /api/SystemEvent': get(arrayHas({ pipelineRunId: run })),
  'DELETE /api/SystemEvent/clear': { status: 410, check: jsonHas({ status: 410 }) },
  'GET /api/system/health': get(jsonHas({ databaseStatus: 'Healthy', hangfire: expect.any(Object), sync: expect.any(Object) })),
  'GET /api/platform/diagnostics/health': get(jsonHas({ health: expect.any(Object), affectedOrganizations: expect.any(Array) })),
  'GET /api/platform/diagnostics/pipelines': get(arrayHas({ organizationId: north, pipelines: expect.any(Array) })),
  'GET /api/platform/diagnostics/runs': get(arrayHas({ id: run })),
  'GET /api/platform/diagnostics/runs/{runId}': get(jsonHas({ run: expect.objectContaining({ id: run }), events: expect.any(Array) })),
  'GET /api/platform/diagnostics/events': get(arrayHas({ pipelineRunId: run })),
  'GET /api/organizations/{organizationId}/diagnostics/pipelines': get(jsonHas({ organizationId: north, pipelines: expect.any(Array) })),
  'GET /api/organizations/{organizationId}/diagnostics/runs': get(arrayHas({ id: run })),
  'GET /api/organizations/{organizationId}/diagnostics/runs/{runId}': get(jsonHas({ run: expect.objectContaining({ id: run }) })),
  'GET /api/organizations/{organizationId}/diagnostics/events': get(arrayHas({ pipelineRunId: run })),
  'POST /api/webhooks/motastic/{tenantId}': { ...put(200, { orderNumber: 'TEST-ORDER', totalValueExcludingVat: 175 }), headers: webhook },
  'POST /api/webhooks/bulletin-posts': { ...put(200, { title: 'Hook', body: 'Fixture', organizationId: north }, jsonHas({ id: expect.any(String) })), headers: webhook },
};

function call(key: string, example: Example, time = now) {
  const [method, path] = key.split(' ');
  const params = { ...slots, ...example.params };
  const url = path.replace(/\{(\w+)\}/g, (_, slot: string) => encodeURIComponent(params[slot] ?? '')) + (example.query ? '?' + example.query : '');
  return demoFetch(new Request('https://demo.example.test' + url, {
    method, headers: { ...org, ...example.headers, ...(example.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: example.body === undefined ? undefined : JSON.stringify(example.body),
  }), time);
}

describe('static demo API contract', () => {
  beforeEach(() => {
    resetDemoState();
    const state = seedDemo(now);
    state.devices.push({ deviceId: slots.deviceId, activationCode: 'ABC123', organizationId: north, isAuthorized: true, createdDate: iso(now) });
    saveDemoState(state);
  });

  it('requires exactly one handler and one executable example for each OpenAPI and health operation', () => {
    const contract = Object.entries(openapi.paths).flatMap(([path, operations]) =>
      Object.keys(operations).filter(method => methods.includes(method)).map(method => `${method.toUpperCase()} ${path}`))
      .concat(['GET /health/live', 'GET /health/ready']).sort();
    expect(Object.keys(demoHandlers).sort()).toEqual(contract);
    expect(Object.keys(examples).sort()).toEqual(contract);
  });

  it.each(Object.entries(examples))('%s', async (key, example) => {
    const response = await call(key, example);
    expect(response.status).toBe(example.status);
    if (example.status === 201) expect(response.headers.get('location')).toMatch(/^\/api\//);
    if (example.check) {
      const value = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
      example.check(value);
    } else {
      expect(await response.text()).toBe('');
    }
  });

  it('persists mutations, filters organization scope and removes deleted records', async () => {
    const add = await call('POST /api/tenants', { status: 201, body: { name: 'Temporary tenant', orderProvider: 'litium' } });
    const { id } = await add.json();
    expect(await (await call('GET /api/tenants', { status: 200, query: `id=${id}` })).json()).toEqual([expect.objectContaining({ name: 'Temporary tenant' })]);
    expect(await (await call('GET /api/tenants', { status: 200, query: `id=${id}`, headers: { 'X-ADWAIS-ORG-ID': south } })).json()).toEqual([]);
    expect((await call('DELETE /api/tenants/{id}', { status: 204, params: { id } })).status).toBe(204);
    expect(await (await call('GET /api/tenants', { status: 200, query: `id=${id}` })).json()).toEqual([]);
  });

  it('moves a backfill through queued, processing and succeeded states and clears the busy flag', async () => {
    const backfill = await call('POST /api/Ingestion/backfill', { status: 202, query: `TenantId=${tenant}` });
    expect(backfill.status).toBe(202);
    const { jobId } = await backfill.json();
    expect((await call('POST /api/Ingestion/backfill', { status: 409, query: `TenantId=${tenant}` })).status).toBe(409);
    for (const [advance, state] of [[0, 'Enqueued'], [2000, 'Processing'], [9000, 'Succeeded']] as const) {
      const response = await call('GET /api/job/status/{jobId}', { status: 200, params: { jobId } }, now + advance);
      expect(await response.json()).toEqual(expect.objectContaining({ state }));
    }
    const tenants = await call('GET /api/tenants', { status: 200, query: `id=${tenant}` }, now + 9000);
    expect(await tenants.json()).toEqual([expect.objectContaining({ currentlyFetching: false })]);
  });

  it.each([north, south, '00000000-0000-4000-8000-000000000030'])('models a complete consultancy portfolio for %s', async organizationId => {
    const headers = { 'X-ADWAIS-ORG-ID': organizationId };
    const response = await call('GET /api/tenants', { status: 200, headers });
    const tenants = await response.json() as { id: string; type: string; imageUrl: string; orderProviderSettings: { endpointUrl: string } }[];
    expect(tenants).toHaveLength(6);
    for (const type of ['B2B', 'B2C', 'Mixed']) expect(tenants.filter(row => row.type === type)).toHaveLength(2);
    for (const row of tenants) {
      expect(row.orderProviderSettings.endpointUrl).toMatch(/^https:\/\//);
      expect(new URL(row.imageUrl).pathname).toMatch(/^\/favicons\/[^/]+\.png$/);
    }

    const densityResponse = await call('GET /api/financial/transaction-density', { status: 200, headers, query: 'period=T30' });
    const density = await densityResponse.json();
    expect(density.sampleQuality).toBe('Stable');
    expect(density.points).toHaveLength(168);
    const active = density.points.filter((point: { count: number }) => point.count > 0);
    expect(new Set(active.map((point: { dayOfWeek: number }) => point.dayOfWeek))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
    expect(active.length).toBeGreaterThan(100);
    for (const [segment, peakHour] of [['B2B', 10], ['B2C', 20]] as const) {
      const result = await call('GET /api/financial/transaction-density', { status: 200, headers, query: `period=T90&tenantTypes=${segment}` });
      const { points } = await result.json();
      const transactions = (hour: number) => points.filter((row: { hour: number }) => row.hour === hour)
        .reduce((sum: number, row: { count: number }) => sum + row.count, 0);
      expect(transactions(peakHour)).toBeGreaterThan(transactions(segment === 'B2B' ? 20 : 10) * 1.25);
    }

    const fleet = await call('GET /api/monitors', { status: 200, headers });
    const monitors = await fleet.json() as { type: string; tags: string[]; currentUptimePercentage: number | null }[];
    expect(monitors.length).toBeGreaterThanOrEqual(18);
    expect(new Set(monitors.map(row => row.type)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(monitors.flatMap(row => row.tags)).size).toBeGreaterThanOrEqual(8);
    expect(monitors.filter(row => (row.currentUptimePercentage ?? 0) >= 99.95).length).toBeGreaterThan(monitors.length * .7);
    const strip = await call('GET /api/monitors/availability', { status: 200, headers });
    const { points } = await strip.json();
    expect(points).toHaveLength(30);
    expect(points[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Set(points.map((point: { uptimePercentage: number }) => point.uptimePercentage)).size).toBeGreaterThan(4);
  });

  it('rejects an unmatched API call without sending a network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await call('GET /api/unknown', { status: 501 })).status).toBe(501);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith('Unhandled demo API operation: GET /api/unknown');
    } finally {
      fetchSpy.mockRestore();
      error.mockRestore();
    }
  });

  it('keeps the viewer read only and rejects malformed bodies and unauthorized webhooks', async () => {
    const tokenResponse = await call('GET /api/demo/token', { status: 200 });
    const { token } = await tokenResponse.json();
    const headers = { Authorization: `Bearer ${token}` };
    expect((await call('GET /api/financial/kpis', { status: 200, headers })).status).toBe(200);
    expect((await call('POST /api/organizations', { status: 403, headers, body: { name: 'Denied' } })).status).toBe(403);
    expect((await call('POST /api/organizations', { status: 400, body: { name: '' } })).status).toBe(400);
    expect((await call('POST /api/webhooks/bulletin-posts', { status: 401, body: { title: 'Denied' } })).status).toBe(401);
  });
});

const upstream = process.env.ADWAIS_CONTRACT_URL;
describe.skipIf(!upstream)('disposable upstream comparison', () => {
  // Compare protocol and structural keys. Domain values and collection sizes differ between the two seed datasets.
  const upstreamOrg = '00000000-0000-0000-0000-00000000000a';
  const readOps = Object.keys(examples).filter(key => key.startsWith('GET ') && !key.includes('{') &&
    !/\/me\/config|\/calendar\/feed\.ics|\/kiosk\/token/.test(key));
  const comparableSchema = (value: unknown) => Array.isArray(value) ? 'array'
    : value === null ? 'null' : typeof value;

  it('serves the same OpenAPI operation inventory', async () => {
    const response = await fetch(upstream + '/openapi/v1.json');
    expect(response.status).toBe(200);
    const actual = await response.json();
    const keys = (paths: typeof openapi.paths) => Object.entries(paths).flatMap(([path, actions]) =>
      Object.keys(actions).filter(method => methods.includes(method)).map(method => method + ' ' + path)).sort();
    expect(keys(actual.paths)).toEqual(keys(openapi.paths));
  });

  it.each(readOps)('%s matches status, media type and response container', async key => {
    resetDemoState();
    saveDemoState(seedDemo(now));
    const [, path] = key.split(' ');
    const options = { headers: { 'X-ADWAIS-ORG-ID': upstreamOrg } };
    const actual = await fetch(upstream + path, options);
    const mock = await call(key, { status: actual.status });
    expect(mock.status).toBe(actual.status);
    const type = (response: Response) => response.headers.get('content-type')?.split(';')[0];
    expect(type(mock)).toBe(type(actual));
    if (type(actual) !== 'application/json') return;
    const [upstreamValue, demoValue] = await Promise.all([actual.json(), mock.json()]);
    expect(comparableSchema(demoValue)).toBe(comparableSchema(upstreamValue));
    if (upstreamValue && demoValue && !Array.isArray(upstreamValue) && typeof upstreamValue === 'object') {
      expect(Object.keys(demoValue).sort()).toEqual(Object.keys(upstreamValue).sort());
    }
  });

  it('matches validation and the disabled event deletion contract', async () => {
    for (const [method, path, body] of [['POST', '/api/organizations', { name: '' }],
      ['DELETE', '/api/SystemEvent/clear', undefined]] as const) {
      const actual = await fetch(upstream + path, { method, headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
      const mock = await call(method + ' ' + path, { status: 400, body });
      expect(mock.status).toBe(actual.status);
    }
  });
});
