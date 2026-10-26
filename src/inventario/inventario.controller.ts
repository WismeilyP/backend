import { Controller, Get, Post, Body, Delete, Param } from '@nestjs/common';
import { InventarioService } from './inventario.service.js';
import { InventoryItem } from './inventory-item.entity.js';

@Controller('inventario')
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  @Get()
  obtenerTodos(): Promise<InventoryItem[]> {
    return this.inventarioService.findAll();
  }

  @Post()
  crearItem(@Body() itemData: Partial<InventoryItem>): Promise<InventoryItem> {
    return this.inventarioService.create(itemData);
  }

  @Delete(':id')
  eliminarItem(@Param('id') id: string): Promise<void> {
    return this.inventarioService.remove(id);
  }
}