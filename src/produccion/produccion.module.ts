import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduledProduct } from './scheduled-product.entity.js';
import { ProduccionService } from './produccion.service.js';
import { ProduccionController } from './produccion.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([ScheduledProduct])],
  providers: [ProduccionService],
  controllers: [ProduccionController],
})
export class ProduccionModule {}