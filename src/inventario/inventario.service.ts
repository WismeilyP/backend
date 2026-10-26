import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryItem } from './inventory-item.entity.js';

@Injectable()
export class InventarioService {
  constructor(
    @InjectRepository(InventoryItem)
    private inventarioRepository: Repository<InventoryItem>,
  ) {}

  findAll(): Promise<InventoryItem[]> {
    return this.inventarioRepository.find();
  }

  create(itemData: Partial<InventoryItem>): Promise<InventoryItem> {
    const nuevoItem = this.inventarioRepository.create(itemData);
    return this.inventarioRepository.save(nuevoItem);
  }

  async remove(id: string): Promise<void> {
    await this.inventarioRepository.delete(id);
  }
}