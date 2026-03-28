import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const certPath = path.join(__dirname, '../../certs/fullchain.pem');
  const keyPath = path.join(__dirname, '../../certs/privkey.pem');

  const httpsOptions =
    process.env.NO_SSL === '1'
      ? undefined
      : fs.existsSync(certPath) && fs.existsSync(keyPath)
        ? {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath),
          }
        : undefined;

  const app = await NestFactory.create(AppModule, { httpsOptions });
  app.enableCors();
  const port = parseInt(process.env.PORT, 10) || 3000;
  await app.listen(port);
  console.log(`userService listening on port ${port} (${httpsOptions ? 'HTTPS' : 'HTTP'})`);
}
bootstrap();
