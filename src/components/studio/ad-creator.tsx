'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Megaphone,
  Pause,
  Play,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MediaPicker } from '@/components/studio/media-picker';

interface StudioAd {
  id: string;
  name: string;
  daily_budget: number;
  currency: string;
  country: string;
  age_min: number;
  age_max: number;
  gender: 'all' | 'male' | 'female';
  message: string;
  headline: string;
  link_url: string;
  image_url: string;
  call_to_action: string;
  destination_type: 'link' | 'whatsapp';
  status: 'paused' | 'active' | 'error';
  error_detail: string | null;
  created_at: string;
}

const CTA_OPTIONS: { value: string; label: string }[] = [
  { value: 'LEARN_MORE', label: 'Más información' },
  { value: 'SHOP_NOW', label: 'Comprar ahora' },
  { value: 'SIGN_UP', label: 'Regístrate' },
  { value: 'CONTACT_US', label: 'Contáctanos' },
  { value: 'GET_QUOTE', label: 'Cotizar' },
  { value: 'SEND_MESSAGE', label: 'Enviar mensaje' },
];

const STATUS_LABEL: Record<StudioAd['status'], string> = {
  paused: 'Pausado',
  active: 'Activo',
  error: 'Error',
};

function emptyForm() {
  return {
    destinationType: 'link' as 'link' | 'whatsapp',
    name: '',
    dailyBudget: '',
    country: 'PE',
    ageMin: '18',
    ageMax: '65',
    gender: 'all' as 'all' | 'male' | 'female',
    message: '',
    headline: '',
    linkUrl: '',
    imageUrl: '',
    callToAction: 'LEARN_MORE',
  };
}

export function AdCreator({ currency }: { currency: string }) {
  const [ads, setAds] = useState<StudioAd[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [creating, setCreating] = useState(false);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);

  const loadAds = async () => {
    try {
      const res = await fetch('/api/studio/ads');
      const data = await res.json().catch(() => ({}));
      setAds(res.ok && Array.isArray(data.ads) ? data.ads : []);
    } catch {
      setAds([]);
    }
  };

  useEffect(() => {
    void loadAds();
  }, []);

  const resetForm = () => setForm(emptyForm());

  const create = async () => {
    const dailyBudget = Number(form.dailyBudget);
    const ageMin = Number(form.ageMin);
    const ageMax = Number(form.ageMax);
    if (!form.name.trim()) return toast.error('Ponle un nombre al anuncio.');
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) return toast.error('El presupuesto diario debe ser un número mayor a 0.');
    if (!/^[A-Za-z]{2}$/.test(form.country)) return toast.error('El país debe ser un código de 2 letras (ej. PE, US).');
    if (!Number.isFinite(ageMin) || !Number.isFinite(ageMax) || ageMin < 13 || ageMax > 65 || ageMin > ageMax) {
      return toast.error('El rango de edad debe estar entre 13 y 65.');
    }
    if (!form.message.trim()) return toast.error('Escribe el texto principal del anuncio.');
    if (!form.headline.trim()) return toast.error('Escribe un titular.');
    if (form.destinationType === 'link' && !form.linkUrl.trim()) {
      return toast.error('Indica el link de destino.');
    }
    if (!form.imageUrl) return toast.error('Elige una imagen para el anuncio.');

    setCreating(true);
    try {
      const res = await fetch('/api/studio/ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinationType: form.destinationType,
          name: form.name.trim(),
          dailyBudget,
          country: form.country.toUpperCase(),
          ageMin,
          ageMax,
          gender: form.gender,
          message: form.message.trim(),
          headline: form.headline.trim(),
          linkUrl: form.destinationType === 'link' ? form.linkUrl.trim() : undefined,
          imageUrl: form.imageUrl,
          callToAction: form.destinationType === 'link' ? form.callToAction : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo crear el anuncio.');
        return;
      }
      toast.success('Anuncio creado y pausado en Meta. Actívalo cuando estés listo.');
      setOpen(false);
      resetForm();
      await loadAds();
    } finally {
      setCreating(false);
    }
  };

  const changeStatus = async (ad: StudioAd, action: 'activate' | 'pause') => {
    if (action === 'activate') {
      const confirmed = window.confirm(
        `Vas a ACTIVAR "${ad.name}" con un presupuesto diario de ${ad.currency} ${ad.daily_budget.toFixed(2)}. ` +
          'Desde este momento Meta empezará a cobrar por este anuncio. ¿Continuar?',
      );
      if (!confirmed) return;
    }
    setStatusChangingId(ad.id);
    try {
      const res = await fetch(`/api/studio/ads/${ad.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo actualizar el anuncio.');
        return;
      }
      toast.success(action === 'activate' ? 'Anuncio activado.' : 'Anuncio pausado.');
      await loadAds();
    } finally {
      setStatusChangingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Cada anuncio se crea <strong>pausado</strong> en tu cuenta publicitaria de Meta — no
          gasta nada hasta que lo actives aquí o en Ads Manager.
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Nuevo anuncio
        </Button>
      </div>

      {ads === null ? (
        <div className="text-sm text-muted-foreground">Cargando…</div>
      ) : ads.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 p-10 text-center">
          <Megaphone className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Todavía no has creado anuncios</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Crea tu primer anuncio de tráfico — perfecto para llevar gente a tu link de WhatsApp
            o a tu catálogo.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ads.map((ad) => (
            <Card key={ad.id} className="flex flex-col gap-3 p-4">
              <div className="flex gap-3">
                <img
                  src={ad.image_url}
                  alt={ad.name}
                  className="h-16 w-16 shrink-0 rounded-lg border border-border object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{ad.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{ad.headline}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Badge
                      variant={ad.status === 'active' ? 'default' : ad.status === 'error' ? 'destructive' : 'secondary'}
                    >
                      {STATUS_LABEL[ad.status]}
                    </Badge>
                    {ad.destination_type === 'whatsapp' && <Badge variant="outline">WhatsApp</Badge>}
                  </div>
                </div>
              </div>

              <p className="line-clamp-2 text-xs text-muted-foreground">{ad.message}</p>

              <div className="text-xs text-muted-foreground">
                {ad.currency} {ad.daily_budget.toFixed(2)}/día · {ad.country} · {ad.age_min}-{ad.age_max}
              </div>

              {ad.status === 'error' && ad.error_detail && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {ad.error_detail}
                </p>
              )}

              <div className="mt-auto flex justify-end">
                {ad.status === 'active' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={statusChangingId === ad.id}
                    onClick={() => changeStatus(ad, 'pause')}
                  >
                    {statusChangingId === ad.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Pause className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Pausar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={statusChangingId === ad.id}
                    onClick={() => changeStatus(ad, 'activate')}
                  >
                    {statusChangingId === ad.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Activar
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo anuncio</DialogTitle>
            <DialogDescription>
              Anuncio de tráfico (clics al link que elijas) en Facebook e Instagram. Se crea
              pausado — revísalo antes de activarlo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tipo de anuncio</Label>
              <Select
                value={form.destinationType}
                onValueChange={(v) => setForm((f) => ({ ...f, destinationType: v as typeof f.destinationType }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="link">Tráfico (link)</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp (conversación)</SelectItem>
                </SelectContent>
              </Select>
              {form.destinationType === 'whatsapp' && (
                <p className="text-xs text-muted-foreground">
                  El botón &ldquo;Enviar WhatsApp&rdquo; abre un chat con el número conectado a tu
                  Página — no hace falta indicar un link.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ad-name">Nombre interno</Label>
              <Input
                id="ad-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ej. Promo de septiembre"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ad-budget">Presupuesto diario ({currency})</Label>
                <Input
                  id="ad-budget"
                  type="number"
                  min="1"
                  step="0.01"
                  value={form.dailyBudget}
                  onChange={(e) => setForm((f) => ({ ...f, dailyBudget: e.target.value }))}
                  placeholder="10.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ad-country">País (ISO-2)</Label>
                <Input
                  id="ad-country"
                  value={form.country}
                  onChange={(e) => setForm((f) => ({ ...f, country: e.target.value.toUpperCase().slice(0, 2) }))}
                  placeholder="PE"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ad-age-min">Edad mín.</Label>
                <Input
                  id="ad-age-min"
                  type="number"
                  min="13"
                  max="65"
                  value={form.ageMin}
                  onChange={(e) => setForm((f) => ({ ...f, ageMin: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ad-age-max">Edad máx.</Label>
                <Input
                  id="ad-age-max"
                  type="number"
                  min="13"
                  max="65"
                  value={form.ageMax}
                  onChange={(e) => setForm((f) => ({ ...f, ageMax: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Género</Label>
                <Select value={form.gender} onValueChange={(v) => setForm((f) => ({ ...f, gender: v as typeof f.gender }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="male">Hombres</SelectItem>
                    <SelectItem value="female">Mujeres</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Imagen</Label>
              {form.imageUrl ? (
                <div className="flex items-center gap-3">
                  <img src={form.imageUrl} alt="Anuncio" className="h-16 w-16 rounded-lg border border-border object-cover" />
                  <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                    Cambiar
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                  Elegir imagen
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ad-headline">Titular</Label>
              <Input
                id="ad-headline"
                value={form.headline}
                onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
                placeholder="Ej. Envíos a todo el Perú"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ad-message">Texto principal</Label>
              <Textarea
                id="ad-message"
                rows={3}
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder="El texto que la gente ve en el anuncio…"
              />
            </div>

            {form.destinationType === 'link' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ad-link">Link de destino</Label>
                  <Input
                    id="ad-link"
                    value={form.linkUrl}
                    onChange={(e) => setForm((f) => ({ ...f, linkUrl: e.target.value }))}
                    placeholder="https://wa.me/51999999999"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Botón</Label>
                  <Select value={form.callToAction} onValueChange={(v) => setForm((f) => ({ ...f, callToAction: v as string }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CTA_OPTIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
              Cancelar
            </Button>
            <Button onClick={create} disabled={creating}>
              {creating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Crear anuncio (pausado)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(media) => setForm((f) => ({ ...f, imageUrl: media.url }))}
        defaultPrompt={form.headline || form.message}
      />
    </div>
  );
}
