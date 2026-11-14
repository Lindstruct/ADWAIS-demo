import { invalid, json, missing, scoped, withoutScope, type DemoRequest, type Handler } from './http';
import { iso } from './state';
import { clientsById, dayMs, hourMs, localMidnight, reportingClock, wallTime } from './catalog';
import { tradeHours } from './commerce';
import { latencyAt, uptime } from './fleet';
import { normalizeStatus } from '../utils/monitorStatusHelper';

const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const growth = (value: number, previous: number) => previous ? (value / previous - 1) * 100 : 0;

function clockFor({ state, organizationId }: DemoRequest) {
  return reportingClock((organizationId && state.configs[organizationId]?.reportingTimeZoneId) || 'Europe/Stockholm');
}

function period(context: DemoRequest) {
  const { query, now } = context;
  const key = query('timeframe') || 'T30';
  const clock = clockFor(context);
  const rolling = key === 'Today' || key === 'T7';
  const days = key === 'Today' ? 1 : Number(key.slice(1)) || 30;
  const start = rolling ? now - days * dayMs : localMidnight(now, clock, key === 'Ytd' ? 0 : days - 1, key === 'Ytd');
  const prior = new Date(start);
  prior.setUTCFullYear(prior.getUTCFullYear() - 1);
  const preceding = rolling ? start - days * dayMs : localMidnight(start, clock, Math.ceil((now - start) / dayMs));
  const offset = start - (query('comparison') === 'YearOverYear' ? +prior : preceding);
  return { start, end: now, offset, clock, rolling };
}

function tradingTenants({ state, query, values, organizationId }: DemoRequest) {
  const tenantId = query('tenantId');
  const types = values('tenantTypes');
  return scoped(state.tenants, organizationId).filter(tenant =>
    tenantId ? tenant.id === tenantId : !types.length || types.includes(tenant.type ?? ''));
}

const sumBy = <T,>(rows: T[], value: (row: T) => number) => rows.reduce((sum, row) => sum + value(row), 0);
const quantile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
};
const median = (values: number[]) => quantile(values, .5);

function financial(context: DemoRequest) {
  const tenants = tradingTenants(context);
  const { start, end, offset, rolling } = period(context);
  const current = [...tradeHours(tenants, context.state, start, end)];
  const previous = [...tradeHours(tenants, context.state, start - offset, end - offset)];
  const revenue = (rows: typeof current) => sumBy(rows, row => row.revenue);
  const count = (rows: typeof current) => sumBy(rows, row => row.count);
  const total = revenue(current);
  const baseline = revenue(previous);
  const step = rolling ? context.query('timeframe') === 'Today' ? hourMs / 2 : hourMs * 4 : dayMs;
  const points = Array.from({ length: Math.ceil((end - start) / step) }, (_, index) => ({
    timestamp: iso(start + index * step), currentRevenue: 0, previousRevenue: 0,
    currentRevenueB2C: 0, currentRevenueB2B: 0, currentRevenueMixed: 0, currentAccumulated: 0, previousAccumulated: 0,
  }));
  for (const row of current) {
    const point = points[Math.floor((row.time - start) / step)];
    point.currentRevenue += row.revenue;
    const type = row.tenant.type ?? 'Mixed';
    point[`currentRevenue${type}`] += row.revenue;
  }
  for (const row of previous) points[Math.floor((row.time + offset - start) / step)].previousRevenue += row.revenue;
  let currentAccumulated = 0, previousAccumulated = 0;
  for (const point of points) {
    point.currentAccumulated = currentAccumulated += point.currentRevenue;
    point.previousAccumulated = previousAccumulated += point.previousRevenue;
  }
  const perTenant = tenants.map(tenant => {
    const active = current.filter(row => row.tenant.id === tenant.id);
    const prior = previous.filter(row => row.tenant.id === tenant.id);
    const periodRevenue = revenue(active);
    const orderVolume = count(active);
    return {
      tenantId: tenant.id, tenantName: tenant.name, type: tenant.type, orderVolume,
      averageOrderValue: periodRevenue / (orderVolume || 1), periodRevenue, currentRevenue: periodRevenue,
      baselineRevenue: revenue(prior), growthPercentage: growth(periodRevenue, revenue(prior)),
      volumeGrowthPercentage: growth(orderVolume, count(prior)), portfolioSharePercentage: total ? periodRevenue / total * 100 : 0,
      growthVelocity: growth(periodRevenue, revenue(prior)), orderProviderEndpoint: tenant.orderProviderSettings?.endpointUrl ?? null,
    };
  });
  return { current, previous, currentCount: count(current), priorCount: count(previous), total, baseline, points, perTenant };
}

const monitorList = ({ state, organizationId, query, values }: DemoRequest) => scoped(state.monitors, organizationId).filter(monitor => {
  const status = normalizeStatus(monitor.currentStatus);
  const tags = (monitor.tags ?? []).map(tag => tag.toLowerCase());
  return (!query('tenantId') || monitor.tenantId === query('tenantId'))
    && (!query('monitorId') || String(monitor.id) === query('monitorId'))
    && (!values('tags').length || values('tags').some(tag => tags.includes(tag.toLowerCase())))
    && !values('excludedTags').some(tag => tags.includes(tag.toLowerCase()))
    && (!values('statuses').length || values('statuses').some(value => normalizeStatus(value) === status))
    && !values('excludedStatuses').some(value => normalizeStatus(value) === status);
});

function fleetStats(monitors: ReturnType<typeof monitorList>, start: number, end: number) {
  const uptimes = monitors.map(monitor => uptime(monitor, start, end)).filter(value => value !== null);
  const latencies = monitors.map(monitor => latencyAt(monitor, start + (end - start) / 2)).filter(value => value !== null);
  return { uptimes, latencies, average: latencies.length ? mean(latencies) : null };
}

function monitorSeries(context: DemoRequest) {
  const monitors = monitorList(context);
  const { start, end, offset, clock } = period(context);
  const dateLabel = (time: number) => {
    const { year, month, day } = wallTime(time, clock);
    return iso(Date.UTC(year, month - 1, day)).slice(0, 10);
  };
  const startDay = localMidnight(start, clock);
  const current = fleetStats(monitors, start, end);
  const previous = fleetStats(monitors, start - offset, end - offset);
  const availability = [];
  const latency = [];
  const bucketDays = Math.max(1, Math.ceil((end - start) / dayMs / 75));
  for (let day = startDay, i = 0; monitors.length && day < end; i += bucketDays, day = localMidnight(startDay, clock, -i)) {
    const nextDay = localMidnight(startDay, clock, -i - bucketDays);
    const from = Math.max(day, start);
    const until = Math.min(nextDay, end);
    const uptimes = monitors.map(monitor => uptime(monitor, from, until)).filter(value => value !== null);
    availability.push({ date: dateLabel(day), endDate: dateLabel(until - 1), isPartial: from > day || until < nextDay,
      uptimePercentage: uptimes.length ? mean(uptimes) : null,
      lowestMonitorUptimePercentage: uptimes.length ? Math.min(...uptimes) : null, monitorCount: uptimes.length });
  }
  const step = (end - start <= 7 * dayMs ? 4 : 24 * bucketDays) * hourMs;
  for (let from = start; monitors.length && from < end; from += step) {
    const to = Math.min(from + step, end);
    const sample = (t: number) => monitors.map(monitor => latencyAt(monitor, t)).filter(value => value !== null);
    const currentValues = sample(from + (to - from) / 2);
    const previousValues = sample(from + (to - from) / 2 - offset);
    latency.push({ timestamp: iso(from), average: currentValues.length ? mean(currentValues) : null,
      previousAverage: previousValues.length ? mean(previousValues) : null,
      p10: currentValues.length ? quantile(currentValues, .1) : null, p90: currentValues.length ? quantile(currentValues, .9) : null,
      currentState: currentValues.length ? 'Observed' : 'NoSamples', previousState: previousValues.length ? 'Observed' : 'NoSamples' });
  }
  return { start, end, current, previous, availability, latency };
}

export const analytics: Record<string, Handler> = {
  'GET /api/financial/kpis': context => {
    const { total, baseline, current, previous, currentCount, priorCount } = financial(context);
    const active = new Set(current.map(row => row.tenant.id)).size;
    const prior = new Set(previous.map(row => row.tenant.id)).size;
    const aov = total / (currentCount || 1);
    const averageRevenuePerTenant = total / (active || 1);
    return json({ currentRevenue: total, previousRevenue: baseline, revenueGrowthPercentage: growth(total, baseline),
      transactionVolume: currentCount, volumeGrowthPercentage: growth(currentCount, priorCount),
      averageOrderValue: aov, aovGrowthPercentage: growth(aov, baseline / (priorCount || 1)),
      activeTenants: active, activeTenantsGrowthPercentage: growth(active, prior), averageRevenuePerTenant,
      arptGrowthPercentage: growth(averageRevenuePerTenant, baseline / (prior || 1)) });
  },
  'GET /api/financial/accumulated-revenue': context => json(financial(context).points),
  'GET /api/financial/revenue-efficiency': context => {
    const { total, currentCount, perTenant } = financial(context);
    return json({ globalAverageOrderValue: total / (currentCount || 1),
      medianOrderVolume: median(perTenant.map(row => row.orderVolume)),
      medianPortfolioShare: median(perTenant.map(row => row.portfolioSharePercentage)), tenants: perTenant });
  },
  'GET /api/financial/cross-segment-distribution': context => {
    const { perTenant } = financial(context);
    const cohorts = ['B2B', 'B2C', 'Mixed'].map(type => ({ type, rows: perTenant.filter(row => row.type === type) }));
    const percentile = (value: number, cohort: number[]) => Math.round(100 * (cohort.filter(other => other < value).length +
      .5 * cohort.filter(other => other === value).length) / cohort.length);
    return json({
      tenants: cohorts.flatMap(({ rows }) => rows.map(row => ({ ...row,
        aovPercentileRank: percentile(row.averageOrderValue, rows.map(r => r.averageOrderValue)),
        volumePercentileRank: percentile(row.orderVolume, rows.map(r => r.orderVolume)),
        revenuePercentileRank: percentile(row.periodRevenue, rows.map(r => r.periodRevenue)),
      }))),
      cohorts: cohorts.filter(({ rows }) => rows.length).map(({ type, rows }) => {
        const aov = rows.map(row => row.averageOrderValue);
        const volume = rows.map(row => row.orderVolume);
        const revenue = rows.map(row => row.periodRevenue);
        return { type, tenantCount: rows.length, medianAov: median(aov), q1Aov: quantile(aov, .25), q3Aov: quantile(aov, .75),
          medianVolume: median(volume), q1Volume: quantile(volume, .25), q3Volume: quantile(volume, .75),
          medianRevenue: median(revenue), q1Revenue: quantile(revenue, .25), q3Revenue: quantile(revenue, .75) };
      }),
    });
  },
  'GET /api/financial/portfolio-impact': context => {
    const { total, baseline, perTenant } = financial(context);
    return json({ medianBaselineRevenue: median(perTenant.map(row => row.baselineRevenue)), globalGrowthPercentage: growth(total, baseline),
      medianPortfolioShare: median(perTenant.map(row => row.portfolioSharePercentage)), tenants: perTenant });
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
    const { start, end } = period(context);
    const values = [...tradeHours(tradingTenants(context), context.state, start, end)].flatMap(row => row.values);
    if (!values.length) return json([]);
    const total = sumBy(values, band => band.count);
    const count = Math.min(50, Number(binCount) || 10);
    const width = Math.max(1, Math.ceil(values.reduce((max, band) => Math.max(max, band.price), 0) / count));
    const bins = Array<number>(count).fill(0);
    for (const band of values) bins[Math.min(count - 1, Math.floor(band.price / width))] += band.count;
    let seen = 0;
    return json(bins.map((orderCount, i) => {
      const minValue = i * width, maxValue = (i + 1) * width;
      seen += orderCount;
      return { binLabel: `${minValue}–${maxValue} SEK`, minValue, maxValue, orderCount,
        cumulativePercentage: seen / total * 100, kdeDensity: orderCount / total };
    }));
  },
  'GET /api/financial/transaction-density': context => {
    const clock = clockFor(context);
    const tenants = tradingTenants(context);
    const requestedPeriod = context.query('period') || 'Auto';
    const possible = requestedPeriod === 'Auto' ? [30, 90, 180, 365] : [Number(requestedPeriod.slice(1)) || 30];
    const size = 168;
    let totalCount = 0, start = context.now, days = possible[0];
    let points: { dayOfWeek: number; hour: number; count: number; totalRevenue: number }[] = [];
    for (days of possible) {
      totalCount = 0;
      start = localMidnight(context.now, clock, days - 1);
      points = Array.from({ length: size }, (_, i) => ({ dayOfWeek: Math.floor(i / 24) + 1, hour: i % 24, count: 0, totalRevenue: 0 }));
      for (const row of tradeHours(tenants, context.state, start, context.now)) {
        const { weekday, hour } = wallTime(Math.floor(row.time / hourMs) * hourMs, clock);
        const bucket = points[(weekday - 1) * 24 + hour];
        bucket.count += row.count;
        bucket.totalRevenue += row.revenue;
        totalCount += row.count;
      }
      if (totalCount >= size * 20) break;
    }
    return json({ totalCount, minCount: Math.min(...points.map(p => p.count)), maxCount: Math.max(...points.map(p => p.count)),
      averageCountPerBucket: totalCount / size, sampleQuality: totalCount < size * 5 ? 'Sparse' : totalCount < size * 20 ? 'Indicative' : 'Stable',
      requestedPeriod, effectivePeriod: `T${days}`, timeZoneId: clock.resolvedOptions().timeZone, periodStart: iso(start), periodEnd: iso(context.now), points });
  },
  'GET /api/financial/orders': context => {
    const from = Date.parse(context.query('dateSince') ?? iso(context.now - 2 * dayMs));
    const to = Date.parse(context.query('dateUntil') ?? iso(context.now));
    const limit = Math.min(100, Number(context.query('CeilingCount')) || 100);
    const tenants = tradingTenants(context);
    const first = Math.max(from, to - 733 * dayMs);
    const hours = [];
    let count = 0;
    for (let end = to; end > first && count < limit; end -= dayMs) {
      for (const row of tradeHours(tenants, context.state, Math.max(end - dayMs, first), end)) {
        hours.push(row);
        count += row.count;
      }
    }
    const orders = [];
    for (const row of hours.sort((a, b) => b.time - a.time)) {
      let index = 0;
      if (row.order) {
        orders.push(withoutScope(row.order));
        if (orders.length >= limit) break;
        continue;
      }
      for (const { count, price } of row.values) {
        for (let i = 0; i < count && orders.length < limit; i++) {
          const number = Math.floor(row.time / 1000) * 1000 + index++;
          const store = clientsById.get(row.tenant.id ?? '')?.index ?? 0;
          orders.push({ adwaisOrderId: `10000000-0000-4000-${String(8000 + store)}-${number.toString(16).padStart(12, '0')}`,
            orderNumber: `WEB-${store + 1}-${number}`, adwaisTenantId: row.tenant.id, orderState: row.time > context.now - hourMs ? 'Confirmed' : 'Completed',
            createdDate: iso(row.time), totalValueExcVat: price, totalValueIncVat: price * 1.25, currency: 'SEK',
            tenantName: row.tenant.name, provider: row.tenant.orderProvider, externalId: String(number) });
        }
      }
      if (orders.length >= limit) break;
    }
    return json(orders);
  },
  'GET /api/monitors': context => {
    const { start, end } = period(context);
    return json(monitorList(context).map(monitor => ({ ...withoutScope(monitor), currentUptimePercentage: uptime(monitor, start, end) })));
  },
  'GET /api/monitors/unassigned': context => json(monitorList(context).filter(monitor => !monitor.tenantId).map(withoutScope)),
  'GET /api/monitors/analytics': context => {
    const { current, previous, latency } = monitorSeries(context);
    const result = (sample: typeof current) => [mean(sample.uptimes), sample.average ?? 0,
      sample.latencies.length ? Math.max(...sample.latencies) : 0, sample.latencies.length ? Math.min(...sample.latencies) : 0];
    const [u, a, h, l] = result(current), [pu, pa, ph, pl] = result(previous);
    return json({ globalAverageLatency: a, latencyPoints: latency, kpis: {
      averageUptime: u, previousAverageUptime: pu, uptimeGrowthPercentage: growth(u, pu),
      averageLatency: a, previousAverageLatency: pa, latencyGrowthPercentage: growth(a, pa),
      highestLatency: h, previousHighestLatency: ph, highestLatencyGrowthPercentage: growth(h, ph),
      lowestLatency: l, previousLowestLatency: pl, lowestLatencyGrowthPercentage: growth(l, pl),
    } });
  },
  'GET /api/monitors/availability': context => {
    const { start, end, current, availability } = monitorSeries(context);
    return json({ periodStart: iso(start), periodEnd: iso(end),
      averageUptimePercentage: current.uptimes.length ? mean(current.uptimes) : null,
      lowestUptimePercentage: current.uptimes.length ? Math.min(...current.uptimes) : null, points: availability });
  },
  'GET /api/monitors/{id}/latency': context => {
    const monitor = monitorList(context).find(row => row.id === Number(context.params.id));
    if (!monitor) return missing();
    const from = Date.parse(context.query('from') ?? iso(context.now - 7 * dayMs));
    const to = Date.parse(context.query('to') ?? iso(context.now));
    const count = Math.min(168, Math.max(1, Math.ceil((to - from) / 3_600_000)));
    return json(Array.from({ length: count }, (_, i) => {
      const time = from + i * (to - from) / count;
      const average = latencyAt(monitor, time);
      return average === null ? null : { date: iso(time), average, lowest: Math.round(average * .82), highest: Math.round(average * 1.19) };
    }).filter(point => point !== null));
  },
};
