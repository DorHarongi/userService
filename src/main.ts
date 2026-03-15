import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const certPath = path.join(__dirname, '../../certs/fullchain.pem');
  const keyPath = path.join(__dirname, '../../certs/privkey.pem');

  const httpsOptions =
    fs.existsSync(certPath) && fs.existsSync(keyPath)
      ? {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        }
      : undefined;

  const app = await NestFactory.create(AppModule, { httpsOptions });
  app.enableCors();
  await app.listen(3000);
}
bootstrap();
