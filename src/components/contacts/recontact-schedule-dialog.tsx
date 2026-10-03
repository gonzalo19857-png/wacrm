"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { MessageTemplate } from "@/types";

interface RecontactScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tagName: string;
  contactName: string;
  saving: boolean;
  onConfirm: (args: {
    templateName: string;
    templateLanguage: string;
    templateParams: string[];
    sendAtIso: string;
  }) => Promise<void>;
}

/** Local "YYYY-MM-DDTHH:mm" an hour from now — the <input type="datetime-local">
 *  native format. Defaults an hour out rather than "now" so the picker
 *  doesn't open already past its own minimum. */
function defaultSendAt(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** How many {{1}}, {{2}}, … placeholders a template body needs — same
 *  positional-variable convention as renderTemplateBody
 *  (src/lib/whatsapp/template-body.ts), duplicated here rather than
 *  imported since this file only needs the count, not the substitution. */
function variableCount(bodyText: string): number {
  let max = 0;
  for (const m of bodyText.matchAll(/\{\{(\d+)\}\}/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * Prompts for an exact send date/time and an approved template when a
 * tag flagged tags.is_recontact_tag is added to a contact — each
 * tagging schedules its own one-off send rather than following a fixed
 * automation wait. Shared by contact-sidebar.tsx (inbox) and
 * contact-detail-view.tsx (Contacts page), mirroring SalePriceDialog.
 */
export function RecontactScheduleDialog({
  open,
  onOpenChange,
  tagName,
  contactName,
  saving,
  onConfirm,
}: RecontactScheduleDialogProps) {
  const t = useTranslations("Contacts.recontactSchedule");
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateId, setTemplateId] = useState<string>("");
  const [sendAt, setSendAt] = useState(defaultSendAt());
  const [params, setParams] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSendAt(defaultSendAt());
    setTemplateId("");
    setParams([]);
    setError(null);

    let cancelled = false;
    setLoadingTemplates(true);
    const supabase = createClient();
    supabase
      .from("message_templates")
      .select("*")
      .eq("status", "APPROVED")
      .order("created_at", { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) {
          console.error("Failed to fetch templates:", fetchError);
          setTemplates([]);
        } else {
          setTemplates((data as MessageTemplate[]) ?? []);
        }
        setLoadingTemplates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectedTemplate = useMemo(
    () => templates.find((tpl) => tpl.id === templateId) ?? null,
    [templates, templateId],
  );
  const neededParams = selectedTemplate ? variableCount(selectedTemplate.body_text) : 0;

  useEffect(() => {
    setParams((prev) => {
      const next = Array.from({ length: neededParams }, (_, i) => prev[i] ?? "");
      return next;
    });
  }, [neededParams]);

  async function handleConfirm() {
    if (!selectedTemplate) {
      setError(t("errorNoTemplate"));
      return;
    }
    if (!sendAt || new Date(sendAt).getTime() <= Date.now()) {
      setError(t("errorPastDate"));
      return;
    }
    setError(null);
    await onConfirm({
      templateName: selectedTemplate.name,
      templateLanguage: selectedTemplate.language || "en_US",
      templateParams: params,
      sendAtIso: new Date(sendAt).toISOString(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("description", { tag: tagName, name: contactName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="recontact-send-at">{t("dateLabel")}</Label>
          <Input
            id="recontact-send-at"
            type="datetime-local"
            min={nowLocal()}
            value={sendAt}
            onChange={(e) => setSendAt(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t("templateLabel")}</Label>
          {loadingTemplates ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("loadingTemplates")}
            </div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noApprovedTemplates")}</p>
          ) : (
            <Select
              value={templateId}
              onValueChange={(value) => setTemplateId(value ?? "")}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("templatePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.name} ({tpl.language})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {neededParams > 0 && (
          <div className="space-y-1.5">
            {Array.from({ length: neededParams }, (_, i) => (
              <Input
                key={i}
                value={params[i] ?? ""}
                onChange={(e) =>
                  setParams((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })
                }
                placeholder={t("variablePlaceholder", { index: i + 1 })}
                disabled={saving}
              />
            ))}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={saving || templates.length === 0}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
