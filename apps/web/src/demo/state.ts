import { agencies, clients, dayMs, fixtureId, organizationId } from './catalog';
import { seedFleet } from './fleet';
export { dayMs } from './catalog';
import type {
  BulletinPostResponseDto, CalendarEventDto, CalendarSubscriptionDto, DiagnosticEventDto,
  FeedItem, FetchIntervalsDto, GlobalConfigResponseDto, KioskDeviceResponseDto,
  OrderDto, OrganizationConfigDto, OrganizationResponseDto, PipelineRunDto, TenantResponseDto,
  UptimeMonitorDto, UserMembershipResponseDto, UserResponseDto,
} from '../../../../packages/types/generated';

export const demoIds = {
  north: '00000000-0000-4000-8000-000000000001',
  south: '00000000-0000-4000-8000-000000000002',
  admin: '00000000-0000-4000-8000-000000000003',
  tenant: '00000000-0000-4000-8000-000000000004',
  viewer: '00000000-0000-4000-8000-000000000005',
  membership: '00000000-0000-4000-8000-000000000006',
  event: '00000000-0000-4000-8000-000000000007',
  bulletin: '00000000-0000-4000-8000-000000000008',
  subscription: '00000000-0000-4000-8000-000000000009',
  run: '00000000-0000-4000-8000-000000000010',
};

type Scoped<T> = T & { organizationId: string };
export type DemoTenant = Scoped<TenantResponseDto>;
export type DemoMonitor = Scoped<UptimeMonitorDto>;
type Device = KioskDeviceResponseDto & { activationCode: string };
export const iso = (time = Date.now()) => new Date(time).toISOString();
export const demoAdmin: UserResponseDto = {
  id: demoIds.admin, name: 'Demo administrator', email: 'admin@example.test', role: 'PlatformAdmin', isPlatformAdmin: true,
};

export const demoIntervals: Required<FetchIntervalsDto> = {
  orderFetchIntervalMinutes: 30, uptimeFetchIntervalMinutes: 10, latencyFetchIntervalMinutes: 15,
  userStatsFetchIntervalMinutes: 60, statusFetchIntervalMinutes: 5, feedFetchIntervalHours: 2,
};

export const noIncident = { id: null, status: null, cause: null, reason: null, startedAt: null, durationSeconds: null };

export const demoOrgConfig: OrganizationConfigDto = {
  ...demoIntervals, weatherLocation: 'Stockholm', weatherFetchIntervalMinutes: 30,
  reportingTimeZoneId: 'Europe/Stockholm', monitoringProvider: 'uptimerobot', monitoringProviderSettings: {},
  monitoringProviderConfiguredSecretKeys: [], orderFetchEnabled: true, monitoringFetchEnabled: true,
  monitorsCount: 0, monitorsLimit: 100, activeSubscription: 'Demo',
};

export interface DemoState {
  organizations: OrganizationResponseDto[];
  tenants: DemoTenant[];
  monitors: DemoMonitor[];
  users: UserResponseDto[];
  memberships: UserMembershipResponseDto[];
  events: Scoped<CalendarEventDto>[];
  bulletins: Scoped<BulletinPostResponseDto>[];
  subscriptions: Scoped<CalendarSubscriptionDto>[];
  feeds: Scoped<FeedItem>[];
  devices: Device[];
  orders: Scoped<OrderDto>[];
  diagnosticEvents: DiagnosticEventDto[];
  runs: PipelineRunDto[];
  global: GlobalConfigResponseDto;
  intervals: FetchIntervalsDto;
  configs: Record<string, OrganizationConfigDto>;
  calendarToken: string;
  dashboardSession: boolean;
  nextMonitorId: number;
}

export function seedDemo(now = Date.now()): DemoState {
  const { north, admin, viewer, tenant, membership, event, bulletin, subscription, run } = demoIds;
  const stamp = iso(now);
  const organizations = agencies.map((agency, index) => ({ id: organizationId(index), name: agency.name }));
  const tenants: DemoTenant[] = clients.map(client => ({
    id: client.id, organizationId: organizationId(client.agency), name: client.name, type: client.type,
    orderProvider: client.provider, orderProviderSettings: { endpointUrl: client.url },
    orderProviderConfiguredSecretKeys: [client.provider === 'litium' ? 'authorization' : 'accessToken'],
    imageUrl: new URL(client.favicon, window.location.origin).href, currentlyFetching: false, orderFetchingEnabled: true, fetchedFrom: iso(now - 732 * dayMs),
    fetchedUntil: stamp, lastPolled: iso(now - 12 * 60_000), monitorCount: 0, lastSyncError: null, hasOrderProviderSettings: true,
  }));
  const monitors = seedFleet(tenants, now);
  const orders: DemoState['orders'] = [];
  const agencyContent = organizations.map((organization, index) => {
    const agency = agencies[index];
    const portfolio = tenants.filter(tenant => tenant.organizationId === organization.id);
    const [lead, launch] = portfolio;
    const staff = { id: fixtureId(300 + index), name: ['Linnea Berg', 'Mikkel Lund', 'Nora Ek'][index], role: 'Admin' as const };
    const account = { ...staff, email: `account-lead-${agency.region.toLowerCase()}-${index + 1}@example.test`, isPlatformAdmin: false };
    const at = (days: number, hour: number) => {
      const date = new Date(now + days * dayMs);
      date.setUTCHours(hour, 0, 0, 0);
      return date.toISOString();
    };
    return {
      account,
      membership: { id: fixtureId(310 + index), userId: staff.id, organizationId: organization.id, organizationName: organization.name, role: staff.role },
      events: [
        { id: fixtureId(340 + index * 10), title: `${lead.name} account review`, description: 'Review trading results, availability and next sprint priorities.', startTime: at(2, 9), endTime: at(2, 10), eventType: 'Meeting' as const, isRecurring: true, recurrence: 'Weekly' as const },
        { id: fixtureId(341 + index * 10), title: `${launch.name} checkout release`, description: 'Confirm checkout smoke tests with the client before the release window closes.', startTime: at(4, 12), endTime: at(4, 14), eventType: 'GoLive' as const },
      ].map(item => ({ ...item, organizationId: organization.id, location: agency.city, userId: staff.id, userName: staff.name })),
      bulletin: { id: fixtureId(370 + index), organizationId: organization.id, title: `${launch.name} checkout rollout`,
        body: `The ${launch.name} team approved the new checkout. Keep the storefront and payment probes open during Thursday’s rollout. Record any failed payments in the client handover.`, createdAt: at(-2, 10), updatedAt: null, author: { id: staff.id, name: staff.name } },
      feed: { id: fixtureId(380 + index), organizationId: organization.id, title: `${lead.name} trading notes`, link: '/intranet',
        content: 'The weekly client review is available. Look at the mix of returning accounts, mobile conversion and payment latency before the next sprint planning session.',
        publishDate: at(-1, 13), author: staff.name },
      run: { id: fixtureId(390 + index), organizationId: organization.id, organizationName: organization.name, tenantId: lead.id, tenantName: lead.name,
        kind: 'MonitorSync', trigger: 'Scheduled', state: index === 1 ? 'Failed' : 'Succeeded', resourceKey: lead.id, resourceName: lead.name,
        requestedAt: iso(now - 780_000), startedAt: iso(now - 775_000), completedAt: iso(now - 729_000), lastStateChangedAt: iso(now - 729_000),
        attemptCount: 1, workCount: index === 1 ? 0 : lead.monitorCount,
        safeSummary: index === 1 ? 'The monitoring provider timed out. A scheduled retry will pick up the remaining checks.' : 'Endpoint status and latency synchronized.' },
    };
  });
  return {
    organizations, tenants, monitors, orders, nextMonitorId: monitors.length + 1,
    users: [demoAdmin, ...agencyContent.map(item => item.account), { id: viewer, name: 'Demo viewer', email: 'viewer@example.test', role: 'Viewer', isPlatformAdmin: false }],
    memberships: [...agencyContent.map(item => item.membership), { id: membership, userId: viewer, organizationId: north, organizationName: organizations[0].name, role: 'Viewer' }],
    events: [...agencyContent.flatMap(item => item.events), {
      organizationId: north, id: event, title: 'Morning service review', description: 'Review client orders, incident follow-ups and the day’s scheduled deployments.',
      location: 'Stockholm', startTime: iso(now - 900_000), endTime: iso(now + 2_700_000),
      eventType: 'Meeting', isRecurring: true, recurrence: 'Weekly', userId: admin, userName: demoAdmin.name,
    }],
    bulletins: [...agencyContent.map(item => item.bulletin), {
      organizationId: north, id: bulletin, title: 'On-call handover for the sales campaign', body: 'Review payment alerts and confirm client escalation contacts before the Friday handover.',
      createdAt: stamp, updatedAt: null, author: { id: admin, name: demoAdmin.name },
    }],
    subscriptions: [{
      organizationId: north, id: subscription, name: 'Trading calendar', url: 'https://calendar.example.test/trading.ics',
      isActive: true, lastPolledAt: stamp, lastSuccessAt: stamp,
    }],
    feeds: [...agencyContent.map(item => item.feed), {
      organizationId: north, id: '00000000-0000-4000-8000-000000000011', title: 'Storefront update', link: '/intranet',
      content: 'The team has finished this week’s storefront review.', publishDate: stamp, author: 'Northstar Commerce',
    }],
    devices: [], global: { id: 1, lastPolled: stamp, systemEventRetentionDays: 30, matViewRefreshIntervalMinutes: 15, visibleRecurringJobs: ['FeedFetch'] },
    intervals: { ...demoIntervals }, configs: Object.fromEntries(organizations.map((org, i) => [
      org.id, { ...demoOrgConfig, weatherLocation: agencies[i].city, reportingTimeZoneId: i === 1 ? 'Europe/Copenhagen' : 'Europe/Stockholm' },
    ])), calendarToken: 'static-demo-feed', dashboardSession: false,
    runs: [...agencyContent.map(item => item.run), {
      id: run, organizationId: north, organizationName: organizations[0].name, tenantId: tenant, tenantName: tenants[0].name,
      kind: 'OrderIngestion', trigger: 'Scheduled', state: 'Succeeded', resourceKey: tenant, resourceName: tenants[0].name,
      requestedAt: stamp, startedAt: stamp, completedAt: stamp, lastStateChangedAt: stamp, attemptCount: 1,
      safeSummary: 'Sample orders refreshed.', workCount: 24,
    }],
    diagnosticEvents: [...agencyContent.map((item, index) => ({
      id: fixtureId(400 + index), organizationId: item.run.organizationId, tenantId: item.run.tenantId,
      tenantName: item.run.tenantName, pipelineRunId: item.run.id, timestamp: item.run.completedAt,
      level: index === 1 ? 'Warning' : 'Information', source: 'Monitoring',
      code: index === 1 ? 'provider.timeout' : 'monitor.sync.completed', message: item.run.safeSummary,
      suggestedAction: index === 1 ? 'Check provider connectivity if the scheduled retry also fails.' : null,
    })), {
      id: '00000000-0000-4000-8000-000000000012', timestamp: stamp, level: 'Information', organizationId: north,
      source: 'Order ingestion', code: 'orders.synced', message: 'Sample orders refreshed.', tenantId: tenant, pipelineRunId: run,
    }],
  };
}

// Keep the old sandbox intact. The expanded catalog and generated order history use a new seed.
const storageKey = 'adwais.static-demo.v2';
let memory: DemoState | undefined;

export function loadDemoState(): DemoState {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return JSON.parse(saved) as DemoState;
  } catch {
    // Storage may be unavailable in a restricted browser.
  }
  return memory ??= seedDemo();
}

export function saveDemoState(state: DemoState) {
  memory = state;
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Changes remain available in this tab.
  }
}

export function resetDemoState() {
  memory = undefined;
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // The in-memory state is already cleared.
  }
}
