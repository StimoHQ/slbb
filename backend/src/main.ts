import { NestFactory } from '@nestjs/core';
import { AppModule } from './core/app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger();

  // Get configs
  const config = app.get(ConfigService);

  // Swagger config
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Simple Language Barrier Breaker API')
    .setDescription('API for SLBB project services')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('/docs', app, swaggerDocument, {
    yamlDocumentUrl: '/openapi.yaml',
    jsonDocumentUrl: '/openapi.json',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Удаляет из запроса поля, не описанные в DTO
      transform: true, // Автоматически преобразует типы данных согласно DTO
    }),
  );

  const port = config.getOrThrow<number>('HTTP_PORT');
  const host = config.getOrThrow<string>('HTTP_HOST');

  await app.listen(port);

  logger.log(`Server has been started at: http://${host}:${port}`);
  logger.log(`Swagger at: http://${host}:${port}/docs`);
}
bootstrap();
