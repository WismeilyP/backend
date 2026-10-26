import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// Definimos el ENUM exactamente como lo creaste en SQL
export enum ItemType {
  INGREDIENT = 'INGREDIENT',
  PACKAGING = 'PACKAGING',
  INTERMEDIATE = 'INTERMEDIATE',
}

@Entity('inventory_items') // Apuntamos a tu tabla real
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'enum', enum: ItemType, name: 'type' })
  type: ItemType;

  // Usamos camelCase en TypeScript, pero apuntamos al nombre real en BD ('base_unit')
  @Column({ type: 'varchar', length: 20, name: 'base_unit' })
  baseUnit: string;

  @Column({ type: 'numeric', precision: 10, scale: 4, name: 'cost_per_unit' })
  costPerUnit: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;
}