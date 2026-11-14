import { isStaticDemo } from './demo/mode';

export async function requestApi(url: string, options?: RequestInit): Promise<Response> {
  if (isStaticDemo) {
    const { demoFetch } = await import('./demo/api');
    return demoFetch(new Request(new URL(url, window.location.origin), options));
  }
  return options === undefined ? fetch(url) : fetch(url, options);
}
