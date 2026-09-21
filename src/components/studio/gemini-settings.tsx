'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

export function GeminiSettings() {
  const { accountRole } = useAuth();
  const canManage = accountRole ? canEditSettings(accountRole) : false;
  const [hasKey, setHasKey] = useState<boolean | undefined>(undefined);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = async () => {
    try {
      const res = await fetch('/api/studio/settings/gemini');
      const data = await res.json().catch(() => ({}));
      setHasKey(res.ok ? !!data.hasKey : false);
    } catch {
      setHasKey(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/studio/settings/gemini', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (!res.ok) {
        toast.error('No se pudo guardar la clave.');
        return;
      }
      setApiKey('');
      toast.success('Clave de Gemini guardada.');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/studio/settings/gemini', { method: 'DELETE' });
      if (!res.ok) {
        toast.error('No se pudo eliminar la clave.');
        return;
      }
      setHasKey(false);
      toast.success('Clave eliminada.');
    } finally {
      setRemoving(false);
    }
  };

  if (hasKey === undefined) {
    return <div className="text-sm text-muted-foreground">Cargando…</div>;
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <ImagePlus className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Generación de imágenes (IA)</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Conecta tu propia clave de OpenRouter (con acceso al modelo de imagen de
        Gemini &ldquo;Nano Banana Pro&rdquo;) para generar fotos directamente en el selector
        de medios del calendario, además de tu catálogo y tus subidas.
      </p>

      {hasKey ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <Check className="h-4 w-4 shrink-0 text-emerald-500" />
            <span className="text-sm text-foreground">Clave configurada</span>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={remove}
              disabled={removing}
              className="text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Quitar clave
            </Button>
          )}
        </div>
      ) : canManage ? (
        <div className="mt-4 flex gap-2">
          <Input
            type="password"
            placeholder="Pega tu API key de OpenRouter"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="flex-1"
          />
          <Button size="sm" onClick={save} disabled={saving || !apiKey.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Pide a un administrador que conecte una clave de Gemini.
        </p>
      )}
    </Card>
  );
}
