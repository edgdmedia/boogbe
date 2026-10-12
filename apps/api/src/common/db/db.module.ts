import { Global, Module } from '@nestjs/common';
import { MemberNames } from './member-names';
import { OrgInfo } from './org-info';
import { OrgDb } from './org-db.service';
import { PrismaService } from './prisma.service';
import { UserNames } from './user-names';

@Global()
@Module({
  providers: [PrismaService, OrgDb, MemberNames, UserNames, OrgInfo],
  exports: [PrismaService, OrgDb, MemberNames, UserNames, OrgInfo],
})
export class DbModule {}
