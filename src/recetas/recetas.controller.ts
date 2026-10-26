import { Controller, Get, Post, Body } from '@nestjs/common';
import { RecetasService } from './recetas.service.js';
import { MasterDish } from './master-dish.entity.js';

@Controller('recetas')
export class RecetasController {
  constructor(private readonly recetasService: RecetasService) {}

  @Get()
  obtenerTodos(): Promise<MasterDish[]> {
    return this.recetasService.findAll();
  }

  // NUEVA RUTA: Recibe los datos desde React y los manda a guardar
  @Post()
  crearReceta(@Body() dishData: Partial<MasterDish>): Promise<MasterDish> {
    return this.recetasService.create(dishData);
  }

  @Get('plans')
  obtenerPlanesComerciales() {
    return this.recetasService.obtenerPlanes(); // O el método que uses para retornar los planes de la BD
  }
}