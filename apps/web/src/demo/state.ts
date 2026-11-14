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
export const dayMs = 86_400_000;
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
  monitorsCount: 0, monitorsLimit: 25, activeSubscription: 'Demo',
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
  const { north, south, admin, viewer, tenant, membership, event, bulletin, subscription, run } = demoIds;
  const stamp = iso(now);
  const organizations = [{ id: north, name: 'Northstar Commerce' }, { id: south, name: 'Southbank Retail' }];
  const tenants: DemoTenant[] = [
    ['Fjord Supply', 'B2B'], ['Juniper Market', 'B2C'], ['Wren Goods', 'Mixed'], ['Harbour Outlet', 'B2C'],
  ].map(([name, type], index) => ({
    id: index === 0 ? tenant : `00000000-0000-4000-8000-00000000002${index}`,
    organizationId: index === 3 ? south : north, name, type: type as DemoTenant['type'],
    orderProvider: 'litium', orderProviderSettings: { endpointUrl: 'https://shop.example.test' },
    orderProviderConfiguredSecretKeys: [], imageUrl: null, currentlyFetching: false, orderFetchingEnabled: true,
    fetchedFrom: iso(now - 730 * dayMs), fetchedUntil: stamp, lastPolled: stamp, monitorCount: 1,
    lastSyncError: null, hasOrderProviderSettings: true,
  }));
  const monitors: DemoMonitor[] = tenants.map((item, index) => ({
    organizationId: item.organizationId, id: index + 1, tenantId: item.id, tenantName: item.name,
    name: `${item.name} storefront`, url: `https://store-${index + 1}.example.test`, type: 'HTTP',
    provider: 'uptimerobot', externalId: String(index + 1), currentStatus: index === 2 ? 'Down' : 'Up',
    currentUptimePercentage: [99.99, 99.92, 97.35, 99.78][index], currentLatency: 82 + index * 47,
    uptimeMonitorEnabled: true, updateInterval: 300, uptimeSla: 99.9, latencyDegradedFloor: 220,
    lastUpdate: stamp, lastUptimeUpdate: stamp, lastLatencyUpdate: stamp, createdDate: iso(now - 730 * dayMs),
    tags: [index % 2 ? 'checkout' : 'storefront'], monitoredRegions: ['Europe'], httpMethod: 'GET', timeoutSeconds: 30,
    tenantBaseUrl: null, tenantImageUrl: null, sslExpiresAt: null, domainExpiresAt: null,
    currentStateDurationSeconds: 3600, latestIncident: noIncident,
  }));
  const orders = Array.from({ length: 732 }, (_, day) => tenants.map((item, index): Scoped<OrderDto> => {
    const value = 180 + ((day * 67 + index * 293) % 1200) + (731 - day) / 4;
    return {
      organizationId: item.organizationId, adwaisOrderId: `10000000-0000-4000-8000-${String(day * 4 + index).padStart(12, '0')}`,
      adwaisTenantId: item.id, orderNumber: `DEMO-${10300 + day * 4 + index}`, orderState: 'Completed',
      createdDate: iso(now - day * dayMs - index * 730_000), totalValueExcVat: value, totalValueIncVat: value * 1.25,
      currency: 'SEK', tenantName: item.name, provider: 'Litium', externalId: String(day * 4 + index),
    };
  })).flat();
  return {
    organizations, tenants, monitors, orders, nextMonitorId: monitors.length + 1,
    users: [demoAdmin, { id: viewer, name: 'Demo viewer', email: 'viewer@example.test', role: 'Viewer', isPlatformAdmin: false }],
    memberships: [{ id: membership, userId: viewer, organizationId: north, organizationName: organizations[0].name, role: 'Viewer' }],
    events: [{
      organizationId: north, id: event, title: 'Trading review', description: 'Review orders and storefront health.',
      location: 'Stockholm', startTime: iso(now + 1_800_000), endTime: iso(now + 5_400_000),
      eventType: 'Meeting', isRecurring: true, recurrence: 'Weekly', userId: admin, userName: demoAdmin.name,
    }],
    bulletins: [{
      organizationId: north, id: bulletin, title: 'Welcome to Northstar', body: 'Explore the sample shops and daily trading reports.',
      createdAt: stamp, updatedAt: null, author: { id: admin, name: demoAdmin.name },
    }],
    subscriptions: [{
      organizationId: north, id: subscription, name: 'Trading calendar', url: 'https://calendar.example.test/trading.ics',
      isActive: true, lastPolledAt: stamp, lastSuccessAt: stamp,
    }],
    feeds: [{
      organizationId: north, id: '00000000-0000-4000-8000-000000000011', title: 'Storefront update', link: '/intranet',
      content: 'The team has finished this week’s storefront review.', publishDate: stamp, author: 'Northstar Commerce',
    }],
    devices: [], global: { id: 1, lastPolled: stamp, systemEventRetentionDays: 30, matViewRefreshIntervalMinutes: 15, visibleRecurringJobs: ['FeedFetch'] },
    intervals: { ...demoIntervals }, configs: {}, calendarToken: 'static-demo-feed', dashboardSession: false,
    runs: [{
      id: run, organizationId: north, organizationName: organizations[0].name, tenantId: tenant, tenantName: tenants[0].name,
      kind: 'OrderIngestion', trigger: 'Scheduled', state: 'Succeeded', resourceKey: tenant, resourceName: tenants[0].name,
      requestedAt: stamp, startedAt: stamp, completedAt: stamp, lastStateChangedAt: stamp, attemptCount: 1,
      safeSummary: 'Sample orders refreshed.', workCount: 24,
    }],
    diagnosticEvents: [{
      id: '00000000-0000-4000-8000-000000000012', timestamp: stamp, level: 'Information', organizationId: north,
      source: 'Order ingestion', code: 'orders.synced', message: 'Sample orders refreshed.', tenantId: tenant, pipelineRunId: run,
    }],
  };
}

const storageKey = 'adwais.static-demo.v1';
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
