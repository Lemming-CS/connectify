import { render, screen, waitFor } from "@testing-library/react";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { PublicOnlyRoute } from "@/components/auth/public-only-route";
import { AuthProvider } from "@/components/providers/auth-provider";
import { clearAccessToken, writeAccessToken } from "@/lib/auth/token-storage";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
}));

describe("route guards", () => {
  beforeEach(() => {
    clearAccessToken();
    replace.mockReset();
    vi.restoreAllMocks();
  });

  it("redirects unauthenticated users away from protected routes", async () => {
    render(
      <AuthProvider>
        <ProtectedRoute>
          <div>Protected content</div>
        </ProtectedRoute>
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/login?next=%2Fsettings"),
    );
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("redirects authenticated users away from auth pages", async () => {
    writeAccessToken("auth-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 1,
          email: "person@example.com",
          username: "person",
          avatar_url: null,
          description: null,
          status: "online",
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }),
    );

    render(
      <AuthProvider>
        <PublicOnlyRoute>
          <div>Auth page</div>
        </PublicOnlyRoute>
      </AuthProvider>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat"));
  });
});
