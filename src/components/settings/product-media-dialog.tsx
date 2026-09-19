'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ImagePlus, Video, Trash2, PlayCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Product, ProductMedia } from '@/types';

interface ProductMediaDialogProps {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Extra photos and a video per product (migration 054) — beyond the
 * one generic photo on the product itself, for real "in the wild"
 * shots (installed on an actual car, not just the marketing graphic)
 * the bot can send when a customer asks to see more. Add/remove is
 * immediate, no separate save step — same reasoning as the rest of
 * the product screen: the fewer steps, the less likely it goes stale.
 */
export function ProductMediaDialog({ product, onOpenChange }: ProductMediaDialogProps) {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [media, setMedia] = useState<ProductMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!product) return;
    fetchMedia(product.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  async function fetchMedia(productId: string) {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('product_media')
        .select('*')
        .eq('product_id', productId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMedia((data as ProductMedia[]) || []);
    } catch (err) {
      console.error('Failed to fetch product media:', err);
      toast.error("Couldn't load the photos");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(kind: 'image' | 'video', file: File | undefined) {
    if (!file || !product || !accountId) return;
    const setUploading = kind === 'image' ? setUploadingImage : setUploadingVideo;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || (kind === 'video' ? 'mp4' : 'jpg');
      const path = `${accountId}/${product.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('product-media')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;
      const {
        data: { publicUrl },
      } = supabase.storage.from('product-media').getPublicUrl(path);

      const { data, error } = await supabase
        .from('product_media')
        .insert({ account_id: accountId, product_id: product.id, kind, url: publicUrl })
        .select('*')
        .single();
      if (error) throw error;
      setMedia((prev) => [...prev, data as ProductMedia]);
      toast.success(kind === 'image' ? 'Photo added' : 'Video added');
    } catch (err) {
      console.error('Failed to add product media:', err);
      toast.error(kind === 'image' ? "Couldn't add the photo" : "Couldn't add the video");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(item: ProductMedia) {
    setDeletingId(item.id);
    try {
      const { error } = await supabase.from('product_media').delete().eq('id', item.id);
      if (error) throw error;
      setMedia((prev) => prev.filter((m) => m.id !== item.id));
    } catch (err) {
      console.error('Failed to delete product media:', err);
      toast.error("Couldn't delete that");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            Photos &amp; video{product ? ` — ${product.name}` : ''}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Extra shots (real installs, close-ups) or a short video the bot can send
            when a customer asks to see more.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {media.map((item) => (
              <div
                key={item.id}
                className="group relative aspect-square overflow-hidden rounded-md border border-border"
              >
                {item.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" className="size-full object-cover" />
                ) : (
                  <>
                    <video src={item.url} muted preload="metadata" className="size-full object-cover" />
                    <PlayCircle className="absolute inset-0 m-auto size-6 text-white drop-shadow" />
                  </>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  disabled={deletingId === item.id}
                  aria-label="Remove"
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  {deletingId === item.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Trash2 className="size-3" />
                  )}
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={uploadingImage}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:bg-muted"
            >
              {uploadingImage ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <ImagePlus className="size-4" />
                  <span className="text-[11px]">Add photo</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              disabled={uploadingVideo}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:bg-muted"
            >
              {uploadingVideo ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Video className="size-4" />
                  <span className="text-[11px]">Add video</span>
                </>
              )}
            </button>
          </div>
        )}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            handleAdd('image', e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/3gpp,video/quicktime"
          className="hidden"
          onChange={(e) => {
            handleAdd('video', e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
