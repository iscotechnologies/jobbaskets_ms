import { Module } from '@nestjs/common';
import { SocialPostStateService } from './social-post-state.service';
import { RedisModule } from '@app/common';

@Module({
  imports: [RedisModule],
  providers: [SocialPostStateService],
  exports: [SocialPostStateService],
})
export class StateModule {}
