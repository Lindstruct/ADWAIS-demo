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
