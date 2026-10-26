import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { PublishedMenuService } from './published-menu.service.js';
import { PublishedMenu } from './published-menu.entity.js'; // <- Ya no importamos MealType

@Controller('cartelera')
export class PublishedMenuController {
  constructor(private readonly publishedMenuService: PublishedMenuService) {}

  @Get()
  obtenerCartelera(
    @Query('date') date?: string,
    // CORRECCIÓN: mealType ahora es de tipo string
    @Query('mealType') mealType?: string,
  ): Promise<PublishedMenu[]> {
    if (date && mealType) {
      return this.publishedMenuService.findByDateAndMeal(date, mealType);
    }
    return this.publishedMenuService.findAll();
  }

  @Post()
  publicarMenu(@Body() menuData: Partial<PublishedMenu>): Promise<PublishedMenu> {
    return this.publishedMenuService.create(menuData);
  }

  @Delete(':id')
  eliminarMenu(@Param('id') id: string): Promise<void> {
    return this.publishedMenuService.remove(id);
  }
}