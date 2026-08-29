import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialPosterModule } from './social-poster.module';

async function bootstrap() {
  const logger = new Logger('SocialPosterBootstrap');
  const app = await NestFactory.create(SocialPosterModule);

  app.enableShutdownHooks();
  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || configService.get<number>('SOCIAL_POSTER_PORT') || 3001;

  await app.listen(port);
  logger.log(`🚀 [social-poster] microservice running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error bootstrapping social-poster:', err);
  process.exit(1);
});
