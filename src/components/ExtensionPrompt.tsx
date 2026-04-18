import { useState, useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Info, X, Puzzle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useFeedbackTracker } from "@/hooks/useFeedbackTracker";

export function ExtensionPrompt() {
  const { user } = useAuth();
  const { hasExtension } = useFeedbackTracker();
  const [dismissed, setDismissed] = useState(false);

  // Check if previously dismissed in localStorage
  useEffect(() => {
    if (localStorage.getItem("personasearch_extension_prompt_dismissed")) {
      setDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem("personasearch_extension_prompt_dismissed", "true");
    setDismissed(true);
  };

  // Only show to signed-in users who don't have the extension and haven't dismissed it
  if (!user || hasExtension || dismissed) {
    return null;
  }

  return (
    <Alert className="mb-6 border-primary/20 bg-primary/5">
      <Puzzle className="h-5 w-5 text-primary" />
      <div className="flex items-start justify-between w-full">
        <div className="flex-1 ml-2">
          <AlertTitle className="text-foreground">Install the PersonaSearch Tracker</AlertTitle>
          <AlertDescription className="text-muted-foreground mt-1 text-sm">
            For accurate personalization, install the Chrome extension. It tracks exact reading time (dwell time) and copy-paste activity on search results.
            <div className="mt-3 flex gap-2">
              <Button variant="outline" size="sm" asChild className="h-8 text-xs">
                <a href="https://github.com/Meta-Searching-Major-Project/personalized-searchengine#extension-setup" target="_blank" rel="noreferrer">
                  Installation Guide
                </a>
              </Button>
            </div>
          </AlertDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 -mt-1 -mr-1 text-muted-foreground hover:text-foreground"
          onClick={handleDismiss}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Dismiss</span>
        </Button>
      </div>
    </Alert>
  );
}
