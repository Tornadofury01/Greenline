// Greenline mark: crop rows running to a horizon, with one leaf. Decorative (the name is next to it).
export default function Logo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="var(--color-primary)" />
      <path d="M4 26 L13 14 M10 26 L15 14 M16 26 L17 14 M22 26 L19 14 M28 26 L21 14"
        stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4 14 H28" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 13 C16 9 18.5 6 23 5.5 C22.6 9.6 20 12.4 16 13 Z" fill="#ffffff" />
      <path d="M16 13 C15.6 10.5 13.8 8.6 10.5 8.3 C10.8 11 12.8 12.8 16 13 Z" fill="#ffffff" fillOpacity="0.8" />
    </svg>
  );
}
