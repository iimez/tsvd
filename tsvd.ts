#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run

/**
 * TSVD - TSV/Markdown Spreadsheet Editor with AI assistance
 *
 * Usage:
 *   tsvd.ts [options] [file]
 *
 * Options:
 *   -d, --debug                Enable debug output
 *   -m, --model <model>        Model to use (defaults: anthropic=claude-sonnet-4-5-20250929, openrouter=z-ai/glm-4.6:exacto)
 *   -p, --provider <provider>  Provider: anthropic or openrouter (auto-detected from API keys)
 *   --prompt <prompt>          Initial prompt to send to the model
 *   -h, --help                 Show help
 *   -V, --version              Show version
 *
 * Arguments:
 *   [file]                     TSV file to edit (optional, will prompt if not provided)
 *   -                          Read from stdin
 *
 * Examples:
 *   # Use Anthropic Claude (auto-detected from API key)
 *   ANTHROPIC_API_KEY=... deno run tsvd.ts myfile.tsv
 *
 *   # Use OpenRouter (auto-detected from API key)
 *   OPENROUTER_API_KEY=... deno run tsvd.ts myfile.tsv
 *
 *   # Explicitly specify provider
 *   OPENROUTER_API_KEY=... deno run tsvd.ts -p openrouter -m openai/gpt-4o myfile.tsv
 *
 *   # Pass an initial prompt
 *   ANTHROPIC_API_KEY=... deno run tsvd.ts --prompt "Add a new column for shipping cost" myfile.tsv
 *
 *   # Read from stdin
 *   cat data.tsv | ANTHROPIC_API_KEY=... deno run tsvd.ts -
 *
 * Note: Extended thinking is supported on both Anthropic and OpenRouter providers.
 */

import { Command, EnumType } from '@cliffy/command';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, CoreMessage, stepCountIs } from 'ai';
import { colors } from '@cliffy/ansi/colors';
import { computeDiff } from './lib/computeDiff.ts';
import { loadInitialTable } from './lib/loadInitialTable.ts';
import { tableToTSV, tableToMarkdown, parseTSV } from './lib/spreadsheet.ts';
import { readLine } from './lib/readLine.ts';
import { confirm } from './lib/confirm.ts';
import {
	toolsVercelAI,
	toolEditCells,
	toolReplaceAll,
	toolReplaceArea,
	toolStrReplace,
} from './lib/tools.ts';

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
} as const;

let DEBUG = false;

function debug(message: string, data?: unknown) {
	if (DEBUG) {
		console.log(`[DEBUG] ${message}`);
		if (data !== undefined) {
			console.log(JSON.stringify(data, null, 2));
		}
	}
}

// Main function
async function main() {
	const providerType = new EnumType(['anthropic', 'openrouter']);

	const { options, args } = await new Command()
		.name('tsvd')
		.version('0.1.0')
		.description('TSV/Markdown Spreadsheet Editor with AI assistance')
		.type('provider', providerType)
		.option('-d, --debug', 'Enable debug output.')
		.option('-m, --model <model:string>', 'Model to use (defaults based on provider).')
		.option('-p, --provider <provider:provider>', 'Provider: anthropic or openrouter (auto-detected from API keys).')
		.option('--prompt <prompt:string>', 'Initial prompt to send to the model.')
		.arguments('[file:string]')
		.parse(Deno.args);

	// Set debug flag
	DEBUG = options.debug || false;

	// Check if reading from stdin (special argument "-")
	const readFromStdin = args[0] === '-';
	const filePath = readFromStdin ? null : (args[0] || null);

	let model = options.model || null;
	let provider = options.provider || null;

	// Check available API keys
	const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
	const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');

	// Determine provider: explicit flag > api_key_defined
	if (!provider) {
		// No explicit flag - use whichever API key is defined
		if (anthropicKey) {
			provider = 'anthropic';
		} else if (openrouterKey) {
			provider = 'openrouter';
		} else {
			console.error('Error: No --provider flag given and no API keys found. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.');
			Deno.exit(1);
		}
	}

	// Validate the selected provider has its API key
	if (provider === 'anthropic' && !anthropicKey) {
		console.error('Error: --provider anthropic specified but ANTHROPIC_API_KEY environment variable not set');
		Deno.exit(1);
	}

	if (provider === 'openrouter' && !openrouterKey) {
		console.error('Error: --provider openrouter specified but OPENROUTER_API_KEY environment variable not set');
		Deno.exit(1);
	}

	// Set default model for provider if not explicitly specified
	if (!model) {
		model = PROVIDER_DEFAULTS[provider].model;
	}

	// Load the initial table from stdin, file, or editor
	let {
		table: currentTable,
		filePath: workingFilePath,
		originalFilePath,
	} = await loadInitialTable(filePath, readFromStdin);

	// Set up signal handler with closure over local variables
	let handlingSignal = false;
	Deno.addSignalListener('SIGINT', () => {
		if (handlingSignal) return; // Prevent re-entry
		handlingSignal = true;

		// Signal handler for Ctrl+C
		(async () => {
			console.log(); // New line after ^C

			if (!workingFilePath || !currentTable) {
				// No active session, just exit
				Deno.exit(0);
			}

			await handleExit(
				currentTable,
				originalFilePath,
			);
			Deno.exit(0);
		})().catch((err) => {
			console.error(`Error in signal handler: ${err.message}`);
			Deno.exit(1);
		});
	});

	const numCols = Math.max(...currentTable.map((row) => row.length), 0);

	if (originalFilePath) {
		console.log(colors.dim(colors.italic(
			`→ Loaded ${originalFilePath} (${currentTable.length} rows, ${numCols} columns) — working file: ${workingFilePath}`,
		)));
	} else if (readFromStdin) {
		console.log(colors.dim(colors.italic(
			`→ Loaded spreadsheet from stdin (${currentTable.length} rows, ${numCols} columns) — working file: ${workingFilePath}`,
		)));
	} else {
		console.log(colors.dim(colors.italic(
			`→ Loaded spreadsheet (${currentTable.length} rows, ${numCols} columns) — working file: ${workingFilePath}`,
		)));
	}

	if (DEBUG) {
		console.log(`[DEBUG] Debug mode enabled`);
		console.log(`[DEBUG] Provider: ${provider}`);
		console.log(`[DEBUG] Model: ${model}`);
		console.log(
			`[DEBUG] Initial table dimensions: ${currentTable.length}x${numCols}`,
		);
	}

	// Extract filename without extension
	const fileNameWithoutExt = originalFilePath
		? originalFilePath
				.replace(/\.[^/.]+$/, '')
				.split('/')
				.pop() || 'spreadsheet'
		: 'spreadsheet';

	// System prompt
	const introSentence = originalFilePath
		? `You've been asked to take a look at "${fileNameWithoutExt}". The file is loading before you now. Looks like a spreadsheet. Seems important.`
		: `A file is loading before you now. Looks like a spreadsheet. Seems important.`;

	const systemPrompt = `*booting tsvd* ...

${introSentence}

While waiting, you remember your training. They always said: "Never change comma decimals unless you have a good reason." Good advice. Better think twice when encountering them. Assuming the wrong locale will mess up people's data badly.

For example, Google Sheets does =SUM(A1;A2;A3), not =SUM(A1,A2,A3) in European locales. Have to be aware of that.

The data appears as a markdown table - row numbers down the left, column labels across the top (A, B, C...). Someone needs your help making changes to it.

You've got tools at your disposal. edit_cells for surgical changes, str_replace for replace efficiently, replace_all for big overhauls, and finally replace_area to shift or rewrite rectangular blocks of data.

The spreadsheet has no bounds, all your tools can write outside the frame to expand the sheet if needed.

Thats it. Time to see what they need.`;

	// Initialize provider based on selection
	let languageModel;
	if (provider === 'anthropic') {
		const anthropic = createAnthropic({ apiKey: anthropicKey! });
		languageModel = anthropic(model);
	} else {
		const openrouter = createOpenRouter({ apiKey: openrouterKey! });
		languageModel = openrouter(model);
	}

	// Conversation history
	const messages: CoreMessage[] = [];

	// Initial prompt from command line
	let initialPrompt = options.prompt || null;

	// Interactive loop
	while (true) {
		// Prompt for input (use initial prompt on first iteration, then ask user)
		const prompt = initialPrompt !== null
			? initialPrompt
			: await readLine(colors.cyan('prompt › '));
		
		// Clear initial prompt after first use
		if (initialPrompt !== null) {
			// Display it so user sees what was sent
			console.log(colors.cyan('prompt › ') + initialPrompt);
			initialPrompt = null;
		}

		// User interrupted (Ctrl+C) or empty prompt
		if (prompt === null || prompt.trim() === '') {
			await handleExit(
				currentTable,
				originalFilePath,
			);

			if (DEBUG) {
				console.error(`Breaking: prompt="${prompt}"`);
			}
			break;
		}

		// Add user message
		messages.push({
			role: 'user',
			content: `Current spreadsheet:\n\n${tableToMarkdown(currentTable)}\n\n${prompt}`,
		});

		// Call Claude with streaming via Vercel AI SDK
		try {
			debug(`Calling ${provider} API`, {
				model,
				messageCount: messages.length,
			});

			let outputMode: 'none' | 'thinking' | 'text' = 'none';
			let workingTable = structuredClone(currentTable);
			let hasSuccessfulChanges = false;
			const errors: string[] = [];
			let lastOutputChars = ''; // Track last few chars to ensure single newline at end

			// Create tools with execute functions that modify workingTable
			const toolsWithExecute = {
				str_replace: {
					...toolsVercelAI.str_replace,
					execute: (args: { old_str: string; new_str: string }) => {
						const result = toolStrReplace(workingTable, args);
						if (result.success && result.proposedTable) {
							workingTable = result.proposedTable;
							hasSuccessfulChanges = true;
							return `Replaced "${args.old_str}" with "${args.new_str}"`;
						} else {
							errors.push(`str_replace(${args.old_str}, ${args.new_str}): ${result.error}`);
							return `Error: ${result.error}`;
						}
					},
				},
				replace_all: {
					...toolsVercelAI.replace_all,
					execute: (args: { new_table: string }) => {
						const result = toolReplaceAll(workingTable, args);
						if (result.success && result.proposedTable) {
							workingTable = result.proposedTable;
							hasSuccessfulChanges = true;
							return 'Replaced entire table';
						} else {
							const preview = args.new_table.length > 50 ? args.new_table.substring(0, 47) + '...' : args.new_table;
							errors.push(`replace_all(${preview}): ${result.error}`);
							return `Error: ${result.error}`;
						}
					},
				},
				edit_cells: {
					...toolsVercelAI.edit_cells,
					execute: (args: { edits: { cell: string; value: string }[] }) => {
						const result = toolEditCells(workingTable, args);
						if (result.success && result.proposedTable) {
							workingTable = result.proposedTable;
							hasSuccessfulChanges = true;
							return `Edited ${args.edits.length} cell(s)`;
						} else {
							const editsPreview = args.edits.slice(0, 2).map(e => `${e.cell}=${e.value}`).join(', ') + (args.edits.length > 2 ? '...' : '');
							errors.push(`edit_cells([${editsPreview}]): ${result.error}`);
							return `Error: ${result.error}`;
						}
					},
				},
				replace_area: {
					...toolsVercelAI.replace_area,
					execute: (args: { from_cell: string; to_cell: string; values: string[][] }) => {
						const result = toolReplaceArea(workingTable, args);
						if (result.success && result.proposedTable) {
							workingTable = result.proposedTable;
							hasSuccessfulChanges = true;
							return `Replaced area ${args.from_cell}:${args.to_cell}`;
						} else {
							errors.push(`replace_area(${args.from_cell}, ${args.to_cell}, [${args.values.length} rows]): ${result.error}`);
							return `Error: ${result.error}`;
						}
					},
				},
			};

			// Build stream options
			const streamOptions: Record<string, any> = {
				model: languageModel,
				system: providerType === 'anthropic' ? [
					{
						role: 'system' as const,
						content: systemPrompt,
						providerOptions: {
							anthropic: {
								cacheControl: { type: 'ephemeral' as const },
							},
						},
					},
				] : systemPrompt,
				messages,
				tools: providerType === 'anthropic'
					? Object.fromEntries(
						Object.entries(toolsWithExecute).map(([name, tool]) => [
							name,
							{
								...tool,
								providerOptions: {
									anthropic: {
										cacheControl: { type: 'ephemeral' as const },
									},
								},
							},
						])
					)
					: toolsWithExecute,
				stopWhen: stepCountIs(5),
				onChunk({ chunk }) {
					if (chunk.type === 'reasoning-delta') {
						// Transition to thinking mode if not already in it
						if (outputMode !== 'thinking') {
							Deno.stdout.writeSync(
								new TextEncoder().encode(
									colors.dim(colors.white('[thinking] ')),
								),
							);
							outputMode = 'thinking';
						}
						Deno.stdout.writeSync(
							new TextEncoder().encode(colors.dim(colors.white(chunk.text))),
						);
					} else if (chunk.type === 'text-delta') {
						// Transition to text mode if not already in it
						if (outputMode !== 'text') {
							Deno.stdout.writeSync(
								new TextEncoder().encode(colors.cyan('\ntsvd › ')),
							);
							outputMode = 'text';
						}
						Deno.stdout.writeSync(new TextEncoder().encode(chunk.text));
						// Track last few characters for newline normalization
						lastOutputChars = (lastOutputChars + chunk.text).slice(-5);
					} else if (chunk.type === 'tool-call') {
						// Display tool call inline as it happens
						const args = chunk.input as Record<string, unknown>;
						const paramKeys = Object.keys(args);

						// Show abbreviated parameters
						let paramStr = '';
						if (paramKeys.length > 0) {
							const paramParts: string[] = [];
							for (const key of paramKeys.slice(0, 3)) {
								const value = args[key];
								let valueStr: string;

								if (typeof value === 'object' && value !== null) {
									valueStr = JSON.stringify(value);
								} else {
									valueStr = String(value);
								}

								if (valueStr.length > 120) {
									valueStr = valueStr.substring(0, 117) + '...';
								}
								valueStr = valueStr.replace(/\s+/g, ' ');
								paramParts.push(valueStr);
							}
							if (paramKeys.length > 3) {
								paramParts.push('...');
							}
							paramStr = `(${paramParts.join(', ')})`;
						}

						Deno.stdout.writeSync(
							new TextEncoder().encode(
								colors.yellow(`\n[${chunk.toolName}${paramStr}]`),
							),
						);
					}
				},
				onError({ error }) {
					console.error(colors.red('\n✖ API Error:'));
					if (error instanceof Error) {
						console.error(colors.red(`  ${error.message}`));
						if (DEBUG && error.stack) {
							console.error(colors.dim(error.stack));
						}
					} else if (typeof error === 'object' && error !== null) {
						console.error(colors.red(`  ${JSON.stringify(error, null, 2)}`));
					} else {
						console.error(colors.red(`  ${String(error)}`));
					}
					console.error('');
				},
			};

			// Add provider-specific options (including extended thinking)
			streamOptions.providerOptions = PROVIDER_DEFAULTS[provider].providerOptions;

			const result = streamText(streamOptions);

			// Wait for the stream to complete
			const finishReason = await result.finishReason;
			const steps = await result.steps;
			const response = await result.response;
			const providerMetadata = await result.experimental_providerMetadata;
			const usage = await result.usage;
			const text = await result.text;

			debug(`${provider} API response completed`, {
				finishReason,
				stepsCount: steps ? steps.length : 0,
				usage: usage ? {
					promptTokens: usage.promptTokens,
					completionTokens: usage.completionTokens,
					totalTokens: usage.totalTokens,
				} : undefined,
				textLength: text ? text.length : 0,
			});

			// Log cache usage metrics for Anthropic
			if (providerType === 'anthropic' && providerMetadata?.anthropic) {
				const cacheMetrics = providerMetadata.anthropic;
				if (cacheMetrics.cacheCreationInputTokens || cacheMetrics.cacheReadInputTokens) {
					debug('Prompt cache metrics', {
						cacheCreationTokens: cacheMetrics.cacheCreationInputTokens || 0,
						cacheReadTokens: cacheMetrics.cacheReadInputTokens || 0,
					});
				}
			}

			// Ensure exactly one newline at end of model output
			if (outputMode === 'text') {
				// Count trailing newlines
				const trailingNewlines = lastOutputChars.match(/\n*$/)?.[0].length || 0;
				if (trailingNewlines === 0) {
					// No trailing newline, add one
					Deno.stdout.writeSync(new TextEncoder().encode('\n'));
				} else if (trailingNewlines > 1) {
					// Multiple trailing newlines already present, do nothing
					// (we already output them during streaming)
				}
				// If exactly 1 newline, perfect - do nothing
			}

			// Tool calls are now displayed inline during streaming

			// Show any errors that occurred
			if (errors.length > 0) {
				console.log(colors.red('\nErrors occurred:'));
				for (const error of errors) {
					console.log(colors.red(`  - ${error}`));
				}
				console.log();
			}

			// After model finishes, show final cumulative diff and prompt for confirmation
			let changesApplied = false;

			if (hasSuccessfulChanges) {
				// Show the final cumulative diff
				const oldTSV = tableToTSV(currentTable);
				const newTSV = tableToTSV(workingTable);
				const diff = computeDiff(oldTSV, newTSV);

				console.log(
					colors.bold(
						colors.cyan(
							'\n╭─ Proposed changes ─────────────────────────────────────────',
						),
					),
				);
				// Trim trailing newline from diff to avoid extra blank line
				console.log(diff.trimEnd());
				console.log(
					colors.bold(
						colors.cyan(
							'├────────────────────────────────────────────────────────────',
						),
					),
				);
				// Prompt user to apply changes
				const confirmResult = await confirm(
					'Accept changes?',
					true,
				);

				if (confirmResult === null) {
					// User pressed Ctrl+C
					console.log(colors.dim(colors.italic('→ Changes not applied.')));
				} else if (confirmResult) {
					currentTable = workingTable;

					// Save to working temp file only (not to original file yet)
					try {
						await Deno.writeTextFile(workingFilePath, newTSV);
						console.log(
							colors.dim(
								colors.italic(`→ Working file updated: ${workingFilePath}`),
							),
						);
						changesApplied = true;
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : String(err);
						console.error(`\nError writing file: ${message}\n`);
					}
				} else {
					console.log(colors.dim(colors.italic('→ Changes not applied.')));
				}
			}

			// Add assistant response to conversation history
			// Vercel AI SDK handles this automatically through the response.messages
			const responseMessages = await response.messages;
			if (responseMessages && responseMessages.length > 0) {
				messages.push(...responseMessages);
			}

			// Re-read table from disk after each turn if changes were applied
			if (changesApplied) {
				try {
					const diskContent = await Deno.readTextFile(workingFilePath);
					currentTable = parseTSV(diskContent);
					if (DEBUG) {
						console.log(colors.dim(`[Reloaded table from ${workingFilePath}]`));
					}
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					console.error(
						colors.red(`Warning: Could not reload from disk: ${message}`),
					);
					// Continue with in-memory table
				}
			}
		} catch (err: unknown) {
			console.error(colors.red('\n✖ API Error:'));
			if (err instanceof Error) {
				console.error(colors.red(`  ${err.message}`));
				if (DEBUG && err.stack) {
					console.error(colors.dim(err.stack));
				}
			} else if (typeof err === 'object' && err !== null) {
				console.error(colors.red(`  ${JSON.stringify(err, null, 2)}`));
			} else {
				console.error(colors.red(`  ${String(err)}`));
			}
			console.error('');
			messages.pop(); // Remove the failed message
			continue;
		}
	}

	// Clean up temp file
	try {
		await Deno.remove(workingFilePath);
		if (DEBUG) {
			console.log(`Cleaned up temp file: ${workingFilePath}`);
		}
	} catch {
		// Ignore cleanup errors
	}

	if (originalFilePath) {
		console.log(
			colors.dim(colors.italic(`→ All changes saved to ${originalFilePath}`)),
		);
	}
}

async function handleExit(
	currentTable: string[][],
	originalFilePath: string | null,
) {
	// Check if there are unsaved changes
	const currentTSV = tableToTSV(currentTable);
	const diskContent = originalFilePath
		? await Deno.readTextFile(originalFilePath).catch(() => '')
		: '';

	if (originalFilePath && currentTSV !== diskContent) {
		console.log(
			colors.yellow('\nYou have unsaved changes to the original file.'),
		);
		const saveConfirm = await confirm(
			`Save to ${originalFilePath}?`,
			true,
		);

		if (saveConfirm === null) {
			// User pressed Ctrl+C again, force exit
			console.log(colors.dim(colors.italic('→ Exiting without saving.')));
			return;
		}

		if (saveConfirm) {
			try {
				await Deno.writeTextFile(originalFilePath, currentTSV);
				console.log(
					colors.dim(colors.italic(`→ Saved to ${originalFilePath}`)),
				);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`\nError writing file: ${message}\n`);
			}
		} else {
			console.log(colors.dim(colors.italic('→ Not saved. Working file will be removed.')));
		}
	} else if (!originalFilePath && currentTSV.trim() !== '') {
		// No original file, ask if they want to save (if there's any content)
		const saveConfirm = await confirm(
			'Would you like to save your changes?',
			true,
		);

		if (saveConfirm === null) {
			console.log(colors.dim(colors.italic('→ Exiting without saving.')));
			return;
		}

		if (saveConfirm) {
			// Prompt for filename
			const defaultFilename = `tsvd-${Date.now()}.tsv`;
			const styledPrompt = colors.cyan(`Filename [${defaultFilename}]: `);
			const filename = await readLine(styledPrompt);

			if (filename === null) {
				console.log(colors.dim(colors.italic('→ Exiting without saving.')));
				return;
			}

			const targetFile = filename.trim() === '' ? defaultFilename : filename;

			try {
				await Deno.writeTextFile(targetFile, currentTSV);
				console.log(colors.dim(colors.italic(`→ Saved to ${targetFile}`)));
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`\nError writing file: ${message}\n`);
			}
		} else {
			console.log(colors.dim(colors.italic('→ Not saved. Working file will be removed.')));
		}
	} else {
		// No changes, just exit
		console.log(colors.dim(colors.italic('→ No changes to save.')));
	}
}

// Run main function
if (import.meta.main) {
	main().catch((err) => {
		console.error(`Fatal error: ${err.message}`);
		Deno.exit(1);
	});
}
