import { Table, parseTSV } from "./spreadsheet.ts";
import { Confirm } from "@cliffy/prompt";
import { colors } from "@cliffy/ansi/colors";

function generateTempFileName(): string {
	// Follow nano-style naming: .filename.swp pattern
	const timestamp = Date.now();
	return `.tsvd-${timestamp}.tsv`;
}

/**
 * Load the initial table from stdin (pipe), a file, or by opening an editor.
 * Returns the parsed table, the file path, and flags indicating the source.
 */
export async function loadInitialTable(
	filePath: string | null,
	readFromStdin: boolean,
): Promise<{
	table: Table;
	filePath: string;
	originalFilePath: string | null;
}> {
	let content: string;
	let originalFilePath: string | null = null;
	let workingFilePath: string;

	if (readFromStdin) {
		// Read from stdin (piped input) and save to temp file in CWD
		try {
			const chunks: Uint8Array[] = [];
			const reader = Deno.stdin.readable.getReader();
			try {
				while (true) {
					const { done, value: chunk } = await reader.read();
					if (done) break;
					chunks.push(chunk);
				}
			} finally {
				reader.releaseLock();
			}
			const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
			const combined = new Uint8Array(totalLength);
			let offset = 0;
			for (const chunk of chunks) {
				combined.set(chunk, offset);
				offset += chunk.length;
			}
			const decoder = new TextDecoder();
			content = decoder.decode(combined);

			if (!content.trim()) {
				console.error("Error: No data provided from stdin");
				Deno.exit(1);
			}

			// Save to temp file in CWD
			workingFilePath = generateTempFileName();
			await Deno.writeTextFile(workingFilePath, content);
			console.log(colors.dim(colors.italic(`→ Created temporary file: ${workingFilePath}`)));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Error reading from stdin: ${message}`);
			Deno.exit(1);
		}
	} else if (filePath) {
		// Read from file and create temp file copy
		originalFilePath = filePath;
		try {
			content = await Deno.readTextFile(originalFilePath);
			
			// Create temp file and write content to it
			workingFilePath = generateTempFileName();
			await Deno.writeTextFile(workingFilePath, content);
			console.log(colors.dim(colors.italic(`→ Created temporary working file: ${workingFilePath}`)));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Error reading file: ${message}`);
			Deno.exit(1);
		}
	} else {
		// No file provided - ask if user wants to open editor
		let openEditor = true;
		try {
			openEditor = await Confirm.prompt({
				message: "Open editor to create new spreadsheet?",
				default: true,
			});
		} catch {
			console.log(colors.dim(colors.italic("→ Cancelled")));
			Deno.exit(0);
		}

		if (!openEditor) {
			console.log(colors.dim(colors.italic("→ Cancelled")));
			Deno.exit(0);
		}

		// Create temp file in CWD and open editor
		workingFilePath = generateTempFileName();
		const success = await openEditorForFile(workingFilePath, "");

		if (!success) {
			console.error("Editor failed");
			Deno.exit(1);
		}

		// Read the content from the temp file
		try {
			content = await Deno.readTextFile(workingFilePath);
			if (!content.trim()) {
				console.error("No data provided");
				await Deno.remove(workingFilePath);
				Deno.exit(1);
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`Error reading file: ${message}`);
			Deno.exit(1);
		}
	}

	// Parse the TSV content
	let table: Table;
	try {
		table = parseTSV(content);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Error parsing TSV: ${message}`);
		Deno.exit(1);
	}

	return {
		table,
		filePath: workingFilePath,
		originalFilePath,
	};
}

async function openEditorForFile(
	filePath: string,
	initialContent: string,
): Promise<boolean> {
	// Get editor from environment, or try common editors
	let editor = Deno.env.get("EDITOR") || Deno.env.get("VISUAL");

	if (!editor) {
		// Try to find an available editor
		const commonEditors = ["nano", "vi", "vim", "emacs", "code"];
		for (const candidate of commonEditors) {
			try {
				const command = new Deno.Command("which", {
					args: [candidate],
					stdout: "null",
					stderr: "null",
				});
				const { success } = await command.output();
				if (success) {
					editor = candidate;
					break;
				}
			} catch {
				continue;
			}
		}

		if (!editor) {
			console.error(
				"No editor found. Please set $EDITOR environment variable.",
			);
			return false;
		}
	}

	try {
		// Write initial content to file
		await Deno.writeTextFile(filePath, initialContent);

		// Open editor
		const command = new Deno.Command(editor, {
			args: [filePath],
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});

		const { success } = await command.output();

		return success;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Error opening editor: ${message}`);
		return false;
	}
}
