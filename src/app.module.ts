import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { InventoryItem } from './inventario/inventory-item.entity.js';
import { InventarioModule } from './inventario/inventario.module.js';

import { MasterDish } from './recetas/master-dish.entity.js';
import { DishFormula } from './recetas/dish-formula.entity.js';
import { RecetasModule } from './recetas/recetas.module.js';

import { Purchase } from './ventas/purchase.entity.js';
import { PurchasedPlan } from './ventas/purchased-plan.entity.js';

import { VentasModule } from './ventas/ventas.module.js';

import { ScheduledProduct } from './produccion/scheduled-product.entity.js';
import { ProduccionModule } from './produccion/produccion.module.js';

import { CommercialPlan } from './recetas/commercial-plan.entity.js';

import { PublishedMenu } from './recetas/published-menu.entity.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST') || 'localhost',
        port: config.get<number>('DB_PORT') || 5432,
        username: config.get<string>('DB_USER') || 'postgres',
        password: config.get<string>('DB_PASSWORD') || '123456',
        database: config.get<string>('DB_NAME') || 'cocina_funcional_bd',
        // ¡TODAS LAS ENTIDADES REGISTRADAS AQUÍ!
        // Adentro del TypeOrmModule.forRootAsync...
        entities: [InventoryItem, MasterDish, DishFormula, Purchase, PurchasedPlan, ScheduledProduct, CommercialPlan, PublishedMenu], // <- Entidad agregada
        synchronize: false, 
      }),
    }),
    InventarioModule,
    RecetasModule,
    VentasModule,
    ProduccionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}