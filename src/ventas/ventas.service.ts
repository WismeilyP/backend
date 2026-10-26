import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Purchase } from './purchase.entity.js';
import { PurchasedPlan } from './purchased-plan.entity.js';
import { CommercialPlan } from '../recetas/commercial-plan.entity.js';
import { ScheduledProduct, ScheduleStatus } from '../produccion/scheduled-product.entity.js';

@Injectable()
export class VentasService {
  constructor(
    @InjectRepository(Purchase)
    private purchaseRepository: Repository<Purchase>,
    private dataSource: DataSource,
  ) {}

  findAll(): Promise<Purchase[]> {
    return this.purchaseRepository.find({
      relations: {
        purchasedPlans: true,
      },
      order: { createdAt: 'DESC' }
    });
  }

  // Extrae los perfiles reales de la base de datos junto con su cuenta asociada
  async obtenerPerfiles() {
    return this.dataSource.query('SELECT id, account_id as "accountId", first_name as "firstName" FROM profiles');
  }

  async create(purchaseData: Partial<Purchase>): Promise<Purchase> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const nuevaVenta = queryRunner.manager.create(Purchase, purchaseData);
      const ventaGuardada = await queryRunner.manager.save(Purchase, nuevaVenta);

      if (ventaGuardada.status === 'APPROVED' && ventaGuardada.purchasedPlans) {
        for (const planItem of ventaGuardada.purchasedPlans) {
          
          // 1. Buscamos el plan comercial para conocer la duración exacta
          const commercialPlan = await queryRunner.manager.findOne(CommercialPlan, {
            where: { id: planItem.planId }
          });

          const durationDays = commercialPlan ? commercialPlan.durationDays : 20;

          const startDateStr = planItem.startDate || new Date().toISOString().split('T')[0];
          const [year, month, day] = startDateStr.split('-').map(Number);

          // 2. Generación del calendario operativo: Demanda Provisional (Sin plato asignado)
          for (let i = 0; i < durationDays; i++) {
            const currentDate = new Date(year, month - 1, day + i);
            const y = currentDate.getFullYear();
            const m = String(currentDate.getMonth() + 1).padStart(2, '0');
            const d = String(currentDate.getDate()).padStart(2, '0');
            const dateString = `${y}-${m}-${d}`;

            const scheduledProduct = queryRunner.manager.create(ScheduledProduct, {
              profileId: planItem.profileId,
              dishId: null, // EL PLATO NACE VACÍO (El cliente elegirá después)
              scheduledDate: dateString,
              status: ScheduleStatus.PENDING_SELECTION, // ESTADO: PENDIENTE DE SELECCIÓN
              isExtraProtein: false, 
            });

            await queryRunner.manager.save(ScheduledProduct, scheduledProduct);
          }
        }
      }

      await queryRunner.commitTransaction();
      return ventaGuardada;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}