'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Save,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MediaPicker } from '@/components/studio/media-picker';

export interface StudioPost {
  id: string;
  campaign_id: string;
  scheduled_date: string;
  scheduled_time: string;
  publish_at: string | null;
  platform: 'facebook' | 'instagram';
  format: 'photo' | 'text';
  idea: string;
  caption: string;
  hashtags: string[] | null;
  media_url: string | null;
  status: 'proposed' | 'approved' | 'publishing' | 'published' | 'failed' | 'skipped';
  error_detail: string | null;
}

const STATUS_LABEL: Record<StudioPost['status'], string> = {
  proposed: 'Por revisar',
  approved: 'Aprobado',
  publishing: 'Publicando…',
  published: 'Publicado',
  failed: 'Falló',
  skipped: 'Descartado',
};

const STATUS_CLASS: Record<StudioPost['status'], string> = {
  proposed: 'bg-muted text-muted-foreground',
  approved: 'bg-primary/10 text-primary',
  publishing: 'bg-amber-500/10 text-amber-500',
  published: 'bg-emerald-500/10 text-emerald-500',
  failed: 'bg-destructive/10 text-destructive',
  skipped: 'bg-muted text-muted-foreground line-through',
};

function localDateTimeToIso(date: string, time: string): string {
  // Interpreted in the browser's own local timezone — single-owner
  // tool, no server-side timezone config needed.
  return new Date(`${date}T${time}`).toISOString();
}

export function CalendarGrid({
  posts,
  onChanged,
}: {
  posts: StudioPost[];
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<StudioPost>>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pickerForId, setPickerForId] = useState<string | null>(null);

  const draftOf = (post: StudioPost): StudioPost => ({ ...post, ...drafts[post.id] });

  const setDraft = (id: string, patch: Partial<StudioPost>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const patch = async (id: string, fields: Record<string, unknown>) => {
    const res = await fetch(`/api/studio/posts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? 'No se pudo guardar.');
      return false;
    }
    return true;
  };

  // Persists a media pick immediately (not just local draft state) so
  // "Aprobar" works right after choosing a photo without requiring the
  // owner to also click into full edit mode first.
  const pickMedia = async (
    post: StudioPost,
    media: {
      source: 'product' | 'upload' | 'generated';
      url: string;
      productId: string | null;
      prompt?: string;
    },
  ) => {
    setDraft(post.id, { media_url: media.url });
    setBusyId(post.id);
    try {
      const ok = await patch(post.id, {
        media_url: media.url,
        media_source: media.source,
        product_id: media.productId,
        media_prompt: media.source === 'generated' ? (media.prompt ?? null) : null,
      });
      if (ok) onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const save = async (post: StudioPost) => {
    const draft = draftOf(post);
    setBusyId(post.id);
    try {
      const ok = await patch(post.id, {
        scheduled_date: draft.scheduled_date,
        scheduled_time: draft.scheduled_time,
        platform: draft.platform,
        format: draft.format,
        caption: draft.caption,
      });
      if (!ok) return;
      setEditingId(null);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[post.id];
        return next;
      });
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const approve = async (post: StudioPost) => {
    const draft = draftOf(post);
    setBusyId(post.id);
    try {
      const publishAt = localDateTimeToIso(draft.scheduled_date, draft.scheduled_time);
      const res = await fetch(`/api/studio/posts/${post.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishAt }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'No se pudo aprobar.');
        return;
      }
      toast.success('Aprobado.');
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (post: StudioPost) => {
    setBusyId(post.id);
    try {
      const res = await fetch(`/api/studio/posts/${post.id}/reject`, { method: 'POST' });
      if (!res.ok) {
        toast.error('No se pudo descartar.');
        return;
      }
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      {posts.map((post) => {
        const isEditing = editingId === post.id;
        const draft = draftOf(post);
        const busy = busyId === post.id;
        const canEdit = post.status === 'proposed';

        return (
          <div
            key={post.id}
            className="flex gap-3 rounded-xl border border-border bg-card p-3"
          >
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => canEdit && setPickerForId(post.id)}
              className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted disabled:cursor-default"
            >
              {draft.media_url ? (
                <img src={draft.media_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-5 w-5 text-muted-foreground" />
              )}
            </button>

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', STATUS_CLASS[post.status])}>
                  {STATUS_LABEL[post.status]}
                </span>
                <span className="text-xs text-muted-foreground">{post.idea}</span>
              </div>

              {isEditing ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Input
                      type="date"
                      value={draft.scheduled_date}
                      onChange={(e) => setDraft(post.id, { scheduled_date: e.target.value })}
                      className="h-8 w-36 text-xs"
                    />
                    <Input
                      type="time"
                      value={draft.scheduled_time?.slice(0, 5)}
                      onChange={(e) => setDraft(post.id, { scheduled_time: e.target.value })}
                      className="h-8 w-28 text-xs"
                    />
                    <Select
                      value={draft.platform}
                      onValueChange={(v) => setDraft(post.id, { platform: v as StudioPost['platform'] })}
                    >
                      <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="facebook">Facebook</SelectItem>
                        <SelectItem value="instagram">Instagram</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={draft.format}
                      onValueChange={(v) => setDraft(post.id, { format: v as StudioPost['format'] })}
                    >
                      <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="photo">Foto</SelectItem>
                        <SelectItem value="text">Solo texto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    value={draft.caption}
                    onChange={(e) => setDraft(post.id, { caption: e.target.value })}
                    rows={3}
                    className="text-sm"
                  />
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {post.scheduled_date} · {post.scheduled_time?.slice(0, 5)} ·{' '}
                    {post.platform === 'facebook' ? 'Facebook' : 'Instagram'}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{post.caption}</p>
                </>
              )}

              {post.status === 'failed' && post.error_detail && (
                <p className="text-xs text-destructive">{post.error_detail}</p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {canEdit && !isEditing && (
                  <Button size="xs" variant="outline" onClick={() => setEditingId(post.id)}>
                    <Pencil className="mr-1 h-3 w-3" /> Editar
                  </Button>
                )}
                {canEdit && isEditing && (
                  <>
                    <Button size="xs" variant="outline" disabled={busy} onClick={() => save(post)}>
                      {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
                      Guardar
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancelar
                    </Button>
                  </>
                )}
                {canEdit && (
                  <>
                    <Button size="xs" disabled={busy} onClick={() => approve(post)}>
                      {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                      Aprobar
                    </Button>
                    <Button size="xs" variant="ghost" disabled={busy} onClick={() => reject(post)} className="text-destructive">
                      <X className="mr-1 h-3 w-3" /> Descartar
                    </Button>
                  </>
                )}
              </div>
            </div>

            <MediaPicker
              open={pickerForId === post.id}
              onOpenChange={(v) => !v && setPickerForId(null)}
              onPick={(media) => void pickMedia(post, media)}
              defaultPrompt={post.idea}
            />
          </div>
        );
      })}
    </div>
  );
}
