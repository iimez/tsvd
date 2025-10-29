#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import Anthropic from "npm:@anthropic-ai/sdk@0.68.0";
import { Confirm, Input } from "jsr:@cliffy/prompt@1.0.0-rc.8";
import { colors } from "jsr:@cliffy/ansi@1.0.0-rc.8/colors";

const MAX_COLUMNS = 26;
const MAX_ROWS = 1000;
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

let DEBUG = false;

function debug(message: string, data?: unknown) {
  if (DEBUG) {
    console.log(`[DEBUG] ${message}`);
    if (data !== undefined) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

type Cell = string;
type Row = Cell[];
type Table = Row[];

// Parse TSV file into 2D array
function parseTSV(content: string): Table {
  const lines = content.split("\n");
  const table: Table = [];

  for (const line of lines) {
    // Split by tabs, treat cells with tabs as empty
    const cells = line.split("\t").map(cell =>
      cell.includes("\t") ? "" : cell
    );
    table.push(cells);
  }

  // Remove only the final empty row if file ends with newline
  if (table.length > 0 && table[table.length - 1].length === 1 && table[table.length - 1][0] === "") {
    table.pop();
  }

  return table;
}

// Convert 2D array to TSV string
function tableToTSV(table: Table): string {
  return table.map(row => row.join("\t")).join("\n") + "\n";
}

// Generate column labels A, B, C, ..., Z
function getColumnLabel(index: number): string {
  if (index >= MAX_COLUMNS) {
    throw new Error(`Column index ${index} exceeds maximum of ${MAX_COLUMNS}`);
  }
  return String.fromCharCode(65 + index); // A=65
}

// Convert table to markdown with row numbers and column labels
function tableToMarkdown(table: Table): string {
  if (table.length === 0) return "";
  if (table.length > MAX_ROWS) {
    throw new Error(`Table has ${table.length} rows, exceeds maximum of ${MAX_ROWS}`);
  }

  const numCols = Math.max(...table.map(row => row.length));
  if (numCols > MAX_COLUMNS) {
    throw new Error(`Table has ${numCols} columns, exceeds maximum of ${MAX_COLUMNS}`);
  }

  // Header row with column labels
  const headers = ["", ...Array.from({ length: numCols }, (_, i) => getColumnLabel(i))];
  const headerRow = "| " + headers.join(" | ") + " |";

  // Separator row
  const separator = "| " + headers.map(() => "---").join(" | ") + " |";

  // Data rows with row numbers
  const dataRows = table.map((row, rowIndex) => {
    const paddedRow = [...row];
    // Pad row to have same number of columns
    while (paddedRow.length < numCols) {
      paddedRow.push("");
    }
    const cells = [String(rowIndex + 1), ...paddedRow.map(cell => cell || " ")];
    return "| " + cells.join(" | ") + " |";
  });

  return [headerRow, separator, ...dataRows].join("\n");
}

// Parse markdown table back to 2D array
function markdownToTable(markdown: string): Table {
  const lines = markdown.trim().split("\n");
  const table: Table = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip separator lines (contain only -, |, and spaces)
    if (/^[\s|\-]+$/.test(line)) continue;

    // Skip header row (first non-separator row)
    if (i === 0) continue;

    // Parse data rows
    const cells = line.split("|")
      .map(cell => cell.trim())
      .filter((_, index, arr) => index > 0 && index < arr.length - 1); // Remove first/last empty

    // Skip row number (first cell)
    const dataCells = cells.slice(1).map(cell => cell === " " ? "" : cell);
    table.push(dataCells);
  }

  return table;
}

// Git-style unified diff between two TSV strings
function computeDiff(oldTSV: string, newTSV: string): string {
  if (oldTSV === newTSV) {
    return "No changes.";
  }

  const oldLines = oldTSV.split('\n');
  const newLines = newTSV.split('\n');

  // Simple line-by-line LCS-based diff
  interface LineOp {
    type: 'equal' | 'delete' | 'insert';
    oldLine?: number;
    newLine?: number;
    content: string;
  }

  // Compute LCS (Longest Common Subsequence)
  const lcs: number[][] = [];
  for (let i = 0; i <= oldLines.length; i++) {
    lcs[i] = [];
    for (let j = 0; j <= newLines.length; j++) {
      if (i === 0 || j === 0) {
        lcs[i][j] = 0;
      } else if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to build the diff
  const ops: LineOp[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({ type: 'equal', oldLine: i - 1, newLine: j - 1, content: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      ops.unshift({ type: 'insert', newLine: j - 1, content: newLines[j - 1] });
      j--;
    } else if (i > 0) {
      ops.unshift({ type: 'delete', oldLine: i - 1, content: oldLines[i - 1] });
      i--;
    }
  }

  // Group into hunks with context
  const CONTEXT_LINES = 3;
  const hunks: { start: number; end: number }[] = [];

  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type !== 'equal') {
      const hunkStart = Math.max(0, idx - CONTEXT_LINES);
      let hunkEnd = idx;

      // Extend to include nearby changes
      while (hunkEnd < ops.length) {
        let foundChange = false;
        const searchEnd = Math.min(hunkEnd + CONTEXT_LINES * 2 + 1, ops.length);
        for (let k = hunkEnd; k < searchEnd; k++) {
          if (ops[k].type !== 'equal') {
            foundChange = true;
            hunkEnd = k;
          }
        }
        if (!foundChange) break;
        hunkEnd++;
      }

      hunkEnd = Math.min(ops.length - 1, hunkEnd + CONTEXT_LINES);

      // Merge overlapping hunks
      if (hunks.length > 0 && hunkStart <= hunks[hunks.length - 1].end + 1) {
        hunks[hunks.length - 1].end = hunkEnd;
      } else {
        hunks.push({ start: hunkStart, end: hunkEnd });
      }

      idx = hunkEnd;
    }
  }

  if (hunks.length === 0) {
    return "No changes.";
  }

  // Format output
  const output: string[] = [];

  for (const hunk of hunks) {
    const hunkOps = ops.slice(hunk.start, hunk.end + 1);

    // Calculate hunk header
    let oldStart = -1;
    let newStart = -1;
    let oldCount = 0;
    let newCount = 0;

    for (const op of hunkOps) {
      if (op.oldLine !== undefined) {
        if (oldStart === -1) oldStart = op.oldLine;
        oldCount++;
      }
      if (op.newLine !== undefined) {
        if (newStart === -1) newStart = op.newLine;
        newCount++;
      }
    }

    output.push(colors.cyan(`@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@`));

    for (const op of hunkOps) {
      // Make tabs visible by replacing them with a visual marker
      const visibleContent = op.content.replace(/\t/g, colors.dim('→') + '\t');

      if (op.type === 'delete') {
        output.push(colors.red(`-${visibleContent}`));
      } else if (op.type === 'insert') {
        output.push(colors.green(`+${visibleContent}`));
      } else {
        output.push(` ${visibleContent}`);
      }
    }
  }

  return output.join('\n');
}

// Main function
async function main() {
  // Parse arguments
  let filePath: string | null = null;
  let model = DEFAULT_MODEL;

  for (let i = 0; i < Deno.args.length; i++) {
    const arg = Deno.args[i];
    if (arg === "--model" || arg === "-m") {
      if (i + 1 >= Deno.args.length) {
        console.error("Error: --model flag requires a value");
        Deno.exit(1);
      }
      model = Deno.args[++i];
    } else if (arg === "--debug" || arg === "-d") {
      DEBUG = true;
    } else if (arg.startsWith("--")) {
      console.error(`Unknown flag: ${arg}`);
      console.error("Usage: tsvd [--model MODEL] [--debug] <file.tsv>");
      Deno.exit(1);
    } else {
      filePath = arg;
    }
  }

  if (!filePath) {
    console.error("Usage: tsvd [--model MODEL] [--debug] <file.tsv>");
    Deno.exit(1);
  }

  // Check API key
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable not set");
    console.error("Set it with: export ANTHROPIC_API_KEY=your-api-key");
    Deno.exit(1);
  }

  // Read and parse TSV file
  let content: string;
  try {
    content = await Deno.readTextFile(filePath);
  } catch (err) {
    console.error(`Error reading file: ${err.message}`);
    Deno.exit(1);
  }

  let currentTable: Table;
  try {
    currentTable = parseTSV(content);
  } catch (err) {
    console.error(`Error parsing TSV: ${err.message}`);
    Deno.exit(1);
  }

  // Validate dimensions
  try {
    tableToMarkdown(currentTable); // This will throw if dimensions exceeded
  } catch (err) {
    console.error(`Error: ${err.message}`);
    Deno.exit(1);
  }

  const numCols = Math.max(...currentTable.map(row => row.length), 0);

  console.log(`\nLoaded ${filePath} (${currentTable.length} rows, ${numCols} columns)\n`);

  if (DEBUG) {
    console.log(`[DEBUG] Debug mode enabled`);
    console.log(`[DEBUG] Model: ${model}`);
    console.log(`[DEBUG] Initial table dimensions: ${currentTable.length}x${numCols}\n`);
  }

  // Extract filename without extension
  const fileNameWithoutExt = filePath!.replace(/\.[^/.]+$/, '').split('/').pop() || 'spreadsheet';

  // System prompt
  const systemPrompt = `*booting tsvd* ...

You've been asked to take a look at "${fileNameWithoutExt}". The file is loading before you now. Looks like a spreadsheet. Seems important.

The data appears as a markdown table - row numbers down the left, column labels across the top (A, B, C...). Someone needs your help making changes to it.

You notice something interesting: this isn't just a plain spreadsheet. It understands formulas - the Excel kind. SUM, AVERAGE, IF statements, VLOOKUP, cell references like A1 or B2, ranges like A1:A10. Arrays too. The works.

One quirk though - when you're writing formulas here, parameters get separated by semicolons, not commas. So it's =SUM(A1;A2;A3), not =SUM(A1,A2,A3). Google Sheets does this in European locales, so it's not unheard of.

You've got two tools at your disposal: str_replace for surgical edits when you know exactly what to change, and replace_all for when you need to rebuild the whole thing.

Time to see what they need.`;

  // Initialize Anthropic client
  const anthropic = new Anthropic({ apiKey });

  // Tools definition
  const tools: Anthropic.Tool[] = [
    {
      name: "str_replace",
      description: "Replace a substring in the current spreadsheet. Use for targeted edits. Returns error if substring appears multiple times.",
      input_schema: {
        type: "object",
        properties: {
          old_str: {
            type: "string",
            description: "Exact string to find (must appear exactly once)",
          },
          new_str: {
            type: "string",
            description: "Replacement string",
          },
        },
        required: ["old_str", "new_str"],
      },
    },
    {
      name: "replace_all",
      description: "Replace entire spreadsheet with new markdown table. Use for sorting, major restructuring, or when many changes needed.",
      input_schema: {
        type: "object",
        properties: {
          new_table: {
            type: "string",
            description: "Complete new markdown table with row numbers and column labels",
          },
        },
        required: ["new_table"],
      },
    },
  ];

  // Conversation history
  const messages: Anthropic.MessageParam[] = [];

  // Signal handler for Ctrl+C
  let shouldExit = false;
  const sigintHandler = () => {
    if (!shouldExit) {
      shouldExit = true;
      console.log("\n");
      // Force exit from stdin read
      Deno.stdin.close();
    }
  };
  Deno.addSignalListener("SIGINT", sigintHandler);

  // Interactive loop
  while (!shouldExit) {
    // Prompt for input
    let prompt: string;
    try {
      prompt = await Input.prompt({
        message: "",
        prefix: colors.blue("user"),
        indent: "",
      });
    } catch {
      // stdin closed (Ctrl+C)
      break;
    }

    if (!prompt || prompt.trim() === "" || shouldExit) {
      break;
    }

    // Add user message
    messages.push({
      role: "user",
      content: `Current spreadsheet:\n\n${tableToMarkdown(currentTable)}\n\n${prompt}`,
    });

    // Save state file in debug mode
    if (DEBUG) {
      const stateFilePath = `${filePath}.state`;
      const stateContent = tableToMarkdown(currentTable);
      try {
        await Deno.writeTextFile(stateFilePath, stateContent);
        debug("Saved state file", { path: stateFilePath });
      } catch (err) {
        debug("Failed to save state file", { error: err.message });
      }
    }

    // Call Claude with streaming
    let responseContent: Anthropic.ContentBlock[] = [];
    try {
      debug("Calling Claude API (streaming)", { model, messageCount: messages.length });

      const stream = await anthropic.messages.stream({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        tools,
        messages,
        thinking: {
          type: "enabled",
          budget_tokens: 4096,
        },
      });

      // Stream text blocks to stdout with prefix
      let isFirstChunk = true;
      let isFirstThinkingChunk = true;
      let response: Anthropic.Message | null = null;

      // Process streaming events
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            // Output tool call indicator
            const toolName = event.content_block.name;
            Deno.stdout.writeSync(new TextEncoder().encode(colors.yellow(` [${toolName}] `)));
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'thinking_delta') {
            if (isFirstThinkingChunk) {
              Deno.stdout.writeSync(new TextEncoder().encode(colors.dim(colors.white('\n[thinking]\n'))));
              isFirstThinkingChunk = false;
            }
            Deno.stdout.writeSync(new TextEncoder().encode(colors.dim(colors.white(event.delta.thinking))));
          } else if (event.delta.type === 'text_delta') {
            if (isFirstChunk) {
              // Output newline after thinking ends
              if (!isFirstThinkingChunk) {
                Deno.stdout.writeSync(new TextEncoder().encode('\n'));
              }
              Deno.stdout.writeSync(new TextEncoder().encode(colors.cyan('tsvd › ')));
              isFirstChunk = false;
            }
            Deno.stdout.writeSync(new TextEncoder().encode(event.delta.text));
          }
        } else if (event.type === 'message_stop') {
          response = await stream.finalMessage();
        }
      }

      console.log(); // Add newline after streaming output

      if (!response) {
        response = await stream.finalMessage();
      }

      responseContent = response.content;

      debug("Claude API response received", {
        stopReason: response.stop_reason,
        contentBlocks: responseContent.length
      });
    } catch (err) {
      console.error(`\nAPI Error: ${err.message}\n`);
      messages.pop(); // Remove the failed message
      continue;
    }

    // Process tool calls and apply changes sequentially to a working copy
    type ToolResult = {
      toolUseId: string;
      success: boolean;
      error?: string;
    };

    const toolResults: ToolResult[] = [];
    let workingTable = structuredClone(currentTable);
    let hasSuccessfulChanges = false;
    const errors: string[] = [];

    for (const block of responseContent) {
      if (block.type === "tool_use") {
        const toolName = block.name;
        const toolInput = block.input as Record<string, string>;

        debug(`Processing tool: ${toolName}`, toolInput);

        let result: { success: boolean; error?: string; proposedTable?: Table } = { success: false };

        if (toolName === "str_replace") {
          const oldStr = toolInput.old_str;
          const newStr = toolInput.new_str;
          const currentMarkdown = tableToMarkdown(workingTable);

          // Count occurrences
          const occurrences = (currentMarkdown.match(new RegExp(escapeRegex(oldStr), "g")) || []).length;

          if (occurrences === 0) {
            result = { success: false, error: "String not found in spreadsheet" };
          } else if (occurrences > 1) {
            result = { success: false, error: `String appears ${occurrences} times. Please be more specific or use replace_all.` };
          } else {
            const newMarkdown = currentMarkdown.replace(oldStr, newStr);
            try {
              result = { success: true, proposedTable: markdownToTable(newMarkdown) };
            } catch (err) {
              result = { success: false, error: `Failed to parse result: ${err.message}` };
            }
          }
        } else if (toolName === "replace_all") {
          const newMarkdown = toolInput.new_table;
          try {
            const newTable = markdownToTable(newMarkdown);
            // Validate dimensions
            if (newTable.length > MAX_ROWS) {
              result = { success: false, error: `Result has ${newTable.length} rows, exceeds maximum of ${MAX_ROWS}` };
            } else {
              const newNumCols = Math.max(...newTable.map(row => row.length), 0);
              if (newNumCols > MAX_COLUMNS) {
                result = { success: false, error: `Result has ${newNumCols} columns, exceeds maximum of ${MAX_COLUMNS}` };
              } else {
                result = { success: true, proposedTable: newTable };
              }
            }
          } catch (err) {
            result = { success: false, error: `Failed to parse markdown table: ${err.message}` };
          }
        }

        // Apply successful changes to working copy
        if (result.success && result.proposedTable) {
          workingTable = result.proposedTable;
          hasSuccessfulChanges = true;

          toolResults.push({
            toolUseId: block.id,
            success: true,
          });
        } else {
          errors.push(result.error!);
          toolResults.push({
            toolUseId: block.id,
            success: false,
            error: result.error,
          });
        }
      }
    }

    // Show any errors that occurred
    if (errors.length > 0) {
      console.log(colors.red("\nErrors occurred:"));
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

      console.log(colors.bold(colors.cyan("\n╭─ Proposed changes ─────────────────────────────────────────")));
      console.log(diff);
      console.log();

      // Prompt user to apply changes
      let shouldApply: boolean;
      try {
        shouldApply = await Confirm.prompt({
          message: "Apply changes to file?",
          default: true,
        });
      } catch {
        // User interrupted (Ctrl+C), don't apply
        console.log("\nChanges not applied.\n");
        shouldApply = false;
      }

      if (shouldApply) {
        currentTable = workingTable;
        try {
          await Deno.writeTextFile(filePath, newTSV);
          console.log("Changes applied.\n");
          changesApplied = true;
        } catch (err) {
          console.error(`\nError writing file: ${err.message}\n`);
        }
      } else {
        console.log("Changes not applied.\n");
      }
    }

    // Add assistant response and tool results to conversation history
    const conversationToolResults: Anthropic.MessageParam[] = toolResults.map(result => ({
      role: "user" as const,
      content: [{
        type: "tool_result" as const,
        tool_use_id: result.toolUseId,
        content: result.success
          ? (changesApplied ? "Success. Changes applied and saved." : "Success. Changes computed but not applied by user.")
          : `Error: ${result.error}`,
        is_error: result.success ? undefined : true,
      }],
    }));

    messages.push({ role: "assistant", content: responseContent });
    messages.push(...conversationToolResults);
  }

  // Cleanup signal handler
  Deno.removeSignalListener("SIGINT", sigintHandler);

  console.log("Goodbye!\n");
}

// Helper to escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Run main
if (import.meta.main) {
  main().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    Deno.exit(1);
  });
}
