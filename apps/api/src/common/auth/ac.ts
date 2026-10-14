import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc } from 'better-auth/plugins/organization/access';

// Better Auth's own org-management permissions. Boogbe's domain permissions live in @boogbe/shared/permissions.
export const ac = createAccessControl(defaultStatements);
export const orgRoles = {
  admin: ac.newRole(adminAc.statements),
  frontdesk: ac.newRole(memberAc.statements),
  housekeeper: ac.newRole(memberAc.statements),
  landlord: ac.newRole(memberAc.statements),
};
