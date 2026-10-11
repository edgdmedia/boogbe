import { Module } from '@nestjs/common';
import { OwnersController } from './owners.controller';
import { OwnersService } from './owners.service';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';
import { OwnershipService } from './ownership.service';

@Module({
  controllers: [OwnersController, PropertiesController, UnitsController],
  providers: [OwnersService, PropertiesService, UnitsService, OwnershipService],
  exports: [OwnershipService, UnitsService],
})
export class InventoryModule {}
