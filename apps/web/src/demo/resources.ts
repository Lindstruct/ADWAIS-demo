import { created, id, invalid, json, missing, noContent, ok, pick, scoped, withoutScope, type DemoRequest, type Handler } from './http';
import { demoAdmin, demoIds, demoOrgConfig, iso, noIncident, type DemoState } from './state';

type Resource = { id?: string; organizationId?: string | null };
type Collection = 'tenants' | 'users' | 'events' | 'bulletins' | 'subscriptions';
const staffFields = {
  users: ['name', 'email', 'role'],
  tenants: ['name', 'type', 'orderProvider', 'orderProviderSettings', 'imageUrl', 'orderFetchingEnabled'],
  events: ['title', 'description', 'location', 'startTime', 'endTime', 'eventType', 'isRecurring', 'recurrence'],
  bulletins: ['title', 'body'],
  subscriptions: ['name', 'url', 'isActive'],
};

function resource(name: Collection, path: string, defaults: (context: DemoRequest) => object, filteredList = false) {
  const rows = (c: DemoRequest) => c.state[name] as Resource[];
  const scope = (c: DemoRequest) => name === 'users' ? null :
    name === 'tenants' ? c.organizationId : c.contentOrg;
  const find = (c: DemoRequest) => scoped(rows(c), scope(c)).find(row => row.id === c.params.id);
  const view = (row: Resource) => name === 'users' ? row : withoutScope(row as Resource & { organizationId: string });
  const list: Handler = c => {
    const items = scoped(rows(c), scope(c));
    const key = filteredList ? c.query('id') : null;
    const start = c.query('start');
    const end = c.query('end');
    return json(items.filter(row => {
      if (key && row.id !== key) return false;
      if (name !== 'events') return true;
      const event = row as DemoState['events'][number];
      return event.isRecurring || ((!start || (event.endTime ?? '') >= start) && (!end || (event.startTime ?? '') <= end));
    }).map(view));
  };
  const add: Handler = c => {
    const fields = pick(c.body, staffFields[name]);
    const required = name === 'users' ? fields.email : name === 'events' || name === 'bulletins' ? fields.title : fields.name;
    if (typeof required !== 'string' || !required.trim()) return invalid('A name, title, or email is required.');
    if (name === 'users' && (!/^[^@\s]+@[^@\s]+$/.test(String(fields.email)) ||
      c.state.users.some(user => user.email?.toLowerCase() === String(fields.email).toLowerCase()))) return invalid('Enter a unique email address.');
    if (name === 'bulletins' && (typeof fields.body !== 'string' || !fields.body.trim())) return invalid('A bulletin body is required.');
    if (name === 'subscriptions' && (typeof fields.url !== 'string' || !/^https?:\/\//i.test(fields.url))) return invalid('An HTTP calendar URL is required.');
    if (name === 'events' && fields.startTime && fields.endTime && (
      !Number.isFinite(Date.parse(String(fields.startTime))) || !Number.isFinite(Date.parse(String(fields.endTime))) ||
      Date.parse(String(fields.startTime)) > Date.parse(String(fields.endTime)))) return invalid('Enter a valid event date range.');
    const row = { ...defaults(c), ...fields, id: id(), ...(name === 'users' ? {} : { organizationId: c.contentOrg }) };
    rows(c).push(row);
    const queryId = name === 'tenants';
    return created(view(row), queryId ? `${path}?id=${row.id}` : `${path}/${row.id}`);
  };
  const get: Handler = c => {
    const row = find(c);
    return row ? json(view(row)) : missing();
  };
  const patch: Handler = c => {
    const row = find(c);
    if (!row) return missing();
    Object.assign(row, pick(c.body, staffFields[name]));
    if (name === 'bulletins') Object.assign(row, { updatedAt: iso(c.now) });
    if (name === 'tenants') {
      for (const monitor of c.state.monitors.filter(item => item.tenantId === row.id)) {
        monitor.tenantName = (row as DemoState['tenants'][number]).name;
      }
      for (const order of c.state.orders.filter(item => item.adwaisTenantId === row.id)) {
        order.tenantName = (row as DemoState['tenants'][number]).name;
      }
    }
    return json(view(row));
  };
  const remove: Handler = c => {
    const row = find(c);
    if (!row) return missing();
    rows(c).splice(rows(c).indexOf(row), 1);
    if (name === 'users') c.state.memberships = c.state.memberships.filter(x => x.userId !== row.id);
    if (name === 'tenants') {
      c.state.orders = c.state.orders.filter(x => x.adwaisTenantId !== row.id);
      for (const monitor of c.state.monitors.filter(x => x.tenantId === row.id)) {
        Object.assign(monitor, { tenantId: undefined, tenantName: null });
      }
    }
    return noContent();
  };
  return { list, add, get, patch, remove };
}

const tenantPath = '/api/tenants';
const userPath = '/api/users';
const eventsPath = '/api/intranet/events';
const bulletinPath = '/api/intranet/bulletin-posts';
const subsPath = '/api/intranet/calendar/subscriptions';
const tenants = resource('tenants', tenantPath, () => ({
  type: 'Mixed', orderProvider: 'litium', orderProviderSettings: {}, imageUrl: null, monitorCount: 0,
  currentlyFetching: false, orderFetchingEnabled: true, hasOrderProviderSettings: true, orderProviderConfiguredSecretKeys: [],
}), true);
const users = resource('users', userPath, c => ({ name: String(c.body.email).split('@')[0], role: 'Viewer', isPlatformAdmin: c.body.role === 'PlatformAdmin' }));
const events = resource('events', eventsPath, c => ({
  startTime: iso(c.now), endTime: iso(c.now + 3_600_000), eventType: 'General', isRecurring: false, recurrence: 'None',
  userId: c.actor.id, userName: c.actor.name,
}));
const bulletins = resource('bulletins', bulletinPath, c => ({
  createdAt: iso(c.now), updatedAt: null, author: { id: c.actor.id, name: c.actor.name },
}));
const subscriptions = resource('subscriptions', subsPath, () => ({ isActive: true, lastPolledAt: null, lastSuccessAt: null, lastSyncError: null }));

function config(c: DemoRequest, update = false) {
  const key = c.params.id ?? c.contentOrg;
  if (!c.state.organizations.some(org => org.id === key)) return missing();
  const row = c.state.configs[key] ?? demoOrgConfig;
  const result = update ? { ...row, ...pick(c.body, [
    'weatherLocation', 'weatherFetchIntervalMinutes', 'reportingTimeZoneId', 'monitoringProvider', 'monitoringProviderSettings',
    'orderFetchIntervalMinutes', 'uptimeFetchIntervalMinutes', 'latencyFetchIntervalMinutes', 'userStatsFetchIntervalMinutes',
    'feedFetchIntervalHours', 'orderFetchEnabled', 'monitoringFetchEnabled',
  ]) } : row;
  if (update) c.state.configs[key] = result;
  return json({ ...result, monitorsCount: scoped(c.state.monitors, key).length });
}

function monitorAction(c: DemoRequest, action: 'assign' | 'unassign' | 'pause' | 'start' | 'patch' | 'remove') {
  const row = scoped(c.state.monitors, c.organizationId).find(monitor => monitor.id === Number(c.params.id));
  if (!row) return missing();
  if (action === 'remove') {
    c.state.monitors.splice(c.state.monitors.indexOf(row), 1);
    const tenant = c.state.tenants.find(tenant => tenant.id === row.tenantId);
    if (tenant) tenant.monitorCount = Math.max(0, (tenant.monitorCount ?? 0) - 1);
    return noContent();
  }
  if (action === 'patch') {
    Object.assign(row, pick(c.body, ['name', 'url', 'type', 'latencyDegradedFloor', 'tags']));
    if (typeof c.body.sla === 'number') row.uptimeSla = c.body.sla;
    return json(withoutScope(row));
  }
  if (action === 'assign' || action === 'unassign') {
    const tenant = c.state.tenants.find(tenant => tenant.id === c.params.tenantId && tenant.organizationId === row.organizationId);
    if (action === 'assign' && !tenant) return missing();
    const previous = c.state.tenants.find(tenant => tenant.id === row.tenantId);
    if (previous) previous.monitorCount = Math.max(0, (previous.monitorCount ?? 0) - 1);
    if (tenant) tenant.monitorCount = (tenant.monitorCount ?? 0) + 1;
    row.tenantId = tenant?.id;
    row.tenantName = tenant?.name ?? null;
    return ok();
  }
  row.currentStatus = action === 'pause' ? 'Paused' : 'Up';
  row.uptimeMonitorEnabled = action === 'start';
  row.lastUpdate = iso(c.now);
  return ok();
}

export function calendarText(events: DemoState['events'], now = Date.now()) {
  const date = (value: string | undefined) => iso(value ? Date.parse(value) : now).replace(/[:-]|\.\d{3}/g, '');
  const text = (value?: string | null) => (value ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, '\\$&');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ADWAIS//Static Demo//EN', ...events.flatMap(event => [
    'BEGIN:VEVENT', `UID:${event.id}@adwais-demo`, `DTSTAMP:${date(undefined)}`, `DTSTART:${date(event.startTime)}`,
    `DTEND:${date(event.endTime)}`, `SUMMARY:${text(event.title)}`, `DESCRIPTION:${text(event.description)}`,
    ...(event.isRecurring && event.recurrence && event.recurrence !== 'None' ? [`RRULE:FREQ=${event.recurrence.toUpperCase()}`] : []),
    'END:VEVENT',
  ]), 'END:VCALENDAR', ''].join('\r\n');
}

export const resources: Record<string, Handler> = {
  'GET /api/organizations': c => json(c.state.organizations.filter(org => !c.query('id') || c.query('id') === org.id)
    .filter(org => c.actor.isPlatformAdmin || org.id === c.organizationId)
    .map(org => ({ ...org, memberCount: c.state.memberships.filter(x => x.organizationId === org.id).length,
      monitorCount: scoped(c.state.monitors, org.id).length }))),
  'POST /api/organizations': c => {
    if (typeof c.body.name !== 'string' || !c.body.name.trim()) return invalid('An organization name is required.');
    const row = { id: id(), name: c.body.name.trim() };
    c.state.organizations.push(row);
    return created(row, `/api/organizations?id=${row.id}`);
  },
  'PATCH /api/organizations/{id}': c => {
    const row = c.state.organizations.find(org => org.id === c.params.id);
    if (!row) return missing();
    if (typeof c.body.name === 'string' && c.body.name.trim()) {
      row.name = c.body.name.trim();
      for (const membership of c.state.memberships.filter(x => x.organizationId === row.id)) membership.organizationName = row.name;
    }
    return json(row);
  },
  'DELETE /api/organizations/{id}': c => {
    const row = c.state.organizations.find(org => org.id === c.params.id);
    if (!row) return missing();
    if (row.id === demoIds.north) return new Response('The default organization cannot be deleted.', { status: 409 });
    c.state.organizations.splice(c.state.organizations.indexOf(row), 1);
    c.state.tenants = c.state.tenants.filter(x => x.organizationId !== row.id);
    c.state.monitors = c.state.monitors.filter(x => x.organizationId !== row.id);
    c.state.memberships = c.state.memberships.filter(x => x.organizationId !== row.id);
    c.state.events = c.state.events.filter(x => x.organizationId !== row.id);
    c.state.bulletins = c.state.bulletins.filter(x => x.organizationId !== row.id);
    c.state.subscriptions = c.state.subscriptions.filter(x => x.organizationId !== row.id);
    c.state.feeds = c.state.feeds.filter(x => x.organizationId !== row.id);
    c.state.devices = c.state.devices.filter(x => x.organizationId !== row.id);
    c.state.orders = c.state.orders.filter(x => x.organizationId !== row.id);
    c.state.runs = c.state.runs.filter(x => x.organizationId !== row.id);
    c.state.diagnosticEvents = c.state.diagnosticEvents.filter(x => x.organizationId !== row.id);
    delete c.state.configs[row.id];
    return noContent();
  },
  'GET /api/organizations/{id}/config': c => config(c),
  'PATCH /api/organizations/{id}/config': c => config(c, true),
  'GET /api/organizations/me/config': c => c.organizationId ? config(c) : missing(),
  'PATCH /api/organizations/me/config': c => c.organizationId ? config(c, true) : new Response(null, { status: 403 }),
  'GET /api/tenants': tenants.list,
  'POST /api/tenants': tenants.add,
  'PATCH /api/tenants/{id}': tenants.patch,
  'DELETE /api/tenants/{id}': tenants.remove,
  'GET /api/users/me': c => json({ ...c.actor,
    email: c.actor.isPlatformAdmin ? demoAdmin.email : null,
    organizationId: c.organizationId, organizationName: c.state.organizations.find(org => org.id === c.organizationId)?.name ?? null,
    tenantId: null }),
  'GET /api/users': users.list,
  'POST /api/users': c => {
    const response = users.add(c);
    if (response.ok && typeof c.body.organizationId === 'string') {
      const user = c.state.users[c.state.users.length - 1];
      const organization = c.state.organizations.find(org => org.id === c.body.organizationId);
      if (organization) c.state.memberships.push({ id: id(), userId: user.id, organizationId: organization.id, organizationName: organization.name, role: user.role ?? 'Viewer' });
    }
    return response;
  },
  'GET /api/users/{id}': users.get,
  'PATCH /api/users/{id}': users.patch,
  'DELETE /api/users/{id}': users.remove,
  'GET /api/users/{id}/memberships': c => c.state.users.some(user => user.id === c.params.id)
    ? json(c.state.memberships.filter(x => x.userId === c.params.id)) : missing(),
  'POST /api/users/{id}/memberships': c => {
    const org = c.state.organizations.find(x => x.id === c.body.organizationId);
    if (!org || !c.state.users.some(user => user.id === c.params.id)) return missing();
    const role = c.body.role as DemoState['memberships'][number]['role'];
    if (!role) return invalid('A role is required.');
    const row = { id: id(), userId: c.params.id, organizationId: org.id, organizationName: org.name, role };
    c.state.memberships.push(row);
    return created(row, `/api/users/${c.params.id}/memberships`);
  },
  'DELETE /api/users/{id}/memberships/{membershipId}': c => {
    const index = c.state.memberships.findIndex(x => x.userId === c.params.id && x.id === c.params.membershipId);
    if (index < 0) return missing();
    c.state.memberships.splice(index, 1);
    return noContent();
  },
  'POST /api/monitors': c => {
    if (typeof c.body.name !== 'string' || typeof c.body.url !== 'string') return invalid('A monitor name and URL are required.');
    const row = {
      ...c.body, organizationId: c.contentOrg, id: c.state.nextMonitorId++, name: c.body.name, url: c.body.url,
      provider: 'uptimerobot', externalId: null, type: String(c.body.type ?? 'HTTP'), currentStatus: 'Up',
      currentUptimePercentage: 100, currentLatency: 100, uptimeMonitorEnabled: true, updateInterval: 300,
      createdDate: iso(c.now), tags: [], tenantBaseUrl: null, tenantImageUrl: null, httpMethod: 'GET',
      timeoutSeconds: 30, sslExpiresAt: null, domainExpiresAt: null, monitoredRegions: [], currentStateDurationSeconds: 0, latestIncident: noIncident,
    };
    c.state.monitors.push(row);
    return created(withoutScope(row), `/api/monitors?id=${row.id}`);
  },
  'PATCH /api/monitors/{id}': c => monitorAction(c, 'patch'),
  'DELETE /api/monitors/{id}': c => monitorAction(c, 'remove'),
  'PATCH /api/monitors/{id}/assign/{tenantId}': c => monitorAction(c, 'assign'),
  'PATCH /api/monitors/{id}/unassign': c => monitorAction(c, 'unassign'),
  'POST /api/monitors/{id}/pause': c => monitorAction(c, 'pause'),
  'POST /api/monitors/{id}/start': c => monitorAction(c, 'start'),
  'GET /api/intranet/events': events.list,
  'GET /api/intranet/events/today': c => {
    const day = iso(c.now).slice(0, 10);
    return json(scoped(c.state.events, c.contentOrg).filter(event => event.startTime?.slice(0, 10) === day).map(withoutScope));
  },
  'GET /api/intranet/events/{id}': events.get,
  'POST /api/intranet/events': events.add,
  'PATCH /api/intranet/events/{id}': events.patch,
  'DELETE /api/intranet/events/{id}': events.remove,
  'GET /api/intranet/bulletin-posts': bulletins.list,
  'GET /api/intranet/bulletin-posts/{id}': bulletins.get,
  'POST /api/intranet/bulletin-posts': bulletins.add,
  'PATCH /api/intranet/bulletin-posts/{id}': bulletins.patch,
  'DELETE /api/intranet/bulletin-posts/{id}': bulletins.remove,
  'GET /api/intranet/calendar/subscriptions': subscriptions.list,
  'GET /api/intranet/calendar/subscriptions/{id}': subscriptions.get,
  'POST /api/intranet/calendar/subscriptions': subscriptions.add,
  'PATCH /api/intranet/calendar/subscriptions/{id}': subscriptions.patch,
  'DELETE /api/intranet/calendar/subscriptions/{id}': subscriptions.remove,
  'POST /api/intranet/calendar/subscriptions/{id}/sync': c => {
    const row = scoped(c.state.subscriptions, c.contentOrg).find(x => x.id === c.params.id);
    if (!row) return missing();
    row.lastPolledAt = row.lastSuccessAt = iso(c.now);
    if (!c.state.events.some(event => event.calendarSubscriptionId === row.id)) {
      c.state.events.push({ id: id(), organizationId: c.contentOrg, title: row.name, calendarSubscriptionId: row.id,
        startTime: iso(c.now + 3_600_000), endTime: iso(c.now + 7_200_000), eventType: 'ExternalSync' });
    }
    return ok();
  },
  'GET /api/intranet/calendar/token': c => json({ token: c.state.calendarToken }),
  'POST /api/intranet/calendar/token/regenerate': c => json({ token: c.state.calendarToken = id() }),
  'GET /api/intranet/calendar/feed.ics': c => c.query('token') === c.state.calendarToken
    ? new Response(calendarText(scoped(c.state.events, c.contentOrg), c.now), {
      headers: { 'Content-Type': 'text/calendar', 'Content-Disposition': 'attachment; filename=feed.ics' },
    }) : invalid('A valid calendar feed token is required.'),
  'GET /api/intranet/feeds': c => {
    const page = Math.max(1, Number(c.query('Page')) || 1);
    const size = Math.max(1, Number(c.query('PageSize')) || 20);
    return json(scoped(c.state.feeds, c.contentOrg).filter(row =>
      (!c.query('FeedSourceId') || row.feedSourceId === c.query('FeedSourceId'))
      && (!c.query('AuthorName') || row.author === c.query('AuthorName'))).slice((page - 1) * size, page * size).map(withoutScope));
  },
  'GET /api/weather': c => json({ location: c.state.configs[c.contentOrg]?.weatherLocation ?? demoOrgConfig.weatherLocation,
    temperature: 12, apparentTemperature: 10, precipitationProbability: 20, precipitation: 0, weatherCode: 2, fetchedAt: iso(c.now) }),
  'POST /api/webhooks/bulletin-posts': c => {
    if (c.request.headers.get('X-Api-Key') !== 'demo') return new Response(null, { status: 401 });
    const response = bulletins.add({ ...c, contentOrg: typeof c.body.organizationId === 'string' ? c.body.organizationId : c.contentOrg });
    return response.ok ? json({ id: c.state.bulletins[c.state.bulletins.length - 1].id }) : response;
  },
  'POST /api/webhooks/motastic/{tenantId}': c => {
    if (c.request.headers.get('X-Api-Key') !== 'demo') return new Response(null, { status: 401 });
    const tenant = c.state.tenants.find(row => row.id === c.params.tenantId);
    if (!tenant) return missing();
    if (!c.rawBody || typeof c.rawBody !== 'object') return invalid('An order payload is required.');
    const externalId = String(c.body.orderNumber ?? c.body.externalId ?? id());
    const value = Number(c.body.totalValueExcludingVat ?? c.body.totalValueExcVat ?? 0);
    const existing = c.state.orders.find(order => order.adwaisTenantId === tenant.id && order.externalId === externalId);
    const order = { adwaisTenantId: tenant.id, tenantName: tenant.name, orderNumber: externalId, externalId,
      createdDate: iso(c.now), currency: 'SEK', totalValueExcVat: value, totalValueIncVat: value * 1.25 };
    if (existing) Object.assign(existing, order);
    else c.state.orders.push({ ...order, adwaisOrderId: id(), organizationId: tenant.organizationId, provider: 'Motastic', orderState: 'Completed' });
    return ok();
  },
};
