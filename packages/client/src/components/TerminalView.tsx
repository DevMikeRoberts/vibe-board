import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { AgentEvent } from '@/types';

interface TerminalViewProps {
  events: AgentEvent[];
  streaming: boolean;
  theme?: 'dark' | 'light';
}

const ANSI = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  bold:    '\x1b[1m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  blue:    '\x1b[34m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  gray:    '\x1b[90m',
};

function eventToLines(event: AgentEvent): string {
  switch (event.type) {
    case 'file_read': {
      const file = event.metadata?.file ?? event.content;
      return `${ANSI.cyan}▸ read  ${ANSI.reset}${file}\r\n`;
    }
    case 'file_write':
    case 'file_edit': {
      const file = event.metadata?.file ?? event.content;
      return `${ANSI.yellow}▸ write ${ANSI.reset}${file}\r\n`;
    }
    case 'command': {
      const cmd = event.metadata?.command ?? event.content;
      return `${ANSI.blue}$ ${ANSI.reset}${cmd}\r\n`;
    }
    case 'command_output': {
      // Filter empty lines and build progress noise (dotnet timestamps, fragments)
      const meaningful = event.content.split('\n').filter(l => {
        const trimmed = l.trim();
        if (trimmed.length === 0) return false;
        // Strip ANSI escape codes for matching
        const clean = trimmed.replace(/\x1b\[[0-9;]*m/g, '');
        // Filter progress timestamps: (0.3s), (1.2s)csproj, etc.
        if (/^\(?\d+\.\d+s\)/.test(clean)) return false;
        // Filter bare fragments that are just part of progress output
        if (/^(csproj|sln|props|targets)$/i.test(clean)) return false;
        return true;
      });
      if (meaningful.length === 0) return '';
      const lines = meaningful.map(l => `  ${l}`).join('\r\n');
      return lines + '\r\n';
    }
    case 'thinking': {
      const lines = event.content.split('\n').map(l => `${ANSI.magenta}  ${l}${ANSI.reset}`).join('\r\n');
      return lines + '\r\n';
    }
    case 'output': {
      const lines = event.content.split('\n').map(l => `  ${l}`).join('\r\n');
      return lines + '\r\n';
    }
    case 'complete':
      return `\r\n${ANSI.green}${ANSI.bold}✓ Complete${ANSI.reset}\r\n`;
    case 'error':
      return `${ANSI.red}✗ ${event.content}${ANSI.reset}\r\n`;
    default:
      return '';
  }
}

// Midnight Arcade terminal palette — neon on near-black.
const DARK_THEME = {
  background:  '#08070c',
  foreground:  '#f6f1de',
  cursor:      '#ff6ec7',
  black:       '#100e16',
  red:         '#ff5470',
  green:       '#3df285',
  yellow:      '#f2e947',
  blue:        '#6c5cff',
  magenta:     '#ff6ec7',
  cyan:        '#7de3ff',
  white:       '#f6f1de',
  brightBlack: '#a29dbe',
};

// Paper Arcade terminal palette — inked neons on cream.
const LIGHT_THEME = {
  background:  '#f6f1de',
  foreground:  '#17121c',
  cursor:      '#e8368f',
  black:       '#e0d5b6',
  red:         '#d12a4e',
  green:       '#0e9e5c',
  yellow:      '#b89e00',
  blue:        '#4b3ee8',
  magenta:     '#e8368f',
  cyan:        '#1f8fb0',
  white:       '#17121c',
  brightBlack: '#6e6550',
};

export function TerminalView({ events, streaming, theme = 'dark' }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const renderedCountRef = useRef(0);

  // Init terminal once
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      convertEol: true,
      scrollback: 5000,
      disableStdin: true,
      cursorBlink: false,
      fontSize: 11,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      theme: theme === 'light' ? LIGHT_THEME : DARK_THEME,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;
    renderedCountRef.current = 0;

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      renderedCountRef.current = 0;
    };
  }, [theme]);

  // Write new events incrementally, coalescing consecutive same-type fragments
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const newEvents = events.slice(renderedCountRef.current);

    // Coalesce consecutive output/thinking fragments into single events before rendering
    const STREAMABLE = new Set(['output', 'thinking']);
    const coalesced: typeof newEvents = [];
    for (const event of newEvents) {
      const prev = coalesced[coalesced.length - 1];
      if (prev && STREAMABLE.has(event.type) && prev.type === event.type) {
        // Merge into previous
        coalesced[coalesced.length - 1] = { ...prev, content: prev.content + event.content };
      } else {
        coalesced.push(event);
      }
    }

    for (const event of coalesced) {
      const line = eventToLines(event);
      if (line) term.write(line);
    }
    renderedCountRef.current = events.length;
  }, [events]);

  // Blinking cursor while streaming
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.cursorBlink = streaming;
  }, [streaming]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ padding: '8px 4px' }}
    />
  );
}
