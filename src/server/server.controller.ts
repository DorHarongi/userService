import { Body, Controller, Get, Post, UseGuards, Request } from '@nestjs/common';
import { ServerService } from './server.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import * as fs from 'fs';
import * as path from 'path';

@Controller('server')
export class ServerController {
  constructor(private serverService: ServerService) {}

  @Get('version')
  getVersion() {
    const candidates = [
      path.join(process.cwd(), 'version.json'),
      path.join(process.cwd(), '..', 'version.json'),
    ];
    for (const p of candidates) {
      try {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return { version: data.version ?? 'unknown' };
      } catch { /* try next */ }
    }
    return { version: 'unknown' };
  }

  @Get('status')
  async getStatus() {
    return this.serverService.getServerStatus();
  }

  @Get('servers')
  async getServers() {
    return this.serverService.getServersList();
  }

  @Post('servers/join')
  @UseGuards(AuthGuard)
  async joinServer(@Request() req: any, @Body() body: { serverId: number }) {
    return this.serverService.joinServer(req.user.username, body.serverId ?? 1);
  }

  @Post('servers/create')
  @UseGuards(AuthGuard)
  async createServer(@Body() body: { name?: string }) {
    return this.serverService.createServer(body?.name);
  }
}
