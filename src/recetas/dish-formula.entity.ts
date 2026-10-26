import { Entity, Column, ManyToOne, JoinColumn, PrimaryColumn } from 'typeorm';
import { MasterDish } from './master-dish.entity.js';
import type { MasterDish as MasterDishType } from './master-dish.entity.js'; // TRUCO: Importación fantasma
import { InventoryItem } from '../inventario/inventory-item.entity.js';

@Entity('dish_formulas')
export class DishFormula {
  @PrimaryColumn({ type: 'uuid', name: 'dish_id' })
  dishId: string;

  @PrimaryColumn({ type: 'uuid', name: 'inventory_item_id' })
  inventoryItemId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantity: number;

  @Column({ type: 'boolean', name: 'is_extra_protein', default: false })
  isExtraProtein: boolean;

  // TypeORM usa el valor real (MasterDish), pero TypeScript usa el fantasma (MasterDishType)
  @ManyToOne(() => MasterDish, (dish) => dish.formulas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dish_id' })
  dish: MasterDishType; 

  @ManyToOne(() => InventoryItem)
  @JoinColumn({ name: 'inventory_item_id' })
  inventoryItem: InventoryItem;
}