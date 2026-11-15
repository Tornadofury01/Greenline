// A short label or number that eases into its new text, in the site font.
// First paint stays still. Later changes play `.morph.is-on`. Reduced motion is handled in styles.css.
import { useEffect, useRef } from 'react';

export default function TextMorph({ text, className = '' }) {
  const seen = useRef(false);
  const play = seen.current;
  useEffect(() => { seen.current = true; }, [text]);
  const value = text == null ? '' : String(text);
  return (
    <span key={value} className={['morph', play && 'is-on', className].filter(Boolean).join(' ')}>{value}</span>
  );
}
