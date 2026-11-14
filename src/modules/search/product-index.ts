import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const include = {
  manufacturer: true,
  skus: true,
  partNumbers: true,
  category: true,
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductIndex {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async upsert(productId: string) {
    const node = this.node();
    const product = await this.prisma.product.findUnique({ where: { id: productId }, include });
    if (!product || !node) return;
    const response = await fetch(`${node}/promec_products/_doc/${product.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: product.name,
        slug: product.slug,
        status: product.status,
        manufacturer: product.manufacturer.name,
        category: product.category.slug,
        sku: product.skus.map((sku) => sku.sku),
        partNumbers: product.partNumbers.map((part) => part.normalized),
      }),
    });
    if (!response.ok) throw new Error(`OpenSearch index failed with ${response.status}`);
  }

  async findIds(q: string, from: number, size: number): Promise<{ ids: string[]; total: number } | null> {
    const node = this.node();
    if (!node) return null;
    const response = await fetch(`${node}/promec_products/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        size,
        query: { multi_match: { query: q, fields: ['name^3', 'manufacturer', 'partNumbers', 'sku', 'slug'] } },
      }),
    });
    if (!response.ok) throw new Error(`OpenSearch query failed with ${response.status}`);
    const json = (await response.json()) as { hits?: { total?: { value?: number }; hits?: { _id: string }[] } };
    return {
      ids: json.hits?.hits?.map((hit) => hit._id) ?? [],
      total: json.hits?.total?.value ?? 0,
    };
  }

  private node() {
    const value = this.config.get<string>('OPENSEARCH_NODE') ?? '';
    return value ? value.replace(/\/$/, '') : '';
  }
}
