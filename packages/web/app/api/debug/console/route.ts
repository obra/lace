// ABOUTME: API route handler for receiving browser console logs
// ABOUTME: Outputs forwarded console messages to server terminal with proper formatting

import { NextRequest, NextResponse } from 'next/server';
import superjson from 'superjson';
import type { ConsoleLogEntry } from '@/lib/console-forward';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { logs }: { logs: ConsoleLogEntry[] } = body;

    if (!Array.isArray(logs)) {
      return NextResponse.json({ error: 'Invalid logs format' }, { status: 400 });
    }

    // Output each log to server console with formatting
    logs.forEach((entry) => {
      const timestamp = new Date(entry.timestamp).toISOString();
      const url = new URL(entry.url).pathname;

      // Deserialize and format args for display
      let formattedArgs: string;

      try {
        // Check if args has the superjson format {json, meta}
        const argsData = entry.args as any;
        let deserializedArgs: unknown[];

        if (argsData && typeof argsData === 'object' && 'json' in argsData) {
          // This is superjson format
          deserializedArgs = superjson.deserialize(argsData);
        } else if (Array.isArray(argsData)) {
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
                return superjson.stringify(arg, null, 2);
              }
              return String(arg);
            })
            .join(' ');
        } else {
          formattedArgs = superjson.stringify(deserializedArgs, null, 2);
        }
      } catch (error) {
        // Fallback: handle raw args data
        console.error('[CONSOLE-FORWARD] Deserialization failed:', error);

        if (Array.isArray(entry.args)) {
          // Handle array of args
          formattedArgs = (entry.args as unknown[])
            .map((arg) => {
              if (typeof arg === 'string') return arg;
              if (typeof arg === 'object' && arg !== null) {
                // Handle serialization error objects
                if ('__serialization_error' in arg) {
                  const errorInfo = arg as any;
                  return `[Serialization Error: ${errorInfo.type}] ${errorInfo.string_representation}`;
                }
                return superjson.stringify(arg, null, 2);
              }
              return String(arg);
            })
            .join(' ');
        } else {
          // Handle single arg or unknown format
          formattedArgs =
            typeof entry.args === 'object' && entry.args !== null
              ? superjson.stringify(entry.args, null, 2)
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
          console.info(`\x1b[36m${prefix}\x1b[0m`, formattedArgs);
          break;
        case 'debug':
          console.debug(`\x1b[90m${prefix}\x1b[0m`, formattedArgs);
          break;
        default:
          console.log(`\x1b[37m${prefix}\x1b[0m`, formattedArgs);
      }
    });

    return NextResponse.json({ success: true, processed: logs.length });
  } catch (error) {
    console.error('[CONSOLE-FORWARD] Error processing logs:', error);
    return NextResponse.json({ error: 'Failed to process logs' }, { status: 500 });
  }
}
