import { Card } from "@/components/ui/card";
import { Cloud, BookOpen, Sparkles, MessageSquare } from "lucide-react";
import type { RichBlocks } from "@/lib/api/search";

interface Props {
  blocks?: RichBlocks;
}

const RichWidgets = ({ blocks }: Props) => {
  if (!blocks) return null;
  const { weather, dictionary, images, knowledge_graph, answer_box } = blocks;
  const hasAny =
    weather || dictionary || (images && images.length > 0) || knowledge_graph || answer_box;
  if (!hasAny) return null;

  return (
    <div className="space-y-3">
      {weather && <WeatherWidget data={weather} />}
      {dictionary && <DictionaryWidget data={dictionary} />}
      {answer_box && !dictionary && !weather && <AnswerBoxWidget data={answer_box} />}
      {knowledge_graph && <KnowledgeGraphWidget data={knowledge_graph} />}
      {images && images.length > 0 && <ImagesWidget images={images} />}
    </div>
  );
};

// ── Weather ────────────────────────────────────────────────────────
const WeatherWidget = ({ data }: { data: any }) => {
  const temp = data.temperature ?? data.temp;
  const unit = data.unit ?? "°";
  const location = data.location ?? data.address;
  const condition = data.condition ?? data.weather ?? data.description;
  const forecast = Array.isArray(data.forecast) ? data.forecast.slice(0, 5) : [];

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5 p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Cloud className="h-3 w-3" />
        Weather
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div>
          {location && <p className="text-sm text-muted-foreground">{location}</p>}
          <p className="text-3xl font-bold text-foreground">
            {temp}
            {unit}
          </p>
          {condition && <p className="text-sm text-foreground">{condition}</p>}
        </div>
        {data.thumbnail && (
          <img src={data.thumbnail} alt="" className="h-16 w-16 object-contain" />
        )}
      </div>
      {forecast.length > 0 && (
        <div className="mt-3 flex gap-3 overflow-x-auto border-t border-border pt-3">
          {forecast.map((f: any, i: number) => (
            <div key={i} className="min-w-[60px] text-center">
              <p className="text-xs text-muted-foreground">{f.day}</p>
              {f.thumbnail && (
                <img src={f.thumbnail} alt="" className="mx-auto h-8 w-8" />
              )}
              <p className="text-xs font-medium text-foreground">
                {f.temperature?.high ?? f.high}°/{f.temperature?.low ?? f.low}°
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

// ── Dictionary ─────────────────────────────────────────────────────
const DictionaryWidget = ({ data }: { data: any }) => {
  const word = data.word ?? data.title ?? data.syllables;
  const phonetic = data.phonetic ?? data.pronunciation;
  const definitions = Array.isArray(data.definitions)
    ? data.definitions
    : Array.isArray(data.meanings)
      ? data.meanings
      : [];

  return (
    <Card className="border-primary/20 bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <BookOpen className="h-3 w-3" />
        Dictionary
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <h3 className="text-2xl font-bold text-foreground">{word}</h3>
        {phonetic && (
          <span className="text-sm italic text-muted-foreground">/{phonetic}/</span>
        )}
      </div>
      <ol className="mt-3 list-inside list-decimal space-y-1 text-sm text-foreground">
        {definitions.slice(0, 3).map((d: any, i: number) => (
          <li key={i}>
            {typeof d === "string" ? d : d.definition || d.meaning || JSON.stringify(d)}
          </li>
        ))}
      </ol>
    </Card>
  );
};

// ── Images carousel ────────────────────────────────────────────────
const ImagesWidget = ({ images }: { images: any[] }) => {
  return (
    <Card className="border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Images
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {images.map((img, i) => {
          const src = img.thumbnail ?? img.original ?? img.source ?? img.image;
          const link = img.link ?? img.source ?? src;
          if (!src) return null;
          return (
            <a
              key={i}
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex-shrink-0"
            >
              <img
                src={src}
                alt={img.title || ""}
                className="h-28 w-28 rounded-md object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />
            </a>
          );
        })}
      </div>
    </Card>
  );
};

// ── Knowledge Graph ────────────────────────────────────────────────
const KnowledgeGraphWidget = ({ data }: { data: any }) => {
  return (
    <Card className="border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        Knowledge Graph
      </div>
      <div className="mt-2 flex gap-4">
        {data.image && (
          <img
            src={data.image}
            alt={data.title || ""}
            className="h-24 w-24 rounded-md object-cover"
          />
        )}
        <div className="flex-1">
          {data.title && (
            <h3 className="text-lg font-semibold text-foreground">{data.title}</h3>
          )}
          {data.type && (
            <p className="text-xs text-muted-foreground">{data.type}</p>
          )}
          {data.description && (
            <p className="mt-1 text-sm text-foreground">{data.description}</p>
          )}
          {data.source?.link && (
            <a
              href={data.source.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-primary hover:underline"
            >
              {data.source.name || "Source"}
            </a>
          )}
        </div>
      </div>
    </Card>
  );
};

// ── Answer Box ─────────────────────────────────────────────────────
const AnswerBoxWidget = ({ data }: { data: any }) => {
  const answer = data.answer ?? data.snippet ?? data.result;
  const title = data.title;
  if (!answer && !title) return null;

  return (
    <Card className="border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <MessageSquare className="h-3 w-3" />
        Quick Answer
      </div>
      {title && <p className="mt-2 text-sm font-semibold text-foreground">{title}</p>}
      {answer && <p className="mt-1 text-sm text-foreground">{answer}</p>}
      {data.link && (
        <a
          href={data.link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs text-primary hover:underline"
        >
          {data.displayed_link || data.link}
        </a>
      )}
    </Card>
  );
};

export default RichWidgets;
