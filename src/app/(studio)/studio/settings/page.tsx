import { Settings } from "lucide-react";
import { MetaConnection } from "@/components/studio/meta-connection";
import { GeminiSettings } from "@/components/studio/gemini-settings";

export default function StudioSettingsPage() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Conexiones
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Conecta las cuentas donde Studio va a publicar.
      </p>

      <div className="mt-6 max-w-lg space-y-4">
        <MetaConnection />
        <GeminiSettings />
      </div>
    </div>
  );
}
