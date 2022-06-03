import { Test, TestingModule } from '@nestjs/testing';
import { TroopsTrainingService } from './troops-training.service';

describe('TroopsTrainingServiceService', () => {
  let service: TroopsTrainingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TroopsTrainingService],
    }).compile();

    service = module.get<TroopsTrainingService>(TroopsTrainingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
