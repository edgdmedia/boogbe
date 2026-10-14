export const ORG_ROLES = ['admin', 'frontdesk', 'housekeeper', 'landlord'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const ROLE_LABELS: Record<OrgRole, string> = {
  admin: 'Admin',
  frontdesk: 'Front desk',
  housekeeper: 'Housekeeper',
  landlord: 'Property owner',
};
export const ORG_STATUSES = ['active', 'suspended'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];
