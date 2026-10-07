import { Badge, Box, Button, Code, Group, JsonInput, Paper, ScrollArea, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useCallback, useState } from 'react';
import { CapabilitySnapshot, CUSTOM_COMMANDS, CommandSpec, describeCommandError, invokePlugin, listCapabilities, normalizeIpcError } from '../tauri/ipc';

type Outcome =
	| { phase: 'idle' }
	| { phase: 'pending' }
	| { phase: 'ok', value: unknown }
	| { phase: 'error', error: ReturnType<typeof normalizeIpcError> };

function typeLabel(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return `array(${value.length})`;
	return typeof value;
}

function OutcomeView({ outcome }: { outcome: Outcome }) {
	if (outcome.phase === 'idle') return <Text size='sm' c='dimmed'>Not called yet.</Text>;
	if (outcome.phase === 'pending') return <Text size='sm' c='dimmed'>Awaiting Rust…</Text>;
	if (outcome.phase === 'ok') {
		return <Stack gap={4}>
			<Group gap='xs'><Badge color='teal' size='xs' variant='light'>OK</Badge><Text size='xs' c='dimmed'>return type: {typeLabel(outcome.value)}</Text></Group>
			<JsonInput autosize minRows={2} readOnly value={JSON.stringify(outcome.value, null, 2)} styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} />
		</Stack>;
	}
	const { error } = outcome;
	const hint = describeCommandError(error.code);
	const color = error.kind === 'denied' ? 'orange' : 'red';
	return <Stack gap={4}>
		<Group gap='xs'>
			<Badge color={color} size='xs' variant='light'>ERROR</Badge>
			{error.code ? <Code data-testid='error-code'>{error.code}</Code> : <Badge size='xs' variant='outline' color='gray'>plain string (no code)</Badge>}
		</Group>
		<Text size='sm' c={color} data-testid='error-message'>{error.message}</Text>
		{hint && <Text size='xs' c='dimmed'>{hint}</Text>}
	</Stack>;
}

function CommandCard({ spec }: { spec: CommandSpec }) {
	const [args, setArgs] = useState<Record<string, string>>(spec.args);
	const [outcome, setOutcome] = useState<Outcome>({ phase: 'idle' });

	const run = useCallback(async () => {
		setOutcome({ phase: 'pending' });
		try {
			const value = await invoke(spec.name, args);
			setOutcome({ phase: 'ok', value });
		} catch (error) {
			setOutcome({ phase: 'error', error: normalizeIpcError(error) });
		}
	}, [args]);

	return <Paper withBorder p='md' radius='md' data-testid={`command-${spec.name}`}>
		<Stack gap='sm'>
			<Group justify='space-between' align='flex-start'>
				<Box>
					<Group gap='xs'>
						<Code fz='sm' data-testid='command-name'>{spec.name}</Code>
						<Badge size='xs' variant='outline' color={spec.errorStyle === 'structured' ? 'teal' : spec.errorStyle === 'legacy' ? 'gray' : 'blue'}>
							{spec.errorStyle === 'structured' ? 'Result<T, CommandError>' : spec.errorStyle === 'legacy' ? 'Result<T, String>' : 'no Result'}
						</Badge>
					</Group>
					<Text size='xs' c='dimmed' mt={4}>registered in src-tauri/src/lib.rs → {spec.rustFile}</Text>
					{spec.callSites.length > 0 && <Text size='xs' c='dimmed'>src call sites: {spec.callSites.join(', ')}</Text>}
				</Box>
				<Button size='xs' onClick={run} loading={outcome.phase === 'pending'} data-testid={`run-${spec.name}`}>Invoke</Button>
			</Group>
			{Object.keys(args).length > 0 && <SimpleGrid cols={2}>
				{Object.keys(args).map(key =>
					<TextInput
						key={key}
						size='xs'
						label={<Code fz='xs'>{key}</Code>}
						value={args[key]}
						onChange={e => setArgs(prev => ({ ...prev, [key]: e.currentTarget.value }))}
						data-testid={`arg-${key}`}
					/>)}
			</SimpleGrid>}
			<OutcomeView outcome={outcome} />
		</Stack>
	</Paper>;
}

function CapabilitiesPanel() {
	const [caps, setCaps] = useState<CapabilitySnapshot[] | null>(null);
	const [error, setError] = useState<string>('');

	const refresh = useCallback(async () => {
		setError('');
		try {
			setCaps(await listCapabilities());
		} catch (e) {
			setError(normalizeIpcError(e).message);
		}
	}, []);

	if (!isTauri()) {
		return <AlertBox color='blue' title='IPC bridge unavailable'>Run <Code>pnpm tauri dev</Code> and open this view in the desktop window; a plain browser cannot reach Rust.</AlertBox>;
	}
	return <Stack gap='sm'>
		<Group justify='space-between'>
			<Text size='sm'>Entries below are read live from the binary (<Code>include_str!</Code> of <Code>src-tauri/capabilities/*.json</Code>) via <Code>list_capabilities</Code> — they are the permissions actually in effect for this build, not a guess.</Text>
			<Button size='xs' variant='light' onClick={refresh} data-testid='refresh-capabilities'>Read effective capabilities</Button>
		</Group>
		{error && <AlertBox color='red' title='Could not read capabilities'>{error}</AlertBox>}
		{caps?.map(cap =>
			<Paper key={cap.identifier} withBorder p='sm' radius='md' data-testid={`capability-${cap.identifier}`}>
				<Group gap='xs'><Code>{cap.file}</Code><Badge size='xs' variant='light'>{cap.identifier}</Badge><Badge size='xs' color='blue' variant='outline'>windows: {cap.windows.join(', ')}</Badge></Group>
				{cap.description && <Text size='xs' c='dimmed' mt={4}>{cap.description}</Text>}
				<ScrollArea.Autosize mah={160} mt='xs'>
					<Table fz='xs' withRowBorders={false}>
						<Table.Tbody>
							{cap.permissions.map((p, i) => {
								const id = typeof p === 'string' ? p : p.identifier;
								const scope = typeof p === 'object' ? (p.allow ?? []) : [];
								return <Table.Tr key={`${id}-${i}`}>
									<Table.Td><Code fz='xs'>{id}</Code></Table.Td>
									<Table.Td>{scope.length > 0 && <Text size='xs' c='dimmed'>scope: {scope.join(', ')}</Text>}</Table.Td>
								</Table.Tr>;
							})}
						</Table.Tbody>
					</Table>
				</ScrollArea.Autosize>
			</Paper>)}
		<Text size='xs' c='dimmed'>Custom app commands (<Code>process_file</Code>, …) are not plugin ACL commands: they appear in <Code>generate_handler!</Code> only, so adding one never touches these window-level files. Plugin commands (<Code>plugin:fs|write_text_file</Code>, …) are the ones gated here.</Text>
	</Stack>;
}

function PermissionProbe() {
	const [outcome, setOutcome] = useState<Outcome>({ phase: 'idle' });

	async function probe(granted: boolean) {
		setOutcome({ phase: 'pending' });
		try {
			if (granted) {
				// os:default is granted in plugins.json -> succeeds
				await invokePlugin<string>('os', 'platform');
			} else {
				// dialog is registered in Rust but intentionally absent from capabilities -> ACL denies
				await invokePlugin('dialog', 'message', { title: 'probe', message: 'hello' });
			}
			setOutcome({ phase: 'ok', value: granted ? 'plugin:os|platform returned' : 'dialog call returned (unexpectedly allowed)' });
		} catch (error) {
			setOutcome({ phase: 'error', error: normalizeIpcError(error) });
		}
	}

	return <Paper withBorder p='md' radius='md' data-testid='permission-probe'>
		<Stack gap='sm'>
			<Group gap='xs'>
				<Button size='xs' color='teal' variant='light' onClick={() => probe(true)} data-testid='probe-granted'>Call granted plugin:os|platform</Button>
				<Tooltip label='dialog is registered in lib.rs but missing from capabilities on purpose'>
					<Button size='xs' color='orange' variant='light' onClick={() => probe(false)} data-testid='probe-denied'>Call ungranted plugin:dialog|message</Button>
				</Tooltip>
			</Group>
			<OutcomeView outcome={outcome} />
		</Stack>
	</Paper>;
}

function AlertBox({ color, title, children }: { color: string, title: string, children: React.ReactNode }) {
	return <Paper withBorder p='sm' radius='md' data-testid='ipc-alert'>
		<Text fw={600} size='sm' c={color}>{title}</Text>
		<Text size='sm'>{children}</Text>
	</Paper>;
}

const STRING_COST = [
	'Rust: Err("...".into()) — zero extra types.',
	'Wire: a bare JSON string.',
	'Frontend: message text is the only signal, so branching means string matching (fragile, breaks on reword/translate).'
];

const STRUCTURED_COST = [
	'Rust: one CommandError { code, message } + Serialize + Display, then Err(CommandError::new("CODE", ...)) per branch.',
	'Wire: an object { code, message }.',
	'Frontend: switch on error.code for stable hints; message stays display-only.'
];

const PERMISSION_MODELS = [
	{ model: 'One permission set per window (current)', detail: 'Each capability file lists windows: ["main"] and groups the identifiers that window needs. Adding a custom app command changes nothing here; plugin commands get one line in the matching file (main.json / fs.json / plugins.json).' },
	{ model: 'One capability per command', detail: 'A separate JSON file per permission identifier, all targeting the same window. Explodes into dozens of files for this app (core:default alone bundles path/event/webview/…), and every window must opt into each file. Tauri scopes commands per-plugin; capabilities are the grouping unit, not per-command ACLs.' }
];

export default function IpcInspector() {
	return <Stack gap='lg' data-testid='ipc-inspector'>
		<Title order={3}>IPC Chain Inspector</Title>
		<Text size='sm' c='dimmed'>Every call starts at <Code>invoke()</Code> in <Code>src</Code>, is registered in <Code>src-tauri/src/lib.rs</Code>'s <Code>generate_handler!</Code>, and — for plugin commands — gated by <Code>src-tauri/capabilities/*.json</Code>. Buttons below make real IPC calls against this build.</Text>
		<Tabs defaultValue='commands' data-testid='ipc-tabs'>
			<Tabs.List>
				<Tabs.Tab value='commands' data-testid='tab-commands'>Commands</Tabs.Tab>
				<Tabs.Tab value='capabilities' data-testid='tab-capabilities'>Capabilities</Tabs.Tab>
				<Tabs.Tab value='errors' data-testid='tab-errors'>Error &amp; Permission Cost</Tabs.Tab>
			</Tabs.List>

			<Tabs.Panel value='commands' pt='md'>
				<Stack gap='sm'>
					{CUSTOM_COMMANDS.map(spec => <CommandCard key={spec.name} spec={spec} />)}
					<Text size='xs' c='dimmed'>Error branch triggers: blank <Code>filepath</Code> → EMPTY_FILEPATH; a path containing <Code>forbidden</Code> → FORBIDDEN_PATH. The legacy command returns the blank case as a plain string with no code.</Text>
				</Stack>
			</Tabs.Panel>

			<Tabs.Panel value='capabilities' pt='md'>
				<Stack gap='md'>
					<CapabilitiesPanel />
					<PermissionProbe />
				</Stack>
			</Tabs.Panel>

			<Tabs.Panel value='errors' pt='md'>
				<SimpleGrid cols={{ base: 1, md: 2 }}>
					<Paper withBorder p='md' radius='md' data-testid='cost-string'>
						<Title order={5} mb='xs'>String errors — Result&lt;_, String&gt;</Title>
						{STRING_COST.map(line => <Text key={line} size='sm' component='li'>{line}</Text>)}
					</Paper>
					<Paper withBorder p='md' radius='md' data-testid='cost-structured'>
						<Title order={5} mb='xs'>Structured errors — Result&lt;_, CommandError&gt;</Title>
						{STRUCTURED_COST.map(line => <Text key={line} size='sm' component='li'>{line}</Text>)}
					</Paper>
				</SimpleGrid>
				<Paper withBorder p='md' radius='md' mt='sm' data-testid='permission-models'>
					<Title order={5} mb='xs'>Capability granularity</Title>
					<Table fz='sm'>
						<Table.Thead><Table.Tr><Table.Th>Model</Table.Th><Table.Th>Trade-off in this app</Table.Th></Table.Tr></Table.Thead>
						<Table.Tbody>
							{PERMISSION_MODELS.map(row =>
								<Table.Tr key={row.model}><Table.Td><Text fw={600} size='sm'>{row.model}</Text></Table.Td><Table.Td><Text size='xs'>{row.detail}</Text></Table.Td></Table.Tr>)}
						</Table.Tbody>
					</Table>
				</Paper>
			</Tabs.Panel>
		</Tabs>
	</Stack>;
}
