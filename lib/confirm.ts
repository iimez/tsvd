import { colors } from '@cliffy/ansi/colors';
import { readLine } from './readLine.ts';

// Custom confirm that handles Ctrl+C properly
export async function confirm(
	message: string,
	defaultValue: boolean = true,
): Promise<boolean | null> {
	const hint = defaultValue ? "(Y/n)" : "(y/N)";
	const styledPrompt = `${colors.yellow("?")} ${colors.bold(colors.white(message))} ${colors.dim(colors.white(hint))} ${colors.white("›")} `;

	const response = await readLine(styledPrompt);

	if (response === null) return null; // Ctrl+C

	let result: boolean;
	if (response.trim() === "") {
		result = defaultValue;
	} else {
		const lower = response.toLowerCase();
		result = lower === "y" || lower === "yes";
	}

	// Print the result in green, similar to cliffy
	const resultText = result ? "Yes" : "No";
	// Calculate visible length by stripping ANSI codes
	const visibleLength = styledPrompt.replace(/\x1b\[[0-9;]*m/g, "").length;
	// Move cursor up one line, move to after the prompt, print result
	await Deno.stdout.write(
		new TextEncoder().encode(
			`\x1b[A\x1b[${visibleLength}C${colors.green(resultText)}\n`,
		),
	);

	return result;
}
