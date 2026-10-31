import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AppConfigModule } from './config/config.module'
import { PrismaModule } from './prisma/prisma.service'
import { MailModule } from './mail/mail.service'
import { AuditModule } from './audit/audit.service'
import { NotificationsModule } from './notifications/notifications'
import { CreditsModule } from './credits/credits.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { ApiKeysModule } from './api-keys/api-keys.module'
import { PaymentsModule } from './payments/payments.module'
import { StorageModule } from './storage/storage.module'
import { EngineModule } from './engine/worker.client'
import { InvoicesModule } from './invoices/invoices.module'
import { ExtractionsModule } from './extractions/extractions.module'
import { RetentionModule } from './retention/retention.service'
import { MiscModule } from './misc/misc.module'
import { HttpErrorFilter, RequestIdMiddleware } from './common/http'

@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
    // Limite geral por IP; rotas sensíveis (login, cadastro...) têm limites próprios.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    MailModule,
    AuditModule,
    NotificationsModule,
    CreditsModule,
    StorageModule,
    EngineModule,
    AuthModule,
    UsersModule,
    ApiKeysModule,
    PaymentsModule,
    InvoicesModule,
    ExtractionsModule,
    RetentionModule,
    MiscModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*path')
  }
}
