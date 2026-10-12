import { Global, Module } from '@nestjs/common';
import { MemberNames } from './member-names';
import { OrgDb } from './org-db.service';
import { PrismaService } from './prisma.service';
import { UserNames } from './user-names';

@Global()
@Module({ providers: [PrismaService, OrgDb, MemberNames, UserNames], exports: [PrismaService, OrgDb, MemberNames, UserNames] })
export class DbModule {}
