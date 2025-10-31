import { ModelMessage } from 'ai'

/**
 * Creates a system message with optional cache control for Anthropic and OpenRouter
 */
export function createSystemMessage(
	content: string,
	provider: 'anthropic' | 'openrouter',
	enableCache: boolean = false,
): ModelMessage {
	if (!enableCache) {
		return {
			role: 'system',
			content,
		} as ModelMessage
	}

	const providerOptions: any = {}

	if (provider === 'anthropic') {
		providerOptions.anthropic = {
			cache_control: { type: 'ephemeral' as const },
		}
	} else if (provider === 'openrouter') {
		providerOptions.openrouter = { cacheControl: { type: 'ephemeral' } }
	}

	return {
		role: 'system',
		content,
		...(Object.keys(providerOptions).length > 0 && { providerOptions }),
	} as ModelMessage
}

/**
 * Creates a user message with Anthropic cache control on the spreadsheet content
 */
export function createUserMessage(
	spreadsheetContent: string,
	userPrompt: string,
	provider: 'anthropic' | 'openrouter',
): ModelMessage {
	if (provider === 'anthropic') {
		return {
			role: 'user',
			content: [
				{
					type: 'text',
					text: spreadsheetContent,
				},
				{
					type: 'text',
					text: userPrompt,
				},
			],
		} as ModelMessage
	} else {
		// For non-Anthropic providers, use simple string content
		return {
			role: 'user',
			content: `${spreadsheetContent}\n\n${userPrompt}`,
		}
	}
}

/**
 * Prepares messages for API call by applying cache control to the two most recent messages.
 * This ensures we stay within cache breakpoint limits (1 system + 2 recent = 3 total).
 */
export function createMessages(
	messages: ModelMessage[],
	provider: 'anthropic' | 'openrouter',
	enableCache: boolean = false,
): ModelMessage[] {
	if (
		!enableCache || (provider !== 'anthropic' && provider !== 'openrouter')
	) {
		// For providers without caching support or when cache is disabled, return messages as-is
		return messages
	}

	// Apply cache control to the last 2 messages
	const lastTwoIndices = new Set([
		messages.length - 1,
		messages.length - 2,
	].filter((i) => i >= 0))

	return messages.map((msg, idx) => {
		// Only apply cache control to the last 2 messages
		if (!lastTwoIndices.has(idx)) {
			return msg
		}

		// Handle messages with array content
		if (Array.isArray(msg.content)) {
			const clonedContent = msg.content.map((item, itemIdx) => {
				if (item.type === 'text') {
					// Add cache control to the last text item
					if (itemIdx === msg.content.length - 1) {
						const itemProviderOptions: any = {}
						if (provider === 'anthropic') {
							itemProviderOptions.anthropic = {
								cache_control: { type: 'ephemeral' as const },
							}
						} else if (provider === 'openrouter') {
							itemProviderOptions.openrouter = {
								cacheControl: { type: 'ephemeral' },
							}
						}
						return {
							...item,
							providerOptions: itemProviderOptions,
						} as any
					}
				}
				return item
			})

			return {
				...msg,
				content: clonedContent,
			} as ModelMessage
		}

		// Handle messages with string content
		if (typeof msg.content === 'string') {
			const msgProviderOptions: any = {}
			if (provider === 'anthropic') {
				msgProviderOptions.anthropic = {
					cache_control: { type: 'ephemeral' as const },
				}
			} else if (provider === 'openrouter') {
				msgProviderOptions.openrouter = {
					cacheControl: { type: 'ephemeral' },
				}
			}
			return {
				...msg,
				providerOptions: msgProviderOptions,
			} as ModelMessage
		}

		return msg
	})
}
