import { id, invalid, json, missing, noContent, ok, pick, problem, scoped, type DemoRequest, type Handler } from './http';
import type { RecurringJobKind } from '../../../../packages/types/generated';
import { demoAdmin, demoIds, iso, type DemoState } from './state';

const jobKinds = {
  'monitor-sync': 'MonitorSync', 'uptime-sync': 'MonitorSync', 'latency-sync': 'MonitorSync',
  'user-stats-sync': 'AccountStats', 'order-sync': 'OrderIngestion',
  'refresh-historic-order-data': 'FinancialViewRefresh', 'refresh-monitoring-data': 'MonitoringViewRefresh',
  'feed-fetch': 'FeedRefresh', backfill: 'OrderIngestion',
};

type Job = keyof typeof jobKinds;
export const viewerToken = 'demo-viewer';
export const adminToken = 'demo-admin';

function token(claims: object) {
  return `demo.${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.local`;
}

export function kioskToken(device: DemoState['devices'][number], now: number) {
  return token({ sub: device.deviceId, name: 'Kiosk Device', role: 'Viewer', org_id: device.organizationId, exp: Math.floor(now / 1000) + 3600 });
}

function enqueue(c: DemoRequest, job: Job, tenantId?: string) {
  const row = {
    id: id(), organizationId: c.contentOrg, organizationName: c.state.organizations.find(org => org.id === c.contentOrg)?.name,
    tenantId, tenantName: c.state.tenants.find(tenant => tenant.id === tenantId)?.name,
    kind: jobKinds[job], trigger: 'Manual', state: 'Queued', resourceKey: job, resourceName: job,
    requestedAt: iso(c.now), lastStateChangedAt: iso(c.now), attemptCount: 0,
    safeSummary: 'Sample job queued.', workCount: 0,
  };
  c.state.runs.unshift(row);
  return row;
}

export function advanceJobs(state: DemoState, now: number) {
  let changed = false;
  for (const run of state.runs) {
    if (run.state !== 'Queued' && run.state !== 'Running') continue;
    const elapsed = now - Date.parse(run.requestedAt ?? '');
    if (elapsed >= 8_000) {
      changed = true;
      Object.assign(run, { state: 'Succeeded', completedAt: iso(now), lastStateChangedAt: iso(now),
        attemptCount: 1, safeSummary: 'Sample job completed.', workCount: 1 });
      state.diagnosticEvents.unshift({ id: id(), level: 'Information', timestamp: iso(now), code: 'demo.job.completed',
        source: run.kind, message: run.safeSummary, organizationId: run.organizationId, pipelineRunId: run.id, tenantId: run.tenantId });
      const tenant = state.tenants.find(tenant => tenant.id === run.tenantId);
      if (tenant) Object.assign(tenant, { currentlyFetching: false, lastPolled: iso(now), fetchedUntil: iso(now), lastSyncError: null });
      if (run.kind === 'FeedRefresh') {
        state.global.lastPolled = iso(now);
        state.feeds.unshift({ id: id(), organizationId: run.organizationId ?? demoIds.north, title: 'Demo feed refreshed', link: '/intranet',
          content: 'Sample news was refreshed locally.', publishDate: iso(now), author: 'ADWAIS Demo' });
      }
    } else if (elapsed >= 1_000 && run.state === 'Queued') {
      changed = true;
      Object.assign(run, { state: 'Running', startedAt: iso(now), lastStateChangedAt: iso(now), attemptCount: 1 });
    }
  }
  return changed;
}

const trigger = (job: Job): Handler => c => {
  enqueue(c, job);
  return ok();
};

function diagnosticRows<T extends { organizationId?: string | null; tenantId?: string | null }>(c: DemoRequest, rows: T[]) {
  return scoped(rows, c.params.organizationId ?? c.query('organizationId') ?? c.organizationId)
    .filter(row => !c.query('tenantId') || row.tenantId === c.query('tenantId'))
    .slice(0, Math.max(0, Number(c.query('take')) || 30));
}

const listRuns: Handler = c => json(diagnosticRows(c, c.state.runs));
const listEvents: Handler = c => {
  const levels = ['Information', 'Warning', 'Error', 'Critical'];
  const min = levels.indexOf(c.query('minLevel') ?? '');
  return json(diagnosticRows(c, c.state.diagnosticEvents.filter(row => levels.indexOf(row.level ?? '') >= min)));
};
const runDetails: Handler = c => {
  const run = scoped(c.state.runs, c.params.organizationId ?? c.organizationId).find(row => row.id === c.params.runId);
  return run ? json({ run, events: c.state.diagnosticEvents.filter(row => row.pipelineRunId === run.id) }) : missing();
};

function organizationDiagnostics(c: DemoRequest, organizationId: string) {
  const org = c.state.organizations.find(org => org.id === organizationId);
  if (!org) return null;
  const latest = new Map(scoped(c.state.runs, organizationId).reverse().map(run => [run.kind, run]));
  const pipelines = ['OrderIngestion', 'MonitorSync', 'FeedRefresh'].map(kind => {
    const run = latest.get(kind);
    return { kind, displayName: kind, resourceKey: run?.resourceKey, resourceName: run?.resourceName,
      enabled: true, configured: true, schedule: 'Every 30 minutes', nextExpectedAt: iso(c.now + 1_800_000),
      state: run?.state ?? 'Succeeded', freshness: 'Fresh', lastAttemptAt: run?.requestedAt,
      lastSuccessAt: run?.completedAt, dataThrough: run?.completedAt, currentRunId: run?.id };
  });
  const runningCount = pipelines.filter(x => x.state === 'Running' || x.state === 'Queued').length;
  return { organizationId, organizationName: org.name, observedAt: iso(c.now), pipelineCount: pipelines.length,
    healthyCount: pipelines.length - runningCount, attentionCount: 0, runningCount, pipelines };
}

function health(c: DemoRequest) {
  const stamp = iso(c.now);
  return { databaseStatus: 'Healthy', hangfire: { status: 'Healthy', failedCount: 0, scheduledCount: 3,
    processingCount: c.state.runs.filter(run => run.state === 'Running').length,
    enqueuedCount: c.state.runs.filter(run => run.state === 'Queued').length },
    sync: { status: 'Healthy', tenantsWithErrorsCount: 0, monitorsWithErrorsCount: 0, feedsWithErrorsCount: 0, globalSyncError: null },
    lastLitiumSync: stamp, lastBlogSync: c.state.global.lastPolled, lastFleetUpdate: stamp, lastFleetUptimeUpdate: stamp, lastFleetLatencyUpdate: stamp };
}

export const operations: Record<string, Handler> = {
  'GET /health/live': () => new Response('Healthy'),
  'GET /health/ready': () => new Response('Healthy'),
  'GET /api/demo/token': () => json({ token: viewerToken, expiresInHours: 1 }),
  'POST /api/kiosk/swagger-admin-token': c => c.rawBody === 'demo'
    ? json({ token: adminToken, expiresInHours: 1 }) : new Response('Invalid secret.', { status: 401 }),
  'POST /api/kiosk/register': c => {
    if (typeof c.body.deviceId !== 'string' || !c.body.deviceId) return invalid('A device ID is required.');
    let device = c.state.devices.find(row => row.deviceId === c.body.deviceId);
    if (!device) {
      device = { deviceId: c.body.deviceId, organizationId: undefined, activationCode: id().slice(0, 6).toUpperCase(),
        isAuthorized: false, createdDate: iso(c.now), lastSeenAt: iso(c.now) };
      c.state.devices.push(device);
    }
    return json({ activationCode: device.activationCode });
  },
  'POST /api/kiosk/activate': c => {
    const device = c.state.devices.find(row => row.activationCode === c.body.activationCode);
    if (!device) return new Response('Activation code has expired or is invalid.', { status: 400 });
    Object.assign(device, { isAuthorized: true, organizationId: c.contentOrg, authorizedAt: iso(c.now) });
    return ok();
  },
  'GET /api/kiosk/token': c => {
    const device = c.state.devices.find(row => row.deviceId === c.query('deviceId') && row.isAuthorized);
    if (!device) return new Response('Kiosk device is not authorized.', { status: 401 });
    return json({ token: kioskToken(device, c.now), expiresInHours: 1 });
  },
  'GET /api/kiosk/devices': c => json(c.state.devices.filter(row => !row.organizationId || row.organizationId === c.contentOrg)
    .map(({ activationCode, ...device }) => { void activationCode; return device; })),
  'DELETE /api/kiosk/devices/{deviceId}': c => {
    const index = c.state.devices.findIndex(row => row.deviceId === c.params.deviceId);
    if (index < 0) return missing();
    c.state.devices.splice(index, 1);
    return noContent();
  },
  'POST /api/dashboard-session': c => {
    c.state.dashboardSession = true;
    return noContent();
  },
  'DELETE /api/dashboard-session': c => {
    c.state.dashboardSession = false;
    return noContent();
  },
  'GET /api/global-config': c => json(c.state.global),
  'PATCH /api/global-config': c => json(Object.assign(c.state.global, pick(c.body, ['systemEventRetentionDays', 'matViewRefreshIntervalMinutes', 'visibleRecurringJobs']))),
  'GET /api/global-config/intervals': c => json(c.state.intervals),
  'PATCH /api/global-config/intervals': c => json(Object.assign(c.state.intervals, pick(c.body, [
    'orderFetchIntervalMinutes', 'uptimeFetchIntervalMinutes', 'userStatsFetchIntervalMinutes', 'latencyFetchIntervalMinutes', 'feedFetchIntervalHours',
  ]))),
  'POST /api/global-config/feeds/fetch': c => {
    enqueue(c, 'feed-fetch');
    return json({ message: 'Feed fetch triggered successfully' });
  },
  'GET /api/integrations/order-providers': () => json([
    { id: 'litium', displayName: 'Litium', settings: [
      { key: 'endpointUrl', label: 'Endpoint URL', inputType: 'url', required: true, placeholder: 'https://example.com' },
      { key: 'authorization', label: 'Authorization', inputType: 'password', required: true, placeholder: 'ServiceAccount …' },
    ] },
    { id: 'shopify', displayName: 'Shopify', settings: [
      { key: 'endpointUrl', label: 'Store URL', inputType: 'url', required: true, placeholder: 'https://your-store.myshopify.com' },
      { key: 'accessToken', label: 'Admin API token', inputType: 'password', required: true, placeholder: 'shpat_…' },
    ] },
  ]),
  'GET /api/integrations/monitoring-providers': () => json([
    { id: 'uptimerobot', displayName: 'UptimeRobot', settings: [{ key: 'apiKey', label: 'API Key', inputType: 'password', required: true, placeholder: null }] },
  ]),
  'POST /api/job/trigger/monitor-sync': trigger('monitor-sync'),
  'POST /api/job/trigger/uptime-sync': trigger('uptime-sync'),
  'POST /api/job/trigger/latency-sync': trigger('latency-sync'),
  'POST /api/job/trigger/user-stats-sync': trigger('user-stats-sync'),
  'POST /api/job/trigger/order-sync': trigger('order-sync'),
  'POST /api/job/trigger/refresh-historic-order-data': trigger('refresh-historic-order-data'),
  'POST /api/job/trigger/refresh-monitoring-data': trigger('refresh-monitoring-data'),
  'GET /api/job/recurring': c => {
    const platformKinds: RecurringJobKind[] = ['FeedFetch', 'FinancialViewRefresh', 'MonitoringViewRefresh', 'SystemEventCleanup', 'CalendarSync'];
    const orgJobs = scoped(c.state.organizations.map(org => ({ ...org, organizationId: org.id })), c.organizationId)
      .flatMap(org => ['OrderFetch', 'UptimeFetch', 'LatencyFetch', 'UserStatsFetch', 'FleetSync']
        .map(kind => ({ id: `${kind}:${org.id}`, kind, name: `${kind} (${org.name})`, platformWide: false })));
    const platformJobs = platformKinds.filter(kind => !c.organizationId || c.state.global.visibleRecurringJobs?.includes(kind))
      .map(kind => ({ id: kind, kind, name: kind, platformWide: true }));
    return json([...orgJobs, ...platformJobs].map(job => ({ ...job, cron: '*/30 * * * *',
      lastExecution: iso(c.now - 1_800_000), nextExecution: iso(c.now + 1_800_000), lastJobState: 'Succeeded', queue: 'default' })));
  },
  'GET /api/job/status/{jobId}': c => {
    const run = c.state.runs.find(row => row.id === c.params.jobId);
    if (!run) return missing();
    const state = run.state === 'Queued' ? 'Enqueued' : run.state === 'Running' ? 'Processing' : run.state;
    return json({ jobId: run.id, state, reason: null, createdAt: run.requestedAt,
      history: [{ stateName: state, createdAt: run.lastStateChangedAt, reason: null }] });
  },
  'POST /api/Ingestion/backfill': c => {
    const tenant = c.state.tenants.find(row => row.id === c.query('TenantId'));
    if (!tenant) return missing();
    if (c.organizationId && tenant.organizationId !== c.organizationId) return problem(403, 'Tenant is outside the selected organization.');
    const startDate = c.query('StartDate');
    const endDate = c.query('EndDate');
    if ((startDate && !Number.isFinite(Date.parse(startDate))) ||
      (endDate && (!Number.isFinite(Date.parse(endDate)) || Date.parse(endDate) > c.now)) ||
      (startDate && endDate && Date.parse(startDate) >= Date.parse(endDate))) return invalid('Enter a valid backfill date range.');
    if (tenant.currentlyFetching) return json({ message: 'This tenant is currently fetching.' }, 409);
    tenant.currentlyFetching = true;
    const run = enqueue({ ...c, contentOrg: tenant.organizationId }, 'backfill', tenant.id);
    return json({ jobId: run.id, pipelineRunId: run.id }, 202);
  },
  'GET /api/system/health': c => json(health(c)),
  'GET /api/SystemEvent': listEvents,
  'DELETE /api/SystemEvent/clear': () => problem(410, 'Event deletion is disabled'),
  'GET /api/platform/diagnostics/health': c => json({ observedAt: iso(c.now), health: health(c), affectedOrganizations: [] }),
  'GET /api/platform/diagnostics/pipelines': c => json(c.state.organizations
    .filter(org => !c.query('organizationId') || org.id === c.query('organizationId'))
    .map(org => organizationDiagnostics(c, org.id))),
  'GET /api/platform/diagnostics/runs': listRuns,
  'GET /api/platform/diagnostics/runs/{runId}': runDetails,
  'GET /api/platform/diagnostics/events': listEvents,
  'GET /api/organizations/{organizationId}/diagnostics/pipelines': c => {
    const diagnostics = organizationDiagnostics(c, c.params.organizationId);
    return diagnostics ? json(diagnostics) : missing();
  },
  'GET /api/organizations/{organizationId}/diagnostics/runs': listRuns,
  'GET /api/organizations/{organizationId}/diagnostics/runs/{runId}': runDetails,
  'GET /api/organizations/{organizationId}/diagnostics/events': listEvents,
};

export function resolveActor(c: Pick<DemoRequest, 'request' | 'state' | 'now'>) {
  const credential = c.request.headers.get('Authorization');
  if (!credential || credential === `Bearer ${adminToken}`) return { ...demoAdmin, role: 'PlatformAdmin', isPlatformAdmin: true };
  if (credential === `Bearer ${viewerToken}`) return { id: demoIds.viewer, name: 'Demo viewer', role: 'Viewer', isPlatformAdmin: false, organizationId: demoIds.north };
  try {
    const encoded = credential.replace(/^Bearer demo\./, '').split('.')[0];
    const claims = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))) as { sub: string; exp: number };
    const device = c.state.devices.find(row => row.deviceId === claims.sub && row.isAuthorized);
    if (device && claims.exp > c.now / 1000) return { id: claims.sub, name: 'Kiosk Device', role: 'Viewer',
      isPlatformAdmin: false, organizationId: device.organizationId };
  } catch {
    // An invalid local credential is handled as an expired session.
  }
  return null;
}
