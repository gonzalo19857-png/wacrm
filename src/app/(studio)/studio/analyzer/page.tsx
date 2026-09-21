'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import {
  ArrowRight,
  BarChart3,
  Link2,
  Loader2,
  MousePointerClick,
  Radio,
  Send,
  Wallet,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getBroadcastStatus } from '@/lib/broadcast-status';

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
        <h2 className="text-sm font-semibold text-foreground">WhatsApp (Broadcasts)</h2>
        <WhatsAppSection />
      </section>
    </div>
  );
}
