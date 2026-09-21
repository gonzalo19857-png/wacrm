'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Calendar, Link2, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function StudioOverviewPage() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/studio/meta/connection');
        const data = await res.json().catch(() => ({}));
        setConnected(res.ok ? !!data.connection : false);
      } catch {
        setConnected(false);
      }
    })();
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          GMVA Studio
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Tu equipo de marketing: calendario de contenido y publicación
        automática en Facebook e Instagram.
      </p>

      <Card className="mt-8 flex flex-col items-center justify-center gap-3 p-10 text-center">
        {connected === false ? (
          <>
            <Link2 className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Conecta Facebook e Instagram para empezar
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Necesitas conectar tu Página de Facebook antes de generar y
              publicar el calendario de contenido.
            </p>
            <Button size="sm" nativeButton={false} render={<Link href="/studio/settings" />}>
              Ir a Conexiones <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </>
        ) : connected === true ? (
          <>
            <Calendar className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Listo — genera el calendario de este mes
            </p>
            <Button size="sm" nativeButton={false} render={<Link href="/studio/calendar" />}>
              Ir al Calendario <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        )}
      </Card>
    </div>
  );
}
