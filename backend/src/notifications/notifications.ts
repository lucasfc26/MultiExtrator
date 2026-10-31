import { Controller, Get, Global, Injectable, Module, Param, ParseUUIDPipe, Post, Query, HttpCode } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { NotificationType, type Notification } from '@prisma/client'
import { Type } from 'class-transformer'
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { CurrentUser, pageArgs, paginated, type AuthUser } from '../common/http'

/** Canal de cada tipo nas preferências do usuário. */
const EMAIL_PREF: Record<NotificationType, 'emailExtraction' | 'emailCredits' | 'emailSecurity'> = {
  EXTRACTION_COMPLETED: 'emailExtraction',
  EXTRACTION_FAILED: 'emailExtraction',
  FILES_EXPIRING: 'emailExtraction',
  CREDITS_LOW: 'emailCredits',
  PURCHASE_CONFIRMED: 'emailCredits',
  PAYMENT_PENDING: 'emailCredits',
  PAYMENT_DECLINED: 'emailCredits',
  SECURITY: 'emailSecurity',
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Persiste a notificação e, se o usuário quiser, envia por e-mail. */
  async notify(userId: string, type: NotificationType, title: string, body: string, link?: string) {
    const settings = await this.prisma.userSettings.findUnique({ where: { userId }, include: { user: true } })
    const isExtraction = type === 'EXTRACTION_COMPLETED' || type === 'EXTRACTION_FAILED'
    if (!isExtraction || settings?.inAppExtraction !== false) {
      await this.prisma.notification.create({ data: { userId, type, title, body, link } })
    }
    if (settings && settings[EMAIL_PREF[type]]) {
      await this.mail.send(settings.user.email, title, `${body}${link ? `\n\n${this.mail.link(link)}` : ''}`)
    }
  }
}

export function toNotificationDto(n: Notification) {
  return {
    id: n.id,
    type: n.type.toLowerCase(),
    title: n.title,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
    read: !!n.readAt,
    link: n.link,
    demo: false,
  }
}

class ListQuery {
  @IsOptional() @IsIn(['true', 'false']) unread?: string
  @IsOptional() @IsEnum(Object.values(NotificationType).map((t) => t.toLowerCase())) type?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
}

@ApiTags('notificações')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    const { skip, take, page, pageSize } = pageArgs(q.page, q.pageSize)
    const where = {
      userId: user.id,
      ...(q.unread === 'true' ? { readAt: null } : {}),
      ...(q.type ? { type: q.type.toUpperCase() as NotificationType } : {}),
    }
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ])
    return { ...paginated(items.map(toNotificationDto), total, page, pageSize), unread }
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } })
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } })
  }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
