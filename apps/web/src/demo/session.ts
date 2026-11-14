import { setSelectedOrgId } from '../utils/orgSelection';

const kioskKey = 'adwais.static-demo.kiosk';
const initializedKey = 'adwais.static-demo.session-v1';

export function kioskSessionToken() {
  return sessionStorage.getItem(kioskKey);
}

export function setDemoKioskSession(token: string) {
  sessionStorage.setItem(kioskKey, token);
}

export function clearDemoKioskSession() {
  sessionStorage.removeItem(kioskKey);
}

export function initializeDemo() {
  if (!sessionStorage.getItem(initializedKey)) {
    setSelectedOrgId(null);
    sessionStorage.setItem(initializedKey, 'true');
  }
}

export async function resetDemo() {
  const { resetDemoState } = await import('./state');
  resetDemoState();
  clearDemoKioskSession();
  setSelectedOrgId(null);
  window.location.assign('/');
}
