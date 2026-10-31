import 'dotenv/config'
import 'reflect-metadata'
import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'
import { loadEnv } from './config/env'

async function bootstrap() {
  const env = loadEnv()
  // rawBody: a assinatura dos webhooks de pagamento é calculada sobre os bytes recebidos.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })
  app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(cookieParser())
  app.setGlobalPrefix(env.API_PREFIX)
  app.enableCors({
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  })
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }),
  )
  app.enableShutdownHooks()

  const doc = new DocumentBuilder()
    .setTitle('Fatturas API')
    .setDescription(
      'API da plataforma Fatturas. Autenticação por sessão (cookies HttpOnly) no painel, ou por API key ' +
        '(`Authorization: Bearer ftt_live_...` ou `X-API-Key`) nas rotas de faturas, extrator e créditos.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'API key (ftt_live_...)' }, 'api-key')
    .addCookieAuth('ftt_at')
    .build()
  SwaggerModule.setup(`${env.API_PREFIX}/docs`, app, () => SwaggerModule.createDocument(app, doc), {
    jsonDocumentUrl: `${env.API_PREFIX}/openapi.json`,
  })

  await app.listen(env.PORT, '0.0.0.0')
  Logger.log(`API em http://localhost:${env.PORT}/${env.API_PREFIX} · docs em /${env.API_PREFIX}/docs`, 'Bootstrap')
}

void bootstrap()
