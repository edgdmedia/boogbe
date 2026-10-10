import { Global, Module } from '@nestjs/common';
import { OrgDb } from './org-db.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService, OrgDb], exports: [PrismaService, OrgDb] })
export class DbModule {}
