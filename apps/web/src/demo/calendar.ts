import { readStoredOrgId } from '../utils/orgSelection';

export const demoCalendarUrl = () => `${window.location.origin}/api/intranet/calendar/feed.ics`;

export async function downloadDemoCalendar(token: string) {
  const { demoFetch } = await import('./api');
  const organizationId = readStoredOrgId();
  const response = await demoFetch(new Request(`${demoCalendarUrl()}?token=${encodeURIComponent(token)}`, {
    headers: organizationId ? { 'X-ADWAIS-ORG-ID': organizationId } : {},
  }));
  if (!response.ok) throw new Error('The calendar could not be downloaded.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'adwais-demo.ics';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
