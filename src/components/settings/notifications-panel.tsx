"use client";

import { Bell, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { playNotificationSound } from "@/lib/notify-sound";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Notifications panel — currently just the inbox sound toggle.
 * Device-scoped (localStorage) like Appearance: no save button, the
 * switch applies immediately.
 */
export function NotificationsPanel() {
  const { enabled, setEnabled } = useNotificationSound();
  const t = useTranslations("Settings.notifications");

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
          >
            <Bell className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t("soundOnNewMessage")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("soundOnNewMessageDesc")}
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <Button
        type="button"
        variant="outline"
        className="mt-4"
        onClick={playNotificationSound}
      >
        <Volume2 className="mr-2 h-4 w-4" />
        {t("previewSound")}
      </Button>
    </section>
  );
}
