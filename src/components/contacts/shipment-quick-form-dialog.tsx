"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, PackageCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ShipmentAutofillFields } from "@/lib/ai/shipment";

interface ShipmentSnapshot {
  id?: string;
  product: string | null;
  city: string | null;
  agency_name: string | null;
  recipient_name: string | null;
  recipient_dni: string | null;
  recipient_phone: string | null;
}

interface ShipmentQuickFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  /** Falls into `recipient_phone` when the shipment doesn't already
   *  have one — same default the AI bot's sentinel merge uses. */
  contactPhone: string | null;
  /** Fired after a successful save so the sidebar's own ShipmentPanel
   *  (and any other shipment view open) picks up the change. */
  onSaved?: () => void;
}

/**
 * Pops up right after an agent tags a "Venta" and picks "Provincia"
 * (contact-sidebar.tsx) — the moment the business asked for a focused
 * prompt for exactly the fields dispatch needs (product, recipient
 * name/DNI, agency) instead of relying on someone remembering to open
 * the collapsed shipment panel later. Whatever the AI bot or the
 * `extractVehicleModel` fallback (sale-tag.ts) already captured shows
 * up pre-filled here — this is a "confirm/finish", not usually a
 * blank form. Saving goes through the same PATCH the shipment panel
 * uses, so the existing "became ready" Telegram alert to despachos
 * fires automatically the moment every required field is in, without
 * needing anything pasted anywhere by hand.
 */
export function ShipmentQuickFormDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactPhone,
  onSaved,
}: ShipmentQuickFormDialogProps) {
  const t = useTranslations("Contacts.shipmentQuickForm");
  const tShipment = useTranslations("Contacts.shipment");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Background second pass, after the initial load, that asks the
  // account's AI to find whatever's still missing in the conversation
  // itself — see the effect below and shipment/autofill/route.ts.
  const [autofilling, setAutofilling] = useState(false);
  const [shipmentId, setShipmentId] = useState<string | undefined>(undefined);
  const [product, setProduct] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientDni, setRecipientDni] = useState("");
  const [city, setCity] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setAutofilling(false);
      let snapshot: ShipmentSnapshot | null = null;
      try {
        const res = await fetch(`/api/contacts/${contactId}/shipment`);
        const body = (await res.json()) as { shipment: ShipmentSnapshot | null };
        snapshot = body.shipment;
      } catch {
        // Fall through with an empty form — the fields below still
        // default to contactPhone where relevant.
      }
      if (cancelled) return;

      setShipmentId(snapshot?.id);
      setProduct(snapshot?.product ?? "");
      setRecipientName(snapshot?.recipient_name ?? "");
      setRecipientDni(snapshot?.recipient_dni ?? "");
      setCity(snapshot?.city ?? "");
      setAgencyName(snapshot?.agency_name ?? "");
      setRecipientPhone(snapshot?.recipient_phone ?? contactPhone ?? "");
      setLoading(false);

      // Second, slower pass: only bother asking the AI to comb the
      // conversation when something a regex/sentinel could plausibly
      // have missed is still blank — skip it entirely on the common
      // case where the sentinel already filled everything.
      const missingSomething =
        !snapshot?.product ||
        !snapshot?.recipient_name ||
        !snapshot?.recipient_dni ||
        !snapshot?.city ||
        !snapshot?.agency_name;
      if (!missingSomething) return;

      setAutofilling(true);
      try {
        const res = await fetch(`/api/contacts/${contactId}/shipment/autofill`, {
          method: "POST",
        });
        const body = (await res.json()) as { fields: ShipmentAutofillFields | null };
        const f = body.fields;
        if (!cancelled && f) {
          if (!snapshot?.product && f.product) setProduct(f.product);
          if (!snapshot?.recipient_name && f.name) setRecipientName(f.name);
          if (!snapshot?.recipient_dni && f.dni) setRecipientDni(f.dni);
          if (!snapshot?.city && f.city) setCity(f.city);
          if (!snapshot?.agency_name && f.agency) setAgencyName(f.agency);
          if (!snapshot?.recipient_phone && f.phone) setRecipientPhone(f.phone);
        }
      } catch {
        // Best-effort suggestion — leave the fields exactly as loaded.
      } finally {
        if (!cancelled) setAutofilling(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, contactPhone]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/shipment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipment_id: shipmentId,
          region: "provincia",
          product,
          recipient_name: recipientName,
          recipient_dni: recipientDni,
          city,
          agency_name: agencyName,
          recipient_phone: recipientPhone,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success(t("saved"));
      onSaved?.();
      onOpenChange(false);
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <PackageCheck className="h-4 w-4 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("description", { name: contactName })}
          </DialogDescription>
        </DialogHeader>

        {!loading && autofilling && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("autofilling")}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <QuickField
              full
              label={tShipment("product")}
              value={product}
              onChange={setProduct}
              disabled={saving}
              autoFocus
            />
            <QuickField
              full
              label={tShipment("recipientName")}
              value={recipientName}
              onChange={setRecipientName}
              disabled={saving}
            />
            <QuickField
              label={tShipment("recipientDni")}
              value={recipientDni}
              onChange={setRecipientDni}
              disabled={saving}
            />
            <QuickField
              label={tShipment("recipientPhone")}
              value={recipientPhone}
              onChange={setRecipientPhone}
              disabled={saving}
            />
            <QuickField
              label={tShipment("city")}
              value={city}
              onChange={setCity}
              disabled={saving}
            />
            <QuickField
              label={tShipment("agencyName")}
              value={agencyName}
              onChange={setAgencyName}
              disabled={saving}
            />
          </div>
        )}

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t("later")}
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuickField({
  label,
  value,
  onChange,
  disabled,
  full,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  full?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className={`space-y-1 ${full ? "col-span-2" : ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
      />
    </div>
  );
}
