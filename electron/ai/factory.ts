/** Provider 工厂：按配置类型返回适配器实例（新增厂商 = 新增类，业务层零改动）。 */
import type { ProviderConfig } from '../../shared/types'
import { store } from '../store'
import { AnthropicProvider } from './anthropic'
import { OpenAICompatProvider } from './openaiCompat'
import type { LLMProvider } from './provider'

export function createProvider(config: ProviderConfig): LLMProvider {
  const getApiKey = () => store.getApiKey(config.id)
  switch (config.type) {
    case 'anthropic':
      return new AnthropicProvider(config, getApiKey)
    case 'openai-compat':
    default:
      return new OpenAICompatProvider(config, getApiKey)
  }
}
