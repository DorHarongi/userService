import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { DbAccessorService } from './services/db-accessor.service';
import { DbConnectorService } from './services/db-connector.service';
import { ServerContextService } from './services/server-context.service';
import { ServerContextMiddleware } from './middleware/server-context.middleware';

@Module({
  providers: [
    DbConnectorService,
    ServerContextService,
    {
      provide: DbAccessorService,
      useFactory: async (
        dbConnectorService: DbConnectorService,
        serverContextService: ServerContextService,
      ) => {
        await dbConnectorService.connect();
        return new DbAccessorService(dbConnectorService, serverContextService);
      },
      inject: [DbConnectorService, ServerContextService],
    },
  ],
  exports: [DbAccessorService, DbConnectorService, ServerContextService],
})
export class DatabaseModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ServerContextMiddleware).forRoutes('*');
  }
}
