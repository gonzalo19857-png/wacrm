'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Send, Trash2, Eye, EyeOff, Plus } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';

type EventKey = 'needs_human' | 'new_sale' | 'handoff_lima' | 'handoff_provincia';

const EVENT_KEYS: EventKey[] = ['needs_human', 'new_sale', 'handoff_lima', 'handoff_provincia'];

interface Destination {
  id: string;
  label: string;
  chat_id: string;
  event_key: EventKey;
  is_active: boolean;
}

interface DestinationsCardProps {
  canEdit: boolean;
}

/**
 * Multiple Telegram bots per account (migration 049), each subscribed
 * to one event — a generic "needs a human" bot, a separate one just
 * for orders shipping to Lima, another for Provincia, and one for new
 * sales. Replaces the single bot-token/chat-id pair this card used to
 * hold on `ai_configs` (migrations 043 + 047).
 */
export function TelegramDestinationsCard({ canEdit }: DestinationsCardProps) {
  const t = useTranslations('Settings.telegramDestinations');
  const disabled = !canEdit;

  const [loading, setLoading] = useState(true);
  const [destinations, setDestinations] = useState<Destination[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/telegram-destinations');
      const data = await res.json();
      setDestinations(data.destinations ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ---- New destination form ----
  const [newLabel, setNewLabel] = useState('');
  const [newToken, setNewToken] = useState('');
  const [showNewToken, setShowNewToken] = useState(false);
  const [newChatId, setNewChatId] = useState('');
  const [newEvent, setNewEvent] = useState<EventKey>('needs_human');
  const [creating, setCreating] = useState(false);
  const [testingNew, setTestingNew] = useState(false);

  async function handleTest(args: { destinationId?: string; botToken?: string; chatId?: string }) {
    const res = await fetch('/api/telegram/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination_id: args.destinationId,
        bot_token: args.botToken,
        chat_id: args.chatId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) toast.success(t('testSuccess'));
    else toast.error(data.error ?? t('testFailed'));
  }

  async function handleTestNew() {
    if (!newToken.trim() || !newChatId.trim()) {
      toast.error(t('testMissingFields'));
      return;
    }
    setTestingNew(true);
    try {
      await handleTest({ botToken: newToken.trim(), chatId: newChatId.trim() });
    } finally {
      setTestingNew(false);
    }
  }

  async function handleCreate() {
    if (!newLabel.trim() || !newToken.trim() || !newChatId.trim()) {
      toast.error(t('createMissingFields'));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/settings/telegram-destinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newLabel.trim(),
          bot_token: newToken.trim(),
          chat_id: newChatId.trim(),
          event_key: newEvent,
          is_active: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('createFailed'));
        return;
      }
      toast.success(t('createSuccess'));
      setNewLabel('');
      setNewToken('');
      setNewChatId('');
      setNewEvent('needs_human');
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(dest: Destination) {
    const next = !dest.is_active;
    setDestinations((prev) => prev.map((d) => (d.id === dest.id ? { ...d, is_active: next } : d)));
    const res = await fetch(`/api/settings/telegram-destinations/${dest.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      setDestinations((prev) => prev.map((d) => (d.id === dest.id ? { ...d, is_active: !next } : d)));
      toast.error(t('updateFailed'));
    }
  }

  async function handleChangeEvent(dest: Destination, eventKey: EventKey) {
    const prevEvent = dest.event_key;
    setDestinations((prev) => prev.map((d) => (d.id === dest.id ? { ...d, event_key: eventKey } : d)));
    const res = await fetch(`/api/settings/telegram-destinations/${dest.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_key: eventKey }),
    });
    if (!res.ok) {
      setDestinations((prev) => prev.map((d) => (d.id === dest.id ? { ...d, event_key: prevEvent } : d)));
      toast.error(t('updateFailed'));
    }
  }

  async function handleDelete(dest: Destination) {
    if (!window.confirm(t('deleteConfirm', { label: dest.label }))) return;
    const res = await fetch(`/api/settings/telegram-destinations/${dest.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error(t('deleteFailed'));
      return;
    }
    setDestinations((prev) => prev.filter((d) => d.id !== dest.id));
    toast.success(t('deleteSuccess'));
  }

  const eventLabel = (key: EventKey) => t(`event.${key}`);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="h-4 w-4 text-primary" /> {t('title')}
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
            {destinations.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            )}

            {destinations.map((dest) => (
              <div
                key={dest.id}
                className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium text-foreground">{dest.label}</p>
                  <p className="truncate text-xs text-muted-foreground">chat_id: {dest.chat_id}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={dest.event_key}
                    onValueChange={(v) => handleChangeEvent(dest, v as EventKey)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-8 w-[180px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVENT_KEYS.map((key) => (
                        <SelectItem key={key} value={key}>
                          {eventLabel(key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Switch
                    checked={dest.is_active}
                    onCheckedChange={() => handleToggleActive(dest)}
                    disabled={disabled}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest({ destinationId: dest.id })}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                  {disabled ? null : (
                    <button
                      type="button"
                      onClick={() => handleDelete(dest)}
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
                    <Label>{t('label')}</Label>
                    <Input
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder={t('labelPlaceholder')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('eventLabel')}</Label>
                    <Select value={newEvent} onValueChange={(v) => setNewEvent(v as EventKey)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVENT_KEYS.map((key) => (
                          <SelectItem key={key} value={key}>
                            {eventLabel(key)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('botToken')}</Label>
                    <div className="relative">
                      <Input
                        type={showNewToken ? 'text' : 'password'}
                        value={newToken}
                        onChange={(e) => setNewToken(e.target.value)}
                        placeholder={t('botTokenPlaceholder')}
                        autoComplete="off"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewToken((s) => !s)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                      >
                        {showNewToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('chatId')}</Label>
                    <Input
                      value={newChatId}
                      onChange={(e) => setNewChatId(e.target.value)}
                      placeholder={t('chatIdPlaceholder')}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={handleCreate} disabled={creating}>
                    {creating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    {t('add')}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleTestNew} disabled={testingNew}>
                    {testingNew ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    {t('test')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
