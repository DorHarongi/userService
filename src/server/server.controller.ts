import { Controller, Get } from '@nestjs/common';
import { ServerService } from './server.service';

@Controller('server')
export class ServerController {
  constructor(private serverService: ServerService) {}

  @Get('status')
  async getStatus() {
    return this.serverService.getServerStatus();
  }
}
