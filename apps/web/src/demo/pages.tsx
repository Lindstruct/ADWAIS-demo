import { useEffect, useState } from 'react';
import { demoFetch } from './api';
import type { DemoState } from './state';

const request = (path: string, options?: RequestInit) => demoFetch(new Request(new URL(path, window.location.origin), options));

export function DemoJobs() {
  const [runs, setRuns] = useState<DemoState['runs']>([]);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      const response = await request('/api/platform/diagnostics/runs');
      const data = await response.json() as DemoState['runs'];
      if (!stopped) setRuns(data);
    };
    void refresh();
    const interval = window.setInterval(refresh, 1000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, []);
  return <main className="mx-auto max-w-4xl p-6">
    <a href="/settings/jobs" className="text-primary underline">Back to Jobs</a>
    <h1 className="my-4 text-3xl font-bold">Demo job dashboard</h1>
    <p className="mb-4">Jobs run against sample data in this browser.</p>
    <ul className="space-y-2">{runs.map(run => <li key={run.id} className="rounded-xl bg-surface-container p-4">
      <strong>{run.resourceName ?? run.kind}</strong>
      <span className="ml-3">{run.state}</span>
      <p>{run.safeSummary}</p>
    </li>)}</ul>
  </main>;
}

export function DemoApiExplorer() {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/api/users/me');
  const [body, setBody] = useState('');
  const [response, setResponse] = useState('');
  const [paths, setPaths] = useState<Record<string, Record<string, { summary?: string }>>>({});
  useEffect(() => {
    void fetch('/openapi/v1.json').then(res => res.json()).then(spec => setPaths(spec.paths))
      .catch(() => setResponse('The API specification could not be loaded.'));
  }, []);
  const submit = async () => {
    try {
      const url = new URL(path, window.location.origin);
      if (url.origin !== window.location.origin) throw new Error('Enter a local demo API path.');
      const result = await request(url.pathname + url.search, {
        method, ...(body && method !== 'GET' ? { body, headers: { 'Content-Type': 'application/json' } } : {}),
      });
      setResponse(`HTTP ${result.status}\n${await result.text()}`);
    } catch (error) {
      setResponse(String(error));
    }
  };
  return <main className="mx-auto max-w-4xl p-6">
    <a href="/" className="text-primary underline">Back to ADWAIS</a>
    <h1 className="my-4 text-3xl font-bold">Demo API explorer</h1>
    <a className="text-primary underline" href="/openapi/v1.json">OpenAPI specification</a>
    <form className="my-5 grid gap-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>Method <select value={method} onChange={event => setMethod(event.target.value)}>{['GET', 'POST', 'PATCH', 'DELETE'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Path <input className="w-full rounded border p-2" value={path} onChange={event => setPath(event.target.value)} /></label>
      <label>Request body <textarea className="w-full rounded border p-2" value={body} onChange={event => setBody(event.target.value)} /></label>
      <button type="submit" className="w-fit rounded-full bg-primary px-4 py-2 text-on-primary">Send local request</button>
    </form>
    <pre className="mb-5 overflow-auto whitespace-pre-wrap" aria-live="polite">{response}</pre>
    <ul className="space-y-2">{Object.entries(paths).flatMap(([route, methods]) => Object.entries(methods).map(([verb, operation]) =>
      <li key={verb + route}><button type="button" className="text-left text-primary underline" onClick={() => { setPath(route); setMethod(verb.toUpperCase()); }}>
        {verb.toUpperCase()} {route}
      </button><p>{operation.summary}</p></li>))}</ul>
  </main>;
}
