/** The chargeOS mark shared by every surface: a charger status ring around a bolt. */
export function BrandMark() {
  return (
    <span class="brand-mark">
      <svg class="brand-glyph" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="12" />
        <path d="M17.5 8.5 11.5 17h4.5l-1.5 6.5 6-8.5H16l1.5-6.5Z" />
      </svg>
      <span>chargeOS</span>
    </span>
  );
}
