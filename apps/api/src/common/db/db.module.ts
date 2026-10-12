import { Global, Module } from '@nestjs/common';
import { MemberNames } from './member-names';
import { OrgDb } from './org-db.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService, OrgDb, MemberNames], exports: [PrismaService, OrgDb, MemberNames] })
export class DbModule {}
