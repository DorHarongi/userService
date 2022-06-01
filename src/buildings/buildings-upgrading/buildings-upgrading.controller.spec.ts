import { Test, TestingModule } from '@nestjs/testing';
import { BuildingsUpgradingController } from './buildings-upgrading.controller';

describe('BuildingsUpgradingController', () => {
  let controller: BuildingsUpgradingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BuildingsUpgradingController],
    }).compile();

    controller = module.get<BuildingsUpgradingController>(BuildingsUpgradingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
