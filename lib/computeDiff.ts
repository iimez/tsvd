import { colors } from "@cliffy/ansi/colors";

// Git-style unified diff between two TSV strings
export function computeDiff(oldTSV: string, newTSV: string): string {
	if (oldTSV === newTSV) {
		return "No changes.";
	}

	const oldLines = oldTSV.split("\n");
	const newLines = newTSV.split("\n");

	// Simple line-by-line LCS-based diff
	interface LineOp {
		type: "equal" | "delete" | "insert";
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
			ops.unshift({
				type: "equal",
				oldLine: i - 1,
				newLine: j - 1,
				content: oldLines[i - 1],
			});
			i--;
			j--;
		} else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
			ops.unshift({ type: "insert", newLine: j - 1, content: newLines[j - 1] });
			j--;
		} else if (i > 0) {
			ops.unshift({ type: "delete", oldLine: i - 1, content: oldLines[i - 1] });
			i--;
		}
	}

	// Group into hunks with context
	const CONTEXT_LINES = 3;
	const hunks: { start: number; end: number }[] = [];

	for (let idx = 0; idx < ops.length; idx++) {
		if (ops[idx].type !== "equal") {
			const hunkStart = Math.max(0, idx - CONTEXT_LINES);
			let hunkEnd = idx;

			// Extend to include nearby changes
			while (hunkEnd < ops.length) {
				let foundChange = false;
				const searchEnd = Math.min(hunkEnd + CONTEXT_LINES * 2 + 1, ops.length);
				for (let k = hunkEnd; k < searchEnd; k++) {
					if (ops[k].type !== "equal") {
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

		output.push(
			colors.cyan(
				`@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@`,
			),
		);

		for (const op of hunkOps) {
			// Make tabs visible by replacing them with a visual marker
			const visibleContent = op.content.replace(/\t/g, colors.dim("→") + "\t");

			if (op.type === "delete") {
				output.push(colors.red(`-${visibleContent}`));
			} else if (op.type === "insert") {
				output.push(colors.green(`+${visibleContent}`));
			} else {
				output.push(` ${visibleContent}`);
			}
		}
	}

	return output.join("\n");
}
