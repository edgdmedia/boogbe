import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../../env';
import { MemoryMailer, ResendMailer } from './mailer';

export const MAILER = 'BOOGBE_MAILER';

@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      useFactory: () => {
        const env = loadEnv();
        return env.RESEND_API_KEY && env.NODE_ENV !== 'test' && process.env.E2E !== '1'
          ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM)
          : new MemoryMailer();
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
