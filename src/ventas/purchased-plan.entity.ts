import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Purchase } from './purchase.entity.js';
import type { Purchase as PurchaseType } from './purchase.entity.js';

@Entity('purchased_plans')
export class PurchasedPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'purchase_id' })
  purchaseId: string;

  @Column({ type: 'uuid', name: 'profile_id' })
  profileId: string;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, name: 'snapshot_price' })
  snapshotPrice: number;

  @Column({ type: 'date', name: 'start_date' })
  startDate: string;

  // Relación con la tabla principal de la factura
  @ManyToOne(() => Purchase, (purchase) => purchase.purchasedPlans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchase_id' })
  purchase: PurchaseType;
}