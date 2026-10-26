import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('commercial_plans')
export class CommercialPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'integer', name: 'duration_days' })
  durationDays: number;

  @Column({ type: 'varchar' })
  category: string;

  @Column({ type: 'boolean', name: 'has_lunch', default: true })
  hasLunch: boolean;

  @Column({ type: 'boolean', name: 'has_dinner', default: true })
  hasDinner: boolean;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;
}