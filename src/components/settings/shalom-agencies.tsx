'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MapPin, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';

interface Agency {
  id: string;
  city: string;
  name: string;
  address: string;
  reference: string | null;
  is_active: boolean;
}

interface ShalomAgenciesCardProps {
  canEdit: boolean;
}

/**
 * The Shalom agency directory the AI auto-reply bot reads from
 * (migration 052) to list real pickup options to a Provincia customer
 * — entered here once, instead of an agent screenshotting Shalom's
 * own locator for every order. Deliberately admin-managed data, never
 * something the model infers on its own.
 */
export function ShalomAgenciesCard({ canEdit }: ShalomAgenciesCardProps) {
  const t = useTranslations('Settings.shalomAgencies');
  const disabled = !canEdit;

  const [loading, setLoading] = useState(true);
  const [agencies, setAgencies] = useState<Agency[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/shalom-agencies');
      const data = await res.json();
      setAgencies(data.agencies ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [newCity, setNewCity] = useState('');
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newReference, setNewReference] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!newCity.trim() || !newName.trim() || !newAddress.trim()) {
      toast.error(t('createMissingFields'));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/settings/shalom-agencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: newCity.trim(),
          name: newName.trim(),
          address: newAddress.trim(),
          reference: newReference.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('createFailed'));
        return;
      }
      toast.success(t('createSuccess'));
      setNewCity('');
      setNewName('');
      setNewAddress('');
      setNewReference('');
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(agency: Agency) {
    const next = !agency.is_active;
    setAgencies((prev) => prev.map((a) => (a.id === agency.id ? { ...a, is_active: next } : a)));
    const res = await fetch(`/api/settings/shalom-agencies/${agency.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      setAgencies((prev) => prev.map((a) => (a.id === agency.id ? { ...a, is_active: !next } : a)));
      toast.error(t('updateFailed'));
    }
  }

  async function handleDelete(agency: Agency) {
    if (!window.confirm(t('deleteConfirm', { name: agency.name }))) return;
    const res = await fetch(`/api/settings/shalom-agencies/${agency.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error(t('deleteFailed'));
      return;
    }
    setAgencies((prev) => prev.filter((a) => a.id !== agency.id));
    toast.success(t('deleteSuccess'));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {agencies.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            )}

            {agencies.map((agency) => (
              <div
                key={agency.id}
                className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-medium text-foreground">
                    {agency.city} — {agency.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{agency.address}</p>
                  {agency.reference && (
                    <p className="truncate text-xs text-muted-foreground">{agency.reference}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={agency.is_active}
                    onCheckedChange={() => handleToggleActive(agency)}
                    disabled={disabled}
                  />
                  {disabled ? null : (
                    <button
                      type="button"
                      onClick={() => handleDelete(agency)}
                      aria-label={t('deleteAria')}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {canEdit && (
              <div className="space-y-3 rounded-md border border-dashed border-border p-3">
                <p className="text-sm font-medium text-foreground">{t('addTitle')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{t('city')}</Label>
                    <Input
                      value={newCity}
                      onChange={(e) => setNewCity(e.target.value)}
                      placeholder={t('cityPlaceholder')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('name')}</Label>
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder={t('namePlaceholder')}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>{t('address')}</Label>
                    <Input
                      value={newAddress}
                      onChange={(e) => setNewAddress(e.target.value)}
                      placeholder={t('addressPlaceholder')}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>{t('reference')}</Label>
                    <Input
                      value={newReference}
                      onChange={(e) => setNewReference(e.target.value)}
                      placeholder={t('referencePlaceholder')}
                    />
                  </div>
                </div>
                <Button type="button" onClick={handleCreate} disabled={creating}>
                  {creating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {t('add')}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
