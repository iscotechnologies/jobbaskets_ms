import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { RedisModule } from '@app/common';
import { SocialPosterController } from './social-poster.controller';
import { SocialPosterService } from './social-poster.service';
import { QueueModule } from './queue/queue.module';
import { StateModule } from './state/state.module';
import { PluginsModule } from './plugins/plugins.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local', '../../.env'],
    }),
    RedisModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('REDIS_HOST', '127.0.0.1');
        const port = Number(config.get<number>('REDIS_PORT', 6379));
        const password = config.get<string>('REDIS_PASSWORD');
        const db = Number(config.get<number>('REDIS_DB', 0));
        const tlsEnabled = config.get<string>('REDIS_TLS') === 'true';

        return {
          connection: {
            host,
            port,
            password: password || undefined,
            db,
            tls: tlsEnabled ? {} : undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
        };
      },
    }),
    StateModule,
    PluginsModule,
    QueueModule,
  ],
  controllers: [SocialPosterController],
  providers: [SocialPosterService],
})
export class SocialPosterModule {}
