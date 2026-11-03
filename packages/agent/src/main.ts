// ABOUTME: lace-agent entry. With no arguments it starts the JSON-RPC server (server-main);
// ABOUTME: `lace-agent reminders ...` runs a one-shot host CLI instead.
// The server starts as import-time side effects of server-main (log streams, turn beacon,
// stdin pipe), so the dispatch must choose before that module is ever imported.

export {};

if (process.argv[2] === 'reminders') {
  const { runRemindersCli } = await import('./reminders/ensure-cli');
  const code = await runRemindersCli(process.argv.slice(3), {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
  process.exit(code);
} else {
  await import('./server-main');
}
