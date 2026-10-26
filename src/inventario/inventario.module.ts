import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryItem } from './inventory-item.entity.js';
import { InventarioService } from './inventario.service.js';
import { InventarioController } from './inventario.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryItem])],
  providers: [InventarioService],
  controllers: [InventarioController],
})
export class InventarioModule {}