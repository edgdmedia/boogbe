import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { PreviewTemplateInput, TemplateKeyEnum, UpdateTemplateInput, type TemplateKey } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { TemplatesService } from './templates.service';

class UpdateTemplateDto extends createZodDto(UpdateTemplateInput) {}
class PreviewTemplateDto extends createZodDto(PreviewTemplateInput) {}

@Controller('templates')
export class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  @Get()
  @Permission('messages.read')
  list(@Ctx() c: RequestCtx) {
    return this.svc.list(requireOrg(c));
  }

  // Declared before `PUT :key` so `preview` is never read as a template key.
  @Post('preview')
  @HttpCode(200)
  @Permission('messages.read')
  preview(@Ctx() c: RequestCtx, @Body() b: PreviewTemplateDto) {
    return this.svc.preview(requireOrg(c), b);
  }

  @Put(':key')
  @Permission('templates.write')
  update(
    @Ctx() c: RequestCtx,
    @Param('key', new ZodValidationPipe(TemplateKeyEnum)) key: TemplateKey,
    @Body() b: UpdateTemplateDto,
  ) {
    return this.svc.update(requireOrg(c), key, b);
  }
}
