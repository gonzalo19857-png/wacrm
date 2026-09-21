'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AtSign, Link2, Loader2, Megaphone, Share2, Unlink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

interface Connection {
  page_id: string;
  page_name: string;
  instagram_username: string | null;
  connected_at: string;
  ad_account_id: string | null;
  ad_account_name: string | null;
  ad_account_currency: string | null;
}

export function MetaConnection() {
  const { accountRole } = useAuth();
  const canManage = accountRole ? canEditSettings(accountRole) : false;
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = async () => {
    try {
      const res = await fetch('/api/studio/meta/connection');
      const data = await res.json().catch(() => ({}));
      setConnection(res.ok ? (data.connection ?? null) : null);
    } catch {
      setConnection(null);
    }
  };

  useEffect(() => {
    void load();

    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === '1') {
      toast.success('Facebook conectado correctamente.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    const metaError = params.get('meta_error');
    if (metaError) {
      toast.error(`No se pudo conectar con Meta (${metaError}).`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/studio/meta/connection', { method: 'DELETE' });
      if (!res.ok) {
        toast.error('No se pudo desconectar.');
        return;
      }
      setConnection(null);
      toast.success('Desconectado.');
    } finally {
      setDisconnecting(false);
    }
  };

  if (connection === undefined) {
    return <div className="text-sm text-muted-foreground">Cargando…</div>;
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Conexión con Meta</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Conecta tu Página de Facebook (y su cuenta de Instagram vinculada) para
        publicar automáticamente el contenido que apruebes.
      </p>

      {connection ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <Share2 className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm text-foreground">{connection.page_name}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <AtSign className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm text-foreground">
              {connection.instagram_username
                ? `@${connection.instagram_username}`
                : 'Sin Instagram vinculado'}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <Megaphone className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm text-foreground">
              {connection.ad_account_id
                ? `${connection.ad_account_name} (${connection.ad_account_currency})`
                : 'Sin cuenta publicitaria — reconecta con permiso de anuncios'}
            </span>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={disconnect}
              disabled={disconnecting}
              className="text-destructive"
            >
              {disconnecting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unlink className="mr-1.5 h-3.5 w-3.5" />
              )}
              Desconectar
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Desconectar solo elimina la conexión aquí — para revocar el permiso
            del todo, hazlo desde la configuración de tu app en Facebook.
          </p>
        </div>
      ) : canManage ? (
        <Button
          size="sm"
          className="mt-4"
          nativeButton={false}
          render={<a href="/api/studio/meta/oauth/start" />}
        >
          <Share2 className="mr-1.5 h-3.5 w-3.5" />
          Conectar Facebook
        </Button>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Pide a un administrador que conecte Facebook e Instagram.
        </p>
      )}
    </Card>
  );
}
