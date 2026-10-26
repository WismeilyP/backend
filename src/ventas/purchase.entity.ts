import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { PurchasedPlan } from './purchased-plan.entity.js';
import type { PurchasedPlan as PurchasedPlanType } from './purchased-plan.entity.js';

export enum PaymentMethod {
  DAVIPLATA = 'DAVIPLATA',
  NEQUI = 'NEQUI',
  PSE = 'PSE'
}

export enum PaymentStatus {
  APPROVED = 'APPROVED',
  PENDING = 'PENDING',
  DECLINED = 'DECLINED',
  VOIDED = 'VOIDED'
}

@Entity('purchases')
export class Purchase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, name: 'total_amount' })
  totalAmount: number;

  @Column({ type: 'enum', enum: PaymentMethod, name: 'payment_method' })
  paymentMethod: PaymentMethod;

  @Column({ type: 'enum', enum: PaymentStatus })
  status: PaymentStatus;

  @Column({ type: 'varchar', name: 'wompi_transaction_id', nullable: true })
  wompiTransactionId: string;

  @Column({ type: 'varchar', name: 'wompi_signature', nullable: true })
  wompiSignature: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  // Cascada activada: Al guardar una Purchase, guardará automáticamente sus planes
  @OneToMany(() => PurchasedPlan, (plan) => plan.purchase, { cascade: true })
  purchasedPlans: PurchasedPlanType[];
}