import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CompanionMessage } from '@/hooks/useCompanion';
import { cn } from '@/lib/utils';

interface BoardCompanionProps {
  open: boolean;
  onToggle: () => void;
  messages: CompanionMessage[];
  onSend: (text: string) => void;
  streaming: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8-bit Pixel Companion Character (CSS art)
// ─────────────────────────────────────────────────────────────────────────────

function CompanionSprite({ mood }: { mood: 'idle' | 'happy' | 'thinking' | 'talking' }) {
  // 8x8 pixel grid rendered as a grid of colored divs
  const pixels = getSpritePixels(mood);

  return (
    <div className="relative flex flex-col items-center">
      {/* Speech indicator dots when talking */}
      {mood === 'talking' && (
        <div className="absolute -top-1 right-0 flex gap-0.5">
          <motion.span
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ repeat: Infinity, duration: 0.8, delay: 0 }}
            className="h-1 w-1 rounded-full bg-neon-yellow"
          />
          <motion.span
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }}
            className="h-1 w-1 rounded-full bg-neon-green"
          />
        </div>
      )}
      <div
        className="grid gap-px"
        style={{
          gridTemplateColumns: 'repeat(8, 1fr)',
          width: '48px',
          height: '48px',
        }}
      >
        {pixels.map((color, i) => (
          <div
            key={i}
            className="aspect-square transition-colors duration-150"
            style={{ backgroundColor: color || 'transparent' }}
          />
        ))}
      </div>
      {/* Feet */}
      <div className="flex gap-1 -mt-px">
        <motion.div
          animate={mood === 'happy' ? { y: [0, -2, 0] } : {}}
          transition={{ repeat: Infinity, duration: 0.6, delay: 0 }}
          className="h-1 w-2 bg-ink"
        />
        <motion.div
          animate={mood === 'happy' ? { y: [0, -2, 0] } : {}}
          transition={{ repeat: Infinity, duration: 0.6, delay: 0.15 }}
          className="h-1 w-2 bg-ink"
        />
      </div>
    </div>
  );
}

type PixelColor = string | null;

function getSpritePixels(mood: 'idle' | 'happy' | 'thinking' | 'talking'): PixelColor[] {
  const _ = null;
  const B = '#0e0b14'; // ink (outline)
  const W = '#f6f1de'; // cream (face)
  const P = '#ff6ec7'; // neon-pink (body)
  const Y = '#f2e947'; // neon-yellow (eyes/accents)
  const G = '#3df285'; // neon-green (cheeks)
  const U = '#6c5cff'; // neon-blue (hat/accessory)

  if (mood === 'idle') {
    // Relaxed face, simple expression
    return [
      _, _, U, U, U, U, _, _,
      _, U, P, P, P, P, U, _,
      _, B, W, B, B, W, B, _,
      _, _, W, W, W, W, _, _,
      _, B, W, Y, Y, W, B, _,
      _, _, W, W, W, W, _, _,
      _, _, B, W, W, B, _, _,
      _, _, _, B, B, _, _, _,
    ];
  }

  if (mood === 'happy') {
    // Big smile, squinting eyes
    return [
      _, _, U, U, U, U, _, _,
      _, U, P, P, P, P, U, _,
      _, B, G, B, B, G, B, _,
      _, _, W, W, W, W, _, _,
      _, _, W, W, W, W, _, _,
      _, B, _, W, W, _, B, _,
      _, _, B, _, _, B, _, _,
      _, _, _, B, B, _, _, _,
    ];
  }

  if (mood === 'thinking') {
    // One eye closed, hand on chin
    return [
      _, _, U, U, U, U, _, _,
      _, U, P, P, P, P, U, _,
      _, B, W, B, B, B, B, _,
      _, _, W, W, W, W, _, _,
      _, _, W, Y, Y, W, _, _,
      _, _, W, W, W, W, _, _,
      _, _, _, W, B, _, _, _,
      _, _, _, B, B, _, _, _,
    ];
  }

  // talking — open mouth
  return [
    _, _, U, U, U, U, _, _,
    _, U, P, P, P, P, U, _,
    _, B, Y, B, B, Y, B, _,
    _, _, W, W, W, W, _, _,
    _, _, W, W, W, W, _, _,
    _, _, W, B, B, W, _, _,
    _, _, _, W, W, _, _, _,
    _, _, _, B, B, _, _, _,
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Typing indicator animation
// ─────────────────────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <motion.span
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ repeat: Infinity, duration: 1, delay: 0 }}
        className="h-1.5 w-1.5 bg-neon-pink"
      />
      <motion.span
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
        className="h-1.5 w-1.5 bg-neon-yellow"
      />
      <motion.span
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
        className="h-1.5 w-1.5 bg-neon-green"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main BoardCompanion Component
// ─────────────────────────────────────────────────────────────────────────────

export function BoardCompanion({ open, onToggle, messages, onSend, streaming }: BoardCompanionProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streaming]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  const handleSend = () => {
    if (!input.trim() || streaming) return;
    onSend(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      onToggle();
    }
  };

  const mood = streaming ? 'thinking' : open ? 'happy' : 'idle';

  return (
    <>
      {/* Toggle button — always visible at bottom-right */}
      <motion.button
        onClick={onToggle}
        className={cn(
          'fixed bottom-5 right-5 z-[65] flex items-center gap-2',
          'sticker-sm sticker-press rounded-full px-3 py-2',
          'font-display text-sm [text-transform:lowercase]',
          'bg-card hover:border-foreground/40 transition-colors'
        )}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="Toggle companion (B)"
      >
        <CompanionSprite mood={open ? 'happy' : 'idle'} />
        <span className="hidden sm:inline text-foreground">
          {open ? 'hide' : 'companion'}
        </span>
      </motion.button>

      {/* Sliding panel from bottom */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop — subtle click-away */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onToggle}
              className="fixed inset-0 z-[63]"
              style={{ backgroundColor: 'var(--overlay-bg)' }}
            />

            {/* The companion panel */}
            <motion.div
              initial={{ y: '100%', opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: '100%', opacity: 0, scale: 0.95 }}
              transition={{
                type: 'spring',
                damping: 28,
                stiffness: 350,
                mass: 0.8,
              }}
              className="panel-neon panel-neon-glow fixed bottom-0 left-0 right-0 z-[64] flex flex-col overflow-hidden rounded-t-[1.75rem] bg-card shadow-2xl"
              style={{
                '--panel': 'var(--color-neon-purple)',
                maxHeight: '65vh',
              } as React.CSSProperties}
            >
              {/* Header with character */}
              <div className="flex shrink-0 items-center gap-3 border-b-2 border-border px-4 py-3">
                <CompanionSprite mood={mood} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-display text-sm [text-transform:lowercase]">
                    board companion
                  </h3>
                  <p className="font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
                    {streaming ? 'thinking...' : 'ready to help'}
                  </p>
                </div>
                <button
                  onClick={onToggle}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card font-pixel text-sm text-foreground/80 hover:border-destructive hover:text-destructive transition-colors"
                  title="Close companion (Esc)"
                  aria-label="Close companion"
                >
                  ✕
                </button>
              </div>

              {/* Messages area */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      'flex',
                      msg.role === 'user' ? 'justify-end' : 'justify-start'
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] rounded-xl px-3 py-2 font-pixel text-[11px] leading-relaxed',
                        msg.role === 'user'
                          ? 'bg-neon-pink/15 text-foreground border-2 border-neon-pink/30'
                          : 'bg-card border-2 border-border text-foreground'
                      )}
                    >
                      {msg.role === 'companion' && (
                        <span className="mb-1 block text-[10px] text-neon-purple [text-transform:lowercase]">
                          companion
                        </span>
                      )}
                      <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                    </div>
                  </motion.div>
                ))}

                {/* Streaming indicator */}
                {streaming && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex justify-start"
                  >
                    <div className="rounded-xl border-2 border-border bg-card px-3 py-2">
                      <TypingIndicator />
                    </div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="shrink-0 border-t-2 border-border bg-card/60 px-3 py-3 rounded-t-[1.75rem]">
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={streaming ? 'companion is thinking...' : 'ask me anything...'}
                    disabled={streaming}
                    className="h-10 flex-1 rounded-xl border-2 border-border bg-background px-3 font-pixel text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:border-neon-purple focus:outline-none transition-colors disabled:opacity-50 [text-transform:lowercase]"
                  />
                  <button
                    onClick={handleSend}
                    disabled={streaming || !input.trim()}
                    className="sticker-sm sticker-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neon-purple text-ink disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Send message"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M2 14L14 8L2 2V6.5L10 8L2 9.5V14Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </div>
                <p className="mt-1.5 font-pixel text-[9px] text-muted-foreground/40 [text-transform:lowercase]">
                  powered by opencode · press enter to send
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
