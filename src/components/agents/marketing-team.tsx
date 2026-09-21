'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  MessageSquareText,
  Megaphone,
  Camera,
  UserRoundCheck,
  Target,
  Send,
  Loader2,
  Copy,
  Check,
  RotateCcw,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { MarketingAgentId } from '@/lib/ai/marketing-agents';

const ICONS = {
  MessageSquareText,
  Megaphone,
  Camera,
  UserRoundCheck,
  Target,
} as const;

interface AgentMeta {
  id: MarketingAgentId;
  name: string;
  role: string;
  description: string;
  icon: keyof typeof ICONS;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export function MarketingTeam({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const [agents, setAgents] = useState<AgentMeta[] | null>(null);
  const [activeId, setActiveId] = useState<MarketingAgentId | null>(null);
  const [turnsByAgent, setTurnsByAgent] = useState<Record<string, Turn[]>>({});
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/ai/marketing-team');
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.agents)) {
          setAgents(data.agents);
          setActiveId(data.agents[0]?.id ?? null);
        } else {
          setAgents([]);
        }
      } catch {
        setAgents([]);
      }
    })();
  }, []);

  const turns = useMemo(
    () => (activeId ? (turnsByAgent[activeId] ?? []) : []),
    [activeId, turnsByAgent],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !activeId) return;

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurnsByAgent((prev) => ({ ...prev, [activeId]: next }));
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/ai/marketing-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: activeId,
          messages: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error('No hay agente configurado — completa Setup primero.');
        } else {
          toast.error(data.error ?? 'No se pudo generar la respuesta.');
        }
        setTurnsByAgent((prev) => ({ ...prev, [activeId]: turns }));
        setInput(text);
        return;
      }
      setTurnsByAgent((prev) => ({
        ...prev,
        [activeId]: [
          ...next,
          { role: 'assistant', content: typeof data.reply === 'string' ? data.reply : '' },
        ],
      }));
    } catch {
      toast.error('No se pudo contactar al agente.');
      setTurnsByAgent((prev) => ({ ...prev, [activeId]: turns }));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const copy = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((i) => (i === index ? null : i)), 1500);
    } catch {
      toast.error('No se pudo copiar.');
    }
  };

  if (agents === null) {
    return <div className="p-6 text-sm text-muted-foreground">Cargando equipo…</div>;
  }

  const active = agents.find((a) => a.id === activeId) ?? null;

  return (
    <div className="space-y-4">
      <Card className="flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-medium text-foreground">
            ¿Buscas calendario de contenido y publicación automática?
          </p>
          <p className="text-xs text-muted-foreground">
            Eso vive en GMVA Studio — su propia app, conectada a tu cuenta.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          nativeButton={false}
          render={<a href="/studio" />}
        >
          Abrir GMVA Studio <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* Roster */}
      <div className="space-y-2">
        {agents.map((a) => {
          const Icon = ICONS[a.icon];
          const isActive = a.id === activeId;
          return (
            <Card
              key={a.id}
              onClick={() => setActiveId(a.id)}
              className={cn(
                'cursor-pointer p-3 transition-colors hover:bg-muted/60',
                isActive && 'ring-2 ring-primary',
              )}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{a.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{a.role}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Chat */}
      <div className="flex h-[60vh] min-h-[420px] flex-col rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">{active?.name ?? 'Equipo de marketing'}</span>
            {active && <p className="truncate text-xs text-muted-foreground">{active.description}</p>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => activeId && setTurnsByAgent((prev) => ({ ...prev, [activeId]: [] }))}
            disabled={turns.length === 0 || sending}
            className="shrink-0 text-muted-foreground"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reiniciar
          </Button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {turns.length === 0 && active && (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <p>Pídele a {active.name.toLowerCase()} que redacte algo.</p>
              <p className="mt-1 text-xs">{active.description}</p>
              {onGoToSetup && (
                <Button variant="link" size="sm" onClick={onGoToSetup} className="mt-1 h-auto p-0 text-xs">
                  ¿Aún no configuras tu proveedor de IA? Ir a Setup <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i} className={cn('flex gap-2', t.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'group relative max-w-[85%] rounded-2xl px-3.5 py-2 text-sm',
                  t.role === 'user'
                    ? 'rounded-br-sm bg-primary text-primary-foreground'
                    : 'rounded-bl-sm bg-muted text-foreground',
                )}
              >
                <p className="whitespace-pre-wrap">{t.content}</p>
                {t.role === 'assistant' && t.content && (
                  <button
                    onClick={() => copy(t.content, i)}
                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
                    title="Copiar"
                  >
                    {copiedIndex === i ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Redactando…
            </div>
          )}
        </div>

        <div className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={active ? `Escríbele a ${active.name}…` : 'Selecciona un agente…'}
            rows={1}
            disabled={!active}
            className="flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
          />
          <Button size="sm" onClick={send} disabled={!input.trim() || sending || !active} className="h-9 w-9 shrink-0 p-0">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}
