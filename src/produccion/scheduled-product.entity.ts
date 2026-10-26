import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { MasterDish } from '../recetas/master-dish.entity.js';
import type { MasterDish as MasterDishType } from '../recetas/master-dish.entity.js';

export enum ScheduleStatus {
  PENDING_SELECTION = 'PENDING_SELECTION', // 1. Producto creado, esperando que el cliente o el sistema asigne el plato
  MENU_SELECTED = 'MENU_SELECTED',         // 2. Plato seleccionado (aún editable antes del corte)
  PROGRAMMED = 'PROGRAMMED',               // 3. Confirmado para entrar a la jornada
  IN_PRODUCTION = 'IN_PRODUCTION',         // 4. Corte de 2:00 PM superado, demanda congelada para Cocina
  ASSEMBLED = 'ASSEMBLED',                 // 5. Ensamblado y etiquetado
  DELIVERED = 'DELIVERED',                 // 6. Entregado al cliente
  CLOSED = 'CLOSED'                        // 7. Histórico final
}

@Entity('scheduled_products')
export class ScheduledProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'balance_id', nullable: true })
  balanceId: string;

  @Column({ type: 'uuid', name: 'profile_id' })
  profileId: string;

  // Modificación CRÍTICA: Ahora permite null porque al momento de la venta aún no se ha elegido el menú
  @Column({ type: 'uuid', name: 'dish_id', nullable: true })
  dishId: string | null;

  @Column({ type: 'date', name: 'scheduled_date' })
  scheduledDate: string;

  // Por defecto, nace esperando que se le asigne un menú
  // Cambiamos type: 'enum' a type: 'varchar'
  @Column({ type: 'varchar', length: 50, name: 'status', default: ScheduleStatus.PENDING_SELECTION })
  status: ScheduleStatus;

  @Column({ type: 'boolean', name: 'is_extra_protein', default: false })
  isExtraProtein: boolean;

  @Column({ type: 'uuid', name: 'snapshot_address_id', nullable: true })
  snapshotAddressId: string;

  @Column({ type: 'timestamptz', name: 'resolved_at', nullable: true })
  resolvedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  // Relación con el Maestro de Recetas (También acepta null por si se consulta antes de elegir plato)
  @ManyToOne(() => MasterDish, { nullable: true })
  @JoinColumn({ name: 'dish_id' })
  dish: MasterDishType | null;
}