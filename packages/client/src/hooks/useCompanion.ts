import { useState, useCallback, useEffect, useRef } from 'react';
import { api, connectWS } from '@/lib/api';
import type { AgentEvent } from '@/types';
import { getRandomGreeting, getIdleMessage } from '@/lib/companion-quips';

export interface CompanionMessage {
  id: string;
  role: 'user' | 'companion';
  content: string;
  timestamp: number;
}

let messageCounter = 0;
function nextId(): string {
  return `cmsg-${Date.now()}-${++messageCounter}`;
}

export interface UseCompanionReturn {
  open: boolean;
  toggle: () => void;
  openPanel: () => void;
  closePanel: () => void;
  messages: CompanionMessage[];
  sendMessage: (text: string) => void;
  streaming: boolean;
  companionEvent: AgentEvent | null;
}

export function useCompanion(): UseCompanionReturn {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<CompanionMessage[]>(() => [
    {
      id: nextId(),
      role: 'companion',
      content: getRandomGreeting(),
      timestamp: Date.now(),
    },
  ]);
  const [streaming, setStreaming] = useState(false);
  const [companionEvent, setCompanionEvent] = useState<AgentEvent | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hasOpenedRef = useRef(false);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    hasOpenedRef.current = true;
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
  }, []);

  // Send idle quip after 30s of inactivity when panel is open
  useEffect(() => {
    if (!open) {
      clearTimeout(idleTimerRef.current);
      return;
    }
    idleTimerRef.current = setTimeout(() => {
      if (!streaming) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'companion',
            content: getIdleMessage(),
            timestamp: Date.now(),
          },
        ]);
      }
    }, 30_000);
    return () => clearTimeout(idleTimerRef.current);
  }, [open, streaming, messages.length]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg: CompanionMessage = {
      id: nextId(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);

    // Create a temporary task via the API and run it with opencode
    api.createCompanionTask(text.trim()).then((result) => {
      const taskId = result.taskId;

      // Listen for WS events on this task
      const disconnect = connectWS((msg) => {
        if (msg.type === 'agent_event' && msg.payload.taskId === taskId) {
          const event = msg.payload;
          setCompanionEvent(event);

          if (event.type === 'complete') {
            // Extract the output as the companion's response
            const responseText = event.content || 'done! let me know if you need anything else.';
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'companion',
                content: responseText,
                timestamp: Date.now(),
              },
            ]);
            setStreaming(false);
            disconnect();
          } else if (event.type === 'error') {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'companion',
                content: `oops, something went wrong: ${event.content}`,
                timestamp: Date.now(),
              },
            ]);
            setStreaming(false);
            disconnect();
          } else if (event.type === 'output') {
            // Streaming output — show as intermediate response
            setMessages((prev) => {
              // Update the last companion message if it exists and is the streaming one
              const last = prev[prev.length - 1];
              if (last && last.id.startsWith('streaming-')) {
                return [
                  ...prev.slice(0, -1),
                  { ...last, content: event.content },
                ];
              }
              return [
                ...prev,
                {
                  id: 'streaming-' + taskId,
                  role: 'companion',
                  content: event.content,
                  timestamp: Date.now(),
                },
              ];
            });
          }
        }
      });
    }).catch((err) => {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'companion',
          content: `couldn't reach the agent: ${err.message}. make sure opencode is configured.`,
          timestamp: Date.now(),
        },
      ]);
      setStreaming(false);
    });
  }, [streaming]);

  return {
    open,
    toggle,
    openPanel,
    closePanel,
    messages,
    sendMessage,
    streaming,
    companionEvent,
  };
}
