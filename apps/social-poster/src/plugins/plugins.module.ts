import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SOCIAL_PLUGINS_TOKEN } from './plugin.interface';
import { PluginRegistry } from './plugin.registry';
import { LinkedInPlugin } from './linkedin/linkedin.plugin';
import { LinkedInRestClient } from './linkedin/linkedin-rest.client';
import { TelegramPlugin } from './telegram/telegram.plugin';
import { TelegramBotClient } from './telegram/telegram-bot.client';
import { FacebookPlugin } from './facebook/facebook.plugin';
import { FacebookGraphClient } from './facebook/facebook-graph.client';
import { InstagramPlugin } from './instagram/instagram.plugin';
import { InstagramGraphClient } from './instagram/instagram-graph.client';
import { BannerModule } from '../banner/banner.module';

@Module({
  imports: [ConfigModule, BannerModule],
  providers: [
    LinkedInRestClient,
    LinkedInPlugin,
    TelegramBotClient,
    TelegramPlugin,
    FacebookGraphClient,
    FacebookPlugin,
    InstagramGraphClient,
    InstagramPlugin,
    {
      provide: SOCIAL_PLUGINS_TOKEN,
      useFactory: (
        linkedIn: LinkedInPlugin,
        telegram: TelegramPlugin,
        facebook: FacebookPlugin,
        instagram: InstagramPlugin,
      ) => {
        return [linkedIn, telegram, facebook, instagram];
      },
      inject: [LinkedInPlugin, TelegramPlugin, FacebookPlugin, InstagramPlugin],
    },
    PluginRegistry,
  ],
  exports: [PluginRegistry, BannerModule],
})
export class PluginsModule {}
