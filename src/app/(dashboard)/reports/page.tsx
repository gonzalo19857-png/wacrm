"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Deal, Contact } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import { toCsv, downloadBlob } from "@/lib/export/csv";
import { Download, Loader2, FileBarChart } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

type ReportDeal = Deal & { contact: Pick<Contact, "name" | "phone"> | null };

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `d`, per ISO week convention. */
function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default function ReportsPage() {
  const t = useTranslations("Reports.page");
  const supabase = createClient();
  const { accountId } = useAuth();

  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(isoDate(startOfWeek(today)));
  const [to, setTo] = useState(isoDate(today));
  const [deals, setDeals] = useState<ReportDeal[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDeals = useCallback(async () => {
    if (!accountId || !from || !to) return;
    setLoading(true);

    // `to` is a calendar day picked in the UI — exclusive upper bound
    // is the *next* day at midnight, so a deal created any time on
    // `to` itself is still included.
    const toExclusive = new Date(`${to}T00:00:00`);
    toExclusive.setDate(toExclusive.getDate() + 1);

    const { data, error } = await supabase
      .from("deals")
      .select("*, contact:contacts(name, phone)")
      .eq("account_id", accountId)
      .neq("status", "lost")
      .gte("created_at", `${from}T00:00:00`)
      .lt("created_at", `${isoDate(toExclusive)}T00:00:00`)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(t("toastFailedLoad"));
      setLoading(false);
      return;
    }
    setDeals((data ?? []) as ReportDeal[]);
    setLoading(false);
  }, [accountId, from, to, supabase, t]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  // Grouped by currency rather than one grand total — an account that
  // ever recorded a sale in a second currency shouldn't get a total
  // that silently adds dollars to soles.
  const totalsByCurrency = useMemo(() => {
    const map: Record<string, { count: number; sum: number }> = {};
    for (const deal of deals) {
      const currency = deal.currency || "USD";
      const bucket = (map[currency] ??= { count: 0, sum: 0 });
      bucket.count += 1;
      bucket.sum += Number(deal.value) || 0;
    }
    return map;
  }, [deals]);

  function applyPreset(preset: "week" | "month" | "7d") {
    const now = new Date();
    if (preset === "week") {
      setFrom(isoDate(startOfWeek(now)));
      setTo(isoDate(now));
    } else if (preset === "month") {
      setFrom(isoDate(startOfMonth(now)));
      setTo(isoDate(now));
    } else {
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      setFrom(isoDate(sevenDaysAgo));
      setTo(isoDate(now));
    }
  }

  function handleExport() {
    if (deals.length === 0) return;
    const header = [
      t("table.date"),
      t("table.contact"),
      t("table.phone"),
      t("table.title"),
      t("table.value"),
      t("table.currency"),
      t("table.status"),
    ];
    const rows = deals.map((d) => [
      d.created_at.slice(0, 10),
      d.contact?.name ?? "",
      d.contact?.phone ?? "",
      d.title,
      String(d.value),
      d.currency ?? "",
      d.status ?? "",
    ]);
    const csv = toCsv([header, ...rows]);
    downloadBlob(`ventas-${from}-a-${to}.csv`, csv);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileBarChart className="size-6 text-primary" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={deals.length === 0}
          className="border-border text-muted-foreground hover:bg-muted shrink-0"
        >
          <Download className="size-4" />
          {t("exportCsvBtn")}
        </Button>
      </div>

      {/* Date range */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-1.5">
          <Label className="text-muted-foreground text-xs">{t("from")}</Label>
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="border-border bg-muted text-foreground"
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-muted-foreground text-xs">{t("to")}</Label>
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="border-border bg-muted text-foreground"
          />
        </div>
        <div className="flex flex-wrap gap-2 pb-0.5">
          <Button variant="outline" size="sm" onClick={() => applyPreset("7d")}>
            {t("presetLast7")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset("week")}>
            {t("presetThisWeek")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset("month")}>
            {t("presetThisMonth")}
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="flex flex-wrap gap-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : Object.keys(totalsByCurrency).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSales")}</p>
        ) : (
          Object.entries(totalsByCurrency).map(([currency, { count, sum }]) => (
            <div
              key={currency}
              className="rounded-lg border border-border bg-card px-4 py-3"
            >
              <p className="text-xs text-muted-foreground">
                {t("salesCount", { count })}
              </p>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(sum, currency)}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Detail table */}
      {deals.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">{t("table.date")}</TableHead>
                <TableHead className="text-muted-foreground">{t("table.contact")}</TableHead>
                <TableHead className="text-muted-foreground">{t("table.title")}</TableHead>
                <TableHead className="text-muted-foreground text-right">
                  {t("table.value")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals.map((deal) => (
                <TableRow key={deal.id} className="border-border">
                  <TableCell className="text-muted-foreground text-xs">
                    {deal.created_at.slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-foreground text-sm">
                    {deal.contact?.name || deal.contact?.phone || t("unknownContact")}
                  </TableCell>
                  <TableCell className="text-foreground text-sm">{deal.title}</TableCell>
                  <TableCell className="text-foreground text-sm text-right font-medium">
                    {formatCurrency(deal.value, deal.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
