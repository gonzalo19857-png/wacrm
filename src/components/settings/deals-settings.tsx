"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Coins, Loader2, FileSpreadsheet } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Sales settings — account-wide default currency.
 *
 * One currency per account (issue #218): the chosen code seeds new
 * sales and formats every aggregated total. Existing sales keep their
 * own saved currency. Writes go straight to `accounts.default_currency`;
 * the `accounts_update` RLS policy (017) already restricts that to
 * admins+, so non-admins see a disabled, read-only control.
 */
export function DealsSettings() {
  const supabase = createClient();
  const {
    accountId,
    defaultCurrency,
    canEditSettings,
    profileLoading,
    refreshProfile,
  } = useAuth();

  const [selected, setSelected] = useState(defaultCurrency);
  const [saving, setSaving] = useState(false);
  const t = useTranslations("Settings.deals");

  // Keep the select in sync once the profile (and its account default)
  // resolves, and after a save round-trips through refreshProfile.
  useEffect(() => {
    setSelected(defaultCurrency);
  }, [defaultCurrency]);

  const dirty = selected !== defaultCurrency;

  async function handleSave() {
    if (!accountId || !dirty) return;
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({ default_currency: selected })
      .eq("id", accountId);
    if (error) {
      toast.error(t("saveFailed"));
      setSaving(false);
      return;
    }
    // Pull the new value back into the auth context so the sale form
    // and every total pick it up without a full reload.
    await refreshProfile();
    setSaving(false);
    toast.success(t("saveSuccess"));
  }

  // ------------------------------------------------------------
  // Google Form integration — pushes every newly-registered sale
  // (the sale-tag price prompt) as a submission to an external Google
  // Form, which in turn appends a row to whatever Sheet it's linked
  // to. See supabase/migrations/048_sale_form_integration.sql.
  // ------------------------------------------------------------
  const [formUrl, setFormUrl] = useState("");
  const [fieldClient, setFieldClient] = useState("");
  const [fieldProduct, setFieldProduct] = useState("");
  const [fieldPrice, setFieldPrice] = useState("");
  const [fieldPhone, setFieldPhone] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [loadingForm, setLoadingForm] = useState(true);
  const [savingForm, setSavingForm] = useState(false);

  const loadSaleForm = useCallback(async () => {
    setLoadingForm(true);
    try {
      const res = await fetch("/api/settings/sale-form");
      const data = await res.json();
      if (data.configured) {
        setFormUrl(data.form_response_url ?? "");
        setFieldClient(data.field_client_entry ?? "");
        setFieldProduct(data.field_product_entry ?? "");
        setFieldPrice(data.field_price_entry ?? "");
        setFieldPhone(data.field_phone_entry ?? "");
        setFormActive(Boolean(data.is_active));
      }
    } finally {
      setLoadingForm(false);
    }
  }, []);

  useEffect(() => {
    loadSaleForm();
  }, [loadSaleForm]);

  async function handleSaveSaleForm() {
    if (!formUrl.trim()) {
      toast.error(t("saleFormUrlRequired"));
      return;
    }
    setSavingForm(true);
    try {
      const res = await fetch("/api/settings/sale-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form_response_url: formUrl.trim(),
          field_client_entry: fieldClient.trim(),
          field_product_entry: fieldProduct.trim(),
          field_price_entry: fieldPrice.trim(),
          field_phone_entry: fieldPhone.trim(),
          is_active: formActive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("saleFormSaveFailed"));
        return;
      }
      toast.success(t("saleFormSaveSuccess"));
    } catch {
      toast.error(t("saleFormSaveFailed"));
    } finally {
      setSavingForm(false);
    }
  }

  // ------------------------------------------------------------
  // Live sheet webhook (migration 050) — an Apps Script Web App bound
  // to the account's own Google Sheet, driven by the sale-tag price
  // prompt (with date), notes, and region tags. See
  // supabase/migrations/050_sale_sheet_webhook.sql.
  // ------------------------------------------------------------
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookSecretEdited, setWebhookSecretEdited] = useState(false);
  const [hasStoredWebhookSecret, setHasStoredWebhookSecret] = useState(false);
  const [webhookActive, setWebhookActive] = useState(true);
  const [loadingWebhook, setLoadingWebhook] = useState(true);
  const [savingWebhook, setSavingWebhook] = useState(false);

  const loadSheetWebhook = useCallback(async () => {
    setLoadingWebhook(true);
    try {
      const res = await fetch("/api/settings/sale-sheet-webhook");
      const data = await res.json();
      if (data.configured) {
        setWebhookUrl(data.webhook_url ?? "");
        setHasStoredWebhookSecret(Boolean(data.has_secret));
        setWebhookActive(Boolean(data.is_active));
      }
    } finally {
      setLoadingWebhook(false);
    }
  }, []);

  useEffect(() => {
    loadSheetWebhook();
  }, [loadSheetWebhook]);

  async function handleSaveSheetWebhook() {
    if (!webhookUrl.trim()) {
      toast.error(t("sheetWebhookUrlRequired"));
      return;
    }
    setSavingWebhook(true);
    try {
      const res = await fetch("/api/settings/sale-sheet-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhook_url: webhookUrl.trim(),
          secret: webhookSecretEdited ? webhookSecret.trim() : undefined,
          is_active: webhookActive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t("sheetWebhookSaveFailed"));
        return;
      }
      toast.success(t("sheetWebhookSaveSuccess"));
      setWebhookSecretEdited(false);
      await loadSheetWebhook();
    } catch {
      toast.error(t("sheetWebhookSaveFailed"));
    } finally {
      setSavingWebhook(false);
    }
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200 space-y-6">
      <SettingsPanelHead
        title={t("title")}
        description={t("description")}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Coins className="size-4 text-primary" />
            {t("defaultCurrency")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("defaultCurrencyDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">{t("currencyLabel")}</Label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!canEditSettings || profileLoading}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.label}
                </option>
              ))}
            </select>
            {!canEditSettings && (
              <p className="text-xs text-muted-foreground">
                {t("adminOnlyHint")}
              </p>
            )}
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("saving")}
                </>
              ) : (
                t("save")
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <FileSpreadsheet className="size-4 text-primary" />
            {t("saleFormTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("saleFormDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingForm ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t("saleFormUrlLabel")}</Label>
                <Input
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder={t("saleFormUrlPlaceholder")}
                  disabled={!canEditSettings}
                />
                <p className="text-xs text-muted-foreground">{t("saleFormUrlHint")}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("saleFormFieldClient")}</Label>
                  <Input
                    value={fieldClient}
                    onChange={(e) => setFieldClient(e.target.value)}
                    placeholder="entry.1061967192"
                    disabled={!canEditSettings}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("saleFormFieldProduct")}</Label>
                  <Input
                    value={fieldProduct}
                    onChange={(e) => setFieldProduct(e.target.value)}
                    placeholder="entry.107374042"
                    disabled={!canEditSettings}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("saleFormFieldPrice")}</Label>
                  <Input
                    value={fieldPrice}
                    onChange={(e) => setFieldPrice(e.target.value)}
                    placeholder="entry.509587618"
                    disabled={!canEditSettings}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("saleFormFieldPhone")}</Label>
                  <Input
                    value={fieldPhone}
                    onChange={(e) => setFieldPhone(e.target.value)}
                    placeholder="entry.1459975217"
                    disabled={!canEditSettings}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t("saleFormFieldHint")}</p>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{t("saleFormActive")}</p>
                  <p className="text-xs text-muted-foreground">{t("saleFormActiveDesc")}</p>
                </div>
                <Switch
                  checked={formActive}
                  onCheckedChange={setFormActive}
                  disabled={!canEditSettings}
                />
              </div>

              {canEditSettings && (
                <Button
                  onClick={handleSaveSaleForm}
                  disabled={savingForm}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {savingForm ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t("saving")}
                    </>
                  ) : (
                    t("save")
                  )}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <FileSpreadsheet className="size-4 text-primary" />
            {t("sheetWebhookTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("sheetWebhookDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingWebhook ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t("sheetWebhookUrlLabel")}</Label>
                <Input
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder={t("sheetWebhookUrlPlaceholder")}
                  disabled={!canEditSettings}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t("sheetWebhookSecretLabel")}</Label>
                <Input
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => {
                    setWebhookSecret(e.target.value);
                    setWebhookSecretEdited(true);
                  }}
                  onFocus={() => {
                    if (!webhookSecretEdited && hasStoredWebhookSecret) {
                      setWebhookSecret("");
                      setWebhookSecretEdited(true);
                    }
                  }}
                  placeholder={
                    hasStoredWebhookSecret
                      ? t("sheetWebhookSecretStoredPlaceholder")
                      : t("sheetWebhookSecretPlaceholder")
                  }
                  disabled={!canEditSettings}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">{t("sheetWebhookSecretHint")}</p>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{t("sheetWebhookActive")}</p>
                  <p className="text-xs text-muted-foreground">{t("sheetWebhookActiveDesc")}</p>
                </div>
                <Switch
                  checked={webhookActive}
                  onCheckedChange={setWebhookActive}
                  disabled={!canEditSettings}
                />
              </div>

              {canEditSettings && (
                <Button
                  onClick={handleSaveSheetWebhook}
                  disabled={savingWebhook}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {savingWebhook ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t("saving")}
                    </>
                  ) : (
                    t("save")
                  )}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
