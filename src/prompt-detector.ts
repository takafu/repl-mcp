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
    bash: /\$\s*$/, // Match bash prompts ending with $
    zsh: /[%$#]\s*$/, // Match zsh prompts ending with %, $ or #
    custom: /[$#%]\s*$/, // Generic shell prompt pattern
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

  public static detectPrompt(output: string, expectedType?: string, learnedPatterns: string[] = [], isCleanText: boolean = false): PromptInfo {
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
      const cleanLine = isCleanText ? line.trim() : PromptDetector.stripAnsiCodes(line).trim(); // Strip ANSI codes only if needed
      
      // Skip empty lines after cleaning
      if (!cleanLine) continue;

      
      // Test this line for prompts (including learned patterns)
      const promptResult = this.testLineForPrompt(cleanLine, expectedType, learnedPatterns);
      if (promptResult.detected) {
        return promptResult;
      }
    }

    // If no prompt found, return info about the last non-empty line
    const lastNonEmptyLine = lines.reverse().find(line => {
      const cleaned = isCleanText ? line.trim() : PromptDetector.stripAnsiCodes(line).trim();
      return cleaned;
    });
    const cleanLastLine = lastNonEmptyLine ? (isCleanText ? lastNonEmptyLine.trim() : PromptDetector.stripAnsiCodes(lastNonEmptyLine).trim()) : '';
    return { detected: false, type: 'unknown', ready: false, prompt: cleanLastLine };
  }

  private static testLineForPrompt(cleanLine: string, expectedType?: string, learnedPatterns: string[] = []): PromptInfo {
    
    // Check learned patterns first (highest priority)
    for (const learnedPattern of learnedPatterns) {
      // Try to treat pattern as regex first, fallback to literal string match
      let matched = false;
      try {
        const regex = new RegExp(learnedPattern);
        matched = regex.test(cleanLine);
        console.log(`[DEBUG PromptDetector] Testing learned regex pattern /${learnedPattern}/ against "${cleanLine}". Result: ${matched}`);
      } catch (e) {
        // If regex is invalid, fallback to literal string match
        matched = cleanLine.includes(learnedPattern);
        console.log(`[DEBUG PromptDetector] Learned pattern "${learnedPattern}" treated as literal string. Match result: ${matched}`);
      }
      
      if (matched) {
        console.log(`[DEBUG PromptDetector] Matched learned pattern "${learnedPattern}" in line "${cleanLine}"`);
        return {
          detected: true,
          type: expectedType || 'learned',
          ready: true,
          prompt: cleanLine
        };
      }
    }
    
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

  public static extractCommandOutput(fullOutput: string, command: string, replType: string): string {
    // Strip ANSI codes for easier parsing
    const cleanOutput = PromptDetector.stripAnsiCodes(fullOutput);
    
    // Split into lines
    const lines = cleanOutput.split('\n');
    
    // Find the command echo line
    let commandLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes(command.trim())) {
        commandLineIndex = i;
        break;
      }
    }
    
    if (commandLineIndex === -1) {
      // Command not found in output, return everything minus the last prompt line
      const withoutLastLine = lines.slice(0, -1);
      return withoutLastLine.join('\n').trim();
    }
    
    // Extract output between command echo and final prompt
    const outputLines = [];
    for (let i = commandLineIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines at the start
      if (outputLines.length === 0 && !line) continue;
      
      // Check if this line looks like a prompt
      const isPromptLine = this.looksLikePrompt(line, replType);
      if (isPromptLine) {
        break; // Stop at the next prompt
      }
      
      outputLines.push(lines[i]);
    }
    
    return outputLines.join('\n').trim();
  }
  
  private static looksLikePrompt(line: string, replType: string): boolean {
    // Simple prompt detection for output extraction
    if (replType === 'python') {
      return line === '>>>' || line.startsWith('>>> ');
    }
    if (replType === 'node') {
      return line === '>' || line.startsWith('> ');
    }
    if (replType === 'ipython') {
      return /^In \[\d+\]:/.test(line);
    }
    // Add more patterns as needed
    return false;
  }
}