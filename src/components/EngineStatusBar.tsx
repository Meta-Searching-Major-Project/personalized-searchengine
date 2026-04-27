import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { EngineSummary } from "@/lib/api/search";

const METHOD_LABELS: Record<string, string> = {
  borda: "Borda",
  shimura: "Shimura",
  modal: "Modal Value",
  mfo: "MFO",
  mbv: "MBV",
  owa: "OWA-Shimura",
  biased: "Biased",
};

const INTENT_LABELS: Record<string, string> = {
  generic:  "🔍 Generic",
  research: "🔬 Research",
  news:     "📰 News",
  local:    "📍 Local",
  coding:   "💻 Coding",
  regional: "🌏 Regional",
};

interface EngineStatusBarProps {
  engines: EngineSummary[];
  totalResults: number;
  queryTime?: number;
  aggregationMethod?: string;
  queryIntent?: string;
}

const EngineStatusBar = ({ engines, totalResults, queryTime, aggregationMethod, queryIntent }: EngineStatusBarProps) => {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="font-medium">
        {totalResults} results{queryTime ? ` in ${(queryTime / 1000).toFixed(1)}s` : ""}
      </span>
      {queryIntent && (
        <>
          <span className="text-border">|</span>
          <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/80">
            {INTENT_LABELS[queryIntent] ?? queryIntent}
          </Badge>
        </>
      )}
      {aggregationMethod && (
        <>
          <span className="text-border">|</span>
          <Badge variant="secondary" className="text-[10px]">
            {METHOD_LABELS[aggregationMethod] || aggregationMethod}
          </Badge>
        </>
      )}
      <span className="text-border">|</span>
      {engines.map((e) => (
        <div key={e.engine} className="flex items-center gap-1">
          {e.error ? (
            <AlertCircle className="h-3 w-3 text-destructive" />
          ) : (
            <CheckCircle2 className="h-3 w-3 text-green-500" />
          )}
          <span className="capitalize">{e.engine.replace("_", " ")}</span>
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            {e.count}
          </Badge>
          {e.cached && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px]" title="Served from cache">
              ⚡
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
};

export default EngineStatusBar;
