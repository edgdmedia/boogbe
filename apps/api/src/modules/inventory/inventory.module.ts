import { Module } from '@nestjs/common';
import { OwnersController } from './owners.controller';
import { OwnersService } from './owners.service';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';
import { OwnershipService } from './ownership.service';
import { FeesController } from './fees.controller';
import { FeesService } from './fees.service';
import { BlocksController } from './blocks.controller';
import { BlocksService } from './blocks.service';

@Module({
  controllers: [OwnersController, PropertiesController, UnitsController, FeesController, BlocksController],
  providers: [OwnersService, PropertiesService, UnitsService, OwnershipService, FeesService, BlocksService],
  exports: [OwnershipService, UnitsService, BlocksService],
})
export class InventoryModule {}
