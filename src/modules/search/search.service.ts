import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { pageMeta } from '../../common/pagination';
import { decideFitment } from '../../domain/fitment';
import { looksLikePartNumber, normalizePartNumber } from '../../domain/part-number';
import { OutboxService } from '../../infra/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { presentProduct, productInclude } from '../catalogue/catalogue.service';
import { CompatibilityService } from '../compatibility/compatibility.service';
import { ProductIndex } from './product-index';

@Injectable()
export class SearchService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compatibility: CompatibilityService,
    private readonly outbox: OutboxService,
    private readonly index: ProductIndex,
  ) {}

  onModuleInit() {
    this.outbox.register('product.updated', async (payload) => {
      if (typeof payload.productId === 'string') await this.index.upsert(payload.productId);
    });
  }

  async search(query: { q?: string; vehicleVariantId?: string; year?: number; category?: string; page: number; pageSize: number; sort?: string }) {
    if (query.q && !query.vehicleVariantId) {
      try {
        const indexed = await this.index.findIds(query.q, (query.page - 1) * query.pageSize, query.pageSize);
        if (indexed) {
          if (!indexed.ids.length) return { data: [], meta: pageMeta(query.page, query.pageSize, indexed.total) };
          const rows = await this.prisma.product.findMany({
            where: { id: { in: indexed.ids }, status: 'published', deletedAt: null },
            include: productInclude,
          });
          const byId = new Map(rows.map((row) => [row.id, row]));
          const results = indexed.ids.flatMap((id) => {
            const row = byId.get(id);
            return row ? [presentProduct(row)] : [];
          });
          return { data: results, meta: pageMeta(query.page, query.pageSize, indexed.total) };
        }
      } catch {
        // Postgres remains the query path when the index is unavailable.
      }
    }
    const normalized = query.q ? normalizePartNumber(query.q) : undefined;
    const where: Prisma.ProductWhereInput = {
      status: 'published',
      deletedAt: null,
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.q
        ? looksLikePartNumber(query.q)
          ? { partNumbers: { some: { normalized: { contains: normalized } } } }
          : {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { manufacturer: { name: { contains: query.q, mode: 'insensitive' } } },
                { partNumbers: { some: { normalized: { contains: normalized } } } },
              ],
            }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: query.sort === 'newest' ? { createdAt: 'desc' } : { name: 'asc' },
      }),
      this.prisma.product.count({ where }),
    ]);
    let results = rows.map(presentProduct);
    if (query.vehicleVariantId) {
      const variant = await this.prisma.vehicleVariant.findUnique({
        where: { id: query.vehicleVariantId },
        include: { model: true },
      });
      if (variant) {
        const grouped = await this.compatibility.rowsForProducts(
          rows.map((row) => row.id),
          variant.id,
          variant.modelId,
          variant.model.makeId,
        );
        results = results.map((product) => {
          const decision = decideFitment(grouped.get(product.id) ?? [], {
            id: variant.id,
            modelId: variant.modelId,
            makeId: variant.model.makeId,
            engineId: variant.engineId,
            yearFrom: variant.yearFrom,
            yearTo: variant.yearTo,
          }, query.year);
          return { ...product, fitmentStatus: decision.status, fitmentNotes: decision.notes };
        });
        const rank = { confirmed: 0, probable: 1, unverified: 2, incompatible: 3 };
        if (!query.sort || query.sort === 'relevance') {
          results.sort((a, b) => rank[a.fitmentStatus ?? 'unverified'] - rank[b.fitmentStatus ?? 'unverified']);
        }
      }
    }
    if (query.sort === 'price_asc' || query.sort === 'price_desc') {
      results.sort((a, b) => {
        const left = Number(a.skus[0]?.price.amount ?? 0);
        const right = Number(b.skus[0]?.price.amount ?? 0);
        return query.sort === 'price_asc' ? left - right : right - left;
      });
    }
    return { data: results, meta: pageMeta(query.page, query.pageSize, total) };
  }

  async suggest(q: string) {
    const normalized = normalizePartNumber(q);
    const [products, parts, vehicles] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: 'published', name: { contains: q, mode: 'insensitive' } },
        take: 5,
        select: { id: true, name: true, slug: true },
      }),
      this.prisma.partNumber.findMany({
        where: { normalized: { contains: normalized } },
        take: 5,
        include: { product: { select: { slug: true, name: true } } },
      }),
      this.prisma.vehicleModel.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        take: 5,
        include: { make: true },
      }),
    ]);
    return {
      parts: products,
      partNumbers: parts.map((part) => ({ number: part.number, type: part.type, productSlug: part.product.slug, productName: part.product.name })),
      vehicles: vehicles.map((model) => ({ id: model.id, label: `${model.make.name} ${model.name}` })),
    };
  }
}
