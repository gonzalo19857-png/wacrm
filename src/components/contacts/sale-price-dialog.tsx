"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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
import { Loader2 } from "lucide-react";
import { CURRENCIES } from "@/lib/currency";

interface SalePriceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tagName: string;
  contactName: string;
  currency: string;
  saving: boolean;
  /** Rejects to keep the dialog open (e.g. the API call failed). */
  onConfirm: (price: number) => Promise<void>;
}

/**
 * Prompts for a sale price when a "sale tag" (migration 045, e.g.
 * "Venta") is added to a contact. Kept intentionally to one field —
 * this is meant to be a 5-second capture at the moment the agent tags
 * the chat, not a full deal form. Shared by contact-sidebar.tsx (inbox)
 * and contact-detail-view.tsx (Contacts page) so both tagging entry
 * points behave identically.
 */
export function SalePriceDialog({
  open,
  onOpenChange,
  tagName,
  contactName,
  currency,
  saving,
  onConfirm,
}: SalePriceDialogProps) {
  const t = useTranslations("Contacts.saleTag");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Fresh field every time the dialog opens for a new tag/contact.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrice("");
      setError(null);
    }
  }, [open]);

  const symbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;

  async function handleConfirm() {
    const value = Number(price);
    if (!price.trim() || !Number.isFinite(value) || value < 0) {
      setError(t("errorInvalidPrice"));
      return;
    }
    setError(null);
    await onConfirm(value);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("description", { tag: tagName, name: contactName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="sale-price">{t("priceLabel")}</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {symbol}
            </span>
            <Input
              id="sale-price"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              autoFocus
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirm();
              }}
              placeholder={t("pricePlaceholder")}
              disabled={saving}
              className="pl-9"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
