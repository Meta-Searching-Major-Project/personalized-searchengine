import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { LogOut } from "lucide-react";

const AppHeader = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { path: "/", label: "Search" },
    ...(user
      ? [
          { path: "/settings", label: "Settings" },
          { path: "/analytics", label: "Analytics" },
        ]
      : []),
  ];

  const isHome = location.pathname === "/";

  return (
    <header className={`w-full z-50 transition-all ${isHome ? "absolute top-0 bg-transparent" : "sticky top-0 bg-white/90 backdrop-blur-md border-b border-slate-200"}`}>
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
        
        {/* Logo */}
        <div className="flex items-center cursor-pointer" onClick={() => navigate("/")}>
          <img src="/logo-full.png" alt="AMURA Logo" className="h-10 object-contain" />
        </div>

        {/* Center Nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navItems.map(({ path, label }) => (
            <button
              key={label}
              className={`text-base font-medium transition-colors hover:text-slate-900 ${location.pathname === path ? "text-blue-600" : "text-slate-600"}`}
              onClick={() => navigate(path)}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Right Nav (User) */}
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white font-semibold">
                {user.email?.[0].toUpperCase() || "A"}
              </div>
              <span className="text-slate-700 font-medium hidden sm:inline">{user.email?.split('@')[0] || "Alex"}</span>
              <Button variant="ghost" size="icon" onClick={signOut} className="text-slate-500 hover:text-slate-700">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <button
              className="text-base font-medium text-slate-700 hover:text-slate-900 transition-colors"
              onClick={() => navigate("/auth")}
            >
              Sign In
            </button>
          )}
        </div>

      </div>
    </header>
  );
};

export default AppHeader;
