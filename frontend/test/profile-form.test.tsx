import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuthProvider } from "@/components/providers/auth-provider";
import { ProfileForm } from "@/features/profile/profile-form";
import { AVATAR_MAX_BYTES } from "@/features/profile/validation";
import { clearAccessToken, writeAccessToken } from "@/lib/auth/token-storage";

function renderProfileForm() {
  return render(
    <AuthProvider>
      <ProfileForm />
    </AuthProvider>,
  );
}

describe("ProfileForm", () => {
  beforeEach(() => {
    clearAccessToken();
    writeAccessToken("profile-token");
    vi.restoreAllMocks();
  });

  it("updates supported profile fields through the backend contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 2,
            email: "profile@example.com",
            username: "profile_user",
            avatar_url: "https://cdn.example.com/original.png",
            description: "Original bio",
            status: "away",
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 2,
            email: "profile@example.com",
            username: "profile_user",
            avatar_url: "https://cdn.example.com/updated.png",
            description: "Updated bio",
            status: "busy",
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        }),
    );

    renderProfileForm();

    await screen.findByRole("textbox", { name: /username/i });

    fireEvent.change(screen.getByRole("textbox", { name: /avatar url/i }), {
      target: { value: "https://cdn.example.com/updated.png" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /bio/i }), {
      target: { value: "Updated bio" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /status/i }), {
      target: { value: "busy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => expect(screen.getByText("Profile changes saved.")).toBeInTheDocument());
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8000/api/v1/users/me",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
  });

  it("validates avatar file uploads on the client", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 2,
          email: "profile@example.com",
          username: "profile_user",
          avatar_url: null,
          description: null,
          status: "online",
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }),
    );

    renderProfileForm();

    await screen.findByRole("textbox", { name: /username/i });

    const invalidTypeFile = new File(["text"], "not-image.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText(/avatar upload/i), {
      target: { files: [invalidTypeFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
    expect(await screen.findByText("Avatar files must be images.")).toBeInTheDocument();

    const oversizeFile = new File([new Uint8Array(AVATAR_MAX_BYTES + 1)], "avatar.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/avatar upload/i), {
      target: { files: [oversizeFile] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
    expect(await screen.findByText("Avatar files must be 10 MB or smaller.")).toBeInTheDocument();
  });
});
