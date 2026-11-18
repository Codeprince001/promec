import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule, ObserveInstrument } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true, instrument: ObserveInstrument });
  app.use(cookieParser());
  app.enableCors({
    origin: [process.env.APP_URL ?? 'http://localhost:3000', process.env.ADMIN_URL ?? 'http://localhost:3001'],
    credentials: true,
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'docs'] });
  const config = new DocumentBuilder()
    .setTitle('PROMEC API')
    .setDescription('Automotive parts commerce API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(process.env.PORT ?? 4000);
}
void bootstrap();
