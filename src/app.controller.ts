import { Controller, Get, Post, OnModuleInit, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppService } from './app.service';

@Controller()
export class AppController implements OnModuleInit {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly appService: AppService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    if (process.env.NO_CRONS === '1') {
      setTimeout(() => {
        const jobs = this.schedulerRegistry.getCronJobs();
        jobs.forEach((job, name) => {
          job.stop();
          this.logger.log(`Cron "${name}" stopped (NO_CRONS=1)`);
        });
        this.logger.warn(`All ${jobs.size} cron jobs paused (NO_CRONS=1)`);
      }, 2000);
    }
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @SkipThrottle()
  healthCheck() {
    return { status: 'ok', timestamp: Date.now() };
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
