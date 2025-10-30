import { z } from "npm:zod@3.25.76";
import { tool } from "npm:ai@5.0.82";
import {
	columnLabelToIndex,
	markdownToTable,
	tableToMarkdown,
	Table,
} from "./spreadsheet.ts";

// Helper function to parse cell coordinate like "A1" into column index and row number
function parseCellCoordinate(cell: string): {
	colIndex: number;
	rowIndex: number;
} {
	const match = cell.match(/^([A-Z]+)(\d+)$/);
	if (!match) {
		throw new Error(`Invalid cell coordinate: ${cell}`);
	}
	const [, colLabel, rowStr] = match;
	const colIndex = columnLabelToIndex(colLabel);
	const rowIndex = parseInt(rowStr, 10) - 1; // Convert to 0-based
	if (rowIndex < 0) {
		throw new Error(`Invalid row number in cell coordinate: ${cell}`);
	}
	return { colIndex, rowIndex };
}

// Tool result type
export type ToolResult = {
	success: boolean;
	error?: string;
	proposedTable?: Table;
};

// Vercel AI SDK tool definitions using Zod and tool() helper
export const toolsVercelAI = {
	str_replace: tool({
		description:
			"Replace a substring in the current spreadsheet. Use for targeted edits. Replaces all occurrences of the string.",
		inputSchema: z.object({
			old_str: z
				.string()
				.describe("Exact string to find and replace (all occurrences)"),
			new_str: z.string().describe("Replacement string"),
		}),
	}),
	replace_all: tool({
		description:
			"Replace entire spreadsheet with new markdown table. Use for sorting, major restructuring, or when many changes needed.",
		inputSchema: z.object({
			new_table: z
				.string()
				.describe(
					"Complete new markdown table with row numbers and column labels",
				),
		}),
	}),
	edit_cells: tool({
		description:
			"Edit specific cells by row and column coordinates. Efficient for multiple targeted changes without replacing entire table.",
		inputSchema: z.object({
			edits: z
				.array(
					z.object({
						cell: z
							.string()
							.describe(
								"Cell coordinate (e.g., A1, B2) as shown in markdown table labels",
							),
						value: z.string().describe("New cell contents"),
					}),
				)
				.describe("Array of cell edits to apply"),
		}),
	}),
	replace_area: tool({
		description:
			"Replace a rectangular region of the table. More efficient than edit_cells for updating 3+ adjacent cells. Provide data as a 2D array.",
		inputSchema: z.object({
			from_cell: z.string().describe("Top-left cell coordinate (e.g., A1)"),
			to_cell: z
				.string()
				.describe("Bottom-right cell coordinate (e.g., C5, inclusive)"),
			values: z
				.array(z.array(z.string()))
				.describe(
					'2D array of new values, row by row. Example: [["A1val", "B1val"], ["A2val", "B2val"]]',
				),
		}),
	}),
};

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Tool implementation: str_replace
export function toolStrReplace(
	workingTable: Table,
	toolInput: { old_str: string; new_str: string },
): ToolResult {
	const oldStr = toolInput.old_str;
	const newStr = toolInput.new_str;
	const currentMarkdown = tableToMarkdown(workingTable);

	// Count occurrences
	const occurrences = (
		currentMarkdown.match(new RegExp(escapeRegex(oldStr), "g")) || []
	).length;

	if (occurrences === 0) {
		return {
			success: false,
			error: "String not found in spreadsheet",
		};
	} else {
		// Replace all occurrences using replaceAll
		const newMarkdown = currentMarkdown.replaceAll(oldStr, newStr);
		try {
			return {
				success: true,
				proposedTable: markdownToTable(newMarkdown),
			};
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				success: false,
				error: `Failed to parse result: ${message}`,
			};
		}
	}
}

// Tool implementation: replace_all
export function toolReplaceAll(
	_workingTable: Table,
	toolInput: { new_table: string },
): ToolResult {
	const newMarkdown = toolInput.new_table;
	try {
		const newTable = markdownToTable(newMarkdown);
		return { success: true, proposedTable: newTable };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			success: false,
			error: `Failed to parse markdown table: ${message}`,
		};
	}
}

// Tool implementation: batch_edit_cells
export function toolEditCells(
	workingTable: Table,
	toolInput: { edits: Array<{ cell: string; value: string }> },
): ToolResult {
	const edits = toolInput.edits;

	// Validate and apply edits to a copy of workingTable
	const newTable = structuredClone(workingTable);
	const errors: string[] = [];

	for (const edit of edits) {
		const { cell, value } = edit;
		let rowIndex: number;
		let colIndex: number;

		try {
			const parsed = parseCellCoordinate(cell.toUpperCase());
			rowIndex = parsed.rowIndex;
			colIndex = parsed.colIndex;
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`Invalid cell coordinate "${cell}": ${message}`);
			continue;
		}

		// Extend table if necessary to accommodate row
		while (newTable.length <= rowIndex) {
			newTable.push([]);
		}

		// Extend row if necessary to accommodate column
		while (newTable[rowIndex].length <= colIndex) {
			newTable[rowIndex].push("");
		}

		// Apply the edit
		newTable[rowIndex][colIndex] = value;
	}

	if (errors.length > 0) {
		return {
			success: false,
			error: errors.join("; "),
		};
	} else {
		return {
			success: true,
			proposedTable: newTable,
		};
	}
}

// Tool implementation: replace_area
export function toolReplaceArea(
	workingTable: Table,
	toolInput: { from_cell: string; to_cell: string; values: string[][] },
): ToolResult {
	const fromCell = toolInput.from_cell;
	const toCell = toolInput.to_cell;
	const values = toolInput.values;

	// Parse cell coordinates
	let fromColIndex: number;
	let fromRowIndex: number;
	let toColIndex: number;
	let toRowIndex: number;

	try {
		const from = parseCellCoordinate(fromCell.toUpperCase());
		fromColIndex = from.colIndex;
		fromRowIndex = from.rowIndex;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			success: false,
			error: `Invalid from_cell: ${message}`,
		};
	}

	try {
		const to = parseCellCoordinate(toCell.toUpperCase());
		toColIndex = to.colIndex;
		toRowIndex = to.rowIndex;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			success: false,
			error: `Invalid to_cell: ${message}`,
		};
	}

	if (fromRowIndex > toRowIndex) {
		return {
			success: false,
			error: "from_cell row must be less than or equal to to_cell row",
		};
	}

	if (fromColIndex > toColIndex) {
		return {
			success: false,
			error: "from_cell column must be less than or equal to to_cell column",
		};
	}

	// Validate array structure
	if (!Array.isArray(values)) {
		return {
			success: false,
			error: "values must be a 2D array",
		};
	}

	// Validate and pad dimensions of new content
	const expectedRows = toRowIndex - fromRowIndex + 1;
	const expectedCols = toColIndex - fromColIndex + 1;

	// Clone the values array to avoid mutating the input
	const newAreaData: Table = values.map((row) =>
		Array.isArray(row) ? [...row] : [],
	);

	// Allow content to be smaller than the specified range - pad with empty strings
	if (newAreaData.length > expectedRows) {
		return {
			success: false,
			error: `values has ${newAreaData.length} rows, but expected at most ${expectedRows} (from ${fromCell} to ${toCell})`,
		};
	}

	// Pad missing rows with empty rows
	while (newAreaData.length < expectedRows) {
		newAreaData.push([]);
	}

	// Pad each row to have the expected number of columns
	for (let i = 0; i < newAreaData.length; i++) {
		if (newAreaData[i].length > expectedCols) {
			return {
				success: false,
				error: `Row ${i + 1} in values has ${newAreaData[i].length} columns, but expected at most ${expectedCols} (from ${fromCell} to ${toCell})`,
			};
		}
		// Pad missing columns with empty strings
		while (newAreaData[i].length < expectedCols) {
			newAreaData[i].push("");
		}
	}

	// Create a copy of the working table
	const newTable = structuredClone(workingTable);

	// Extend table if necessary to accommodate the replacement area
	while (newTable.length <= toRowIndex) {
		newTable.push([]);
	}

	// Replace the area
	for (let rowOffset = 0; rowOffset < expectedRows; rowOffset++) {
		const targetRowIndex = fromRowIndex + rowOffset;

		// Extend row if necessary
		while (newTable[targetRowIndex].length <= toColIndex) {
			newTable[targetRowIndex].push("");
		}

		// Replace cells in this row
		for (let colOffset = 0; colOffset < expectedCols; colOffset++) {
			const targetColIndex = fromColIndex + colOffset;
			newTable[targetRowIndex][targetColIndex] =
				newAreaData[rowOffset][colOffset];
		}
	}

	return {
		success: true,
		proposedTable: newTable,
	};
}
