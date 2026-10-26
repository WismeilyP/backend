import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { DishFormula } from './dish-formula.entity.js';
import type { DishFormula as DishFormulaType } from './dish-formula.entity.js';

// Valores exactos de tu BD para plan_category
export enum PlanCategory {
  ESENCIAL = 'ESENCIAL',
  PREMIUM = 'PREMIUM',
}

// Valores exactos de tu BD para meal_type
export enum MealType {
  LUNCH = 'LUNCH',
  DINNER = 'DINNER',
}

@Entity('master_dishes')
export class MasterDish {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'enum', enum: PlanCategory })
  category: PlanCategory;

  @Column({ type: 'enum', enum: MealType, name: 'meal_type' })
  mealType: MealType;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => DishFormula, (formula) => formula.dish)
  formulas: DishFormulaType[];
}