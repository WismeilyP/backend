import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PublishedMenu } from './published-menu.entity.js'; // <- Ya no importamos MealType

@Injectable()
export class PublishedMenuService {
  constructor(
    @InjectRepository(PublishedMenu)
    private publishedMenuRepository: Repository<PublishedMenu>,
  ) {}

  findAll(): Promise<PublishedMenu[]> {
    return this.publishedMenuRepository.find({
      relations: { dish: true },
      order: { targetDate: 'ASC' }
    });
  }

  // CORRECCIÓN: mealType ahora es simplemente un string
  findByDateAndMeal(targetDate: string, mealType: string): Promise<PublishedMenu[]> {
    return this.publishedMenuRepository.find({
      where: { 
        targetDate,
        mealType,
        isActive: true
      },
      relations: { dish: true },
    });
  }

  async create(menuData: Partial<PublishedMenu>): Promise<PublishedMenu> {
    const nuevoMenu = this.publishedMenuRepository.create(menuData);
    return await this.publishedMenuRepository.save(nuevoMenu);
  }

  async remove(id: string): Promise<void> {
    await this.publishedMenuRepository.delete(id);
  }
}