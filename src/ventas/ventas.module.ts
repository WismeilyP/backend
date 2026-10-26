import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Purchase } from './purchase.entity.js';
import { PurchasedPlan } from './purchased-plan.entity.js';
import { MasterDish } from '../recetas/master-dish.entity.js';
import { ScheduledProduct } from '../produccion/scheduled-product.entity.js';
import { VentasService } from './ventas.service.js';
import { VentasController } from './ventas.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Purchase, PurchasedPlan, MasterDish, ScheduledProduct])],
  providers: [VentasService],
  controllers: [VentasController],
})
export class VentasModule {}