import { Test, TestingModule } from '@nestjs/testing';
import { AttackingService } from './attacking.service';

describe('AttackingService', () => {
  let service: AttackingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AttackingService],
    }).compile();

    service = module.get<AttackingService>(AttackingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
