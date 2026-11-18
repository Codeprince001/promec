import { FitmentStatus, PrismaClient, UserType } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/password';

type Db = PrismaClient;

const photos = {
  brake: 'https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=800',
  disc: 'https://images.pexels.com/photos/3806249/pexels-photo-3806249.jpeg?auto=compress&cs=tinysrgb&w=800',
  filter: 'https://images.pexels.com/photos/3807277/pexels-photo-3807277.jpeg?auto=compress&cs=tinysrgb&w=800',
  air: 'https://images.pexels.com/photos/4489732/pexels-photo-4489732.jpeg?auto=compress&cs=tinysrgb&w=800',
  plug: 'https://images.pexels.com/photos/4489749/pexels-photo-4489749.jpeg?auto=compress&cs=tinysrgb&w=800',
  electrical: 'https://images.pexels.com/photos/2244746/pexels-photo-2244746.jpeg?auto=compress&cs=tinysrgb&w=800',
  wheel: 'https://images.pexels.com/photos/279949/pexels-photo-279949.jpeg?auto=compress&cs=tinysrgb&w=800',
  engine: 'https://images.pexels.com/photos/190574/pexels-photo-190574.jpeg?auto=compress&cs=tinysrgb&w=800',
  wiper: 'https://images.pexels.com/photos/3642618/pexels-photo-3642618.jpeg?auto=compress&cs=tinysrgb&w=800',
  bannerCar: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1400&q=70',
  bannerSport: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1400&q=70',
  bannerGrey: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1400&q=70',
  bannerBay: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=1400&q=70',
  bannerFront: 'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?auto=format&fit=crop&w=1400&q=70',
};

const categoryPhoto: Record<string, string> = {
  'brake-pads': photos.brake,
  'brake-discs': photos.disc,
  filters: photos.filter,
  'spark-plugs': photos.plug,
  cooling: photos.engine,
  electrical: photos.electrical,
  suspension: photos.wheel,
  'shock-absorbers': photos.wheel,
  clutch: photos.engine,
  wipers: photos.wiper,
};

function logo(name: string, background: string) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${background}&color=ffffff&size=256&format=png&bold=true`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

type StoreSpec = {
  email: string;
  slug: string;
  businessName: string;
  phone: string;
  city: string;
  state: string;
  addressLine: string;
  description: string;
  policies: string;
  bank: string;
  accountName: string;
  accountNumber: string;
  logoUrl: string;
  bannerUrl: string;
  parts: { category: string; brand: string; label: string; position: string; price: number; qty: number; weightG: number; photo: string }[];
};

const stores: StoreSpec[] = [
  {
    email: 'ikeja-brakes@promec.test',
    slug: 'ikeja-brake-house',
    businessName: 'Ikeja Brake House',
    phone: '+2348091112201',
    city: 'Ikeja',
    state: 'Lagos',
    addressLine: '14 Opebi Road',
    description: 'Pads and discs for the cars that work the Lagos roads. The store ships its own stock.',
    policies: 'Unopened pads can be returned within 7 days. Fitted parts are not returned.',
    bank: 'GTBank',
    accountName: 'Ikeja Brake House',
    accountNumber: '0123400001',
    logoUrl: logo('Brake House', '163A70'),
    bannerUrl: photos.bannerCar,
    parts: [
      { category: 'brake-pads', brand: 'Brembo', label: 'Front brake pad set', position: 'front', price: 31200, qty: 14, weightG: 1400, photo: photos.brake },
      { category: 'brake-discs', brand: 'Bosch', label: 'Front brake disc pair', position: 'front', price: 46800, qty: 6, weightG: 8400, photo: photos.disc },
    ],
  },
  {
    email: 'yaba-filters@promec.test',
    slug: 'yaba-filter-desk',
    businessName: 'Yaba Filter Desk',
    phone: '+2348091112202',
    city: 'Yaba',
    state: 'Lagos',
    addressLine: '8 Commercial Avenue',
    description: 'Oil and air filters, packed for the service bays around Yaba.',
    policies: 'Filters are sealed. A damaged box can be exchanged before it is opened.',
    bank: 'Access Bank',
    accountName: 'Yaba Filter Desk',
    accountNumber: '0123400002',
    logoUrl: logo('Filter Desk', 'F15A24'),
    bannerUrl: photos.bannerSport,
    parts: [
      { category: 'filters', brand: 'Mann-Filter', label: 'Oil filter', position: 'engine', price: 5800, qty: 40, weightG: 280, photo: photos.filter },
      { category: 'filters', brand: 'Denso', label: 'Air filter', position: 'engine', price: 7600, qty: 28, weightG: 400, photo: photos.air },
    ],
  },
  {
    email: 'surulere-spark@promec.test',
    slug: 'surulere-spark-bay',
    businessName: 'Surulere Spark Bay',
    phone: '+2348091112203',
    city: 'Surulere',
    state: 'Lagos',
    addressLine: '22 Adeniran Ogunsanya',
    description: 'Plugs and charging parts. This store ships from Surulere, not from the PROMEC warehouse.',
    policies: 'Electrical parts are tested before dispatch. Returns need the original box.',
    bank: 'Zenith Bank',
    accountName: 'Surulere Spark Bay',
    accountNumber: '0123400003',
    logoUrl: logo('Spark Bay', '0E1B2C'),
    bannerUrl: photos.bannerGrey,
    parts: [
      { category: 'spark-plugs', brand: 'NGK', label: 'Spark plug set', position: 'engine', price: 15200, qty: 18, weightG: 360, photo: photos.plug },
      { category: 'electrical', brand: 'Denso', label: 'Alternator', position: 'engine', price: 94000, qty: 3, weightG: 5400, photo: photos.electrical },
    ],
  },
  {
    email: 'apapa-suspension@promec.test',
    slug: 'apapa-suspension-lane',
    businessName: 'Apapa Suspension Lane',
    phone: '+2348091112204',
    city: 'Apapa',
    state: 'Lagos',
    addressLine: '5 Warehouse Road',
    description: 'Shocks for the rough stretch between Apapa and the island.',
    policies: 'Shocks can be returned unfitted within 7 days.',
    bank: 'UBA',
    accountName: 'Apapa Suspension Lane',
    accountNumber: '0123400004',
    logoUrl: logo('Suspension', '163A70'),
    bannerUrl: photos.bannerBay,
    parts: [
      { category: 'suspension', brand: 'Monroe', label: 'Front shock absorber', position: 'front', price: 36400, qty: 10, weightG: 2700, photo: photos.wheel },
      { category: 'suspension', brand: 'Monroe', label: 'Rear shock absorber', position: 'rear', price: 33800, qty: 8, weightG: 2500, photo: photos.engine },
    ],
  },
];

export async function seedStores(prisma: Db, sourceId: string) {
  const passwordHash = await hashPassword('StorePass123');
  const variants = await prisma.vehicleVariant.findMany({
    include: { model: { include: { make: true } }, engine: true },
    orderBy: { id: 'asc' },
  });
  let products = 0;

  for (const [storeIndex, spec] of stores.entries()) {
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      update: { userType: UserType.vendor },
      create: { email: spec.email, passwordHash, userType: UserType.vendor, emailVerifiedAt: new Date('2026-11-01') },
    });
    const vendor = await prisma.vendor.upsert({
      where: { slug: spec.slug },
      update: {
        status: 'approved',
        fulfilmentMode: 'vendor',
        logoUrl: spec.logoUrl,
        bannerUrl: spec.bannerUrl,
        description: spec.description,
        phone: spec.phone,
        addressLine: spec.addressLine,
        city: spec.city,
        state: spec.state,
        policies: spec.policies,
        payoutBankName: spec.bank,
        payoutAccountName: spec.accountName,
        payoutAccountNumber: spec.accountNumber,
      },
      create: {
        userId: user.id,
        businessName: spec.businessName,
        slug: spec.slug,
        status: 'approved',
        fulfilmentMode: 'vendor',
        commissionRate: 0.12,
        logoUrl: spec.logoUrl,
        bannerUrl: spec.bannerUrl,
        description: spec.description,
        phone: spec.phone,
        addressLine: spec.addressLine,
        city: spec.city,
        state: spec.state,
        country: 'NG',
        policies: spec.policies,
        payoutBankName: spec.bank,
        payoutAccountName: spec.accountName,
        payoutAccountNumber: spec.accountNumber,
      },
    });

    const slice = variants.filter((_, index) => index % stores.length === storeIndex).slice(0, 6);
    for (const variant of slice) {
      for (const part of spec.parts) {
        const created = await ensureStorePart(prisma, vendor.id, spec.businessName, variant, part);
        if (!created) continue;
        if (created.created) products += 1;
        await ensureFit(prisma, sourceId, created.productId, variant, part.position);
      }
    }
  }

  await dressLagos(prisma, sourceId, variants);
  const images = await attachMissingPhotos(prisma);
  return { stores: stores.length, products, images };
}

async function dressLagos(
  prisma: Db,
  sourceId: string,
  variants: Awaited<ReturnType<Db['vehicleVariant']['findMany']>> & { model: { name: string; make: { name: string } }; yearFrom: number; yearTo: number; engineId: string | null }[],
) {
  const vendor = await prisma.vendor.findUnique({ where: { slug: 'lagos-parts-desk' } });
  if (!vendor) return;
  await prisma.vendor.update({
    where: { id: vendor.id },
    data: {
      fulfilmentMode: 'vendor',
      logoUrl: vendor.logoUrl ?? logo('Lagos Parts', 'F15A24'),
      bannerUrl: vendor.bannerUrl ?? photos.bannerFront,
      description: vendor.description ?? 'A Lagos counter for wipers and the small parts around the glass.',
    },
  });
  const part = { category: 'wipers', brand: 'Bosch', label: 'Wiper blade pair', position: 'front', price: 8900, qty: 22, weightG: 460, photo: photos.wiper };
  for (const variant of variants.slice(0, 4)) {
    const created = await ensureStorePart(prisma, vendor.id, vendor.businessName, variant, part);
    if (!created) continue;
    await ensureFit(prisma, sourceId, created.productId, variant, part.position);
  }
}

async function ensureStorePart(
  prisma: Db,
  vendorId: string,
  storeName: string,
  variant: { id: string; yearFrom: number; yearTo: number; trim: string | null; model: { name: string; make: { name: string } } },
  part: StoreSpec['parts'][number],
) {
  const vehicle = `${variant.model.make.name} ${variant.model.name}`;
  const mpn = `${part.brand.slice(0, 3).toUpperCase()}-${slugify(vehicle).slice(0, 8).toUpperCase()}-${part.position.slice(0, 2).toUpperCase()}-${part.category.slice(0, 2).toUpperCase()}`;
  const name = `${storeName} ${part.label} for ${vehicle}`;
  const slug = slugify(`${name} ${mpn}`);
  const existing = await prisma.product.findUnique({ where: { slug }, include: { skus: true, media: true } });
  if (existing) {
    if (existing.media.length === 0) {
      await prisma.productMedia.create({ data: { productId: existing.id, url: part.photo, alt: name } });
    }
    return { productId: existing.id, created: false };
  }
  const brand = await prisma.manufacturer.findUnique({ where: { name: part.brand } });
  const category = await prisma.category.findUnique({ where: { slug: part.category } });
  if (!brand || !category) return null;
  const product = await prisma.product.create({
    data: {
      name,
      slug,
      vendorId,
      manufacturerId: brand.id,
      categoryId: category.id,
      description: `${part.label} sold by ${storeName} for the ${variant.yearFrom}–${variant.yearTo} ${vehicle}. The store ships this part.`,
      condition: 'new',
      status: 'published',
      warrantyMonths: 6,
      originCountry: 'NG',
      attributes: { position: part.position, store: storeName },
      partNumbers: { create: [{ number: mpn, normalized: mpn.replace(/[^A-Z0-9]/g, ''), type: 'MPN', manufacturerId: brand.id }] },
      media: { create: [{ url: part.photo, alt: name }] },
      skus: {
        create: {
          sku: `STO-${mpn}-${variant.id.slice(-4)}`.slice(0, 48),
          sellingPrice: part.price,
          weightG: part.weightG,
          currencyCode: 'NGN',
          vendorStock: { create: { vendorId, onHandQty: part.qty } },
        },
      },
    },
    select: { id: true },
  });
  return { productId: product.id, created: true };
}

async function ensureFit(
  prisma: Db,
  sourceId: string,
  productId: string,
  variant: { id: string; modelId: string; engineId: string | null; yearFrom: number; yearTo: number; model: { makeId: string } },
  position: string,
) {
  const already = await prisma.vehicleCompatibility.findFirst({ where: { productId, vehicleVariantId: variant.id }, select: { id: true } });
  if (already) return;
  await prisma.vehicleCompatibility.create({
    data: {
      productId,
      vehicleVariantId: variant.id,
      makeId: variant.model.makeId,
      modelId: variant.modelId,
      engineId: variant.engineId,
      yearFrom: variant.yearFrom,
      yearTo: variant.yearTo,
      status: FitmentStatus.confirmed,
      position,
      side: 'both',
      qtyPerVehicle: position === 'front' || position === 'rear' ? 2 : 1,
      notes: 'Recorded for this store listing and this variant.',
      sourceId,
      confidence: 1,
      verifiedAt: new Date('2026-11-16'),
    },
  });
}

async function attachMissingPhotos(prisma: Db) {
  const bare = await prisma.product.findMany({
    where: { media: { none: {} }, deletedAt: null },
    select: { id: true, name: true, category: { select: { slug: true } } },
  });
  for (const product of bare) {
    const url = categoryPhoto[product.category.slug] ?? photos.engine;
    await prisma.productMedia.create({ data: { productId: product.id, url, alt: product.name } });
  }
  return bare.length;
}
