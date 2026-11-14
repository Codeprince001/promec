import 'dotenv/config';
import { FitmentStatus, PrismaClient, UserType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { hashPassword } from '../src/modules/auth/password';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});
const password = 'ChangeMe123!';

async function main() {
  const star = await prisma.permission.upsert({
    where: { code: '*' },
    update: {},
    create: { code: '*', module: 'platform', description: 'All permissions' },
  });
  const adminRole = await prisma.role.upsert({
    where: { name: 'super_admin' },
    update: {},
    create: { name: 'super_admin', description: 'Full platform access' },
  });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: adminRole.id, permissionId: star.id } },
    update: {},
    create: { roleId: adminRole.id, permissionId: star.id },
  });
  const customerRole = await prisma.role.upsert({
    where: { name: 'customer' },
    update: {},
    create: { name: 'customer', description: 'Retail customer' },
  });

  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@promec.test' },
    update: {},
    create: { email: 'admin@promec.test', passwordHash, userType: UserType.staff, mfaEnabled: true },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  const demo = await prisma.user.upsert({
    where: { email: 'demo@promec.test' },
    update: {},
    create: {
      email: 'demo@promec.test',
      passwordHash,
      userType: UserType.customer,
      customer: { create: { firstName: 'Ada', lastName: 'Okafor', customerType: 'individual', marketingConsent: true } },
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: demo.id, roleId: customerRole.id } },
    update: {},
    create: { userId: demo.id, roleId: customerRole.id },
  });

  const warehouse = await prisma.warehouse.upsert({
    where: { code: 'LAG-01' },
    update: {},
    create: { code: 'LAG-01', name: 'Lagos warehouse', state: 'Lagos', address: 'Lagos, Nigeria' },
  });

  await prisma.deliveryZone.deleteMany({ where: { name: { in: ['Lagos', 'Nationwide'] } } });
  await prisma.deliveryZone.createMany({
    data: [
      { name: 'Lagos', states: ['Lagos'], baseFee: 2500, perKgFee: 400 },
      { name: 'Nationwide', states: ['Abuja', 'Rivers', 'Oyo', 'Kano', 'Enugu'], baseFee: 4500, perKgFee: 700 },
    ],
  });

  const make = await prisma.vehicleMake.upsert({
    where: { slug: 'toyota' },
    update: {},
    create: { name: 'Toyota', slug: 'toyota', country: 'JP' },
  });
  const model = await prisma.vehicleModel.upsert({
    where: { makeId_slug_generation: { makeId: make.id, slug: 'camry', generation: 'XV50' } },
    update: {},
    create: { makeId: make.id, name: 'Camry', slug: 'camry', generation: 'XV50', yearFrom: 2012, yearTo: 2017 },
  });
  const engine = await prisma.engine.upsert({
    where: { code: '2AR-FE' },
    update: {},
    create: { code: '2AR-FE', displacementCc: 2494, cylinders: 4, fuelType: 'petrol' },
  });
  const hybrid = await prisma.engine.upsert({
    where: { code: '2AR-FXE' },
    update: {},
    create: { code: '2AR-FXE', displacementCc: 2494, cylinders: 4, fuelType: 'hybrid' },
  });
  const petrol = await prisma.vehicleVariant.upsert({
    where: { id: '00000000-0000-4000-8000-000000000101' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000101',
      modelId: model.id,
      engineId: engine.id,
      yearFrom: 2012,
      yearTo: 2017,
      market: 'US',
      trim: '2.5L',
      fuelType: 'petrol',
    },
  });
  await prisma.vehicleVariant.upsert({
    where: { id: '00000000-0000-4000-8000-000000000102' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000102',
      modelId: model.id,
      engineId: hybrid.id,
      yearFrom: 2012,
      yearTo: 2017,
      market: 'US',
      trim: 'Hybrid',
      fuelType: 'hybrid',
    },
  });

  const category = await prisma.category.upsert({
    where: { slug: 'shock-absorbers' },
    update: {},
    create: { name: 'Shock absorbers', slug: 'shock-absorbers', path: 'suspension-steering.shock-absorbers', description: 'Suspension dampers' },
  });
  const manufacturer = await prisma.manufacturer.upsert({
    where: { name: 'KYB' },
    update: {},
    create: { name: 'KYB', country: 'JP', type: 'aftermarket' },
  });
  const source = await prisma.compatibilitySource.upsert({
    where: { id: '00000000-0000-4000-8000-000000000201' },
    update: {},
    create: { id: '00000000-0000-4000-8000-000000000201', name: 'licensed_catalogue', type: 'catalogue', priority: 10 },
  });

  const product = await prisma.product.upsert({
    where: { slug: 'kyb-excel-g-front-shock-absorber-334448' },
    update: { status: 'published' },
    create: {
      name: 'KYB Excel-G Front Shock Absorber 334448',
      slug: 'kyb-excel-g-front-shock-absorber-334448',
      manufacturerId: manufacturer.id,
      categoryId: category.id,
      description: 'Gas-charged front shock absorber for the Toyota Camry 2.5L.',
      condition: 'new',
      status: 'published',
      warrantyMonths: 12,
      originCountry: 'JP',
      attributes: { position: 'front', type: 'gas-charged' },
      partNumbers: {
        create: [
          { number: '334448', normalized: '334448', type: 'MPN' },
          { number: '48510-06761', normalized: '4851006761', type: 'OEM' },
        ],
      },
      skus: {
        create: {
          sku: 'PRM-SUS-000551',
          sellingPrice: 48500,
          weightG: 3200,
          currencyCode: 'NGN',
          inventory: { create: { warehouseId: warehouse.id, onHandQty: 14, reorderPoint: 4, avgCost: 28000 } },
        },
      },
    },
    include: { skus: true },
  });

  const existingFit = await prisma.vehicleCompatibility.findFirst({ where: { productId: product.id, vehicleVariantId: petrol.id } });
  if (!existingFit) {
    await prisma.vehicleCompatibility.create({
      data: {
        productId: product.id,
        vehicleVariantId: petrol.id,
        makeId: make.id,
        modelId: model.id,
        engineId: engine.id,
        yearFrom: 2012,
        yearTo: 2017,
        status: FitmentStatus.confirmed,
        position: 'front',
        side: 'both',
        qtyPerVehicle: 2,
        notes: '2.5L four-cylinder only. Not for hybrid.',
        sourceId: source.id,
        confidence: 1,
        verifiedAt: new Date('2026-08-14'),
      },
    });
    await prisma.vehicleCompatibility.create({
      data: {
        productId: product.id,
        vehicleVariantId: '00000000-0000-4000-8000-000000000102',
        status: FitmentStatus.incompatible,
        notes: 'Different shock absorber part number for hybrid models.',
        sourceId: source.id,
        verifiedAt: new Date('2026-08-14'),
        confidence: 1,
      },
    });
  }

  await prisma.promotion.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: { code: 'WELCOME10', type: 'percent', amount: 10, description: 'Launch welcome discount', minSpend: 10000 },
  });

  console.log('Seeded admin@promec.test and demo@promec.test with password ChangeMe123!');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
