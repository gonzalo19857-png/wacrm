'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import { toast } from 'sonner';
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  Link2,
  Loader2,
  MousePointerClick,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getBroadcastStatus } from '@/lib/broadcast-status';
import { MediaPicker } from '@/components/studio/media-picker';

const STATUS_LABELS_ES: Record<string, string> = {
  draft: 'borrador',
  scheduled: 'programado',
  sending: 'enviando',
  sent: 'enviado',
  failed: 'fallido',
};

interface Connection {
  ad_account_id: string | null;
  ad_account_name: string | null;
  ad_account_currency: string | null;
}

interface CampaignInsight {
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  local: { name: string; status: string; daily_budget: number; currency: string } | null;
}

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
        {icon}
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function MetaAdsSection() {
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);
  const [campaigns, setCampaigns] = useState<CampaignInsight[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/studio/meta/connection');
        const data = await res.json().catch(() => ({}));
        setConnection(res.ok ? (data.connection ?? null) : null);
      } catch {
        setConnection(null);
      }
    })();
  }, []);

  useEffect(() => {
    if (!connection?.ad_account_id) return;
    (async () => {
      try {
        const res = await fetch('/api/studio/ads/insights');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || 'No se pudo cargar el rendimiento de anuncios.');
          return;
        }
        setCampaigns(data.campaigns ?? []);
      } catch {
        setError('No se pudo cargar el rendimiento de anuncios.');
      }
    })();
  }, [connection?.ad_account_id]);

  if (connection === undefined) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  if (!connection?.ad_account_id) {
    return (
      <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
        <Link2 className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          Conecta una cuenta publicitaria de Meta
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Necesitas reconectar Facebook con permiso de anuncios (ads_management) y tener una
          cuenta publicitaria activa en Meta Business Suite.
        </p>
        <Button size="sm" nativeButton={false} render={<Link href="/studio/settings" />}>
          Ir a Conexiones <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </Card>
    );
  }

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  if (campaigns === null) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  const currency = connection.ad_account_currency ?? 'USD';
  const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
  const avgCtr = campaigns.length
    ? campaigns.reduce((sum, c) => sum + c.ctr, 0) / campaigns.length
    : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Gasto (30d)"
          value={`${totalSpend.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`}
          icon={<Wallet className="h-4 w-4" />}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          label="Clics (30d)"
          value={totalClicks.toLocaleString()}
          icon={<MousePointerClick className="h-4 w-4" />}
          color="bg-blue-500/10 text-blue-400"
        />
        <StatCard
          label="CTR promedio"
          value={`${avgCtr.toFixed(2)}%`}
          icon={<BarChart3 className="h-4 w-4" />}
          color="bg-teal-500/10 text-teal-400"
        />
      </div>

      {campaigns.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-border bg-card">
          <p className="text-sm text-muted-foreground">
            Sin campañas con actividad en los últimos 30 días.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Campaña</TableHead>
                <TableHead className="text-right text-muted-foreground">Gasto</TableHead>
                <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
                  Impresiones
                </TableHead>
                <TableHead className="text-right text-muted-foreground">Clics</TableHead>
                <TableHead className="hidden text-right text-muted-foreground md:table-cell">
                  CTR
                </TableHead>
                <TableHead className="hidden text-right text-muted-foreground md:table-cell">
                  CPC
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.campaignId} className="border-border">
                  <TableCell className="font-medium text-foreground">
                    {c.local?.name ?? c.campaignName}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {c.spend.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                    {c.impressions.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {c.clicks.toLocaleString()}
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
                    {c.ctr.toFixed(2)}%
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
                    {c.cpc.toFixed(2)} {currency}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultSince(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return toDateInput(d);
}

function defaultUntil(): string {
  return toDateInput(new Date());
}

interface DailySpendRow {
  date: string;
  spend: number;
  clicks: number;
}

function DailySpendSection() {
  const [since, setSince] = useState(defaultSince());
  const [until, setUntil] = useState(defaultUntil());
  const [days, setDays] = useState<DailySpendRow[] | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/studio/ads/daily-spend?since=${since}&until=${until}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'No se pudo cargar el gasto diario.');
        return;
      }
      setDays(data.days ?? []);
      setCurrency(data.currency ?? 'USD');
    } catch {
      setError('No se pudo cargar el gasto diario.');
    } finally {
      setLoading(false);
    }
  };

  const total = (days ?? []).reduce((sum, d) => sum + d.spend, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="daily-since" className="text-xs">Desde</Label>
          <Input id="daily-since" type="date" value={since} onChange={(e) => setSince(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="daily-until" className="text-xs">Hasta</Label>
          <Input id="daily-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-40" />
        </div>
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Actualizar
        </Button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {days === null ? (
        <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card text-center">
          <CalendarClock className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Elegí un rango y tocá &ldquo;Actualizar&rdquo; para traer el gasto real de Meta.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Fecha</TableHead>
                <TableHead className="text-right text-muted-foreground">Gasto</TableHead>
                <TableHead className="text-right text-muted-foreground">Clics</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((d) => (
                <TableRow key={d.date} className="border-border">
                  <TableCell className="text-foreground">{d.date}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {d.spend.toFixed(2)} {currency}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {d.clicks.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-border font-medium">
                <TableCell className="text-foreground">Total</TableCell>
                <TableCell className="text-right text-foreground tabular-nums">
                  {total.toFixed(2)} {currency}
                </TableCell>
                <TableCell className="text-right text-foreground tabular-nums">
                  {days.reduce((sum, d) => sum + d.clicks, 0).toLocaleString()}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function WhatsAppSection() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data, error: fetchError } = await supabase
          .from('broadcasts')
          .select('*')
          .order('created_at', { ascending: false });
        if (fetchError) throw fetchError;
        setBroadcasts(data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los broadcasts.');
      }
    })();
  }, []);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  if (broadcasts === null) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (broadcasts.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card">
        <Radio className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Todavía no enviaste ningún broadcast.</p>
      </div>
    );
  }

  const totalSent = broadcasts.reduce((sum, b) => sum + b.sent_count, 0);
  const avgDeliveryRate =
    broadcasts.reduce((sum, b) => sum + percent(b.delivered_count, b.total_recipients), 0) /
    broadcasts.length;
  const avgReplyRate =
    broadcasts.reduce((sum, b) => sum + percent(b.replied_count, b.total_recipients), 0) /
    broadcasts.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Mensajes enviados"
          value={totalSent.toLocaleString()}
          icon={<Send className="h-4 w-4" />}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          label="Tasa de entrega promedio"
          value={`${Math.round(avgDeliveryRate)}%`}
          icon={<BarChart3 className="h-4 w-4" />}
          color="bg-teal-500/10 text-teal-400"
        />
        <StatCard
          label="Tasa de respuesta promedio"
          value={`${Math.round(avgReplyRate)}%`}
          icon={<BarChart3 className="h-4 w-4" />}
          color="bg-indigo-500/10 text-indigo-400"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Campaña</TableHead>
              <TableHead className="text-right text-muted-foreground">Destinatarios</TableHead>
              <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
                Entregado
              </TableHead>
              <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
                Leído
              </TableHead>
              <TableHead className="hidden text-right text-muted-foreground md:table-cell">
                Respondido
              </TableHead>
              <TableHead className="text-muted-foreground">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {broadcasts.map((b) => {
              const status = getBroadcastStatus(b.status);
              return (
                <TableRow key={b.id} className="border-border">
                  <TableCell className="font-medium text-foreground">{b.name}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {b.total_recipients}
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                    {percent(b.delivered_count, b.total_recipients)}%
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                    {percent(b.read_count, b.total_recipients)}%
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
                    {percent(b.replied_count, b.total_recipients)}%
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
                    >
                      {STATUS_LABELS_ES[status.label] ?? status.label}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

interface CreatedCampaign {
  id: string;
  name: string;
  daily_budget: number;
  currency: string;
}

function AdvisorSection() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: CreatedCampaign[]; failed: { name: string; error: string }[] } | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/studio/ads/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error('No hay agente de IA configurado — ve a AI Agents → Setup.');
        } else {
          toast.error(data.error ?? 'No se pudo contactar al asesor.');
        }
        setTurns(turns);
        setInput(text);
        return;
      }
      setTurns([...next, { role: 'assistant', content: data.reply ?? '' }]);
    } catch {
      toast.error('No se pudo contactar al asesor.');
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
    if (!imageUrl) {
      setPickerOpen(true);
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch('/api/studio/ads/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: turns, imageUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error('No hay agente de IA configurado — ve a AI Agents → Setup.');
        } else if (data.code === 'ad_account_not_connected') {
          toast.error('No hay una cuenta publicitaria conectada.');
        } else {
          toast.error(data.error ?? 'No se pudieron crear las campañas.');
        }
        return;
      }
      setResult({ created: data.created ?? [], failed: data.failed ?? [] });
      toast.success(`Se crearon ${data.created?.length ?? 0} campañas (pausadas).`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="flex h-[420px] flex-col p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium text-foreground">Asesor de Anuncios</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTurns([]);
                setResult(null);
              }}
              disabled={turns.length === 0 || sending}
              className="text-muted-foreground"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reiniciar
            </Button>
            <Button size="sm" onClick={generate} disabled={generating || turns.length === 0}>
              {generating ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              {imageUrl ? 'Crear campañas' : 'Elegir imagen y crear'}
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {turns.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <p>Contale al asesor qué campañas querés armar.</p>
              <p className="mt-1 text-xs">
                Ve tu rendimiento real de Meta Ads y tu catálogo — te va a preguntar lo que
                falte, y cuando estés listo apretás &ldquo;Crear campañas&rdquo;.
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
            placeholder="Escribí acá…"
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <Button size="icon" onClick={send} disabled={sending || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {imageUrl && (
        <p className="text-xs text-muted-foreground">
          Imagen elegida para las campañas —{' '}
          <button className="underline" onClick={() => setPickerOpen(true)}>
            cambiar
          </button>
        </p>
      )}

      {result && (
        <Card className="p-4">
          <p className="text-sm font-medium text-foreground">
            {result.created.length} campañas creadas (pausadas)
          </p>
          {result.created.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {result.created.map((c) => (
                <li key={c.id}>
                  {c.name} — {c.currency} {Number(c.daily_budget).toFixed(2)}/día
                </li>
              ))}
            </ul>
          )}
          {result.failed.length > 0 && (
            <div className="mt-3 space-y-1 text-sm text-red-400">
              {result.failed.map((f, i) => (
                <p key={i}>
                  {f.name}: {f.error}
                </p>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            nativeButton={false}
            render={<Link href="/studio/ads" />}
          >
            Ir a Anuncios para activarlas <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </Card>
      )}

      <MediaPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={(media) => setImageUrl(media.url)} />
    </div>
  );
}

export default function StudioAnalyzerPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Analizador</h1>
      </div>
      <p className="-mt-6 text-sm text-muted-foreground">
        Rendimiento de tus anuncios de Meta y tus broadcasts de WhatsApp en un solo lugar.
      </p>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Anuncios (Meta Ads)</h2>
        <MetaAdsSection />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Gasto diario (Meta Ads)</h2>
        <p className="-mt-1 text-xs text-muted-foreground">
          Solo lectura — consultar esto no gasta presupuesto ni cuesta nada, se actualiza cuando
          vos lo pedís.
        </p>
        <DailySpendSection />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">WhatsApp (Broadcasts)</h2>
        <WhatsAppSection />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Asesor de Anuncios</h2>
        <AdvisorSection />
      </section>
    </div>
  );
}
