/**
 * IPC plumbing shared by the whole app.
 *
 * Data flow (one per command):
 *   invoke('name', args)  ── src (this file)
 *     -> generate_handler![...] in src-tauri/src/lib.rs
 *     -> #[tauri::command] fn in src-tauri/src/*.rs
 *     -> ACL check: plugin commands are gated by the permission identifiers
 *        listed in src-tauri/capabilities/*.json; custom app commands are
 *        registered directly and are NOT capability-gated.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';

/** Snapshot of one entry of src-tauri/capabilities/*.json, compiled into the binary. */
export interface CapabilitySnapshot {
	file: string,
	identifier: string,
	description?: string | null,
	windows: string[],
	permissions: (string | { identifier: string, allow?: string[] })[]
}

/** Payload of the structured Rust error (`CommandError` in commands.rs). */
export interface CommandErrorPayload {
	code: string,
	message: string
}

export type IpcErrorKind = 'command' | 'denied' | 'legacy-string' | 'not-running';

export interface NormalizedError {
	kind: IpcErrorKind,
	/** Structured error code (e.g. EMPTY_FILEPATH), undefined for legacy string errors. */
	code?: string,
	message: string
}

/**
 * Tauri rejects a command call with whatever the Rust `Err` serializes to:
 * a plain string for `Result<_, String>`, an object for structured errors,
 * and ACL denials are rejected by the core with a string that mentions the
 * missing permission. Normalize all of those into one typed shape.
 */
export function normalizeIpcError(error: unknown): NormalizedError {
	if (!isTauri()) {
		return { kind: 'not-running', message: 'Tauri core not detected — open this view via `pnpm tauri dev`, a browser has no IPC bridge.' };
	}
	if (typeof error === 'object' && error !== null && 'code' in error) {
		const payload = error as CommandErrorPayload;
		return { kind: 'command', code: payload.code, message: payload.message ?? String(payload) };
	}
	const message = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
	if (/\b(not allowed|permission|denied|ACL)\b/i.test(message)) {
		return { kind: 'denied', code: 'ACL_DENIED', message };
	}
	return { kind: 'legacy-string', message };
}

/** Human-readable hint per structured error code; falls back to the raw message. */
export function describeCommandError(code: string | undefined): string {
	switch (code) {
		case 'EMPTY_FILEPATH': return 'The path argument is blank — fill in a non-empty filepath and retry.';
		case 'FORBIDDEN_PATH': return 'The path trips the deny policy — remove the word "forbidden" from it.';
		case 'CAPABILITY_PARSE': return 'A capability file baked into the binary is malformed.';
		case 'ACL_DENIED': return 'The webview is missing the capability permission for this plugin command. Grant it in src-tauri/capabilities/*.json and rebuild.';
		default: return '';
	}
}

/** A registered custom command the inspector can call. */
export interface CommandSpec {
	name: string,
	args: Record<string, string>,
	/** File of the #[tauri::command] fn, for the chain visualization. */
	rustFile: string,
	/** src call sites (file:line) beyond the inspector itself. */
	callSites: string[],
	/** 'structured' -> Result<_, CommandError>, 'legacy' -> Result<_, String>, 'unit' -> no error payload. */
	errorStyle: 'structured' | 'legacy' | 'unit'
}

/**
 * The four custom commands registered in lib.rs. This is documentation made
 * executable: the inspector renders the chain and actually invokes each one.
 */
export const CUSTOM_COMMANDS: CommandSpec[] = [
	{
		name: 'process_file',
		args: { filepath: 'docs/readme.md' },
		rustFile: 'src-tauri/src/commands.rs',
		callSites: ['src/views/ExampleView.tsx:40'],
		errorStyle: 'structured'
	},
	{
		name: 'legacy_process_file',
		args: { filepath: 'docs/readme.md' },
		rustFile: 'src-tauri/src/commands.rs',
		callSites: [],
		errorStyle: 'legacy'
	},
	{
		name: 'list_capabilities',
		args: {},
		rustFile: 'src-tauri/src/commands.rs',
		callSites: ['src/components/IpcInspector.tsx'],
		errorStyle: 'structured'
	},
	{
		name: 'tray_update_lang',
		args: { lang: 'en' },
		rustFile: 'src-tauri/src/tray_icon.rs',
		callSites: [],
		errorStyle: 'unit'
	}
];

export async function listCapabilities(): Promise<CapabilitySnapshot[]> {
	return invoke<CapabilitySnapshot[]>('list_capabilities');
}

/**
 * Invoke a plugin command. The name is `plugin:<plugin>|<command>`; Tauri's ACL
 * rejects it before Rust runs when the capability is missing, which the panel
 * turns into the readable `ACL_DENIED` branch.
 */
export async function invokePlugin<T>(plugin: string, command: string, args: Record<string, unknown> = {}): Promise<T> {
	return invoke<T>(`plugin:${plugin}|${command}`, args);
}
