import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../../env';
import { PrismaService } from '../db/prisma.service';
import { MAILER } from '../mail/mail.module';
import type { Mailer } from '../mail/mailer';
import { createAuth } from './auth';
import { AUTH } from './auth.tokens';

@Global()
@Module({
  providers: [
    {
      provide: AUTH,
      inject: [PrismaService, MAILER],
      useFactory: (prisma: PrismaService, mailer: Mailer) => createAuth({ prisma, mailer, env: loadEnv() }),
    },
  ],
  exports: [AUTH],
})
export class AuthModule {}
