export type AmenityGroup = "Outdoors" | "Community" | "Infrastructure" | "Safety";

export const AMENITIES: { code: string; label: string; group: AmenityGroup }[] = [
  { code: "park", label: "Park", group: "Outdoors" },
  { code: "playground", label: "Children's play area", group: "Outdoors" },
  { code: "walking_track", label: "Walking track", group: "Outdoors" },
  { code: "garden", label: "Landscaped garden", group: "Outdoors" },
  { code: "gym", label: "Gym", group: "Community" },
  { code: "swimming_pool", label: "Swimming pool", group: "Community" },
  { code: "clubhouse", label: "Clubhouse", group: "Community" },
  { code: "community_hall", label: "Community hall", group: "Community" },
  { code: "mandir", label: "Mandir / temple", group: "Community" },
  { code: "tar_road", label: "Tar roads", group: "Infrastructure" },
  { code: "paver_road", label: "Paver block roads", group: "Infrastructure" },
  { code: "street_lights", label: "Street lights", group: "Infrastructure" },
  { code: "drainage", label: "Underground drainage", group: "Infrastructure" },
  { code: "water_supply", label: "Water connection", group: "Infrastructure" },
  { code: "electricity", label: "Electricity connection", group: "Infrastructure" },
  { code: "rainwater", label: "Rainwater harvesting", group: "Infrastructure" },
  { code: "ev_charging", label: "EV charging", group: "Infrastructure" },
  { code: "security", label: "24x7 security", group: "Safety" },
  { code: "cctv", label: "CCTV", group: "Safety" },
  { code: "compound_wall", label: "Compound wall and gate", group: "Safety" },
];

export const AMENITY_CODES = new Set(AMENITIES.map((a) => a.code));

export function amenityLabel(code: string): string {
  return AMENITIES.find((a) => a.code === code)?.label ?? code;
}

export const AMENITY_GROUPS: AmenityGroup[] = ["Outdoors", "Community", "Infrastructure", "Safety"];
