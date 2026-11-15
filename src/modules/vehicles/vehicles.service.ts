import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../../common/api.exception';
import { assertVin, matchVariant } from '../../domain/commerce';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  makes() {
    return this.prisma.vehicleMake.findMany({ orderBy: { name: 'asc' } });
  }

  models(makeId: string) {
    return this.prisma.vehicleModel.findMany({ where: { makeId }, orderBy: { name: 'asc' } });
  }

  async years(modelId: string) {
    const model = await this.prisma.vehicleModel.findUnique({ where: { id: modelId } });
    if (!model) throw new ApiException(HttpStatus.NOT_FOUND, 'MODEL_NOT_FOUND', 'Vehicle model was not found');
    const years: number[] = [];
    for (let year = model.yearFrom; year <= model.yearTo; year += 1) years.push(year);
    return years;
  }

  async engines(modelId: string, year?: number) {
    const variants = await this.prisma.vehicleVariant.findMany({
      where: {
        modelId,
        ...(year ? { yearFrom: { lte: year }, yearTo: { gte: year } } : {}),
        engineId: { not: null },
      },
      include: { engine: true },
    });
    const seen = new Map<string, { id: string; code: string; fuelType: string | null; displacementCc: number | null }>();
    for (const variant of variants) {
      if (variant.engine && !seen.has(variant.engine.id)) {
        seen.set(variant.engine.id, {
          id: variant.engine.id,
          code: variant.engine.code,
          fuelType: variant.engine.fuelType,
          displacementCc: variant.engine.displacementCc,
        });
      }
    }
    return [...seen.values()];
  }

  variants(modelId: string, year?: number, engineId?: string) {
    return this.prisma.vehicleVariant.findMany({
      where: {
        modelId,
        ...(engineId ? { engineId } : {}),
        ...(year ? { yearFrom: { lte: year }, yearTo: { gte: year } } : {}),
      },
      include: { engine: true, model: { include: { make: true } } },
      orderBy: { trim: 'asc' },
    });
  }

  async getVariant(id: string) {
    const variant = await this.prisma.vehicleVariant.findUnique({
      where: { id },
      include: { engine: true, model: { include: { make: true } } },
    });
    if (!variant) throw new ApiException(HttpStatus.NOT_FOUND, 'VARIANT_NOT_FOUND', 'Vehicle variant was not found');
    return variant;
  }

  async decode(vin: string) {
    let normalized: string;
    try {
      normalized = assertVin(vin);
    } catch (error) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid VIN');
    }
    const base = (this.config.get<string>('VIN_DECODE_URL') || 'https://vpic.nhtsa.dot.gov/api').replace(/\/$/, '');
    const response = await fetch(`${base}/vehicles/DecodeVinValues/${normalized}?format=json`, { signal: AbortSignal.timeout(15_000) });
    const json = (await response.json().catch(() => ({}))) as { Results?: Record<string, string>[] };
    const row = json.Results?.[0];
    const year = Number(row?.ModelYear);
    if (!response.ok || !row?.Make || !row.Model || !Number.isInteger(year)) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, 'GATEWAY_ERROR', 'The VIN could not be decoded');
    }
    const litres = Number(row.DisplacementL);
    const displacementCc = Number.isFinite(litres) && litres > 0 ? Math.round(litres * 1000) : null;
    const variants = await this.prisma.vehicleVariant.findMany({
      where: {
        yearFrom: { lte: year },
        yearTo: { gte: year },
        model: { name: { contains: row.Model, mode: 'insensitive' }, make: { name: { equals: row.Make, mode: 'insensitive' } } },
      },
      include: { engine: true, model: { include: { make: true } } },
    });
    const variantId = matchVariant({
      make: row.Make,
      model: row.Model,
      year,
      displacementCc,
    }, variants.map((variant) => ({
      id: variant.id,
      make: variant.model.make.name,
      model: variant.model.name,
      yearFrom: variant.yearFrom,
      yearTo: variant.yearTo,
      displacementCc: variant.engine?.displacementCc ?? null,
    })));
    return {
      make: row.Make,
      model: row.Model,
      year,
      displacementCc,
      fuel: row.FuelTypePrimary || null,
      variantId,
      variant: variants.find((variant) => variant.id === variantId) ?? null,
    };
  }
}
