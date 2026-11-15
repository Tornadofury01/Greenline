// Runs the farm simulator in a web worker. `start(spec)` / `startBand(spec)` replace any run in flight (older answers are ignored by runId).
import { useCallback, useEffect, useRef, useState } from 'react';

export function useSimRuns() {
  const worker = useRef(null);
  const runId = useRef(0);
  const [state, setState] = useState({ status: 'idle', progress: 0, result: null, band: null, bandStatus: 'idle', error: null });

  useEffect(() => {
    const w = new Worker(new URL('./simWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.runId !== runId.current) return;
      if (m.type === 'progress') setState((s) => ({ ...s, progress: m.done / m.total }));
      else if (m.type === 'result') setState((s) => ({ ...s, status: 'ready', progress: 1, result: m.plans, error: null }));
      else if (m.type === 'band') setState((s) => ({ ...s, bandStatus: 'ready', band: m.plans }));
      else if (m.type === 'error') setState((s) => ({ ...s, status: 'error', bandStatus: s.bandStatus === 'running' ? 'error' : s.bandStatus, error: m.message }));
    };
    w.onerror = () => setState((s) => ({ ...s, status: 'error', error: 'worker' }));
    worker.current = w;
    return () => { w.terminate(); worker.current = null; };
  }, []);

  const start = useCallback((spec, withBand) => {
    if (!worker.current) return;
    const id = ++runId.current;
    setState((s) => ({ ...s, status: 'running', progress: 0, bandStatus: withBand ? 'running' : 'idle', band: withBand ? s.band : null }));
    worker.current.postMessage({ type: 'run', runId: id, ...spec });
    if (withBand) worker.current.postMessage({ type: 'band', runId: id, plans: spec.plans, scen: spec.scen, money: spec.money, field: spec.field });
  }, []);

  return { ...state, start };
}
