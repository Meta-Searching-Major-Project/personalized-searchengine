import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import AppHeader from "@/components/AppHeader";

const Index = () => {
  const [query, setQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    // TODO: Phase 2 — trigger multi-engine search
    console.log("Search query:", query);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="flex flex-col items-center justify-center px-4" style={{ minHeight: "calc(100vh - 3.5rem)" }}>
        <div className="w-full max-w-xl text-center">
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
            PersonaSearch
          </h1>
          <p className="mb-8 text-muted-foreground">
            Personalized multi-engine search with intelligent rank aggregation
          </p>
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the web..."
                className="pl-10"
                autoFocus
              />
            </div>
            <Button type="submit">Search</Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Aggregates results from Google, Bing & DuckDuckGo using fuzzy rank aggregation
          </p>
        </div>
      </main>
    </div>
  );
};

export default Index;
