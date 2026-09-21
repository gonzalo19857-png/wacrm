'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Package, Sparkles, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface CatalogProduct {
  id: string;
  name: string;
  image_url: string | null;
}

export function MediaPicker({
  open,
  onOpenChange,
  onPick,
  defaultPrompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (media: {
    source: 'product' | 'upload' | 'generated';
    url: string;
    productId: string | null;
    prompt?: string;
  }) => void;
  /** Pre-fills the "Generar con IA" prompt — typically the post's idea/caption. */
  defaultPrompt?: string;
}) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [referenceCount, setReferenceCount] = useState(0);

  useEffect(() => {
    if (open) {
      setPrompt(defaultPrompt ?? '');
      setGeneratedUrl(null);
      setReferenceCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !accountId) return;
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, image_url')
        .eq('account_id', accountId)
        .eq('active', true)
        .not('image_url', 'is', null)
        .order('name', { ascending: true });
      setProducts(data ?? []);
    })();
  }, [open, accountId, supabase]);

  const handleUpload = async (file: File) => {
    if (!accountId) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${accountId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('studio-media')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;
      const {
        data: { publicUrl },
      } = supabase.storage.from('studio-media').getPublicUrl(path);
      onPick({ source: 'upload', url: publicUrl, productId: null });
      onOpenChange(false);
    } catch {
      toast.error('No se pudo subir la foto.');
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/studio/media/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'gemini_not_configured') {
          toast.error('Conecta tu clave de OpenRouter en Conexiones primero.');
        } else {
          toast.error(data.error ?? 'No se pudo generar la imagen.');
        }
        return;
      }
      setGeneratedUrl(data.url);
      setReferenceCount(data.referenceCount ?? 0);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Elegir foto</DialogTitle>
          <DialogDescription>
            Elige o sube una foto — la IA escribe el texto, no la foto.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="catalog">
          <TabsList>
            <TabsTrigger value="catalog">Del catálogo</TabsTrigger>
            <TabsTrigger value="upload">Subir foto</TabsTrigger>
            <TabsTrigger value="generate">Generar con IA</TabsTrigger>
          </TabsList>

          <TabsContent value="catalog" className="mt-3">
            {products.length === 0 ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Package className="h-4 w-4" /> No hay productos con foto en tu catálogo.
              </p>
            ) : (
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onPick({ source: 'product', url: p.image_url as string, productId: p.id });
                      onOpenChange(false);
                    }}
                    className="group flex flex-col gap-1 rounded-lg border border-border p-1.5 text-left hover:border-primary"
                  >
                    <img
                      src={p.image_url as string}
                      alt={p.name}
                      className="aspect-square w-full rounded-md object-cover"
                    />
                    <span className="truncate text-xs text-muted-foreground group-hover:text-foreground">
                      {p.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="upload" className="mt-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-3.5 w-3.5" />
              )}
              Elegir archivo
            </Button>
          </TabsContent>

          <TabsContent value="generate" className="mt-3 space-y-3">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe la foto que quieres generar…"
              rows={3}
              className="text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={generating || !prompt.trim()}
              onClick={handleGenerate}
            >
              {generating ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              Generar
            </Button>

            {generatedUrl && (
              <div className="space-y-2">
                <img
                  src={generatedUrl}
                  alt="Imagen generada"
                  className="aspect-square w-full max-w-[200px] rounded-lg border border-border object-cover"
                />
                {referenceCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Generada usando el estilo de {referenceCount} foto{referenceCount === 1 ? '' : 's'} que ya aprobaste.
                  </p>
                )}
                <Button
                  size="sm"
                  onClick={() => {
                    onPick({
                      source: 'generated',
                      url: generatedUrl,
                      productId: null,
                      prompt: prompt.trim(),
                    });
                    onOpenChange(false);
                  }}
                >
                  Usar esta imagen
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
