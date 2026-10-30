import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '../../stores/settingsStore';
import { DEFAULT_SETTINGS } from '../../types/settings';
import { createDefaultCommands } from '../../features/palette/defaultCommands';
import { 
  classifyHardwareTier, 
  formatTokenBudget 
} from '../../features/inference/hardwareTier';
import { calibrateModelsWithHardware } from '../../features/onboarding/modelDetector';

describe('OnboardingWizard (Day 57 Polish)', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, isFirstRun: true },
      isModalOpen: false,
      isOnboardingOpen: true,
    });
  });

  it('detects first run on initial launch and opens onboarding wizard', () => {
    const store = useSettingsStore.getState();
    expect(store.settings.isFirstRun).toBe(true);
    expect(store.isOnboardingOpen).toBe(true);
  });

  it('marks first run as completed and closes the wizard', () => {
    useSettingsStore.getState().setFirstRunCompleted();
    const store = useSettingsStore.getState();
    expect(store.settings.isFirstRun).toBe(false);
    expect(store.isOnboardingOpen).toBe(false);
  });

  it('can be reopened via openOnboarding', () => {
    useSettingsStore.getState().setFirstRunCompleted();
    expect(useSettingsStore.getState().isOnboardingOpen).toBe(false);

    useSettingsStore.getState().openOnboarding();
    expect(useSettingsStore.getState().isOnboardingOpen).toBe(true);
  });

  it('is bound to Command Palette as Help: Welcome & Setup Guide', () => {
    const mockCtx = {
      toggleSidebar: vi.fn(),
      toggleTerminal: vi.fn(),
      setActiveTab: vi.fn(),
      openHardwareModal: vi.fn(),
      openCheckpointModal: vi.fn(),
      openSettingsModal: vi.fn(),
      openOnboardingModal: vi.fn(),
    };

    const commands = createDefaultCommands(mockCtx);
    const welcomeCmd = commands.find((c) => c.id === 'help:welcome');

    expect(welcomeCmd).toBeDefined();
    expect(welcomeCmd?.title).toBe('Help: Welcome & Setup Guide');
    expect(welcomeCmd?.category).toBe('Help');

    welcomeCmd?.handler();
    expect(mockCtx.openOnboardingModal).toHaveBeenCalledTimes(1);
  });

  it('is bound to Command Palette as Help: Local AI & Hardware Diagnostic Setup Wizard', () => {
    const mockCtx = {
      toggleSidebar: vi.fn(),
      toggleTerminal: vi.fn(),
      setActiveTab: vi.fn(),
      openHardwareModal: vi.fn(),
      openCheckpointModal: vi.fn(),
      openSettingsModal: vi.fn(),
      openOnboardingModal: vi.fn(),
    };

    const commands = createDefaultCommands(mockCtx);
    const wizardCmd = commands.find((c) => c.id === 'setup:diagnostic-wizard');

    expect(wizardCmd).toBeDefined();
    expect(wizardCmd?.title).toBe('Help: Local AI & Hardware Diagnostic Setup Wizard');
    expect(wizardCmd?.category).toBe('Help');
    expect(wizardCmd?.keywords).toContain('wizard');
    expect(wizardCmd?.keywords).toContain('diagnostic');

    wizardCmd?.handler();
    expect(mockCtx.openOnboardingModal).toHaveBeenCalledTimes(1);
  });

  it('applies hardware-calibrated models to settings store in 1-click', () => {
    const tier = classifyHardwareTier(8192, 16384);
    const models = [
      { name: 'qwen2.5-coder:1.5b', size: 986000000 },
      { name: 'qwen2.5-coder:7b', size: 4700000000 },
      { name: 'deepseek-r1:8b', size: 4900000000 },
    ];

    const cal = calibrateModelsWithHardware(tier, models, true);
    expect(cal.isFullyConfigured).toBe(true);
    expect(cal.readinessScore).toBe(100);

    // Simulate 1-click apply action
    useSettingsStore.getState().updateSettings({
      autocompleteModel: cal.recommendedConfig.autocompleteModel,
      chatModel: cal.recommendedConfig.chatModel,
      editModel: cal.recommendedConfig.editModel,
      reasoningModel: cal.recommendedConfig.reasoningModel,
      autoModelRouter: true,
    });

    const current = useSettingsStore.getState().settings;
    expect(current.autocompleteModel).toBe('qwen2.5-coder:1.5b');
    expect(current.chatModel).toBe('qwen2.5-coder:7b');
    expect(current.editModel).toBe('qwen2.5-coder:7b');
    expect(current.reasoningModel).toBe('deepseek-r1:8b');
    expect(current.autoModelRouter).toBe(true);
  });

  it('formats context token budget correctly for hardware display', () => {
    expect(formatTokenBudget(32768)).toBe('32k tokens');
    expect(formatTokenBudget(16384)).toBe('16k tokens');
    expect(formatTokenBudget(8192)).toBe('8k tokens');
    expect(formatTokenBudget(4096)).toBe('4k tokens');
    expect(formatTokenBudget(512)).toBe('512 tokens');
  });

  it('correctly marks already installed models with isInstalled and skips them from missingModels', () => {
    const tier = classifyHardwareTier(4096, 16384); // Tier 3 Budget
    // Simulate user already having qwen2.5-coder:1.5b downloaded, but missing 7b models
    const partiallyInstalled = [
      { name: 'qwen2.5-coder:1.5b', size: 986000000 },
    ];

    const cal = calibrateModelsWithHardware(tier, partiallyInstalled, true);
    
    // Check tierModels
    expect(cal.tierModels).toBeDefined();
    const model15b = cal.tierModels.find((m) => m.modelName === 'qwen2.5-coder:1.5b');
    const model7b = cal.tierModels.find((m) => m.modelName === 'qwen2.5-coder:7b');
    const modelR1 = cal.tierModels.find((m) => m.modelName === 'deepseek-r1:7b');

    expect(model15b?.isInstalled).toBe(true);
    expect(model7b?.isInstalled).toBe(false);
    expect(modelR1?.isInstalled).toBe(false);

    // missingModels must only contain the uninstalled ones (skipping 1.5b)
    expect(cal.missingModels.map((m) => m.modelName)).not.toContain('qwen2.5-coder:1.5b');
    expect(cal.missingModels.map((m) => m.modelName)).toContain('qwen2.5-coder:7b');
    expect(cal.missingModels.map((m) => m.modelName)).toContain('deepseek-r1:7b');
  });

  it('skips all downloads and reports 100% readiness when all tier models are pre-installed', () => {
    const tier = classifyHardwareTier(4096, 16384);
    const fullyInstalled = [
      { name: 'qwen2.5-coder:1.5b', size: 986000000 },
      { name: 'qwen2.5-coder:7b', size: 4700000000 },
      { name: 'deepseek-r1:7b', size: 4900000000 },
    ];

    const cal = calibrateModelsWithHardware(tier, fullyInstalled, true);
    expect(cal.missingModels).toHaveLength(0);
    expect(cal.isFullyConfigured).toBe(true);
    expect(cal.readinessScore).toBe(100);
    expect(cal.tierModels.every((m) => m.isInstalled)).toBe(true);
  });
});

