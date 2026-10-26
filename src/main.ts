import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Habilitar CORS para que el frontend se pueda comunicar
  app.enableCors();

  // NUEVO: Aumentar el límite de peso para aceptar las imágenes en Base64
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));


  await app.listen(3000);
}
bootstrap();