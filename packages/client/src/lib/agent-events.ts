/**
 * Shared utilities for rendering / processing agent events.
 * Used by both AgentPanel (sidebar) and TaskFullView (full-page view).
 */

import type { ElementType } from 'react';
import type { AgentEvent, AgentEventType } from '@/types';
import {
  Brain,
  Cog,
  FileText,
  FileCode2,
  Terminal,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export const eventIconMap: Record<AgentEventType, ElementType> = {
  thinking: Brain,
  tool_call: Cog,
  file_read: FileText,
  file_write: FileCode2,
  file_edit: FileCode2,
  command: Terminal,
  command_output: Terminal,
  output: Terminal,
  test_result: CheckCircle2,
  error: AlertCircle,
  complete: CheckCircle2,
};

export const eventColorMap: Record<AgentEventType, string> = {
  thinking: 'text-purple-500 dark:text-purple-400',
  tool_call: 'text-blue-500 dark:text-blue-400',
  file_read: 'text-sky-500 dark:text-sky-400',
  file_write: 'text-amber-500 dark:text-amber-400',
  file_edit: 'text-amber-500 dark:text-amber-400',
  command: 'text-cyan-600 dark:text-cyan-400',
  command_output: 'text-zinc-500 dark:text-zinc-400',
  output: 'text-zinc-500 dark:text-zinc-400',
  test_result: 'text-emerald-500 dark:text-emerald-400',
  error: 'text-red-500 dark:text-red-400',
  complete: 'text-emerald-500 dark:text-emerald-400',
};

export const eventLabelMap: Record<AgentEventType, string> = {
  thinking: 'Thinking',
  tool_call: 'Tool Call',
  file_read: 'File Read',
  file_write: 'File Write',
  file_edit: 'File Edit',
  command: 'Command',
  command_output: 'Output',
  output: 'Output',
  test_result: 'Test Result',
  error: 'Error',
  complete: 'Complete',
};

/** A coalesced event merges consecutive events of the same type */
export interface CoalescedEvent extends AgentEvent {
  /** Parsed label for command events (e.g. "bash") */
  toolLabel?: string;
  /** Parsed arguments for command events */
  toolArgs?: string;
}

/** Strip build-progress noise (dotnet timestamps, bare fragments) from output content */
export function stripProgressNoise(content: string): string {
  return content
    .split('\n')
    .filter((l) => {
      const trimmed = l.trim();
      if (trimmed.length === 0) return false;
      const clean = trimmed.replace(/\x1b\[[0-9;]*m/g, '');
      if (/^\(?\d+\.\d+s\)/.test(clean)) return false;
      if (/^(csproj|sln|props|targets)$/i.test(clean)) return false;
      return true;
    })
    .join('\n');
}

/** Merge consecutive events of the same mergeable type */
export function coalesceEvents(events: AgentEvent[], streaming: boolean): CoalescedEvent[] {
  const result: CoalescedEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    let event = events[i];

    if (event.type === 'command_output') {
      const cleaned = stripProgressNoise(event.content);
      if (!cleaned.trim()) continue;
      event = { ...event, content: cleaned };
    }

    if (!event.content?.trim() && event.type !== 'complete' && event.type !== 'error') continue;

    if (event.type === 'thinking' && streaming) {
      let hasFollowUp = false;
      for (let j = i + 1; j < events.length; j++) {
        if (events[j].type !== 'thinking') {
          hasFollowUp = true;
          break;
        }
      }
      if (!hasFollowUp) continue;
    }

    if (event.type === 'thinking' || event.type === 'output' || event.type === 'command_output') {
      const last = result[result.length - 1];
      const mergeable =
        last &&
        (last.type === event.type ||
          (last.type === 'output' && event.type === 'command_output') ||
          (last.type === 'command_output' && event.type === 'output'));
      if (mergeable) {
        last.content += event.content;
        continue;
      }
    }

    if (event.type === 'command') {
      const parsed = parseCommandEvent(event);
      result.push(parsed);
      continue;
    }

    result.push({ ...event });
  }
  return result;
}

/** Parse command event content like 'bash: {"command":"python3 hello.py","description":"Run hello"}' */
export function parseCommandEvent(event: AgentEvent): CoalescedEvent {
  const colonIdx = event.content.indexOf(': ');
  if (colonIdx === -1) return { ...event };

  const toolLabel = event.content.slice(0, colonIdx);
  const jsonStr = event.content.slice(colonIdx + 2);

  try {
    const parsed = JSON.parse(jsonStr);
    const display = parsed.command || parsed.description || jsonStr;
    return { ...event, toolLabel, toolArgs: display };
  } catch {
    return { ...event, toolLabel, toolArgs: jsonStr };
  }
}

/** Detect if content looks like code (backticks, common code patterns) */
export function looksLikeCode(text: string): boolean {
  if (text.includes('`')) return true;
  const lines = text.split('\n');
  const codePatterns =
    /^(import |export |const |let |var |function |class |if \(|for \(|while \(|return |async |await |\/\/|#include|def |package )/;
  return lines.some((line) => codePatterns.test(line.trimStart()));
}

/** Pretty-print a JSON string, or return null if it isn't JSON. */
export function tryPrettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

/**
 * Derive a readable detail string for tool_call / file_* events.
 */
export function deriveToolDetail(content: string | undefined): string | null {
  const raw = content?.trim();
  if (!raw) return null;
  const wholePretty = tryPrettyJson(raw);
  if (wholePretty) return wholePretty;
  const colonIdx = raw.indexOf(': ');
  if (colonIdx > 0) {
    const afterPretty = tryPrettyJson(raw.slice(colonIdx + 2));
    if (afterPretty) return afterPretty;
  }
  return raw;
}

/** Collapse content to a single-line, truncated summary for the event header. */
export function compactToolSummary(content: string | undefined): string | null {
  const raw = content?.trim();
  if (!raw) return null;
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? oneLine.slice(0, 80) + '...' : oneLine;
}

/** Derive file changes map from event list */
export function deriveFileChanges(events: AgentEvent[]) {
  const files = new Map<
    string,
    { type: 'created' | 'modified' | 'read'; content: string; diff?: string }
  >();
  for (const event of events) {
    const file = event.metadata?.file;
    if (!file) continue;
    if (event.type === 'file_write') {
      files.set(file, {
        type: files.has(file) ? 'modified' : 'created',
        content: event.content,
        diff: event.metadata?.diff,
      });
    } else if (event.type === 'file_edit') {
      files.set(file, { type: 'modified', content: event.content, diff: event.metadata?.diff });
    } else if (
      event.type === 'command' &&
      event.metadata?.fileEventType === 'file_write'
    ) {
      files.set(file, {
        type: files.has(file) ? 'modified' : 'created',
        content: event.content,
      });
    } else if (event.type === 'command_output' && event.metadata?.fileEventType) {
      const isWrite =
        event.metadata.fileEventType === 'file_write' ||
        event.metadata.fileEventType === 'file_edit';
      if (isWrite) {
        files.set(file, {
          type: files.has(file) ? 'modified' : 'created',
          content: event.content,
          diff: event.metadata?.diff,
        });
      }
    } else if (event.type === 'file_read' && !files.has(file)) {
      files.set(file, { type: 'read', content: event.content });
    }
  }
  return [...files.entries()].map(([path, info]) => ({ path, ...info }));
}
