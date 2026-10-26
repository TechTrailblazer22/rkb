// SAMPLE DATA for the Phase 2 preview. These are invented projects, shown with a
// "Sample" label. Phase 5 replaces this with real, verified listings from the database.

export type ProjectType = "Plotted" | "Farm house" | "Residential" | "Commercial";

export type SampleProject = {
  slug: string;
  name: string;
  type: ProjectType;
  stage: "Pre-launch" | "Under construction" | "Ready to move";
  city: string;
  locality: string;
  priceFrom: number;
  priceTo: number;
  pricePerSqft: number;
  sizeRange: string;
  totalPlots: number;
  availablePlots: number;
  approvals: string[];
  builder: { name: string; verified: boolean };
};

export const sampleProjects: SampleProject[] = [
  {
    slug: "green-valley-enclave",
    name: "Green Valley Enclave",
    type: "Plotted",
    stage: "Ready to move",
    city: "Coimbatore",
    locality: "Sulur",
    priceFrom: 1850000,
    priceTo: 3600000,
    pricePerSqft: 1850,
    sizeRange: "1,000 to 1,950 sq ft",
    totalPlots: 120,
    availablePlots: 46,
    approvals: ["RERA", "DTCP"],
    builder: { name: "Anand Realty", verified: true },
  },
  {
    slug: "lakeview-farm-retreat",
    name: "Lakeview Farm Retreat",
    type: "Farm house",
    stage: "Under construction",
    city: "Chennai",
    locality: "Chengalpattu",
    priceFrom: 4200000,
    priceTo: 9800000,
    pricePerSqft: 950,
    sizeRange: "4,400 to 10,800 sq ft",
    totalPlots: 48,
    availablePlots: 29,
    approvals: ["DTCP"],
    builder: { name: "Sri Vari Developers", verified: true },
  },
  {
    slug: "orchid-heights",
    name: "Orchid Heights",
    type: "Residential",
    stage: "Under construction",
    city: "Madurai",
    locality: "K. Pudur",
    priceFrom: 5400000,
    priceTo: 8900000,
    pricePerSqft: 4600,
    sizeRange: "2 and 3 BHK, 1,150 to 1,950 sq ft",
    totalPlots: 96,
    availablePlots: 61,
    approvals: ["RERA", "CMDA"],
    builder: { name: "Meenakshi Constructions", verified: true },
  },
  {
    slug: "sunrise-city-phase-2",
    name: "Sunrise City Phase 2",
    type: "Plotted",
    stage: "Pre-launch",
    city: "Hosur",
    locality: "Bagalur Road",
    priceFrom: 1320000,
    priceTo: 2450000,
    pricePerSqft: 1650,
    sizeRange: "800 to 1,500 sq ft",
    totalPlots: 210,
    availablePlots: 188,
    approvals: ["RERA", "DTCP"],
    builder: { name: "Kaveri Estates", verified: false },
  },
  {
    slug: "metro-business-square",
    name: "Metro Business Square",
    type: "Commercial",
    stage: "Under construction",
    city: "Coimbatore",
    locality: "Avinashi Road",
    priceFrom: 7500000,
    priceTo: 24000000,
    pricePerSqft: 9800,
    sizeRange: "Shops and offices, 450 to 2,400 sq ft",
    totalPlots: 64,
    availablePlots: 22,
    approvals: ["RERA", "Municipal"],
    builder: { name: "Anand Realty", verified: true },
  },
  {
    slug: "palm-grove-plots",
    name: "Palm Grove Plots",
    type: "Plotted",
    stage: "Ready to move",
    city: "Chennai",
    locality: "Padappai",
    priceFrom: 2100000,
    priceTo: 4100000,
    pricePerSqft: 2150,
    sizeRange: "1,000 to 1,900 sq ft",
    totalPlots: 84,
    availablePlots: 9,
    approvals: ["RERA", "DTCP", "Bank loan"],
    builder: { name: "Sri Vari Developers", verified: true },
  },
];
