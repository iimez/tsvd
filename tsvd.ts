#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run

/**
 * TSVD - Edit Tabular Data Spreadsheets using LLMs
 *
 * Usage:
 *   tsvd.ts [options] [file]
 *
 * Options:
 *   -d, --debug                Enable debug output
 *   -m, --model <model>        Model to use (defaults: anthropic=claude-sonnet-4-5-20250929, openrouter=z-ai/glm-4.6:exacto)
 *   -p, --provider <provider>  Provider: anthropic or openrouter (auto-detected from API keys)
 *   --prompt <prompt>          Initial prompt to send to the model
 *   --cache                    Enable prompt caching (default: false)
 *   -h, --help                 Show help
 *   -V, --version              Show version
 *
 * Arguments:
 *   [file]                     TSV file to edit (optional, will prompt if not provided)
 *   -                          Read from stdin
 */

import denoConfig from './deno.json' with { type: 'json' }
import { Command, EnumType } from '@cliffy/command'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import {
	ModelMessage,
	stepCountIs,
	streamText,
	StreamTextOnChunkCallback,
} from 'ai'
import { colors } from '@cliffy/ansi/colors'
import { computeDiff } from './lib/computeDiff.ts'
import { loadInitialTable } from './lib/loadInitialTable.ts'
import { parseTSV, tableToMarkdown, tableToTSV } from './lib/spreadsheet.ts'
import { readLine } from './lib/readLine.ts'
import { confirm } from './lib/confirm.ts'
import { trimWhitespaceTransform } from './lib/trimWhitespaceTransform.ts'
import {
	createMessages,
	createSystemMessage,
	createUserMessage,
} from './lib/messages.ts'
import {
	createTools,
	toolDefinitions,
	toolEditCells,
	toolReplaceAll,
	toolReplaceArea,
	toolStrReplace,
} from './lib/tools.ts'

const PROVIDER_DEFAULTS = {
	anthropic: {
		model: 'claude-sonnet-4-5-20250929',
		providerOptions: {
			anthropic: {
				thinking: { type: 'enabled', budgetTokens: 4096 },
			},
		},
	},
	openrouter: {
		model: 'z-ai/glm-4.6:exacto',
		providerOptions: {
			openrouter: {
				reasoning: {
					max_tokens: 4096,
				},
			},
		},
	},
} as const

let DEBUG = false

function debug(message: string, data?: unknown) {
	if (DEBUG) {
		console.log(`[DEBUG] ${message}`)
		if (data !== undefined) {
			console.log(JSON.stringify(data, null, 2))
		}
	}
}

// Main function
async function main() {
	const providerTypeEnum = new EnumType(['anthropic', 'openrouter'])

	const { options, args } = await new Command()
		.name('tsvd')
		.version(denoConfig.version)
		.description('Edit Tabular Data Spreadsheets using LLMs')
		.type('provider', providerTypeEnum)
		.option('-d, --debug', 'Enable debug output.')
		.option(
			'-m, --model <model:string>',
			'Model to use (defaults based on provider).',
		)
		.option(
			'-p, --provider <provider:provider>',
			'Provider: anthropic or openrouter (auto-detected from API keys).',
		)
		.option(
			'--prompt <prompt:string>',
			'Initial prompt to send to the model.',
		)
		.option('--cache', 'Enable prompt caching (default: false).')
		.arguments('[file:string]')
		.parse(Deno.args)

	// Set debug flag
	DEBUG = options.debug || false

	// Set cache flag
	const enableCache = options.cache || false

	// Check if reading from stdin (special argument "-")
	const readFromStdin = args[0] === '-'
	const filePath = readFromStdin ? null : args[0] || null

	let model = options.model || null
	let provider: 'anthropic' | 'openrouter' = options.provider || (null as any)

	// Check available API keys
	const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
	const openrouterKey = Deno.env.get('OPENROUTER_API_KEY')

	// Determine provider: explicit flag > api_key_defined
	if (!provider) {
		// No explicit flag - use whichever API key is defined
		if (anthropicKey) {
			provider = 'anthropic'
		} else if (openrouterKey) {
			provider = 'openrouter'
		} else {
			console.error(
				'Error: No --provider flag given and no API keys found. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.',
			)
			Deno.exit(1)
		}
	}

	// Validate the selected provider has its API key
	if (provider === 'anthropic' && !anthropicKey) {
		console.error(
			'Error: --provider anthropic specified but ANTHROPIC_API_KEY environment variable not set',
		)
		Deno.exit(1)
	}

	if (provider === 'openrouter' && !openrouterKey) {
		console.error(
			'Error: --provider openrouter specified but OPENROUTER_API_KEY environment variable not set',
		)
		Deno.exit(1)
	}

	// Set default model for provider if not explicitly specified
	if (!model) {
		model = PROVIDER_DEFAULTS[provider].model
	}

	// Load the initial table from stdin, file, or editor
	let {
		table: currentTable,
		filePath: workingFilePath,
		originalFilePath,
	} = await loadInitialTable(filePath, readFromStdin)

	// Track last known disk content to detect external changes
	let lastKnownDiskContent = tableToTSV(currentTable)

	// Set up signal handler with closure over local variables
	let handlingSignal = false
	Deno.addSignalListener('SIGINT', () => {
		if (handlingSignal) return // Prevent re-entry
		handlingSignal = true // Signal handler for Ctrl+C
		;(async () => {
			console.log() // New line after ^C

			if (!workingFilePath || !currentTable) {
				// No active session, just exit
				Deno.exit(0)
			}

			await handleExit(currentTable, originalFilePath)
			Deno.exit(0)
		})().catch((err) => {
			console.error(`Error in signal handler: ${err.message}`)
			Deno.exit(1)
		})
	})

	const numCols = Math.max(...currentTable.map((row) => row.length), 0)

	const loadPrefix = originalFilePath
		? `→ Loaded ${originalFilePath}`
		: readFromStdin
		? `→ Loaded spreadsheet from stdin`
		: `→ Loaded spreadsheet`

	console.log(
		colors.dim(
			colors.italic(
				`${loadPrefix} (${currentTable.length}x${numCols}) — working file: ${workingFilePath} — ${provider}/${model}`,
			),
		),
	)

	if (DEBUG) {
		console.log(`[DEBUG] Debug mode enabled`)
	}

	// Extract filename without extension
	const fileNameWithoutExt = originalFilePath
		? originalFilePath
			.replace(/\.[^/.]+$/, '')
			.split('/')
			.pop() || 'spreadsheet'
		: 'spreadsheet'

	// System prompt
	const introSentence = originalFilePath
		? `You've been asked to take a look at "${fileNameWithoutExt}". The file is loading before you now. Looks like a spreadsheet. Seems important.`
		: `A file is loading before you now. Looks like a spreadsheet. Seems important.`

	const systemPrompt = `*booting tsvd* ...

${introSentence}

While waiting, you remember your training. They always said: "Never change comma decimals unless you have a good reason." Good advice. Better think twice when encountering them. Assuming the wrong locale will mess up people's data badly.

For example, Google Sheets does =SUM(A1;A2;A3), not =SUM(A1,A2,A3) in European locales. Have to be aware of that.

The data appears as a markdown table - row numbers down the left, column labels across the top (A, B, C...).

You look at the tools at your disposal: edit_cells for surgical changes, str_replace for replace efficiently, replace_all for big overhauls, and finally replace_area to shift or rewrite rectangular blocks of data.

The spreadsheet has no bounds, all tools can write outside bounds to expand the sheet dimensions whenever required.

You have learned that replace_area is usually the most effective way to make changes. Can't assume that formulas and cell references will update automatically when rows/columns are inserted or deleted.

Thats it. Time to see what they need.`

	// Initialize provider based on selection
	let languageModel
	if (provider === 'anthropic') {
		const anthropic = createAnthropic({ apiKey: anthropicKey! })
		languageModel = anthropic(model)
	} else {
		const openrouter = createOpenRouter({ apiKey: openrouterKey! })
		languageModel = openrouter(model)
	}

	// Conversation history
	const messages: ModelMessage[] = []

	// Initial prompt from command line
	let initialPrompt = options.prompt || null

	// Interactive loop
	while (true) {
		// Prompt for input (use initial prompt on first iteration, then ask user)
		const prompt = initialPrompt !== null
			? initialPrompt
			: await readLine(colors.cyan('prompt › '))

		// Clear initial prompt after first use
		if (initialPrompt !== null) {
			// Display it so user sees what was sent
			console.log(colors.cyan('prompt › ') + initialPrompt)
			initialPrompt = null
		}

		// User interrupted (Ctrl+C) or empty prompt
		if (prompt === null || prompt.trim() === '') {
			await handleExit(currentTable, originalFilePath)

			if (DEBUG) {
				console.error(`Breaking: prompt="${prompt}"`)
			}
			break
		}

		// Re-read table from disk before each turn to pick up manual edits
		try {
			const diskContent = await Deno.readTextFile(workingFilePath)
			// Only reload if content changed on disk
			if (diskContent !== lastKnownDiskContent) {
				currentTable = parseTSV(diskContent)
				lastKnownDiskContent = diskContent
				// Always print hint when file was externally modified
				console.log(
					colors.italic(
						colors.dim(
							`→ Working file updated: ${
								workingFilePath.split('/').pop()
							}`,
						),
					),
				)
				if (DEBUG) {
					debug('Reloaded table from disk', {
						rows: currentTable.length,
						cols: Math.max(
							...currentTable.map((row) => row.length),
							0,
						),
					})
				}
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			console.error(
				colors.red(`Warning: Could not reload from disk: ${message}`),
			)
			// Continue with in-memory table
		}

		// Add system message on first iteration
		if (messages.length === 0) {
			messages.push(
				createSystemMessage(systemPrompt, provider, enableCache),
			)
		}

		// Add user message
		messages.push(
			createUserMessage(
				`Current spreadsheet:\n\n${tableToMarkdown(currentTable)}`,
				prompt,
				provider,
			),
		)

		try {
			debug(`Calling ${provider} API`, {
				model,
				messageCount: messages.length,
			})

			let outputMode: 'none' | 'thinking' | 'text' = 'none'
			let workingTable = structuredClone(currentTable)
			let hasSuccessfulChanges = false
			const errors: string[] = []

			// Tool definitions with execute handlers
			const toolsWithExecute = {
				str_replace: {
					...toolDefinitions.str_replace,
					execute: (args: { old_str: string; new_str: string }) => {
						const result = toolStrReplace(workingTable, args)
						if (result.success && result.proposedTable) {
							workingTable = result.proposedTable
							hasSuccessfulChanges = true
							return `Replaced "${args.old_str}" with "${args.new_str}"`
						} else {
							errors.push(
								`str_replace(${args.old_str}, ${args.new_str}): ${result.error}`,
							)
							return `Error: ${result.error}`
						}
					},
				},
				replace_all: {
					...toolDefinitions.replace_all,
					execute: (args: { new_table: string }) => {
						const result = toolReplaceAll(workingTable, args)
						if (result.success && result.proposedTable) {
							workingTable = result.proposedTable
							hasSuccessfulChanges = true
							return 'Replaced entire table'
						} else {
							const preview = args.new_table.length > 50
								? args.new_table.substring(0, 47) + '...'
								: args.new_table
							errors.push(
								`replace_all(${preview}): ${result.error}`,
							)
							return `Error: ${result.error}`
						}
					},
				},
				edit_cells: {
					...toolDefinitions.edit_cells,
					execute: (
						args: { edits: { cell: string; value: string }[] },
					) => {
						const result = toolEditCells(workingTable, args)
						if (result.success && result.proposedTable) {
							workingTable = result.proposedTable
							hasSuccessfulChanges = true
							return `Edited ${args.edits.length} cell(s)`
						} else {
							const editsPreview = args.edits
								.slice(0, 2)
								.map((e) => `${e.cell}=${e.value}`)
								.join(', ') +
								(args.edits.length > 2 ? '...' : '')
							errors.push(
								`edit_cells([${editsPreview}]): ${result.error}`,
							)
							return `Error: ${result.error}`
						}
					},
				},
				replace_area: {
					...toolDefinitions.replace_area,
					execute: (args: {
						from_cell: string
						to_cell: string
						values: string[][]
					}) => {
						const result = toolReplaceArea(workingTable, args)
						if (result.success && result.proposedTable) {
							workingTable = result.proposedTable
							hasSuccessfulChanges = true
							return `Replaced area ${args.from_cell}:${args.to_cell}`
						} else {
							errors.push(
								`replace_area(${args.from_cell}, ${args.to_cell}, [${args.values.length} rows]): ${result.error}`,
							)
							return `Error: ${result.error}`
						}
					},
				},
			}

			const onChunk: StreamTextOnChunkCallback<typeof toolsWithExecute> =
				({
					chunk,
				}) => {
					if (chunk.type === 'reasoning-delta') {
						// Transition to thinking mode if not already in it
						if (outputMode !== 'thinking') {
							Deno.stdout.writeSync(
								new TextEncoder().encode(
									colors.dim(colors.white('[thinking] ')),
								),
							)
							outputMode = 'thinking'
						}
						Deno.stdout.writeSync(
							new TextEncoder().encode(
								colors.dim(colors.white(chunk.text)),
							),
						)
					} else if (chunk.type === 'text-delta') {
						// Transition to text mode if not already in it
						if (outputMode !== 'text') {
							Deno.stdout.writeSync(
								new TextEncoder().encode(
									colors.cyan('\ntsvd › '),
								),
							)
							outputMode = 'text'
						}
						Deno.stdout.writeSync(
							new TextEncoder().encode(chunk.text),
						)
					} else if (chunk.type === 'tool-call') {
						// Display tool call inline as it happens
						const args = chunk.input as Record<string, unknown>
						const paramKeys = Object.keys(args)

						// Show abbreviated parameters
						let paramStr = ''
						if (paramKeys.length > 0) {
							const paramParts: string[] = []
							for (const key of paramKeys.slice(0, 3)) {
								const value = args[key]
								let valueStr: string

								if (
									typeof value === 'object' && value !== null
								) {
									valueStr = JSON.stringify(value)
								} else {
									valueStr = String(value)
								}

								if (valueStr.length > 120) {
									valueStr = valueStr.substring(0, 117) +
										'...'
								}
								valueStr = valueStr.replace(/\s+/g, ' ')
								paramParts.push(valueStr)
							}
							if (paramKeys.length > 3) {
								paramParts.push('...')
							}
							paramStr = `(${paramParts.join(', ')})`
						}

						Deno.stdout.writeSync(
							new TextEncoder().encode(
								colors.yellow(
									`\n[${chunk.toolName}${paramStr}]`,
								),
							),
						)
					}
				}

			const result = streamText<typeof toolsWithExecute>({
				model: languageModel,
				// System prompt is now in messages array for Anthropic caching
				// For non-Anthropic providers, we could still use system parameter,
				// but using messages array works for all providers
				messages: createMessages(messages, provider, enableCache),
				tools: createTools(toolsWithExecute, provider, enableCache),
				stopWhen: stepCountIs(5),
				providerOptions: PROVIDER_DEFAULTS[provider].providerOptions,
				experimental_transform: [
					trimWhitespaceTransform<typeof toolsWithExecute>(),
				],
				onChunk,
				onFinish() {
					console.log() // New line before next prompt
				},
				onError({ error }: { error: unknown }) {
					console.error(colors.red('\n✖ API Error:'))
					if (error instanceof Error) {
						console.error(colors.red(`  ${error.message}`))
						if (DEBUG && error.stack) {
							console.error(colors.dim(error.stack))
						}
					} else if (typeof error === 'object' && error !== null) {
						console.error(
							colors.red(`  ${JSON.stringify(error, null, 2)}`),
						)
					} else {
						console.error(colors.red(`  ${String(error)}`))
					}
					console.error('')
				},
			})

			// Wait for the stream to complete
			const finishReason = await result.finishReason
			const steps = await result.steps
			const response = await result.response
			const providerMetadata = await result.providerMetadata
			const usage = await result.usage
			const text = await result.text

			debug(`${provider} API response completed`, {
				finishReason,
				stepsCount: steps ? steps.length : 0,
				usage: usage
					? {
						inputTokens: usage.inputTokens,
						outputTokens: usage.outputTokens,
						totalTokens: usage.totalTokens,
					}
					: undefined,
				textLength: text ? text.length : 0,
			})

			// Log usage metrics
			const inputTokens = usage?.inputTokens || 0
			const outputTokens = usage?.outputTokens || 0
			let usageInfo = `Usage: ${inputTokens} in, ${outputTokens} out`

			// Add cache metrics for Anthropic
			if (provider === 'anthropic' && providerMetadata?.anthropic) {
				const cacheMetrics = providerMetadata.anthropic
				// console.debug('cacheMetrics', cacheMetrics)
				const cacheWrites = cacheMetrics.cacheCreationInputTokens || 0
				const cacheReads = cacheMetrics.cacheReadInputTokens || 0
				if (cacheWrites || cacheReads) {
					usageInfo += ` • cache: ${cacheReads} reads`
					if (cacheWrites) {
						usageInfo += `, ${cacheWrites} writes`
					}
				}
			}

			// Add cache metrics for OpenRouter
			if (provider === 'openrouter' && providerMetadata?.openrouter) {
				const openrouterMetrics = providerMetadata.openrouter as any
				// console.debug('openrouterMetrics', openrouterMetrics)
				const promptTokensDetails = openrouterMetrics.usage
					?.promptTokensDetails
				const cacheReads = promptTokensDetails?.cachedTokens || 0
				if (cacheReads) {
					usageInfo += ` • cache: ${cacheReads} reads`
				}
			}

			console.log(colors.dim(colors.italic(`→ ${usageInfo}`)))

			// Show any errors that occurred
			if (errors.length > 0) {
				console.log(colors.red('\nErrors occurred:'))
				for (const error of errors) {
					console.log(colors.red(`  - ${error}`))
				}
				console.log()
			}

			// After model finishes, show final cumulative diff and prompt for confirmation
			if (hasSuccessfulChanges) {
				// Show the final cumulative diff
				const oldTSV = tableToTSV(currentTable)
				const newTSV = tableToTSV(workingTable)
				const diff = computeDiff(oldTSV, newTSV)

				console.log(
					colors.bold(
						colors.cyan(
							'\n╭─ Proposed changes ─────────────────────────────────────────',
						),
					),
				)
				// Trim trailing newline from diff to avoid extra blank line
				console.log(diff.trimEnd())
				console.log(
					colors.bold(
						colors.cyan(
							'├────────────────────────────────────────────────────────────',
						),
					),
				)
				// Prompt user to apply changes
				const confirmResult = await confirm('Accept changes?', true)

				if (confirmResult === null) {
					// User pressed Ctrl+C
					console.log(
						colors.dim(colors.italic('→ Changes not applied.')),
					)
				} else if (confirmResult) {
					currentTable = workingTable

					// Save to working temp file only (not to original file yet)
					try {
						await Deno.writeTextFile(workingFilePath, newTSV)
						lastKnownDiskContent = newTSV // Update tracking after write
						console.log(
							colors.dim(
								colors.italic(
									`→ Working file updated: ${workingFilePath}`,
								),
							),
						)
					} catch (err: unknown) {
						const message = err instanceof Error
							? err.message
							: String(err)
						console.error(`\nError writing file: ${message}\n`)
					}
				} else {
					console.log(
						colors.dim(colors.italic('→ Changes not applied.')),
					)
				}
			}

			// Add assistant response to conversation history
			// Vercel AI SDK handles this automatically through the response.messages
			const responseMessages = response.messages
			if (responseMessages && responseMessages.length > 0) {
				messages.push(...responseMessages)
			}
		} catch (err: unknown) {
			console.error(colors.red('\n✖ API Error:'))
			if (err instanceof Error) {
				console.error(colors.red(`  ${err.message}`))
				if (DEBUG && err.stack) {
					console.error(colors.dim(err.stack))
				}
			} else if (typeof err === 'object' && err !== null) {
				console.error(colors.red(`  ${JSON.stringify(err, null, 2)}`))
			} else {
				console.error(colors.red(`  ${String(err)}`))
			}
			console.error('')
			messages.pop() // Remove the failed message
			continue
		}
	}

	// Clean up temp file
	try {
		await Deno.remove(workingFilePath)
		if (DEBUG) {
			console.log(`Cleaned up temp file: ${workingFilePath}`)
		}
	} catch {
		// Ignore cleanup errors
	}
}

async function handleExit(
	currentTable: string[][],
	originalFilePath: string | null,
) {
	// Check if there are unsaved changes
	const currentTSV = tableToTSV(currentTable)
	const diskContent = originalFilePath
		? await Deno.readTextFile(originalFilePath).catch(() => '')
		: ''

	if (originalFilePath && currentTSV !== diskContent) {
		console.log(
			colors.yellow('You have unsaved changes to the original file.'),
		)
		const saveConfirm = await confirm(`Save to ${originalFilePath}?`, true)

		if (saveConfirm === null) {
			// User pressed Ctrl+C again, force exit
			console.log(colors.dim(colors.italic('→ Exiting without saving.')))
			return
		}

		if (saveConfirm) {
			try {
				await Deno.writeTextFile(originalFilePath, currentTSV)
				console.log(
					colors.dim(colors.italic(`→ Saved to ${originalFilePath}`)),
				)
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err)
				console.error(`\nError writing file: ${message}\n`)
			}
		} else {
			console.log(
				colors.dim(
					colors.italic('→ Not saved. Working file will be removed.'),
				),
			)
		}
	} else if (!originalFilePath && currentTSV.trim() !== '') {
		// No original file, ask if they want to save (if there's any content)
		const saveConfirm = await confirm(
			'Would you like to save your changes?',
			true,
		)

		if (saveConfirm === null) {
			console.log(colors.dim(colors.italic('→ Exiting without saving.')))
			return
		}

		if (saveConfirm) {
			// Prompt for filename
			const defaultFilename = `tsvd-${Date.now()}.tsv`
			const styledPrompt = colors.cyan(`Filename [${defaultFilename}]: `)
			const filename = await readLine(styledPrompt)

			if (filename === null) {
				console.log(
					colors.dim(colors.italic('→ Exiting without saving.')),
				)
				return
			}

			const targetFile = filename.trim() === ''
				? defaultFilename
				: filename

			try {
				await Deno.writeTextFile(targetFile, currentTSV)
				console.log(
					colors.dim(colors.italic(`→ Saved to ${targetFile}`)),
				)
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err)
				console.error(`\nError writing file: ${message}\n`)
			}
		} else {
			console.log(
				colors.dim(
					colors.italic('→ Not saved. Working file will be removed.'),
				),
			)
		}
	} else {
		// No changes, just exit
		console.log(colors.dim(colors.italic('→ No changes to save.')))
	}
}

// Run main function
if (import.meta.main) {
	main().catch((err) => {
		console.error(`Fatal error: ${err.message}`)
		Deno.exit(1)
	})
}
