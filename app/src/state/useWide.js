// True while the screen matches a media query (default: desktop, where rotation cards sit side by side).
import { useEffect, useState } from 'react';

export function useWide(query = '(min-width: 1024px)') {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return wide;
}
