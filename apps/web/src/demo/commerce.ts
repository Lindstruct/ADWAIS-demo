import { clientsById, dayMs, hourMs, noise, reportingClock, wallTime } from './catalog';
import type { DemoState, DemoTenant } from './state';

const business = [.02,.01,.005,.005,.005,.01,.03,.12,.55,1.22,1.67,1.61,1.09,1.51,1.69,1.57,1.18,.67,.31,.13,.09,.07,.05,.03];
const retail = [.22,.11,.06,.04,.04,.07,.14,.3,.54,.8,1,1.12,1.27,1.15,1.06,1.11,1.29,1.51,1.72,1.95,2.12,1.83,1.21,.59];
const basketBands = [.24, .43, .62, .8, 1.02, 1.28, 1.67, 2.37, 3.55];
const tradingClock = reportingClock('Europe/Stockholm');
const tradingHours = new Map<number, ReturnType<typeof wallTime>>();

interface TradingHour {
  time: number;
  tenant: DemoTenant;
  count: number;
  revenue: number;
  order?: DemoState['orders'][number];
  values: { count: number; price: number }[];
}

function stockValues(client: NonNullable<ReturnType<typeof clientsById.get>>, h: number, count: number) {
  const scale = client.basket * (.83 + noise(h * 47 + client.index * 17) * .34);
  const bins = basketBands.map(price => ({ count: 0, price: Math.round(scale * price) }));
  const bandWeights = client.type === 'B2B' ? [0, .04, .15, .34, .57, .76, .92, .98, 1] : [.04, .14, .32, .55, .76, .89, .96, .99, 1];
  for (let i = 0; i < count; i++) {
    const value = noise(h * 521 + i * 41 + client.index * 757);
    bins[bandWeights.findIndex(weight => value < weight)].count++;
  }
  return bins.filter(bin => bin.count > 0);
}

export function* tradeHours(tenants: DemoTenant[], state: DemoState, from: number, to: number): Generator<TradingHour> {
  const active = tenants.flatMap(tenant => {
    const client = clientsById.get(tenant.id ?? '');
    return client ? [{ tenant, client }] : [];
  });
  const firstHour = Math.max(Math.floor(from / hourMs), Math.floor((to - 733 * dayMs) / hourMs));
  for (let h = firstHour; active.length && h * hourMs < to; h++) {
    let local = tradingHours.get(h);
    if (!local) {
      local = wallTime(h * hourMs, tradingClock);
      if (tradingHours.size >= 20_000) tradingHours.clear();
      tradingHours.set(h, local);
    }
    const { year, month, day, hour, weekday } = local;
    const weekend = weekday >= 6;
    const season = month === 11 ? (day >= 23 ? 1.62 : 1.16) : month === 12 ? (day < 21 ? 1.35 : .74) : month === 7 ? .78 : 1;
    const serialDay = Math.floor(h / 24);
    for (const { tenant, client } of active) {
      const isB2B = client.type === 'B2B';
      const hourWeight = client.type === 'Mixed' ? (business[hour] + retail[hour]) / 2 : (isB2B ? business : retail)[hour];
      const weekdayWeight = weekend ? (isB2B ? .12 : 1.18) : (weekday === 1 && isB2B ? 1.22 : weekday === 5 ? .91 : 1);
      const variation = .76 + .48 * noise(serialDay * 37 + client.index * 53);
      const trend = Math.max(.55, 1 + client.annualGrowth * ((year - 2026) + (month - 1) / 12));
      const volume = client.ordersPerDay * hourWeight * weekdayWeight * season * variation * trend / (isB2B ? 14.7 : client.type === 'Mixed' ? 18.7 : 22.8);
      const count = Math.floor(volume + noise(h * 73 + client.index * 17));
      if (!count) continue;
      const timestamp = h * hourMs + Math.floor(noise(h * 129 + client.index * 11) * hourMs);
      if (timestamp < from || timestamp >= to) continue;
      const priceBands = stockValues(client, h, count);
      yield { time: timestamp, tenant, count, values: priceBands,
        revenue: priceBands.reduce((sum, band) => sum + band.count * band.price, 0) };
    }
  }
  const scopedIds = new Map(tenants.map(tenant => [tenant.id, tenant]));
  for (const order of state.orders) {
    const tenant = scopedIds.get(order.adwaisTenantId ?? '');
    const time = Date.parse(order.createdDate ?? '');
    const revenue = order.totalValueExcVat ?? 0;
    if (tenant && time >= from && time < to && order.orderState !== 'Cancelled') {
      yield { time, tenant, count: 1, revenue, order, values: [{ count: 1, price: revenue }] };
    }
  }
}
