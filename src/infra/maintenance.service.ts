import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InventoryService } from '../modules/inventory/inventory.service';
import { VendorCommerceService } from '../modules/vendors/vendor-commerce.service';
import { NotificationsService } from '../modules/notifications/notifications.service';

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationsService,
    private readonly vendors: VendorCommerceService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => {
      void this.expireReservations();
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async expireReservations() {
    const expired = await this.inventory.expireReservations();
    if (expired) this.logger.log(`Expired ${expired} stock reservations`);
    await this.vendors.expireReservations();
    await this.notifications.dispatchQueued();
  }
}
