import { PromptInfo } from './types.js';
import stripAnsi from 'strip-ansi';

export class PromptDetector {
  private static readonly PROMPT_PATTERNS: Record<string, RegExp> = {
    pry: /^\[\d+\] pry\([^)]+\)>(?:\s*|\u001b\[[0-9;]*[A-Za-z])*\s*$/m,
    irb: /^irb\([^)]+\):\d+[>*](?:\s*|\u001b\[[0-9;]*[A-Za-z])*\s*$/m,
    ipython: /^In \[\d+\]:\s*$/m,
    node: /^>\s*(?:\u001b\[[0-9;]*[mK])*\s*$/m,
    python: /^>>>\s*$/m,
    rails_console: /^\[\d+\] pry\([^)]+\)>(?:\s*|\u001b\[[0-9;]*[A-Za-z])*\s*$/m,
    cmd: /[a-zA-Z]:\\[^>]*?>\s*$/, // Match drive path followed by > at end of line
  };

  private static stripAnsiCodes(str: string): string {
    const ansiRegex = /\u001b\[[0-9;?]*[A-Za-z]/g;
    return stripAnsi(str).trim().replace(ansiRegex, "");
  }

  private static readonly CONTINUATION_PATTERNS: Record<string, RegExp> = {
    pry: /^\[\d+\] pry\([^)]+\)\*(?:\s*|\u001b\[[0-9;]*[A-Za-z])*\s*$/m,
    irb: /^irb\([^)]+\):\d+\*(?:\s*|\u001b\[[0-9;]*[A-Za-z])*\s*$/m,
    ipython: /^\.{3,}:\s*$/m,
    python: /^\.\.\.\s*$/m
  };

  public static detectPrompt(output: string, expectedType?: string): PromptInfo {
    // Normalize line endings and split
    const lines = output.replace(/\r\n/g, '\n').split('\n');
    if (lines.length === 0) {
      return { detected: false, type: 'unknown', ready: false, prompt: '' };
    }

    // Look for prompt in all lines, not just the last one
    // Check lines in reverse order to find the most recent prompt
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const originalLine = line; // Keep original for logging
      const cleanLine = PromptDetector.stripAnsiCodes(line).trim(); // Strip ANSI codes and trim
      
      // Skip empty lines after cleaning
      if (!cleanLine) continue;

      // Debug logging for troubleshooting - temporarily enabled
      console.log(`[DEBUG PromptDetector] Checking line ${i}: "${originalLine.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`);
      console.log(`[DEBUG PromptDetector] Cleaned line ${i}: "${cleanLine.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`);

      // Test this line for prompts
      const promptResult = this.testLineForPrompt(cleanLine, expectedType);
      if (promptResult.detected) {
        return promptResult;
      }
    }

    // If no prompt found, return info about the last non-empty line
    const lastNonEmptyLine = lines.reverse().find(line => PromptDetector.stripAnsiCodes(line).trim());
    const cleanLastLine = lastNonEmptyLine ? PromptDetector.stripAnsiCodes(lastNonEmptyLine).trim() : '';
    return { detected: false, type: 'unknown', ready: false, prompt: cleanLastLine };
  }

  private static testLineForPrompt(cleanLine: string, expectedType?: string): PromptInfo {
    
    // Check for specific type if provided
    if (expectedType && this.PROMPT_PATTERNS[expectedType]) {
      const pattern = this.PROMPT_PATTERNS[expectedType];
      const continuationPattern = this.CONTINUATION_PATTERNS[expectedType];
      
      const testResult = pattern.test(cleanLine);
      console.log(`[DEBUG PromptDetector] Testing pattern "${pattern.source}" against "${cleanLine.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}". Result: ${testResult}`);
      if (testResult) {
        return {
          detected: true,
          type: expectedType,
          ready: true,
          prompt: cleanLine
        };
      }
      
      if (continuationPattern && continuationPattern.test(cleanLine)) {
        return {
          detected: true,
          type: expectedType,
          ready: false,
          prompt: cleanLine
        };
      }
    }

    // Check all patterns if no specific type or type didn't match
    for (const [type, pattern] of Object.entries(this.PROMPT_PATTERNS)) {
      const testResult = pattern.test(cleanLine);
      console.error(`[DEBUG PromptDetector] Testing generic pattern "${pattern.source}" against "${cleanLine.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}". Result: ${testResult}`);
      if (testResult) {
        const continuationPattern = this.CONTINUATION_PATTERNS[type];
        const ready = !continuationPattern || !continuationPattern.test(cleanLine);
        
        return {
          detected: true,
          type,
          ready,
          prompt: cleanLine
        };
      }
    }

    // Check for continuation patterns
    for (const [type, pattern] of Object.entries(this.CONTINUATION_PATTERNS)) {
      if (pattern.test(cleanLine)) {
        const ready = false; // Continuation patterns are never "ready"
        return {
          detected: true,
          type,
          ready,
          prompt: cleanLine
        };
      }
    }

    return { detected: false, type: 'unknown', ready: false, prompt: cleanLine };
  }

  public static isErrorOutput(output: string, replType: string): boolean {
    const errorPatterns: Record<string, RegExp[]> = {
      pry: [
        /Error:/i,
        /Exception:/i,
        /SyntaxError:/i,
        /NameError:/i,
        /NoMethodError:/i
      ],
      irb: [
        /Error:/i,
        /Exception:/i,
        /SyntaxError:/i,
        /NameError:/i,
        /NoMethodError:/i
      ],
      ipython: [
        /Error:/i,
        /Exception:/i,
        /SyntaxError:/i,
        /NameError:/i,
        /AttributeError:/i,
        /TypeError:/i
      ],
      python: [
        /Error:/i,
        /Exception:/i,
        /SyntaxError:/i,
        /NameError:/i,
        /AttributeError:/i,
        /TypeError:/i
      ],
      node: [
        /Error:/i,
        /ReferenceError:/i,
        /SyntaxError:/i,
        /TypeError:/i
      ]
    };

    const patterns = errorPatterns[replType] || errorPatterns.pry;
    return patterns.some(pattern => pattern.test(output));
  }
}