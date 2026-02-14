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

interface EngineStatusBarProps {
  engines: EngineSummary[];
  totalResults: number;
  queryTime?: number;
  aggregationMethod?: string;
}

const EngineStatusBar = ({ engines, totalResults, queryTime, aggregationMethod }: EngineStatusBarProps) => {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="font-medium">
        {totalResults} results{queryTime ? ` in ${(queryTime / 1000).toFixed(1)}s` : ""}
      </span>
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
          <span className="capitalize">{e.engine}</span>
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            {e.count}
          </Badge>
        </div>
      ))}
    </div>
  );
};

export default EngineStatusBar;
