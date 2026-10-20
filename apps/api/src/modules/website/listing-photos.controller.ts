import { Body, Controller, Delete, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ListingPhotoAttach, ListingPhotoUpdate } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { ListingPhotosService } from './listing-photos.service';

class AttachDto extends createZodDto(ListingPhotoAttach) {}
class PhotoPatchDto extends createZodDto(ListingPhotoUpdate) {}
class PhotoOrderDto extends createZodDto(z.object({ ids: z.array(z.string()).min(1).max(60) })) {}
class CoverDto extends createZodDto(z.object({ photoId: z.string() })) {}

// Photo endpoints hang off listings; every route here is a website write (inventory.write).
@Controller('listings')
export class ListingPhotosController {
  constructor(private readonly svc: ListingPhotosService) {}

  @Post(':id/photos')
  @Permission('inventory.write')
  attach(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: AttachDto) {
    return this.svc.attach(requireOrg(c), id, b);
  }

  @Put(':id/photos/order')
  @HttpCode(200)
  @Permission('inventory.write')
  order(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: PhotoOrderDto) {
    return this.svc.reorder(requireOrg(c), id, b.ids);
  }

  @Patch(':id/photos/:photoId')
  @Permission('inventory.write')
  patch(@Ctx() c: RequestCtx, @Param('id') id: string, @Param('photoId') photoId: string, @Body() b: PhotoPatchDto) {
    return this.svc.patch(requireOrg(c), id, photoId, b);
  }

  @Put(':id/cover')
  @HttpCode(200)
  @Permission('inventory.write')
  cover(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: CoverDto) {
    return this.svc.setCover(requireOrg(c), id, b.photoId);
  }

  @Delete(':id/photos/:photoId')
  @Permission('inventory.write')
  remove(@Ctx() c: RequestCtx, @Param('id') id: string, @Param('photoId') photoId: string) {
    return this.svc.remove(requireOrg(c), id, photoId);
  }
}
