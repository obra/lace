// ABOUTME: File search tool wrapping ripgrep for fast text searching
// ABOUTME: Provides powerful regex search across files with ripgrep's performance

import { BaseTool, ToolSchema, ToolContext } from './base-tool.js';
import { spawn } from 'child_process';

export interface FileSearchParams {
  pattern: string;
  path?: string;
  case_sensitive?: boolean;
  whole_word?: boolean;
  include?: string;
  exclude?: string;
  max_results?: number;
}

export interface SearchMatch {
  file: string;
  line_number: number;
  line_content: string;
  match_start?: number;
  match_end?: number;
}

export interface FileSearchResult {
  pattern: string;
  matches: SearchMatch[];
  total_matches: number;
  files_searched: number;
  truncated?: boolean;
}

export class FileSearchTool extends BaseTool {
  getMetadata(): ToolSchema {
    return {
      name: 'file_search',
      description: 'Search for text patterns in files using ripgrep',
      methods: {
        run: {
          description: 'Search for a pattern across files',
          parameters: {
            pattern: {
              type: 'string',
              required: true,
              description: 'Text pattern to search for (supports regex)'
            },
            path: {
              type: 'string',
              required: false,
              default: '.',
              description: 'Directory or file path to search in'
            },
            case_sensitive: {
              type: 'boolean',
              required: false,
              default: false,
              description: 'Perform case-sensitive search'
            },
            whole_word: {
              type: 'boolean',
              required: false,
              default: false,
              description: 'Match whole words only'
            },
            include: {
              type: 'string',
              required: false,
              description: 'File pattern to include (glob)'
            },
            exclude: {
              type: 'string',
              required: false,
              description: 'File pattern to exclude (glob)'
            },
            max_results: {
              type: 'number',
              required: false,
              default: 100,
              description: 'Maximum number of matches to return'
            }
          }
        }
      }
    };
  }

  async run(params: FileSearchParams, context?: ToolContext): Promise<FileSearchResult> {
    const { 
      pattern, 
      path = '.', 
      case_sensitive = false, 
      whole_word = false,
      include,
      exclude,
      max_results = 100
    } = params;

    try {
      // Build ripgrep command arguments
      const args = [
        '--json',           // Output in JSON format for parsing
        '--line-number',    // Include line numbers
        '--column',         // Include column numbers for match positions
        '--no-heading',     // Don't group by file
        '--color=never'     // No color codes in output
      ];

      // Case sensitivity
      if (!case_sensitive) {
        args.push('--ignore-case');
      }

      // Whole word matching
      if (whole_word) {
        args.push('--word-regexp');
      }

      // File inclusion/exclusion
      if (include) {
        args.push('--glob', include);
      }
      if (exclude) {
        args.push('--glob', `!${exclude}`);
      }

      // Limit results
      args.push('--max-count', max_results.toString());

      // Add pattern and path
      args.push(pattern, path);

      // Check for cancellation before starting
      if (context?.signal?.aborted) {
        throw new Error('Operation was cancelled');
      }

      const result = await this.runRipgrep(args, context);
      
      return {
        pattern,
        matches: result.matches,
        total_matches: result.matches.length,
        files_searched: result.filesSearched,
        truncated: result.matches.length >= max_results
      };

    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('command not found') || error.message.includes('rg')) {
          throw new Error('ripgrep (rg) not found - please install ripgrep');
        }
      }
      throw error;
    }
  }

  private async runRipgrep(args: string[], context?: ToolContext): Promise<{
    matches: SearchMatch[];
    filesSearched: number;
  }> {
    return new Promise((resolve, reject) => {
      const matches: SearchMatch[] = [];
      const filesSearched = new Set<string>();

      const rg = spawn('rg', args);
      let stdout = '';
      let stderr = '';

      // Handle cancellation
      const abortHandler = () => {
        rg.kill('SIGTERM');
        reject(new Error('Operation was cancelled'));
      };

      context?.signal?.addEventListener('abort', abortHandler);

      rg.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      rg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      rg.on('close', (code) => {
        context?.signal?.removeEventListener('abort', abortHandler);

        // ripgrep exits with code 1 when no matches found, which is not an error
        if (code !== 0 && code !== 1) {
          return reject(new Error(`ripgrep failed with code ${code}: ${stderr}`));
        }

        try {
          // Parse JSON output
          const lines = stdout.trim().split('\n').filter(line => line);
          
          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              
              if (json.type === 'match') {
                const match: SearchMatch = {
                  file: json.data.path.text,
                  line_number: json.data.line_number,
                  line_content: json.data.lines.text.trimEnd(),
                  match_start: json.data.submatches?.[0]?.start,
                  match_end: json.data.submatches?.[0]?.end
                };
                
                matches.push(match);
                filesSearched.add(match.file);
              }
            } catch (parseError) {
              // Skip malformed JSON lines
              continue;
            }
          }

          resolve({
            matches,
            filesSearched: filesSearched.size
          });

        } catch (error) {
          reject(new Error(`Failed to parse ripgrep output: ${error instanceof Error ? error.message : String(error)}`));
        }
      });

      rg.on('error', (error) => {
        context?.signal?.removeEventListener('abort', abortHandler);
        reject(new Error(`Failed to spawn ripgrep: ${error.message}`));
      });
    });
  }
}