import { Controller, Get, Post, Body } from '@nestjs/common';
import { VentasService } from './ventas.service.js';
import { Purchase } from './purchase.entity.js';

@Controller('ventas')
export class VentasController {
  constructor(private readonly ventasService: VentasService) {}

  @Get()
  obtenerTodas(): Promise<Purchase[]> {
    return this.ventasService.findAll();
  }

  @Get('profiles')
  obtenerPerfiles() {
    return this.ventasService.obtenerPerfiles();
  }

  @Post()
  crearVenta(@Body() purchaseData: Partial<Purchase>): Promise<Purchase> {
    return this.ventasService.create(purchaseData);
  }
}