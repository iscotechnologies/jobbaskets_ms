import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JobBannerService } from './job-banner.service';

@Module({
  imports: [ConfigModule],
  providers: [JobBannerService],
  exports: [JobBannerService],
})
export class BannerModule {}
