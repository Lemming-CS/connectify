import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuthProvider } from "@/components/providers/auth-provider";
import { LoginForm } from "@/features/auth/login-form";
import { clearAccessToken } from "@/lib/auth/token-storage";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    clearAccessToken();
    replace.mockReset();
    vi.restoreAllMocks();
  });

  it("logs in successfully and redirects to the chat workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "token-123", token_type: "bearer" }),
        })
        .mockResolvedValueOnce({
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
        <LoginForm />
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secure-pass-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Log In" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat"));
  });

  it("shows backend errors when login fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ detail: "Invalid email or password" }),
      }),
    );

    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Log In" }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
