import { invalid, json, missing, scoped, withoutScope, type DemoRequest, type Handler } from './http';
import { dayMs, iso } from './state';
import { normalizeStatus } from '../utils/monitorStatusHelper';

const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const growth = (value: number, previous: number) => previous ? (value / previous - 1) * 100 : 0;

function period({ query, now }: DemoRequest) {
  const key = query('timeframe') || query('period') || 'T30';
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = key === 'Today' ? +today : key === 'Ytd'
    ? +new Date(today.getFullYear(), 0, 1)
    : now - (/^T\d+$/.test(key) ? Math.min(365, Number(key.slice(1))) : 30) * dayMs;
  return { start, end: now, offset: query('comparison') === 'YearOverYear' ? 365 * dayMs : now - start };
}

function financial(context: DemoRequest) {
  const { state, query, values, organizationId, now } = context;
  const tenantId = query('tenantId');
  const tenantTypes = values('tenantTypes');
  const tenants = scoped(state.tenants, organizationId).filter(tenant =>
    tenantId ? tenant.id === tenantId : !tenantTypes.length || tenantTypes.includes(tenant.type ?? ''));
  const ids = new Set(tenants.map(tenant => tenant.id));
  const orders = state.orders.filter(order => ids.has(order.adwaisTenantId ?? ''));
  const { start, end, offset } = period(context);
  const between = (from: number, until: number) =>
    orders.filter(order => Date.parse(order.createdDate ?? '') >= from && Date.parse(order.createdDate ?? '') <= until);
  const current = between(start, end);
  const previous = between(start - offset, end - offset - 1);
  const revenue = (rows: typeof orders) => rows.reduce((sum, order) => sum + (order.totalValueExcVat ?? 0), 0);
  const total = revenue(current);
  const baseline = revenue(previous);
  const points = [];
  const step = Math.max(dayMs / 24, Math.ceil((end - start) / dayMs / 90) * dayMs);
  let currentAccumulated = 0;
  let previousAccumulated = 0;
  for (let time = start; time <= end; time += step) {
    const active = between(time, time + step - 1);
    const prior = between(time - offset, time - offset + step - 1);
    const currentRevenue = revenue(active);
    const previousRevenue = revenue(prior);
    currentAccumulated += currentRevenue;
    previousAccumulated += previousRevenue;
    const byType = (type: string) => revenue(active.filter(order => tenants.some(tenant => tenant.id === order.adwaisTenantId && tenant.type === type)));
    points.push({ timestamp: iso(time), currentRevenue, previousRevenue, currentAccumulated, previousAccumulated,
      currentRevenueB2C: byType('B2C'), currentRevenueB2B: byType('B2B'), currentRevenueMixed: byType('Mixed') });
  }
  const perTenant = tenants.map(tenant => {
    const active = current.filter(order => order.adwaisTenantId === tenant.id);
    const prior = previous.filter(order => order.adwaisTenantId === tenant.id);
    const periodRevenue = revenue(active);
    return {
      tenantId: tenant.id, tenantName: tenant.name, type: tenant.type, orderVolume: active.length,
      averageOrderValue: periodRevenue / (active.length || 1), periodRevenue, currentRevenue: periodRevenue,
      baselineRevenue: revenue(prior), growthPercentage: growth(periodRevenue, revenue(prior)),
      volumeGrowthPercentage: growth(active.length, prior.length), portfolioSharePercentage: total ? periodRevenue / total * 100 : 0,
      growthVelocity: growth(periodRevenue, revenue(prior)), orderProviderEndpoint: null,
    };
  });
  return { now, tenants, orders, current, previous, start, end, total, baseline, points, perTenant, between };
}

const monitorList = ({ state, organizationId, query, values }: DemoRequest) => scoped(state.monitors, organizationId).filter(monitor => {
  const status = normalizeStatus(monitor.currentStatus);
  const tags = monitor.tags ?? [];
  return (!query('tenantId') || monitor.tenantId === query('tenantId'))
    && (!query('monitorId') || String(monitor.id) === query('monitorId'))
    && (!values('tags').length || values('tags').some(tag => tags.includes(tag)))
    && !values('excludedTags').some(tag => tags.includes(tag))
    && (!values('statuses').length || values('statuses').some(value => normalizeStatus(value) === status))
    && !values('excludedStatuses').some(value => normalizeStatus(value) === status);
});

function monitorSeries(context: DemoRequest) {
  const monitors = monitorList(context);
  const { start, end } = period(context);
  const latency = mean(monitors.map(monitor => monitor.currentLatency ?? 0));
  const uptime = mean(monitors.map(monitor => monitor.currentUptimePercentage ?? 0));
  const lowest = monitors.length ? Math.min(...monitors.map(monitor => monitor.currentUptimePercentage ?? 0)) : 0;
  const step = Math.max(dayMs / 24, Math.ceil((end - start) / dayMs / 36) * dayMs);
  const points = [];
  for (let time = start, i = 0; monitors.length && time <= end; time += step, i++) {
    const endTime = Math.min(end, time + step);
    points.push({
      timestamp: iso(time), date: iso(time), endDate: iso(endTime), isPartial: endTime - time < step,
      average: latency + (i * 23 % 37) - 12, previousAverage: latency + (i * 13 % 31),
      p10: latency * .82, p90: latency * 1.2, currentState: 'Observed', previousState: 'Observed',
      uptimePercentage: uptime, lowestMonitorUptimePercentage: lowest, monitorCount: monitors.length,
    });
  }
  return { start, end, monitors, latency, uptime, lowest, points };
}

export const analytics: Record<string, Handler> = {
  'GET /api/financial/kpis': context => {
    const { total, baseline, current, previous } = financial(context);
    const active = new Set(current.map(order => order.adwaisTenantId)).size;
    const prior = new Set(previous.map(order => order.adwaisTenantId)).size;
    const aov = total / (current.length || 1);
    const averageRevenuePerTenant = total / (active || 1);
    return json({ currentRevenue: total, previousRevenue: baseline, revenueGrowthPercentage: growth(total, baseline),
      transactionVolume: current.length, volumeGrowthPercentage: growth(current.length, previous.length),
      averageOrderValue: aov, aovGrowthPercentage: growth(aov, baseline / (previous.length || 1)),
      activeTenants: active, activeTenantsGrowthPercentage: growth(active, prior), averageRevenuePerTenant,
      arptGrowthPercentage: growth(averageRevenuePerTenant, baseline / (prior || 1)) });
  },
  'GET /api/financial/accumulated-revenue': context => json(financial(context).points),
  'GET /api/financial/revenue-efficiency': context => {
    const { total, current, perTenant } = financial(context);
    return json({ globalAverageOrderValue: total / (current.length || 1),
      medianOrderVolume: mean(perTenant.map(row => row.orderVolume)),
      medianPortfolioShare: mean(perTenant.map(row => row.portfolioSharePercentage)), tenants: perTenant });
  },
  'GET /api/financial/cross-segment-distribution': context => {
    const { perTenant } = financial(context);
    return json({ tenants: perTenant.map(row => ({ ...row, aovPercentileRank: 50, volumePercentileRank: 50, revenuePercentileRank: 50 })),
      cohorts: ['B2B', 'B2C', 'Mixed'].flatMap(type => {
        const rows = perTenant.filter(row => row.type === type);
        if (!rows.length) return [];
        const aov = mean(rows.map(row => row.averageOrderValue));
        const volume = mean(rows.map(row => row.orderVolume));
        const revenue = mean(rows.map(row => row.periodRevenue));
        return [{ type, tenantCount: rows.length, medianAov: aov, q1Aov: aov, q3Aov: aov,
          medianVolume: volume, q1Volume: volume, q3Volume: volume, medianRevenue: revenue, q1Revenue: revenue, q3Revenue: revenue }];
      }) });
  },
  'GET /api/financial/portfolio-impact': context => {
    const { total, baseline, perTenant } = financial(context);
    return json({ medianBaselineRevenue: mean(perTenant.map(row => row.baselineRevenue)), globalGrowthPercentage: growth(total, baseline),
      medianPortfolioShare: mean(perTenant.map(row => row.portfolioSharePercentage)), tenants: perTenant });
  },
  'GET /api/financial/daily-revenue-delta': context => json(financial(context).points.map(point =>
    ({ timestamp: point.timestamp, netGrowthAddition: point.currentRevenue - point.previousRevenue }))),
  'GET /api/financial/cumulative-growth-delta': context => json(financial(context).points.map(point =>
    ({ timestamp: point.timestamp, currentCumulative: point.currentAccumulated, previousCumulative: point.previousAccumulated,
      cumulativeGrowthDelta: point.currentAccumulated - point.previousAccumulated }))),
  'GET /api/financial/order-distribution': context => {
    if (!context.query('tenantId')) return invalid('TenantId is required.');
    const binCount = context.query('binCount');
    if (binCount !== null && (!Number.isInteger(Number(binCount)) || Number(binCount) < 1)) return invalid('BinCount must be greater than 0.');
    const { current } = financial(context);
    if (!current.length) return json([]);
    const count = Math.min(50, Number(binCount) || 10);
    const max = Math.ceil(Math.max(...current.map(order => order.totalValueExcVat ?? 0)) / count);
    let seen = 0;
    return json(Array.from({ length: count }, (_, i) => {
      const minValue = i * max, maxValue = (i + 1) * max;
      const orderCount = current.filter(order => (order.totalValueExcVat ?? 0) >= minValue
        && (i === count - 1 || (order.totalValueExcVat ?? 0) < maxValue)).length;
      seen += orderCount;
      return { binLabel: `${minValue}–${maxValue}`, minValue, maxValue, orderCount,
        cumulativePercentage: seen / current.length * 100, kdeDensity: orderCount / current.length };
    }));
  },
  'GET /api/financial/transaction-density': context => {
    const { current, start, end } = financial(context);
    const points = Array.from({ length: 168 }, (_, i) => ({ dayOfWeek: Math.floor(i / 24), hour: i % 24, count: 0, totalRevenue: 0 }));
    for (const order of current) {
      const date = new Date(order.createdDate ?? '');
      const bucket = points[date.getUTCDay() * 24 + date.getUTCHours()];
      bucket.count++;
      bucket.totalRevenue += order.totalValueExcVat ?? 0;
    }
    const requestedPeriod = context.query('period') || 'Auto';
    return json({ totalCount: current.length, minCount: Math.min(...points.map(p => p.count)),
      maxCount: Math.max(...points.map(p => p.count)), averageCountPerBucket: current.length / points.length,
      sampleQuality: current.length >= 100 ? 'Stable' : 'Sparse', requestedPeriod,
      effectivePeriod: requestedPeriod === 'Auto' ? 'T30' : requestedPeriod, timeZoneId: 'UTC', periodStart: iso(start), periodEnd: iso(end), points });
  },
  'GET /api/financial/orders': context => {
    const { between } = financial(context);
    const from = context.query('dateSince');
    const to = context.query('dateUntil');
    return json(between(from ? Date.parse(from) : 0, to ? Date.parse(to) : context.now)
      .sort((a, b) => Date.parse(b.createdDate ?? '') - Date.parse(a.createdDate ?? ''))
      .slice(0, Number(context.query('CeilingCount')) || 100).map(withoutScope));
  },
  'GET /api/monitors': context => json(monitorList(context).map(withoutScope)),
  'GET /api/monitors/unassigned': context => json(monitorList(context).filter(monitor => !monitor.tenantId).map(withoutScope)),
  'GET /api/monitors/analytics': context => {
    const { latency, uptime, points, monitors } = monitorSeries(context);
    const values = monitors.map(monitor => monitor.currentLatency ?? 0);
    const highestLatency = values.length ? Math.max(...values) : 0;
    const lowestLatency = values.length ? Math.min(...values) : 0;
    return json({ globalAverageLatency: latency, latencyPoints: points.map(({ timestamp, average, previousAverage, p10, p90, currentState, previousState }) =>
      ({ timestamp, average, previousAverage, p10, p90, currentState, previousState })),
    kpis: { averageUptime: uptime, previousAverageUptime: uptime, uptimeGrowthPercentage: 0,
      averageLatency: latency, previousAverageLatency: latency, latencyGrowthPercentage: 0,
      highestLatency, previousHighestLatency: highestLatency, highestLatencyGrowthPercentage: 0,
      lowestLatency, previousLowestLatency: lowestLatency, lowestLatencyGrowthPercentage: 0 } });
  },
  'GET /api/monitors/availability': context => {
    const { start, end, uptime, lowest, points } = monitorSeries(context);
    return json({ periodStart: iso(start), periodEnd: iso(end), averageUptimePercentage: uptime, lowestUptimePercentage: lowest,
      points: points.map(({ date, endDate, uptimePercentage, lowestMonitorUptimePercentage, monitorCount, isPartial }) =>
        ({ date, endDate, uptimePercentage, lowestMonitorUptimePercentage, monitorCount, isPartial })) });
  },
  'GET /api/monitors/{id}/latency': context => {
    const monitor = monitorList(context).find(row => row.id === Number(context.params.id));
    if (!monitor) return missing();
    const from = Date.parse(context.query('from') ?? iso(context.now - 7 * dayMs));
    const to = Date.parse(context.query('to') ?? iso(context.now));
    const count = Math.min(168, Math.max(1, Math.ceil((to - from) / 3_600_000)));
    return json(Array.from({ length: count }, (_, i) => {
      const average = (monitor.currentLatency ?? 0) + (i * 23 % 37) - 12;
      return { date: iso(from + i * (to - from) / count), average, lowest: average * .8, highest: average * 1.2 };
    }));
  },
};
