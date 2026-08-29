import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SOCIAL_POST_QUEUE } from '@app/common';
import { SocialPostProcessor } from './social-post.processor';
import { SocialPostQueueService } from './social-post.queue.service';
import { StateModule } from '../state/state.module';
import { PluginsModule } from '../plugins/plugins.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: SOCIAL_POST_QUEUE,
    }),
    StateModule,
    PluginsModule,
  ],
  providers: [SocialPostProcessor, SocialPostQueueService],
  exports: [SocialPostQueueService],
})
export class QueueModule {}
