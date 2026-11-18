import { HttpStatus, Injectable } from '@nestjs/common';
import { FitmentStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { money } from '../../common/money';
import { pageMeta } from '../../common/pagination';
import { slugify } from '../../domain/slug';
import { normalizePartNumber } from '../../domain/part-number';
import { OutboxService } from '../../infra/outbox.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

export const productWriteSchema = z.object({
  name: z.string().min(2).max(180),
  manufacturerId: z.string().uuid(),
  categoryId: z.string().uuid(),
  description: z.string().max(5000).optional(),
  condition: z.enum(['new', 'used', 'refurbished']).default('new'),
  warrantyMonths: z.number().int().min(0).max(120).default(0),
  originCountry: z.string().length(2).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  sellingPrice: z.number().positive(),
  weightG: z.number().int().min(0).default(0),
  stockQty: z.number().int().min(0).default(0),
  partNumbers: z.array(z.object({ number: z.string().min(2), type: z.enum(['OEM', 'MPN', 'AFTERMARKET']) })).default([]),
  status: z.enum(['draft', 'in_review', 'published', 'archived']).default('draft'),
});

export const productInclude = {
  manufacturer: true,
  category: true,
  vendor: true,
  skus: { include: { inventory: true, vendorStock: true } },
  media: { orderBy: { sortOrder: 'asc' as const } },
  partNumbers: true,
} satisfies Prisma.ProductInclude;

@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  categories() {
    return this.prisma.category.findMany({ orderBy: [{ path: 'asc' }, { sortOrder: 'asc' }] });
  }

  adminList(query: { page: number; pageSize: number; q?: string; status?: string }) {
    return this.list({ ...query, includeDrafts: true });
  }

  async list(query: { page: number; pageSize: number; category?: string; q?: string; includeDrafts?: boolean; status?: string }) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.includeDrafts ? (query.status ? { status: query.status as never } : {}) : { status: 'published' }),
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { partNumbers: { some: { normalized: { contains: normalizePartNumber(query.q) } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { data: rows.map(presentProduct), meta: pageMeta(query.page, query.pageSize, total) };
  }

  async adminOne(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: productInclude });
    if (!product) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Product was not found');
    return presentProduct(product);
  }

  manufacturers() {
    return this.prisma.manufacturer.findMany({ orderBy: { name: 'asc' } });
  }

  async createCategory(input: { name: string; parentId?: string; description?: string; sortOrder?: number }) {
    const parent = input.parentId ? await this.prisma.category.findUnique({ where: { id: input.parentId } }) : null;
    if (input.parentId && !parent) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Parent category was not found');
    const slug = slugify(input.name);
    return this.prisma.category.create({
      data: {
        name: input.name,
        slug,
        path: parent ? `${parent.path}/${slug}` : slug,
        parentId: parent?.id,
        description: input.description,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async updateCategory(id: string, input: { name?: string; description?: string | null; sortOrder?: number }) {
    const current = await this.prisma.category.findUnique({ where: { id } });
    if (!current) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Category was not found');
    return this.prisma.category.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        sortOrder: input.sortOrder,
      },
    });
  }

  async updateManufacturer(id: string, input: { name?: string; country?: string | null; type?: string }) {
    try {
      return await this.prisma.manufacturer.update({ where: { id }, data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Manufacturer was not found');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'A manufacturer with that name already exists');
      }
      throw error;
    }
  }

  async createManufacturer(input: { name: string; country?: string; type: string }) {
    try {
      return await this.prisma.manufacturer.create({ data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'A manufacturer with that name already exists');
      }
      throw error;
    }
  }

  async bySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'published', deletedAt: null },
      include: productInclude,
    });
    if (!product) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Product was not found');
    return presentProduct(product);
  }

  async create(input: z.infer<typeof productWriteSchema>, actorId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { isActive: true }, orderBy: { code: 'asc' } });
    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
      data: {
        name: input.name,
        slug: slugify(input.name),
        manufacturerId: input.manufacturerId,
        categoryId: input.categoryId,
        description: input.description,
        condition: input.condition,
        warrantyMonths: input.warrantyMonths,
        originCountry: input.originCountry,
        attributes: (input.attributes ?? undefined) as Prisma.InputJsonValue | undefined,
        status: input.status,
        partNumbers: {
          create: input.partNumbers.map((part) => ({
            number: part.number,
            normalized: normalizePartNumber(part.number),
            type: part.type,
          })),
        },
        skus: {
          create: {
            sku: `PRM-${Date.now().toString(36).toUpperCase()}`,
            sellingPrice: input.sellingPrice,
            weightG: input.weightG,
            currencyCode: 'NGN',
            ...(warehouse
              ? {
                  inventory: {
                    create: {
                      warehouseId: warehouse.id,
                      onHandQty: input.stockQty,
                      reorderPoint: 2,
                    },
                  },
                }
              : {}),
          },
        },
      },
      include: productInclude,
    });
      await this.outbox.append(tx, {
        aggregateType: 'product',
        aggregateId: created.id,
        eventType: 'product.updated',
        payload: { productId: created.id, status: created.status },
      });
      await this.audit.log(
        { actorId, action: 'product.create', entityType: 'product', entityId: created.id, after: { name: created.name, status: created.status } },
        tx,
      );
      return created;
    });
    return presentProduct(product);
  }

  async update(id: string, input: Partial<z.infer<typeof productWriteSchema>>, actorId: string) {
    const existing = await this.prisma.product.findUnique({ where: { id }, include: { skus: true } });
    if (!existing) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Product was not found');
    const product = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        status: input.status,
        warrantyMonths: input.warrantyMonths,
        ...(input.sellingPrice != null && existing.skus[0]
          ? { skus: { update: { where: { id: existing.skus[0].id }, data: { sellingPrice: input.sellingPrice } } } }
          : {}),
      },
      include: productInclude,
    });
      if (input.sellingPrice != null) {
        await this.audit.log(
          {
            actorId,
            action: 'price.change',
            entityType: 'product',
            entityId: id,
            before: { sellingPrice: money(existing.skus[0]?.sellingPrice) },
            after: { sellingPrice: input.sellingPrice.toFixed(2) },
          },
          tx,
        );
      }
      await this.outbox.append(tx, {
        aggregateType: 'product',
        aggregateId: updated.id,
        eventType: 'product.updated',
        payload: { productId: updated.id, status: updated.status },
      });
      return updated;
    });
    return presentProduct(product);
  }

  async addMedia(productId: string, url: string, alt: string | undefined, actorId: string) {
    if (!url.startsWith('https://')) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Photo URL must use https');
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Product was not found');
    const media = await this.prisma.productMedia.create({ data: { productId, url, alt } });
    await this.audit.log({ actorId, action: 'product.media', entityType: 'product', entityId: productId, after: { url } });
    return media;
  }

  async addCrossReference(productId: string, fromNumber: string, toNumber: string, relation: string) {
    const from = await this.partOnProduct(productId, fromNumber);
    const to = await this.prisma.partNumber.findFirst({ where: { normalized: normalizePartNumber(toNumber) } });
    if (!to) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The replacement part number is not in the catalogue');
    if (from.id === to.id) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'A part cannot cross-reference itself');
    return this.prisma.partCrossReference.create({ data: { fromPartNumberId: from.id, toPartNumberId: to.id, relation } });
  }

  async importCsv(csv: string, actorId: string) {
    const rows = parseCsv(csv);
    if (!rows.length) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'The CSV has no product rows');
    const prepared: z.infer<typeof productWriteSchema>[] = [];
    const errors: string[] = [];
    for (const [index, row] of rows.entries()) {
      const manufacturer = await this.prisma.manufacturer.findFirst({ where: { name: { equals: row.manufacturerName, mode: 'insensitive' } } });
      const category = await this.prisma.category.findUnique({ where: { slug: row.categorySlug } });
      if (!manufacturer || !category) {
        errors.push(`Row ${index + 2}: unknown manufacturer or category`);
        continue;
      }
      const price = Number(row.sellingPrice);
      const stock = Number(row.stockQty || 0);
      if (!row.name || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
        errors.push(`Row ${index + 2}: name, selling price, and stock quantity are required`);
        continue;
      }
      prepared.push({
        name: row.name,
        manufacturerId: manufacturer.id,
        categoryId: category.id,
        sellingPrice: price,
        stockQty: stock,
        weightG: 0,
        condition: 'new',
        warrantyMonths: 0,
        status: 'draft',
        partNumbers: row.partNumber ? [{ number: row.partNumber, type: row.partType === 'OEM' || row.partType === 'MPN' ? row.partType : 'AFTERMARKET' }] : [],
      });
    }
    if (errors.length) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'The CSV was not imported', errors);
    const created = [];
    for (const row of prepared) created.push(await this.create(row, actorId));
    return { imported: created.length, products: created.map((product) => product.id) };
  }

  private async partOnProduct(productId: string, number: string) {
    const part = await this.prisma.partNumber.findFirst({ where: { productId, normalized: normalizePartNumber(number) } });
    if (!part) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'That part number is not on this product');
    return part;
  }
}

function parseCsv(csv: string) {
  const [header, ...lines] = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!header) return [];
  const columns = header.split(',').map((column) => column.trim());
  return lines.map((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const row: Record<string, string> = {};
    columns.forEach((column, index) => { row[column] = cells[index] ?? ''; });
    return row as { name: string; manufacturerName: string; categorySlug: string; sellingPrice: string; stockQty: string; partNumber: string; partType: string };
  });
}

function skuAvailable(
  product: { vendor: { id: string; fulfilmentMode: string } | null },
  sku: {
    inventory: { onHandQty: number; reservedQty: number }[];
    vendorStock: { vendorId: string; onHandQty: number; reservedQty: number }[];
  },
) {
  if (product.vendor?.fulfilmentMode === 'vendor') {
    return sku.vendorStock
      .filter((row) => row.vendorId === product.vendor?.id)
      .reduce((sum, row) => sum + (row.onHandQty - row.reservedQty), 0);
  }
  return sku.inventory.reduce((sum, row) => sum + (row.onHandQty - row.reservedQty), 0);
}

export function presentProduct(product: Prisma.ProductGetPayload<{ include: typeof productInclude }>) {
  const store = product.vendor?.status === 'approved'
    ? {
        slug: product.vendor.slug,
        businessName: product.vendor.businessName,
        logoUrl: product.vendor.logoUrl,
        ratingAvg: money(product.vendor.ratingAvg),
        ratingCount: product.vendor.ratingCount,
        fulfilmentMode: product.vendor.fulfilmentMode,
      }
    : null;
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    status: product.status,
    condition: product.condition,
    warrantyMonths: product.warrantyMonths,
    originCountry: product.originCountry,
    attributes: product.attributes,
    manufacturer: { id: product.manufacturer.id, name: product.manufacturer.name, type: product.manufacturer.type },
    category: { id: product.category.id, name: product.category.name, slug: product.category.slug, path: product.category.path },
    partNumbers: product.partNumbers.map((part) => ({ number: part.number, normalized: part.normalized, type: part.type })),
    media: product.media.map((item) => ({ url: item.url, alt: item.alt })),
    store,
    skus: product.skus.map((sku) => {
      const qty = skuAvailable(product, sku);
      return {
        id: sku.id,
        sku: sku.sku,
        price: { amount: money(sku.sellingPrice), currency: sku.currencyCode },
        weightG: sku.weightG,
        availability: {
          status: qty > 0 ? 'in_stock' : 'out_of_stock',
          qty,
        },
      };
    }),
    fitmentStatus: null as FitmentStatus | null,
  };
}
