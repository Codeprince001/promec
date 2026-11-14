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

const productInclude = {
  manufacturer: true,
  category: true,
  skus: { include: { inventory: true } },
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

  async list(query: { page: number; pageSize: number; category?: string; q?: string }) {
    const where: Prisma.ProductWhereInput = {
      status: 'published',
      deletedAt: null,
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
}

export function presentProduct(product: Prisma.ProductGetPayload<{ include: typeof productInclude }>) {
  const available = product.skus.reduce(
    (sum, sku) => sum + sku.inventory.reduce((inner, row) => inner + (row.onHandQty - row.reservedQty), 0),
    0,
  );
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
    skus: product.skus.map((sku) => ({
      id: sku.id,
      sku: sku.sku,
      price: { amount: money(sku.sellingPrice), currency: sku.currencyCode },
      weightG: sku.weightG,
      availability: {
        status: available > 0 ? 'in_stock' : 'out_of_stock',
        qty: sku.inventory.reduce((sum, row) => sum + (row.onHandQty - row.reservedQty), 0),
      },
    })),
    fitmentStatus: null as FitmentStatus | null,
  };
}
