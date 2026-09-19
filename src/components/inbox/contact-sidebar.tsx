"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Contact, Sale, ContactNote, Tag } from "@/types";
import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";
import { avatarColorFor } from "@/lib/avatar-color";
import { SalePriceDialog, type SaleRegion } from "@/components/contacts/sale-price-dialog";
import { ShipmentPanel } from "@/components/contacts/shipment-panel";
import { toast } from "sonner";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Truck,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

interface ContactSidebarProps {
  contact: Contact | null;
  /**
   * Fired after the inline "add phone number" save succeeds, with the
   * updated row. Inbound messages from Instagram-sourced Click-to-WhatsApp
   * leads sometimes arrive with no usable phone (Meta sends neither
   * `wa_id` nor `from`) — the webhook still creates the contact so the
   * lead isn't lost, but nothing can be sent to it until an agent fills
   * the number in. Lets the parent's `activeContact` (which this panel
   * doesn't own) pick up the edit without a full refetch.
   */
  onContactUpdated?: (contact: Contact) => void;
}

export function ContactSidebar({ contact, onContactUpdated }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");
  const tTagsTab = useTranslations("Contacts.detailView.tagsTab");
  const tSaleTag = useTranslations("Contacts.saleTag");

  const { accountId, defaultCurrency, canSendMessages, canEditSettings } = useAuth();
  const [copied, setCopied] = useState(false);
  const [sales, setSales] = useState<Sale[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [savingTagId, setSavingTagId] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  // Set when the tag just toggled on is a "sale tag" (migration 045) —
  // opens the price prompt instead of adding the tag immediately.
  const [salePrompt, setSalePrompt] = useState<{ id: string; name: string } | null>(null);
  const [savingSale, setSavingSale] = useState(false);
  // Inline price edit on an existing sale row — id of the row being
  // edited (null when none) plus its draft value.
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [editSalePrice, setEditSalePrice] = useState("");
  const [savingSaleEdit, setSavingSaleEdit] = useState(false);
  const [deletingSaleId, setDeletingSaleId] = useState<string | null>(null);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch sales, notes, and tags in parallel
    const [salesRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from("sales")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (salesRes.data) setSales(salesRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  // Account's full tag list, loaded once so the "add tag" popover has
  // something to offer without a round trip every time it opens.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("tags")
      .select("*")
      .order("name")
      .then(({ data }) => {
        if (!cancelled && data) setAllTags(data as Tag[]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const handleToggleTag = useCallback(
    async (tagId: string) => {
      if (!contact) return;
      const isSelected = tags.some((tag) => tag.id === tagId);
      if (!isSelected) {
        // Adding, not removing — a "sale tag" needs a price first, so
        // open the prompt instead of adding immediately. A normal tag
        // (or removing any tag) still toggles right away below.
        const tag = allTags.find((t) => t.id === tagId);
        if (tag?.is_sale_tag) {
          setSalePrompt({ id: tag.id, name: tag.name });
          return;
        }
      }

      // Optimistic toggle — flip local state immediately instead of
      // waiting on the request (and then a full fetchContactData
      // re-fetch on top of it, which is what made this feel laggy:
      // two sequential round trips before the chip visibly changed).
      // Roll back to the previous list if the request fails.
      const previousTags = tags;
      if (isSelected) {
        setTags((prev) => prev.filter((tag) => tag.id !== tagId));
      } else {
        const tag = allTags.find((t) => t.id === tagId);
        if (tag) {
          setTags((prev) => [...prev, { ...tag, contact_tag_id: `optimistic-${tagId}` }]);
        }
      }

      setSavingTagId(tagId);
      try {
        if (isSelected) {
          await deleteContactTag(contact.id, tagId);
        } else {
          await addContactTag(contact.id, tagId);
        }
      } catch {
        setTags(previousTags);
        toast.error(tSidebar("tagUpdateFailed"));
      } finally {
        setSavingTagId(null);
      }
    },
    [contact, tags, allTags, tSidebar]
  );

  const handleConfirmSalePrice = useCallback(
    async (price: number, fecha: string, region: SaleRegion) => {
      if (!contact || !salePrompt) return;
      setSavingSale(true);
      try {
        const result = await addContactTag(contact.id, salePrompt.id, price, fecha, region);
        await fetchContactData();
        setSalePrompt(null);
        if (result.saleId) {
          toast.success(tSaleTag("toastSuccess"));
        } else {
          toast.error(tSaleTag("toastFailed"));
        }
      } catch {
        toast.error(tSaleTag("toastFailed"));
      } finally {
        setSavingSale(false);
      }
    },
    [contact, salePrompt, fetchContactData, tSaleTag]
  );

  const startEditSale = useCallback((sale: Sale) => {
    setEditingSaleId(sale.id);
    setEditSalePrice(String(sale.value));
  }, []);

  const cancelEditSale = useCallback(() => {
    setEditingSaleId(null);
    setEditSalePrice("");
  }, []);

  const handleSaveSaleEdit = useCallback(
    async (saleId: string) => {
      const value = Number(editSalePrice);
      if (!editSalePrice.trim() || !Number.isFinite(value) || value < 0) {
        toast.error(tSidebar("saleInvalidPrice"));
        return;
      }
      setSavingSaleEdit(true);
      const supabase = createClient();
      const { error } = await supabase
        .from("sales")
        .update({ value })
        .eq("id", saleId);
      setSavingSaleEdit(false);
      if (error) {
        toast.error(tSidebar("saleUpdateFailed"));
        return;
      }
      setSales((prev) => prev.map((s) => (s.id === saleId ? { ...s, value } : s)));
      setEditingSaleId(null);
      setEditSalePrice("");
      toast.success(tSidebar("saleUpdated"));
    },
    [editSalePrice, tSidebar]
  );

  const handleDeleteSale = useCallback(
    async (saleId: string) => {
      if (!window.confirm(tSidebar("saleDeleteConfirm"))) return;
      setDeletingSaleId(saleId);
      const supabase = createClient();
      const { error } = await supabase.from("sales").delete().eq("id", saleId);
      setDeletingSaleId(null);
      if (error) {
        toast.error(tSidebar("saleDeleteFailed"));
        return;
      }
      setSales((prev) => prev.filter((s) => s.id !== saleId));
      toast.success(tSidebar("saleDeleted"));
    },
    [tSidebar]
  );

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const [phoneDraft, setPhoneDraft] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);

  const handleSavePhone = useCallback(async () => {
    if (!contact || !phoneDraft.trim()) return;
    setSavingPhone(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("contacts")
      .update({ phone: phoneDraft.trim(), updated_at: new Date().toISOString() })
      .eq("id", contact.id)
      .select()
      .single();
    setSavingPhone(false);
    if (error || !data) {
      toast.error(tSidebar("phoneSaveError"));
      return;
    }
    toast.success(tSidebar("phoneSaved"));
    setPhoneDraft("");
    onContactUpdated?.(data as Contact);
  }, [contact, phoneDraft, onContactUpdated, tSidebar]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    setAddingNote(true);

    try {
      const res = await fetch(`/api/contacts/${contact.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_text: newNote.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.note) {
        setNotes((prev) => [data.note, ...prev]);
        setNewNote("");
      }
    } finally {
      setAddingNote(false);
    }
  }, [contact, newNote]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold text-white"
              style={{ backgroundColor: avatarColorFor(contact.id || displayName) }}
            >
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            {contact.phone ? (
              <button
                onClick={handleCopyPhone}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-left">{contact.phone}</span>
                {copied ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            ) : (
              <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="flex items-center gap-1.5 text-xs text-amber-400">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  {tSidebar("noPhoneWarning")}
                </p>
                <div className="flex gap-1.5">
                  <Input
                    value={phoneDraft}
                    onChange={(e) => setPhoneDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSavePhone();
                    }}
                    placeholder={tSidebar("phonePlaceholder")}
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    className="h-8 shrink-0"
                    disabled={!phoneDraft.trim() || savingPhone}
                    onClick={handleSavePhone}
                  >
                    {tSidebar("save")}
                  </Button>
                </div>
              </div>
            )}

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TagIcon className="h-3 w-3" />
                {tSidebar("tags")}
              </div>
              <Popover>
                <PopoverTrigger
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={tSidebar("tags")}
                  aria-label={tSidebar("tags")}
                >
                  <Plus className="h-3 w-3" />
                </PopoverTrigger>
                <PopoverContent align="end" className="max-h-64 w-64 overflow-y-auto">
                  <p className="mb-2 px-0.5 text-xs text-muted-foreground">
                    {tTagsTab("clickTagDesc")}
                  </p>
                  {allTags.length === 0 ? (
                    <p className="px-0.5 text-xs text-muted-foreground">
                      {tTagsTab("noTagsAvailable")}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {allTags.map((tag) => {
                        const selected = tags.some((t) => t.id === tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => handleToggleTag(tag.id)}
                            disabled={savingTagId === tag.id}
                            className={cn(
                              "inline-flex cursor-pointer items-center rounded-full px-2.5 py-1 text-xs font-medium transition-all disabled:cursor-not-allowed",
                              selected
                                ? "ring-2 ring-primary ring-offset-1 ring-offset-popover"
                                : "opacity-50 hover:opacity-80"
                            )}
                            style={{
                              backgroundColor: `${tag.color}20`,
                              color: tag.color,
                            }}
                          >
                            {selected && <Check className="mr-1 h-3 w-3" />}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Sales */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("sales")}
            </div>
            <div className="mt-2 space-y-2">
              {sales.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noSales")}</p>
              ) : (
                sales.map((sale) => (
                  <div
                    key={sale.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {sale.title}
                    </p>
                    {editingSaleId === sale.id ? (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          autoFocus
                          value={editSalePrice}
                          onChange={(e) => setEditSalePrice(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveSaleEdit(sale.id);
                            if (e.key === "Escape") cancelEditSale();
                          }}
                          disabled={savingSaleEdit}
                          className="h-7 text-xs"
                        />
                        <Button
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={savingSaleEdit}
                          onClick={() => handleSaveSaleEdit(sale.id)}
                        >
                          {tSidebar("save")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={savingSaleEdit}
                          onClick={cancelEditSale}
                        >
                          {tSidebar("cancel")}
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {sale.currency ?? "$"}
                          {sale.value.toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1">
                          {canSendMessages && (
                            <button
                              type="button"
                              onClick={() => startEditSale(sale)}
                              aria-label={tSidebar("editSaleAria")}
                              title={tSidebar("editSale")}
                              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                          {canEditSettings && (
                            <button
                              type="button"
                              onClick={() => handleDeleteSale(sale.id)}
                              disabled={deletingSaleId === sale.id}
                              aria-label={tSidebar("deleteSaleAria")}
                              title={tSidebar("deleteSale")}
                              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Shipment */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Truck className="h-3 w-3" />
              {tSidebar("shipment")}
            </div>
            <div className="mt-2">
              {contact && <ShipmentPanel contactId={contact.id} />}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {salePrompt && (
        <SalePriceDialog
          open
          onOpenChange={(next) => {
            if (!next) setSalePrompt(null);
          }}
          tagName={salePrompt.name}
          contactName={displayName}
          currency={defaultCurrency}
          saving={savingSale}
          onConfirm={handleConfirmSalePrice}
        />
      )}
    </div>
  );
}
