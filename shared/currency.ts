export function formatEuroCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Currency amount must be integer cents");
  const exact = BigInt(cents),
    whole = exact / 100n;
  const displayWhole = exact < 0n && whole === 0n ? -0 : whole;
  const fraction = (exact < 0n ? -exact : exact) % 100n;
  return new Intl.NumberFormat("en-BE", { style: "currency", currency: "EUR" })
    .formatToParts(displayWhole)
    .map((part) => (part.type === "fraction" ? fraction.toString().padStart(2, "0") : part.value))
    .join("");
}
