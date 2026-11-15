// v2 data for the selected field: { status: 'loading' | 'ready' | 'error', data, usingSample, error }.
import { useEffect, useState } from 'react';
import { useApp } from './AppContext.jsx';
import { loadV2 } from '../data/loadV2.js';

export function useV2() {
  const { field } = useApp();
  const id = field?.field?.id ?? null;
  const [state, setState] = useState({ id: null, status: 'loading' });
  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    loadV2(id).then((r) => { if (live) setState({ id, ...(r.error ? { status: 'error', error: r.error, problems: r.problems } : { status: 'ready', data: r.data, usingSample: r.usingSample }) }); });
    return () => { live = false; };
  }, [id]);
  return state.id === id ? state : { id, status: 'loading' };
}
