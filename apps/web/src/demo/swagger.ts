import SwaggerUI from 'swagger-ui-dist/swagger-ui-bundle.js';
import 'swagger-ui-dist/swagger-ui.css';
import { readStoredOrgId } from '../utils/orgSelection';
import { demoFetch } from './api';

const specPath = '/swagger/v1/swagger.json';

export function mountDemoSwagger(root: HTMLElement) {
  document.title = 'ADWAIS API · Swagger UI';

  const bar = document.createElement('nav');
  bar.setAttribute('aria-label', 'API documentation');
  bar.className = 'flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-outline-variant bg-white px-5 py-3 text-sm';
  const back = document.createElement('a');
  back.href = '/';
  back.className = 'font-semibold text-slate-800 underline';
  back.textContent = 'Back to ADWAIS';
  const note = document.createElement('span');
  note.className = 'text-on-surface-variant';
  note.textContent = 'Try it out uses demo data in this browser.';
  bar.append(back, note);

  const explorer = document.createElement('main');
  root.replaceChildren(bar, explorer);

  SwaggerUI({
    domNode: explorer,
    url: specPath,
    validatorUrl: null,
    deepLinking: true,
    docExpansion: 'none',
    filter: true,
    requestInterceptor(request) {
      const url = new URL(request.url, window.location.origin);
      if (url.origin !== window.location.origin) throw new Error('Swagger UI can only access this demo.');
      if (url.pathname === specPath && (!request.method || request.method === 'GET')) return request;
      if (!url.pathname.startsWith('/api/')) throw new Error('Choose an ADWAIS API operation.');

      const organization = readStoredOrgId();
      const headers = new Headers(request.headers);
      if (organization && !headers.has('X-ADWAIS-ORG-ID')) headers.set('X-ADWAIS-ORG-ID', organization);
      request.headers = Object.fromEntries(headers);
      request.userFetch = (url, init) => demoFetch(new Request(url, init));
      return request;
    },
  });
}
