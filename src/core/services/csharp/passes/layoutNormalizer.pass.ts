/**
 * Pass 3: Preprocessor-Safe K&R Layout & Indentation Normalizer (T01, T06).
 *
 * Strictly preserves verbatim strings (@"..."), raw strings ("""..."""),
 * regular strings ("..."), char literals ('a'), and comments atomically.
 * Enforces column-0 newline invariants on preprocessor directives (#if/#else/#endif).
 */

type LexerState =
  | 'CODE'
  | 'LINE_COMMENT'
  | 'BLOCK_COMMENT'
  | 'STRING'
  | 'VERBATIM_STRING'
  | 'RAW_STRING'
  | 'CHAR_LITERAL';

interface TokenSegment {
  kind: 'code' | 'literal' | 'preproc' | 'comment';
  text: string;
}

/**
 * Splits a normalized `\n` C# source string into lines while tracking multi-line
 * lexical states (raw strings, verbatim strings, block comments) so literals are never mangled.
 */
export function normalizeCSharpLayout(source: string, indentSpaces: 0 | 1 | 2): string {
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');

  let state: LexerState = 'CODE';
  let rawQuoteCount = 0;

  // First pass: classify each line's start state and tokenize code vs atomic spans
  const outputLines: string[] = [];
  let braceDepth = 0;
  let lastWasPreprocOrComment = false;

  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
    const rawLine = rawLines[lineIdx];

    // If we are inside a multi-line literal or block comment, preserve line verbatim!
    if (state === 'RAW_STRING' || state === 'VERBATIM_STRING' || state === 'BLOCK_COMMENT') {
      outputLines.push(rawLine);
      state = advanceStateAcrossLine(rawLine, state, rawQuoteCount);
      if (state !== 'RAW_STRING') rawQuoteCount = 0;
      lastWasPreprocOrComment = state === 'BLOCK_COMMENT';
      continue;
    }

    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue; // Collapse blank lines (T01)
    }

    // Preprocessor directive invariant: column 0, own line, never fold braces across it
    if (trimmed.startsWith('#')) {
      outputLines.push(trimmed);
      lastWasPreprocOrComment = true;
      continue;
    }

    // Scan line in CODE state to update braceDepth and detect end-of-line multi-line state
    const { deltaDepth, startsWithCloseBrace, isPureOpenBrace, endsInComment, nextState, nextRawQuotes } =
      scanCodeLine(trimmed);

    // K&R brace folding: fold standalone `{` onto previous non-preproc, non-comment line
    if (
      isPureOpenBrace &&
      outputLines.length > 0 &&
      !lastWasPreprocOrComment
    ) {
      const prev = outputLines[outputLines.length - 1];
      if (!prev.endsWith('{')) {
        outputLines[outputLines.length - 1] = `${prev} {`;
        braceDepth += deltaDepth;
        lastWasPreprocOrComment = false;
        state = nextState;
        rawQuoteCount = nextRawQuotes;
        continue;
      }
    }

    // Compute indentation for this line
    const effectiveDepth = Math.max(0, startsWithCloseBrace ? braceDepth - 1 : braceDepth);
    const indent = indentSpaces > 0 ? ' '.repeat(effectiveDepth * indentSpaces) : '';
    const formattedLine = `${indent}${trimmed}`;

    // Compact auto-property / short single-line block:
    // If current line is `}` and previous two lines are `... {` and `get;` or `set;` etc.
    outputLines.push(formattedLine);

    braceDepth = Math.max(0, braceDepth + deltaDepth);
    lastWasPreprocOrComment = endsInComment;
    state = nextState;
    rawQuoteCount = nextRawQuotes;
  }

  // Second pass: compact trivial single-line blocks like `{ get; set; }` or `{ return x; }`
  const compacted = compactTrivialBlocks(outputLines);
  return compacted.join('\n') + (compacted.length > 0 ? '\n' : '');
}

function compactTrivialBlocks(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const curr = lines[i];

    // Match `{` at end of line followed by `get;` / `set;` / `init;` / single short statement and `}`
    if (curr.endsWith(' {') && i + 2 < lines.length) {
      // Check 2-line inner (e.g. get; set;)
      if (i + 3 < lines.length && lines[i + 3].trim() === '}') {
        const inner1 = lines[i + 1].trim();
        const inner2 = lines[i + 2].trim();
        if (
          isSimpleAccessor(inner1) &&
          isSimpleAccessor(inner2) &&
          curr.length + inner1.length + inner2.length + 5 <= 80
        ) {
          result.push(`${curr} ${inner1} ${inner2} }`);
          i += 4;
          continue;
        }
      }

      // Check 1-line inner (e.g. get; or return x; under 72 chars, no braces/comments/#)
      if (lines[i + 2].trim() === '}') {
        const inner = lines[i + 1].trim();
        if (
          !inner.startsWith('#') &&
          !inner.startsWith('//') &&
          !inner.includes('{') &&
          !inner.includes('}') &&
          curr.length + inner.length + 4 <= 72
        ) {
          result.push(`${curr} ${inner} }`);
          i += 3;
          continue;
        }
      }
    }

    result.push(curr);
    i++;
  }

  return result;
}

function isSimpleAccessor(s: string): boolean {
  return (
    s === 'get;' ||
    s === 'set;' ||
    s === 'init;' ||
    s === 'private set;' ||
    s === 'protected set;' ||
    s === 'internal set;' ||
    s === 'private init;'
  );
}

function advanceStateAcrossLine(
  line: string,
  startState: LexerState,
  rawQuotes: number
): LexerState {
  let i = 0;
  const n = line.length;
  let state = startState;

  while (i < n) {
    if (state === 'BLOCK_COMMENT') {
      if (line[i] === '*' && line[i + 1] === '/') {
        state = 'CODE';
        i += 2;
        continue;
      }
      i++;
    } else if (state === 'VERBATIM_STRING') {
      if (line[i] === '"') {
        if (line[i + 1] === '"') {
          i += 2;
          continue;
        }
        state = 'CODE';
      }
      i++;
    } else if (state === 'RAW_STRING') {
      if (line[i] === '"') {
        let count = 0;
        while (i + count < n && line[i + count] === '"') count++;
        if (count >= rawQuotes) {
          state = 'CODE';
          i += count;
          continue;
        }
        i += count;
        continue;
      }
      i++;
    } else {
      // Back in CODE on the same line: scan remainder
      const sub = scanCodeLine(line.slice(i));
      return sub.nextState;
    }
  }

  return state;
}

function scanCodeLine(trimmedLine: string): {
  deltaDepth: number;
  startsWithCloseBrace: boolean;
  isPureOpenBrace: boolean;
  endsInComment: boolean;
  nextState: LexerState;
  nextRawQuotes: number;
} {
  let state: LexerState = 'CODE';
  let rawQuotes = 0;
  let deltaDepth = 0;
  let endsInComment = false;
  const n = trimmedLine.length;

  const startsWithCloseBrace = trimmedLine.startsWith('}');
  const isPureOpenBrace = trimmedLine === '{';

  let i = 0;
  while (i < n) {
    const ch = trimmedLine[i];
    const next = trimmedLine[i + 1];

    if (state === 'CODE') {
      // Check raw string: 3+ quotes (or $"""...""")
      if (ch === '"' && next === '"' && trimmedLine[i + 2] === '"') {
        let q = 0;
        while (i + q < n && trimmedLine[i + q] === '"') q++;
        rawQuotes = q;
        state = 'RAW_STRING';
        i += q;
        continue;
      }
      // Verbatim string @"..." or $@"..." or @$"..."
      if (
        (ch === '@' && next === '"') ||
        (ch === '$' && next === '@' && trimmedLine[i + 2] === '"') ||
        (ch === '@' && next === '$' && trimmedLine[i + 2] === '"')
      ) {
        const quoteOffset = ch === '@' && next === '"' ? 2 : 3;
        state = 'VERBATIM_STRING';
        i += quoteOffset;
        continue;
      }
      if (ch === '"') {
        state = 'STRING';
        i++;
        continue;
      }
      if (ch === "'") {
        state = 'CHAR_LITERAL';
        i++;
        continue;
      }
      if (ch === '/' && next === '/') {
        endsInComment = true;
        break; // Rest of line is line comment
      }
      if (ch === '/' && next === '*') {
        state = 'BLOCK_COMMENT';
        i += 2;
        continue;
      }
      if (ch === '{') {
        deltaDepth++;
      } else if (ch === '}') {
        deltaDepth--;
      }
      i++;
    } else if (state === 'STRING') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        state = 'CODE';
      }
      i++;
    } else if (state === 'CHAR_LITERAL') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === "'") {
        state = 'CODE';
      }
      i++;
    } else if (state === 'VERBATIM_STRING') {
      if (ch === '"') {
        if (next === '"') {
          i += 2;
          continue;
        }
        state = 'CODE';
      }
      i++;
    } else if (state === 'RAW_STRING') {
      if (ch === '"') {
        let q = 0;
        while (i + q < n && trimmedLine[i + q] === '"') q++;
        if (q >= rawQuotes) {
          state = 'CODE';
          rawQuotes = 0;
          i += q;
          continue;
        }
        i += q;
        continue;
      }
      i++;
    } else if (state === 'BLOCK_COMMENT') {
      if (ch === '*' && next === '/') {
        state = 'CODE';
        i += 2;
        continue;
      }
      i++;
    }
  }

  if (state === 'BLOCK_COMMENT') {
    endsInComment = true;
  }

  return {
    deltaDepth,
    startsWithCloseBrace,
    isPureOpenBrace,
    endsInComment,
    nextState: state === 'STRING' || state === 'CHAR_LITERAL' ? 'CODE' : state,
    nextRawQuotes: rawQuotes,
  };
}

// Keep unused type export clean if needed internally
export type { TokenSegment };
