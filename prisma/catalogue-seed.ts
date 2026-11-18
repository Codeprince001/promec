import { FitmentStatus, PrismaClient } from '@prisma/client';

type Db = PrismaClient;

const categories = [
  ['brake-pads', 'Brake pads', 'Friction material for disc brakes'],
  ['brake-discs', 'Brake discs', 'Front and rear rotors'],
  ['filters', 'Filters', 'Oil, air, and cabin filters'],
  ['spark-plugs', 'Spark plugs', 'Ignition plugs and sets'],
  ['cooling', 'Cooling', 'Radiators, pumps, and thermostats'],
  ['electrical', 'Electrical', 'Alternators, batteries, and sensors'],
  ['suspension', 'Suspension', 'Arms, links, and bushings'],
  ['clutch', 'Clutch', 'Clutch kits and release bearings'],
  ['wipers', 'Wipers', 'Blades for the Lagos rains'],
] as const;

const makers = [
  ['Bosch', 'DE'],
  ['Denso', 'JP'],
  ['NGK', 'JP'],
  ['Mann-Filter', 'DE'],
  ['Brembo', 'IT'],
  ['Monroe', 'US'],
  ['Aisin', 'JP'],
  ['Gates', 'US'],
  ['Valeo', 'FR'],
  ['Toyota', 'JP'],
  ['Honda', 'JP'],
] as const;

type VehicleSpec = {
  make: string;
  makeSlug: string;
  country: string;
  model: string;
  modelSlug: string;
  generation: string;
  yearFrom: number;
  yearTo: number;
  vehicleClass?: string;
  engine: string;
  cc: number;
  cylinders: number;
  fuel: string;
  trim: string;
};

const vehicles: VehicleSpec[] = [
  { make: 'Toyota', makeSlug: 'toyota', country: 'JP', model: 'Corolla', modelSlug: 'corolla', generation: 'E170', yearFrom: 2014, yearTo: 2019, engine: '2ZR-FE', cc: 1798, cylinders: 4, fuel: 'petrol', trim: '1.8L' },
  { make: 'Toyota', makeSlug: 'toyota', country: 'JP', model: 'Hilux', modelSlug: 'hilux', generation: 'AN120', yearFrom: 2016, yearTo: 2023, vehicleClass: 'pickup', engine: '2GD-FTV', cc: 2393, cylinders: 4, fuel: 'diesel', trim: '2.4D' },
  { make: 'Toyota', makeSlug: 'toyota', country: 'JP', model: 'RAV4', modelSlug: 'rav4', generation: 'XA40', yearFrom: 2013, yearTo: 2018, engine: '2AR-FE-RAV', cc: 2494, cylinders: 4, fuel: 'petrol', trim: '2.5L' },
  { make: 'Toyota', makeSlug: 'toyota', country: 'JP', model: 'Highlander', modelSlug: 'highlander', generation: 'XU50', yearFrom: 2014, yearTo: 2019, engine: '2GR-FE', cc: 3456, cylinders: 6, fuel: 'petrol', trim: '3.5L' },
  { make: 'Honda', makeSlug: 'honda', country: 'JP', model: 'Accord', modelSlug: 'accord', generation: 'CR', yearFrom: 2013, yearTo: 2017, engine: 'K24W', cc: 2356, cylinders: 4, fuel: 'petrol', trim: '2.4L' },
  { make: 'Honda', makeSlug: 'honda', country: 'JP', model: 'CR-V', modelSlug: 'cr-v', generation: 'RM', yearFrom: 2012, yearTo: 2016, engine: 'R20A', cc: 1997, cylinders: 4, fuel: 'petrol', trim: '2.0L' },
  { make: 'Honda', makeSlug: 'honda', country: 'JP', model: 'Civic', modelSlug: 'civic', generation: 'FC', yearFrom: 2016, yearTo: 2021, engine: 'L15B', cc: 1498, cylinders: 4, fuel: 'petrol', trim: '1.5T' },
  { make: 'Hyundai', makeSlug: 'hyundai', country: 'KR', model: 'Elantra', modelSlug: 'elantra', generation: 'AD', yearFrom: 2016, yearTo: 2020, engine: 'G4NA', cc: 1999, cylinders: 4, fuel: 'petrol', trim: '2.0L' },
  { make: 'Hyundai', makeSlug: 'hyundai', country: 'KR', model: 'Tucson', modelSlug: 'tucson', generation: 'TL', yearFrom: 2016, yearTo: 2020, engine: 'G4NA-TUC', cc: 1999, cylinders: 4, fuel: 'petrol', trim: '2.0L' },
  { make: 'Kia', makeSlug: 'kia', country: 'KR', model: 'Sportage', modelSlug: 'sportage', generation: 'QL', yearFrom: 2016, yearTo: 2021, engine: 'G4NA-SPO', cc: 1999, cylinders: 4, fuel: 'petrol', trim: '2.0L' },
  { make: 'Nissan', makeSlug: 'nissan', country: 'JP', model: 'Altima', modelSlug: 'altima', generation: 'L33', yearFrom: 2013, yearTo: 2018, engine: 'QR25DE', cc: 2488, cylinders: 4, fuel: 'petrol', trim: '2.5L' },
  { make: 'Nissan', makeSlug: 'nissan', country: 'JP', model: 'X-Trail', modelSlug: 'x-trail', generation: 'T32', yearFrom: 2014, yearTo: 2021, engine: 'MR20DD', cc: 1997, cylinders: 4, fuel: 'petrol', trim: '2.0L' },
  { make: 'Lexus', makeSlug: 'lexus', country: 'JP', model: 'RX', modelSlug: 'rx', generation: 'AL20', yearFrom: 2016, yearTo: 2022, engine: '2GR-FKS', cc: 3456, cylinders: 6, fuel: 'petrol', trim: '350' },
  { make: 'Lexus', makeSlug: 'lexus', country: 'JP', model: 'ES', modelSlug: 'es', generation: 'XV60', yearFrom: 2013, yearTo: 2018, engine: '2AR-FE-ES', cc: 2494, cylinders: 4, fuel: 'petrol', trim: '350' },
  { make: 'Mercedes-Benz', makeSlug: 'mercedes-benz', country: 'DE', model: 'C-Class', modelSlug: 'c-class', generation: 'W205', yearFrom: 2015, yearTo: 2021, engine: 'M264', cc: 1991, cylinders: 4, fuel: 'petrol', trim: 'C200' },
  { make: 'Ford', makeSlug: 'ford', country: 'US', model: 'Ranger', modelSlug: 'ranger', generation: 'T6', yearFrom: 2012, yearTo: 2022, vehicleClass: 'pickup', engine: 'P5AT', cc: 3198, cylinders: 5, fuel: 'diesel', trim: '3.2D' },
];

type PartKind = {
  category: string;
  brand: string;
  label: string;
  position: string;
  price: number;
  qty: number;
  weightG: number;
  origin: string;
};

const kinds: PartKind[] = [
  { category: 'brake-pads', brand: 'Brembo', label: 'Front brake pad set', position: 'front', price: 28500, qty: 18, weightG: 1400, origin: 'IT' },
  { category: 'brake-discs', brand: 'Bosch', label: 'Front brake disc pair', position: 'front', price: 42000, qty: 8, weightG: 8200, origin: 'DE' },
  { category: 'filters', brand: 'Mann-Filter', label: 'Oil filter', position: 'engine', price: 6500, qty: 40, weightG: 280, origin: 'DE' },
  { category: 'filters', brand: 'Denso', label: 'Air filter', position: 'engine', price: 8900, qty: 26, weightG: 420, origin: 'JP' },
  { category: 'spark-plugs', brand: 'NGK', label: 'Spark plug set', position: 'engine', price: 14500, qty: 22, weightG: 360, origin: 'JP' },
  { category: 'cooling', brand: 'Aisin', label: 'Water pump', position: 'engine', price: 36500, qty: 6, weightG: 1800, origin: 'JP' },
  { category: 'electrical', brand: 'Denso', label: 'Alternator', position: 'engine', price: 89000, qty: 3, weightG: 5400, origin: 'JP' },
  { category: 'suspension', brand: 'Monroe', label: 'Front shock absorber', position: 'front', price: 39500, qty: 11, weightG: 2800, origin: 'US' },
  { category: 'clutch', brand: 'Valeo', label: 'Clutch kit', position: 'transmission', price: 72000, qty: 4, weightG: 7600, origin: 'FR' },
  { category: 'wipers', brand: 'Bosch', label: 'Wiper blade pair', position: 'front', price: 9800, qty: 30, weightG: 450, origin: 'DE' },
];

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

type FitRow = {
  productId: string;
  variantId: string;
  makeId: string;
  modelId: string;
  engineId: string | null;
  yearFrom: number;
  yearTo: number;
  position: string;
  status: FitmentStatus;
  notes: string;
};

function variantUuid(index: number) {
  return `00000000-0000-4000-8000-${(0x310 + index).toString(16).padStart(12, '0')}`;
}

export async function seedCatalogue(prisma: Db, warehouseId: string, sourceId: string) {
  const categoryId = new Map<string, string>();
  for (const [index, [slug, name, description]] of categories.entries()) {
    const row = await prisma.category.upsert({
      where: { slug },
      update: { name, description, sortOrder: index + 1 },
      create: { name, slug, path: slug, description, sortOrder: index + 1 },
    });
    categoryId.set(slug, row.id);
  }

  const manufacturerId = new Map<string, string>();
  for (const [name, country] of makers) {
    const row = await prisma.manufacturer.upsert({
      where: { name },
      update: { country },
      create: { name, country, type: name === 'Toyota' || name === 'Honda' ? 'oem' : 'aftermarket' },
    });
    manufacturerId.set(name, row.id);
  }

  const fitted: FitRow[] = [];

  for (const [index, vehicle] of vehicles.entries()) {
    const make = await prisma.vehicleMake.upsert({
      where: { slug: vehicle.makeSlug },
      update: { name: vehicle.make, country: vehicle.country },
      create: { name: vehicle.make, slug: vehicle.makeSlug, country: vehicle.country },
    });
    const model = await prisma.vehicleModel.upsert({
      where: { makeId_slug_generation: { makeId: make.id, slug: vehicle.modelSlug, generation: vehicle.generation } },
      update: { yearFrom: vehicle.yearFrom, yearTo: vehicle.yearTo },
      create: {
        makeId: make.id,
        name: vehicle.model,
        slug: vehicle.modelSlug,
        generation: vehicle.generation,
        yearFrom: vehicle.yearFrom,
        yearTo: vehicle.yearTo,
        vehicleClass: vehicle.vehicleClass ?? 'passenger',
      },
    });
    const engine = await prisma.engine.upsert({
      where: { code: vehicle.engine },
      update: {},
      create: { code: vehicle.engine, displacementCc: vehicle.cc, cylinders: vehicle.cylinders, fuelType: vehicle.fuel },
    });
    const variant = await prisma.vehicleVariant.upsert({
      where: { id: variantUuid(index) },
      update: {},
      create: {
        id: variantUuid(index),
        modelId: model.id,
        engineId: engine.id,
        yearFrom: vehicle.yearFrom,
        yearTo: vehicle.yearTo,
        market: 'NG',
        trim: vehicle.trim,
        fuelType: vehicle.fuel,
      },
    });

    const chosen = kinds.filter((_, kindIndex) => kindIndex % 2 === index % 2 || kindIndex < 4);
    for (const kind of chosen) {
      const mpn = `${kind.brand.slice(0, 3).toUpperCase()}-${vehicle.modelSlug.slice(0, 4).toUpperCase()}-${kind.category.slice(0, 3).toUpperCase()}`;
      const name = `${kind.brand} ${kind.label} for ${vehicle.make} ${vehicle.model} ${vehicle.trim}`;
      const slug = slugify(`${name} ${mpn}`);
      const brandId = manufacturerId.get(kind.brand);
      const groupId = categoryId.get(kind.category);
      if (!brandId || !groupId) continue;
      const existing = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
      const product = existing ?? await prisma.product.create({
        data: {
          name,
          slug,
          manufacturerId: brandId,
          categoryId: groupId,
          description: `${kind.label} for the ${vehicle.yearFrom}–${vehicle.yearTo} ${vehicle.make} ${vehicle.model} ${vehicle.trim}. The catalogue decides fitment after the vehicle is selected.`,
          condition: 'new',
          status: 'published',
          warrantyMonths: 12,
          originCountry: kind.origin,
          attributes: { position: kind.position, fuel: vehicle.fuel },
          partNumbers: {
            create: [
              { number: mpn, normalized: mpn.replace(/[^A-Z0-9]/g, ''), type: 'MPN', manufacturerId: brandId },
              { number: `OEM-${mpn}`, normalized: `OEM${mpn.replace(/[^A-Z0-9]/g, '')}`, type: 'OEM' },
            ],
          },
          skus: {
            create: {
              sku: `PRM-${mpn}`,
              sellingPrice: kind.price + index * 250,
              weightG: kind.weightG,
              currencyCode: 'NGN',
              inventory: { create: { warehouseId, onHandQty: Math.max(0, kind.qty - (index % 5)), reorderPoint: 2, avgCost: Math.round(kind.price * 0.62) } },
            },
          },
        },
        select: { id: true },
      });
      const status = index % 11 === 0 && kind.category === 'suspension' ? FitmentStatus.probable : FitmentStatus.confirmed;
      fitted.push({
        productId: product.id,
        variantId: variant.id,
        makeId: make.id,
        modelId: model.id,
        engineId: engine.id,
        yearFrom: vehicle.yearFrom,
        yearTo: vehicle.yearTo,
        position: kind.position,
        status,
        notes: status === FitmentStatus.probable
          ? 'Close record. Confirm the generation before fitting.'
          : `Recorded for the ${vehicle.trim} ${vehicle.fuel} variant.`,
      });
    }
  }

  const camryPads = await ensureCamryExtras(prisma, warehouseId, manufacturerId, categoryId);
  fitted.push(...camryPads);

  for (const row of fitted) {
    const already = await prisma.vehicleCompatibility.findFirst({
      where: { productId: row.productId, vehicleVariantId: row.variantId },
      select: { id: true },
    });
    if (already) continue;
    await prisma.vehicleCompatibility.create({
      data: {
        productId: row.productId,
        vehicleVariantId: row.variantId,
        makeId: row.makeId,
        modelId: row.modelId,
        engineId: row.engineId,
        yearFrom: row.yearFrom,
        yearTo: row.yearTo,
        status: row.status,
        position: row.position,
        side: 'both',
        qtyPerVehicle: row.position === 'front' ? 2 : 1,
        notes: row.notes,
        sourceId,
        confidence: row.status === FitmentStatus.confirmed ? 1 : 0.7,
        verifiedAt: new Date('2026-11-01'),
      },
    });
  }

  return { vehicles: vehicles.length, parts: fitted.length };
}

async function ensureCamryExtras(
  prisma: Db,
  warehouseId: string,
  manufacturerId: Map<string, string>,
  categoryId: Map<string, string>,
) {
  const variantId = '00000000-0000-4000-8000-000000000101';
  const variant = await prisma.vehicleVariant.findUnique({
    where: { id: variantId },
    include: { model: true, engine: true },
  });
  if (!variant) return [];
  const extras = [
    { category: 'brake-pads', brand: 'Bosch', label: 'Front brake pad set', mpn: 'BOS-CAM-BP', price: 24800, qty: 16, weightG: 1300, position: 'front' },
    { category: 'filters', brand: 'Mann-Filter', label: 'Oil filter', mpn: 'MAN-CAM-OIL', price: 7200, qty: 35, weightG: 260, position: 'engine' },
    { category: 'filters', brand: 'Denso', label: 'Cabin filter', mpn: 'DEN-CAM-CAB', price: 8400, qty: 20, weightG: 310, position: 'cabin' },
    { category: 'spark-plugs', brand: 'NGK', label: 'Spark plug set', mpn: 'NGK-CAM-SP', price: 16800, qty: 14, weightG: 340, position: 'engine' },
    { category: 'wipers', brand: 'Bosch', label: 'Wiper blade pair', mpn: 'BOS-CAM-WIP', price: 11200, qty: 24, weightG: 480, position: 'front' },
  ];
  const rows = [];
  for (const extra of extras) {
    const brandId = manufacturerId.get(extra.brand);
    const groupId = categoryId.get(extra.category);
    if (!brandId || !groupId) continue;
    const slug = slugify(`${extra.brand} ${extra.label} toyota camry ${extra.mpn}`);
    const existing = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    const product = existing ?? await prisma.product.create({
      data: {
        name: `${extra.brand} ${extra.label} for Toyota Camry 2.5L`,
        slug,
        manufacturerId: brandId,
        categoryId: groupId,
        description: 'For the 2012–2017 Toyota Camry 2.5L petrol. The hybrid uses a different record.',
        condition: 'new',
        status: 'published',
        warrantyMonths: 12,
        originCountry: extra.brand === 'Bosch' || extra.brand === 'Mann-Filter' ? 'DE' : 'JP',
        attributes: { position: extra.position },
        partNumbers: {
          create: [
            { number: extra.mpn, normalized: extra.mpn.replace(/[^A-Z0-9]/g, ''), type: 'MPN', manufacturerId: brandId },
          ],
        },
        skus: {
          create: {
            sku: `PRM-${extra.mpn}`,
            sellingPrice: extra.price,
            weightG: extra.weightG,
            currencyCode: 'NGN',
            inventory: { create: { warehouseId, onHandQty: extra.qty, reorderPoint: 3, avgCost: Math.round(extra.price * 0.6) } },
          },
        },
      },
      select: { id: true },
    });
    rows.push({
      productId: product.id,
      variantId,
      makeId: variant.model.makeId,
      modelId: variant.modelId,
      engineId: variant.engineId,
      yearFrom: variant.yearFrom,
      yearTo: variant.yearTo,
      position: extra.position,
      status: FitmentStatus.confirmed,
      notes: 'Recorded for the 2.5L petrol Camry. Not the hybrid.',
    });
  }
  return rows;
}
