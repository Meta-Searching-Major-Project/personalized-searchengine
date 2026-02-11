import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, Settings, BarChart3, LogOut } from "lucide-react";

const AppHeader = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!user) return null;

  const navItems = [
    { path: "/", icon: Search, label: "Search" },
    { path: "/settings", icon: Settings, label: "Settings" },
    { path: "/analytics", icon: BarChart3, label: "Analytics" },
  ];

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
            <Search className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="ml-2 font-semibold text-foreground">PersonaSearch</span>
        </div>
        <nav className="flex items-center gap-1">
          {navItems.map(({ path, icon: Icon, label }) => (
            <Button
              key={path}
              variant={location.pathname === path ? "secondary" : "ghost"}
              size="sm"
              onClick={() => navigate(path)}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </nav>
      </div>
    </header>
  );
};

export default AppHeader;
