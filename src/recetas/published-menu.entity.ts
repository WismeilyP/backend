import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { MasterDish } from './master-dish.entity.js';

@Entity('published_menus')
export class PublishedMenu {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date', name: 'target_date' })
  targetDate: string;

  // CORRECCIÓN: Usamos varchar en lugar de enum
  @Column({ type: 'varchar', length: 50, default: 'LUNCH', name: 'meal_type' })
  mealType: string;

  @Column({ type: 'uuid', name: 'dish_id' })
  dishId: string;

  @ManyToOne(() => MasterDish)
  @JoinColumn({ name: 'dish_id' })
  dish: MasterDish;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;
}