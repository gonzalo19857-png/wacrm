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
    setLoading(true);
    fetch(`/api/contacts/${contactId}/shipment`)
      .then((res) => res.json())
      .then((body: { shipment: ShipmentSnapshot | null }) => {
        if (cancelled) return;
        const s = body.shipment;
        setShipmentId(s?.id);
        setProduct(s?.product ?? "");
        setRecipientName(s?.recipient_name ?? "");
        setRecipientDni(s?.recipient_dni ?? "");
        setCity(s?.city ?? "");
        setAgencyName(s?.agency_name ?? "");
        setRecipientPhone(s?.recipient_phone ?? contactPhone ?? "");
      })
      .catch(() => {
        if (!cancelled) setRecipientPhone(contactPhone ?? "");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
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
