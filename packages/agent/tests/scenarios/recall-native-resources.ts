// ABOUTME: Resource samples for the isolated native recall scenario.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeAgentEntrypoint = fileURLToPath(new URL('../../dist/main.js', import.meta.url));

function missing<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ESRCH') return undefined;
    throw error;
  }
}

const read = (path: string) => missing(() => readFileSync(path, 'utf8').trim());
const fields = (text: string | undefined) =>
  Object.fromEntries(
    (text ?? '')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [key, value] = line.split(/\s+/, 2);
        return [key.replace(/:$/, ''), Number(value)];
      })
  );

function currentCgroupDirectory() {
  if (process.platform !== 'linux') return undefined;
  const path = read('/proc/self/cgroup')
    ?.split('\n')
    .find((line) => line.startsWith('0::'))
    ?.slice(3);
  return path ? join('/sys/fs/cgroup', path) : undefined;
}

function measuredCounter(value: number, name: string): number {
  assert(Number.isSafeInteger(value) && value >= 0, `Missing or invalid cgroup ${name}`);
  return value;
}

export function recallCgroup(directory = currentCgroupDirectory()) {
  if (!directory) return undefined;
  const file = (name: string) => read(join(directory, name));
  const memoryMax = file('memory.max');
  if (!memoryMax) return undefined;
  const limits = { memoryMax, swapMax: file('memory.swap.max'), cpuMax: file('cpu.max') };
  return {
    limits,
    pids: () => (file('cgroup.procs') ?? '').split(/\s+/).filter(Boolean).map(Number),
    usage: () => {
      const { anon, file: cache, shmem } = fields(file('memory.stat'));
      const memoryEvents = fields(file('memory.events'));
      const cpuStat = fields(file('cpu.stat'));
      for (const counter of ['oom', 'oom_kill']) measuredCounter(memoryEvents[counter], counter);
      if ('oom_group_kill' in memoryEvents)
        measuredCounter(memoryEvents.oom_group_kill, 'oom_group_kill');
      for (const counter of ['usage_usec', 'nr_throttled', 'throttled_usec'])
        measuredCounter(cpuStat[counter], counter);
      return {
        memoryCurrent: measuredCounter(Number(file('memory.current') || NaN), 'memory.current'),
        memoryPeak: measuredCounter(Number(file('memory.peak') || NaN), 'memory.peak'),
        anon: measuredCounter(anon, 'memory.stat anon'),
        file: measuredCounter(cache, 'memory.stat file'),
        shmem: measuredCounter(shmem, 'memory.stat shmem'),
        memoryEvents,
        cpuStat,
      };
    },
  };
}

export function isNativeAgentCommand(
  commandLine: string | undefined,
  entrypoint = nativeAgentEntrypoint
) {
  return commandLine?.split('\0').includes(entrypoint) === true;
}

function linuxAgentProcesses(pids: number[], rootPid: number) {
  return pids.flatMap((pid) => {
    const dir = `/proc/${pid}`;
    const status = fields(read(join(dir, 'status')));
    if (pid !== rootPid && status.PPid !== rootPid) return [];
    if (!isNativeAgentCommand(read(join(dir, 'cmdline')))) return [];
    if (!Number.isSafeInteger(status.VmRSS)) return [];
    // SQLite holds the ranking file open after unlinking it.
    const fdDir = join(dir, 'fd');
    let scratchBytes = 0;
    const counted = new Set<number>();
    for (const fd of missing(() => readdirSync(fdDir)) ?? []) {
      const file = join(fdDir, fd);
      if (!missing(() => readlinkSync(file))?.endsWith('/ranking.sqlite (deleted)')) continue;
      const stat = missing(() => statSync(file));
      if (stat && !counted.has(stat.ino)) {
        counted.add(stat.ino);
        scratchBytes += stat.size;
      }
    }
    return [
      { pid, rssKiB: status.VmRSS, hwmKiB: status.VmHWM, anonKiB: status.RssAnon, scratchBytes },
    ];
  });
}

function macAgentProcesses(rootPid: number) {
  const output = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' });
  return output.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+.*\/dist\/main\.js$/.exec(line);
    if (!match || (Number(match[1]) !== rootPid && Number(match[2]) !== rootPid)) return [];
    return [{ pid: Number(match[1]), rssKiB: Number(match[3]) }];
  });
}

export function sampleRecallResources(
  rootPid: number | undefined,
  databasePath: string,
  eventIndexPath: string,
  cgroup: ReturnType<typeof recallCgroup>
) {
  const processes =
    rootPid === undefined
      ? []
      : cgroup
        ? linuxAgentProcesses(cgroup.pids(), rootPid)
        : macAgentProcesses(rootPid);
  return {
    cgroup: cgroup?.usage(),
    processes,
    memoryWalBytes: missing(() => statSync(`${databasePath}-wal`).size) ?? 0,
    eventIndexWalBytes: missing(() => statSync(`${eventIndexPath}-wal`).size) ?? 0,
  };
}
