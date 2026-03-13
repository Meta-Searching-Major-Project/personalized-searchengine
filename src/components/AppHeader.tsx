import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, Settings, BarChart3, LogOut, LogIn } from "lucide-react";

const AppHeader = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { path: "/", icon: Search, label: "Search" },
    ...(user
      ? [
          { path: "/settings", icon: Settings, label: "Settings" },
          { path: "/analytics", icon: BarChart3, label: "Analytics" },
        ]
      : []),
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
          {user ? (
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="default" size="sm" onClick={() => navigate("/auth")}>
              <LogIn className="h-4 w-4" />
              <span className="hidden sm:inline">Sign In</span>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
};

export default AppHeader;
