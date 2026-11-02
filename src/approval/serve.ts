// Clean shutdown for `serve` (Ctrl+C / SIGTERM), in a fixed, tested order.

export interface ShutdownParts {
  stopAccepting: () => void;
  /** Lets an in-flight run finish or time out. */
  stopScheduler: () => Promise<void>;
  stopReminders: () => void;
  /** Close the web server, stop Telegram polling. */
  stopNotifiers: () => Promise<void>;
  releaseLocks: () => void;
  closeDb: () => void;
  log?: (line: string) => void;
}

export const SHUTDOWN_ORDER = ['stop accepting actions', 'finish in-flight run', 'stop reminders', 'stop channels', 'release locks', 'close database'] as const;

export async function shutdown(parts: ShutdownParts): Promise<string[]> {
  const done: string[] = [];
  const step = async (name: (typeof SHUTDOWN_ORDER)[number], fn: () => void | Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      parts.log?.(`Shutdown step "${name}" failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    done.push(name);
  };
  await step('stop accepting actions', parts.stopAccepting);
  await step('finish in-flight run', parts.stopScheduler);
  await step('stop reminders', parts.stopReminders);
  await step('stop channels', parts.stopNotifiers);
  await step('release locks', parts.releaseLocks);
  await step('close database', parts.closeDb);
  return done;
}
