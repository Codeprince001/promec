export type RoleGrant = {
  superAdmin: boolean;
  warehouseId: string | null;
  permissions: { code: string; scope: string }[];
};

export function warehouseScope(grants: RoleGrant[], permission: string): string[] | null {
  if (grants.some((grant) => grant.superAdmin || grant.permissions.some((item) => item.code === '*'))) return null;
  const relevant = grants.filter((grant) => grant.permissions.some((item) => item.code === permission));
  if (relevant.some((grant) => grant.permissions.some((item) => item.code === permission && item.scope !== 'warehouse'))) {
    return null;
  }
  return [...new Set(relevant.flatMap((grant) => (grant.warehouseId ? [grant.warehouseId] : [])))];
}
