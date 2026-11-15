// Greenline mark: a plat-book section, four parcels ruled in ink with one washed in highlighter (the farmer's field).
// Decorative: the wordmark sits next to it.
export default function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="26" height="26" fill="var(--color-paper-raised)" stroke="var(--color-ink)" strokeWidth="1.5" />
      <path d="M3 3 L15 3 L13 15 L3 13 Z" fill="var(--color-highlight)" />
      <path d="M1 14 L13 15 L27 12 M13 15 L15 1 M13 15 L14 27" fill="none" stroke="var(--color-ink)" strokeWidth="1.25" />
      <path d="M17 20 h6" stroke="var(--color-forest)" strokeWidth="2.5" />
    </svg>
  );
}
