import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm'; // Importar DataSource
import { ScheduledProduct, ScheduleStatus } from './scheduled-product.entity.js';

@Injectable()
export class ProduccionService {
  constructor(
    @InjectRepository(ScheduledProduct)
    private scheduledProductRepository: Repository<ScheduledProduct>,
    private dataSource: DataSource, // Inyectamos DataSource para consultas cruzadas
  ) {}

  async findAllByDate(date: string): Promise<ScheduledProduct[]> {
    return this.scheduledProductRepository.find({
      where: { scheduledDate: date },
      relations: { dish: true },
    });
  }

  async obtenerCalendarioCliente(profileId: string): Promise<ScheduledProduct[]> {
    return this.scheduledProductRepository.find({
      where: { profileId },
      relations: { dish: true },
      order: { scheduledDate: 'ASC' }
    });
  }

  async seleccionarMenu(id: string, dishId: string): Promise<ScheduledProduct> {
    const orden = await this.scheduledProductRepository.findOne({ where: { id } });
    if (!orden) throw new BadRequestException('Orden no encontrada');

    if (orden.status === ScheduleStatus.IN_PRODUCTION || orden.status === ScheduleStatus.DELIVERED) {
      throw new BadRequestException('Esta orden ya está cerrada para producción.');
    }

    orden.dishId = dishId;
    orden.status = ScheduleStatus.MENU_SELECTED;
    return this.scheduledProductRepository.save(orden);
  }


  // --- MÓDULO 4: ENSAMBLE Y EMPAQUE ---
  async marcarComoEnsamblado(id: string): Promise<ScheduledProduct> {
    const orden = await this.scheduledProductRepository.findOne({ 
      where: { id }, 
      relations: { dish: true } 
    });
    
    if (!orden) throw new BadRequestException('Orden no encontrada');

    // REGLA: Solo se puede ensamblar lo que ya superó el corte de producción
    if (orden.status !== ScheduleStatus.IN_PRODUCTION) {
      throw new BadRequestException('La orden debe estar en estado IN_PRODUCTION para ser ensamblada.');
    }

    orden.status = ScheduleStatus.ASSEMBLED;
    return this.scheduledProductRepository.save(orden);
  }

  // --- NUEVO: MOTOR DE CIERRE OPERATIVO ---
  async ejecutarCierreOperativo(targetDate: string): Promise<{ procesadas: number, asignacionesAutomaticas: number }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let asignacionesAutomaticas = 0;
    let procesadas = 0;

    try {
      // 1. Buscar todas las órdenes de la fecha que aún no han sido pasadas a producción
      const ordenesPendientes = await queryRunner.manager.find(ScheduledProduct, {
        where: [
          { scheduledDate: targetDate, status: ScheduleStatus.PENDING_SELECTION },
          { scheduledDate: targetDate, status: ScheduleStatus.MENU_SELECTED }
        ]
      });

      // 2. Buscar la cartelera publicada para ese día (para asignaciones automáticas)
      const carteleraDelDia = await queryRunner.manager.query(
        `SELECT dish_id FROM published_menus WHERE target_date = $1 AND is_active = true LIMIT 1`,
        [targetDate]
      );
      const platoPorDefectoId = carteleraDelDia.length > 0 ? carteleraDelDia[0].dish_id : null;

      // 3. Procesar cada orden
      for (const orden of ordenesPendientes) {
        if (orden.status === ScheduleStatus.PENDING_SELECTION) {
          if (!platoPorDefectoId) {
            throw new BadRequestException(`No hay platos publicados en la cartelera para el ${targetDate}. Imposible realizar asignación automática.`);
          }
          orden.dishId = platoPorDefectoId; // Asignación automática
          asignacionesAutomaticas++;
        }
        
        orden.status = ScheduleStatus.IN_PRODUCTION; // Congelar para la cocina
        await queryRunner.manager.save(ScheduledProduct, orden);
        procesadas++;
      }

      await queryRunner.commitTransaction();
      return { procesadas, asignacionesAutomaticas };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // --- MÓDULO 5: LOGÍSTICA Y ENTREGAS ---
  async marcarComoEntregado(id: string): Promise<ScheduledProduct> {
    const orden = await this.scheduledProductRepository.findOne({ where: { id } });
    if (!orden) throw new BadRequestException('Orden no encontrada');

    // REGLA: Solo se puede entregar lo que ya está ensamblado y empaquetado
    if (orden.status !== ScheduleStatus.ASSEMBLED) {
      throw new BadRequestException('La orden debe estar en estado ASSEMBLED para poder ser despachada y entregada.');
    }

    orden.status = ScheduleStatus.DELIVERED;
    return this.scheduledProductRepository.save(orden);
  }

  // --- MÓDULO 6: SISTEMA DE PAUSAS Y BILLETERA ---
  async pausarOrden(id: string): Promise<any> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const orden = await queryRunner.manager.findOne(ScheduledProduct, { where: { id } });
      if (!orden) throw new BadRequestException('Orden no encontrada');

      // REGLA: No se puede pausar si ya pasó a la cocina o más adelante
      if (['IN_PRODUCTION', 'ASSEMBLED', 'DELIVERED'].includes(orden.status)) {
        throw new BadRequestException('No puedes pausar una orden que ya superó el corte de producción de las 2:00 PM.');
      }
      
      // REGLA: No pausar dos veces
      if (orden.status === ('PAUSED' as ScheduleStatus)) {
        throw new BadRequestException('Esta orden ya se encuentra pausada.');
      }

      // 1. Marcar el día original como pausado
      orden.status = 'PAUSED' as ScheduleStatus;
      await queryRunner.manager.save(ScheduledProduct, orden);

      // 2. Buscar el ÚLTIMO día de este perfil para saber dónde agregar el nuevo día
      const ultimaOrden = await queryRunner.manager.find(ScheduledProduct, {
        where: { profileId: orden.profileId },
        order: { scheduledDate: 'DESC' },
        take: 1
      });

      let fechaBaseStr = orden.scheduledDate;
      if (ultimaOrden.length > 0) {
        fechaBaseStr = ultimaOrden[0].scheduledDate;
      }

      // Sumar 1 día de forma segura evitando problemas de zona horaria
      const [year, month, day] = fechaBaseStr.split('-').map(Number);
      const nuevaFecha = new Date(year, month - 1, day + 1);
      const y2 = nuevaFecha.getFullYear();
      const m2 = String(nuevaFecha.getMonth() + 1).padStart(2, '0');
      const d2 = String(nuevaFecha.getDate()).padStart(2, '0');
      const nuevaFechaStr = `${y2}-${m2}-${d2}`;

      // 3. Crear el nuevo derecho de consumo (Día Extra) al final del plan
      const nuevoDia = queryRunner.manager.create(ScheduledProduct, {
        profileId: orden.profileId,
        dishId: null,
        scheduledDate: nuevaFechaStr,
        status: ScheduleStatus.PENDING_SELECTION,
        isExtraProtein: orden.isExtraProtein
      });
      await queryRunner.manager.save(ScheduledProduct, nuevoDia);

      await queryRunner.commitTransaction();
      return { 
        mensaje: 'Día pausado exitosamente. Se ha extendido tu plan un día más.', 
        nuevoDia: nuevaFechaStr 
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // --- MÓDULO 7: MÉTRICAS DEL DASHBOARD ---
  // --- MÓDULO 7: MÉTRICAS DEL DASHBOARD ---
  async obtenerMetricasDashboard(): Promise<any> {
    const hoyDate = new Date();
    const hoy = hoyDate.toISOString().split('T')[0];
    
    const sieteDiasAtras = new Date();
    sieteDiasAtras.setDate(sieteDiasAtras.getDate() - 6);
    const hace7Dias = sieteDiasAtras.toISOString().split('T')[0];

    try {
      // 1. Total de Ventas (Usamos 'subscription_payment' en singular)
      const ventasResult = await this.dataSource.query(
        `SELECT SUM(amount) as total FROM subscription_payment WHERE status = 'APPROVED'`
      ).catch(() => [{ total: 0 }]); // Salvavidas: si la tabla no existe o se llama distinto, devuelve 0 sin romper el server

      // 2. Suscriptores Totales (Usamos 'profile' en singular)
      const subsResult = await this.dataSource.query(
        `SELECT COUNT(id) as total FROM profile`
      ).catch(() => [{ total: 0 }]);

      // 3. Entregas de Hoy (Usamos 'scheduled_product' en singular)
      const entregasResult = await this.dataSource.query(
        `SELECT status, COUNT(*) as count FROM scheduled_product WHERE scheduled_date = $1 GROUP BY status`, 
        [hoy]
      ).catch(() => []);

      // 4. Actividad de Usuarios (Usamos 'scheduled_product' en singular)
      const actividadResult = await this.dataSource.query(
        `SELECT scheduled_date as date, COUNT(*) as count 
         FROM scheduled_product 
         WHERE scheduled_date <= $1 AND scheduled_date >= $2
         GROUP BY scheduled_date 
         ORDER BY scheduled_date ASC`, 
        [hoy, hace7Dias]
      ).catch(() => []);

      return {
        totalVentas: Number(ventasResult[0]?.total || 0),
        totalSubs: Number(subsResult[0]?.total || 0),
        entregasResult,
        actividadResult,
        hoy
      };
    } catch (error) {
      console.error("Error obteniendo métricas:", error);
      throw new BadRequestException('Error al calcular las métricas del dashboard.');
    }
  }

// --- MÓDULO 8: DIRECTORIO DINÁMICO DE SUSCRIPCIONES ---
  async obtenerDirectorioSuscripciones(): Promise<any[]> {
    try {
      // 1. Obtener todos los perfiles reales
      const perfiles = await this.dataSource.query(`SELECT * FROM profile`).catch(() => []);
      
      // 2. Construir el directorio dinámico mapeando cada perfil con sus órdenes
      const directorio = await Promise.all(perfiles.map(async (p: any) => {
         // Buscamos órdenes y pagos (soportando camelCase y snake_case para evitar errores de TypeORM)
         const ordenes = await this.dataSource.query(
           `SELECT status, scheduled_date as date FROM scheduled_product WHERE "profileId" = $1`, [p.id]
         ).catch(() => []);
         
         const pagos = await this.dataSource.query(
           `SELECT amount FROM subscription_payment WHERE "profileId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [p.id]
         ).catch(() => []);
         
         // Lógica de negocio
         const pendientes = ordenes.filter((o: any) => o.status !== 'DELIVERED');
         const ultimoPago = pagos[0]?.amount || 0;
         
         // Formatear el nombre (asumiendo que TypeORM guardó firstName)
         const nombreCliente = p.firstName ? `${p.firstName} ${p.lastName || ''}`.trim() : 'Cliente Sin Nombre';
         
         return {
            id: p.id,
            nombre: nombreCliente,
            email: p.email || 'Sin correo registrado',
            telefono: p.phone || 'Sin teléfono',
            direccion: p.deliveryAddress || 'Dirección no registrada',
            plan: pendientes.length > 0 ? 'Plan Base' : 'Sin Plan Activo', 
            tipo: 'Almuerzos',
            costo: Number(ultimoPago),
            estado: pendientes.length > 0 ? 'Activo' : 'Inactivo',
            vencimiento: pendientes.length > 0 ? pendientes[pendientes.length - 1].date : 'N/A',
            almuerzos: pendientes.length, // Conectado a la demanda real
            cenas: 0,
            billetera: 0 // Preparado para el módulo de pausas
         };
      }));

      return directorio;
    } catch (error) {
      console.error("Error obteniendo directorio:", error);
      throw new BadRequestException('Error al cargar la base de datos de clientes.');
    }
  }



  
  // --- MÓDULO DE TIENDA: PRODUCTOS Y CATEGORÍAS DINÁMICAS ---
  
  async obtenerProductosTienda(): Promise<any[]> {
    try {
      // 1. Crear tabla si no existe
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS store_product (
          id SERIAL PRIMARY KEY,
          sku VARCHAR(50),
          nombre VARCHAR(255) NOT NULL,
          categoria VARCHAR(100) NOT NULL,
          precio NUMERIC(10,2) NOT NULL,
          stock INT NOT NULL DEFAULT 0,
          imagen_url TEXT,
          imagenes_secundarias TEXT
        )
      `);
      
      // 2. Parche de seguridad: Añadir las columnas nuevas si la tabla ya existía del paso anterior
      await this.dataSource.query(`ALTER TABLE store_product ADD COLUMN IF NOT EXISTS sku VARCHAR(50)`).catch(()=>null);
      await this.dataSource.query(`ALTER TABLE store_product ADD COLUMN IF NOT EXISTS imagen_url TEXT`).catch(()=>null);
      await this.dataSource.query(`ALTER TABLE store_product ADD COLUMN IF NOT EXISTS imagenes_secundarias TEXT`).catch(()=>null);

      return await this.dataSource.query(`SELECT * FROM store_product ORDER BY id ASC`);
    } catch (error) {
      console.error("Error obteniendo productos:", error);
      return [];
    }
  }

  async crearProductoTienda(producto: any): Promise<any> {
    try {
      // Insertar el producto
      const result = await this.dataSource.query(`
        INSERT INTO store_product (nombre, categoria, precio, stock, imagen_url, imagenes_secundarias)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        producto.nombre, 
        producto.categoria, 
        Number(producto.precio), 
        Number(producto.stock), 
        producto.imagen_url || '',
        JSON.stringify(producto.imagenes_secundarias || [])
      ]);

      const nuevoId = result[0].id;
      
      // Generar SKU automático (Ej: PD-001)
      const skuGenerado = `PD-${nuevoId.toString().padStart(3, '0')}`;
      await this.dataSource.query(`UPDATE store_product SET sku = $1 WHERE id = $2`, [skuGenerado, nuevoId]);

      return { success: true, message: 'Producto creado exitosamente', sku: skuGenerado };
    } catch (error) {
      console.error("Error al crear producto:", error);
      throw new BadRequestException('Error guardando en la base de datos.');
    }
  }

 // Extrae solo las categorías que ya existen para el autocompletado
  async obtenerCategoriasTienda(): Promise<string[]> {
    try {
      const result = await this.dataSource.query(`SELECT DISTINCT categoria FROM store_product WHERE categoria IS NOT NULL`);
      return result.map((r: any) => r.categoria);
    } catch (error) {
      return [];
    }
  }

  // --- MÓDULO DE TIENDA: ACTUALIZAR PRODUCTO ---
  async actualizarProductoTienda(id: number, producto: any): Promise<any> {
    try {
      await this.dataSource.query(`
        UPDATE store_product 
        SET nombre = $1, categoria = $2, precio = $3, stock = $4, imagen_url = $5, imagenes_secundarias = $6
        WHERE id = $7
      `, [
        producto.nombre, 
        producto.categoria, 
        Number(producto.precio), 
        Number(producto.stock), 
        producto.imagen_url || '',
        JSON.stringify(producto.imagenes_secundarias || []),
        id
      ]);

      return { success: true, message: 'Producto actualizado exitosamente' };
    } catch (error) {
      console.error("Error al actualizar producto:", error);
      throw new BadRequestException('Error actualizando en la base de datos.');
    }
  }

  // --- MÓDULO DE TIENDA: ELIMINAR PRODUCTO ---
  async eliminarProductoTienda(id: number): Promise<any> {
    try {
      await this.dataSource.query(`DELETE FROM store_product WHERE id = $1`, [id]);
      return { success: true, message: 'Producto eliminado exitosamente' };
    } catch (error) {
      console.error("Error al eliminar producto:", error);
      throw new BadRequestException('Error eliminando de la base de datos.');
    }
  }

  // --- MÓDULO DE AUTENTICACIÓN DINÁMICO ---
  async autenticarUsuario(credenciales: { email: string; password: string }): Promise<any> {
    const { email, password } = credenciales;

    try {
      // 1. Crear tabla de autenticación si no existe
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS auth_user (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL DEFAULT 'CLIENT',
          nombre VARCHAR(255) NOT NULL,
          "profileId" UUID
        )
      `);

      // 2. Sembrar usuario Administrador por defecto si la tabla está vacía
      const conteo = await this.dataSource.query(`SELECT COUNT(*) as total FROM auth_user`);
      if (Number(conteo[0]?.total || 0) === 0) {
        await this.dataSource.query(`
          INSERT INTO auth_user (email, password, role, nombre)
          VALUES 
            ('admin@nutriday.com', 'admin123', 'ADMIN', 'Administrador General'),
            ('cliente@nutriday.com', 'cliente123', 'CLIENT', 'Usuario Principal')
        `);
      }

      // 3. Buscar usuario en la base de datos
      const usuarios = await this.dataSource.query(
        `SELECT id, email, role, nombre, "profileId" FROM auth_user WHERE LOWER(email) = LOWER($1) AND password = $2 LIMIT 1`,
        [email.trim(), password.trim()]
      );

      if (!usuarios || usuarios.length === 0) {
        throw new BadRequestException('Credenciales inválidas. Verifica tu correo y contraseña.');
      }

      const usuario = usuarios[0];
      return {
        success: true,
        user: {
          id: usuario.id,
          email: usuario.email,
          role: usuario.role, // 'ADMIN' | 'CLIENT'
          nombre: usuario.nombre,
          profileId: usuario.profileId
        }
      };
    } catch (error: any) {
      console.error("Error en autenticación:", error);
      throw new BadRequestException(error.message || 'Error en el servidor de autenticación.');
    }
  }


  // --- MÓDULO DE MENÚS (CARTELERA) PARA LA LANDING PAGE ---
// --- MÓDULO DE MENÚS: CONECTADO AL CATÁLOGO MAESTRO DE RECETAS ---
  async obtenerMenusPublicos(): Promise<any[]> {
    try {
      // 1. Parche de seguridad: Preparamos tu tabla master_dishes (en plural)
      await this.dataSource.query(`ALTER TABLE master_dishes ADD COLUMN IF NOT EXISTS imagen_url TEXT`).catch(()=>null);
      await this.dataSource.query(`ALTER TABLE master_dishes ADD COLUMN IF NOT EXISTS kcal INT DEFAULT 450`).catch(()=>null);
      await this.dataSource.query(`ALTER TABLE master_dishes ADD COLUMN IF NOT EXISTS proteina VARCHAR(20) DEFAULT '30g'`).catch(()=>null);
      await this.dataSource.query(`ALTER TABLE master_dishes ADD COLUMN IF NOT EXISTS carbos VARCHAR(20) DEFAULT '40g'`).catch(()=>null);
      await this.dataSource.query(`ALTER TABLE master_dishes ADD COLUMN IF NOT EXISTS grasas VARCHAR(20) DEFAULT '15g'`).catch(()=>null);

      let menus = [];
      try {
        // Intentamos extraer asumiendo que la columna se llama 'nombre'
        menus = await this.dataSource.query(`
          SELECT 
            id,
            nombre, 
            COALESCE(imagen_url, 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&q=80&w=400') as imagen_url,
            COALESCE(kcal, 450) as kcal,
            COALESCE(proteina, '30g') as proteina,
            COALESCE(carbos, '40g') as carbos,
            COALESCE(grasas, '15g') as grasas
          FROM master_dishes 
          LIMIT 4
        `);
      } catch (errorNombre) {
        // Fallback: Si falla, es porque la columna en tu entidad se llama 'name' en inglés
        menus = await this.dataSource.query(`
          SELECT 
            id,
            name as nombre, 
            COALESCE(imagen_url, 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&q=80&w=400') as imagen_url,
            COALESCE(kcal, 450) as kcal,
            COALESCE(proteina, '30g') as proteina,
            COALESCE(carbos, '40g') as carbos,
            COALESCE(grasas, '15g') as grasas
          FROM master_dishes 
          LIMIT 4
        `);
      }
      
      return menus;
    } catch (error) {
      console.error("Error conectando con el catálogo maestro (master_dishes):", error);
      return [];
    }
  }

  // --- MÓDULO DE PLANES COMERCIALES ---
  // --- MÓDULO DE PLANES COMERCIALES (DINÁMICO) ---
  async obtenerPlanesPublicos(): Promise<any[]> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS subscription_plan (
          id VARCHAR(50) PRIMARY KEY,
          titulo VARCHAR(100) NOT NULL,
          icono VARCHAR(10),
          precio_base DECIMAL(10,2) NOT NULL,
          descripcion TEXT,
          etiquetas JSONB,
          beneficios JSONB,
          nutricion JSONB,
          para_quien TEXT,
          que_recibes TEXT,
          activo BOOLEAN DEFAULT true
        )
      `);

      // Validación inteligente: Si hay menos de 6 planes, limpiamos e insertamos la lista definitiva
      const conteo = await this.dataSource.query(`SELECT COUNT(*) as total FROM subscription_plan`);
      if (Number(conteo[0]?.total || 0) < 6) {
        await this.dataSource.query(`DELETE FROM subscription_plan`); // Limpiamos los 4 viejos
        
        await this.dataSource.query(`
          INSERT INTO subscription_plan (id, titulo, icono, precio_base, descripcion, etiquetas, beneficios, nutricion, para_quien, que_recibes) VALUES
          ('low-carb', 'Low Carb', '⚡', 12.50, 'Nuestra firma metabólica. Diseñado para mantener la insulina estable y optimizar la quema de grasas sin pasar hambre.', '["SIN GLUTEN", "SIN LÁCTEOS", "KETO FRIENDLY", "NON-GMO"]', '["Control total de picos de glucosa", "Mejora claridad mental y enfoque", "Reducción de inflamación sistémica", "Proteína de alta biodisponibilidad", "Vegetales de bajo índice glucémico"]', '{"cal": "420-480 kcal", "pro": "35g", "car": "12g", "fat": "28g"}', 'Si buscas bajar de peso de forma sostenible, mejorar tu claridad mental o controlar niveles de glucosa.', 'Platos densos en nutrientes, proteínas limpias y grasas saludables. Sin harinas refinadas ni azúcares ocultos.'),
          ('high-protein', 'High Protein', '🥩', 14.00, 'El aliado perfecto para tu entrenamiento y recuperación. Enfocado en la reparación y mantenimiento de masa muscular magra.', '["HIGH PROTEIN", "BAJO EN GRASA", "POST-WORKOUT", "SIN GLUTEN"]', '["Máxima síntesis de proteína", "Perfil completo de aminoácidos", "Saciedad prolongada", "Ideal para recomposición corporal", "Apoyo hormonal saludable"]', '{"cal": "550-620 kcal", "pro": "55g", "car": "25g", "fat": "15g"}', 'Si realizas actividad física intensa, buscas ganar masa muscular o necesitas un extra de saciedad en tu día.', 'Dosis elevadas de aminoácidos esenciales, carbohidratos complejos de absorción lenta y grasas omega-3.'),
          ('plant-based', 'Plant Based', '🌱', 11.50, 'Energía vibrante directamente de la tierra. Una explosión de fitonutrientes y antioxidantes para un cuerpo alcalino.', '["100% VEGANO", "ECO-PACKAGING", "FIBER RICH", "DAIRY FREE"]', '["Alta densidad de fibra prebiótica", "Proteína vegetal de múltiples fuentes", "Cero colesterol y grasas saturadas", "Salud digestiva radical", "Sostenibilidad ambiental"]', '{"cal": "400-450 kcal", "pro": "22g", "car": "55g", "fat": "12g"}', 'Si buscas aumentar tu consumo de fibra, reducir el consumo de productos animales o seguir una dieta vegana equilibrada.', 'Proteínas vegetales de amplio espectro, semillas, granos ancestrales y una variedad infinita de colores.'),
          ('ultralivianos', 'Ultralivianos', '🍃', 11.00, 'Comida que acaricia tu digestión. Especialmente formulado para sensibilidades gástricas y digestiones pesadas.', '["EASY DIGEST", "SLOW COOKED", "LOW FODMAP", "ANTI-INFLAM"]', '["Ingredientes de fácil hidrólisis", "Baja carga glucémica nocturna", "Sin irritantes ni condimentos fuertes", "Optimiza descanso reparador", "Equilibrio electrolítico"]', '{"cal": "350-400 kcal", "pro": "25g", "car": "30g", "fat": "10g"}', 'Si sufres de inflamación abdominal constante, pesadez después de comer o quieres optimizar tu descanso nocturno.', 'Platos con técnicas de cocción suaves, bajos en irritantes y con ingredientes de muy fácil degradación.'),
          ('cardio-energy', 'Cardio Energy', '❤️', 13.00, 'Para quienes aman el movimiento. Carbohidratos complejos y micronutrientes que sostienen tu energía durante todo el día.', '["ENERGY BOOST", "CARB FOCUSED", "IRON RICH", "HYDRATION SUPPORT"]', '["Energía de larga duración", "Reposición óptima de glucógeno", "Bajo en grasas saturadas", "Alta densidad vitamínica", "Soporte cardiovascular"]', '{"cal": "500-550 kcal", "pro": "28g", "car": "65g", "fat": "14g"}', 'Si practicas running, ciclismo o natación y necesitas energía constante sin pesadez.', 'Platos balanceados con granos ancestrales, tubérculos asados y proteínas magras de fácil asimilación.'),
          ('a-medida', 'A Medida', '⚙️', 16.50, 'Tu nutrición, tus reglas. Trabajamos con tu nutricionista personal para seguir tus requerimientos exactos de gramajes y exclusiones.', '["PREMIUM", "FULLY CUSTOM", "CLINICAL", "EXPERT SUPPORT"]', '["Gramaje pesado exacto", "Exclusión total de ingredientes", "Atención prioritaria", "Consultoría mensual express", "Seguimiento metabólico"]', '{"cal": "Varia según plan", "pro": "Custom", "car": "Custom", "fat": "Custom"}', 'Si tienes objetivos específicos de alta competencia, patologías médicas o exclusiones múltiples muy estrictas.', 'Pesaje exacto de cada ingrediente según tu plan clínico. Empaque especial con etiqueta de macros personalizada.')
        `);
      }
      return await this.dataSource.query(`
        SELECT * FROM subscription_plan 
        WHERE activo = true 
        ORDER BY 
          CASE id 
            WHEN 'low-carb' THEN 1
            WHEN 'high-protein' THEN 2
            WHEN 'plant-based' THEN 3
            WHEN 'ultralivianos' THEN 4
            WHEN 'cardio-energy' THEN 5
            WHEN 'a-medida' THEN 6
            ELSE 7 
          END
      `);
    } catch (error) {
      console.error("Error obteniendo planes:", error);
      return [];
    }
  }

  // --- MÓDULO ADMIN: GESTIÓN DINÁMICA DE PLANES ---

  // 1. Obtiene todos los planes (activos e inactivos) para el panel de Admin
  async obtenerPlanesAdmin(): Promise<any[]> {
    try {
      return await this.dataSource.query(`SELECT * FROM subscription_plan ORDER BY precio_base ASC`);
    } catch (error) {
      return [];
    }
  }

  // 2. Crea un plan nuevo o actualiza uno existente
  async guardarPlan(plan: any): Promise<any> {
    try {
      const id = plan.id || plan.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const existe = await this.dataSource.query(`SELECT id FROM subscription_plan WHERE id = $1`, [id]);
      
      const etiquetas = JSON.stringify(plan.etiquetas || []);
      const beneficios = JSON.stringify(plan.beneficios || ["Excelente sabor"]);
      const nutricion = JSON.stringify(plan.nutricion || { cal: "400 kcal", pro: "30g", car: "20g", fat: "15g" });

      if (existe.length > 0) {
        await this.dataSource.query(`
          UPDATE subscription_plan 
          SET titulo = $2, icono = $3, precio_base = $4, descripcion = $5, etiquetas = $6, beneficios = $7, nutricion = $8, para_quien = $9, que_recibes = $10
          WHERE id = $1
        `, [id, plan.titulo, plan.icono || '✨', plan.precio_base, plan.descripcion, etiquetas, beneficios, nutricion, plan.para_quien, plan.que_recibes]);
      } else {
        await this.dataSource.query(`
          INSERT INTO subscription_plan (id, titulo, icono, precio_base, descripcion, etiquetas, beneficios, nutricion, para_quien, que_recibes, activo)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
        `, [id, plan.titulo, plan.icono || '✨', plan.precio_base, plan.descripcion, etiquetas, beneficios, nutricion, plan.para_quien, plan.que_recibes]);
      }
      return { success: true, id };
    } catch (error) {
      console.error("Error guardando plan:", error);
      throw error;
    }
  }

  // 3. Activa u Oculta un plan (Toggle)
  async togglePlanActivo(id: string): Promise<any> {
    try {
      await this.dataSource.query(`UPDATE subscription_plan SET activo = NOT activo WHERE id = $1`, [id]);
      return { success: true };
    } catch (error) {
      console.error("Error alternando plan:", error);
      throw error;
    }
  }


  // --- MÓDULO DE AUTENTICACIÓN Y USUARIOS ---
  async inicializarUsuarios() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100),
        email VARCHAR(100) UNIQUE,
        password VARCHAR(100),
        telefono VARCHAR(50),
        role VARCHAR(20) DEFAULT 'CLIENT'
      )
    `);
    // Crear el superadministrador por defecto si no existe
    const admin = await this.dataSource.query(`SELECT * FROM usuarios WHERE email = 'admin@nutriday.com'`);
    if (admin.length === 0) {
      await this.dataSource.query(`INSERT INTO usuarios (nombre, email, password, role) VALUES ('Administrador General', 'admin@nutriday.com', 'admin123', 'ADMIN')`);
    }
  }

  async login(data: any) {
    await this.inicializarUsuarios();
    const users = await this.dataSource.query(`SELECT * FROM usuarios WHERE email = $1 AND password = $2`, [data.email, data.password]);
    if (users.length > 0) {
      const user = users[0];
      delete user.password; // Por seguridad, nunca devolvemos la contraseña
      return { user };
    }
    throw new Error('Credenciales inválidas');
  }

  async registrarCliente(data: any) {
    await this.inicializarUsuarios();
    const existe = await this.dataSource.query(`SELECT id FROM usuarios WHERE email = $1`, [data.email]);
    if (existe.length > 0) throw new Error('El correo electrónico ya está registrado.');

    const res = await this.dataSource.query(`
      INSERT INTO usuarios (nombre, email, password, telefono, role)
      VALUES ($1, $2, $3, $4, 'CLIENT') RETURNING id, nombre, email, role, telefono
    `, [data.nombre, data.email, data.password, data.telefono]);

    return { user: res[0] };
  }


  // =========================================================
  // MÓDULO DE MENÚS Y BIBLIOTECA DE PLATOS (MOTOR DE REGLAS)
  // =========================================================
  // MÓDULO DE MENÚS Y BIBLIOTECA DE PLATOS (MOTOR DE REGLAS)
  // =========================================================
 async inicializarBibliotecaPlatos() {
    // 1. Tabla de Categorías Operativas
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS categorias_operativas (
        nombre VARCHAR(50) PRIMARY KEY
      )
    `);
    const conteoCat = await this.dataSource.query(`SELECT COUNT(*) as total FROM categorias_operativas`);
    if (Number(conteoCat[0]?.total || 0) === 0) {
      await this.dataSource.query(`INSERT INTO categorias_operativas (nombre) VALUES ('Proteico'), ('Carbohidrato'), ('Verdura'), ('Sopa')`);
    }

    // 2. Tabla de Preparaciones
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS preparaciones (
        id VARCHAR(50) PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        categoria_operativa VARCHAR(50) NOT NULL
      )
    `);

    // 3. Tabla de Platos Maestros (Con JSONB dinámico)
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS platos_maestros (
        id VARCHAR(50) PRIMARY KEY,
        nombre_comercial VARCHAR(100) NOT NULL,
        categoria_comercial VARCHAR(50) DEFAULT 'ESENCIAL',
        tipo_comida VARCHAR(50) DEFAULT 'Almuerzo',
        imagen_url TEXT,
        composicion_base JSONB DEFAULT '[]'::jsonb
      )
    `);

    // 4. Tabla de Reglas de Sustitución
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS reglas_sustitucion (
        id SERIAL PRIMARY KEY,
        plato_id VARCHAR(50) REFERENCES platos_maestros(id) ON DELETE CASCADE,
        tag_plan VARCHAR(50) NOT NULL,
        categoria_sustituir VARCHAR(50) NOT NULL,
        preparacion_nueva_id VARCHAR(50) REFERENCES preparaciones(id)
      )
    `);
    // SIN SEMILLAS AUTOMÁTICAS: La base de datos permanece limpia.
  }

  // Función para que el AdminHub lea toda la biblioteca
  async obtenerBibliotecaCompleta() {
    await this.inicializarBibliotecaPlatos();

    const platos = await this.dataSource.query(`SELECT * FROM platos_maestros`);

    const reglas = await this.dataSource.query(`
      SELECT r.id, r.plato_id, r.tag_plan, r.categoria_sustituir, r.preparacion_nueva_id, prep.nombre as nueva_preparacion
      FROM reglas_sustitucion r
      JOIN preparaciones prep ON r.preparacion_nueva_id = prep.id
    `);

    return { platos, reglas };
  }

  // --- MÓDULO DE MENÚS: GUARDADO DINÁMICO ---

  async obtenerPreparaciones(): Promise<any[]> {
    await this.inicializarBibliotecaPlatos();
    return await this.dataSource.query(`SELECT * FROM preparaciones ORDER BY categoria_operativa, nombre`);
  }

  async guardarPreparacion(data: any): Promise<any> {
    await this.inicializarBibliotecaPlatos();
    await this.inicializarInventario();
    const id = data.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const cat = data.categoria_operativa || 'Proteico';

    await this.dataSource.query(`
      INSERT INTO preparaciones (id, nombre, categoria_operativa, categoria) 
      VALUES ($1, $2, $3, $3)
      ON CONFLICT (id) DO UPDATE SET nombre = $2, categoria_operativa = $3, categoria = $3
    `, [id, data.nombre, cat]);

    // Sincronizar también en Maestro de Inventario de NutriOps si se creó desde el AdminHub
    const catLower = cat.toLowerCase();
    const gramosDefault = catLower.includes('prote') ? 180 : catLower.includes('carbo') ? 150 : 120;
    const estacionDefault = catLower.includes('prote') ? 'Proteínas' : catLower.includes('sopa') ? 'Sopas' : catLower.includes('verdu') || catLower.includes('frut') ? 'Fríos' : 'Calientes';

    await this.dataSource.query(`
      INSERT INTO inventario_insumos (
        preparacion_id, nombre_custom, categoria_custom, tipo_item, unidad,
        presentacion_compra, factor_conversion, stock_actual, stock_minimo,
        costo_promedio, ubicacion, proveedor, gramos_por_racion, estacion, anticipacion_dias
      )
      VALUES ($1, $2, $3, 'MATERIA_PRIMA', 'g', 'Bolsa x 5.000 g', 5000, 0, 2000, 0.0180, 'Cuarto Frío', 'Alimentos del Valle', $4, $5, 0)
      ON CONFLICT (preparacion_id) DO UPDATE SET
        nombre_custom = EXCLUDED.nombre_custom,
        categoria_custom = EXCLUDED.categoria_custom
    `, [id, data.nombre, cat, gramosDefault, estacionDefault]);

    return { success: true };
  }

  async guardarPlatoMaestro(data: any): Promise<any> {
    const id = data.id || data.nombre_comercial.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    let composicion = data.composicion_base || [];
    if (typeof composicion !== 'string') {
      composicion = JSON.stringify(composicion);
    }

    await this.dataSource.query(`
      INSERT INTO platos_maestros (id, nombre_comercial, categoria_comercial, tipo_comida, composicion_base, imagen_url) 
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET 
        nombre_comercial = $2, categoria_comercial = $3, tipo_comida = $4, 
        composicion_base = $5, imagen_url = $6
    `, [id, data.nombre_comercial, data.categoria_comercial, data.tipo_comida, composicion, data.imagen_url || null]);

    return { success: true };
  }

  async guardarReglaSustitucion(data: any): Promise<any> {
    await this.dataSource.query(`
      INSERT INTO reglas_sustitucion (plato_id, tag_plan, categoria_sustituir, preparacion_nueva_id)
      VALUES ($1, $2, $3, $4)
    `, [data.plato_id, data.tag_plan, data.categoria_sustituir, data.preparacion_nueva_id]);
    return { success: true };
  }

  async eliminarRegla(id: number): Promise<any> {
    await this.dataSource.query(`DELETE FROM reglas_sustitucion WHERE id = $1`, [id]);
    return { success: true };
  }

  // --- GESTOR DE CATEGORÍAS ESTRICTAS ---
  async obtenerCategoriasOperativas(): Promise<any[]> {
    await this.inicializarBibliotecaPlatos();
    return await this.dataSource.query(`SELECT nombre FROM categorias_operativas ORDER BY nombre`);
  }

  async guardarCategoriaOperativa(data: any): Promise<any> {
    await this.inicializarBibliotecaPlatos();
    await this.dataSource.query(`INSERT INTO categorias_operativas (nombre) VALUES ($1) ON CONFLICT DO NOTHING`, [data.nombre.trim()]);
    return { success: true };
  }

  async eliminarCategoriaOperativa(nombre: string): Promise<any> {
    await this.dataSource.query(`DELETE FROM categorias_operativas WHERE nombre = $1`, [nombre]);
    return { success: true };
  }

  // --- MOTOR DE REGLAS: EXTRAER TAGS ÚNICOS DE LOS PLANES ---
  async obtenerTagsPlanesActivos(): Promise<string[]> {
    try {
      const result = await this.dataSource.query(`
        SELECT DISTINCT jsonb_array_elements_text(etiquetas) as tag
        FROM subscription_plan
        WHERE etiquetas IS NOT NULL
      `);
      return result.map((r: any) => r.tag);
    } catch (error) {
      console.error("Error obteniendo tags de planes:", error);
      return [];
    }
  }

  // =========================================================
  // SISTEMA DE RESTRICCIONES (5.6 y 5.7)
  // =========================================================
  async inicializarRestricciones() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS perfil_restricciones (
        id SERIAL PRIMARY KEY,
        profile_id INT NOT NULL,
        ingrediente_vetado VARCHAR(50) REFERENCES preparaciones(id) ON DELETE CASCADE
      )
    `);
  }

  // =========================================================
  // MOTOR DE PROCESAMIENTO PARA EL PORTAL CLIENTE
  // =========================================================
  // =========================================================
  // MOTOR DE PROCESAMIENTO PARA EL PORTAL CLIENTE
  // =========================================================
 // =========================================================
  // MOTOR DE PROCESAMIENTO PARA EL PORTAL CLIENTE
  // =========================================================
  // =========================================================
  // MOTOR DE PROCESAMIENTO PARA EL PORTAL CLIENTE Y NUTRIOPS
  // =========================================================
  async obtenerMenuProcesadoCliente(tagPlan: string, fecha: string, perfilId: number): Promise<any> {
    try {
      await this.inicializarRestricciones();
      await this.inicializarCiclos();

      const fechaLimpia = String(fecha || '').trim().substring(0, 10);

      // 1. Buscar platos en la fecha exacta seleccionada (ej. 2026-10-26)
      let platosPublicados = await this.dataSource.query(`
        SELECT p.is_default, p.target_date, m.*
        FROM published_menus p
        JOIN platos_maestros m ON p.dish_id = m.id
        WHERE SUBSTRING(TRIM(p.target_date), 1, 10) = $1
      `, [fechaLimpia]);

      // 2. RESCATE AUTOMÁTICO POR DESFASE UTC NOCTURNO (>8:00 PM UTC-4):
      // Si CiclosMenus.tsx guardó el botón "26" con fecha UTC del día siguiente ("2026-10-27") o anterior:
      if (platosPublicados.length === 0 && /^\d{4}-\d{2}-\d{2}$/.test(fechaLimpia)) {
        const baseDate = new Date(`${fechaLimpia}T12:00:00Z`);
        const masUnDia = new Date(baseDate.getTime() + 86400000).toISOString().substring(0, 10);
        const menosUnDia = new Date(baseDate.getTime() - 86400000).toISOString().substring(0, 10);

        platosPublicados = await this.dataSource.query(`
          SELECT p.is_default, p.target_date, m.*
          FROM published_menus p
          JOIN platos_maestros m ON p.dish_id = m.id
          WHERE SUBSTRING(TRIM(p.target_date), 1, 10) IN ($1, $2)
        `, [masUnDia, menosUnDia]);
      }

      // 3. Traer el diccionario de ingredientes
      const preparaciones = await this.dataSource.query(`SELECT * FROM preparaciones`);
      const mapPrep = new Map<string, any>(preparaciones.map((p: any) => [String(p.id), p]));

      // 4. Buscar REGLAS COMERCIALES
      const reglas = await this.dataSource.query(`
        SELECT * FROM reglas_sustitucion WHERE UPPER(tag_plan) = UPPER($1)
      `, [tagPlan]);

      // 5. Buscar EXCLUSIONES INDIVIDUALES
      const restricciones = await this.dataSource.query(`
        SELECT ingrediente_vetado FROM perfil_restricciones WHERE profile_id = $1
      `, [perfilId]);
      const ingredientesVetados = restricciones.map((r: any) => r.ingrediente_vetado);

      // 6. Armar el plato dinámico aplicando reglas y restricciones
      const menuProcesado = platosPublicados.map((plato: any) => {
        let composicion = plato.composicion_base;
        if (typeof composicion === 'string') {
          try { composicion = JSON.parse(composicion); } catch (e) {}
        }
        if (typeof composicion === 'string') {
          try { composicion = JSON.parse(composicion); } catch (e) {}
        }
        if (!Array.isArray(composicion)) composicion = [];

        let platoBloqueado = false;

        const composicionFinal = composicion.map((comp: any) => {
          const catComp = String(comp.categoria || comp.rol || 'General');
          const regla = reglas.find((r: any) => 
            r.plato_id === plato.id && String(r.categoria_sustituir).toUpperCase() === catComp.toUpperCase()
          );

          const idBuscado = regla ? regla.preparacion_nueva_id : (comp.preparacion_id || comp.id || comp.nombre);

          const prepFinal = mapPrep.get(String(idBuscado)) || preparaciones.find((p: any) =>
            String(p.nombre).toLowerCase().trim() === String(idBuscado).toLowerCase().trim() ||
            String(p.id).toLowerCase().trim() === String(idBuscado).toLowerCase().trim()
          );

          if (prepFinal && ingredientesVetados.includes(prepFinal.id)) {
            platoBloqueado = true;
          }

          return {
            categoria: catComp,
            nombre: prepFinal ? prepFinal.nombre : (comp.nombre || idBuscado || 'Desconocido'),
            preparacion_id: prepFinal ? prepFinal.id : idBuscado,
            modificado: !!regla
          };
        });

        return {
          id: plato.id,
          nombre_comercial: plato.nombre_comercial,
          categoria_comercial: plato.categoria_comercial,
          tipo_comida: plato.tipo_comida,
          imagen_url: plato.imagen_url,
          is_default: plato.is_default,
          composicion: composicionFinal,
          bloqueado: platoBloqueado
        };
      });

      const menusValidos = menuProcesado.filter((p: any) => !p.bloqueado);

      return {
        almuerzos: menusValidos.filter((p: any) => {
          const t = String(p.tipo_comida || 'Almuerzo').toLowerCase();
          return t.includes('almuerzo') || t.includes('lunch');
        }),
        cenas: menusValidos.filter((p: any) => {
          const t = String(p.tipo_comida || '').toLowerCase();
          return t.includes('cena') || t.includes('dinner');
        })
      };
    } catch (error) {
      console.error("Error procesando menú del cliente:", error);
      return { almuerzos: [], cenas: [] };
    }
  }

  // =========================================================
  // MÓDULO DE CICLOS DE MENÚS (CARTELERA DE PUBLICACIÓN)
  // =========================================================
  async inicializarCiclos() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS published_menus (
        id SERIAL PRIMARY KEY,
        target_date VARCHAR(20) NOT NULL,
        dish_id VARCHAR(50) REFERENCES platos_maestros(id) ON DELETE CASCADE,
        is_default BOOLEAN DEFAULT false,
        UNIQUE(target_date, dish_id)
      )
    `);
  }

  async obtenerCiclosPublicados(): Promise<any[]> {
    await this.inicializarCiclos();
    return await this.dataSource.query(`
      SELECT p.id, p.target_date, p.dish_id, p.is_default, 
             m.nombre_comercial, m.tipo_comida, m.imagen_url, m.categoria_comercial
      FROM published_menus p
      JOIN platos_maestros m ON p.dish_id = m.id
      ORDER BY p.target_date ASC
    `);
  }

  async guardarPlatoEnCiclo(data: any): Promise<any> {
    await this.inicializarCiclos();
    const fechaNormalizada = String(data.target_date || '').trim().substring(0, 10);

    if (data.is_default) {
      const plato = await this.dataSource.query(`SELECT tipo_comida FROM platos_maestros WHERE id = $1`, [data.dish_id]);
      if (plato.length > 0) {
        await this.dataSource.query(`
          UPDATE published_menus SET is_default = false 
          WHERE SUBSTRING(TRIM(target_date), 1, 10) = $1 
            AND dish_id IN (SELECT id FROM platos_maestros WHERE tipo_comida = $2)
        `, [fechaNormalizada, plato[0].tipo_comida]);
      }
    }

    await this.dataSource.query(`
      INSERT INTO published_menus (target_date, dish_id, is_default)
      VALUES ($1, $2, $3)
      ON CONFLICT (target_date, dish_id) DO UPDATE SET is_default = $3
    `, [fechaNormalizada, data.dish_id, data.is_default]);

    return { success: true };
  }

  async eliminarPlatoDeCiclo(id: number): Promise<any> {
    await this.dataSource.query(`DELETE FROM published_menus WHERE id = $1`, [id]);
    return { success: true };
  }

  async obtenerRestriccionesPerfil(perfilId: number) {
    await this.inicializarRestricciones();
    const res = await this.dataSource.query(`SELECT ingrediente_vetado FROM perfil_restricciones WHERE profile_id = $1`, [perfilId]);
    return res.map((r: any) => r.ingrediente_vetado);
  }

  async actualizarRestriccionesPerfil(perfilId: number, vetados: string[]) {
    await this.inicializarRestricciones();
    await this.dataSource.query(`DELETE FROM perfil_restricciones WHERE profile_id = $1`, [perfilId]);

    for (const vetado of vetados) {
      await this.dataSource.query(`INSERT INTO perfil_restricciones (profile_id, ingrediente_vetado) VALUES ($1, $2)`, [perfilId, vetado]);
    }
    return { success: true };
  }

  // =========================================================
  // CATÁLOGO DINÁMICO DE RESTRICCIONES (CONTROLADAS POR ADMIN)
  // =========================================================
  async inicializarOpcionesRestricciones() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS opciones_restricciones (
        id VARCHAR(50) PRIMARY KEY,
        icono VARCHAR(10),
        nombre VARCHAR(100)
      )
    `);
  }

  async obtenerOpcionesRestricciones() {
    await this.inicializarOpcionesRestricciones();
    return await this.dataSource.query(`SELECT * FROM opciones_restricciones ORDER BY nombre ASC`);
  }

  async agregarOpcionRestriccion(data: { id: string, icono: string, nombre: string }) {
    await this.inicializarOpcionesRestricciones();
    await this.dataSource.query(
      `INSERT INTO opciones_restricciones (id, icono, nombre) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET icono = $2, nombre = $3`,
      [data.id, data.icono, data.nombre]
    );
    return { success: true };
  }

  async eliminarOpcionRestriccion(id: string) {
    await this.dataSource.query(`DELETE FROM opciones_restricciones WHERE id = $1`, [id]);
    return { success: true };
  }

  // =========================================================
  // NUTRIOPS: MOTOR DE INVENTARIOS (DOC 06), PRODUCCIÓN (DOC 05) Y EMPAQUE (DOC 07)
  // =========================================================
  async inicializarInventario() {
    await this.inicializarBibliotecaPlatos();
    try {
      await this.dataSource.query(`ALTER TABLE preparaciones ADD COLUMN IF NOT EXISTS categoria VARCHAR(100) DEFAULT 'Proteico'`);
    } catch (e) {}

    // 1. Maestro de Ítems de Inventario (Doc 06 - Sec. 4 y 5)
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS inventario_insumos (
        preparacion_id VARCHAR(100) PRIMARY KEY,
        nombre_custom VARCHAR(150),
        categoria_custom VARCHAR(100),
        tipo_item VARCHAR(40) DEFAULT 'MATERIA_PRIMA',
        unidad VARCHAR(20) DEFAULT 'g',
        presentacion_compra VARCHAR(80) DEFAULT 'Bolsa x 1.000 g',
        factor_conversion INT DEFAULT 1000,
        stock_actual DECIMAL(12,2) DEFAULT 5000.00,
        stock_minimo DECIMAL(12,2) DEFAULT 2000.00,
        costo_promedio DECIMAL(12,4) DEFAULT 0.0150,
        ubicacion VARCHAR(60) DEFAULT 'Cuarto Frío',
        proveedor VARCHAR(100) DEFAULT 'Proveedor Central',
        gramos_por_racion INT DEFAULT 150,
        estacion VARCHAR(60) DEFAULT 'Calientes',
        anticipacion_dias INT DEFAULT 0
      )
    `);

    try {
      await this.dataSource.query(`ALTER TABLE inventario_insumos DROP CONSTRAINT IF EXISTS inventario_insumos_preparacion_id_fkey`);
    } catch (e) {}

    const alterCols = [
      `ALTER TABLE inventario_insumos ADD COLUMN IF NOT EXISTS nombre_custom VARCHAR(150)`,
      `ALTER TABLE inventario_insumos ADD COLUMN IF NOT EXISTS categoria_custom VARCHAR(100)`,
      `ALTER TABLE inventario_insumos ADD COLUMN IF NOT EXISTS tipo_item VARCHAR(40) DEFAULT 'MATERIA_PRIMA'`,
      `ALTER TABLE inventario_insumos ADD COLUMN IF NOT EXISTS presentacion_compra VARCHAR(80) DEFAULT 'Bolsa x 1.000 g'`,
      `ALTER TABLE inventario_insumos ADD COLUMN IF NOT EXISTS factor_conversion INT DEFAULT 1000`,
      `ALTER TABLE inventario_insumos ADD COLUMN IF NOT EXISTS costo_promedio DECIMAL(12,4) DEFAULT 0.0150`,
      `ALTER TABLE inventario_insumos ADD COLUMN IF NOT EXISTS ubicacion VARCHAR(60) DEFAULT 'Cuarto Frío'`,
      `ALTER TABLE inventario_insumos ADD COLUMN IF NOT EXISTS proveedor VARCHAR(100) DEFAULT 'Proveedor Central'`,
      `ALTER TABLE inventario_insumos ADD COLUMN IF NOT EXISTS gramos_por_racion INT DEFAULT 150`,
      `ALTER TABLE inventario_insumos ADD COLUMN IF NOT EXISTS estacion VARCHAR(60) DEFAULT 'Calientes'`,
      `ALTER TABLE inventario_insumos ADD COLUMN IF NOT EXISTS anticipacion_dias INT DEFAULT 0`
    ];
    for (const q of alterCols) {
      try { await this.dataSource.query(q); } catch (e) {}
    }

    // 2. Lotes Físicos para Trazabilidad y FEFO (Doc 06 - Sec. 7 y 8)
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS lotes_inventario (
        id SERIAL PRIMARY KEY,
        item_id VARCHAR(100),
        codigo_lote VARCHAR(60),
        origen VARCHAR(40) DEFAULT 'RECEPCION',
        fecha_ingreso VARCHAR(20),
        fecha_vencimiento VARCHAR(20),
        cantidad_inicial DECIMAL(12,2),
        saldo_actual DECIMAL(12,2),
        ubicacion VARCHAR(60) DEFAULT 'Cuarto Frío',
        estado VARCHAR(30) DEFAULT 'DISPONIBLE'
      )
    `);

    // 3. Kardex / Movimientos de Inventario Lógico (Doc 06 - Sec. 6)
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS movimientos_kardex (
        id SERIAL PRIMARY KEY,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        item_id VARCHAR(100),
        nombre_item VARCHAR(150),
        tipo_movimiento VARCHAR(40),
        cantidad DECIMAL(12,2),
        unidad VARCHAR(20),
        costo_unitario DECIMAL(12,4),
        motivo VARCHAR(200),
        usuario VARCHAR(80) DEFAULT 'Jefe de Planta'
      )
    `);

    // 4. Órdenes de Compra y Recepción de Mercancía (Doc 06 - Sec. 13 a 18)
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS ordenes_compra (
        id SERIAL PRIMARY KEY,
        codigo_oc VARCHAR(40),
        proveedor VARCHAR(100),
        item_id VARCHAR(100),
        nombre_item VARCHAR(150),
        presentacion VARCHAR(80),
        factor_conversion INT DEFAULT 1000,
        cantidad_ordenada DECIMAL(10,2),
        cantidad_recibida DECIMAL(10,2) DEFAULT 0,
        cantidad_aceptada DECIMAL(10,2) DEFAULT 0,
        cantidad_rechazada DECIMAL(10,2) DEFAULT 0,
        costo_presentacion DECIMAL(12,2) DEFAULT 15.00,
        temperatura_recepcion VARCHAR(30),
        fecha_vencimiento_lote VARCHAR(20),
        motivo_rechazo VARCHAR(150),
        estado VARCHAR(30) DEFAULT 'ENVIADA',
        fecha_creacion VARCHAR(20)
      )
    `);

    // 5. Conciliaciones de Conteo Físico Ciego (Doc 06 - Sec. 25 a 28)
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS conciliaciones_inventario (
        id SERIAL PRIMARY KEY,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        item_id VARCHAR(100),
        nombre_item VARCHAR(150),
        saldo_logico DECIMAL(12,2),
        conteo_fisico DECIMAL(12,2),
        diferencia DECIMAL(12,2),
        impacto_economico DECIMAL(12,2),
        motivo VARCHAR(120),
        estado VARCHAR(30) DEFAULT 'APROBADA'
      )
    `);

    // 6. Ejecución de Lotes de Producción en Caliente (Doc 05 - Sec. 14 y 15)
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS lotes_produccion (
        lote_key VARCHAR(150) PRIMARY KEY,
        fecha VARCHAR(20),
        item_id VARCHAR(100),
        nombre_preparacion VARCHAR(150),
        estacion VARCHAR(60),
        origen VARCHAR(30) DEFAULT 'DEMANDA',
        cantidad_planeada DECIMAL(12,2),
        cantidad_obtenida DECIMAL(12,2) DEFAULT 0,
        cantidad_utilizable DECIMAL(12,2) DEFAULT 0,
        merma DECIMAL(12,2) DEFAULT 0,
        motivo_desviacion VARCHAR(150),
        estado VARCHAR(30) DEFAULT 'PENDIENTE'
      )
    `);

    // 7. Unidades Físicas de Ensamble y Consolidación (Doc 07 - Sec. 5 a 22)
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS ordenes_operativas (
        orden_key VARCHAR(150) PRIMARY KEY,
        fecha VARCHAR(20),
        perfil_id INT,
        cliente VARCHAR(100),
        tipo_comida VARCHAR(30),
        plato VARCHAR(150),
        estado_empaque VARCHAR(30) DEFAULT 'PENDIENTE',
        estado_despacho VARCHAR(30) DEFAULT 'EN_PLANTA',
        unidades_verificadas INT DEFAULT 0,
        lote_descontado BOOLEAN DEFAULT FALSE
      )
    `);
    try {
      await this.dataSource.query(`ALTER TABLE ordenes_operativas ADD COLUMN IF NOT EXISTS unidades_verificadas INT DEFAULT 0`);
    } catch (e) {}
    // SIN SEMILLAS AUTOMÁTICAS: Solo se mostrará lo que el usuario cree realmente.
  }

  async obtenerInventario() {
    await this.inicializarInventario();
    const rows = await this.dataSource.query(`
      SELECT 
        i.preparacion_id as id,
        COALESCE(p.nombre, i.nombre_custom, i.preparacion_id) as nombre,
        COALESCE(p.categoria_operativa, i.categoria_custom, p.categoria, 'General') as categoria,
        COALESCE(i.tipo_item, 'MATERIA_PRIMA') as tipo_item,
        COALESCE(i.unidad, 'g') as unidad,
        COALESCE(i.presentacion_compra, 'Bolsa x 1.000 g') as presentacion_compra,
        COALESCE(i.factor_conversion, 1000) as factor_conversion,
        COALESCE(i.stock_actual, 0) as stock_actual,
        COALESCE(i.stock_minimo, 2000) as stock_minimo,
        COALESCE(i.costo_promedio, 0.0150) as costo_promedio,
        COALESCE(i.ubicacion, 'Cuarto Frío') as ubicacion,
        COALESCE(i.proveedor, 'Proveedor Central') as proveedor,
        COALESCE(i.gramos_por_racion, 150) as gramos_por_racion,
        COALESCE(i.estacion, 'Calientes') as estacion,
        COALESCE(i.anticipacion_dias, 0) as anticipacion_dias
      FROM inventario_insumos i
      LEFT JOIN preparaciones p ON CAST(p.id AS VARCHAR) = i.preparacion_id
      ORDER BY i.tipo_item ASC, nombre ASC
    `);
    return rows;
  }

  // Crear nuevo ítem en el Maestro de Inventario y sincronizarlo con las Categorías Oficiales del AdminHub
  async crearItemMaestroInventario(data: any) {
    await this.inicializarInventario();
    const nombreLimpio = String(data.nombre || '').trim();
    const tipoItem = data.tipo_item || 'MATERIA_PRIMA';
    const categoriaLimpia = tipoItem === 'EMPAQUE' ? 'Empaque' : String(data.categoria || 'Proteico').trim();
    const unidad = tipoItem === 'EMPAQUE' ? 'und' : (data.unidad || 'g');
    const idItem = data.id || nombreLimpio.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // 1. Si es Materia Prima o Intermedio, asegurar la categoría en categorias_operativas e insertarlo en preparaciones para que salga en el AdminHub
    if (tipoItem !== 'EMPAQUE') {
      try {
        await this.dataSource.query(
          `INSERT INTO categorias_operativas (nombre) VALUES ($1) ON CONFLICT DO NOTHING`,
          [categoriaLimpia]
        );
        await this.dataSource.query(
          `INSERT INTO preparaciones (id, nombre, categoria_operativa, categoria) 
           VALUES ($1, $2, $3, $3) 
           ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, categoria_operativa = EXCLUDED.categoria_operativa, categoria = EXCLUDED.categoria`,
          [idItem, nombreLimpio, categoriaLimpia]
        );
      } catch (err) {
        console.error('Aviso sincronizando preparación con AdminHub:', err);
      }
    }

    // 2. Insertar en el Maestro de Inventario de NutriOps
    const stockInicialBase = Number(data.stock_inicial_base || 0);
    await this.dataSource.query(`
      INSERT INTO inventario_insumos (
        preparacion_id, nombre_custom, categoria_custom, tipo_item, unidad,
        presentacion_compra, factor_conversion, stock_actual, stock_minimo,
        costo_promedio, ubicacion, proveedor, gramos_por_racion, estacion, anticipacion_dias
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (preparacion_id) DO UPDATE SET
        nombre_custom = EXCLUDED.nombre_custom,
        categoria_custom = EXCLUDED.categoria_custom,
        tipo_item = EXCLUDED.tipo_item,
        unidad = EXCLUDED.unidad,
        presentacion_compra = EXCLUDED.presentacion_compra,
        factor_conversion = EXCLUDED.factor_conversion,
        stock_actual = EXCLUDED.stock_actual,
        stock_minimo = EXCLUDED.stock_minimo,
        ubicacion = EXCLUDED.ubicacion,
        proveedor = EXCLUDED.proveedor,
        gramos_por_racion = EXCLUDED.gramos_por_racion,
        estacion = EXCLUDED.estacion,
        anticipacion_dias = EXCLUDED.anticipacion_dias
    `, [
      idItem, nombreLimpio, categoriaLimpia, tipoItem,
      unidad, data.presentacion_compra || 'Bolsa x 1.000 g', Number(data.factor_conversion || 1000),
      stockInicialBase, Number(data.stock_minimo || 2000), Number(data.costo_promedio || 0.015),
      data.ubicacion || 'Cuarto Frío', data.proveedor || 'Proveedor Central',
      Number(data.gramos_por_racion || 150), data.estacion || 'Calientes', Number(data.anticipacion_dias || 0)
    ]);

    // 3. Crear su lote FEFO inicial y registrar en Kardex
    if (stockInicialBase > 0) {
      const codigoLote = `LOT-INI-${Math.floor(100 + Math.random() * 900)}`;
      const vencDefault = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
      await this.dataSource.query(`
        INSERT INTO lotes_inventario (item_id, codigo_lote, origen, fecha_ingreso, fecha_vencimiento, cantidad_inicial, saldo_actual, ubicacion, estado)
        VALUES ($1, $2, 'SALDO_INICIAL', $3, $4, $5, $5, $6, 'DISPONIBLE')
      `, [idItem, codigoLote, new Date().toISOString().split('T')[0], vencDefault, stockInicialBase, data.ubicacion || 'Cuarto Frío']);

      await this.dataSource.query(`
        INSERT INTO movimientos_kardex (item_id, nombre_item, tipo_movimiento, cantidad, unidad, costo_unitario, motivo)
        VALUES ($1, $2, 'SALDO_INICIAL', $3, $4, $5, $6)
      `, [idItem, nombreLimpio, stockInicialBase, unidad, Number(data.costo_promedio || 0.015), `Alta en Maestro de Bodega (${codigoLote})`]);
    }

    return { success: true, id: idItem };
  }

  // Actualizar Parámetros Técnicos del Ítem (Doc 06 RI-003)
  async actualizarItemInventario(id: string, data: any) {
    await this.inicializarInventario();
    await this.dataSource.query(`
      UPDATE inventario_insumos 
      SET stock_minimo = $2,
          gramos_por_racion = $3,
          presentacion_compra = COALESCE($4, presentacion_compra),
          factor_conversion = COALESCE($5, factor_conversion),
          ubicacion = COALESCE($6, ubicacion),
          proveedor = COALESCE($7, proveedor),
          estacion = COALESCE($8, estacion),
          anticipacion_dias = COALESCE($9, anticipacion_dias),
          tipo_item = COALESCE($10, tipo_item)
      WHERE preparacion_id = $1
    `, [
      String(id), Number(data.stock_minimo), Number(data.gramos_por_racion),
      data.presentacion_compra, data.factor_conversion ? Number(data.factor_conversion) : null,
      data.ubicacion, data.proveedor, data.estacion,
      data.anticipacion_dias !== undefined ? Number(data.anticipacion_dias) : null,
      data.tipo_item
    ]);
    return { success: true };
  }

  // CREAR ORDEN DE COMPRA DESDE PROPUESTA DE CICLO (Doc 06 - Sec. 12 y 13)
  async crearOrdenCompra(data: any) {
    await this.inicializarInventario();
    const codigo = `OC-${new Date().toISOString().slice(5, 10).replace('-', '')}-${Math.floor(100 + Math.random() * 900)}`;
    await this.dataSource.query(`
      INSERT INTO ordenes_compra (
        codigo_oc, proveedor, item_id, nombre_item, presentacion, factor_conversion,
        cantidad_ordenada, costo_presentacion, estado, fecha_creacion
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ENVIADA', $9)
    `, [
      codigo, data.proveedor || 'Proveedor Central', String(data.item_id), data.nombre_item,
      data.presentacion || 'Bolsa x 1.000 g', Number(data.factor_conversion || 1000),
      Number(data.cantidad_ordenada || 1), Number(data.costo_presentacion || 18.00),
      new Date().toISOString().split('T')[0]
    ]);
    return { success: true, codigo_oc: codigo };
  }

  // RECEPCIÓN DE MERCANCÍA + CONVERSIÓN A UNIDAD BASE + PROMEDIO PONDERADO + FEFO (Doc 06 - Sec. 16 a 21)
  async recibirOrdenCompra(ocId: number, data: { recibida: number, aceptada: number, rechazada: number, costo_presentacion: number, temperatura: string, fecha_vencimiento: string, motivo_rechazo?: string }) {
    await this.inicializarInventario();
    const ocs = await this.dataSource.query(`SELECT * FROM ordenes_compra WHERE id = $1`, [Number(ocId)]);
    if (!ocs.length) return { success: false, message: 'Orden de Compra no encontrada' };
    const oc = ocs[0];

    const aceptadaPres = Number(data.aceptada || 0);
    const rechazadaPres = Number(data.rechazada || 0);
    const recibidaPres = Number(data.recibida || (aceptadaPres + rechazadaPres));
    const factor = Number(oc.factor_conversion || 1000);

    // RI-002 y RI-005: Solo la cantidad aceptada convertida a unidad base ingresa al inventario lógico
    const ingresoUnidadBase = +(aceptadaPres * factor).toFixed(2);
    const estadoFinal = aceptadaPres < Number(oc.cantidad_ordenada) ? 'PARCIAL' : 'RECIBIDA';

    await this.dataSource.query(`
      UPDATE ordenes_compra
      SET cantidad_recibida = $2, cantidad_aceptada = $3, cantidad_rechazada = $4,
          costo_presentacion = $5, temperatura_recepcion = $6, fecha_vencimiento_lote = $7,
          motivo_rechazo = $8, estado = $9
      WHERE id = $1
    `, [Number(ocId), recibidaPres, aceptadaPres, rechazadaPres, Number(data.costo_presentacion || oc.costo_presentacion), data.temperatura || '4°C OK', data.fecha_vencimiento, data.motivo_rechazo || '', estadoFinal]);

    if (ingresoUnidadBase > 0) {
      const items = await this.dataSource.query(`SELECT * FROM inventario_insumos WHERE preparacion_id = $1`, [oc.item_id]);
      const itemActual = items[0];
      const stockAnterior = Number(itemActual?.stock_actual || 0);
      const costoAnterior = Number(itemActual?.costo_promedio || 0.015);
      const valorAnterior = stockAnterior * costoAnterior;
      const valorEntrada = aceptadaPres * Number(data.costo_presentacion || oc.costo_presentacion);
      const nuevoStock = +(stockAnterior + ingresoUnidadBase).toFixed(2);

      // RI-009: Nuevo Costo Promedio Ponderado por unidad base
      const nuevoCostoPromedio = nuevoStock > 0 ? +((valorAnterior + valorEntrada) / nuevoStock).toFixed(4) : costoAnterior;

      await this.dataSource.query(`
        UPDATE inventario_insumos SET stock_actual = $2, costo_promedio = $3 WHERE preparacion_id = $1
      `, [oc.item_id, nuevoStock, nuevoCostoPromedio]);

      // Crear Lote físico con vencimiento para FEFO
      const codigoLote = `LOT-${oc.codigo_oc.replace('OC-', '')}`;
      await this.dataSource.query(`
        INSERT INTO lotes_inventario (item_id, codigo_lote, origen, fecha_ingreso, fecha_vencimiento, cantidad_inicial, saldo_actual, ubicacion, estado)
        VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'DISPONIBLE')
      `, [oc.item_id, codigoLote, `OC ${oc.codigo_oc}`, new Date().toISOString().split('T')[0], data.fecha_vencimiento || '2026-11-15', ingresoUnidadBase, itemActual?.ubicacion || 'Cuarto Frío']);

      // Registrar en Kardex
      await this.dataSource.query(`
        INSERT INTO movimientos_kardex (item_id, nombre_item, tipo_movimiento, cantidad, unidad, costo_unitario, motivo)
        VALUES ($1, $2, 'ENTRADA_RECEPCION', $3, $4, $5, $6)
      `, [oc.item_id, oc.nombre_item, ingresoUnidadBase, itemActual?.unidad || 'g', nuevoCostoPromedio, `Recepción ${oc.codigo_oc} (${aceptadaPres} pres. aceptadas, ${rechazadaPres} rechazadas)`]);
    }

    return { success: true, ingresoUnidadBase };
  }

  // CONTEO FÍSICO CIEGO Y CONCILIACIÓN AUDITADA (Doc 06 - Sec. 25 a 28)
  async registrarConciliacionFisica(data: { item_id: string, conteo_fisico: number, motivo: string }) {
    await this.inicializarInventario();
    const inv = await this.obtenerInventario();
    const item = inv.find((i: any) => String(i.id) === String(data.item_id));
    if (!item) return { success: false, message: 'Ítem no encontrado en bodega' };

    const saldoLogico = Number(item.stock_actual);
    const conteoFisico = Number(data.conteo_fisico);
    const diferencia = +(conteoFisico - saldoLogico).toFixed(2);
    const impacto = +(diferencia * Number(item.costo_promedio || 0.015)).toFixed(2);

    await this.dataSource.query(`
      INSERT INTO conciliaciones_inventario (item_id, nombre_item, saldo_logico, conteo_fisico, diferencia, impacto_economico, motivo, estado)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'APROBADA')
    `, [String(item.id), item.nombre, saldoLogico, conteoFisico, diferencia, impacto, data.motivo || 'Conciliación de conteo físico']);

    // Actualizar saldo lógico mediante movimiento de ajuste
    await this.dataSource.query(`
      UPDATE inventario_insumos SET stock_actual = $2 WHERE preparacion_id = $1
    `, [String(item.id), conteoFisico]);

    await this.dataSource.query(`
      INSERT INTO movimientos_kardex (item_id, nombre_item, tipo_movimiento, cantidad, unidad, costo_unitario, motivo)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      String(item.id), item.nombre,
      diferencia >= 0 ? 'AJUSTE_POSITIVO' : 'AJUSTE_NEGATIVO',
      diferencia, item.unidad, Number(item.costo_promedio || 0.015),
      `Conciliación Física: ${data.motivo}`
    ]);

    return { success: true, saldoLogico, conteoFisico, diferencia, impacto };
  }

  // FINALIZAR LOTE DE PRODUCCIÓN EN CALIENTE CON RENDIMIENTO, MERMA Y CONSUMO FEFO (Doc 05 - Sec. 14 a 17)
  async finalizarLoteProduccion(data: { lote_key: string, fecha: string, item_id: string, nombre: string, estacion: string, planeado: number, obtenido: number, utilizable: number, motivo_desviacion?: string }) {
    await this.inicializarInventario();
    const planeado = Number(data.planeado);
    const obtenido = Number(data.obtenido);
    const utilizable = Number(data.utilizable);
    const merma = Math.max(0, +(planeado - utilizable).toFixed(2));

    await this.dataSource.query(`
      INSERT INTO lotes_produccion (lote_key, fecha, item_id, nombre_preparacion, estacion, cantidad_planeada, cantidad_obtenida, cantidad_utilizable, merma, motivo_desviacion, estado)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'FINALIZADA')
      ON CONFLICT (lote_key) DO UPDATE SET
        cantidad_obtenida = EXCLUDED.cantidad_obtenida,
        cantidad_utilizable = EXCLUDED.cantidad_utilizable,
        merma = EXCLUDED.merma,
        motivo_desviacion = EXCLUDED.motivo_desviacion,
        estado = 'FINALIZADA'
    `, [data.lote_key, data.fecha, String(data.item_id), data.nombre, data.estacion, planeado, obtenido, utilizable, merma, data.motivo_desviacion || 'Dentro de tolerancia (±5%)']);

    // Descontar consumo teórico del inventario lógico y del lote más próximo a vencer (FEFO)
    const items = await this.dataSource.query(`SELECT * FROM inventario_insumos WHERE preparacion_id = $1`, [String(data.item_id)]);
    if (items.length) {
      const it = items[0];
      
      // Cambio clave: La variable de descuento ahora es lo que el chef digitó como utilizable
      const cantidadADescontar = utilizable; 
      
      const nuevoStock = Math.max(0, +(Number(it.stock_actual) - cantidadADescontar).toFixed(2));
      await this.dataSource.query(`UPDATE inventario_insumos SET stock_actual = $2 WHERE preparacion_id = $1`, [String(data.item_id), nuevoStock]);

      // Descontar en orden FEFO de lotes_inventario
      let porDescontar = cantidadADescontar;
      const lotesFefo = await this.dataSource.query(`
        SELECT * FROM lotes_inventario WHERE item_id = $1 AND estado = 'DISPONIBLE' AND saldo_actual > 0 ORDER BY fecha_vencimiento ASC
      `, [String(data.item_id)]);
      
      for (const l of lotesFefo) {
        if (porDescontar <= 0) break;
        const desc = Math.min(Number(l.saldo_actual), porDescontar);
        const nuevoSaldoLote = +(Number(l.saldo_actual) - desc).toFixed(2);
        await this.dataSource.query(`
          UPDATE lotes_inventario SET saldo_actual = $2, estado = CASE WHEN CAST($2 AS numeric) <= 0 THEN 'AGOTADO' ELSE 'DISPONIBLE' END WHERE id = $1
        `, [l.id, nuevoSaldoLote]);
        porDescontar -= desc;
      }

      // Registro en Kardex reflejando el consumo real extraído
      await this.dataSource.query(`
        INSERT INTO movimientos_kardex (item_id, nombre_item, tipo_movimiento, cantidad, unidad, costo_unitario, motivo)
        VALUES ($1, $2, 'CONSUMO_PRODUCCION', $3, $4, $5, $6)
      `, [String(data.item_id), data.nombre, -cantidadADescontar, it.unidad || 'g', Number(it.costo_promedio || 0.015), `Lote Cocina ${data.lote_key} (Utilizable: ${utilizable}g, Planeado: ${planeado}g, Merma: ${merma}g)`]);
    }
    return { success: true };
  }

  // VERIFICAR UNIDADES DE ENSAMBLE Y DESCONTAR KITS DE EMPAQUE DINÁMICAMENTE (Doc 07 - Sec. 5, 15, 17 y 20)
  async cambiarEstadoOrden(data: { orden_key: string, fecha: string, perfil_id: number, cliente: string, tipo_comida: string, plato: string, campo: 'empaque' | 'despacho', valor: string, unidades_esperadas?: number }) {
    await this.inicializarInventario();
    const col = data.campo === 'empaque' ? 'estado_empaque' : 'estado_despacho';
    const unidVerificadas = data.valor === 'EMPACADO' ? Number(data.unidades_esperadas || 1) : 0;

    await this.dataSource.query(`
      INSERT INTO ordenes_operativas (orden_key, fecha, perfil_id, cliente, tipo_comida, plato, ${col}, unidades_verificadas)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (orden_key) DO UPDATE SET ${col} = EXCLUDED.${col}, unidades_verificadas = EXCLUDED.unidades_verificadas
    `, [data.orden_key, data.fecha, data.perfil_id, data.cliente, data.tipo_comida, data.plato, data.valor, unidVerificadas]);

    // Descuento dinámico sobre cualquier ítem tipo EMPAQUE registrado por el usuario
    if (data.campo === 'empaque' && data.valor === 'EMPACADO') {
      const unidades = Number(data.unidades_esperadas || 1);
      const empaques = await this.dataSource.query(`SELECT * FROM inventario_insumos WHERE tipo_item = 'EMPAQUE'`);

      for (const emp of empaques) {
        const nom = String(emp.nombre_custom || emp.preparacion_id).toLowerCase();
        let cantDescontar = 0;
        if (nom.includes('etiqueta') || nom.includes('qr')) {
          cantDescontar = unidades;
        } else if (nom.includes('sopa')) {
          cantDescontar = unidades > 1 ? 1 : 0;
        } else {
          cantDescontar = 1;
        }

        if (cantDescontar > 0) {
          await this.dataSource.query(
            `UPDATE inventario_insumos SET stock_actual = GREATEST(0, stock_actual - $2) WHERE preparacion_id = $1`,
            [emp.preparacion_id, cantDescontar]
          );
          await this.dataSource.query(`
            INSERT INTO movimientos_kardex (item_id, nombre_item, tipo_movimiento, cantidad, unidad, costo_unitario, motivo)
            VALUES ($1, $2, 'SALIDA_EMPAQUE', $3, 'und', $4, $5)
          `, [emp.preparacion_id, emp.nombre_custom || emp.preparacion_id, -cantDescontar, Number(emp.costo_promedio || 0.25), `Ensamble verificado ${data.orden_key} (${data.cliente})`]);
        }
      }
    }

    return { success: true };
  }

  async descontarLoteInventario(fecha: string) {
    const dashboard = await this.obtenerDashboardLogistica(fecha);
    if (dashboard.resumen.loteDescontado) {
      return { success: false, message: 'La Orden Maestra de esta jornada ya fue descontada del inventario lógico.' };
    }

    for (const lote of dashboard.lotesCocina) {
      if (lote.estado !== 'FINALIZADA') {
        await this.finalizarLoteProduccion({
          lote_key: lote.lote_key,
          fecha,
          item_id: lote.id,
          nombre: lote.nombre,
          estacion: lote.estacion,
          planeado: lote.gramos_totales,
          obtenido: lote.gramos_totales,
          utilizable: lote.gramos_totales,
          motivo_desviacion: 'Cierre masivo de Orden Maestra'
        });
      }
    }

    for (const ord of dashboard.ordenesCocina) {
      await this.dataSource.query(`
        INSERT INTO ordenes_operativas (orden_key, fecha, perfil_id, cliente, tipo_comida, plato, lote_descontado)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        ON CONFLICT (orden_key) DO UPDATE SET lote_descontado = TRUE
      `, [ord.orden_key, fecha, ord.perfil_id, ord.cliente, ord.tipo_comida, ord.plato]);
    }

    return { success: true };
  }

  // DASHBOARD CENTRAL DE NUTRIOPS (CONSOLIDA DOC 05, DOC 06 Y DOC 07)
  async obtenerDashboardLogistica(fecha: string) {
    await this.inicializarInventario();

    // Tabla para persistir la Dirección Única por Cuenta (configurable por el Cliente/Admin) y estado de ruta
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS cuentas_direcciones (
        cuenta_id VARCHAR(50) PRIMARY KEY,
        titular VARCHAR(120),
        direccion TEXT,
        zona VARCHAR(80),
        ventana VARCHAR(80),
        telefono VARCHAR(50),
        notas_entrega TEXT,
        repartidor VARCHAR(100) DEFAULT 'Sin asignar'
      );
    `);

    await this.dataSource.query(`
      INSERT INTO cuentas_direcciones (cuenta_id, titular, direccion, zona, ventana, telefono, notas_entrega, repartidor)
      VALUES ('CTA-FAM-101', 'Familia Rangel Palma', 'Transversal 78 #45-12, Apto 502', 'Bogotá Norte (01)', 'Franja AM (05:00 - 07:00)', '+57 310 455 8920', 'Dejar en portería con vigilancia si no contestan citófono.', 'Carlos Mendoza (Moto #04)')
      ON CONFLICT (cuenta_id) DO NOTHING;
    `);

    const dirRows = await this.dataSource.query(`SELECT * FROM cuentas_direcciones`);
    const mapaDir = new Map<string, any>(dirRows.map((d: any) => [d.cuenta_id, d]));
    const dirFam = mapaDir.get('CTA-FAM-101') || {};

    const suscriptoresActivos = [
      {
        id: 1,
        cuenta_id: 'CTA-FAM-101',
        titular: dirFam.titular || 'Familia Rangel Palma',
        nombre: 'Juan Sebastián',
        plan: 'LOW CARB',
        categoria_plan: 'ESENCIAL',
        extra_proteina: false,
        direccion: dirFam.direccion || 'Transversal 78 #45-12, Apto 502',
        zona: dirFam.zona || 'Bogotá Norte (01)',
        ventana: dirFam.ventana || 'Franja AM (05:00 - 07:00)',
        telefono: dirFam.telefono || '+57 310 455 8920',
        notas_entrega: dirFam.notas_entrega || 'Dejar en portería',
        repartidor: dirFam.repartidor || 'Carlos Mendoza (Moto #04)'
      },
      {
        id: 2,
        cuenta_id: 'CTA-FAM-101',
        titular: dirFam.titular || 'Familia Rangel Palma',
        nombre: 'María Paula',
        plan: 'KETO FRIENDLY',
        categoria_plan: 'PREMIUM',
        extra_proteina: true,
        direccion: dirFam.direccion || 'Transversal 78 #45-12, Apto 502',
        zona: dirFam.zona || 'Bogotá Norte (01)',
        ventana: dirFam.ventana || 'Franja AM (05:00 - 07:00)',
        telefono: dirFam.telefono || '+57 310 455 8920',
        notas_entrega: dirFam.notas_entrega || 'Dejar en portería',
        repartidor: dirFam.repartidor || 'Carlos Mendoza (Moto #04)'
      }
    ];

    const estadosGuardados = await this.dataSource.query(`SELECT * FROM ordenes_operativas WHERE fecha = $1`, [fecha]);
    const mapaEstados = new Map<string, any>();
    estadosGuardados.forEach((e: any) => mapaEstados.set(e.orden_key, e));

    const lotesGuardados = await this.dataSource.query(`SELECT * FROM lotes_produccion WHERE fecha = $1`, [fecha]);
    const mapaLotesProd = new Map<string, any>();
    lotesGuardados.forEach((l: any) => mapaLotesProd.set(l.lote_key, l));

    const ordenesCocina: any[] = [];
    const requerimientoInsumos = new Map<string, { raciones: number, gramosTotales: number }>();

    for (const sub of suscriptoresActivos) {
      try {
        const menuUsuario = await this.obtenerMenuProcesadoCliente(sub.plan, fecha, sub.id);
        const servicios = [
          { tipo: 'Almuerzo', lista: menuUsuario?.almuerzos || [] },
          { tipo: 'Cena', lista: menuUsuario?.cenas || [] }
        ];

        for (const serv of servicios) {
          const platoElegido = serv.lista.find((p: any) => p.is_default) || serv.lista[0];
          if (platoElegido) {
            const ordenKey = `${fecha}-P${sub.id}-${serv.tipo.toUpperCase()}`;
            const estadoDB = mapaEstados.get(ordenKey);
            const comps = platoElegido.composicion || [];

            const tieneSopa = comps.some((c: any) => String(c.categoria || '').toLowerCase().includes('sopa') || String(c.nombre || '').toLowerCase().includes('sopa') || String(c.nombre || '').toLowerCase().includes('crema'));
            const unidadesFisicas = tieneSopa ? [
              { codigo: `${ordenKey}-U1`, numeracion: '1/2', tipo_envase: 'Bandeja Principal', descripcion: platoElegido.nombre_comercial },
              { codigo: `${ordenKey}-U2`, numeracion: '2/2', tipo_envase: 'Envase Sopa 12oz', descripcion: comps.find((c: any) => String(c.categoria || '').toLowerCase().includes('sopa'))?.nombre || 'Sopa / Crema del Día' }
            ] : [
              { codigo: `${ordenKey}-U1`, numeracion: '1/1', tipo_envase: 'Bandeja Principal', descripcion: platoElegido.nombre_comercial }
            ];

            ordenesCocina.push({
              orden_key: ordenKey,
              cuenta_id: sub.cuenta_id,
              titular_cuenta: sub.titular,
              perfil_id: sub.id,
              cliente: sub.nombre,
              plan: sub.plan,
              categoria_plan: sub.categoria_plan,
              extra_proteina: sub.extra_proteina,
              plato: platoElegido.nombre_comercial,
              tipo_comida: serv.tipo,
              direccion: sub.direccion,
              zona: sub.zona,
              ventana: sub.ventana,
              unidades_esperadas: unidadesFisicas.length,
              unidades_verificadas: estadoDB?.unidades_verificadas ?? (estadoDB?.estado_empaque === 'EMPACADO' ? unidadesFisicas.length : 0),
              unidades_fisicas: unidadesFisicas,
              estado_empaque: estadoDB?.estado_empaque || 'PENDIENTE',
              estado_despacho: estadoDB?.estado_despacho || 'EN_PLANTA',
              lote_descontado: estadoDB?.lote_descontado || false,
              componentes: comps
            });
          }
        }
      } catch (err) {}
    }

    const inventario = await this.obtenerInventario();
    const lotesFefoAll = await this.dataSource.query(`SELECT * FROM lotes_inventario WHERE estado = 'DISPONIBLE' AND saldo_actual > 0 ORDER BY fecha_vencimiento ASC`);
    const ordenesCompra = await this.dataSource.query(`SELECT * FROM ordenes_compra ORDER BY id DESC LIMIT 30`);
    const movimientosKardex = await this.dataSource.query(`SELECT * FROM movimientos_kardex ORDER BY id DESC LIMIT 35`);
    const conciliaciones = await this.dataSource.query(`SELECT * FROM conciliaciones_inventario ORDER BY id DESC LIMIT 20`);

    // Calcular demanda en gramos con cruce robusto
    for (const orden of ordenesCocina) {
      for (const comp of orden.componentes) {
        const itemInv = inventario.find((i: any) => 
          String(i.id) === String(comp.preparacion_id) ||
          String(i.nombre).toLowerCase().trim() === String(comp.nombre).toLowerCase().trim() ||
          String(i.nombre).toLowerCase().trim() === String(comp.preparacion_id).toLowerCase().trim()
        );
        
        if (itemInv) {
          const actual = requerimientoInsumos.get(itemInv.id) || { raciones: 0, gramosTotales: 0 };
          const esProteina = String(itemInv.categoria).toLowerCase().includes('prote');
          const gramosPorcion = Number(itemInv.gramos_por_racion) + (orden.extra_proteina && esProteina ? 50 : 0);
          actual.raciones += 1;
          actual.gramosTotales += gramosPorcion;
          requerimientoInsumos.set(itemInv.id, actual);
        }
      }
    }

    const lotesCocina: any[] = [];
    let valorTotalInventario = 0;

    const explosionInsumos = inventario.map((item: any) => {
      const req = requerimientoInsumos.get(item.id) || { raciones: 0, gramosTotales: 0 };
      const stockActual = Number(item.stock_actual);
      const stockMinimo = Number(item.stock_minimo);
      const costoProm = Number(item.costo_promedio || 0.015);
      valorTotalInventario += stockActual * costoProm;

      const ocAbiertasItem = ordenesCompra.filter((oc: any) => String(oc.item_id) === String(item.id) && (oc.estado === 'ENVIADA' || oc.estado === 'PARCIAL'));
      const pendienteRecibirBase = ocAbiertasItem.reduce((acc: number, oc: any) => acc + ((Number(oc.cantidad_ordenada) - Number(oc.cantidad_aceptada)) * Number(oc.factor_conversion || 1000)), 0);

      const lotesItem = lotesFefoAll.filter((l: any) => String(l.item_id) === String(item.id));
      const loteProximoFefo = lotesItem[0] || null;

      const necesidadBruta = req.gramosTotales;
      const compraSugeridaBase = Math.max(0, +(necesidadBruta + stockMinimo - stockActual - pendienteRecibirBase).toFixed(2));
      const presentacionesSugeridas = compraSugeridaBase > 0 ? Math.ceil(compraSugeridaBase / Number(item.factor_conversion || 1000)) : 0;

      let estado = 'OK';
      if (stockActual < necesidadBruta) {
        estado = 'CRITICO';
      } else if (stockActual <= stockMinimo || (stockActual - necesidadBruta) <= stockMinimo) {
        estado = 'ALERTA';
      }

      if (item.tipo_item !== 'EMPAQUE' && (req.raciones > 0 || (item.tipo_item === 'INTERMEDIO' && stockActual < stockMinimo))) {
        const loteKey = `${fecha}-LOT-${item.id}`;
        const estadoLoteDB = mapaLotesProd.get(loteKey);
        const repGramaje = item.tipo_item === 'INTERMEDIO' && stockActual < stockMinimo ? (stockMinimo - stockActual) : 0;
        const totalProducir = req.gramosTotales + repGramaje;

        lotesCocina.push({
          lote_key: loteKey,
          id: item.id,
          nombre: item.nombre,
          categoria: item.categoria,
          tipo_item: item.tipo_item,
          estacion: item.estacion || 'Calientes',
          anticipacion_dias: item.anticipacion_dias || 0,
          origen: req.raciones > 0 && repGramaje > 0 ? 'DEMANDA + REPOSICIÓN' : repGramaje > 0 ? 'REPOSICIÓN' : 'DEMANDA',
          raciones: req.raciones,
          requerido_demanda: req.gramosTotales,
          requerido_reposicion: repGramaje,
          gramos_totales: totalProducir,
          kilos_totales: +(totalProducir / 1000).toFixed(2),
          lote_fefo_sugerido: loteProximoFefo?.codigo_lote || 'LOT-GEN',
          vencimiento_fefo: loteProximoFefo?.fecha_vencimiento || 'N/A',
          estado: estadoLoteDB?.estado || 'PENDIENTE',
          cantidad_obtenida: estadoLoteDB?.cantidad_obtenida ?? totalProducir,
          cantidad_utilizable: estadoLoteDB?.cantidad_utilizable ?? totalProducir,
          merma: estadoLoteDB?.merma ?? 0,
          motivo_desviacion: estadoLoteDB?.motivo_desviacion || ''
        });
      }

      return {
        ...item,
        raciones_dia: req.raciones,
        requerido_base: necesidadBruta,
        kilos_requeridos: +(necesidadBruta / 1000).toFixed(2),
        pendiente_recibir_base: pendienteRecibirBase,
        compra_sugerida_base: compraSugeridaBase,
        presentaciones_sugeridas: presentacionesSugeridas,
        lote_fefo: loteProximoFefo ? `${loteProximoFefo.codigo_lote} (Vence: ${loteProximoFefo.fecha_vencimiento})` : 'Sin lote activo',
        lotes_detalle: lotesItem,
        deficit: Math.max(0, +(necesidadBruta - stockActual).toFixed(2)),
        estado
      };
    });

    const mapaEntregas = new Map<string, any>();
    for (const ord of ordenesCocina) {
      const infoCuenta = mapaDir.get(ord.cuenta_id) || {};
      const keyEntrega = `${fecha}-${ord.cuenta_id}`;
      const actual = mapaEntregas.get(keyEntrega) || {
        entrega_id: `ENT-${fecha.replace(/-/g, '').slice(4)}-${ord.cuenta_id}`,
        cuenta_id: ord.cuenta_id,
        titular: ord.titular_cuenta,
        direccion: ord.direccion,
        zona: ord.zona,
        ventana: ord.ventana,
        telefono: infoCuenta.telefono || '+57 310 455 8920',
        notas_entrega: infoCuenta.notas_entrega || 'Portería principal',
        repartidor: infoCuenta.repartidor || 'Carlos Mendoza (Moto #04)',
        estado_despacho: ord.estado_despacho || 'EN_PLANTA',
        perfiles: [],
        ordenes: [],
        unidades_esperadas_total: 0,
        unidades_verificadas_total: 0
      };
      if (!actual.perfiles.includes(ord.cliente)) actual.perfiles.push(ord.cliente);
      actual.ordenes.push(ord);
      actual.unidades_esperadas_total += ord.unidades_esperadas;
      actual.unidades_verificadas_total += ord.unidades_verificadas;
      // Si alguna orden ya cambió a EN_RUTA o ENTREGADO, reflejarlo en la bolsa consolidada
      if (ord.estado_despacho && ord.estado_despacho !== 'EN_PLANTA') {
        actual.estado_despacho = ord.estado_despacho;
      }
      mapaEntregas.set(keyEntrega, actual);
    }

    const entregasConsolidadas = Array.from(mapaEntregas.values()).map((ent: any) => ({
      ...ent,
      completa: ent.unidades_esperadas_total > 0 && ent.unidades_verificadas_total >= ent.unidades_esperadas_total,
      estado_liberacion: ent.unidades_esperadas_total > 0 && ent.unidades_verificadas_total >= ent.unidades_esperadas_total ? 'LISTA_DESPACHO' : 'INCOMPLETA'
    }));

    const loteYaDescontado = lotesCocina.length > 0 && lotesCocina.every((l: any) => l.estado === 'FINALIZADA');

    return {
      fecha,
      resumen: {
        totalPlatosDia: ordenesCocina.length,
        totalUnidadesFisicas: ordenesCocina.reduce((a: number, b: any) => a + b.unidades_esperadas, 0),
        unidadesVerificadas: ordenesCocina.reduce((a: number, b: any) => a + b.unidades_verificadas, 0),
        platosEmpacados: ordenesCocina.filter((o: any) => o.estado_empaque === 'EMPACADO').length,
        entregasListasDespacho: entregasConsolidadas.filter((e: any) => e.completa).length,
        totalEntregasConsolidadas: entregasConsolidadas.length,
        insumosEnAlerta: explosionInsumos.filter((i: any) => i.estado !== 'OK').length,
        totalInsumosCatalogo: inventario.length,
        valorTotalInventario: +valorTotalInventario.toFixed(2),
        ordenesCompraAbiertas: ordenesCompra.filter((o: any) => o.estado === 'ENVIADA' || o.estado === 'PARCIAL').length,
        loteDescontado: loteYaDescontado
      },
      lotesCocina,
      ordenesCocina,
      entregasConsolidadas,
      explosionInsumos,
      ordenesCompra,
      movimientosKardex,
      conciliaciones
    };
  }


  // Actualizar Dirección Única de la Cuenta (aplica a todos los miembros de la cuenta familiar/individual)
  async actualizarDireccionCuenta(data: any) {
    await this.dataSource.query(`
      INSERT INTO cuentas_direcciones (cuenta_id, titular, direccion, zona, ventana, telefono, notas_entrega, repartidor)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (cuenta_id) DO UPDATE SET
        direccion = EXCLUDED.direccion,
        zona = EXCLUDED.zona,
        ventana = EXCLUDED.ventana,
        telefono = EXCLUDED.telefono,
        notas_entrega = EXCLUDED.notas_entrega,
        repartidor = COALESCE(EXCLUDED.repartidor, cuentas_direcciones.repartidor)
    `, [
      data.cuenta_id || 'CTA-FAM-101',
      data.titular || 'Familia Rangel Palma',
      data.direccion,
      data.zona || 'Bogotá Norte (01)',
      data.ventana || 'Franja AM (05:00 - 07:00)',
      data.telefono || '+57 310 455 8920',
      data.notas_entrega || '',
      data.repartidor || 'Carlos Mendoza (Moto #04)'
    ]);
    return { success: true };
  }

  // Cambiar Estado de Despacho de toda la Bolsa Consolidada de una Cuenta (EN_PLANTA -> EN_RUTA -> ENTREGADO)
  async cambiarEstadoDespachoCuenta(data: { fecha: string; cuenta_id: string; estado_despacho: string; repartidor?: string }) {
    if (data.repartidor) {
      await this.dataSource.query(
        `UPDATE cuentas_direcciones SET repartidor = $2 WHERE cuenta_id = $1`,
        [data.cuenta_id, data.repartidor]
      );
    }

    // Asegurar que las órdenes operativas de ese día para esa cuenta actualicen su estado_despacho
    const dashboard = await this.obtenerDashboardLogistica(data.fecha);
    const ordenesCuenta = (dashboard.ordenesCocina || []).filter((o: any) => o.cuenta_id === data.cuenta_id);

    for (const ord of ordenesCuenta) {
      await this.dataSource.query(`
        INSERT INTO ordenes_operativas (orden_key, fecha, estado_empaque, estado_despacho, unidades_verificadas)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (orden_key) DO UPDATE SET
          estado_despacho = EXCLUDED.estado_despacho
      `, [
        ord.orden_key,
        data.fecha,
        ord.estado_empaque || 'EMPACADO',
        data.estado_despacho,
        ord.unidades_verificadas || ord.unidades_esperadas
      ]);
    }

    return { success: true };
  }

  
  
}

