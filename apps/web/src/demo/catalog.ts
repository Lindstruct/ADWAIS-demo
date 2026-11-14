import { getTenantDomain } from '../utils/tenantHelper';
import type { TenantType } from '../../../../packages/types/generated';

export const hourMs = 3_600_000;
export const dayMs = 24 * hourMs;

export const agencies = [
  { name: 'Northstar Commerce', city: 'Stockholm', region: 'SE' },
  { name: 'Southbank Digital', city: 'Copenhagen', region: 'DK' },
  { name: 'Westline E-commerce', city: 'Gothenburg', region: 'SE' },
];

interface Client {
  id: string;
  name: string;
  agency: number;
  type: TenantType;
  url: string;
  favicon: string;
  ordersPerDay: number;
  basket: number;
  annualGrowth: number;
  provider: 'litium' | 'shopify';
}

const stores: [name: string, url: string, agency: number, type: TenantType, ordersPerDay: number, basket: number, growth: number][] = [
  // Store names, base URLs and order profiles originate in the server demo catalog.
  ['W.W. Grainger', 'https://www.grainger.com', 0, 'B2B', 18, 9000, 0.12],
  ['H&M', 'https://www.hm.com', 0, 'B2C', 430, 600, 0.24],
  ['LEGO', 'https://www.lego.com', 0, 'Mixed', 185, 1000, 0.08],
  ['Zalando', 'https://www.zalando.com', 1, 'B2C', 260, 850, 0.19],
  ['Fastenal', 'https://www.fastenal.com', 0, 'B2B', 24, 7000, -0.06],
  ['IKEA', 'https://www.ikea.com', 0, 'B2C', 155, 2200, 0.17],
  ['Nike', 'https://www.nike.com', 0, 'Mixed', 225, 1300, 0.04],
  ['Caterpillar', 'https://parts.cat.com', 1, 'B2B', 9, 24000, 0.11],
  ['ASOS', 'https://www.asos.com', 1, 'B2C', 320, 700, 0.25],
  ['Bosch', 'https://www.bosch.com', 1, 'Mixed', 105, 3500, -0.08],
  ['Schneider Electric', 'https://www.se.com', 1, 'B2B', 12, 22000, 0.02],
  ['Dell Technologies', 'https://www.dell.com', 1, 'Mixed', 78, 9000, 0.31],
  ['CDW Corporation', 'https://www.cdw.com', 2, 'B2B', 20, 15000, 0.1],
  ['Decathlon', 'https://www.decathlon.com', 2, 'B2C', 185, 1100, 0.33],
  ['Apple', 'https://www.apple.com', 2, 'Mixed', 95, 7000, -0.04],
  ['Siemens AG', 'https://www.siemens.com', 2, 'B2B', 7, 38000, 0.05],
  ['Uniqlo', 'https://www.uniqlo.com', 2, 'B2C', 235, 650, 0.14],
  ['Sony', 'https://www.sony.com', 2, 'Mixed', 82, 5000, 0.21],
];

export const fixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const clients: Client[] = stores.map(([name, url, agency, type, ordersPerDay, basket, annualGrowth], i) => ({
  id: fixtureId(i === 0 ? 4 : i < 4 ? 20 + i : 100 + i),
  name, agency, type, url, favicon: `/favicons/${getTenantDomain(url)}.png`, ordersPerDay, basket, annualGrowth,
  provider: type === 'B2B' || i % 3 === 2 ? 'litium' : 'shopify',
}));

export const clientsById = new Map(clients.map((client, index) => [client.id, { ...client, index }]));

export const organizationId = (index: number) => fixtureId([1, 2, 30][index]);

// Repeatable variation for synthetic samples, independent of API call order.
export function noise(seed: number) {
  const mixed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  return ((Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b) ^ (mixed >>> 16)) >>> 0) / 4_294_967_296;
}

const wallClocks = new Map<string, Intl.DateTimeFormat>();
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function reportingClock(timeZone: string) {
  const cached = wallClocks.get(timeZone);
  if (cached) return cached;
  try {
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    });
    wallClocks.set(timeZone, clock);
    return clock;
  } catch {
    return reportingClock('Europe/Stockholm');
  }
}

export function wallTime(time: number, clock: Intl.DateTimeFormat) {
  let year = 0, month = 0, day = 0, hour = 0, minute = 0, weekday = 0;
  for (const part of clock.formatToParts(time)) {
    switch (part.type) {
      case 'year': year = Number(part.value); break;
      case 'month': month = Number(part.value); break;
      case 'day': day = Number(part.value); break;
      case 'hour': hour = Number(part.value); break;
      case 'minute': minute = Number(part.value); break;
      case 'weekday': weekday = weekdays.indexOf(part.value) + 1; break;
    }
  }
  return { year, month, day, hour, minute, weekday };
}

export function localMidnight(time: number, clock: Intl.DateTimeFormat, daysBack = 0, firstOfYear = false) {
  const { year, month, day } = wallTime(time, clock);
  const midnight = Date.UTC(year, firstOfYear ? 0 : month - 1, (firstOfYear ? 1 : day) - daysBack);
  // Recalculate the offset on the target calendar date to account for DST.
  const local = wallTime(midnight, clock);
  return midnight - (Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - midnight);
}
