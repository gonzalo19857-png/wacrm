"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Truck, Loader2, Camera, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media";
import type { ShipmentRegion, ShipmentStatus } from "@/lib/shipments/store";

interface ShipmentRow {
  id: string;
  region: ShipmentRegion | null;
  status: ShipmentStatus;
  city: string | null;
  agency_name: string | null;
  agency_address: string | null;
  delivery_address: string | null;
  delivery_reference: string | null;
  recipient_name: string | null;
  recipient_dni: string | null;
  recipient_phone: string | null;
  receipt_photo_url: string | null;
  notes: string | null;
}

type FieldKey =
  | "city"
  | "agency_name"
  | "agency_address"
  | "delivery_address"
  | "delivery_reference"
  | "recipient_name"
  | "recipient_dni"
  | "recipient_phone"
  | "notes";

/** Next status this "one click" button offers, per region — mirrors
 *  `NEXT_STATUS_BY_REGION` in src/lib/shipments/store.ts. */
const NEXT_STATUS: Record<ShipmentRegion, Partial<Record<ShipmentStatus, ShipmentStatus>>> = {
  provincia: { ready: "shipped", shipped: "at_agency", at_agency: "delivered" },
  lima: { ready: "out_for_delivery", out_for_delivery: "delivered" },
};

export function ShipmentPanel({ contactId }: { contactId: string }) {
  const t = useTranslations("Contacts.shipment");
  const [shipment, setShipment] = useState<ShipmentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<Record<FieldKey, string>>({
    city: "",
    agency_name: "",
    agency_address: "",
    delivery_address: "",
    delivery_reference: "",
    recipient_name: "",
    recipient_dni: "",
    recipient_phone: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/shipment`);
      const body = (await res.json().catch(() => ({}))) as { shipment: ShipmentRow | null };
      const s = body.shipment ?? null;
      setShipment(s);
      setFields({
        city: s?.city ?? "",
        agency_name: s?.agency_name ?? "",
        agency_address: s?.agency_address ?? "",
        delivery_address: s?.delivery_address ?? "",
        delivery_reference: s?.delivery_reference ?? "",
        recipient_name: s?.recipient_name ?? "",
        recipient_dni: s?.recipient_dni ?? "",
        recipient_phone: s?.recipient_phone ?? "",
        notes: s?.notes ?? "",
      });
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/shipment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipment_id: shipment?.id, ...fields }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        shipment?: ShipmentRow;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? t("saveFailed"));
      setShipment(body.shipment ?? null);
      toast.success(t("saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleAdvance(nextStatus: ShipmentStatus) {
    setAdvancing(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/shipment/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        shipment?: ShipmentRow;
        notified?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? t("statusUpdateFailed"));
      setShipment(body.shipment ?? null);
      toast.success(body.notified ? t("statusUpdatedNotified") : t("statusUpdated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("statusUpdateFailed"));
    } finally {
      setAdvancing(false);
    }
  }

  async function handlePhotoPicked(file: File | undefined) {
    if (!file) return;
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(t("photoTooLarge"));
      return;
    }
    setUploadingPhoto(true);
    try {
      const { publicUrl } = await uploadAccountMedia("chat-media", file);
      const res = await fetch(`/api/contacts/${contactId}/shipment/photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_url: publicUrl }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? t("photoSendFailed"));
      toast.success(t("photoSent"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("photoSendFailed"));
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  if (!shipment) {
    return (
      <p className="px-1 py-1 text-xs text-muted-foreground">{t("empty")}</p>
    );
  }

  const region = shipment.region;
  const nextStatus = region ? NEXT_STATUS[region]?.[shipment.status] : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {region ? t(`region.${region}`) : t("region.unset")}
        </span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          {t(`status.${shipment.status}`)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {region !== "lima" && (
          <>
            <Field label={t("city")} value={fields.city} onChange={(v) => setFields((f) => ({ ...f, city: v }))} />
            <Field
              label={t("agencyName")}
              value={fields.agency_name}
              onChange={(v) => setFields((f) => ({ ...f, agency_name: v }))}
            />
            <Field
              label={t("agencyAddress")}
              value={fields.agency_address}
              onChange={(v) => setFields((f) => ({ ...f, agency_address: v }))}
              full
            />
          </>
        )}
        {region !== "provincia" && (
          <>
            <Field
              label={t("deliveryAddress")}
              value={fields.delivery_address}
              onChange={(v) => setFields((f) => ({ ...f, delivery_address: v }))}
              full
            />
            <Field
              label={t("deliveryReference")}
              value={fields.delivery_reference}
              onChange={(v) => setFields((f) => ({ ...f, delivery_reference: v }))}
              full
            />
          </>
        )}
        <Field
          label={t("recipientName")}
          value={fields.recipient_name}
          onChange={(v) => setFields((f) => ({ ...f, recipient_name: v }))}
          full
        />
        <Field
          label={t("recipientDni")}
          value={fields.recipient_dni}
          onChange={(v) => setFields((f) => ({ ...f, recipient_dni: v }))}
        />
        <Field
          label={t("recipientPhone")}
          value={fields.recipient_phone}
          onChange={(v) => setFields((f) => ({ ...f, recipient_phone: v }))}
        />
      </div>

      <Button
        size="sm"
        variant="outline"
        className="w-full border-border text-muted-foreground hover:bg-muted"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        {t("save")}
      </Button>

      <div className="flex flex-wrap gap-1.5">
        {nextStatus && (
          <Button size="sm" onClick={() => handleAdvance(nextStatus)} disabled={advancing}>
            {advancing && <Loader2 className="h-3 w-3 animate-spin" />}
            <Truck className="h-3 w-3" />
            {t(`advance.${nextStatus}`)}
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handlePhotoPicked(e.target.files?.[0])}
        />
        <Button
          size="sm"
          variant="outline"
          className="border-border text-muted-foreground hover:bg-muted"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingPhoto}
        >
          {uploadingPhoto ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
          {t("sendPhoto")}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  full?: boolean;
}) {
  return (
    <div className={`space-y-1 ${full ? "col-span-2" : ""}`}>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs"
      />
    </div>
  );
}
