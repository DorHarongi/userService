import { Test, TestingModule } from '@nestjs/testing';
import { AttackReportsService } from './attack-reports.service';

describe('AttackReportsService', () => {
  let service: AttackReportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AttackReportsService],
    }).compile();

    service = module.get<AttackReportsService>(AttackReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
