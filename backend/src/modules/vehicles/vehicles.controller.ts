import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { FieldCipher } from '../../common/crypto/field-cipher.service';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VehiclesService } from './vehicles.service';

const makeQuery = z.object({ makeId: z.string().uuid() });
const modelQuery = z.object({ modelId: z.string().uuid(), year: z.coerce.number().int().optional(), engineId: z.string().uuid().optional() });
const garageSchema = z.object({
  vehicleVariantId: z.string().uuid(),
  nickname: z.string().max(80).optional(),
  year: z.number().int().min(1950).max(2100).optional(),
  vin: z.string().min(11).max(17).optional(),
  plate: z.string().min(2).max(20).optional(),
  isDefault: z.boolean().optional(),
});

@ApiTags('vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Public()
  @Get('makes')
  makes() {
    return this.vehicles.makes();
  }

  @Public()
  @Get('models')
  models(@Query({ schema: makeQuery }) query: z.infer<typeof makeQuery>) {
    return this.vehicles.models(query.makeId);
  }

  @Public()
  @Get('years')
  years(@Query({ schema: z.object({ modelId: z.string().uuid() }) }) query: { modelId: string }) {
    return this.vehicles.years(query.modelId);
  }

  @Public()
  @Get('engines')
  engines(@Query({ schema: modelQuery }) query: z.infer<typeof modelQuery>) {
    return this.vehicles.engines(query.modelId, query.year);
  }

  @Public()
  @Get('variants')
  variants(@Query({ schema: modelQuery }) query: z.infer<typeof modelQuery>) {
    return this.vehicles.variants(query.modelId, query.year, query.engineId);
  }

  @Public()
  @Post('decode')
  decode(@Body({ schema: z.object({ vin: z.string().min(11).max(17) }) }) body: { vin: string }) {
    return this.vehicles.decode(body.vin);
  }

  @Public()
  @Get('variants/:id')
  variant(@Param('id') id: string) {
    return this.vehicles.getVariant(id);
  }
}

@ApiTags('garage')
@Controller('garage')
export class GarageController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly vehicles: VehiclesService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const customer = await this.requireCustomer(user.sub);
    const rows = await this.prisma.customerVehicle.findMany({
      where: { customerId: customer.id },
      include: { variant: { include: { engine: true, model: { include: { make: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(presentGarage);
  }

  @Post()
  async add(@CurrentUser() user: AuthUser, @Body({ schema: garageSchema }) body: z.infer<typeof garageSchema>) {
    const customer = await this.requireCustomer(user.sub);
    if (body.isDefault) {
      await this.prisma.customerVehicle.updateMany({ where: { customerId: customer.id }, data: { isDefault: false } });
    }
    const created = await this.prisma.customerVehicle.create({
      data: {
        customerId: customer.id,
        vehicleVariantId: body.vehicleVariantId,
        nickname: body.nickname,
        year: body.year,
        isDefault: body.isDefault,
        vinEnc: body.vin ? this.cipher.encrypt(body.vin) : undefined,
        plateEnc: body.plate ? this.cipher.encrypt(body.plate) : undefined,
      },
    });
    return presentGarage(created);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: garageSchema.partial() }) body: Partial<z.infer<typeof garageSchema>>,
  ) {
    const customer = await this.requireCustomer(user.sub);
    const row = await this.owned(customer.id, id);
    if (body.isDefault) {
      await this.prisma.customerVehicle.updateMany({ where: { customerId: customer.id }, data: { isDefault: false } });
    }
    const updated = await this.prisma.customerVehicle.update({
      where: { id: row.id },
      data: {
        vehicleVariantId: body.vehicleVariantId,
        nickname: body.nickname,
        year: body.year,
        isDefault: body.isDefault,
        ...(body.vin ? { vinEnc: this.cipher.encrypt(body.vin) } : {}),
        ...(body.plate ? { plateEnc: this.cipher.encrypt(body.plate) } : {}),
      },
    });
    return presentGarage(updated);
  }

  @Post(':id/decode')
  async decodeSaved(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ apply: z.boolean().default(false) }) }) body: { apply: boolean },
  ) {
    const customer = await this.requireCustomer(user.sub);
    const row = await this.owned(customer.id, id);
    if (!row.vinEnc) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'This vehicle has no VIN stored');
    const decoded = await this.vehicles.decode(this.cipher.decrypt(row.vinEnc));
    if (body.apply && decoded.variantId) {
      await this.prisma.customerVehicle.update({ where: { id: row.id }, data: { vehicleVariantId: decoded.variantId, year: decoded.year } });
    }
    return decoded;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const customer = await this.requireCustomer(user.sub);
    const row = await this.owned(customer.id, id);
    await this.prisma.customerVehicle.delete({ where: { id: row.id } });
    return { deleted: true };
  }

  private async requireCustomer(userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new ApiException(HttpStatus.FORBIDDEN, 'CUSTOMER_REQUIRED', 'A customer profile is required');
    return customer;
  }

  private async owned(customerId: string, id: string) {
    const row = await this.prisma.customerVehicle.findFirst({ where: { id, customerId } });
    if (!row) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Saved vehicle was not found');
    return row;
  }
}

function presentGarage<T extends { vinEnc: string | null; plateEnc: string | null }>(row: T) {
  const { vinEnc, plateEnc, ...rest } = row;
  return { ...rest, hasVin: Boolean(vinEnc), hasPlate: Boolean(plateEnc) };
}
