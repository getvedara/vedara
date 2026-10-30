import { describe, it, expect } from 'vitest';
import {
  parseModelMetadata,
  classifyModelRoles,
  getRecommendedTierSuite,
  calibrateModelsWithHardware,
  detectAndCalibrateModels,
} from './modelDetector';
import { HardwareTierInfo } from '../inference/hardwareTier';

describe('modelDetector (Day 57)', () => {
  describe('parseModelMetadata', () => {
    it('correctly parses model family and parameter counts', () => {
      expect(parseModelMetadata('qwen2.5-coder:1.5b')).toEqual({
        family: 'qwen2.5-coder',
        parameterCount: '1.5b',
      });
      expect(parseModelMetadata('deepseek-r1:8b')).toEqual({
        family: 'deepseek-r1',
        parameterCount: '8b',
      });
      expect(parseModelMetadata('codestral:22b-v0.1')).toEqual({
        family: 'codestral',
        parameterCount: '22b',
      });
      expect(parseModelMetadata('llama3.1:8b-instruct-q8_0')).toEqual({
        family: 'llama3.1',
        parameterCount: '8b',
      });
      expect(parseModelMetadata('starcoder2:3b')).toEqual({
        family: 'starcoder',
        parameterCount: '3b',
      });
      expect(parseModelMetadata('my-custom-model:latest')).toEqual({
        family: 'general',
        parameterCount: 'unknown',
      });
    });
  });

  describe('classifyModelRoles', () => {
    it('classifies small coder models as autocomplete (FIM), chat, and edit', () => {
      const roles15b = classifyModelRoles('qwen2.5-coder:1.5b');
      expect(roles15b).toContain('autocomplete');
      expect(roles15b).toContain('chat');
      expect(roles15b).toContain('edit');

      const roles13b = classifyModelRoles('deepseek-coder:1.3b');
      expect(roles13b).toContain('autocomplete');
      expect(roles13b).toContain('chat');
      expect(roles13b).toContain('edit');
    });

    it('classifies 7B+ coder models as chat and edit', () => {
      const roles7b = classifyModelRoles('qwen2.5-coder:7b');
      expect(roles7b).toContain('chat');
      expect(roles7b).toContain('edit');
      expect(roles7b).not.toContain('autocomplete');

      const rolesCodestral = classifyModelRoles('codestral:22b');
      expect(rolesCodestral).toContain('chat');
      expect(rolesCodestral).toContain('edit');
    });

    it('classifies deepseek-r1 and qwq as reasoning', () => {
      const rolesR1 = classifyModelRoles('deepseek-r1:8b');
      expect(rolesR1).toContain('reasoning');

      const rolesQwQ = classifyModelRoles('qwq:32b');
      expect(rolesQwQ).toContain('reasoning');
    });

    it('classifies general models like llama3 as chat', () => {
      const rolesLlama = classifyModelRoles('llama3:8b');
      expect(rolesLlama).toContain('chat');
      expect(rolesLlama).not.toContain('autocomplete');
    });
  });

  describe('getRecommendedTierSuite', () => {
    it('returns high-spec models for Tier 1 Heavyweight', () => {
      const suite = getRecommendedTierSuite('Tier 1: Heavyweight');
      expect(suite.autocomplete.name).toBe('qwen2.5-coder:1.5b');
      expect(suite.chat.name).toBe('qwen2.5-coder:14b');
      expect(suite.reasoning.name).toBe('deepseek-r1:14b');
    });

    it('returns standard models for Tier 2 Standard', () => {
      const suite = getRecommendedTierSuite('Tier 2: Standard');
      expect(suite.autocomplete.name).toBe('qwen2.5-coder:1.5b');
      expect(suite.chat.name).toBe('qwen2.5-coder:7b');
      expect(suite.reasoning.name).toBe('deepseek-r1:8b');
    });

    it('returns conservative models for Tier 3 Budget', () => {
      const suite = getRecommendedTierSuite('Tier 3: Budget / Constrained');
      expect(suite.autocomplete.name).toBe('qwen2.5-coder:1.5b');
      expect(suite.chat.name).toBe('qwen2.5-coder:7b');
      expect(suite.edit.name).toBe('qwen2.5-coder:1.5b');
      expect(suite.reasoning.name).toBe('deepseek-r1:7b');
    });

    it('returns lightweight models for Tier 4 CPU Fallback', () => {
      const suite = getRecommendedTierSuite('Tier 4: CPU Fallback');
      expect(suite.autocomplete.name).toBe('qwen2.5-coder:1.5b');
      expect(suite.chat.name).toBe('qwen2.5-coder:1.5b');
      expect(suite.reasoning.name).toBe('deepseek-r1:1.5b');
    });
  });

  describe('calibrateModelsWithHardware', () => {
    const tier2Profile: HardwareTierInfo = {
      tier: 'Tier 2: Standard',
      tier_number: 2,
      vram_mb: 8192,
      ram_mb: 16384,
      context_budget: 16384,
      auto_eviction_timeout_secs: 300,
      recommended_autocomplete_model: 'qwen2.5-coder:1.5b',
      recommended_chat_model: 'qwen2.5-coder:7b',
    };

    it('marks fully configured when all recommended models are installed', () => {
      const models = [
        { name: 'qwen2.5-coder:1.5b', size: 986000000 },
        { name: 'qwen2.5-coder:7b', size: 4700000000 },
        { name: 'deepseek-r1:8b', size: 4900000000 },
      ];

      const res = calibrateModelsWithHardware(tier2Profile, models, true);
      expect(res.isFullyConfigured).toBe(true);
      expect(res.readinessScore).toBe(100);
      expect(res.missingModels).toHaveLength(0);
      expect(res.recommendedConfig.autocompleteModel).toBe('qwen2.5-coder:1.5b');
      expect(res.recommendedConfig.chatModel).toBe('qwen2.5-coder:7b');
      expect(res.recommendedConfig.editModel).toBe('qwen2.5-coder:7b');
      expect(res.recommendedConfig.reasoningModel).toBe('deepseek-r1:8b');
    });

    it('reports missing models and generates copyable pull commands when models are missing', () => {
      const models = [
        { name: 'qwen2.5-coder:1.5b', size: 986000000 },
      ];

      const res = calibrateModelsWithHardware(tier2Profile, models, true);
      expect(res.isFullyConfigured).toBe(false);
      expect(res.missingModels.length).toBeGreaterThan(0);

      const chatMissing = res.missingModels.find((m) => m.role === 'chat');
      expect(chatMissing).toBeDefined();
      expect(chatMissing?.pullCommand).toBe('ollama pull qwen2.5-coder:7b');

      const reasoningMissing = res.missingModels.find((m) => m.role === 'reasoning');
      expect(reasoningMissing).toBeDefined();
      expect(reasoningMissing?.pullCommand).toBe('ollama pull deepseek-r1:8b');
    });

    it('reports 0% readiness when Ollama is offline or no models found', () => {
      const res = calibrateModelsWithHardware(tier2Profile, [], false);
      expect(res.isOllamaOnline).toBe(false);
      expect(res.readinessScore).toBe(0);
      expect(res.missingModels).toHaveLength(3);
      expect(res.tierModels).toHaveLength(3);
      expect(res.tierModels.every((m) => !m.isInstalled)).toBe(true);
    });

    it('maps alternative installed models when preferred ones are absent', () => {
      const altModels = [
        { name: 'deepseek-coder:1.3b', size: 850000000 },
        { name: 'codestral:22b', size: 14000000000 },
      ];

      const res = calibrateModelsWithHardware(tier2Profile, altModels, true);
      expect(res.recommendedConfig.autocompleteModel).toBe('deepseek-coder:1.3b');
      expect(res.recommendedConfig.chatModel).toBe('codestral:22b');
      expect(res.recommendedConfig.editModel).toBe('codestral:22b');
    });
  });

  describe('detectAndCalibrateModels', () => {
    it('executes end-to-end hardware and inference detection', async () => {
      const result = await detectAndCalibrateModels('http://localhost:11434');
      expect(result).toBeDefined();
      expect(result.tier).toBeDefined();
      expect(typeof result.readinessScore).toBe('number');
      expect(result.recommendedConfig).toBeDefined();
      expect(Array.isArray(result.missingModels)).toBe(true);
      expect(Array.isArray(result.installedModels)).toBe(true);
    });
  });
});
