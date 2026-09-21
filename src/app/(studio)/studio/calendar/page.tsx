'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Calendar as CalendarIcon,
  Loader2,
  Send,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { CalendarGrid, type StudioPost } from '@/components/studio/calendar-grid';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function StudioCalendarPage() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const [monthInput, setMonthInput] = useState(currentMonthValue());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [posts, setPosts] = useState<StudioPost[] | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  const loadForMonth = async (month: string) => {
    if (!accountId) return;
    const monthDate = `${month}-01`;
    const { data: campaign } = await supabase
      .from('studio_campaigns')
      .select('id')
      .eq('account_id', accountId)
      .eq('month', monthDate)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!campaign) {
      setCampaignId(null);
      setPosts([]);
      return;
    }
    setCampaignId(campaign.id);
    const { data: postRows } = await supabase
      .from('studio_posts')
      .select('*')
      .eq('campaign_id', campaign.id)
      .order('scheduled_date', { ascending: true });
    setPosts(postRows ?? []);
  };

  useEffect(() => {
    void loadForMonth(monthInput);
    setTurns([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, monthInput]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/studio/calendar/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: `${monthInput}-01`, messages: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error('No hay agente de IA configurado — ve a AI Agents → Setup.');
        } else {
          toast.error(data.error ?? 'No se pudo contactar al planificador.');
        }
        setTurns(turns);
        setInput(text);
        return;
      }
      setTurns([...next, { role: 'assistant', content: data.reply ?? '' }]);
    } catch {
      toast.error('No se pudo contactar al planificador.');
      setTurns(turns);
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

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/studio/calendar/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: `${monthInput}-01`, messages: turns }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error('No hay agente de IA configurado — ve a AI Agents → Setup.');
        } else {
          toast.error(data.error ?? 'No se pudo generar el calendario.');
        }
        return;
      }
      toast.success(`Se propusieron ${data.posts?.length ?? 0} publicaciones.`);
      await loadForMonth(monthInput);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <CalendarIcon className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Calendario
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Habla con el planificador sobre el mes y, cuando estés listo, genera la grilla.
      </p>

      <div className="mt-4 max-w-[220px]">
        <label className="text-xs font-medium text-muted-foreground">Mes</label>
        <Input
          type="month"
          value={monthInput}
          onChange={(e) => setMonthInput(e.target.value)}
          className="mt-1"
        />
      </div>

      <Card className="mt-4 flex h-[420px] flex-col p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium text-foreground">Planificador de Calendario</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTurns([])}
              disabled={turns.length === 0 || sending}
              className="text-muted-foreground"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reiniciar
            </Button>
            <Button size="sm" onClick={generate} disabled={generating}>
              {generating ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              Generar calendario
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {turns.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <p>Cuéntale al planificador qué quieres este mes.</p>
              <p className="mt-1 text-xs">
                Cadencia, promos, productos a destacar… y cuando estés listo, aprieta
                &ldquo;Generar calendario&rdquo;.
              </p>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  t.role === 'user'
                    ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground'
                    : 'max-w-[80%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-foreground'
                }
              >
                <p className="whitespace-pre-wrap">{t.content}</p>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Pensando…
            </div>
          )}
        </div>

        <div className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escríbele al planificador…"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
          />
          <Button size="sm" onClick={send} disabled={!input.trim() || sending} className="h-9 w-9 shrink-0 p-0">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </Card>

      <div className="mt-6">
        {posts === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay calendario para este mes — genera uno arriba.
          </p>
        ) : (
          <CalendarGrid posts={posts} onChanged={() => campaignId && loadForMonth(monthInput)} />
        )}
      </div>
    </div>
  );
}
