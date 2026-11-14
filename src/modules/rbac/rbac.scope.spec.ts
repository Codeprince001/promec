import { warehouseScope, type RoleGrant } from './rbac.scope';

const warehouse: RoleGrant = {
  superAdmin: false,
  warehouseId: 'lag-01',
  permissions: [{ code: 'inventory.manage', scope: 'warehouse' }],
};

describe('warehouse scope', () => {
  it('lets a super admin see every warehouse', () => {
    expect(warehouseScope([{ superAdmin: true, warehouseId: null, permissions: [{ code: '*', scope: 'all' }] }], 'inventory.manage')).toBeNull();
  });

  it('limits a warehouse role to its assigned warehouse', () => {
    expect(warehouseScope([warehouse], 'inventory.manage')).toEqual(['lag-01']);
  });

  it('returns no warehouses when the assignment has no warehouse', () => {
    expect(warehouseScope([{ ...warehouse, warehouseId: null }], 'inventory.manage')).toEqual([]);
  });

  it('does not limit a role whose permission scope is all', () => {
    expect(
      warehouseScope([{ superAdmin: false, warehouseId: 'lag-01', permissions: [{ code: 'inventory.manage', scope: 'all' }] }], 'inventory.manage'),
    ).toBeNull();
  });
});
