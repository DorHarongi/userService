import { Test, TestingModule } from '@nestjs/testing';
import { BuildingsUpgradingService } from './buildings-upgrading.service';

describe('BuildingsUpgradingService', () => {
  let service: BuildingsUpgradingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BuildingsUpgradingService],
    }).compile();

    service = module.get<BuildingsUpgradingService>(BuildingsUpgradingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
