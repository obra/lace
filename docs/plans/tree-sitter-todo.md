⏺ Code Analysis Tool Specification

  Overview

  A Tree-sitter-based code comprehension tool for Lace that provides structured analysis of source files without requiring agents to read full file contents.

  Tool Interface

  class CodeAnalysisTool implements Tool {
    name = 'code_analyze';
    description = 'Analyze source code structure and extract symbols';

    input_schema = {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['analyze_file', 'search_symbols', 'get_signatures', 'list_exports'],
          description: 'Analysis operation to perform'
        },
        file: {
          type: 'string',
          description: 'File path to analyze (required for analyze_file, get_signatures, list_exports)'
        },
        query: {
          type: 'string',
          description: 'Symbol name or pattern to search (required for search_symbols)'
        },
        path: {
          type: 'string',
          description: 'Directory to search in (optional, defaults to current directory)'
        }
      },
      required: ['operation']
    };
  }

  Phase 1: Core Languages

  - JavaScript (.js, .mjs, .cjs)
  - TypeScript (.ts, .tsx, .mts, .cts)
  - JSON (.json, .jsonc)
  - Markdown (.md, .mdx)

  Phase 2: Extended Languages (Future)

  - Bash (.sh, .bash, .zsh)
  - C (.c, .h)
  - C++ (.cpp, .cc, .cxx, .hpp)
  - Python (.py)
  - Go (.go)
  - Rust (.rs)

  Operations

  analyze_file

  Get complete structure of a single file.

  Input:
  {
    "operation": "analyze_file",
    "file": "src/api/users.ts"
  }

  Output:
  interface FileAnalysis {
    file: string;
    language: string;
    functions: FunctionInfo[];
    classes: ClassInfo[];
    interfaces: TypeInfo[];  // TS only
    exports: ExportInfo[];
    imports: ImportInfo[];
    constants: ConstantInfo[];
  }

  search_symbols

  Find functions/classes/types across multiple files.

  Input:
  {
    "operation": "search_symbols",
    "query": "handleAuth",
    "path": "src/"
  }

  Output:
  interface SymbolSearchResult {
    matches: SymbolMatch[];
    totalFiles: number;
  }

  interface SymbolMatch {
    file: string;
    symbol: string;
    type: 'function' | 'class' | 'interface' | 'constant';
    line: number;
    signature: string;
  }

  get_signatures

  Get function signatures without implementations.

  Input:
  {
    "operation": "get_signatures",
    "file": "src/auth.ts"
  }

  Output:
  interface SignatureInfo {
    name: string;
    parameters: ParameterInfo[];
    returnType?: string;
    line: number;
    signature: string;  // e.g., "login(email: string, password: string): Promise<User>"
  }

  list_exports

  Show public API of a file.

  Input:
  {
    "operation": "list_exports",
    "file": "src/utils/index.ts"
  }

  Output:
  interface ExportInfo {
    name: string;
    type: 'function' | 'class' | 'interface' | 'constant' | 'default';
    signature?: string;
    isDefault: boolean;
  }

  Data Types

  interface FunctionInfo {
    name: string;
    parameters: ParameterInfo[];
    returnType?: string;
    isAsync: boolean;
    isExported: boolean;
    line: number;
    signature: string;
  }

  interface ParameterInfo {
    name: string;
    type?: string;
    optional: boolean;
    defaultValue?: string;
  }

  interface ClassInfo {
    name: string;
    methods: FunctionInfo[];
    properties: PropertyInfo[];
    constructor?: FunctionInfo;
    extends?: string;
    implements?: string[];
    isExported: boolean;
    line: number;
  }

  interface TypeInfo {
    name: string;
    kind: 'interface' | 'type' | 'enum';
    properties?: PropertyInfo[];
    isExported: boolean;
    line: number;
  }

  interface ImportInfo {
    source: string;  // e.g., "./utils"
    imports: ImportItem[];
  }

  interface ImportItem {
    name: string;
    alias?: string;
    isDefault: boolean;
    isNamespace: boolean;  // import * as
  }

  Implementation Architecture

  class CodeAnalysisTool implements Tool {
    private languageRegistry: LanguageRegistry;

    constructor() {
      this.languageRegistry = new LanguageRegistry();
      this.registerCoreLanguages();
    }

    private registerCoreLanguages() {
      this.languageRegistry.register('javascript', require('tree-sitter-javascript'));
      this.languageRegistry.register('typescript', require('tree-sitter-typescript').typescript);
      this.languageRegistry.register('json', require('tree-sitter-json'));
      this.languageRegistry.register('markdown', require('tree-sitter-markdown'));
    }
  }

  class LanguageRegistry {
    private parsers = new Map<string, Parser>();
    private extensionMap = {
      '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
      '.ts': 'typescript', '.tsx': 'typescript',
      '.json': 'json', '.jsonc': 'json',
      '.md': 'markdown', '.mdx': 'markdown'
    };

    detectLanguage(filePath: string): string;
    getParser(language: string): Parser;
  }

  AI Agent Benefits

  1. API Discovery: list_exports src/api/users.ts → See available functions without reading file
  2. Quick Reference: get_signatures src/auth.ts → Get function signatures for context
  3. Symbol Search: search_symbols "validateUser" → Find function across codebase
  4. Structure Overview: analyze_file src/components/Header.tsx → Understand component structure

  Error Handling

  - Unsupported Language: Return language detection result with warning
  - Parse Errors: Return partial results with error details
  - File Not Found: Standard file system error
  - Malformed Syntax: Best-effort parsing with error annotations

  This gives agents structured code understanding without ingesting full file contents, supporting their workflow while keeping implementation focused and maintainable.