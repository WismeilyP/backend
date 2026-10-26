import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MasterDish } from './master-dish.entity.js';
import { DishFormula } from './dish-formula.entity.js';
import { CommercialPlan } from './commercial-plan.entity.js';

@Injectable()
export class RecetasService {
  constructor(
    @InjectRepository(MasterDish)
    private masterDishRepository: Repository<MasterDish>,
    @InjectRepository(DishFormula)
    private dishFormulaRepository: Repository<DishFormula>,
    @InjectRepository(CommercialPlan)
    private commercialPlanRepository: Repository<CommercialPlan>,
  ) {}

  findAll(): Promise<MasterDish[]> {
    return this.masterDishRepository.find({
      relations: {
        formulas: {
          inventoryItem: true,
        },
      },
      order: { name: 'ASC' }
    });
  }

  // Método para obtener los planes comerciales activos y mostrarlos dinámicamente en el frontend
  obtenerPlanes(): Promise<CommercialPlan[]> {
    return this.commercialPlanRepository.find({
      where: { isActive: true },
      order: { name: 'ASC' }
    });
  }

  // Guardado robusto en 2 pasos
  async create(dishData: Partial<MasterDish>): Promise<MasterDish> {
    const formulas = dishData.formulas;
    delete dishData.formulas;

    const nuevoPlato = this.masterDishRepository.create(dishData);
    const platoGuardado = await this.masterDishRepository.save(nuevoPlato);

    if (formulas && formulas.length > 0) {
      const formulasParaGuardar = formulas.map((f: any) => ({
        dishId: platoGuardado.id,
        inventoryItemId: f.inventoryItemId,
        quantity: f.quantity,
        isExtraProtein: f.isExtraProtein,
      }));
      
      await this.dishFormulaRepository.save(formulasParaGuardar);
    }

    return platoGuardado;
  }
}