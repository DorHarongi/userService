import { Test, TestingModule } from '@nestjs/testing';
import { TroopsTrainingController } from './troops-training.controller';

describe('TroopsTrainingController', () => {
  let controller: TroopsTrainingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TroopsTrainingController],
    }).compile();

    controller = module.get<TroopsTrainingController>(TroopsTrainingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
