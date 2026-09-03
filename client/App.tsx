import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Neon Bingo application error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-shell app-error-shell" role="alert">
          <div className="app-error-icon">!</div>
          <h1>የመተግበሪያ ስህተት</h1>
          <p>ጨዋታው መጫን አልቻለም። እባክዎ እንደገና ይሞክሩ።</p>
          <button className="start-button" type="button" onClick={() => window.location.reload()}>እንደገና ሞክር</button>
        </main>
      );
    }
    return this.props.children;
  }
}

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/bingo/75" element={<Index />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/bots" element={<Admin initialTab="bots" />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

createRoot(document.getElementById("root")!).render(<App />);
