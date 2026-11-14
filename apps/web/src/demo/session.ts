import { setSelectedOrgId } from '../utils/orgSelection';
import { resetDemoState } from './state';

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

export function resetDemo() {
  resetDemoState();
  clearDemoKioskSession();
  setSelectedOrgId(null);
  window.location.assign('/');
}
