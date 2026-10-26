import { Controller, Get, Patch, Post, Body, Param, Query, Put, Delete } from '@nestjs/common';
import { ProduccionService } from './produccion.service.js';

@Controller('produccion')
export class ProduccionController {
  constructor(private readonly produccionService: ProduccionService) {}

  @Get()
  obtenerPorFecha(@Query('date') date: string) {
    if (!date) return [];
    return this.produccionService.findAllByDate(date);
  }

  @Get('cliente/:profileId')
  obtenerCalendario(@Param('profileId') profileId: string) {
    return this.produccionService.obtenerCalendarioCliente(profileId);
  }

  @Patch('seleccionar/:id')
  seleccionarMenu(@Param('id') id: string, @Body('dishId') dishId: string) {
    return this.produccionService.seleccionarMenu(id, dishId);
  }

  // NUEVO: Endpoint para disparar el cierre operativo
  @Post('cierre')
  ejecutarCierre(@Body('date') date: string) {
    return this.produccionService.ejecutarCierreOperativo(date);
  }

  // NUEVO: Endpoint para la estación de empaque
  @Patch('ensamblar/:id')
  marcarEnsamblado(@Param('id') id: string) {
    return this.produccionService.marcarComoEnsamblado(id);
  }

  // NUEVO: Endpoint para Logística (Confirmar Entrega)
  @Patch('entregar/:id')
  marcarEntregado(@Param('id') id: string) {
    return this.produccionService.marcarComoEntregado(id);
  }

  // NUEVO: Endpoint para que el cliente pause un día
  @Patch('pausar/:id')
  pausarOrden(@Param('id') id: string) {
    return this.produccionService.pausarOrden(id);
  }

  // NUEVO: Endpoint para el Dashboard dinámico
  @Get('dashboard-metrics')
  obtenerMetricas() {
    return this.produccionService.obtenerMetricasDashboard();
  }

  // NUEVO: Endpoint para el módulo de Suscripciones
  @Get('directorio-suscripciones')
  obtenerDirectorio() {
    return this.produccionService.obtenerDirectorioSuscripciones();
  }

@Get('tienda/productos')
  obtenerCatalogoTienda() {
    return this.produccionService.obtenerProductosTienda();
  }

  @Get('tienda/categorias')
  obtenerCategoriasTienda() {
    return this.produccionService.obtenerCategoriasTienda();
  }

  @Post('tienda/productos')
  crearProducto(@Body() body: any) {
    return this.produccionService.crearProductoTienda(body);
  }

  @Put('tienda/productos/:id')
  actualizarProducto(@Param('id') id: string, @Body() body: any) {
    return this.produccionService.actualizarProductoTienda(Number(id), body);
  }

  @Delete('tienda/productos/:id')
  eliminarProducto(@Param('id') id: string) {
    return this.produccionService.eliminarProductoTienda(Number(id));
  }

 

  @Get('menus/publicos')
  obtenerMenusPublicos() {
    return this.produccionService.obtenerMenusPublicos();
  }

  @Get('planes/publicos')
  obtenerPlanesPublicos() {
    return this.produccionService.obtenerPlanesPublicos();
  }

  // --- RUTAS DE ADMINISTRACIÓN DE PLANES ---
  @Get('planes/admin')
  obtenerPlanesAdmin() {
    return this.produccionService.obtenerPlanesAdmin();
  }

  @Post('planes/guardar')
  guardarPlan(@Body() planData: any) {
    return this.produccionService.guardarPlan(planData);
  }

  @Patch('planes/:id/toggle')
  togglePlanActivo(@Param('id') id: string) {
    return this.produccionService.togglePlanActivo(id);
  }

  @Post('auth/login')
  login(@Body() data: any) {
    return this.produccionService.login(data);
  }

  @Post('auth/registro')
  registrarCliente(@Body() data: any) {
    return this.produccionService.registrarCliente(data);
  }

  @Get('menus/biblioteca')
  obtenerBibliotecaCompleta() {
    return this.produccionService.obtenerBibliotecaCompleta();
  }

  // --- RUTAS DE GESTIÓN DE BIBLIOTECA ---
  @Get('menus/preparaciones')
  obtenerPreparaciones() {
    return this.produccionService.obtenerPreparaciones();
  }

  @Post('menus/preparaciones')
  guardarPreparacion(@Body() data: any) {
    return this.produccionService.guardarPreparacion(data);
  }

  @Post('menus/platos')
  guardarPlatoMaestro(@Body() data: any) {
    return this.produccionService.guardarPlatoMaestro(data);
  }

  @Post('menus/reglas')
  guardarReglaSustitucion(@Body() data: any) {
    return this.produccionService.guardarReglaSustitucion(data);
  }

  @Delete('menus/reglas/:id')
  eliminarRegla(@Param('id') id: string) {
    return this.produccionService.eliminarRegla(Number(id));
  }

  @Get('menus/categorias')
  obtenerCategorias() {
    return this.produccionService.obtenerCategoriasOperativas();
  }

  @Post('menus/categorias')
  guardarCategoria(@Body() data: any) {
    return this.produccionService.guardarCategoriaOperativa(data);
  }

  @Delete('menus/categorias/:nombre')
  eliminarCategoria(@Param('nombre') nombre: string) {
    return this.produccionService.eliminarCategoriaOperativa(nombre);
  }

  @Get('planes/tags')
  obtenerTagsPlanes() {
    return this.produccionService.obtenerTagsPlanesActivos();
  }

@Get('menus/procesados/:tagPlan/:fecha/:perfilId')
  obtenerMenuProcesadoCliente(
    @Param('tagPlan') tagPlan: string,
    @Param('fecha') fecha: string,
    @Param('perfilId') perfilId: string
  ) {
    return this.produccionService.obtenerMenuProcesadoCliente(tagPlan, fecha, Number(perfilId));
  }
  
  // --- RUTAS DE CICLOS DE MENÚS (CARTELERA) ---
  @Get('menus/ciclos')
  obtenerCiclosPublicados() {
    return this.produccionService.obtenerCiclosPublicados();
  }

  @Post('menus/ciclos')
  guardarPlatoEnCiclo(@Body() data: any) {
    return this.produccionService.guardarPlatoEnCiclo(data);
  }

  @Delete('menus/ciclos/:id')
  eliminarPlatoDeCiclo(@Param('id') id: string) {
    return this.produccionService.eliminarPlatoDeCiclo(Number(id));
  }


  // --- RUTAS DE RESTRICCIONES DEL PERFIL ---
  @Get('perfil/:id/restricciones')
  obtenerRestricciones(@Param('id') id: string) {
    return this.produccionService.obtenerRestriccionesPerfil(Number(id));
  }

  @Post('perfil/:id/restricciones')
  actualizarRestricciones(@Param('id') id: string, @Body() data: { vetados: string[] }) {
    return this.produccionService.actualizarRestriccionesPerfil(Number(id), data.vetados);
  }
  @Get('restricciones/disponibles')
  obtenerOpcionesRestricciones() {
    return this.produccionService.obtenerOpcionesRestricciones();
  }

  @Post('restricciones/disponibles')
  agregarOpcionRestriccion(@Body() data: { id: string, icono: string, nombre: string }) {
    return this.produccionService.agregarOpcionRestriccion(data);
  }

  @Delete('restricciones/disponibles/:id')
  eliminarOpcionRestriccion(@Param('id') id: string) {
    return this.produccionService.eliminarOpcionRestriccion(id);
  }

  // --- RUTAS DE LOGÍSTICA, INVENTARIO Y MRP ---
 // --- RUTAS DE NUTRIOPS: INVENTARIO (DOC 06), PRODUCCIÓN (DOC 05) Y ENSAMBLE (DOC 07) ---
  @Get('logistica/inventario')
  obtenerInventario() {
    return this.produccionService.obtenerInventario();
  }

  @Post('logistica/inventario/crear')
  crearItemMaestroInventario(@Body() data: any) {
    return this.produccionService.crearItemMaestroInventario(data);
  }

  @Post('logistica/inventario/:id')
  actualizarInventario(@Param('id') id: string, @Body() data: any) {
    return this.produccionService.actualizarItemInventario(id, data);
  }

  @Get('logistica/dashboard/:fecha')
  obtenerDashboardLogistica(@Param('fecha') fecha: string) {
    return this.produccionService.obtenerDashboardLogistica(fecha);
  }

  @Post('logistica/compras/crear')
  crearOrdenCompra(@Body() data: any) {
    return this.produccionService.crearOrdenCompra(data);
  }

  @Post('logistica/compras/:id/recibir')
  recibirOrdenCompra(@Param('id') id: string, @Body() data: any) {
    return this.produccionService.recibirOrdenCompra(Number(id), data);
  }

  @Post('logistica/conciliacion')
  registrarConciliacionFisica(@Body() data: any) {
    return this.produccionService.registrarConciliacionFisica(data);
  }

 @Post('logistica/produccion/lote')
  async finalizarLoteProduccion(@Body() data: any) {
    return await this.produccionService.finalizarLoteProduccion(data);
  }

  @Post('logistica/lote/descontar/:fecha')
  async descontarLoteInventario(@Param('fecha') fecha: string) {
    return await this.produccionService.descontarLoteInventario(fecha);
  }

  @Post('logistica/orden/estado')
  cambiarEstadoOrden(@Body() data: any) {
    return this.produccionService.cambiarEstadoOrden(data);
  }

@Post('logistica/cuenta/direccion')
  async actualizarDireccionCuenta(@Body() data: any) {
    return await this.produccionService.actualizarDireccionCuenta(data);
  }

  @Post('logistica/entrega/despacho')
  async cambiarEstadoDespachoCuenta(@Body() data: any) {
    return await this.produccionService.cambiarEstadoDespachoCuenta(data);
  }
  
}