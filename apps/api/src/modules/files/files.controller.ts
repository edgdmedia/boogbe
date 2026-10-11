import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { PresignInput } from '@boogbe/shared';
import { Ctx, SignedIn } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { FilesService } from '../../common/files/files.service';

class PresignDto extends createZodDto(PresignInput) {}

/** @SignedIn: the permission depends on the file kind, checked inside FilesService. */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('presign')
  @SignedIn()
  presign(@Ctx() c: RequestCtx, @Body() b: PresignDto) {
    return this.files.presign(requireOrg(c), b);
  }

  @Post(':id/confirm')
  @SignedIn()
  @HttpCode(200)
  async confirm(@Ctx() c: RequestCtx, @Param('id') id: string) {
    await this.files.confirm(requireOrg(c), id);
    return { ok: true };
  }

  @Get(':id/url')
  @SignedIn()
  url(@Ctx() c: RequestCtx, @Param('id') id: string, @Query('filename') filename?: string) {
    return this.files.urlFor(requireOrg(c), id, filename);
  }
}
