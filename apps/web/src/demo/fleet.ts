import { agencies, dayMs, hourMs, noise, organizationId } from './catalog';
import { iso, noIncident, type DemoMonitor, type DemoTenant } from './state';

const checks = [
  ['storefront', 'HTTP', 'web', 99.95],
  ['checkout', 'KEYWORD', 'checkout', 99.9],
  ['inventory API', 'HTTP', 'integration', 99.9],
  ['authoritative DNS', 'DNS', 'infrastructure', 99.95],
  ['warehouse gateway', 'PING', 'infrastructure', 99.5],
  ['order export', 'HEARTBEAT', 'integration', 99.5],
  ['partner SFTP', 'PORT', 'integration', 99.5],
] as const;

export function seedFleet(tenants: DemoTenant[], now: number) {
  const monitors: DemoMonitor[] = [];
  function add(tenant: DemoTenant | undefined, index: number, checkIndex: number, agency: number, monitorId: number) {
    const [kind, type, tag, uptimeSla] = checks[checkIndex];
    const name = tenant && checkIndex === 0 ? tenant.type === 'B2B' ? 'procurement portal' : 'online store'
      : tenant && checkIndex === 1 && tenant.type !== 'B2C' ? tenant.type === 'B2B' ? 'account sign-in' : 'partner portal' : kind;
    const baseUrl = tenant ? String(tenant.orderProviderSettings?.endpointUrl) : null;
    const domain = baseUrl ? new URL(baseUrl).hostname : `${agencies[agency].region.toLowerCase()}-staging.example.test`;
    const createdDate = iso(now - (monitorId % 29 === 0 ? 2 : 750) * dayMs);
    const disabled = monitorId % 31 === 0 || !tenant;
    const currentStatus = disabled ? 'Paused' : monitorId % 43 === 0 ? 'Down' : monitorId % 29 === 0 ? 'Starting' : 'Up';
    const latencyDegradedFloor = type === 'HTTP' || type === 'KEYWORD' ? 280 : 170;
    const currentLatency = monitorId % 17 === 0 ? latencyDegradedFloor + 85 :
      Math.round((type === 'DNS' || type === 'PING' ? 22 : 78) + noise(monitorId * 513) * 112);
    const startedAt = iso(now - 17 * 60_000);
    const latestIncident = currentStatus === 'Down' ? {
      id: `INC-${monitorId}`, status: 'Down', cause: 'Connection timeout', reason: 'The endpoint did not respond in 30 seconds.',
      startedAt, durationSeconds: 1020,
    } : monitorId % 5 === 0 ? {
      id: `INC-${monitorId}`, status: 'Resolved', cause: 'HTTP 503', reason: 'The upstream service recovered after deployment.',
      startedAt: iso(now - (2 + monitorId % 9) * dayMs), durationSeconds: 420 + monitorId % 13 * 60,
    } : noIncident;
    monitors.push({
      id: monitorId, organizationId: tenant?.organizationId ?? organizationId(agency), tenantId: tenant?.id,
      tenantName: tenant?.name ?? null, name: `${tenant?.name ?? 'Shared staging'} ${name}`,
      type, provider: 'uptimerobot', externalId: String(410000 + monitorId),
      url: type === 'PING' || type === 'DNS' || type === 'PORT' ? domain
        : checkIndex === 0 && baseUrl ? baseUrl : `https://${domain}/${checkIndex === 1 ? tenant?.type === 'B2B' ? 'account' : tenant?.type === 'Mixed' ? 'business' : 'checkout' : 'health'}`,
      uptimeSla, latencyDegradedFloor, currentStatus, currentUptimePercentage: null, currentLatency: disabled ? null : currentLatency,
      uptimeMonitorEnabled: !disabled, updateInterval: checkIndex === 0 ? 60 : checkIndex === 1 ? 180 : 300,
      lastUpdate: iso(now - index * 12_000), lastUptimeUpdate: iso(now - index * 12_000),
      lastLatencyUpdate: iso(now - index * 12_000), createdDate,
      tags: [checkIndex === 0 ? 'storefront' : tag, checkIndex < 2 ? 'customer-facing' : 'backend',
        tenant ? 'production' : 'staging', `region:${agencies[agency].region.toLowerCase()}`, ...(checkIndex === 1 ? ['critical'] : [])],
      monitoredRegions: type === 'HEARTBEAT' ? [] : index % 3 === 0 ? ['Europe', 'North America'] : ['Europe'],
      httpMethod: type === 'HTTP' || type === 'KEYWORD' ? 'GET' : null, timeoutSeconds: checkIndex < 2 ? 30 : 15,
      tenantBaseUrl: tenant ? String(tenant.orderProviderSettings?.endpointUrl) : null, tenantImageUrl: tenant?.imageUrl ?? null,
      sslExpiresAt: type === 'HTTP' || type === 'KEYWORD' ? iso(now + (25 + monitorId % 63) * dayMs) : null,
      domainExpiresAt: iso(now + (110 + index * 11) * dayMs), currentStateDurationSeconds: latestIncident.durationSeconds ?? 86_400,
      latestIncident,
    });
  }
  tenants.forEach((tenant, i) => add(tenant, i, 0, agencies.findIndex((_, j) => organizationId(j) === tenant.organizationId), i + 1));
  tenants.forEach((tenant, i) => {
    const agency = agencies.findIndex((_, j) => organizationId(j) === tenant.organizationId);
    const other = [1, 2 + i % 5, ...(i % 3 === 0 ? [2 + ((i + 2) % 5)] : [])];
    for (const check of other) add(tenant, i, check, agency, monitors.length + 1);
    tenant.monitorCount = monitors.filter(monitor => monitor.tenantId === tenant.id).length;
  });
  agencies.forEach((_, i) => add(undefined, i, 2 + i, i, monitors.length + 1));
  return monitors;
}

export function downtime(monitor: DemoMonitor, start: number, end: number) {
  const id = monitor.id ?? 0;
  let total = 0;
  const firstDay = Math.floor(start / dayMs);
  for (let day = firstDay; day * dayMs < end; day++) {
    if (noise(day * 319 + id * 1871) > (id % 20 < 14 ? .009 : id % 20 < 18 ? .017 : .034)) continue;
    const incident = day * dayMs + Math.floor(noise(day * 457 + id * 271) * 24) * hourMs;
    const duration = (2 + Math.floor(noise(day * 877 + id * 149) ** 2 * 28)) * 60_000;
    total += Math.max(0, Math.min(end, incident + duration) - Math.max(start, incident));
  }
  const latest = monitor.latestIncident;
  const incident = Date.parse(latest?.startedAt ?? '');
  if (Number.isFinite(incident)) {
    total += Math.max(0, Math.min(end, incident + (latest.durationSeconds ?? 0) * 1000) - Math.max(start, incident));
  }
  return total;
}

export function uptime(monitor: DemoMonitor, from: number, to: number) {
  if (!monitor.uptimeMonitorEnabled || monitor.currentStatus === 'Starting') return null;
  const start = Math.max(from, Date.parse(monitor.createdDate ?? '') || from);
  if (start >= to) return null;
  return 100 * Math.max(0, 1 - downtime(monitor, start, to) / (to - start));
}

export function latencyAt(monitor: DemoMonitor, time: number) {
  const baseline = monitor.currentLatency;
  if (baseline == null || !monitor.uptimeMonitorEnabled || (monitor.createdDate && time < Date.parse(monitor.createdDate))) return null;
  const hour = Math.floor(time / hourMs);
  const sample = noise(hour * 233 + (monitor.id ?? 0) * 197);
  const load = Math.sin((hour % 24 - 9) / 24 * Math.PI * 2) * .08;
  return Math.round(baseline * (.88 + sample * .19 + load) + (sample > .97 ? 38 : 0));
}
