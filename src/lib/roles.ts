/**
 * Role permissions (Naivas style): profit margins are OWNER / MANAGER /
 * ACCOUNTANT eyes only. Cashiers, store keepers and sales staff never see
 * cost or margin figures anywhere in the app.
 */

const MARGIN_ROLES = ["Owner", "Manager", "Accountant"];

export function canSeeMargin(role: string | undefined | null): boolean {
  if (!role) return false;
  return MARGIN_ROLES.includes(role);
}

/** Roles that may empty the trash / restore deleted records. */
export function canManageTrash(role: string | undefined | null): boolean {
  if (!role) return false;
  return ["Owner", "Manager"].includes(role);
}
