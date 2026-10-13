import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { SessionGuard } from './common/auth/session.guard';
import { CryptoService } from './common/crypto.service';
import { DbService } from './common/db.service';
import { AllExceptionsFilter } from './common/errors';
import { RedisService } from './common/redis.service';
import { AuthController } from './modules/auth/auth.controller';
import { SessionService } from './modules/auth/session.service';
import { ClientsController } from './modules/clients/clients.controller';
import { DocumentsController } from './modules/documents/documents.controller';
import { DocumentsService } from './modules/documents/documents.service';
import { StorageService } from './modules/documents/storage.service';
import { DraftingController } from './modules/drafting/drafting.controller';
import { FinanceController } from './modules/finance/finance.controller';
import { HealthController } from './modules/health.controller';
import { MattersController } from './modules/matters/matters.controller';
import { PortalController } from './modules/portal/portal.controller';
import { RegistryController } from './modules/registry/registry.controller';
import { ReportsController } from './modules/reports/reports.controller';
import { ScheduleController } from './modules/schedule/schedule.controller';
import { UsersController } from './modules/users/users.controller';

/**
 * Monolit modular: satu aplikasi, batas modul per folder.
 * Modul tidak membaca tabel modul lain secara bebas kecuali lewat fungsi yang diekspor
 * (mis. setMatterStatus, assertMatterAccess, takeNextNumber).
 */
@Module({
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    ClientsController,
    MattersController,
    DraftingController,
    RegistryController,
    DocumentsController,
    FinanceController,
    ScheduleController,
    ReportsController,
    PortalController,
  ],
  providers: [
    DbService,
    CryptoService,
    RedisService,
    SessionService,
    StorageService,
    DocumentsService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
