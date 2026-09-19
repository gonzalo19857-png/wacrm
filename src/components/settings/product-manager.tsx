'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Package, Pencil, Plus, Trash2, ImagePlus, Images } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { CURRENCIES } from '@/lib/currency';
import { ProductMediaDialog } from '@/components/settings/product-media-dialog';
import type { Product } from '@/types';

interface ProductDraft {
  id: string | null;
  name: string;
  price: string;
  description: string;
  active: boolean;
  imageUrl: string | null;
}

const EMPTY_DRAFT: ProductDraft = {
  id: null,
  name: '',
  price: '',
  description: '',
  active: true,
  imageUrl: null,
};

/**
 * Product catalog (migration 053) — every product the account sells,
 * one flat list: name, price, photo, a short description, and an
 * active toggle. Deliberately the only place any of that lives —
 * before this, a price change meant hunting for it inside the AI
 * system prompt's free text.
 */
export function ProductManager() {
  const supabase = createClient();
  const { accountId, defaultCurrency, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [mediaTarget, setMediaTarget] = useState<Product | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (authLoading || !accountId) return;
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, accountId]);

  async function fetchProducts() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setProducts((data as Product[]) || []);
    } catch (err) {
      console.error('Failed to fetch products:', err);
      toast.error("Couldn't load the product catalog");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setDraft(EMPTY_DRAFT);
    setPendingPhoto(null);
    setPhotoPreview(null);
    setDialogOpen(true);
  }

  function openEdit(product: Product) {
    setDraft({
      id: product.id,
      name: product.name,
      price: String(product.price),
      description: product.description ?? '',
      active: product.active,
      imageUrl: product.image_url ?? null,
    });
    setPendingPhoto(null);
    setPhotoPreview(null);
    setDialogOpen(true);
  }

  function handlePhotoPick(file: File | undefined) {
    if (!file) return;
    setPendingPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSave() {
    const name = draft.name.trim();
    const priceValue = Number(draft.price);
    if (!name) {
      toast.error('Give the product a name');
      return;
    }
    if (!draft.price.trim() || !Number.isFinite(priceValue) || priceValue < 0) {
      toast.error('Enter a valid price');
      return;
    }
    if (!accountId) return;

    setSaving(true);
    try {
      let imageUrl = draft.imageUrl;
      if (pendingPhoto) {
        const ext = pendingPhoto.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${accountId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(path, pendingPhoto, { cacheControl: '3600', upsert: false });
        if (uploadError) throw uploadError;
        const {
          data: { publicUrl },
        } = supabase.storage.from('product-images').getPublicUrl(path);
        imageUrl = publicUrl;
      }

      const row = {
        name,
        price: priceValue,
        currency: defaultCurrency || 'USD',
        description: draft.description.trim() || null,
        active: draft.active,
        image_url: imageUrl,
      };

      if (draft.id) {
        const { error } = await supabase.from('products').update(row).eq('id', draft.id);
        if (error) throw error;
        toast.success('Product updated');
      } else {
        const { error } = await supabase
          .from('products')
          .insert({ ...row, account_id: accountId });
        if (error) throw error;
        toast.success('Product added');
      }

      setDialogOpen(false);
      await fetchProducts();
    } catch (err) {
      console.error('Failed to save product:', err);
      toast.error("Couldn't save the product");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      const { error } = await supabase.from('products').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      setProducts((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success('Product deleted');
    } catch (err) {
      console.error('Failed to delete product:', err);
      toast.error("Couldn't delete the product");
    } finally {
      setDeleting(false);
    }
  }

  const symbol =
    CURRENCIES.find((c) => c.code === (defaultCurrency || 'USD'))?.symbol ?? `${defaultCurrency} `;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Package className="size-4 text-primary" />
          Products
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          What you sell — name, price and photo. This is the only place you need to
          change a price or swap a product&apos;s photo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {products.length > 0 ? (
              <div className="divide-y divide-border rounded-lg border border-border">
                {products.map((product) => (
                  <div key={product.id} className="flex items-center gap-3 p-3">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="size-12 shrink-0 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                        <ImagePlus className="size-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {product.name}
                        {!product.active && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                            Inactive
                          </span>
                        )}
                      </p>
                      {product.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {product.description}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-sm font-medium text-foreground">
                      {symbol}
                      {product.price.toFixed(2)}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setMediaTarget(product)}
                      aria-label={`Photos and video for ${product.name}`}
                      title="Photos & video"
                    >
                      <Images className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(product)}
                      aria-label={`Edit ${product.name}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(product)}
                      aria-label={`Delete ${product.name}`}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No products yet — add your first one below.
              </p>
            )}

            <Button type="button" variant="outline" onClick={openCreate} className="gap-1.5">
              <Plus className="size-4" />
              Add product
            </Button>
          </>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(next) => !saving && setDialogOpen(next)}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {draft.id ? 'Edit product' : 'Add product'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Name, price and photo — that&apos;s all the bot needs.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="product-name">Name</Label>
              <Input
                id="product-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. LED light strip"
                disabled={saving}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="product-price">Price</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {symbol}
                </span>
                <Input
                  id="product-price"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={draft.price}
                  onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                  placeholder="0.00"
                  disabled={saving}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="product-description">Description (optional)</Label>
              <Textarea
                id="product-description"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Short notes the bot can mention — features, sizes, colors..."
                disabled={saving}
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Photo</Label>
              <div className="flex items-center gap-3">
                {(photoPreview ?? draft.imageUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoPreview ?? draft.imageUrl ?? ''}
                    alt=""
                    className="size-14 rounded-md border border-border object-cover"
                  />
                ) : (
                  <div className="flex size-14 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                    <ImagePlus className="size-5" />
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                >
                  Choose photo
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => handlePhotoPick(e.target.files?.[0])}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">Active</p>
                <p className="text-xs text-muted-foreground">
                  Inactive products are kept but hidden from the bot.
                </p>
              </div>
              <Switch
                checked={draft.active}
                onCheckedChange={(checked) => setDraft((d) => ({ ...d, active: checked }))}
                disabled={saving}
              />
            </div>
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(next) => !deleting && !next && setDeleteTarget(null)}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Delete product?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {deleteTarget
                ? `"${deleteTarget.name}" will be removed from the catalog. This can't be undone.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProductMediaDialog
        product={mediaTarget}
        onOpenChange={(next) => !next && setMediaTarget(null)}
      />
    </Card>
  );
}
