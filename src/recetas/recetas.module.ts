import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MasterDish } from './master-dish.entity.js';
import { DishFormula } from './dish-formula.entity.js';
import { CommercialPlan } from './commercial-plan.entity.js';
import { PublishedMenu } from './published-menu.entity.js'; // Asegúrate de importar la entidad
import { RecetasService } from './recetas.service.js';
import { RecetasController } from './recetas.controller.js';
import { PublishedMenuService } from './published-menu.service.js'; // Importar el nuevo servicio
import { PublishedMenuController } from './published-menu.controller.js'; // Importar el nuevo controlador

@Module({
  imports: [TypeOrmModule.forFeature([MasterDish, DishFormula, CommercialPlan, PublishedMenu])],
  // Agregar el servicio a los providers
  providers: [RecetasService, PublishedMenuService],
  // Agregar el controlador a los controllers
  controllers: [RecetasController, PublishedMenuController],
})
export class RecetasModule {}