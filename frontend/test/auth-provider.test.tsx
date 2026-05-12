import { render, screen, waitFor } from "@testing-library/react";

import { AuthProvider, useAuth } from "@/components/providers/auth-provider";
import { clearAccessToken, writeAccessToken } from "@/lib/auth/token-storage";

function AuthProbe() {
  const { status, user } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.username ?? "none"}</span>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    clearAccessToken();
    vi.restoreAllMocks();
  });

  it("restores a persisted session and fetches the current user", async () => {
    writeAccessToken("persisted-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 7,
          email: "persisted@example.com",
          username: "persisted_user",
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
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("user")).toHaveTextContent("persisted_user");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/users/me",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
  });
});
