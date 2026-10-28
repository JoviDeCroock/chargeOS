export type PreviewWorkspace = "driver" | "employer" | "operator";
export type PreviewScenario = "normal" | "offline" | "empty" | "loading" | "error";

export const workspaceLabels: Record<PreviewWorkspace, string> = {
  driver: "Driver",
  employer: "Employer & finance",
  operator: "Operator & support",
};

export const navigation: Record<
  PreviewWorkspace,
  readonly { id: string; label: string; mark: string }[]
> = {
  driver: [
    { id: "overview", label: "Overview", mark: "⌂" },
    { id: "charger", label: "My charger", mark: "ϟ" },
    { id: "activity", label: "Activity", mark: "≋" },
    { id: "money", label: "Reimbursements", mark: "€" },
    { id: "road", label: "On the road", mark: "↗" },
    { id: "cards", label: "Charging cards", mark: "▱" },
    { id: "help", label: "Help & support", mark: "?" },
  ],
  employer: [
    { id: "overview", label: "Overview", mark: "⌂" },
    { id: "drivers", label: "Drivers & cards", mark: "♧" },
    { id: "sites", label: "Charging sites", mark: "ϟ" },
    { id: "policies", label: "Charging policies", mark: "≡" },
    { id: "money", label: "Reimbursements", mark: "€" },
    { id: "billing", label: "Billing", mark: "▤" },
    { id: "reports", label: "Reports", mark: "↗" },
  ],
  operator: [
    { id: "overview", label: "Operations", mark: "⌂" },
    { id: "chargers", label: "Chargers", mark: "ϟ" },
    { id: "incidents", label: "Incidents", mark: "!" },
    { id: "money", label: "Money exceptions", mark: "€" },
    { id: "migrations", label: "Migrations", mark: "⇄" },
    { id: "connections", label: "Connections", mark: "⊞" },
    { id: "help", label: "Support inbox", mark: "?" },
  ],
};

export interface PreviewSession {
  readonly id: string;
  readonly day: string;
  readonly startedAt: string;
  readonly location: string;
  readonly locationType: "Home" | "Work" | "Public";
  readonly duration: string;
  readonly energyWh: number;
  readonly amountCents: number;
  readonly status: "Approved" | "Needs review" | "Recorded";
}

// Fictional fixtures. Amounts are illustrative statement values, not a tax policy.
export const previewSessions: readonly PreviewSession[] = [
  {
    id: "DEMO-1028",
    day: "28 Oct",
    startedAt: "2026-10-28T07:10:00+01:00",
    location: "Home · Driveway",
    locationType: "Home",
    duration: "3h 12m",
    energyWh: 34600,
    amountCents: 1115,
    status: "Approved",
  },
  {
    id: "DEMO-1027",
    day: "27 Oct",
    startedAt: "2026-10-27T09:05:00+01:00",
    location: "Northstar · Brussels",
    locationType: "Work",
    duration: "2h 45m",
    energyWh: 22100,
    amountCents: 0,
    status: "Recorded",
  },
  {
    id: "DEMO-1026",
    day: "26 Oct",
    startedAt: "2026-10-26T20:30:00+01:00",
    location: "Home · Driveway",
    locationType: "Home",
    duration: "5h 28m",
    energyWh: 45800,
    amountCents: 1476,
    status: "Approved",
  },
  {
    id: "DEMO-1024",
    day: "24 Oct",
    startedAt: "2026-10-24T14:20:00+02:00",
    location: "City garage · Leuven",
    locationType: "Public",
    duration: "48m",
    energyWh: 18200,
    amountCents: 1074,
    status: "Recorded",
  },
  {
    id: "DEMO-1022",
    day: "22 Oct",
    startedAt: "2026-10-22T19:15:00+02:00",
    location: "Home · Driveway",
    locationType: "Home",
    duration: "4h 06m",
    energyWh: 29700,
    amountCents: 957,
    status: "Needs review",
  },
  {
    id: "DEMO-1020",
    day: "20 Oct",
    startedAt: "2026-10-20T21:00:00+02:00",
    location: "Home · Driveway",
    locationType: "Home",
    duration: "4h 42m",
    energyWh: 31200,
    amountCents: 1005,
    status: "Approved",
  },
];

export const previewDrivers = [
  {
    name: "Alex Morgan",
    initials: "AM",
    team: "Product",
    vehicle: "Electric hatchback",
    station: "Home · Driveway",
    energy: "141.3 kWh",
    amount: "€45.53",
    state: "Needs review",
  },
  {
    name: "Noor Jacobs",
    initials: "NJ",
    team: "Operations",
    vehicle: "Electric estate",
    station: "Home · Garage",
    energy: "186.4 kWh",
    amount: "€60.06",
    state: "Approved",
  },
  {
    name: "Sam Laurent",
    initials: "SL",
    team: "Sales",
    vehicle: "Electric saloon",
    station: "Home · Driveway",
    energy: "228.6 kWh",
    amount: "€73.66",
    state: "Approved",
  },
  {
    name: "Robin Martin",
    initials: "RM",
    team: "Finance",
    vehicle: "Electric crossover",
    station: "Home · Carport",
    energy: "164.2 kWh",
    amount: "€52.91",
    state: "Approved",
  },
] as const;

export const previewStations = [
  {
    id: "DEMO-HOME-01",
    name: "Alex’s home",
    site: "Leuven · Private",
    device: "Alfen · example device",
    state: "Charging",
    energy: "141.3 kWh",
    updated: "Sample live state",
  },
  {
    id: "DEMO-HOME-02",
    name: "Noor’s home",
    site: "Brussels · Private",
    device: "Alfen · example device",
    state: "Available",
    energy: "186.4 kWh",
    updated: "Sample live state",
  },
  {
    id: "DEMO-OFFICE-01",
    name: "Office · Bay 01",
    site: "Brussels · Workplace",
    device: "Example workplace charger",
    state: "Charging",
    energy: "321.6 kWh",
    updated: "Sample live state",
  },
  {
    id: "DEMO-OFFICE-02",
    name: "Office · Bay 02",
    site: "Brussels · Workplace",
    device: "Example workplace charger",
    state: "Offline",
    energy: "198.4 kWh",
    updated: "Last sample: 12 min ago",
  },
] as const;

export interface PreviewCase {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly owner: string;
  readonly status: string;
  readonly update: string;
}

export const previewCases: readonly PreviewCase[] = [
  {
    id: "DEMO-041",
    title: "Meter reading needs a second look",
    category: "Reimbursement",
    owner: "Jamie · Finance support",
    status: "In progress",
    update: "Sample update · 24 Oct",
  },
  {
    id: "DEMO-042",
    title: "Office bay 02 stopped reporting",
    category: "Charger connection",
    owner: "Riley · Operations",
    status: "Investigating",
    update: "Sample update · 28 Oct",
  },
];

export function previewRoute(hash: string): { workspace: PreviewWorkspace; page: string } {
  const [candidate, page] = hash.replace(/^#\/?/, "").split("/");
  const workspace = candidate === "employer" || candidate === "operator" ? candidate : "driver";
  return {
    workspace,
    page: navigation[workspace].some((item) => item.id === page) ? page! : "overview",
  };
}

export function euro(cents: number): string {
  const exact = BigInt(cents);
  const whole = exact / 100n;
  const displayWhole = exact < 0n && whole === 0n ? -0 : whole;
  const fraction = (exact < 0n ? -exact : exact) % 100n;
  return new Intl.NumberFormat("en-BE", { style: "currency", currency: "EUR" })
    .formatToParts(displayWhole)
    .map((part) => (part.type === "fraction" ? fraction.toString().padStart(2, "0") : part.value))
    .join("");
}

export function energy(wh: number): string {
  return `${new Intl.NumberFormat("en-BE", { maximumFractionDigits: 1 }).format(wh / 1000)} kWh`;
}
