// ABOUTME: API route handler for receiving browser console logs
// ABOUTME: Outputs forwarded console messages to server terminal with proper formatting

import { NextRequest, NextResponse } from 'next/server';
import superjson from 'superjson';
import type { ConsoleLogEntry } from '@/lib/console-forward';

/**
 * Type guard to check if data is in SuperJSON format
 */
function isSuperJSONFormat(data: unknown): data is { json: unknown; meta?: unknown } {
  return typeof data === 'object' && data !== null && 'json' in data;
}

/**
 * Type guard to check if data is an array of arguments
 */
function isArgsArray(data: unknown): data is unknown[] {
  return Array.isArray(data);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { logs: ConsoleLogEntry[] };
    const { logs } = body;

    if (!Array.isArray(logs)) {
      return NextResponse.json({ error: 'Invalid logs format' }, { status: 400 });
    }

    // Output each log to server console with formatting
    logs.forEach((entry) => {
      const timestamp = new Date(entry.timestamp).toISOString();
      let url: string;
      try {
        url = new URL(entry.url).pathname;
      } catch {
        // Fallback for invalid URLs
        url = entry.url || '/';
      }

      // Deserialize and format args for display
      let formattedArgs: string;

      try {
        // Check if args has the superjson format {json, meta}
        const argsData = entry.args;
        let deserializedArgs: unknown[];

        if (isSuperJSONFormat(argsData)) {
          // This is superjson format - deserialize it
          deserializedArgs = superjson.deserialize(
            argsData as Parameters<typeof superjson.deserialize>[0]
          );
        } else if (isArgsArray(argsData)) {
          // This is already an array
          deserializedArgs = argsData;
        } else {
          // Unknown format, wrap in array
          deserializedArgs = [argsData];
        }

        if (Array.isArray(deserializedArgs)) {
          formattedArgs = deserializedArgs
            .map((arg) => {
              if (typeof arg === 'object' && arg !== null) {
                return superjson.stringify(arg);
              }
              return String(arg);
            })
            .join(' ');
        } else {
          formattedArgs = superjson.stringify(deserializedArgs);
        }
      } catch (error) {
        // Fallback: handle raw args data
        console.error('[CONSOLE-FORWARD] Deserialization failed:', error);

        if (isArgsArray(entry.args)) {
          // Handle array of args
          formattedArgs = entry.args
            .map((arg) => {
              if (typeof arg === 'string') return arg;
              if (typeof arg === 'object' && arg !== null) {
                // Handle serialization error objects
                if ('__serialization_error' in arg) {
                  const errorInfo = arg as {
                    __serialization_error: boolean;
                    type: string;
                    string_representation: string;
                  };
                  return `[Serialization Error: ${errorInfo.type}] ${errorInfo.string_representation}`;
                }
                return superjson.stringify(arg);
              }
              return String(arg);
            })
            .join(' ');
        } else {
          // Handle single arg or unknown format
          formattedArgs =
            typeof entry.args === 'object' && entry.args !== null
              ? superjson.stringify(entry.args)
              : String(entry.args);
        }
      }

      // Color coding for different log levels
      const prefix = `[${timestamp}] [BROWSER] [${entry.level.toUpperCase()}] ${url}:`;

      switch (entry.level) {
        case 'error':
          console.error(`\x1b[31m${prefix}\x1b[0m`, formattedArgs);
          break;
        case 'warn':
          console.warn(`\x1b[33m${prefix}\x1b[0m`, formattedArgs);
          break;
        case 'info':
          // eslint-disable-next-line no-console
          console.info(`\x1b[36m${prefix}\x1b[0m`, formattedArgs);
          break;
        case 'debug':
          // eslint-disable-next-line no-console
          console.debug(`\x1b[90m${prefix}\x1b[0m`, formattedArgs);
          break;
        default:
          // eslint-disable-next-line no-console
          console.log(`\x1b[37m${prefix}\x1b[0m`, formattedArgs);
      }
    });

    return NextResponse.json({ success: true, processed: logs.length });
  } catch (error) {
    console.error('[CONSOLE-FORWARD] Error processing logs:', error);
    return NextResponse.json({ error: 'Failed to process logs' }, { status: 500 });
  }
}
