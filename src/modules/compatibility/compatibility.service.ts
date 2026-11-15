import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api.exception';
import { decideFitment, type FitmentResult, type FitmentRow } from '../../domain/fitment';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { VehiclesService } from '../vehicles/vehicles.service';

@Injectable()
export class CompatibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehiclesService,
    private readonly analytics: AnalyticsService,
  ) {}

  async check(productId: string, variantId: string, year?: number): Promise<FitmentResult> {
    const variant = await this.vehicles.getVariant(variantId);
    const rows = await this.rowsForProducts([productId], variant.id, variant.modelId, variant.model.makeId);
    const result = decideFitment(rows.get(productId) ?? [], {
      id: variant.id,
      modelId: variant.modelId,
      makeId: variant.model.makeId,
      engineId: variant.engineId,
      yearFrom: variant.yearFrom,
      yearTo: variant.yearTo,
    }, year);
    await this.analytics.record('fitment', 0, { productId, variantId, status: result.status });
    return result;
  }

  async checkMany(items: { productId: string; vehicleVariantId: string }[]) {
    const results = [];
    for (const item of items) {
      results.push({ ...item, ...(await this.check(item.productId, item.vehicleVariantId)) });
    }
    return results;
  }

  async rowsForProducts(productIds: string[], variantId: string, modelId: string, makeId: string) {
    const rows = await this.prisma.vehicleCompatibility.findMany({
      where: {
        productId: { in: productIds },
        OR: [{ vehicleVariantId: variantId }, { vehicleVariantId: null, modelId }, { vehicleVariantId: null, modelId: null, makeId }],
      },
    });
    const grouped = new Map<string, FitmentRow[]>();
    for (const row of rows) {
      const list = grouped.get(row.productId) ?? [];
      list.push(toRow(row));
      grouped.set(row.productId, list);
    }
    return grouped;
  }

  async create(input: {
    productId: string;
    vehicleVariantId?: string;
    status: 'confirmed' | 'probable' | 'unverified' | 'incompatible';
    notes?: string;
    position?: string;
    sourceName?: string;
    actorId: string;
  }) {
    if (input.status === 'confirmed' && !input.sourceName) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT_DETECTED', 'Confirmed fitment needs a source');
    }
    const sourceRow = input.sourceName
      ? (await this.prisma.compatibilitySource.findFirst({ where: { name: input.sourceName } })) ??
        (await this.prisma.compatibilitySource.create({ data: { name: input.sourceName, type: 'manual' } }))
      : null;
    return this.prisma.vehicleCompatibility.create({
      data: {
        productId: input.productId,
        vehicleVariantId: input.vehicleVariantId,
        status: input.status,
        notes: input.notes,
        position: input.position,
        sourceId: sourceRow?.id,
        verifiedAt: input.status === 'confirmed' ? new Date() : null,
        approvedById: input.status === 'probable' ? input.actorId : null,
        confidence: input.status === 'confirmed' ? 1 : input.status === 'probable' ? 0.7 : 0,
      },
    });
  }
}

function toRow(row: Prisma.VehicleCompatibilityGetPayload<Record<string, never>>): FitmentRow {
  return {
    status: row.status,
    notes: row.notes,
    sourceId: row.sourceId,
    verifiedAt: row.verifiedAt,
    approvedById: row.approvedById,
    vehicleVariantId: row.vehicleVariantId,
    modelId: row.modelId,
    makeId: row.makeId,
    yearFrom: row.yearFrom,
    yearTo: row.yearTo,
    engineId: row.engineId,
    position: row.position,
    confidence: row.confidence ? Number(row.confidence) : null,
    validFrom: row.validFrom,
    validTo: row.validTo,
  };
}
