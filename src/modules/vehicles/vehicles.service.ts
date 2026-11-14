import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

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
}
