import { Controller, Get, Post, Res, OnModuleInit, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppService } from './app.service';
import { DbConnectorService } from './database/services/db-connector.service';

@Controller()
export class AppController implements OnModuleInit {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly appService: AppService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly dbConnector: DbConnectorService,
  ) {}

  onModuleInit() {
    setTimeout(() => {
      const jobs = this.schedulerRegistry.getCronJobs();
      jobs.forEach((job, name) => {
        job.stop();
        this.logger.log(`Cron "${name}" stopped (startup: crons disabled by default)`);
      });
      this.logger.warn(`All ${jobs.size} cron jobs paused — waiting for /crons/enable`);
    }, 2000);
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @SkipThrottle()
  async healthCheck(@Res() res) {
    try {
      const db = this.dbConnector.getServerDb(1);
      await db.admin().ping();
      return res.status(200).json({ status: 'ok', timestamp: Date.now() });
    } catch (err) {
      this.logger.error('Health check failed: DB unreachable', err?.message);
      return res.status(503).json({ status: 'error', timestamp: Date.now(), reason: 'db_unreachable' });
    }
  }

  @Post('crons/enable')
  @SkipThrottle()
  enableCrons() {
    const jobs = this.schedulerRegistry.getCronJobs();
    let started = 0;
    jobs.forEach((job, name) => {
      if (!job.running) {
        job.start();
        started++;
        this.logger.log(`Cron "${name}" started`);
      }
    });
    this.logger.warn(`Enabled ${started}/${jobs.size} cron jobs`);
    return { status: 'crons_enabled', started, total: jobs.size };
  }
}
