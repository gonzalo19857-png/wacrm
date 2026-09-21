'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Link2, Megaphone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AdCreator } from '@/components/studio/ad-creator';

interface Connection {
  ad_account_id: string | null;
  ad_account_name: string | null;
  ad_account_currency: string | null;
}

export default function StudioAdsPage() {
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);

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

  return (
    <div>
      <div className="flex items-center gap-2">
        <Megaphone className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Anuncios</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Crea anuncios de tráfico en Facebook e Instagram directamente desde tu cuenta publicitaria
        de Meta.
      </p>

      <div className="mt-6">
        {connection === undefined ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : !connection?.ad_account_id ? (
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
        ) : (
          <AdCreator currency={connection.ad_account_currency ?? 'USD'} />
        )}
      </div>
    </div>
  );
}
