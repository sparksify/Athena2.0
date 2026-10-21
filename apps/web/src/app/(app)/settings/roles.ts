export const ROLES = ["super_admin", "fcc_admin", "manager", "consultant", "analyst", "read_only"] as const;
export type Role = (typeof ROLES)[number];
